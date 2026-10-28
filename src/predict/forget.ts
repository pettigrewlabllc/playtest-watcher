import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { loadStudy, saveStudy, sameKid } from './study.ts';

const REPO = resolve(import.meta.dirname, '..', '..');

// Deletes everything about one kid under the recordings root. Hashes already committed in docs/frozen-predictions.md
// stay: they are labels and digests only. Meta uploads for a session are deleted by the explain stage as it runs
// and expire after an hour, so none outlive it.
export async function forgetPlayer(root: string, letter: string, typed: [string, string]): Promise<string[]> {
  if (!/^[A-Za-z]$/.test(letter)) throw new Error(`player letter must be a single letter: "${letter}"`);
  if (typed[0] !== letter || typed[1] !== letter) throw new Error(`nothing removed: the letter has to be typed twice, exactly "${letter}"`);

  const study = await loadStudy(root);
  const removed: string[] = [];
  const drop = async (path: string) => {
    if (!(await stat(path).then(() => true, () => false))) return;
    await rm(path, { recursive: true, force: true });
    removed.push(path);
  };

  let names: string[] = [];
  try { names = await readdir(root); } catch { /* empty root */ }
  for (const name of names) {
    if (['kids', 'players', 'predictions', 'group'].includes(name)) continue;
    try {
      const meta = JSON.parse(await readFile(join(root, name, 'session.json'), 'utf8'));
      if (sameKid(String(meta.kid ?? ''), letter)) await drop(join(root, name));
    } catch { /* not a session folder */ }
  }
  for (const dir of ['kids', 'players']) {
    let kids: string[] = [];
    try { kids = await readdir(join(root, dir)); } catch { /* none */ }
    for (const k of kids) if (sameKid(k, letter)) await drop(join(root, dir, k));
  }

  // group/ pools every kid's rows and traits; it is rebuilt (npm run predict -- traits) without the forgotten kid
  await drop(join(root, 'group'));

  const labels = Object.entries(study.checks ?? {}).filter(([, c]) => sameKid(c.letter, letter)).map(([l]) => l);
  let preds: string[] = [];
  try { preds = await readdir(join(root, 'predictions')); } catch { /* none */ }
  for (const p of preds) {
    if (labels.includes(p) || p.toLowerCase().endsWith(`__${letter.toLowerCase()}`)) await drop(join(root, 'predictions', p));
  }

  for (const k of Object.keys(study.players)) if (sameKid(k, letter)) delete study.players[k];
  for (const l of labels) { delete study.frozen[l]; delete study.checks?.[l]; }
  await saveStudy(root, study);
  return removed;
}

async function main() {
  const letter = process.argv[2];
  if (!letter) throw new Error('usage: npm run forget -- <letter>');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const first = (await rl.question(`This deletes everything recorded for player ${letter}. Type the letter: `)).trim();
  const second = (await rl.question('Type it again: ')).trim();
  rl.close();
  const removed = await forgetPlayer(join(REPO, 'recordings'), letter, [first, second]);
  console.log(removed.length ? `Removed:\n${removed.map(p => `  ${p}`).join('\n')}` : 'Nothing found for that player.');
  console.log('Committed hashes in docs/frozen-predictions.md are digests only and were left as they are.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(String(e.message ?? e)); process.exit(1); });
}
