// Reads a recorded interview back: what the kid tapped and said at each step, the kid's own word for each clip
// against Muse's label, and (live) a motivation profile from their answers. Writes kids/<letter>/interview.json.
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { MetaClient } from '../meta/client.ts';
import { align } from '../watch/align.ts';
import { transcribe } from '../watch/transcribe.ts';
import { listSessions, sameKid } from '../predict/study.ts';
import { cohenKappa } from '../predict/reliability.ts';
import { FEELINGS, PITCHES } from './script.ts';

type Ev = { ms: number; type: string; data?: Record<string, unknown> };
type Turn = { startMs: number; endMs: number; text: string; who: string };
export type Step = { step: string; item: string; fromMs: number; toMs: number; answer: string | null; kid: string[]; adult: string[] };
export type Motivation = { chasing: string; keeps_going: string; quits_when: string; drives: { drive: string; pull: number; evidence: string }[] };
export type Interview = {
  letter: string; session: string;
  clips: { session: string; id: string; museLabel: string; kidWord: string | null; kidLabel: string | null; said: string[] }[];
  pitches: { id: string; drive: string; answer: string | null; said: string[] }[];
  games: string[]; last: string[];
  agreement: { n: number; same: number; kappa: number | null };
  motivation?: Motivation;
};

// One window per step shown, from when it appeared to when the next one did; the last answer tapped wins.
export function stepsOf(events: Ev[], turns: Turn[], endMs: number): Step[] {
  const shown = events.filter(e => e.type === 'interview_step');
  const steps: Step[] = shown.map((e, i) => ({
    step: String(e.data?.step ?? ''), item: String(e.data?.item ?? ''), fromMs: e.ms, toMs: shown[i + 1]?.ms ?? endMs, answer: null, kid: [], adult: [],
  }));
  for (const e of events.filter(x => x.type === 'interview_answer')) {
    const s = [...steps].reverse().find(x => x.item === e.data?.item && x.fromMs <= e.ms);
    if (s) s.answer = String(e.data?.answer ?? '');
  }
  for (const t of turns) {
    const mid = (t.startMs + t.endMs) / 2;
    const s = steps.find(x => mid >= x.fromMs && mid < x.toMs);
    if (s) (t.who === 'kid' ? s.kid : s.adult).push(t.text);
  }
  return steps;
}

export function summarize(letter: string, session: string, steps: Step[], museLabels: Map<string, string>): Interview {
  const byItem = new Map<string, Step[]>();
  for (const s of steps) (byItem.get(s.item) ?? byItem.set(s.item, []).get(s.item)!).push(s);
  const said = (item: string) => (byItem.get(item) ?? []).flatMap(s => s.kid);
  const answer = (item: string) => [...(byItem.get(item) ?? [])].reverse().find(s => s.answer)?.answer ?? null;
  const clips = [...byItem.keys()].filter(k => k.startsWith('clip:')).map(item => {
    const [, sess, id] = item.split(':');
    const kidWord = answer(item);
    return { session: sess, id, museLabel: museLabels.get(`${sess}:${id}`) ?? '', kidWord, kidLabel: FEELINGS.find(f => f.word === kidWord)?.label ?? null, said: said(item) };
  });
  const pitches = PITCHES.map(p => ({ id: p.id, drive: p.drive, answer: answer(`pitch:${p.id}`), said: said(`pitch:${p.id}`) }));
  const rated = clips.filter(c => c.kidLabel && c.museLabel);
  return {
    letter, session, clips, pitches, games: said('games'), last: said('last'),
    agreement: { n: rated.length, same: rated.filter(c => c.kidLabel === c.museLabel).length, kappa: rated.length > 1 ? cohenKappa(rated.map(c => c.kidLabel!), rated.map(c => c.museLabel)) : null },
  };
}

const MOTIVATION_SCHEMA = {
  name: 'motivation',
  schema: {
    type: 'object', additionalProperties: false, required: ['chasing', 'keeps_going', 'quits_when', 'drives'],
    properties: {
      chasing: { type: 'string' }, keeps_going: { type: 'string' }, quits_when: { type: 'string' },
      drives: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['drive', 'pull', 'evidence'], properties: { drive: { type: 'string' }, pull: { type: 'number' }, evidence: { type: 'string' } } } },
    },
  },
};

