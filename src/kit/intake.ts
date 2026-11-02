// The intake: who is this, consent first, what data do you have, then build, show the card, save. Interactive in a
// terminal (cli.ts) or from an answers file, so an agent can drive it by writing the answers the user gave.
import type { MetaClient } from '../meta/client.ts';
import { groupLimits, readDescription, toPersona } from '../persona/describe.ts';
import { fromEvents, fromProfile, fromRecorder, fromSurvey, mergeParts, type Partial2 } from './adapters.ts';
import { DRIVES, LIMIT_KEYS, loadPersona, slugify, type Drive, type LimitKey, type LimitV2, type Persona2, type TraitV2 } from './persona.ts';
import { readingWpm, reactionMs, tapMiss } from '../persona/norms.ts';

export type SourceAnswer =
  | { type: 'recorder'; root: string; letter: string }
  | { type: 'events'; path: string; map: string }
  | { type: 'survey'; path: string; map: string }
  | { type: 'profile'; path: string }
  | { type: 'description'; text: string };
export type Answers = {
  name: string; kind: 'person' | 'group' | 'described'; who?: string; age?: number | null; adult?: boolean;
  consent?: { basis: 'self' | 'parent' | 'participant'; confirmed: boolean; note?: string };
  sources?: SourceAnswer[];
  members?: string[];   // group: persona slugs or paths
};

const fail = (m: string) => Object.assign(new Error(m), { status: 400 });

// Consent is checked before any source is opened (kit spec §2).
export function checkConsent(a: Answers) {
  if (a.kind === 'described') return;
  if (!a.consent?.confirmed) throw fail(`${a.name} is a real ${a.kind === 'group' ? 'group' : 'person'}: confirm consent before any data is read`);
  if (a.kind === 'person' && a.age != null && a.age < 13 && a.consent.basis !== 'parent') throw fail('under 13 needs a parent\'s consent');
}

