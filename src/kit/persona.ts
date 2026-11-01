// persona/2: the portable persona file (schema/persona-2.schema.json). Validated on every load and save, versioned
// on disk, and turned into the engine's run-time persona for one run by toEngine().
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import type { Dim, Limit, PersonaFile } from '../persona/build.ts';

export const LIMIT_KEYS = ['first_tap_s', 'action_gap_s', 'read_share', 'read_ms_per_char', 'error_rate', 'idle_per_min', 'sour_after_fails', 'reflex_miss'] as const;
export const DRIVES = ['speed', 'mastery', 'creativity', 'competition', 'collection', 'story', 'exploration', 'showing', 'nurturing', 'grind'] as const;
export type LimitKey = typeof LIMIT_KEYS[number];
export type Drive = typeof DRIVES[number];
export type Basis = 'measured' | 'self-report' | 'guess' | 'norm' | 'default';
export type LimitV2 = { value: number | null; lo?: number | null; hi?: number | null; n?: number; basis: Basis; sources: string[]; per_game?: Record<string, number> };
export type DriveV2 = { pull: number; basis: Basis; why: string };
export type TraitV2 = { value: number; basis: Basis; why: string };
export type Source = { type: 'recorder' | 'events' | 'survey' | 'profile' | 'description' | 'group' | 'converted'; path?: string; read_at: string; summary: string };
export type Consent = { required: boolean; basis: 'self' | 'parent' | 'participant' | 'none'; confirmed_at: string | null; note?: string };
export type Persona2 = {
  schema: 'persona/2'; name: string; slug: string; version: number; kind: 'person' | 'group' | 'described'; built: string;
  age: number | null; adult: boolean; who: string;
  limits: Partial<Record<LimitKey, LimitV2>>;
  drives: Partial<Record<Drive, DriveV2>>;
  traits?: Record<string, TraitV2>;
  members?: { label: string; persona: Persona2 }[];
  card: { who: string; plays_like: string; plays_for: string };
  provenance: { sources: Source[]; consent: Consent };
  validation?: Record<string, unknown> | null;
  caveats: string[];
};

const SCHEMA_PATH = resolve(import.meta.dirname, '..', '..', 'schema', 'persona-2.schema.json');
let validator: ((x: unknown) => boolean) & { errors?: { instancePath: string; message?: string }[] | null } | null = null;
async function getValidator() {
  if (!validator) {
    const ajv = new (Ajv2020 as any)({ allErrors: true, strict: false });
    validator = ajv.compile(JSON.parse(await readFile(SCHEMA_PATH, 'utf8')));
  }
  return validator!;
}

