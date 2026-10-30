import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MetaClient } from '../meta/client.ts';
import { mmss } from '../watch/explain.ts';
import { loadSession } from './inputs.ts';
import type { Session } from './inputs.ts';
import { loadDebriefs, okMoments, resolveIntents } from './rows.ts';
import type { Debrief } from './rows.ts';
import { kidTraits, loadTraits } from './traits.ts';
import type { KidTraits, Trait, TraitsFile } from './traits.ts';
import { playerFingerprint } from './fingerprint.ts';
import type { PlayerFingerprint } from './fingerprint.ts';
import { playerDir, recordingsRoot } from './model.ts';
import type { Importance, Opts } from './model.ts';

export const MODEL = 'muse-wonder-1.0';
export const LENSES = [
  { name: 'game designer', ask: 'Read this player as a game designer. What hooks them and what loses them? How much difficulty do they tolerate before they sour? What do they ignore?' },
  { name: 'learning scientist', ask: 'Read this player as a learning scientist. How do they figure things out: by reading, by trying, by asking? How do they persist after failing? What does their recovery look like?' },
  { name: 'UX researcher', ask: 'Read this player as a UX researcher. Where do interfaces trip them up? What do they touch first on a new screen? What are their tells (face, voice, hands) when something is wrong?' },
] as const;
export type LensName = typeof LENSES[number]['name'];

export type Observation = { claim: string; evidence: string[] };
export type Persona = {
  letter: string; summary: string;
  tolerances: { fail_streak: number; recovery_s: number; idle_before_bored_s: number };
  reads: string; explores: string; delights: string[]; confuses: string[];
  tells: { stuck: string; bored: string; delighted: string };
  said_vs_did: string[]; predictions_guidance: string;
  lenses: Record<LensName, Observation[]>;
  dropped_observations: number;
};

const str = { type: 'string' };
const strs = { type: 'array', items: str };
export const LENS_SCHEMA = {
  name: 'lens',
  schema: {
    type: 'object', additionalProperties: false, required: ['observations'],
    properties: { observations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['claim', 'evidence'], properties: { claim: str, evidence: strs } } } },
  },
};
export const PERSONA_SCHEMA = {
  name: 'persona',
  schema: {
    type: 'object', additionalProperties: false,
    required: ['summary', 'tolerances', 'reads', 'explores', 'delights', 'confuses', 'tells', 'said_vs_did', 'predictions_guidance'],
    properties: {
      summary: str,
      tolerances: { type: 'object', additionalProperties: false, required: ['fail_streak', 'recovery_s', 'idle_before_bored_s'], properties: { fail_streak: { type: 'number' }, recovery_s: { type: 'number' }, idle_before_bored_s: { type: 'number' } } },
      reads: str, explores: str, delights: strs, confuses: strs,
      tells: { type: 'object', additionalProperties: false, required: ['stuck', 'bored', 'delighted'], properties: { stuck: str, bored: str, delighted: str } },
      said_vs_did: strs, predictions_guidance: str,
    },
  },
};

const MAX_MOMENTS = 40;
// The word is banned from everything we write; a model that uses it gets it replaced.
const scrub = (s: string) => s.replace(/personalit(y|ies)/gi, 'play style');

function momentRef(s: Session, id: string) { return `${s.id}:${id}`; }

function momentLines(sessions: Session[]): string[] {
  const all = sessions.flatMap(s => okMoments(s.moments).map(m => ({ s, m })));
  all.sort((a, b) => b.m.confidence - a.m.confidence);
  return all.slice(0, MAX_MOMENTS).map(({ s, m }) =>
    `[${momentRef(s, m.id)}] game=${s.meta.game} ${m.label} (confidence ${m.confidence.toFixed(2)}) at ${mmss(m.startMs)}`
    + ` | context: ${m.game_context} | face: ${m.evidence.face} | voice: ${m.evidence.voice} | hands: ${m.evidence.hands} | screen: ${m.evidence.screen}`);
}

async function loadImportances(letter: string, o: Opts): Promise<Importance[]> {
  try { return JSON.parse(await readFile(join(playerDir(letter, o), 'model', 'importances.json'), 'utf8')); } catch { return []; }
}

const f2 = (n: number | null | undefined) => (n == null ? '?' : Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2));
const range = (t: Trait) => `${f2(t.value)} [${f2(t.lo)}, ${f2(t.hi)}]`;

export const TRAIT_RULE = 'Every trait is an estimate with a 90% range. Do not call a trait high or low, strong or weak, when its range spans the group mean: for the top-level value (a difference from the other kids on the same game) that is 0; for a game, it is that game\'s group mean. With no other kid on a game there is no group: give the number, do not rank it. A trait with no data says nothing; leave it out.';

