// Adapters: each kind of data a person can bring becomes the same partial persona (limits, drives, traits, with a
// basis on every number). The intake merges them: measured beats self-report beats guess, per number.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import YAML from 'yaml';
import type { Basis, Drive, DriveV2, LimitKey, LimitV2, Source, TraitV2 } from './persona.ts';
import { DRIVES } from './persona.ts';
import { normDrive } from '../persona/build.ts';

export type Partial2 = {
  limits: Partial<Record<LimitKey, LimitV2>>; drives: Partial<Record<Drive, DriveV2>>; traits?: Record<string, TraitV2>;
  age?: number | null; adult?: boolean; source: Source; notes?: string[];
};
const now = () => new Date().toISOString();
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
const readJson = async (f: string) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return null; } };

// ---- our recorder: sessions measured by analysis/limits.py, interviews, traits --------------------------------
export async function fromRecorder(root: string, letter: string): Promise<Partial2> {
  const L = letter.toUpperCase();
  const lim = (await readJson(join(root, 'group', 'limits.json')))?.per_game?.[L];
  if (!lim) throw Object.assign(new Error(`no measured play for ${L} in ${root}/group/limits.json (run analysis/limits.py)`), { status: 400 });
  const limits: Partial2['limits'] = {};
  for (const k of ['first_tap_s', 'action_gap_s', 'read_share', 'read_ms_per_char', 'error_rate', 'idle_per_min', 'reflex_miss'] as LimitKey[]) {
    const per = Object.fromEntries(Object.entries<any>(lim).filter(([, v]) => typeof v?.[k] === 'number').map(([g, v]) => [g, v[k]]));
    const xs = Object.values(per) as number[];
    if (xs.length) limits[k] = { value: median(xs), lo: Math.min(...xs), hi: Math.max(...xs), n: xs.length, basis: 'measured', sources: [`recorder: ${xs.length} game${xs.length > 1 ? 's' : ''}`], per_game: per };
  }
  const traits = (await readJson(join(root, 'group', 'traits.json')))?.kids?.[L]?.traits ?? {};
  const ft = Object.values<any>(traits.frustration_tolerance?.per_game ?? {}).map(v => v.raw).filter((x): x is number => typeof x === 'number');
  if (ft.length) limits.sour_after_fails = { value: Math.max(1, Math.round(median(ft)!)), lo: Math.min(...ft), hi: Math.max(...ft), n: ft.length, basis: 'measured', sources: ['recorder: fail streak before frustration, Muse-labelled video'] };
  // Interview drives, paraphrased: a kid's own words never leave the recorder.
  const iv = await readJson(join(root, 'kids', L.toLowerCase(), 'interview.json'));
  const drives: Partial2['drives'] = {};
  for (const d of iv?.motivation?.drives ?? []) {
    const k = normDrive(d.drive) as Drive;
    if ((DRIVES as readonly string[]).includes(k)) drives[k] = { pull: Math.max(-1, Math.min(1, d.pull)), basis: 'self-report', why: `their reaction to the ${k} game idea in the interview` };
  }
  const kids = (await readJson(join(root, 'kids.json'))) ?? {};
  const age = kids[L]?.age ?? kids[L.toLowerCase()]?.age ?? null;
  const games = Object.keys(lim);
  return { limits, drives, age, adult: age != null && age >= 18,
    source: { type: 'recorder', path: root, read_at: now(), summary: `${games.length} recorded games (${games.join(', ')})${iv ? ', an interview' : ''}` } };
}

// ---- any event log (CSV or JSONL) through a mapping file -------------------------------------------------------
// A column can be a list (first one present wins). `event` can also be a template ("{category}:{event_id}", with
// "{a|b}" for either column). A pattern is an event name, "*" a wildcard, or a list of either. A map can `extends`
// a preset (presets/*.map.yaml) and add or replace measures; with no map at all the preset is picked by columns.
type Col = string | string[];
type Pattern = string | string[];
export type Measure = { median_gap?: [Pattern, Pattern]; ratio?: [Pattern, Pattern]; rate_per_min?: Pattern; longest_streak_of?: Pattern; reset_on?: Pattern };
export type EventMap = {
  extends?: string; format?: string; detect?: string[][];
  time: Col; event: Col; session?: Col; player?: Col; member?: { column: string; value: string };
  time_unit?: 's' | 'ms' | 'us' | 'iso' | 'auto';
  measures: Partial<Record<LimitKey, Measure>>;
};
type Row = Record<string, string>;
export const PRESETS_DIR = join(import.meta.dirname, 'presets');
export const PRESETS = ['ga4', 'gameanalytics', 'unity'] as const;

