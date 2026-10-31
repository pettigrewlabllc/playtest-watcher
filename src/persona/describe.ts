// The third input (spec §7): a written description of a kid -> a persona file on the same scales as a measured
// one. Muse Wonder rates each trait and limit against "a typical kid in this study" on five steps; the steps are
// placed on the real kids' spread (median ratio to the reference run is typical, the kids' lowest and highest
// ratios are "less" and "more"), so a described kid stays inside, or just past, what real kids did.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MetaClient } from '../meta/client.ts';
import type { Dim, Limit, PersonaFile } from './build.ts';

export const DESCRIBE_DIMS = ['skill', 'exploration_drive', 'pace', 'recovery', 'persistence', 'reading', 'challenge_appetite', 'learning_rate', 'stamina', 'confusion_resolves', 'frustration_tolerance'] as const;
export const DESCRIBE_LIMITS = { first_tap_s: 'how long they look at a new screen before acting', action_gap_s: 'time between actions once going (more = slower)', read_share: 'how much of the instructions they read', error_rate: 'how often they tap or answer wrong', idle_per_min: 'how often they stop doing anything' } as const;
const DRIVES = ['speed', 'mastery', 'creativity', 'competition', 'collection', 'story', 'exploration', 'showing', 'nurturing', 'grind'];

const level = { type: 'integer', minimum: -2, maximum: 2 };
const SCHEMA = {
  name: 'described_persona',
  schema: {
    type: 'object', additionalProperties: false, required: ['age', 'dims', 'limits', 'patience', 'drives', 'plays_for', 'keeps_going', 'quits_when'],
    properties: {
      age: { type: ['integer', 'null'] },
      dims: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'level', 'because'], properties: { name: { type: 'string', enum: [...DESCRIBE_DIMS] }, level, because: { type: 'string' } } } },
      limits: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'level', 'because'], properties: { name: { type: 'string', enum: Object.keys(DESCRIBE_LIMITS) }, level, because: { type: 'string' } } } },
      patience: { type: ['integer', 'null'], minimum: 1, maximum: 8 },
      drives: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['drive', 'pull', 'because'], properties: { drive: { type: 'string', enum: DRIVES }, pull: { type: 'number' }, because: { type: 'string' } } } },
      plays_for: { type: 'string' }, keeps_going: { type: 'string' }, quits_when: { type: 'string' },
    },
  },
};

type Rated = { name: string; level: number; because: string };
type Answer = { age: number | null; dims: Rated[]; limits: Rated[]; patience: number | null; drives: { drive: string; pull: number; because: string }[]; plays_for: string; keeps_going: string; quits_when: string };

// Where each step of the scale sits, from the real kids' ratios to the reference run on the target game.
export function placeLevel(lv: number, ratios: number[]): number {
  const s = [...ratios].sort((a, b) => a - b);
  const mid = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  const lo = s[0], hi = s[s.length - 1];
  if (lv === 0) return mid;
  if (lv === -1) return lo;
  if (lv === 1) return hi;
  return lv < 0 ? lo - (mid - lo) * 0.5 : hi + (hi - mid) * 0.5;
}

export function toPersona(name: string, target: string, a: Answer, limitsJson: any, description: string): PersonaFile {
  const ref = limitsJson.per_game?.J?.[target] ?? {};
  const kids = Object.keys(limitsJson.held_out ?? {});
  const limits: Record<string, Limit> = {};
  for (const m of Object.keys(DESCRIBE_LIMITS)) {
    const ratios = kids.map(k => limitsJson.held_out[k][target]?.[m]?.ratio).filter((x: unknown): x is number => typeof x === 'number' && x > 0);
    const base = ref[m];
    const lv = a.limits.find(l => l.name === m)?.level ?? 0;
    if (!ratios.length || base == null) { limits[m] = { value: null, ratio: null, lo: null, hi: null, from: [] }; continue; }
    const r = Math.max(0.05, placeLevel(lv, ratios));
    const v = base * r;
    limits[m] = { value: m === 'read_share' || m === 'error_rate' ? Math.min(1, v) : v, ratio: r, lo: Math.min(...ratios), hi: Math.max(...ratios), from: [`description (${lv >= 0 ? '+' : ''}${lv})`] };
  }
  limits.read_ms_per_char = limits.read_ms_per_char ?? { value: null, ratio: null, lo: null, hi: null, from: [] };
  const dimensions: Record<string, Dim> = {};
  for (const n of DESCRIBE_DIMS) {
    const d = a.dims.find(x => x.name === n);
    dimensions[n] = d && d.level !== 0
      ? { value: d.level / 2, lo: null, hi: null, n: 0, sources: ['description'], distinguishable: true, note: `from the description: ${d.because}` }
      : { value: null, lo: null, hi: null, n: 0, sources: [], distinguishable: false, note: 'not in the description' };
  }
  const named = Object.entries(dimensions).filter(([, d]) => d.distinguishable).map(([k]) => k);
  return {
    schema: 'persona/1', letter: name, age: a.age, target_game: target, built: new Date().toISOString(),
    observer: { kid_checked_clips: 0, kid_vs_muse_kappa: null, muse_self_agreement: null, note: `Described, not measured: "${description.slice(0, 300)}"` },
    dimensions, distinguishable: `${named.length} traits set by the description${named.length ? `: ${named.join(', ')}` : ''}; nothing here was measured`,
    limits: { ...limits, sour_after_fails: { value: a.patience ?? 3, ratio: null, lo: null, hi: null, from: [a.patience ? 'description' : 'default'] } } as PersonaFile['limits'],
    drives: a.drives.filter(d => DRIVES.includes(d.drive)).map(d => ({ drive: d.drive, pull: Math.max(-1, Math.min(1, d.pull)), evidence: d.because })).sort((x, y) => y.pull - x.pull),
    card: { plays_for: a.plays_for, keeps_going: a.keeps_going, quits_when: a.quits_when },
  };
}

export async function describePersona(root: string, name: string, description: string, target: string, client: MetaClient): Promise<PersonaFile> {
  const limitsJson = JSON.parse(await readFile(join(root, 'group', 'limits.json'), 'utf8'));
  const prompt = [
    'A game developer describes a child they want to playtest a game as. Rate the child against a typical child aged 8 to 14 who playtested kids\' games, using only what the description says.',
    'Every rating is -2 (much less), -1 (less), 0 (typical, or not mentioned), +1 (more), +2 (much more). Only rate what the description supports; leave the rest out or at 0. "because" quotes or paraphrases the description.',
    `TRAITS (dims): ${DESCRIBE_DIMS.join(', ')}.`,
    `LIMITS: ${Object.entries(DESCRIBE_LIMITS).map(([k, v]) => `${k} = ${v}`).join('; ')}.`,
    'patience: how many fails in a row before they sour (1 to 8), or null if not mentioned.',
    `DRIVES (pull -1 puts them off, +1 pulls them in, only if mentioned): ${DRIVES.join(', ')}.`,
    'plays_for, keeps_going, quits_when: one plain sentence each from the description, or empty. age: a number if given.',
    'Call the child "they"; never guess their gender.',
    '', `DESCRIPTION: ${description}`,
  ].join('\n');
  const r = await client.respond<Answer>({ model: 'muse-wonder-1.0', kind: `describe:${name}`, schema: SCHEMA, maxOutputTokens: 16000, content: [{ type: 'input_text', text: prompt }] });
  return toPersona(name, target, r.data, limitsJson, description);
}
