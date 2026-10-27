// Input shapes written by Plans 1 and 2. Copied from the Plan 2 doc so predict doesn't import watch code; reconcile at merge.
import { readFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';

export type Label = 'confused' | 'stuck' | 'bored' | 'frustrated' | 'delighted' | 'none';
export const LABELS: Label[] = ['confused', 'stuck', 'bored', 'frustrated', 'delighted', 'none'];

export type AlignedEvent = { ms: number; type: string; kind: string; data: Record<string, unknown> };
export type Aligned = {
  t0: number; durationMs: number;
  tracks: Partial<Record<'face' | 'hands' | 'screen', { mp4: string; offsetMs: number; width: number; height: number }>>;
  audio?: { wavChunks: { file: string; startMs: number }[]; offsetMs: number };
  events: AlignedEvent[];
  gameClockSkewMs?: number;
};
export type Moment = {
  id: string; startMs: number; endMs: number; triggers: string[]; label: Label; confidence: number;
  evidence: { face: string; voice: string; hands: string; screen: string };
  game_context: string; fix_hint: string; status: 'ok' | 'unanalyzed';
};
export type Transcript = {
  turns: { startMs: number; endMs: number; speaker: string; text: string; who: 'kid' | 'adult' | 'unknown' }[];
  kidSpeaker: string | null;
};
export type SessionMeta = { id?: string; kid: string; game: string; round: 'learn' | 'replay' | 'check' | 'reference' | string };
export type Questionnaire = { kid: string; answers: Record<string, string>; scores: Record<string, number | null> };

export type Session = {
  id: string; dir: string; meta: SessionMeta; aligned: Aligned;
  moments: Moment[] | null; transcript: Transcript | null;
};

async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; } catch { return null; }
}

// moments.json may be absent (events-only session); aligned.json is required.
export async function loadSession(dir: string): Promise<Session> {
  const aligned = await readJson<Aligned>(join(dir, 'aligned.json'));
  if (!aligned) throw new Error(`no aligned.json in ${dir}`);
  const meta = (await readJson<SessionMeta>(join(dir, 'session.json'))) ?? { kid: '?', game: 'unknown', round: 'learn' };
  const moments = await readJson<Moment[]>(join(dir, 'moments.json'));
  const transcript = await readJson<Transcript>(join(dir, 'transcript.json'));
  return { id: basename(dir), dir, meta, aligned, moments: Array.isArray(moments) ? moments : null, transcript };
}

// Session folders sit in recordings/<id>/, kid answers in recordings/kids/<letter>/.
export async function loadQuestionnaire(sessionDir: string, letter: string): Promise<Questionnaire | null> {
  const kids = join(dirname(sessionDir), 'kids');
  return (await readJson<Questionnaire>(join(kids, letter, 'questionnaire.json')))
    ?? (await readJson<Questionnaire>(join(kids, letter.toLowerCase(), 'questionnaire.json')));
}