function traitLines(k: KidTraits | null): string[] {
  if (!k) return ['(not computed yet: run npm run predict -- traits)'];
  const out: string[] = [];
  for (const [name, t] of Object.entries(k.traits)) {
    const per = Object.entries(t.per_game ?? {}).filter(([, g]) => g.value != null).map(([game, g]) =>
      `${game} ${range(g)}${g.adjusted ? ` (group mean on ${game} ${f2(g.group_mean as number)})` : ' (no other kid on this game)'}`);
    if (t.value == null && !per.length) { out.push(`${name}: no data`); continue; }
    const top = t.value == null ? 'no comparison with other kids' : `${range(t)} vs the group (0 = the group mean), n=${t.n}`;
    out.push(`${name}: ${top}; per game: ${per.join('; ') || 'none'}. ${t.source}`);
  }
  for (const g of k.gaps) out.push(`said vs did (${g.axis} -> ${g.trait}): ${g.note}`);
  return out;
}

type Words = { said: string[]; mood: string[]; intents: string[] };

// Debriefs for these sessions only (a leave-one-game-out fold never sees the held-out game's answers).
function kidWords(sessions: Session[], debriefs: Debrief[], known: KidTraits['intents'] = []): Words {
  const ids = new Set(sessions.map(s => s.id));
  const games = new Set(sessions.map(s => s.meta.game));
  const mine = debriefs.filter(d => (d.session ? ids.has(d.session) : games.has(d.game)));
  const q = (x: string) => `"${String(x).replace(/"/g, "'")}"`;
  const said = mine.flatMap(d => d.answers.map(a => `${d.game}: asked ${q(a.q)}, said ${q(a.a)}${a.intent ? ` [intent: ${a.intent}]` : ''}`));
  const mood = sessions.flatMap(s => s.aligned.events.filter(e => e.type === 'operator_mood').map(e => `${s.meta.game}: ${String(e.data.mood ?? '')}`));
  const intents: string[] = [];
  for (const s of sessions) {
    const resolved = { ...Object.fromEntries(known.filter(k => k.session === s.id).map(k => [k.type, k.intent])), ...resolveIntents(mine, s.id, s.meta.game, s.aligned.events) };
    for (const [type, intent] of Object.entries(resolved)) {
      intents.push(`${s.meta.game}: the ${type} events were ${intent}, by the kid's own account${intent === 'accidental' ? ' (exploration drive already leaves them out)' : ''}`);
    }
    for (const d of mine.filter(x => x.session === s.id)) for (const a of d.answers) {
      if (a.intent && !a.event && !Object.keys(resolved).length) {
        intents.push(`${s.meta.game}: the kid called something ${a.intent} (${q(a.a)}) but no event type could be tied to it`);
      }
    }
  }
  return { said, mood, intents };
}

function dossier(fp: PlayerFingerprint, importances: Importance[], moments: string[], k: KidTraits | null = null, words: Words = { said: [], mood: [], intents: [] }): string {
  return [
    'TRAITS (computed from play by fixed estimators; cite a trait by its name):', ...traitLines(k), TRAIT_RULE,
    'SAID (the kid\'s own words in the debrief after each game, quoted; anything you take from here is what they said, not what they did):', words.said.length ? words.said.join('\n') : '(no debrief)',
    'MOOD TAPS (the operator\'s read of the kid just before each session):', words.mood.length ? words.mood.join('\n') : '(none)',
    'INTENT CORRECTIONS (what the kid said an event meant):', words.intents.length ? words.intents.join('\n') : '(none)',
    'FINGERPRINT (mean over all sessions; null means no data):', JSON.stringify(fp.mean),
    'FINGERPRINT PER GAME:', JSON.stringify(fp.perGame),
    'SAID VS DID GAPS (said = questionnaire, did = behaviour, both -1..+1):', fp.gaps.length ? fp.gaps.map(g => g.note).join('\n') : '(none)',
    'TOP REACTION-MODEL FEATURES (what predicts this player\'s reactions):', importances.length ? importances.map(i => `${i.feature}: ${i.importance.toFixed(3)}`).join('\n') : '(model not trained yet)',
    `MOMENTS (up to ${MAX_MOMENTS}, highest confidence first; cite them by the id in brackets):`, moments.length ? moments.join('\n') : '(none)',
  ].join('\n');
}

