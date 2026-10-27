import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clientFromEnv, createMetaClient } from '../meta/client.ts';
import type { MetaClient } from '../meta/client.ts';
import { playerFingerprint } from './fingerprint.ts';
import { trainPlayer, playerDir, recordingsRoot } from './model.ts';
import { buildPersona } from './persona.ts';
import { predictSession, writePredictions, PREDICTORS } from './predict.ts';
import { logo, scoreboard } from './score.ts';
import type { Agg, Score } from './score.ts';
import { freeze } from './freeze.ts';
import { listSessions, loadStudy, playerSessions, sameKid } from './study.ts';

const REPO = resolve(import.meta.dirname, '..', '..');
export const COMMANDS = ['fingerprint', 'train', 'persona', 'predict', 'freeze', 'logo', 'scoreboard'] as const;
const USAGE = `usage: npm run predict -- <command> [--live]
  fingerprint <letter>
  train <letter>
  persona <letter>
  predict <letter> <targetSessionId>
  freeze <letter> <targetSessionId> <checkLabel>
  logo <letter>
  scoreboard`;

type Deps = { root?: string; client?: MetaClient; out?: (line: string) => void; commit?: (file: string, message: string) => Promise<void>; docFile?: string };

const pct = (n: number | null | undefined) => (n == null ? '  -  ' : `${(n * 100).toFixed(0)}%`.padStart(5));
const aggLine = (a: Agg | Score | null) => (a ? `recall ${pct(a.recall)}  precision ${pct(a.precision)}  mix ${pct(a.mix_similarity)}` : 'no data');

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
    const preds = await predictSession(letter, join(root, target), client(), PREDICTORS, { root });
    const dir = join(root, 'predictions', `${target}__${letter}`);
    await writePredictions(dir, preds);
    for (const p of PREDICTORS) out(`  ${p}: ${preds[p].items.length} predicted reactions`);
    out(`written to ${dir}`);
  } else if (cmd === 'freeze') {
    const letter = needLetter();
    const [, target, label] = rest;
    if (!target || !label) throw new Error(`freeze needs a target session id and a check label\n${USAGE}`);
    const r = await freeze(letter, target, label, client(), { root, commit: deps.commit, docFile: deps.docFile });
    out(`frozen ${label}: ${PREDICTORS.map(p => `${p} ${r.hashes[p].slice(0, 12)}`).join(', ')}`);
  } else if (cmd === 'logo') {
    const letter = needLetter();
    const r = await logo(letter, client(), { root, log: out });
    for (const f of r.folds) {
      out(`held out ${f.game}`);
      for (const p of PREDICTORS) if (f.scores[p]) out(`  ${p.padEnd(13)} ${aggLine(f.scores[p]!)}`);
    }
    out('mean');
    for (const p of PREDICTORS) if (r.mean[p]) out(`  ${p.padEnd(13)} ${aggLine(r.mean[p]!)}`);
  } else if (cmd === 'scoreboard') {
    const study = await loadStudy(root);
    if (!Object.keys(study.players).length) throw new Error(`no players in ${join(root, 'study.json')}`);
    const sb = await scoreboard(study, { root, client: client(), log: out });
    await writeFile(join(root, 'scoreboard.json'), JSON.stringify(sb, null, 2));
    for (const [letter, p] of Object.entries(sb.players)) {
      out(`${letter}  replay ceiling: ${p.ceiling ? `recall ${pct(p.ceiling.recall)}` : 'none'}`);
      for (const name of PREDICTORS) {
        const r = p.predictors[name];
        out(`  ${name.padEnd(13)} LOGO ${aggLine(r.logo)} | check ${aggLine(r.check)} | normalized ${pct(r.logo_normalized)} / ${pct(r.check_normalized)}`);
      }
    }
  } else {
    throw new Error(`unknown command "${cmd ?? ''}"\n${USAGE}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCommand(process.argv.slice(2)).catch(e => { console.error(String(e.message ?? e)); process.exit(1); });
}
