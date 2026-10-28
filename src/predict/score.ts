import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { MetaClient } from '../meta/client.ts';
import { loadSession } from './inputs.ts';
import type { Label } from './inputs.ts';
import { stagesOf } from './stages.ts';
import { okMoments } from './rows.ts';
import { ALL_PREDICTORS, MODEL_VARIANTS, PREDICTORS, predictSession } from './predict.ts';
import type { AnyPredictor, PredictedItem, Prediction, Predictor, Variant } from './predict.ts';
import { buildPersona } from './persona.ts';
import { playerDir, recordingsRoot, trainPlayer, venvAvailable } from './model.ts';
import type { Opts } from './model.ts';
import { listSessions, playerSessions, sha256File } from './study.ts';
import { cohenKappa, reliability } from './reliability.ts';
import type { Reliability } from './reliability.ts';
import { foldGroupModel } from './reaction.ts';
import type { Study } from './study.ts';

export type Score = {
  recall: number | null; precision: number | null; mix_similarity: number | null;
  real: number; predicted: number; hits: number; matched: number;
  // stage level: kappa between the top predicted label and the most common real label per stage ('none' when empty);
  // per-label AUC of the item p (0 when absent) for "this label happens at this stage"; mix_distance = 1 - mix_similarity
  kappa?: number | null; auc?: Record<string, number>; mix_distance?: number | null;
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
  const st = stageLevel(items as (Item & { p?: number })[], real, stageOrder);
  return {
    recall: ratio(hits, real.length), precision: ratio(matched, items.length), mix_similarity, real: real.length, predicted: items.length, hits, matched,
    kappa: st.kappa, auc: st.auc, mix_distance: mix_similarity === null ? null : 1 - mix_similarity,
  };
}

// Mann-Whitney AUC with ties counted half; null without both classes.
export function auc(truth: number[], score: number[]): number | null {
  const pos = score.filter((_, i) => truth[i] === 1), neg = score.filter((_, i) => truth[i] !== 1);
  if (!pos.length || !neg.length) return null;
  let s = 0;
  for (const p of pos) for (const n of neg) s += p > n ? 1 : p === n ? 0.5 : 0;
  return s / (pos.length * neg.length);
}

function stageLevel(items: (Item & { p?: number })[], real: RealMoment[], stageOrder: string[]) {
  const stages = stageOrder.length ? stageOrder : [...new Set(real.map(m => m.stage))];
  const out: { kappa: number | null; auc: Record<string, number> } = { kappa: null, auc: {} };
  if (!stages.length || (!items.length && !real.length)) return out;
  const top = (st: string) => {
    const its = items.filter(i => i.stage === st);
    return its.length ? its.reduce((a, b) => ((b.p ?? 0) > (a.p ?? 0) ? b : a)).label : 'none';
  };
  const common = (st: string) => {
    const counts = new Map<string, number>();
    for (const m of real.filter(x => x.stage === st)) counts.set(m.label, (counts.get(m.label) ?? 0) + 1);
    return counts.size ? [...counts].sort((a, b) => b[1] - a[1])[0][0] : 'none';
  };
  out.kappa = cohenKappa(stages.map(top), stages.map(common));
  const labels = [...new Set([...items.map(i => i.label), ...real.map(m => m.label)])].sort();
  for (const l of labels) {
    const truth = stages.map(st => (real.some(m => m.stage === st && m.label === l) ? 1 : 0));
    const score = stages.map(st => Math.max(0, ...items.filter(i => i.stage === st && i.label === l).map(i => i.p ?? 0)));
    const a = auc(truth, score);
    if (a !== null) out.auc[l] = a;
  }
  return out;
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
  return scoreItems(a.real.map(m => ({ ...m, p: m.confidence })), b.real, b.stageOrder);
}

export type Agg = {
  recall: number | null; precision: number | null; mix_similarity: number | null;
  kappa?: number | null; mix_distance?: number | null; auc?: Record<string, number>;
};
const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
export function meanScores(xs: Score[]): Agg {
  const mean = (k: 'recall' | 'precision' | 'mix_similarity' | 'kappa' | 'mix_distance') =>
    avg(xs.map(x => x[k]).filter((n): n is number => typeof n === 'number'));
  const auc: Record<string, number> = {};
  for (const l of [...new Set(xs.flatMap(x => Object.keys(x.auc ?? {})))].sort()) auc[l] = avg(xs.map(x => x.auc?.[l]).filter((n): n is number => typeof n === 'number'))!;
  return { recall: mean('recall'), precision: mean('precision'), mix_similarity: mean('mix_similarity'), kappa: mean('kappa'), mix_distance: mean('mix_distance'), auc };
}

