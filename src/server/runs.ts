// Data for the runs page (public/runs.html): persona runs from src/agent/play.ts, step by step.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isValidSessionId } from './ids.ts';

const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
const readJson = async <T>(f: string): Promise<T | null> => { try { return JSON.parse(await readFile(f, 'utf8')) as T; } catch { return null; } };

export async function listRuns(root: string) {
  const out = [];
  for (const id of (await readdir(root)).sort().reverse()) {
    if (!isValidSessionId(id)) continue;
    const s = await readJson<{ kid?: string; game?: string; round?: string }>(join(root, id, 'session.json'));
    if (s?.round !== 'agent') continue;
    const sum = await readJson<Record<string, unknown>>(join(root, id, 'summary.json'));
    const p = await readJson<{ persona?: { age?: number; observer?: { note?: string } } }>(join(root, id, 'persona.json'));
    out.push({ id, persona: String(s.kid ?? '').toUpperCase(), game: s.game ?? '', age: p?.persona?.age ?? null, described: /^Described/.test(p?.persona?.observer?.note ?? ''), steps: sum?.steps ?? null });
  }
  return out;
}

export async function runData(root: string, id: string) {
  if (!isValidSessionId(id)) throw fail(400, 'bad session id');
  const p = await readJson<any>(join(root, id, 'persona.json'));
  if (!p) throw fail(404, 'not a persona run');
  let steps: unknown[] = [];
  try { steps = (await readFile(join(root, id, 'steps.jsonl'), 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { /* none yet */ }
  const summary = await readJson(join(root, id, 'summary.json'));
  const { persona, compiled, rules } = p;
  return { id, letter: persona.letter, age: persona.age, game: persona.target_game, distinguishable: persona.distinguishable, observer: persona.observer.note,
    card: persona.card, drives: persona.drives.slice(0, 4), rules, harness: compiled.harness, steps, summary };
}

export function shotPath(root: string, id: string, file: string): string {
  if (!isValidSessionId(id) || !/^\d{3}\.jpg$/.test(file)) throw fail(404, 'not found');
  return join(root, id, 'shots', file);
}
