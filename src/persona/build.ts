// persona.json (persona engine spec): dimensions on one scale with ranges and sources, behaviour limits for one
// target game built only from the kid's other games, what they play for, and how far to trust the observer.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export type Dim = { value: number | null; lo: number | null; hi: number | null; n: number; sources: string[]; distinguishable: boolean; note?: string };
export type Limit = { value: number | null; ratio: number | null; lo: number | null; hi: number | null; from: string[] };
export type PersonaFile = {
  schema: 'persona/1'; letter: string; age: number | null; target_game: string; built: string;
  observer: { kid_checked_clips: number; kid_vs_muse_kappa: number | null; muse_self_agreement: number | null; note: string };
  dimensions: Record<string, Dim>; distinguishable: string;
  limits: Record<string, Limit> & { sour_after_fails: Limit };
  drives: { drive: string; pull: number; evidence: string }[];
  card: { plays_for: string; keeps_going: string; quits_when: string };
};

const readJson = async <T>(f: string): Promise<T | null> => { try { return JSON.parse(await readFile(f, 'utf8')) as T; } catch { return null; } };
// Built on Muse's "bored", which kids contradicted on 3 of the 4 clips they checked.
const BORED_DERIVED = new Set(['challenge_appetite', 'stamina']);
const NOT_MEASURABLE = { time_pressure: 'timers come with the game (Factor Slicer and Hoard Keeper are timed, the others are not)', novelty_need: 'only Factor Slicer repeats levels' };

export async function buildPersonaFile(root: string, letter: string, target: string): Promise<PersonaFile> {
  const L = letter.toUpperCase(), l = letter.toLowerCase();
  const traits = await readJson<any>(join(root, 'group', 'traits.json'));
  const limits = await readJson<any>(join(root, 'group', 'limits.json'));
  const iv = await readJson<any>(join(root, 'kids', l, 'interview.json'));
  const stab = await readJson<any>(join(root, 'group', 'stability.json'));
  const kids = (await readJson<Record<string, { age?: number }>>(join(root, 'kids.json'))) ?? {};
  if (!traits?.kids?.[L]) throw new Error(`no traits for ${L}; run: npm run predict -- traits`);
  if (!limits?.held_out?.[L]?.[target]) throw new Error(`no limits for ${L} on ${target}; run: python analysis/limits.py`);

  const dimensions: Record<string, Dim> = {};
  for (const [name, t] of Object.entries<any>(traits.kids[L].traits)) {
    if (name === 'expressiveness') continue;   // observer-only: it calibrates the recording, not what the agent does
    const clear = t.value != null && t.lo != null && t.hi != null && (t.lo > 0 || t.hi < 0);
    dimensions[name] = { value: t.value, lo: t.lo, hi: t.hi, n: t.n ?? 0, sources: ['play', 'muse'], distinguishable: clear,
      ...(BORED_DERIVED.has(name) ? { note: 'low confidence: built on Muse "bored", which the kids contradicted on 3 of 4 checked clips' } : {}) };
  }
  for (const [name, why] of Object.entries(NOT_MEASURABLE)) dimensions[name] = { value: null, lo: null, hi: null, n: 0, sources: [], distinguishable: false, note: `not measurable with these games: ${why}` };

  // sour_after_fails: the kid's own fail-streak tolerance on their other games (k50), else the group's typical 3
  const ft = Object.entries<any>(traits.kids[L].traits.frustration_tolerance?.per_game ?? {}).filter(([g, v]) => g !== target && v.raw != null).map(([, v]) => v.raw as number);
  const sour: Limit = ft.length ? { value: Math.max(1, Math.round(ft.reduce((a, b) => a + b, 0) / ft.length)), ratio: null, lo: Math.min(...ft), hi: Math.max(...ft), from: ['frustration_tolerance'] }
    : { value: 3, ratio: null, lo: null, hi: null, from: ['default'] };

  const clips = (iv?.clips ?? []).filter((c: any) => c.kidLabel && c.museLabel);
  const clear = Object.entries(dimensions).filter(([, d]) => d.distinguishable).map(([n]) => n);
  return {
    schema: 'persona/1', letter: L, age: kids[L]?.age ?? kids[l]?.age ?? null, target_game: target, built: new Date().toISOString(),
    observer: { kid_checked_clips: clips.length, kid_vs_muse_kappa: iv?.agreement?.kappa ?? null, muse_self_agreement: stab?.agreement ?? null,
      note: 'Moment labels are Muse\'s. Muse agrees with itself often; the kids agreed with it far less, and it read quiet concentration as bored.' },
    dimensions, distinguishable: `${clear.length} of ${Object.values(dimensions).filter(d => d.value != null).length} measured dimensions are clearly different from the other kids${clear.length ? `: ${clear.join(', ')}` : ''}`,
    limits: { ...limits.held_out[L][target], sour_after_fails: sour },
    drives: [...(iv?.motivation?.drives ?? [])].sort((a: any, b: any) => b.pull - a.pull),
    card: { plays_for: iv?.motivation?.chasing ?? '', keeps_going: iv?.motivation?.keeps_going ?? '', quits_when: iv?.motivation?.quits_when ?? '' },
  };
}

export async function writePersonaFile(root: string, p: PersonaFile): Promise<string> {
  const dir = join(root, 'players', p.letter);
  await mkdir(dir, { recursive: true });
  const f = join(dir, `persona-${p.target_game}.json`);
  await writeFile(f, JSON.stringify(p, null, 2));
  return f;
}