export async function buildPersona(
  letter: string, sessionDirs: string[], client: MetaClient, o: Opts & { log?: (line: string) => void; traits?: TraitsFile | null } = {},
): Promise<Persona> {
  const log = o.log ?? console.log;
  const sessions = await Promise.all(sessionDirs.map(loadSession));
  const fp = await playerFingerprint(letter, sessionDirs);
  const importances = await loadImportances(letter, o);
  const kid = kidTraits(o.traits === undefined ? await loadTraits({ root: recordingsRoot(o) }) : o.traits, letter);
  const words = kidWords(sessions, await loadDebriefs(recordingsRoot(o), letter), kid?.intents);
  const body = dossier(fp, importances, momentLines(sessions), kid, words);

  const validMoments = new Set(sessions.flatMap(s => (s.moments ?? []).map(m => momentRef(s, m.id))));
  const validFields = new Set(Object.keys(fp.mean));
  const validTraits = new Set(Object.keys(kid?.traits ?? {}).filter(n => kid!.traits[n].value != null || Object.values(kid!.traits[n].per_game ?? {}).some(g => g.value != null)));
  const valid = (e: string) => validMoments.has(e) || validFields.has(e) || validTraits.has(e);

  const lenses = {} as Record<LensName, Observation[]>;
  let dropped = 0;
  for (const lens of LENSES) {
    const prompt = [
      `Player ${letter} is a child playing prototype games. ${lens.ask}`,
      `Every observation needs evidence: each evidence item must be a moment id exactly as written in brackets below, a fingerprint field name, or a trait name. Do not invent ids. Say only what the evidence supports. When a claim rests on the kid\'s own words, say so ("they said..."). Call the child "they" or "Player ${letter}"; never guess their gender.`,
      `Fingerprint field names: ${[...validFields].join(', ')}.`,
      `Trait names: ${[...validTraits].join(', ') || '(none with data)'}.`,
      '', body,
    ].join('\n');
    // Muse Wonder reasons before it answers and the reasoning counts here; 4000 ran out before any JSON on real kids.
    const res = await client.respond<{ observations: Observation[] }>({
      model: MODEL, kind: `persona:${letter}:lens:${lens.name}`, schema: LENS_SCHEMA, maxOutputTokens: 16000,
      content: [{ type: 'input_text', text: prompt }],
    });
    const kept: Observation[] = [];
    for (const ob of res.data.observations ?? []) {
      const ev = Array.isArray(ob.evidence) ? ob.evidence : [];
      if (ev.length && ev.every(valid)) kept.push({ claim: scrub(String(ob.claim)), evidence: ev });
      else dropped++;
    }
    lenses[lens.name] = kept;
  }
  if (dropped) log(`persona ${letter}: dropped ${dropped} observation${dropped === 1 ? '' : 's'} with missing evidence`);

  const synth = [
    `Player ${letter} is a child playing prototype games. Three experts read their play. Combine the observations below into one persona that a forecaster can use to predict this child's reactions to a game they have not played.`,
    `Give tolerances as numbers: fail_streak is how many fails in a row before they sour, recovery_s is seconds from a fail to trying again, idle_before_bored_s is seconds of doing nothing before they are bored. Make tells concrete (what face, voice and hands do). In said_vs_did, call out where the questionnaire or the debrief differs from play, quoting their words. ` + TRAIT_RULE + ` In predictions_guidance, say in plain words what to expect and what not to expect. Every claim must come from the observations or the data; do not invent backstory or feelings. Call the child "they" or "Player ${letter}"; never guess their gender.`,
    '', 'EXPERT OBSERVATIONS (observations):', JSON.stringify(lenses), '', body,
  ].join('\n');
  const res = await client.respond<Omit<Persona, 'letter' | 'lenses' | 'dropped_observations'>>({
    model: MODEL, kind: `persona:${letter}:synthesis`, schema: PERSONA_SCHEMA, maxOutputTokens: 32000,   // synthesis used 12-14k on real kids; 16k left no margin
    content: [{ type: 'input_text', text: synth }],
  });
  const d = res.data;
  const persona: Persona = {
    letter, summary: scrub(d.summary), tolerances: d.tolerances, reads: scrub(d.reads), explores: scrub(d.explores),
    delights: d.delights.map(scrub), confuses: d.confuses.map(scrub),
    tells: { stuck: scrub(d.tells.stuck), bored: scrub(d.tells.bored), delighted: scrub(d.tells.delighted) },
    said_vs_did: d.said_vs_did.map(scrub), predictions_guidance: scrub(d.predictions_guidance),
    lenses, dropped_observations: dropped,
  };
  const dir = playerDir(letter, o);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'persona.json'), JSON.stringify(persona, null, 2));
  await writeFile(join(dir, 'persona.md'), renderPersonaMd(persona));
  return persona;
}

export function renderPersonaMd(p: Persona): string {
  const list = (xs: string[]) => (xs.length ? xs.map(x => `- ${x}`).join('\n') : '- (none)');
  const out = [
    `# Player ${p.letter}`, '', p.summary, '',
    '## Tolerances', `- Fails in a row before souring: ${p.tolerances.fail_streak}`, `- Seconds to try again after a fail: ${p.tolerances.recovery_s}`, `- Seconds idle before bored: ${p.tolerances.idle_before_bored_s}`, '',
    '## Reads and explores', `- Reading: ${p.reads}`, `- Exploring: ${p.explores}`, '',
    '## Delights', list(p.delights), '', '## Confuses', list(p.confuses), '',
    '## Tells', `- Stuck: ${p.tells.stuck}`, `- Bored: ${p.tells.bored}`, `- Delighted: ${p.tells.delighted}`, '',
    '## Said vs did', list(p.said_vs_did), '', '## Guidance for predictions', p.predictions_guidance, '',
    '## Expert lenses',
  ];
  for (const [name, obs] of Object.entries(p.lenses)) {
    out.push('', `### ${name}`, obs.length ? obs.map(o => `- ${o.claim} (${o.evidence.join(', ')})`).join('\n') : '- (no supported observations)');
  }
  return scrub(out.join('\n')) + '\n';
}