async function motivation(iv: Interview, client: MetaClient): Promise<Motivation> {
  const q = (xs: string[]) => (xs.length ? xs.map(x => `"${x}"`).join(' ') : '(said nothing)');
  const lines = [
    `Player ${iv.letter} is a child who playtested games. After playing, they were interviewed. Say what they play for, using only their answers below.`,
    'GAME IDEAS (each one stands for a drive; their tap, then their words):',
    ...iv.pitches.map(p => `- drive ${p.drive}: "${PITCHES.find(x => x.id === p.id)!.text}" tapped ${p.answer ?? '(nothing)'}; said ${q(p.said)}`),
    `MOST AND LEAST FUN GAME, AND WHY: ${q(iv.games)}`,
    `WHICH IDEA THEY WOULD PICK FIRST: ${q(iv.last)}`,
    'WATCHING THEIR OWN CLIPS (what they said was going on):', ...iv.clips.map(c => `- they picked ${c.kidWord ?? '(nothing)'}; said ${q(c.said)}`),
    '',
    `Write chasing (what they play for), keeps_going (what keeps them playing) and quits_when (what makes them stop), each one or two plain sentences that quote their words. For drives, give every drive listed above a pull from -1 (puts them off) to 1 (pulls them in), with the evidence quoted. Say only what their answers support; a tap with no reason is weak evidence. Call the child "they" or "Player ${iv.letter}"; never guess their gender.`,
  ].join('\n');
  const r = await client.respond<Motivation>({ model: 'muse-wonder-1.0', kind: `interview:${iv.letter}:motivation`, schema: MOTIVATION_SCHEMA, maxOutputTokens: 16000, content: [{ type: 'input_text', text: lines }] });
  return r.data;
}

export async function readInterview(root: string, letter: string, client: MetaClient, o: { log?: (l: string) => void } = {}): Promise<Interview> {
  const log = o.log ?? console.log;
  // found from session.json alone: listSessions only lists aligned sessions, and a fresh interview isn't aligned yet
  let s: { id: string; dir: string } | undefined;
  for (const id of (await readdir(root)).sort()) {
    try {
      const meta = JSON.parse(await readFile(join(root, id, 'session.json'), 'utf8'));
      if (meta.round === 'interview' && sameKid(String(meta.kid ?? ''), letter)) s = { id, dir: join(root, id) };
    } catch { /* not a session folder */ }
  }
  if (!s) throw new Error(`no interview session for ${letter}; record one with round "interview"`);
  const aligned = existsSync(join(s.dir, 'aligned.json')) ? JSON.parse(await readFile(join(s.dir, 'aligned.json'), 'utf8')) : await align(s.dir);
  let turns: Turn[] = [];
  if (existsSync(join(s.dir, 'transcript.json'))) turns = JSON.parse(await readFile(join(s.dir, 'transcript.json'), 'utf8')).turns;
  else if (client.live) turns = (await transcribe(s.dir, client, { log })).turns as Turn[];
  else log(`interview ${letter}: no transcript yet (run with --live to transcribe); taps only`);

  const museLabels = new Map<string, string>();
  for (const x of await listSessions(root)) {
    try { for (const m of JSON.parse(await readFile(join(x.dir, 'moments.json'), 'utf8'))) if (m.status === 'ok') museLabels.set(`${x.id}:${m.id}`, m.label); } catch { /* not analyzed */ }
  }
  const iv = summarize(letter, s.id, stepsOf(aligned.events, turns, aligned.durationMs), museLabels);
  if (client.live && turns.length) iv.motivation = await motivation(iv, client);
  const dir = join(root, 'kids', letter.toLowerCase());
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'interview.json'), JSON.stringify(iv, null, 2));
  return iv;
}

export function interviewLine(iv: Interview): string {
  const a = iv.agreement;
  return `interview ${iv.letter}: the kid's own word matched Muse on ${a.same} of ${a.n} clips${a.kappa == null ? '' : ` (kappa ${a.kappa.toFixed(2)})`}; `
    + iv.clips.map(c => `${c.kidWord ?? '-'} vs ${c.museLabel}`).join(', ');
}
