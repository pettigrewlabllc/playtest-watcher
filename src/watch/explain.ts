import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MetaClient } from '../meta/client.ts';
import type { Aligned } from './align.ts';
import type { Candidate } from './candidates.ts';
import type { Transcript } from './transcribe.ts';
import { compositeClip } from './clips.ts';

export { compositeClip };
export const LABELS = ['confused', 'stuck', 'bored', 'frustrated', 'delighted', 'none'] as const;
export type Label = (typeof LABELS)[number];
export type Moment = {
  id: string; startMs: number; endMs: number; triggers: string[];
  label: Label; confidence: number;
  evidence: { face: string; voice: string; hands: string; screen: string };
  game_context: string; fix_hint: string; status: 'ok' | 'unanalyzed';
};

const str = { type: 'string' };
export const MOMENT_SCHEMA = {
  name: 'moment',
  schema: {
    type: 'object', additionalProperties: false,
    required: ['label', 'confidence', 'evidence', 'game_context', 'fix_hint'],
    properties: {
      label: { type: 'string', enum: [...LABELS] },
      confidence: { type: 'number' },
      evidence: { type: 'object', additionalProperties: false, required: ['face', 'voice', 'hands', 'screen'], properties: { face: str, voice: str, hands: str, screen: str } },
      game_context: str,
      fix_hint: str,
    },
  },
};

export function mmss(ms: number, tenths = false): string {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${String(m).padStart(2, '0')}:${tenths ? rest.toFixed(1).padStart(4, '0') : String(Math.floor(rest)).padStart(2, '0')}`;
}

export function buildPrompt(game: string, c: Candidate, aligned: Aligned, turns: Transcript['turns']): string {
  const rel = (ms: number) => `+${mmss(ms - c.startMs, true)}`;
  const talk = turns.filter(t => t.startMs < c.endMs && t.endMs > c.startMs)
    .map(t => `${rel(t.startMs)} ${t.who}: ${t.text}`);
  const events = aligned.events.filter(e => e.ms >= c.startMs && e.ms <= c.endMs)
    .map(e => `${rel(e.ms)} ${e.type} ${JSON.stringify(e.data)}`);
  return [
    `You are watching a child playtest a kids' game called "${game || 'unknown'}". The video has three panels side by side, left to right: the child's face, the child's hands on the device, and the game screen. The audio is the room microphone.`,
    `This clip is ${((c.endMs - c.startMs) / 1000).toFixed(1)} seconds long and was flagged for: ${c.triggers.join(', ')}. Times below are relative to the start of the clip.`,
    '',
    'What was said (kid is the player, adult is the facilitator):',
    talk.length ? talk.join('\n') : '(nothing)',
    '',
    'Game events:',
    events.length ? events.join('\n') : '(none)',
    '',
    'Pick the one label that best describes how the child felt during the clip:',
    '- confused: does not understand what something means or does',
    '- stuck: understands the goal but cannot find how to make progress',
    '- bored: attention drifting, nothing holding them',
    '- frustrated: wants to succeed and is annoyed at failing or at the game',
    '- delighted: clear enjoyment, surprise or pride',
    '- none: nothing notable',
    'Give a confidence from 0 to 1. Give evidence separately for the face, the voice, the hands and the screen (say "not visible" if a panel is black or silent). Say in game_context what the game was asking of the child at that moment. Write fix_hint as one line for the game developer: what to change so this does not happen. Leave fix_hint empty when the label is none.',
  ].join('\n');
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; } catch { return undefined; }
}

function unanalyzed(c: Candidate): Moment {
  return {
    id: c.id, startMs: c.startMs, endMs: c.endMs, triggers: c.triggers, label: 'none', confidence: 0,
    evidence: { face: '', voice: '', hands: '', screen: '' }, game_context: '', fix_hint: '', status: 'unanalyzed',
  };
}

export async function explainStage(dir: string, client: MetaClient, opts: { concurrency?: number } = {}): Promise<Moment[]> {
  const aligned = JSON.parse(await readFile(join(dir, 'aligned.json'), 'utf8')) as Aligned;
  const candidates = JSON.parse(await readFile(join(dir, 'candidates.json'), 'utf8')) as Candidate[];
  const transcript = await readJson<Transcript>(join(dir, 'transcript.json'));
  const session = await readJson<{ game?: string }>(join(dir, 'session.json'));
  const previous = (await readJson<Moment[]>(join(dir, 'moments.json'))) ?? [];
  const done = new Map(previous.filter(m => m.status === 'ok').map(m => [m.id, m]));

  const results: Moment[] = new Array(candidates.length);
  let next = 0;

  async function one(c: Candidate): Promise<Moment> {
    const prev = done.get(c.id);
    if (prev && prev.startMs === c.startMs && prev.endMs === c.endMs) return prev;
    let fileId: string | undefined;
    try {
      const clip = join(dir, 'clips', `${c.id}.mp4`);
      await compositeClip(dir, aligned, c, clip);
      fileId = await client.uploadFile(clip, 'video/mp4');
      const r = await client.respond<Omit<Moment, 'id' | 'startMs' | 'endMs' | 'triggers' | 'status'>>({
        model: 'muse-spark-1.2', kind: 'explain', schema: MOMENT_SCHEMA, maxOutputTokens: 4000,
        content: [
          { type: 'input_text', text: buildPrompt(session?.game ?? '', c, aligned, transcript?.turns ?? []) },
          { type: 'input_video', file_id: fileId },
        ],
      });
      const d = r.data;
      const label = (LABELS as readonly string[]).includes(d.label) ? d.label : 'none';
      return {
        id: c.id, startMs: c.startMs, endMs: c.endMs, triggers: c.triggers, label,
        confidence: Math.min(1, Math.max(0, Number(d.confidence) || 0)),
        evidence: { face: d.evidence?.face ?? '', voice: d.evidence?.voice ?? '', hands: d.evidence?.hands ?? '', screen: d.evidence?.screen ?? '' },
        game_context: d.game_context ?? '', fix_hint: d.fix_hint ?? '', status: 'ok',
      };
    } catch (e) {
      console.warn(`explain ${c.id} failed: ${(e as Error).message}`);
      return unanalyzed(c);
    } finally {
      if (fileId) await client.deleteFile(fileId).catch(() => {});
    }
  }

  async function worker(): Promise<void> {
    while (next < candidates.length) {
      const i = next++;
      results[i] = await one(candidates[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, worker));

  await writeFile(join(dir, 'moments.json'), JSON.stringify(results, null, 2));
  return results;
}
