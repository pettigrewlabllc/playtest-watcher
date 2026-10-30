import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clientFromEnv, createMetaClient } from '../meta/client.ts';
import type { MetaClient } from '../meta/client.ts';
import { playerFingerprint } from './fingerprint.ts';
import { trainPlayer, playerDir, recordingsRoot } from './model.ts';
import { buildPersona } from './persona.ts';
import { predictSession, writePredictions, PREDICTORS, MODEL_VARIANTS, ALL_PREDICTORS } from './predict.ts';
import type { AnyPredictor } from './predict.ts';
import { existsSync } from 'node:fs';
import { logo, scoreboard } from './score.ts';
import type { Agg, Score } from './score.ts';
import { freeze } from './freeze.ts';
import { listSessions, loadStudy, playerSessions, sameKid } from './study.ts';
import { buildGroupModel, groupDir } from './traits.ts';
import { fitReaction } from './reaction.ts';
import { reliability, reliabilityLine } from './reliability.ts';
import { stability, stabilityLine } from './stability.ts';
import type { Stability } from './stability.ts';
import { sampleLabels, writeQueue } from '../label/queue.ts';
import type { Scoreboard } from './score.ts';
import type { Trait } from './traits.ts';

const REPO = resolve(import.meta.dirname, '..', '..');
export const COMMANDS = ['fingerprint', 'train', 'persona', 'predict', 'freeze', 'logo', 'scoreboard', 'traits', 'reaction', 'reliability', 'stability'] as const;
const USAGE = `usage: npm run predict -- <command> [--live]
  fingerprint <letter>
  train <letter>
  persona <letter>
  predict <letter> <targetSessionId>
  freeze <letter> <targetSessionId> <checkLabel>
  logo <letter>
  scoreboard
  traits            (AFM and trait estimators for every kid, from all learn sessions)
  reaction          (pooled reaction model, both variants and baselines, leave-one-game-out)
  reliability       (Cohen's kappa between Joel's hand labels and Muse's)
  stability [--n 30] (Muse asked twice about the same clips: how often it gives the same label; live, ~$0.03 a clip)
  sample-labels [--n 200]   (moments for Joel to label, stratified by Muse's label, into label-queue.json)`;

type Deps = { root?: string; client?: MetaClient; out?: (line: string) => void; commit?: (file: string, message: string) => Promise<void>; docFile?: string };

const pct = (n: number | null | undefined) => (n == null ? '  -  ' : `${(n * 100).toFixed(0)}%`.padStart(5));
const fmt = (n: number | null) => (n == null ? '-' : Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2));
export const traitLine = (t: Trait) => (t.value == null ? 'n/a' : `${fmt(t.value)} [${fmt(t.lo)}, ${fmt(t.hi)}] n=${t.n}${t.adjusted ? '' : ' (not adjusted)'}`);
const num2 = (n: number | null | undefined) => (n == null ? '  -  ' : n.toFixed(2).padStart(5));
const aucText = (a: Record<string, number> | undefined) => (a && Object.keys(a).length ? Object.entries(a).map(([l, v]) => `${l} ${v.toFixed(2)}`).join(', ') : '-');
const aggLine = (a: Agg | Score | null) => (a ? `recall ${pct(a.recall)}  precision ${pct(a.precision)}  mix ${pct(a.mix_similarity)}  kappa ${num2(a.kappa)}  AUC ${aucText(a.auc)}` : 'no data');

// Reliability first, then the pre-registered primary metric (docs/frozen-predictions.md), then everything else.
// The headline has the five pre-registered predictors; the model variants stay in the secondary block.
export function scoreboardLines(sb: Scoreboard, stab: Stability | null = null): string[] {
  const lines = [...(stab ? [stabilityLine(stab)] : []), ...reliabilityLine(sb.reliability).split('\n')];
  lines.push('PRIMARY (pre-registered): stage-level kappa on the check session, at a matched budget of 2 reactions per stage. Paired hits over the same real moments, against null.');
  for (const [letter, p] of Object.entries(sb.players)) {
    let any = false;
    for (const name of PREDICTORS) {
      const c = p.predictors[name]?.check;
      if (!c) continue;
      any = true;
      const pr = p.paired?.[name];
      const pair = pr ? `  hit ${pr.hits} / missed ${pr.misses}  vs null: both ${pr.vs_null.both}, only this ${pr.vs_null.only_this}, only null ${pr.vs_null.only_null}, neither ${pr.vs_null.neither}` : '';
      lines.push(`  ${letter} ${name.padEnd(13)} kappa ${num2(c.kappa)}${pair}`);
    }
    if (!any) lines.push(`  ${letter}: no check session scored yet`);
  }
  lines.push('Secondary:');
  for (const [letter, p] of Object.entries(sb.players)) {
    lines.push(`${letter}  replay ceiling: ${p.ceiling ? `recall ${pct(p.ceiling.recall)}` : 'none'}`);
    for (const name of ALL_PREDICTORS) {
      const r = p.predictors[name];
      if (!r) continue;
      lines.push(`  ${name.padEnd(13)} LOGO ${aggLine(r.logo)} | check ${aggLine(r.check)} | normalized ${pct(r.logo_normalized)} / ${pct(r.check_normalized)}`);
    }
    if (p.transfer) lines.push(`  traits transfer (model-traits, no row of ${letter} in training) LOGO ${aggLine(p.transfer)}`);
    if (p.ranking) lines.push(`  ranking check (Kendall tau vs their own order ${p.ranking.order.join(' > ')}): ${MODEL_VARIANTS.map(v => `${v} ${num2(p.ranking!.tau[v])}`).join(', ')}`);
  }
  return lines;
}

