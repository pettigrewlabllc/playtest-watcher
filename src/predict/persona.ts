import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MetaClient } from '../meta/client.ts';
import { mmss } from '../watch/explain.ts';
import { loadSession } from './inputs.ts';
import type { Session } from './inputs.ts';
import { okMoments } from './rows.ts';
import { playerFingerprint } from './fingerprint.ts';
import type { PlayerFingerprint } from './fingerprint.ts';
import { playerDir } from './model.ts';
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

function dossier(fp: PlayerFingerprint, importances: Importance[], moments: string[]): string {
  return [
    'FINGERPRINT (mean over all sessions; null means no data):', JSON.stringify(fp.mean),
    'FINGERPRINT PER GAME:', JSON.stringify(fp.perGame),
    'SAID VS DID GAPS (said = questionnaire, did = behaviour, both -1..+1):', fp.gaps.length ? fp.gaps.map(g => g.note).join('\n') : '(none)',
    'TOP REACTION-MODEL FEATURES (what predicts this player\'s reactions):', importances.length ? importances.map(i => `${i.feature}: ${i.importance.toFixed(3)}`).join('\n') : '(model not trained yet)',
    `MOMENTS (up to ${MAX_MOMENTS}, highest confidence first; cite them by the id in brackets):`, moments.length ? moments.join('\n') : '(none)',
  ].join('\n');
}

export async function buildPersona(
  letter: string, sessionDirs: string[], client: MetaClient, o: Opts & { log?: (line: string) => void } = {},
): Promise<Persona> {
  const log = o.log ?? console.log;
  const sessions = await Promise.all(sessionDirs.map(loadSession));
  const fp = await playerFingerprint(letter, sessionDirs);
  const importances = await loadImportances(letter, o);
  const body = dossier(fp, importances, momentLines(sessions));

  const validMoments = new Set(sessions.flatMap(s => (s.moments ?? []).map(m => momentRef(s, m.id))));
  const validFields = new Set(Object.keys(fp.mean));
  const valid = (e: string) => validMoments.has(e) || validFields.has(e);

  const lenses = {} as Record<LensName, Observation[]>;
  let dropped = 0;
  for (const lens of LENSES) {
    const prompt = [
      `Player ${letter} is a child playing prototype games. ${lens.ask}`,
      'Every observation needs evidence: each evidence item must be either a moment id exactly as written in brackets below, or a fingerprint field name. Do not invent ids. Say only what the evidence supports.',
      `Fingerprint field names: ${[...validFields].join(', ')}.`,
      '', body,
    ].join('\n');
    const res = await client.respond<{ observations: Observation[] }>({
      model: MODEL, kind: `persona:${letter}:lens:${lens.name}`, schema: LENS_SCHEMA, maxOutputTokens: 4000,
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
    'Give tolerances as numbers: fail_streak is how many fails in a row before they sour, recovery_s is seconds from a fail to trying again, idle_before_bored_s is seconds of doing nothing before they are bored. Make tells concrete (what face, voice and hands do). In said_vs_did, call out where the questionnaire differs from play. In predictions_guidance, say in plain words what to expect and what not to expect. Every claim must come from the observations or the data; do not invent backstory or feelings.',
    '', 'EXPERT OBSERVATIONS (observations):', JSON.stringify(lenses), '', body,
  ].join('\n');
  const res = await client.respond<Omit<Persona, 'letter' | 'lenses' | 'dropped_observations'>>({
    model: MODEL, kind: `persona:${letter}:synthesis`, schema: PERSONA_SCHEMA, maxOutputTokens: 4000,
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
