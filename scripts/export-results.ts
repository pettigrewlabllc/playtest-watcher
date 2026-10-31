// npm run export-results -- <agent run id>...: copies the evidence behind the README into results/ (committed),
// scrubbed so it carries no child's name, age or words. recordings/ stays local; this is what a clone gets.
//   results/group/      limits, frozen-check scoreboard, Muse self-agreement, agent-vs-kid comparison
//   results/kid-check.json  per kid: clips checked, exact matches, same direction, kappa (numbers only)
//   results/spend.jsonl  every API call's cost
//   results/runs/<id>/   persona (rules and limits, no card), steps, summary, game events, a screenshot per step
// It refuses to write if a kid's name, or any stretch of a kid's interview words, would end up in a file.
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..');
const REC = join(REPO, 'recordings'), OUT = join(REPO, 'results');
const runs = process.argv.slice(2);
if (!runs.length) { console.error('usage: npm run export-results -- <agent run id>...'); process.exit(1); }

const readJson = async (f: string) => JSON.parse(await readFile(f, 'utf8'));
const kids = existsSync(join(REC, 'kids.json')) ? await readJson(join(REC, 'kids.json')) : {};
const names = Object.values<any>(kids).map(k => String(k?.name ?? '')).filter(n => n.length > 1);
const said: string[] = [];
for (const l of 'abcd') {
  const f = join(REC, 'kids', l, 'interview.json');
  if (!existsSync(f)) continue;
  const iv = await readJson(f);
  for (const t of [...iv.clips.flatMap((c: any) => c.said), ...iv.pitches.flatMap((p: any) => p.said), ...iv.games, ...iv.last]) said.push(String(t).toLowerCase());
}
const NEG = new Set(['confused', 'stuck', 'bored', 'frustrated']);

const written: string[] = [];
async function put(rel: string, text: string) {
  const lower = text.toLowerCase();
  for (const n of names) if (new RegExp(`\\b${n}\\b`, 'i').test(text)) throw new Error(`${rel} would carry a child's name; not written`);
  for (const s of said) for (let i = 0; i + 25 <= s.length; i += 5) {
    const piece = s.slice(i, i + 25);
    if (piece.trim().length >= 20 && lower.includes(piece)) throw new Error(`${rel} would carry a kid's own words ("${piece}"); not written`);
  }
  await mkdir(join(OUT, rel, '..'), { recursive: true });
  await writeFile(join(OUT, rel), text);
  written.push(rel);
}

await rm(OUT, { recursive: true, force: true });
for (const f of ['limits.json', 'stability.json', 'agent-vs-kid.json']) if (existsSync(join(REC, 'group', f))) await put(`group/${f}`, await readFile(join(REC, 'group', f), 'utf8'));
if (existsSync(join(REC, 'scoreboard.json'))) await put('group/scoreboard.json', await readFile(join(REC, 'scoreboard.json'), 'utf8'));

const check: Record<string, unknown> = {};
for (const l of 'abcd') {
  const f = join(REC, 'kids', l, 'interview.json');
  if (!existsSync(f)) continue;
  const iv = await readJson(f);
  const rated = iv.clips.filter((c: any) => c.kidLabel && c.museLabel);
  check[l.toUpperCase()] = {
    clips: rated.length, exact: rated.filter((c: any) => c.kidLabel === c.museLabel).length,
    same_direction: rated.filter((c: any) => NEG.has(c.kidLabel) === NEG.has(c.museLabel)).length, kappa: iv.agreement?.kappa ?? null,
    pairs: rated.map((c: any) => ({ kid: c.kidLabel, muse: c.museLabel })),
  };
}
await put('kid-check.json', JSON.stringify(check, null, 2));
await put('spend.jsonl', await readFile(join(REC, 'spend.jsonl'), 'utf8'));

for (const id of runs) {
  const src = join(REC, id);
  const s = await readJson(join(src, 'session.json'));
  if (s.round !== 'agent') throw new Error(`${id} is not a persona run (round ${s.round})`);
  const p = await readJson(join(src, 'persona.json'));
  const { card, drives, age, observer, ...rest } = p.persona;   // card and drive evidence quote the kid; age identifies them
  const persona = { ...rest, age: null, drives: drives.map((d: any) => ({ drive: d.drive, pull: d.pull })), observer: { ...observer, note: observer.note.startsWith('Described') ? observer.note : 'Measured from this kid\'s recorded play; moment labels are Muse\'s.' } };
  const rules = String(p.rules).replace(/, a child aged \d+/, '');
  await put(`runs/${id}/session.json`, JSON.stringify({ id, kid: s.kid, game: s.game, round: 'agent' }, null, 2));
  await put(`runs/${id}/persona.json`, JSON.stringify({ persona, compiled: p.compiled, rules }, null, 2));
  for (const f of ['steps.jsonl', 'summary.json', 'events.jsonl']) if (existsSync(join(src, f))) await put(`runs/${id}/${f}`, await readFile(join(src, f), 'utf8'));
  await mkdir(join(OUT, 'runs', id, 'shots'), { recursive: true });
  for (const f of (await readdir(join(src, 'shots'))).filter(f => /^\d{3}\.jpg$/.test(f))) await cp(join(src, 'shots', f), join(OUT, 'runs', id, 'shots', f));
}
console.log(`results/: ${written.length} files, ${runs.length} runs (screenshots are of the game only)`);