function pickClient(live: boolean): MetaClient {
  // Two keys on purpose: --live here, and PW_LIVE=1 plus MODEL_API_KEY in the environment.
  if (live) {
    const c = clientFromEnv(REPO);
    if (!c.live) console.warn('--live given but PW_LIVE=1 and MODEL_API_KEY are not both set; staying in fake mode');
    return c;
  }
  return createMetaClient({ live: false, budgetUsd: 0, spendLog: join(REPO, 'recordings', 'spend.jsonl') });
}

export async function runCommand(argv: string[], deps: Deps = {}): Promise<void> {
  const live = argv.includes('--live');
  const args = argv.filter(a => a !== '--live');
  const [cmd, ...rest] = args;
  const out = deps.out ?? console.log;
  const root = deps.root ?? recordingsRoot();
  const needLetter = () => {
    const l = rest[0];
    if (!l || !/^[A-Za-z]$/.test(l)) throw new Error(`${cmd} needs a player letter\n${USAGE}`);
    return l.toUpperCase();
  };
  const client = () => deps.client ?? pickClient(live);
  const learnDirs = async (letter: string) => {
    const s = await playerSessions(root, letter, 'learn');
    if (!s.length) throw new Error(`no learn sessions found for ${letter} in ${root}`);
    return s.map(x => x.dir);
  };

  if (cmd === 'fingerprint') {
    const letter = needLetter();
    const others = [...new Set((await listSessions(root)).filter(s => s.round === 'learn' && !sameKid(s.kid, letter)).map(s => s.kid.toUpperCase()))];
    const population = [];
    for (const k of others) population.push((await playerFingerprint(k, await learnDirs(k))).mean);
    const fp = await playerFingerprint(letter, await learnDirs(letter), population);
    const dir = playerDir(letter, { root });
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'fingerprint.json'), JSON.stringify(fp, null, 2));
    out(`fingerprint ${letter}: ${fp.sessions.length} sessions, ${Object.keys(fp.perGame).length} games`);
    for (const g of fp.gaps) out(`  said vs did, ${g.axis}: ${g.note}`);
  } else if (cmd === 'train') {
    const letter = needLetter();
    const r = await trainPlayer(letter, await learnDirs(letter), { root });
    out(`train ${letter}: ${r.rows} rows, model ${r.cv.chosen}, held-out macro-F1 ${r.cv.mean_macro_f1 === null ? 'n/a (one session)' : r.cv.mean_macro_f1.toFixed(2)}${r.weakLabels ? ' (weak labels: no moments.json)' : ''}`);
    for (const i of r.importances.slice(0, 5)) out(`  ${i.feature}: ${i.importance.toFixed(3)}`);
  } else if (cmd === 'persona') {
    const letter = needLetter();
    const p = await buildPersona(letter, await learnDirs(letter), client(), { root, log: out });
    out(`persona ${letter}: ${join(playerDir(letter, { root }), 'persona.md')}\n  ${p.summary}`);
  } else if (cmd === 'predict') {
    const letter = needLetter();
    const target = rest[1];
    if (!target) throw new Error(`predict needs a target session id\n${USAGE}`);
    // the simulated-playthrough variants join when the group model exists (npm run predict -- traits, then reaction)
    const names: AnyPredictor[] = [...PREDICTORS, ...(existsSync(join(groupDir({ root }), 'reaction', 'models.joblib')) ? MODEL_VARIANTS : [])];
    const preds = await predictSession(letter, join(root, target), client(), names, { root });
    const dir = join(root, 'predictions', `${target}__${letter}`);
    await writePredictions(dir, preds);
    for (const p of names) out(`  ${p}: ${preds[p]!.items.length} predicted reactions`);
    out(`written to ${dir}`);
  } else if (cmd === 'freeze') {
    const letter = needLetter();
    const [, target, label] = rest;
    if (!target || !label) throw new Error(`freeze needs a target session id and a check label\n${USAGE}`);
    const r = await freeze(letter, target, label, client(), { root, commit: deps.commit, docFile: deps.docFile });
    out(`frozen ${label}: ${Object.entries(r.hashes).map(([p, h]) => `${p} ${h!.slice(0, 12)}`).join(', ')}`);
  } else if (cmd === 'logo') {
    const letter = needLetter();
    const r = await logo(letter, client(), { root, log: out });
    out(reliabilityLine(await reliability(root)));
    for (const f of r.folds) {
      out(`held out ${f.game}`);
      for (const p of ALL_PREDICTORS) if (f.scores[p]) out(`  ${p.padEnd(13)} ${aggLine(f.scores[p]!)}`);
    }
    out('mean');
    for (const p of ALL_PREDICTORS) if (r.mean[p]) out(`  ${p.padEnd(13)} ${aggLine(r.mean[p]!)}`);
    if (r.transfer) out(`traits transfer (model-traits, no row of ${letter} in training): ${aggLine(r.transfer.mean)}`);
  } else if (cmd === 'scoreboard') {
    const study = await loadStudy(root);
    if (!Object.keys(study.players).length) throw new Error(`no players in ${join(root, 'study.json')}`);
    // Without --live, leave-one-game-out folds are only read from cache: building them on the fake client
    // would cache canned personas as if they were real.
    const c = client();
    const skipLogo = !deps.client && !c.live;
    if (skipLogo) out('scoreboard: not live, so leave-one-game-out uses cached folds only (npm run predict -- scoreboard --live to build them)');
    const sb = await scoreboard(study, { root, client: c, log: out, skipLogo });
    await writeFile(join(root, 'scoreboard.json'), JSON.stringify(sb, null, 2));
    let stab: Stability | null = null;
    try { stab = JSON.parse(await readFile(join(groupDir({ root }), 'stability.json'), 'utf8')); } catch { /* not measured yet */ }
    for (const line of scoreboardLines(sb, stab)) out(line);
  } else if (cmd === 'sample-labels') {
    const at = rest.indexOf('--n');
    const n = at >= 0 ? Number(rest[at + 1]) : 200;
    if (!Number.isInteger(n) || n < 1) throw new Error(`--n needs a whole number\n${USAGE}`);
    const q = await sampleLabels(root, { n });
    await writeQueue(root, q);
    out(`label-queue.json: ${q.length} moments (first ${q.filter(x => x.reliability).length} for the reliability check)`);
  } else if (cmd === 'reliability') {
    const r = await reliability(root);
    for (const line of reliabilityLine(r).split('\n')) out(line);
  } else if (cmd === 'stability') {
    const at = rest.indexOf('--n');
    const n = at >= 0 ? Number(rest[at + 1]) : 30;
    if (!Number.isInteger(n) || n < 1) throw new Error(`--n needs a whole number\n${USAGE}`);
    out(stabilityLine(await stability(root, client(), { n, log: out })));
  } else if (cmd === 'traits') {
    const g = await buildGroupModel({ root });
    for (const [letter, k] of Object.entries(g.traits.kids)) {
      out(`traits ${letter}: ${Object.entries(k.traits).map(([n, t]) => `${n} ${traitLine(t)}`).join('; ')}`);
      for (const [n, t] of Object.entries(k.traits)) for (const [game, pg] of Object.entries(t.per_game)) out(`  ${game} ${n}: ${traitLine(pg)}`);
      for (const gap of k.gaps) out(`  said vs did, ${gap.axis}: ${gap.note}`);
    }
    out(`written to ${g.dir}`);
  } else if (cmd === 'reaction') {
    const r = await fitReaction({ root });
    const f = (n: number | null | undefined) => (n == null ? '  -  ' : n.toFixed(2).padStart(5));
    out(`reaction: ${r.folds.length} leave-one-game-out folds${r.weak_labels ? ' (weak labels: some sessions have no moments.json)' : ''}`);
    for (const name of [...r.variants, ...r.baselines]) {
      const m = r.pooled[name];
      if (!m) continue;
      out(`  ${name.padEnd(10)} macro-F1 ${f(m.macro_f1)}  kappa ${f(m.kappa)}  mix distance ${f(m.mix_tvd)}  AUC ${Object.entries(m.auc).map(([l, a]) => `${l} ${a.toFixed(2)}`).join(', ') || '-'}`);
    }
  } else {
    throw new Error(`unknown command "${cmd ?? ''}"\n${USAGE}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCommand(process.argv.slice(2)).catch(e => { console.error(String(e.message ?? e)); process.exit(1); });
}