function parseCsv(text: string): Row[] {
  const lines = text.replace(/\r/g, '').split('\n').filter(Boolean);
  const split = (l: string) => { const out: string[] = []; let cur = '', q = false; for (const c of l) { if (c === '"') q = !q; else if (c === ',' && !q) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out.map(s => s.trim()); };
  const head = split(lines[0]);
  return lines.slice(1).map(l => Object.fromEntries(split(l).map((v, i) => [head[i], v])));
}
// Nested JSON becomes dotted columns (data.category); GA4's [{key, value: {int_value: 1}}] lists become
// event_params.<key>. Other arrays stay as JSON text.
function flatten(o: Record<string, unknown>, pre = '', out: Row = {}): Row {
  for (const [k, v] of Object.entries(o)) {
    const key = pre + k;
    if (Array.isArray(v) && v.every(x => x && typeof x === 'object' && 'key' in x && 'value' in x)) {
      for (const x of v as { key: string; value: unknown }[]) {
        const val = x.value && typeof x.value === 'object' ? Object.values(x.value).find(y => y != null) : x.value;
        if (val != null) out[`${key}.${x.key}`] = String(val);
      }
    } else if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v as Record<string, unknown>, `${key}.`, out);
    else if (v != null) out[key] = typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
  return out;
}
export async function readRows(path: string): Promise<Row[]> {
  const t = await readFile(path, 'utf8');
  return path.endsWith('.csv') ? parseCsv(t) : t.split('\n').filter(l => l.trim()).map(l => flatten(JSON.parse(l)));
}
export async function readMap<T>(path: string): Promise<T> { const t = await readFile(path, 'utf8'); return (path.endsWith('.json') ? JSON.parse(t) : YAML.parse(t)) as T; }

// A mapping file, with `extends` resolved: the preset's columns, then this map's own fields, measures merged.
export async function loadEventMap(nameOrPath: string): Promise<EventMap> {
  const file = (PRESETS as readonly string[]).includes(nameOrPath) ? join(PRESETS_DIR, `${nameOrPath}.map.yaml`) : nameOrPath;
  const m = await readMap<EventMap>(file);
  if (!m.extends) return m;
  const base = await loadEventMap(m.extends);
  return { ...base, ...m, measures: { ...base.measures, ...m.measures } };
}

// Which standard export this is, from its columns; null if none matches.
export async function detectPreset(rows: Row[]): Promise<string | null> {
  const cols = new Set(rows.slice(0, 50).flatMap(r => Object.keys(r)));
  for (const p of PRESETS) {
    const m = await loadEventMap(p);
    if (m.detect?.some(set => set.every(c => cols.has(c)))) return p;
  }
  return null;
}

const pick = (r: Row, c: Col | undefined) => { for (const k of [c ?? []].flat()) if (r[k] != null && r[k] !== '') return r[k]; return undefined; };
const eventOf = (r: Row, c: Col) => typeof c === 'string' && c.includes('{')
  ? c.replace(/\{([^}]+)\}/g, (_, alts: string) => pick(r, alts.split('|')) ?? '').replace(/:+$/, '') : pick(r, c);   // no param, no trailing ":"
const matcher = (p: Pattern) => {
  const res = [p].flat().map(s => new RegExp(`^${s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`));
  return (e: string) => res.some(re => re.test(e));
};
const toSeconds = (v: string, unit: EventMap['time_unit']) => {
  if (unit === 'auto') { const x = Number(v); return Number.isFinite(x) ? (x > 1e14 ? x / 1e6 : x > 1e11 ? x / 1000 : x) : Date.parse(v) / 1000; }
  return unit === 'iso' ? Date.parse(v) / 1000 : unit === 'ms' ? Number(v) / 1000 : unit === 'us' ? Number(v) / 1e6 : Number(v);
};

