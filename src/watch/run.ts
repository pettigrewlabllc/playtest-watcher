import { rm, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clientFromEnv, createMetaClient, type MetaClient } from '../meta/client.ts';
import { isValidSessionId } from '../server/ids.ts';
import { align } from './align.ts';
import { transcribe } from './transcribe.ts';
import { candidatesStage } from './candidates.ts';
import { explainStage } from './explain.ts';
import { fixesStage } from './fixes.ts';

export const STAGES = ['align', 'transcribe', 'candidates', 'explain', 'fixes'] as const;
export type Stage = (typeof STAGES)[number];

const OUTPUT: Record<Stage, string> = {
  align: 'aligned.json', transcribe: 'transcript.json', candidates: 'candidates.json', explain: 'moments.json', fixes: 'fixes.md',
};

async function exists(file: string): Promise<boolean> {
  try { await stat(file); return true; } catch { return false; }
}

export async function runWatch(
  dir: string, client: MetaClient, opts: { force?: Stage; log?: (line: string) => void } = {},
): Promise<{ ran: Stage[]; skipped: Stage[] }> {
  const log = opts.log ?? console.log;
  const ran: Stage[] = [];
  const skipped: Stage[] = [];
  const forceFrom = opts.force ? STAGES.indexOf(opts.force) : Infinity;

  for (const [i, stage] of STAGES.entries()) {
    const out = join(dir, OUTPUT[stage]);
    if (i >= forceFrom) await rm(out, { force: true });   // a forced stage invalidates everything after it
    if (await exists(out)) { skipped.push(stage); log(`${stage}: skipped (${OUTPUT[stage]} exists)`); continue; }

    let summary = '';
    if (stage === 'align') {
      const a = await align(dir);
      summary = `${Object.keys(a.tracks).length} video tracks, ${a.audio?.wavChunks.length ?? 0} audio chunks, ${a.events.length} events`;
    } else if (stage === 'transcribe') {
      const t = await transcribe(dir, client);
      summary = `${t.turns.length} turns`;
    } else if (stage === 'candidates') {
      const c = await candidatesStage(dir);
      summary = `${c.length} candidate windows`;
    } else if (stage === 'explain') {
      const m = await explainStage(dir, client);
      const bad = m.filter(x => x.status !== 'ok').length;
      summary = `${m.length} moments${bad ? `, ${bad} unanalyzed` : ''}`;
    } else {
      const md = await fixesStage(dir, client);
      summary = `${md.split('\n').filter(l => l.startsWith('## ')).length} fixes`;
    }
    ran.push(stage);
    log(`${stage}: ${summary}`);
  }
  log(`spend so far: $${(await client.spentUsd()).toFixed(2)}${client.live ? '' : ' (fake mode)'}`);
  return { ran, skipped };
}

function parseArgs(argv: string[]): { id?: string; force?: Stage; live: boolean } {
  let id: string | undefined;
  let force: Stage | undefined;
  let live = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--live') live = true;
    else if (a === '--force') {
      const s = argv[++i] as Stage;
      if (!STAGES.includes(s)) throw new Error(`--force needs one of: ${STAGES.join(', ')}`);
      force = s;
    } else if (!a.startsWith('--')) id = a;
  }
  return { id, force, live };
}

async function main(): Promise<void> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { id, force, live } = parseArgs(process.argv.slice(2));
  if (!id || !isValidSessionId(id)) throw new Error('usage: npm run watch -- <sessionId> [--force <stage>] [--live]');
  const dir = join(root, 'recordings', id);
  if (!(await exists(join(dir, 'manifest.json')))) throw new Error(`no manifest.json in ${dir}`);

  // Two keys on purpose: --live here, and PW_LIVE=1 plus MODEL_API_KEY in the environment.
  let client: MetaClient;
  if (live) {
    client = clientFromEnv(root);
    if (!client.live) console.warn('--live given but PW_LIVE=1 and MODEL_API_KEY are not both set; staying in fake mode');
  } else {
    client = createMetaClient({ live: false, budgetUsd: 0, spendLog: join(root, 'recordings', 'spend.jsonl') });
  }
  await runWatch(dir, client, { force });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(String(e.message ?? e)); process.exit(1); });
}