// Schema plus the rules a schema can't say: consent for real people, no quoted speech, a group has members.
export async function validatePersona(p: unknown): Promise<string[]> {
  const v = await getValidator();
  const errs = v(p) ? [] : (v.errors ?? []).map(e => `${e.instancePath || '/'} ${e.message}`);
  const q = p as Persona2;
  if (!errs.length) {
    if (q.kind !== 'described' && !q.provenance.consent.confirmed_at) errs.push('/provenance/consent a real person needs consent confirmed before a persona is built');
    if (q.kind !== 'described' && q.age != null && q.age < 13 && q.provenance.consent.basis !== 'parent') errs.push('/provenance/consent under 13 needs a parent\'s consent');
    if (q.kind === 'group' && !(q.members?.length)) errs.push('/members a group needs members');
    for (const [k, d] of Object.entries(q.drives)) if (/["“”]/.test(d!.why)) errs.push(`/drives/${k}/why quotes someone; paraphrase it`);
  }
  return errs;
}

export async function assertPersona(p: unknown): Promise<Persona2> {
  const errs = await validatePersona(p);
  if (errs.length) throw Object.assign(new Error(`not a valid persona/2:\n  ${errs.join('\n  ')}`), { status: 400 });
  return p as Persona2;
}

// ---- store: personas/<slug>/persona.json, earlier versions in versions/ --------------------------------------
export async function savePersona(dir: string, p: Persona2): Promise<string> {
  await assertPersona(p);
  const d = join(dir, p.slug), f = join(d, 'persona.json');
  await mkdir(join(d, 'versions'), { recursive: true });
  if (existsSync(f)) {
    const prev = JSON.parse(await readFile(f, 'utf8')) as Persona2;
    await writeFile(join(d, 'versions', `v${prev.version}.json`), JSON.stringify(prev, null, 2));
    p = { ...p, version: Math.max(p.version, prev.version + 1) };
  }
  await writeFile(f, JSON.stringify(p, null, 2));
  return f;
}

export async function loadPersona(pathOrSlug: string, dir = 'personas'): Promise<Persona2> {
  const f = existsSync(pathOrSlug) ? pathOrSlug : join(dir, pathOrSlug, 'persona.json');
  return assertPersona(JSON.parse(await readFile(f, 'utf8')));
}

export async function listPersonas(dir = 'personas'): Promise<Persona2[]> {
  if (!existsSync(dir)) return [];
  const out: Persona2[] = [];
  for (const s of await readdir(dir)) {
    const f = join(dir, s, 'persona.json');
    if (existsSync(f)) try { out.push(await loadPersona(f)); } catch { /* listed by `persona validate` instead */ }
  }
  return out;
}

// ---- run time ---------------------------------------------------------------------------------------------
// Pick one whole member of a group by seed (a hash, so neighbouring seeds spread across members).
export function pickMember(n: number, seed: number): number {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) % n;
}

const TRAIT_KEYS = ['skill', 'exploration_drive', 'pace', 'recovery', 'persistence', 'reading', 'challenge_appetite', 'learning_rate', 'stamina', 'confusion_resolves', 'frustration_tolerance'];

// persona/2 -> the engine's run-time persona for one target. A limit uses the target game's own measured value,
// else the named similar game's (limitsGame), else the persona's overall value; anything still missing is filled
// by the compiler from published norms by age. `used` says which, for the run log.
export function toEngine(p: Persona2, o: { letter: string; target: string; limitsGame?: string; seed?: number }): { persona: PersonaFile; used: Record<string, string>; member?: string } {
  if (p.kind === 'group') {
    const i = pickMember(p.members!.length, o.seed ?? 7), m = p.members![i];
    const r = toEngine(m.persona, o);
    r.persona.who = `one member of ${p.name}, ${m.persona.who}`;
    r.persona.blend = { name: p.name, member: m.label, id: m.persona.slug, index: i + 1, of: p.members!.length };
    return { ...r, member: m.label };
  }
  const used: Record<string, string> = {};
  const limits = {} as Record<string, Limit>;
  for (const k of LIMIT_KEYS) {
    const l = p.limits[k];
    let v: number | null = null, why = 'norm (filled by age at compile)';
    if (l?.per_game?.[o.target] != null) { v = l.per_game[o.target]; why = `${l.basis} on ${o.target}`; }
    else if (o.limitsGame && l?.per_game?.[o.limitsGame] != null) { v = l.per_game[o.limitsGame]; why = `${l.basis}, borrowed from ${o.limitsGame}`; }
    else if (l?.value != null) { v = l.value; why = `${l.basis}, overall`; }
    limits[k] = { value: v, ratio: null, lo: l?.lo ?? null, hi: l?.hi ?? null, from: v == null ? [] : [why] };
    used[k] = why;
  }
  const dimensions: Record<string, Dim> = {};
  for (const k of TRAIT_KEYS) {
    const t = p.traits?.[k];
    dimensions[k] = t && t.value !== 0
      ? { value: t.value, lo: null, hi: null, n: 0, sources: [t.basis], distinguishable: true, note: t.why }
      : { value: null, lo: null, hi: null, n: 0, sources: [], distinguishable: false };
  }
  const persona: PersonaFile = {
    schema: 'persona/1', letter: o.letter, age: p.age, target_game: o.target, built: p.built, who: p.who, adult: p.adult,
    observer: { kid_checked_clips: 0, kid_vs_muse_kappa: null, muse_self_agreement: null, note: p.caveats.join(' ') },
    dimensions, distinguishable: `${Object.values(dimensions).filter(d => d.distinguishable).length} traits set`,
    limits: limits as PersonaFile['limits'],
    drives: Object.entries(p.drives).map(([drive, d]) => ({ drive, pull: d!.pull, evidence: `${d!.basis}: ${d!.why}` })).sort((a, b) => b.pull - a.pull),
    card: { plays_for: p.card.plays_for, keeps_going: '', quits_when: '' },
  };
  return { persona, used };
}

export const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'persona';