async function fromDescription(text: string, name: string, root: string, client: MetaClient): Promise<Partial2> {
  // Muse Wonder reads the sentence once (saved and reused); each game's limits are placed inside the range the
  // measured players showed on that game, so the same reading gives a per-game value everywhere.
  const letter = slugify(name).slice(0, 1).toUpperCase() || 'X';
  const saved = { answer: await readDescription(root, letter, text, client) };
  const L = await groupLimits(root);
  const games = Object.keys(L.per_game?.J ?? {});
  const limits: Partial2['limits'] = {};
  let first: ReturnType<typeof toPersona> | null = null;
  for (const g of games) {
    const p = toPersona(letter, g, saved.answer, L, text);
    first ??= p;
    for (const [k, l] of Object.entries(p.limits)) {
      if (l.value == null || !(LIMIT_KEYS as readonly string[]).includes(k)) continue;
      const cur = (limits[k as LimitKey] ??= { value: null, basis: 'guess', sources: ['description, placed in the measured players\' range'], per_game: {} });
      cur.per_game![g] = l.value;
    }
  }
  for (const l of Object.values(limits) as LimitV2[]) { const xs = Object.values(l.per_game!); l.value = xs.sort((a, b) => a - b)[xs.length >> 1]; }
  if (first?.limits.sour_after_fails?.value != null) limits.sour_after_fails = { value: first.limits.sour_after_fails.value, basis: 'guess', sources: ['description'] };
  const traits: Record<string, TraitV2> = {};
  for (const [k, d] of Object.entries(first?.dimensions ?? {})) if (d.distinguishable && d.value != null) traits[k] = { value: d.value, basis: 'guess', why: (d.note ?? '').replace(/^from the description: /, '') };
  const drives: Partial2['drives'] = {};
  for (const d of first?.drives ?? []) if ((DRIVES as readonly string[]).includes(d.drive) && d.pull !== 0) drives[d.drive as Drive] = { pull: d.pull, basis: 'guess', why: d.evidence.replace(/["“”]/g, '') };
  return { limits, drives, traits, age: first?.age ?? null, adult: (first?.age ?? 0) >= 18,
    notes: client.live ? [] : ['Built without a model key: this is the fake client\'s placeholder reading, not your description. Add --live for the real one.'],
    source: { type: 'description', read_at: new Date().toISOString(), summary: `one sentence, read once by Muse Wonder: ${text.slice(0, 120)}` } };
}

const fmt = (k: LimitKey, v: number | null | undefined) => v == null ? 'from norms'
  : k === 'idle_per_min' ? `${v.toFixed(1)}/min` : /share|rate|miss/.test(k) ? `${Math.round(v * 100)}%` : k === 'sour_after_fails' ? `${Math.round(v)} fails` : k === 'read_ms_per_char' ? `${Math.round(v)} ms/char` : `${v.toFixed(1)} s`;

export function playsLike(limits: Persona2['limits'], age: number | null): string {
  const L = limits;
  const bits = [
    `first tap ${fmt('first_tap_s', L.first_tap_s?.value)}`, `an action every ${fmt('action_gap_s', L.action_gap_s?.value)}`,
    `reads ${L.read_share?.value != null ? fmt('read_share', L.read_share.value) : 'a norm share'} of instructions`, `misses ${L.error_rate?.value != null ? fmt('error_rate', L.error_rate.value) : `${Math.round(tapMiss(age).rate * 100)}% (norm)`}`,
    `sours after ${L.sour_after_fails?.value != null ? fmt('sour_after_fails', L.sour_after_fails.value) : '3 fails (an assumption: no published number exists)'}`,
  ];
  return bits.join(', ') + '.';
}
export function playsFor(drives: Persona2['drives']): string {
  const top = Object.entries(drives).filter(([, d]) => d!.pull >= 0.3).sort((a, b) => b[1]!.pull - a[1]!.pull).slice(0, 3).map(([k, d]) => `${k} (${d!.basis})`);
  const off = Object.entries(drives).filter(([, d]) => d!.pull <= -0.3).map(([k]) => k);
  return (top.length ? `Plays for ${top.join(', ')}.` : 'No strong drive known.') + (off.length ? ` Put off by ${off.join(', ')}.` : '');
}

export async function buildPersona(a: Answers, o: { root: string; personasDir: string; client: MetaClient }): Promise<Persona2> {
  checkConsent(a);
  const slug = slugify(a.name), built = new Date().toISOString();
  const consent = a.kind === 'described' ? { required: false, basis: 'none' as const, confirmed_at: null }
    : { required: true, basis: a.consent!.basis, confirmed_at: built, ...(a.consent!.note ? { note: a.consent!.note } : {}) };

  if (a.kind === 'group') {
    const members = await Promise.all((a.members ?? []).map(async m => ({ label: m, persona: await loadPersona(m, o.personasDir) })));
    if (members.length < 2) throw fail('a group needs at least two member personas');
    for (const m of members) if (m.persona.kind === 'group') throw fail(`${m.label} is itself a group`);
    const limits: Persona2['limits'] = {};
    for (const k of LIMIT_KEYS) {
      const xs = members.map(m => m.persona.limits[k]?.value).filter((x): x is number => typeof x === 'number');
      if (xs.length) limits[k] = { value: xs.sort((p, q) => p - q)[xs.length >> 1], lo: Math.min(...xs), hi: Math.max(...xs), n: xs.length, basis: 'measured', sources: [`group middle of ${xs.length} of ${members.length} members (a run plays one whole member)`] };
    }
    const drives: Persona2['drives'] = {};
    for (const d of DRIVES) {
      const xs = members.map(m => m.persona.drives[d]?.pull).filter((x): x is number => typeof x === 'number');
      if (xs.length) drives[d] = { pull: xs.sort((p, q) => p - q)[xs.length >> 1], basis: 'self-report', why: `group middle of ${xs.length} members` };
    }
    return {
      schema: 'persona/2', name: a.name, slug, version: 1, kind: 'group', built, age: null, adult: false, who: a.who ?? `a group of ${members.length}`,
      limits, drives, members,
      card: { who: a.who ?? `${a.name}: ${members.length} members`, plays_like: `Middle of the group: ${playsLike(limits, null)}`, plays_for: playsFor(drives) },
      provenance: { sources: [{ type: 'group', read_at: built, summary: `${members.length} member personas: ${members.map(m => m.persona.slug).join(', ')}` }], consent },
      validation: null,
      caveats: [members.length < 5 ? `Small group (${members.length}): close to a copy of one member; don't share it.` : `${members.length} members; shareable inside the group.`,
        'Each run plays one whole member, picked by the seed; the middle is for the card only.'],
    };
  }

  const parts: Partial2[] = [];
  for (const s of a.sources ?? []) {
    if (s.type === 'recorder') parts.push(await fromRecorder(s.root, s.letter));
    else if (s.type === 'events') parts.push(await fromEvents(s.path, s.map));
    else if (s.type === 'survey') parts.push(await fromSurvey(s.path, s.map));
    else if (s.type === 'profile') parts.push(await fromProfile(s.path));
    else if (s.type === 'description') parts.push(await fromDescription(s.text, a.name, o.root, o.client));
  }
  if (!parts.length) throw fail('no data: give at least one source');
  const m = mergeParts(parts);
  const age = a.age ?? m.age ?? null, adult = a.adult ?? m.adult;
  const caveats = [...parts.flatMap(p => p.notes ?? [])];
  if (a.kind === 'person') caveats.push('One person: no traits (they are differences from a group); limits and drives only.');
  if (parts.some(p => p.source.type === 'description')) caveats.push('Described, not measured: placed inside the range of the measured players (four school-age kids), never past it.');
  if (parts.some(p => p.source.type === 'profile')) caveats.push('Profile facts are guesses about drives; they never set how fast it plays.');
  const missing = LIMIT_KEYS.filter(k => m.limits[k]?.value == null);
  if (missing.length) caveats.push(`From published norms by age at run time: ${missing.join(', ')} (reaction ${reactionMs(adult && age == null ? 27 : age).ms} ms, reading ${readingWpm(age).wpm} wpm).`);
  const who = a.who ?? (a.kind === 'described' ? (a.sources?.find(s => s.type === 'description') as { text: string } | undefined)?.text ?? a.name : a.name);
  return {
    schema: 'persona/2', name: a.name, slug, version: 1, kind: a.kind, built, age, adult, who,
    limits: m.limits, drives: m.drives, ...(a.kind === 'described' && Object.keys(m.traits).length ? { traits: m.traits } : {}),
    card: { who, plays_like: playsLike(m.limits, age), plays_for: playsFor(m.drives) },
    provenance: { sources: parts.map(p => p.source), consent },
    validation: null, caveats,
  };
}

export function renderCard(p: Persona2): string {
  const lines = [
    `${p.name}  (${p.kind}, v${p.version}${p.age != null ? `, age ${p.age}` : p.adult ? ', adult' : ''})`,
    `  ${p.card.who}`, `  Plays like: ${p.card.plays_like}`, `  ${p.card.plays_for}`, '  Numbers:',
    ...LIMIT_KEYS.map(k => { const l = p.limits[k]; return `    ${k.padEnd(17)} ${l ? `${fmt(k, l.value)}${l.lo != null && l.hi != null && l.lo !== l.hi ? ` (${fmt(k, l.lo)} to ${fmt(k, l.hi)})` : ''}  [${l.basis}${l.n ? `, n=${l.n}` : ''}]` : 'from norms by age'}`; }),
    ...(p.traits && Object.keys(p.traits).length ? [`  Traits: ${Object.entries(p.traits).map(([k, t]) => `${k} ${t.value > 0 ? 'high' : 'low'} (${t.why})`).join('; ')}`] : []),
    ...(p.members ? [`  Members: ${p.members.map(m => m.label).join(', ')}`] : []),
    `  Built from: ${p.provenance.sources.map(s => s.summary).join(' | ')}`,
    `  Consent: ${p.provenance.consent.basis}${p.provenance.consent.confirmed_at ? ` (${p.provenance.consent.confirmed_at.slice(0, 10)})` : ''}`,
    `  Validation: ${p.validation ? JSON.stringify(p.validation) : 'not validated'}`,
    ...p.caveats.map(c => `  - ${c}`),
  ];
  return lines.join('\n');
}