// The players in an export, most events first.
export function playersIn(rows: Row[], map: EventMap): [string, number][] {
  const n = new Map<string, number>();
  for (const r of rows) { const p = pick(r, map.player); if (p != null) n.set(p, (n.get(p) ?? 0) + 1); }
  return [...n.entries()].sort((a, b) => b[1] - a[1]);
}

export function measureEvents(rows: Row[], map: EventMap, player?: string): { limits: Partial2['limits']; notes: string[]; events: Map<string, number> } {
  const unit = map.time_unit ?? 'ms';
  const evs = rows.filter(r => (!map.member || r[map.member.column] === map.member.value) && (player == null || pick(r, map.player) === player))
    .map(r => ({ t: toSeconds(pick(r, map.time) ?? '', unit), e: eventOf(r, map.event) ?? '', s: pick(r, map.session) ?? '_' }))
    .filter(x => Number.isFinite(x.t)).sort((a, b) => a.s.localeCompare(b.s) || a.t - b.t);
  const bySession = new Map<string, typeof evs>();
  for (const x of evs) (bySession.get(x.s) ?? bySession.set(x.s, []).get(x.s)!).push(x);
  const events = new Map<string, number>();
  for (const x of evs) events.set(x.e, (events.get(x.e) ?? 0) + 1);
  const limits: Partial2['limits'] = {}, notes: string[] = [];
  if ((unit === 's' || unit === 'auto') && evs.length && evs.every(x => Number.isInteger(x.t))) notes.push('times are whole seconds: too coarse for first tap and pace; use ms if the export has them');
  for (const [k, m] of Object.entries(map.measures) as [LimitKey, Measure][]) {
    let value: number | null = null, n = 0;
    if (m.median_gap) {
      const [a, b] = m.median_gap.map(matcher), gaps: number[] = [];
      for (const s of bySession.values()) for (let i = 0; i < s.length; i++) if (a(s[i].e)) { const j = s.findIndex((x, jj) => jj > i && b(x.e)); if (j > i) gaps.push(s[j].t - s[i].t); }
      value = median(gaps); n = gaps.length;
    } else if (m.ratio) {
      const [a, b] = m.ratio.map(matcher);
      const num = evs.filter(x => a(x.e)).length, den = evs.filter(x => b(x.e)).length;
      value = den ? num / den : null; n = den;
    } else if (m.rate_per_min) {
      const a = matcher(m.rate_per_min);
      const mins = [...bySession.values()].reduce((t, s) => t + (s.length ? (s[s.length - 1].t - s[0].t) / 60 : 0), 0);
      const c = evs.filter(x => a(x.e)).length;
      value = mins > 0 ? c / mins : null; n = c;
    } else if (m.longest_streak_of) {
      // A streak resets only on `reset_on` (a success), so taps and other events between fails don't break it.
      const fail = matcher(m.longest_streak_of), reset = m.reset_on ? matcher(m.reset_on) : null;
      const streaks = [...bySession.values()].map(s => { let best = 0, cur = 0; for (const x of s) { if (fail(x.e)) cur++; else if (!reset || reset(x.e)) cur = 0; best = Math.max(best, cur); } return best; }).filter(x => x > 0);
      value = median(streaks); n = streaks.length;
    }
    if (value == null) { notes.push(`${k}: no matching events, left to norms`); continue; }
    limits[k] = { value, n, basis: 'measured', sources: [`events: ${JSON.stringify(m)}`] };
  }
  return { limits, notes, events };
}

// What an agent needs to finish the mapping: the limits still on norms, and this export's own most common events.
const NEED: Partial<Record<LimitKey, string>> = {
  first_tap_s: 'median_gap: [<a new screen>, <a tap>]', action_gap_s: 'median_gap: [<a tap>, <a tap>]',
  error_rate: 'ratio: [<a wrong answer>, <any answer>]', idle_per_min: 'rate_per_min: <a pause or idle event>',
};
function mappingHint(preset: string, limits: Partial2['limits'], events: Map<string, number>): string | null {
  const open = (Object.keys(NEED) as LimitKey[]).filter(k => limits[k] == null);
  if (!open.length) return null;
  const top = [...events.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([e, n]) => `${e || '(blank)'} ${n}`).join(', ');
  return `${open.join(', ')} have no standard event in a ${preset} export, so they came from norms. This export's most common events: ${top}. `
    + `To measure them, write a map with "extends: ${preset}" and ${open.map(k => `${k}: { ${NEED[k]} }`).join('; ')} (see src/kit/presets/README.md).`;
}

