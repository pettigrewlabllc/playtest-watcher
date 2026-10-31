// Data for the runs page (public/runs.html): persona runs from src/agent/play.ts, step by step.
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isValidSessionId } from './ids.ts';

const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
const readJson = async <T>(f: string): Promise<T | null> => { try { return JSON.parse(await readFile(f, 'utf8')) as T; } catch { return null; } };

// Persona runs live in recordings/ while working and in results/runs/ once exported (that copy is committed,
// so a fresh clone shows runs with no key and no recordings).
export const runRoots = (root: string) => [root, join(root, '..', 'results', 'runs')];
const findRun = (root: string, id: string) => runRoots(root).map(r => join(r, id)).find(d => existsSync(join(d, 'persona.json')));

export async function listRuns(root: string) {
  const out = [];
  const seen = new Set<string>();
  for (const base of runRoots(root)) {
    let ids: string[] = [];
    try { ids = await readdir(base); } catch { continue; }
    for (const id of ids) {
      if (seen.has(id) || !isValidSessionId(id)) continue;
      const s = await readJson<{ kid?: string; game?: string; round?: string }>(join(base, id, 'session.json'));
      if (s?.round !== 'agent') continue;
      seen.add(id);
      const sum = await readJson<Record<string, unknown>>(join(base, id, 'summary.json'));
      const p = await readJson<{ persona?: { age?: number; observer?: { note?: string } } }>(join(base, id, 'persona.json'));
      out.push({ id, persona: String(s.kid ?? '').toUpperCase(), game: s.game ?? '', age: p?.persona?.age ?? null, described: /^Described/.test(p?.persona?.observer?.note ?? ''), steps: sum?.steps ?? null });
    }
  }
  return out.sort((x, y) => y.id.localeCompare(x.id));
}

export async function runData(root: string, id: string) {
  if (!isValidSessionId(id)) throw fail(400, 'bad session id');
  const dir = findRun(root, id);
  if (!dir) throw fail(404, 'not a persona run');
  const p = await readJson<any>(join(dir, 'persona.json'));
  if (!p) throw fail(404, 'not a persona run');
  let steps: unknown[] = [];
  try { steps = (await readFile(join(dir, 'steps.jsonl'), 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { /* none yet */ }
  const summary = await readJson(join(dir, 'summary.json'));
  const { persona, compiled, rules } = p;
  return { id, letter: persona.letter, age: persona.age, game: persona.target_game, distinguishable: persona.distinguishable, observer: persona.observer.note,
    card: persona.card, drives: persona.drives.slice(0, 4), rules, harness: compiled.harness, steps, summary };
}

export function shotPath(root: string, id: string, file: string): string {
  if (!isValidSessionId(id) || !/^\d{3}\.jpg$/.test(file)) throw fail(404, 'not found');
  return join(findRun(root, id) ?? join(root, id), 'shots', file);
}