// Kendall's tau between a kid's own order of games (best first) and predicted enjoyment; only games with a prediction count.
export function kendallTau(order: string[], score: Record<string, number>): number | null {
  const g = order.filter(x => typeof score[x] === 'number');
  let c = 0, d = 0;
  for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
    const diff = score[g[i]] - score[g[j]];
    if (diff > 0) c++; else if (diff < 0) d++;
  }
  const pairs = (g.length * (g.length - 1)) / 2;
  return pairs ? (c - d) / pairs : null;
}

export type Ranking = { order: string[]; tau: Partial<Record<Variant, number | null>>; n: number };

// recordings/kids/<letter>/ranking.json is { order: [best game first] }; predicted enjoyment per game comes from the
// leave-one-game-out folds (mean P(delighted) - P(bored or frustrated) over the simulated playthrough).
export async function rankingCheck(letter: string, report: { folds: { game: string; enjoyment?: Partial<Record<Variant, number>> }[] }, root: string): Promise<Ranking | null> {
  let order: string[] | null = null;
  for (const l of [letter.toLowerCase(), letter.toUpperCase()]) {
    try { order = JSON.parse(await readFile(join(root, 'kids', l, 'ranking.json'), 'utf8')).order; break; } catch { /* try the other case */ }
  }
  if (!Array.isArray(order)) return null;
  const tau: Ranking['tau'] = {};
  for (const v of MODEL_VARIANTS) {
    const score: Record<string, number> = {};
    for (const f of report.folds) if (typeof f.enjoyment?.[v] === 'number') score[f.game] = f.enjoyment[v]!;
    tau[v] = kendallTau(order, score);
  }
  return { order, tau, n: order.length };
}

export type LogoReport = {
  letter: string;
  folds: { game: string; key: string; trainSessions: string[]; scores: Partial<Record<AnyPredictor, Score>>; enjoyment?: Partial<Record<Variant, number>> }[];
  skipped: string[];
  mean: Partial<Record<AnyPredictor, Agg>>;
};

// Leave-one-game-out: for each game the player has learn sessions in, rebuild everything without it and predict it.
export async function logo(
  letter: string, client: MetaClient,
  o: Opts & { log?: (line: string) => void; predictors?: readonly Predictor[]; variants?: boolean; sims?: number } = {},
): Promise<LogoReport> {
  const log = o.log ?? console.log;
  const root = recordingsRoot(o);
  const learn = await playerSessions(root, letter, 'learn');
  const games = [...new Set(learn.map(s => s.game))].sort();
  const base = join(playerDir(letter, { root }), 'logo');
  const report: LogoReport = { letter, folds: [], skipped: [], mean: {} };
  const perPredictor: Partial<Record<AnyPredictor, Score[]>> = {};
  const withVariants = o.variants ?? venvAvailable();

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
    // the player-model variants and the persona's traits come from a group model fitted without this game:
    // no kid's rows for it, traits recomputed without it
    let group: string | null = null;
    if (withVariants) {
      try { group = await foldGroupModel(root, game); }
      catch (e) { log(`logo ${letter}: no group model for fold ${game}: ${(e as Error).message}`); }
    }
    if (!existsSync(join(dir, 'persona.json'))) {
      const traits = group ? JSON.parse(await readFile(join(group, 'traits.json'), 'utf8')) : null;
      await buildPersona(letter, train.map(s => s.dir), client, { ...fold, log, traits });
    }
    const predictors: AnyPredictor[] = [...(o.predictors ?? PREDICTORS).filter(p => p !== 'model' || modelOk), ...(group ? MODEL_VARIANTS : [])];

    const scores: Partial<Record<AnyPredictor, Score>> = {};
    const perSession: Partial<Record<AnyPredictor, Score[]>> = {};
    const joy: Partial<Record<Variant, number[]>> = {};
    for (const h of held) {
      const preds = await predictSession(letter, h.dir, client, predictors, { ...fold, group: group ?? undefined, sims: o.sims });
      for (const p of predictors) (perSession[p] ??= []).push(await scorePrediction(preds[p]!, h.dir));
      for (const v of MODEL_VARIANTS) if (typeof preds[v]?.enjoyment === 'number') (joy[v] ??= []).push(preds[v]!.enjoyment!);
    }
    for (const p of predictors) {
      const xs = perSession[p] ?? [];
      // one held-out session is the normal case; with several, the fold score is their mean
      scores[p] = xs.length === 1 ? xs[0] : { ...meanScores(xs), real: sum(xs, 'real'), predicted: sum(xs, 'predicted'), hits: sum(xs, 'hits'), matched: sum(xs, 'matched') };
      (perPredictor[p] ??= []).push(scores[p]!);
    }
    const enjoyment: Partial<Record<Variant, number>> = {};
    for (const v of MODEL_VARIANTS) if (joy[v]?.length) enjoyment[v] = avg(joy[v]!)!;
    report.folds.push({ game, key, trainSessions: train.map(s => s.id), scores, ...(Object.keys(enjoyment).length ? { enjoyment } : {}) });
  }
  for (const p of ALL_PREDICTORS) if (perPredictor[p]) report.mean[p] = meanScores(perPredictor[p]!);
  await mkdir(playerDir(letter, { root }), { recursive: true });
  await writeFile(join(playerDir(letter, { root }), 'logo.json'), JSON.stringify(report, null, 2));
  return report;
}

