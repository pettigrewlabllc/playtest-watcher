import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { MetaClient } from '../meta/client.ts';
import { loadSession } from './inputs.ts';
import type { Label } from './inputs.ts';
import { stagesOf } from './stages.ts';
import { okMoments } from './rows.ts';
import { PREDICTORS, predictSession } from './predict.ts';
import type { PredictedItem, Prediction, Predictor } from './predict.ts';
import { buildPersona } from './persona.ts';
import { playerDir, recordingsRoot, trainPlayer } from './model.ts';
import type { Opts } from './model.ts';
import { listSessions, playerSessions, sha256File } from './study.ts';
import type { Study } from './study.ts';

export type Score = {
  recall: number | null; precision: number | null; mix_similarity: number | null;
  real: number; predicted: number; hits: number; matched: number;
};
export type RealMoment = { id: string; label: Label; stage: string; event_type: string; confidence: number };
type Item = Pick<PredictedItem, 'stage' | 'event_type' | 'label'>;

const ratio = (n: number, d: number) => (d > 0 ? n / d : null);

// Stage and event type of a real moment: the stage at the middle of its window, the event closest to that middle.
export function realMoments(aligned: { events: { ms: number; type: string; kind: string; data: Record<string, unknown> }[] }, moments: Parameters<typeof okMoments>[0]): { real: RealMoment[]; stageOrder: string[] } {
  const events = aligned.events;
  const stages = stagesOf(events);
  const real = okMoments(moments).map(m => {
    const mid = (m.startMs + m.endMs) / 2;
    let at = -1;
    events.forEach((e, i) => { if (e.ms <= mid) at = i; });
    const stage = at >= 0 ? stages[at] : 'start';
    const inWin = events.filter(e => e.ms >= m.startMs && e.ms <= m.endMs);
    const pool = inWin.length ? inWin : events;
    const near = pool.reduce<typeof events[number] | null>((b, e) => (!b || Math.abs(e.ms - mid) < Math.abs(b.ms - mid) ? e : b), null);
    return { id: m.id, label: m.label, stage, event_type: near?.type ?? '', confidence: m.confidence };
  });
  return { real, stageOrder: [...new Set(stages)] };
}

export function scoreItems(items: Item[], real: RealMoment[], stageOrder: string[]): Score {
  const idx = (s: string) => stageOrder.indexOf(s);
  const match = (it: Item, m: RealMoment) => {
    if (it.label !== m.label) return false;
    if (it.stage === m.stage) return true;
    const a = idx(it.stage), b = idx(m.stage);
    return a >= 0 && b >= 0 && Math.abs(a - b) === 1 && it.event_type === m.event_type;
  };
  const hits = real.filter(m => items.some(it => match(it, m))).length;
  const matched = items.filter(it => real.some(m => match(it, m))).length;

  const mix = (labels: string[]) => {
    const out: Record<string, number> = {};
    for (const l of labels) out[l] = (out[l] ?? 0) + 1 / labels.length;
    return out;
  };
  let mix_similarity: number | null = null;
  if (items.length && real.length) {
    const p = mix(items.map(i => i.label)), r = mix(real.map(m => m.label));
    const tv = 0.5 * [...new Set([...Object.keys(p), ...Object.keys(r)])].reduce((s, l) => s + Math.abs((p[l] ?? 0) - (r[l] ?? 0)), 0);
    mix_similarity = 1 - tv;
  }
  return { recall: ratio(hits, real.length), precision: ratio(matched, items.length), mix_similarity, real: real.length, predicted: items.length, hits, matched };
}

async function loadReal(dir: string) {
  const s = await loadSession(dir);
  return realMoments(s.aligned, s.moments);
}

export async function scorePrediction(pred: Pick<Prediction, 'items'>, realSessionDir: string): Promise<Score> {
  const { real, stageOrder } = await loadReal(realSessionDir);
  return scoreItems(pred.items, real, stageOrder);
}

// How well a player's earlier play of a game predicts their later play of it: the ceiling for any predictor.
export async function replayCeiling(sessionA: string, sessionB: string): Promise<Score> {
  const a = await loadReal(sessionA);
  const b = await loadReal(sessionB);
  return scoreItems(a.real, b.real, b.stageOrder);
}