const fail = (m: string) => Object.assign(new Error(m), { status: 400 });

// An export plus, optionally, a mapping file or preset name and which player in it. With neither, the preset is
// picked from the columns; an export with several players needs `player`.
export async function fromEvents(path: string, o: { map?: string; player?: string } = {}): Promise<Partial2> {
  const rows = await readRows(path);
  const preset = o.map ?? await detectPreset(rows);
  if (!preset) throw fail(`couldn't tell which export ${path} is (columns: ${Object.keys(rows[0] ?? {}).slice(0, 12).join(', ')}). Known: ${PRESETS.join(', ')}. For anything else write a mapping file; src/kit/presets/README.md shows how.`);
  const map = await loadEventMap(preset);
  let player = o.player;
  if (player == null && map.player && !map.member) {
    const ps = playersIn(rows, map);
    if (ps.length > 1) throw fail(`${path} has ${ps.length} players; a persona is one of them. Say which with player: <id>. Most events: ${ps.slice(0, 5).map(([p, n]) => `${p} (${n})`).join(', ')}`);
    player = ps[0]?.[0];
  }
  const { limits, notes, events } = measureEvents(rows, map, player);
  const kind = map.format ?? (o.map ? 'a mapping file' : preset);
  const hint = map.format ? mappingHint(map.format, limits, events) : null;
  return { limits, drives: {}, notes: [...notes, ...(hint ? [hint] : [])],
    source: { type: 'events', path, read_at: now(), summary: `${events.size ? [...events.values()].reduce((a, b) => a + b, 0) : 0} events${player ? ` from player ${player}` : ''}, read as ${kind}${o.map && !(PRESETS as readonly string[]).includes(o.map) ? ` (${o.map})` : ''}: ${Object.keys(limits).join(', ') || 'nothing measured'}` } };
}

// ---- survey answers -> drives (self-report) -----------------------------------------------------------------
export type SurveyMap = { member?: { column: string; value: string }; drives: Partial<Record<Drive, { field: string; scale: 'likert5' | 'likert7' | 'yesno' | '0-10' }>> };
const scaled = (v: string, s: SurveyMap['drives'][Drive] extends infer T ? T extends { scale: infer S } ? S : never : never): number | null => {
  if (s === 'yesno') return /^(y|yes|true|1)$/i.test(v) ? 0.5 : /^(n|no|false|0)$/i.test(v) ? -0.5 : null;
  const x = Number(v); if (!Number.isFinite(x)) return null;
  return s === 'likert5' ? (x - 3) / 2 : s === 'likert7' ? (x - 4) / 3 : (x - 5) / 5;
};
export async function fromSurvey(path: string, mapPath: string): Promise<Partial2> {
  const map = await readMap<SurveyMap>(mapPath);
  const rows = (await readRows(path)).filter(r => !map.member || r[map.member.column] === map.member.value);
  const drives: Partial2['drives'] = {};
  for (const [d, f] of Object.entries(map.drives) as [Drive, NonNullable<SurveyMap['drives'][Drive]>][]) {
    const xs = rows.map(r => scaled(r[f.field] ?? '', f.scale)).filter((x): x is number => x != null);
    if (xs.length) drives[d] = { pull: Math.max(-1, Math.min(1, median(xs)!)), basis: 'self-report', why: `survey question ${f.field} (${f.scale}), ${xs.length} answer${xs.length > 1 ? 's' : ''}` };
  }
  return { limits: {}, drives, source: { type: 'survey', path, read_at: now(), summary: `${rows.length} survey rows: ${Object.keys(drives).join(', ') || 'no drives'}` } };
}