const sum = (xs: Score[], k: 'real' | 'predicted' | 'hits' | 'matched') => xs.reduce((s, x) => s + x[k], 0);

export type PredictorRow = { logo: Agg | null; check: Score | null; logo_normalized: number | null; check_normalized: number | null };
// reliability comes first: no prediction score means much until Joel's labels agree with Muse's (kappa >= 0.6)
export type Scoreboard = {
  reliability: Reliability;
  players: Record<string, { ceiling: Score | null; predictors: Partial<Record<AnyPredictor, PredictorRow>>; ranking: Ranking | null }>;
};

function checkLabel(study: Study, letter: string, game: string): string {
  for (const [label, c] of Object.entries(study.checks ?? {})) if (c.letter === letter && c.game === game) return label;
  return `${letter}-${game}`;
}

async function verifyFrozen(study: Study, root: string, label: string): Promise<void> {
  const hashes = study.frozen[label];
  if (!hashes) throw new Error(`check round "${label}" is not frozen; run freeze before the check session is scored`);
  // the four Plan 3 predictors are required; the player-model variants are checked when they were frozen too
  for (const p of [...PREDICTORS, ...MODEL_VARIANTS.filter(v => v in hashes)] as AnyPredictor[]) {
    const file = join(root, 'predictions', label, `${p}.json`);
    const want = (hashes as Partial<Record<AnyPredictor, string>>)[p];
    if (!want) throw new Error(`check round "${label}" is not frozen for ${p}`);
    let got: string;
    try { got = await sha256File(file); } catch { throw new Error(`frozen prediction ${label}/${p}.json is missing`); }
    if (got !== want) throw new Error(`frozen prediction ${label}/${p}.json does not match its frozen hash; refusing to score`);
  }
}

// Reads study.json's shape (passed in). Verifies every frozen file before it scores anything.
// normalized = recall / the player's replay ceiling recall. The ceiling comes from a replayed learn game, not the check game, so it is a per-player yardstick.
export async function scoreboard(
  study: Study, o: Opts & { client: MetaClient; log?: (line: string) => void; refreshLogo?: boolean; sims?: number },
): Promise<Scoreboard> {
  const root = recordingsRoot(o);
  const sessions = await listSessions(root);
  const labels = Object.fromEntries(Object.entries(study.players).map(([l, p]) => [l, checkLabel(study, l, p.check)]));
  for (const [letter, p] of Object.entries(study.players)) if (p.check) await verifyFrozen(study, root, labels[letter]);

  const out: Scoreboard = { reliability: await reliability(root), players: {} };
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
    else report = await logo(letter, o.client, { root, log: o.log, sims: o.sims });

    const checkSession = mine.find(s => s.game === p.check && s.round === 'check');
    const rows: Partial<Record<AnyPredictor, PredictorRow>> = {};
    const frozen = (study.frozen[labels[letter]] ?? {}) as Partial<Record<AnyPredictor, string>>;
    for (const name of ALL_PREDICTORS) {
      const isVariant = (MODEL_VARIANTS as readonly string[]).includes(name);
      if (isVariant && !frozen[name] && !report?.mean[name]) continue;
      let check: Score | null = null;
      if (checkSession && (!isVariant || frozen[name])) {
        const pred = JSON.parse(await readFile(join(root, 'predictions', labels[letter], `${name}.json`), 'utf8')) as Prediction;
        check = await scorePrediction(pred, checkSession.dir);
      }
      const lg = report?.mean[name] ?? null;
      const norm = (r: number | null | undefined) => (r != null && ceiling?.recall ? r / ceiling.recall : null);
      rows[name] = { logo: lg, check, logo_normalized: norm(lg?.recall), check_normalized: norm(check?.recall) };
    }
    out.players[letter] = { ceiling, predictors: rows, ranking: report ? await rankingCheck(letter, report, root) : null };
  }
  return out;
}