export type Agg = { recall: number | null; precision: number | null; mix_similarity: number | null };
export function meanScores(xs: Score[]): Agg {
  const mean = (k: keyof Agg) => {
    const v = xs.map(x => x[k]).filter((n): n is number => n !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  return { recall: mean('recall'), precision: mean('precision'), mix_similarity: mean('mix_similarity') };
}

export type LogoReport = {
  letter: string;
  folds: { game: string; key: string; trainSessions: string[]; scores: Partial<Record<Predictor, Score>> }[];
  skipped: string[];
  mean: Partial<Record<Predictor, Agg>>;
};

// Leave-one-game-out: for each game the player has learn sessions in, rebuild everything without it and predict it.
export async function logo(
  letter: string, client: MetaClient, o: Opts & { log?: (line: string) => void; predictors?: readonly Predictor[] } = {},
): Promise<LogoReport> {
  const log = o.log ?? console.log;
  const root = recordingsRoot(o);
  const learn = await playerSessions(root, letter, 'learn');
  const games = [...new Set(learn.map(s => s.game))].sort();
  const base = join(playerDir(letter, { root }), 'logo');
  const report: LogoReport = { letter, folds: [], skipped: [], mean: {} };
  const perPredictor: Partial<Record<Predictor, Score[]>> = {};

  for (const game of games) {
    const train = learn.filter(s => s.game !== game);
    const held = learn.filter(s => s.game === game);
    if (!train.length) { report.skipped.push(game); log(`logo ${letter}: skipping ${game}, no other game to learn from`); continue; }
    const key = `${game}-${createHash('sha1').update(train.map(s => s.id).sort().join('|')).digest('hex').slice(0, 8)}`;
    const dir = join(base, key);
    const fold: Opts = { root, dir };
    await mkdir(dir, { recursive: true });

    let modelOk = existsSync(join(dir, 'model', 'cv.json'));
    if (!modelOk) {
      try { await trainPlayer(letter, train.map(s => s.dir), fold); modelOk = true; }
      catch (e) { log(`logo ${letter}: no model for fold ${game}: ${(e as Error).message}`); }
    }
    if (!existsSync(join(dir, 'persona.json'))) await buildPersona(letter, train.map(s => s.dir), client, { ...fold, log });
    const predictors = (o.predictors ?? PREDICTORS).filter(p => p !== 'model' || modelOk);

    const scores: Partial<Record<Predictor, Score>> = {};
    const perSession: Partial<Record<Predictor, Score[]>> = {};
    for (const h of held) {
      const preds = await predictSession(letter, h.dir, client, predictors, fold);
      for (const p of predictors) (perSession[p] ??= []).push(await scorePrediction(preds[p], h.dir));
    }
    for (const p of predictors) {
      const xs = perSession[p] ?? [];
      // one held-out session is the normal case; with several, the fold score is their mean
      scores[p] = xs.length === 1 ? xs[0] : { ...meanScores(xs), real: sum(xs, 'real'), predicted: sum(xs, 'predicted'), hits: sum(xs, 'hits'), matched: sum(xs, 'matched') };
      (perPredictor[p] ??= []).push(scores[p]!);
    }
    report.folds.push({ game, key, trainSessions: train.map(s => s.id), scores });
  }
  for (const p of PREDICTORS) if (perPredictor[p]) report.mean[p] = meanScores(perPredictor[p]!);
  await mkdir(playerDir(letter, { root }), { recursive: true });
  await writeFile(join(playerDir(letter, { root }), 'logo.json'), JSON.stringify(report, null, 2));
  return report;
}

const sum = (xs: Score[], k: 'real' | 'predicted' | 'hits' | 'matched') => xs.reduce((s, x) => s + x[k], 0);

export type PredictorRow = { logo: Agg | null; check: Score | null; logo_normalized: number | null; check_normalized: number | null };
export type Scoreboard = { players: Record<string, { ceiling: Score | null; predictors: Record<Predictor, PredictorRow> }> };

function checkLabel(study: Study, letter: string, game: string): string {
  for (const [label, c] of Object.entries(study.checks ?? {})) if (c.letter === letter && c.game === game) return label;
  return `${letter}-${game}`;
}

async function verifyFrozen(study: Study, root: string, label: string): Promise<void> {
  const hashes = study.frozen[label];
  if (!hashes) throw new Error(`check round "${label}" is not frozen; run freeze before the check session is scored`);
  for (const p of PREDICTORS) {
    const file = join(root, 'predictions', label, `${p}.json`);
    const want = hashes[p];
    if (!want) throw new Error(`check round "${label}" is not frozen for ${p}`);
    let got: string;
    try { got = await sha256File(file); } catch { throw new Error(`frozen prediction ${label}/${p}.json is missing`); }
    if (got !== want) throw new Error(`frozen prediction ${label}/${p}.json does not match its frozen hash; refusing to score`);
  }
}

// Reads study.json's shape (passed in). Verifies every frozen file before it scores anything.
// normalized = recall / the player's replay ceiling recall. The ceiling comes from a replayed learn game, not the check game, so it is a per-player yardstick.
export async function scoreboard(
  study: Study, o: Opts & { client: MetaClient; log?: (line: string) => void; refreshLogo?: boolean },
): Promise<Scoreboard> {
  const root = recordingsRoot(o);
  const sessions = await listSessions(root);
  const labels = Object.fromEntries(Object.entries(study.players).map(([l, p]) => [l, checkLabel(study, l, p.check)]));
  for (const [letter, p] of Object.entries(study.players)) if (p.check) await verifyFrozen(study, root, labels[letter]);

  const out: Scoreboard = { players: {} };
  for (const [letter, p] of Object.entries(study.players)) {
    const mine = sessions.filter(s => s.kid.toLowerCase() === letter.toLowerCase());
    let ceiling: Score | null = null;
    if (p.replay) {
      const first = mine.find(s => s.game === p.replay && s.round === 'learn');
      const again = mine.find(s => s.game === p.replay && s.round === 'replay');
      if (first && again) ceiling = await replayCeiling(first.dir, again.dir);
    }
    let report: LogoReport | null = null;
    const cached = join(playerDir(letter, { root }), 'logo.json');
    if (!o.refreshLogo && existsSync(cached)) report = JSON.parse(await readFile(cached, 'utf8'));
    else report = await logo(letter, o.client, { root, log: o.log });

    const checkSession = mine.find(s => s.game === p.check && s.round === 'check');
    const rows = {} as Record<Predictor, PredictorRow>;
    for (const name of PREDICTORS) {
      let check: Score | null = null;
      if (checkSession) {
        const pred = JSON.parse(await readFile(join(root, 'predictions', labels[letter], `${name}.json`), 'utf8')) as Prediction;
        check = await scorePrediction(pred, checkSession.dir);
      }
      const lg = report?.mean[name] ?? null;
      const norm = (r: number | null | undefined) => (r != null && ceiling?.recall ? r / ceiling.recall : null);
      rows[name] = { logo: lg, check, logo_normalized: norm(lg?.recall), check_normalized: norm(check?.recall) };
    }
    out.players[letter] = { ceiling, predictors: rows };
  }
  return out;
}
