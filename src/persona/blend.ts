// A group persona (kit spec §6, blended mode): one named persona built from several real people. The card shows
// the group's middle and spread; a run plays as ONE member's whole set of numbers, picked by the seed, so a run
// is always someone who exists, never a mix of a fast tapper's speed with a careful reader's reading. Every
// member counts once, however much they played.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { buildPersonaFile, normDrive, type PersonaFile } from './build.ts';
import { loadPersonaFile } from './load.ts';

export type Member = { id: string; kind: 'kid' | 'file'; file?: string; label: string };
export type Blend = {
  schema: 'blend/1'; name: string; slug: string; built: string; members: Member[];
  shareable: boolean;   // 5 or more members: can be shared inside the group (spec §6, §10)
  card: Record<string, Record<string, { median: number; lo: number; hi: number; n: number }>>;   // game -> limit -> spread
  drives: Record<string, { median: number; n: number }>;
};

const LIMITS = ['first_tap_s', 'action_gap_s', 'read_share', 'error_rate', 'idle_per_min'] as const;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const readJson = async (f: string) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return null; } };

export async function buildBlend(root: string, name: string, slug: string, members: Member[]): Promise<Blend> {
  const perGame = (await readJson(join(root, 'group', 'limits.json')))?.per_game ?? {};
  const games = [...new Set(members.flatMap(m => Object.keys(perGame[m.id] ?? {})))].sort();
  const card: Blend['card'] = {};
  for (const g of games) {
    card[g] = {};
    for (const k of LIMITS) {
      const xs = members.map(m => perGame[m.id]?.[g]?.[k]).filter((x): x is number => typeof x === 'number');
      if (xs.length) card[g][k] = { median: median(xs), lo: Math.min(...xs), hi: Math.max(...xs), n: xs.length };
    }
  }
  // Drives: kids' from their interview, a file member's from its own drives (guesses for a profile-built one).
  const pulls: Record<string, number[]> = {};
  for (const m of members) {
    const ds: { drive: string; pull: number }[] = m.kind === 'kid'
      ? (await readJson(join(root, 'kids', m.id.toLowerCase(), 'interview.json')))?.motivation?.drives ?? []
      : Object.entries((await readJson(m.file!))?.drives ?? {}).map(([drive, v]: [string, any]) => ({ drive, pull: v.pull }));
    for (const d of ds) (pulls[normDrive(d.drive)] ??= []).push(d.pull);
  }
  const drives = Object.fromEntries(Object.entries(pulls).map(([d, xs]) => [d, { median: Math.round(median(xs) * 100) / 100, n: xs.length }]));
  return { schema: 'blend/1', name, slug, built: new Date().toISOString(), members, shareable: members.length >= 5, card, drives };
}

export async function writeBlend(root: string, b: Blend) {
  const dir = join(root, 'players', b.slug.toUpperCase());
  await mkdir(dir, { recursive: true });
  const f = join(dir, `blend-${b.slug}.json`);
  await writeFile(f, JSON.stringify(b, null, 2));
  return f;
}

export function pickMember(b: Blend, seed: number): number {
  // A hash, not the step generator: neighbouring seeds through rng() landed on the same one or two members.
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) % b.members.length;
}

// One run of the group persona: the picked member's own persona, under the group's letter and name.
export async function blendPersona(root: string, b: Blend, seed: number, letter: string, target: string, limitsGame: string): Promise<PersonaFile> {
  const i = pickMember(b, seed), m = b.members[i];
  const p = m.kind === 'kid' ? await buildPersonaFile(root, m.id, limitsGame) : await loadPersonaFile(m.file!, letter, target, limitsGame);
  const who = m.kind === 'kid' ? `one member of ${b.name}, a child` : `one member of ${b.name}, ${p.who ?? 'an adult'}`;
  return { ...p, letter, target_game: target, who, blend: { name: b.name, member: m.label, id: m.id, index: i + 1, of: b.members.length } };
}