// ---- profile facts (a person's own data download or ad-preference page) -> drive guesses --------------------
// Facts tilt drives only, as guesses, never how fast someone plays. Each keyword match adds 0.1, capped at 0.4.
// The table maps everyday interest words onto the ten drives (see docs/persona-norms.md for the drive models).
const PROFILE_WORDS: Record<Drive, RegExp> = {
  speed: /\b(racing|speed|action|sprint|esports?)\b/i,
  mastery: /\b(ai|artificial intelligence|programming|software|computation|math|chess|puzzles?|strategy|productivity|science|engineering|workout|fitness)\b/i,
  creativity: /\b(design|graphic|craft|crafting|art|drawing|music|building|interior|maker|diy|writing)\b/i,
  competition: /\b(sports?|soccer|football|basketball|competition|tournament|ranked|betting)\b/i,
  collection: /\b(collectibles?|antiques?|stamps|cards|trading|collecting)\b/i,
  story: /\b(comedy|movies?|tv|streaming|books?|novels?|stories|podcasts?|entertainment)\b/i,
  exploration: /\b(travel|travell?ers?|resorts?|cruise|hiking|outdoors|abroad|explor\w*)\b/i,
  showing: /\b(fashion|photography|camera|social media|influencers?|beauty|page admins?)\b/i,
  nurturing: /\b(parents?|parenting|pets?|family|gardening|kids?|toys|stuffed animals?)\b/i,
  grind: /\b(farming sims?|idle games|routine|habit|daily)\b/i,
};
export type ProfileFacts = { interests?: string[]; categories?: string[]; topics?: string[]; age?: number | null; adult?: boolean };
export function profileDrives(f: ProfileFacts): Partial2['drives'] {
  const items = [...(f.interests ?? []), ...(f.categories ?? []), ...(f.topics ?? [])];
  const drives: Partial2['drives'] = {};
  for (const d of DRIVES) {
    const hits = items.filter(s => PROFILE_WORDS[d].test(s));
    if (hits.length) drives[d] = { pull: Math.min(0.4, 0.1 * hits.length), basis: 'guess', why: `${hits.length} profile item${hits.length > 1 ? 's' : ''} about ${d}, e.g. ${hits.slice(0, 3).join('; ')}` };
  }
  return drives;
}
export async function fromProfile(path: string): Promise<Partial2> {
  const f = await readMap<ProfileFacts>(path);
  const drives = profileDrives(f);
  const n = (f.interests?.length ?? 0) + (f.categories?.length ?? 0) + (f.topics?.length ?? 0);
  return { limits: {}, drives, age: f.age ?? null, adult: f.adult ?? (f.age != null ? f.age >= 18 : undefined),
    source: { type: 'profile', path, read_at: now(), summary: `${n} profile facts: drive guesses for ${Object.keys(drives).join(', ') || 'nothing'}` } };
}

// ---- merge: per number, the strongest basis wins; ties average -------------------------------------------------
const RANK: Record<Basis, number> = { measured: 4, 'self-report': 3, guess: 2, norm: 1, default: 0 };
export function mergeParts(parts: Partial2[]) {
  const limits: Partial2['limits'] = {}, drives: Partial2['drives'] = {}, traits: Record<string, TraitV2> = {};
  for (const p of parts) {
    for (const [k, l] of Object.entries(p.limits) as [LimitKey, LimitV2][]) {
      const cur = limits[k];
      if (!cur || RANK[l.basis] > RANK[cur.basis]) limits[k] = l;
      else if (RANK[l.basis] === RANK[cur.basis] && l.value != null && cur.value != null) limits[k] = { ...cur, value: (cur.value + l.value) / 2, sources: [...cur.sources, ...l.sources], per_game: { ...cur.per_game, ...l.per_game } };
    }
    for (const [k, d] of Object.entries(p.drives) as [Drive, DriveV2][]) {
      const cur = drives[k];
      if (!cur || RANK[d.basis] > RANK[cur.basis]) drives[k] = d;
      else if (RANK[d.basis] === RANK[cur.basis]) drives[k] = { ...cur, pull: (cur.pull + d.pull) / 2, why: `${cur.why}; ${d.why}` };
    }
    Object.assign(traits, p.traits ?? {});
  }
  const age = parts.map(p => p.age).find(a => a != null) ?? null;
  const adult = parts.some(p => p.adult) || (age != null && age >= 18);
  return { limits, drives, traits, age, adult };
}
