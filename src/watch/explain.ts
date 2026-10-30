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

type Manifest = { tracks?: Record<string, { label?: string } | undefined> };

// The panel order is fixed (face, hands, screen). The kid-facing camera is the MacBook's own; the Anker and Desk View
// look down at the iPad. If one of those was recorded as the face track, the model is told not to read a face from it.
export function cameraWarnings(manifest: Manifest | undefined): string[] {
  const face = manifest?.tracks?.face?.label;
  if (face && /desk ?view|anker|powerconf/i.test(face)) {
    return [`WARNING: the left panel was recorded from the camera "${face}", which looks down at the desk. It may show hands or the device instead of the child's face; do not read facial expression from it unless a face is clearly visible.`];
  }
  return [];
}

// What a trigger name in candidates.ts means, so the model knows why the clip was picked.
const TRIGGERS: [RegExp, string][] = [
  [/^fail_burst:/, 'several failures of one kind close together'],
  [/^fail:/, 'the game logged a failure'],
  [/^retry:/, 'the same attempt repeated quickly'],
  [/^idle$/, 'no input for a while'],
  [/^quit$/, 'the child quit or left a level'],
  [/^end$/, 'a level or run ended'],
  [/^fast_progress$/, 'progress came unusually fast'],
  [/^speech$/, 'the child spoke'],
  [/^loud$/, 'the room got loud (laughing, shouting, a sigh)'],
  [/^sweep$/, 'a routine sample, picked for no particular reason'],
];
const triggerLine = (t: string) => `${t} (${TRIGGERS.find(([re]) => re.test(t))?.[1] ?? 'other'})`;

export function buildPrompt(game: string, c: Candidate, aligned: Aligned, turns: Transcript['turns'], warnings: string[] = [], age?: number): string {
  const rel = (ms: number) => `+${mmss(ms - c.startMs, true)}`;
  const talk = turns.filter(t => t.startMs < c.endMs && t.endMs > c.startMs)
    .map(t => `${rel(t.startMs)} ${t.who}: ${t.text}`);
  const events = aligned.events.filter(e => e.ms >= c.startMs && e.ms <= c.endMs)
    .map(e => `${rel(e.ms)} ${e.type} ${JSON.stringify(e.data)}`);
  const secs = ((c.endMs - c.startMs) / 1000).toFixed(1);
  return [
    ...warnings,
    `TASK: judge how one child felt during a ${secs}-second clip of them playtesting a kids' game called "${game || 'unknown'}"${age ? `. The child is ${age} years old` : ''}. Watch the whole clip before you answer.`,
    '',
    'WHAT YOU ARE GIVEN',
    `1. A video, ${secs} seconds at 5 frames a second, with three panels side by side, left to right:`,
    "   - LEFT, face: a camera at eye level pointed at the child. Read expression, gaze and posture here (leaning in, slumping, looking away, turning to the adult).",
    "   - MIDDLE, hands: a camera above the desk looking down at the iPad. Read what the hands do: tapping, swiping, hesitating, stabbing repeatedly, letting go of the device.",
    '   - RIGHT, screen: a recording of the iPad screen. Read what the game is showing and asking for.',
    '   A panel that is solid black was not recorded. The soundtrack is one room microphone, with the child and an adult facilitator in the room.',
    '2. What was said in the clip, from automatic speech recognition. "kid" is the player and "adult" is the facilitator. Speaker labels and words can be wrong, so check them against the audio.',
    talk.length ? talk.join('\n') : '(nothing was said)',
    "3. The game's own event log for the clip, one event per line as: time, event name, details. These are facts about what happened in the game.",
    events.length ? events.join('\n') : '(no game events in this clip)',
    `4. Why the clip was picked: ${c.triggers.map(triggerLine).join('; ')}. A trigger is not evidence of a feeling; plenty of picked clips are "none".`,
    'All times are relative to the start of the clip.',
    '',
    'WHAT TO JUDGE',
    "The child's state, not the adult's, and not what you expect a child would feel. Weigh face, body and voice first, then use the hands, screen and events to explain them. When the signals disagree, go with what the child visibly and audibly does.",
    '',
    'WHAT TO RETURN (JSON matching the schema, nothing else)',
    '- label: the one that best fits the clip as a whole:',
    '  - confused: does not understand what something means or does',
    '  - stuck: understands the goal but cannot find how to make progress',
    '  - bored: attention drifting, nothing holding them',
    '  - frustrated: wants to succeed and is annoyed at failing or at the game',
    '  - delighted: clear enjoyment, surprise or pride',
    '  - none: nothing notable',
    '- confidence: 0 to 1. Around 0.9 when two or more signals clearly agree, around 0.6 when one signal points that way, 0.4 or lower when it is a guess.',
    '- evidence: one or two sentences each, with clip times, of what you saw or heard:',
    '  - face: expression, gaze and posture from the LEFT panel. "not visible" if no face is in view.',
    "  - voice: the child's words or sounds (sighs, laughs, groans), quoted where you can. \"silent\" if the child made none.",
    '  - hands: what the hands did in the MIDDLE panel.',
    '  - screen: what the game showed in the RIGHT panel.',
    '- game_context: one sentence on what the game was asking the child to do at that moment.',
    '- fix_hint: one line for the game developer on what to change so this does not happen again. Empty when the label is none or delighted.',
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
  const session = await readJson<{ game?: string; kid?: string }>(join(dir, 'session.json'));
  const kids = await readJson<Record<string, { age?: number }>>(join(dir, '..', 'kids.json'));
  const age = kids?.[String(session?.kid ?? '').toUpperCase()]?.age;
  const previous = (await readJson<Moment[]>(join(dir, 'moments.json'))) ?? [];
  const warnings = cameraWarnings(await readJson<Manifest>(join(dir, 'manifest.json')));
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
        // Muse Spark reasons before it answers, and the reasoning counts here; 4000 cut one answer off mid-JSON.
        model: 'muse-spark-1.2', kind: 'explain', schema: MOMENT_SCHEMA, maxOutputTokens: 8000,
        content: [
          { type: 'input_text', text: buildPrompt(session?.game ?? '', c, aligned, transcript?.turns ?? [], warnings, age) },
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
