// A saved persona file (persona/2-draft, e.g. one built from a person's own play plus profile facts) -> the
// engine's PersonaFile for one run. Limits are the person's numbers on `limitsGame`: the game itself when they
// played it, else a similar one, which every run names (kit spec §7: limits borrowed from <game>).
import { readFile } from 'node:fs/promises';
import type { Limit, PersonaFile } from './build.ts';

type Draft = {
  schema: string; name: string; slug: string; kind: string; age?: number | null; adult?: boolean;
  limits: Record<string, { per_game?: Record<string, number>; value?: number | null } | null>;
  drives: Record<string, { pull: number; basis: string; why: string }>;
  card: { who: string; plays_like?: string; plays_for?: string };
  caveats?: string[];
};

const lim = (v: number | null | undefined, from: string): Limit => ({ value: v ?? null, ratio: null, lo: null, hi: null, from: v == null ? ['default'] : [from] });

export function draftToPersona(d: Draft, letter: string, target: string, limitsGame: string): PersonaFile {
  const pick = (k: string) => d.limits[k]?.per_game?.[limitsGame] ?? null;
  const limits = Object.fromEntries(['first_tap_s', 'action_gap_s', 'read_ms_per_char', 'read_share', 'error_rate', 'idle_per_min', 'reflex_miss']
    .map(k => [k, lim(pick(k), `${d.slug} on ${limitsGame}`)]));
  return {
    schema: 'persona/1', letter, age: d.age ?? null, target_game: target, built: new Date().toISOString(), who: `${d.name}: ${d.card.who}`, adult: d.adult ?? false,
    observer: { kid_checked_clips: 0, kid_vs_muse_kappa: null, muse_self_agreement: null, note: (d.caveats ?? []).join(' ') },
    dimensions: {}, distinguishable: 'none (one person, no group to compare against)',
    limits: { ...limits, sour_after_fails: lim(null, '') } as PersonaFile['limits'],
    // Profile facts only ever tilt drives, and only as guesses; none reaches the 0.6 a rule needs unless it was strong.
    drives: Object.entries(d.drives).map(([drive, v]) => ({ drive, pull: v.pull, evidence: `${v.basis}: ${v.why}` })).sort((a, b) => b.pull - a.pull),
    card: { plays_for: d.card.plays_for ?? '', keeps_going: '', quits_when: '' },
  } as PersonaFile;
}

export async function loadPersonaFile(path: string, letter: string, target: string, limitsGame: string): Promise<PersonaFile> {
  return draftToPersona(JSON.parse(await readFile(path, 'utf8')), letter, target, limitsGame);
}
