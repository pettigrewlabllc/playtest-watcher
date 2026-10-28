import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { MetaClient } from '../meta/client.ts';
import type { Aligned } from './align.ts';

export type Turn = { startMs: number; endMs: number; speaker: string; text: string; who: 'kid' | 'adult' | 'unknown' };
export type Transcript = { turns: Turn[]; kidSpeaker: string | null };

const GENERIC = new Set(['start', 'end', 'stop', 'logger', 'screen', 'text', 'shown', 'click', 'tap', 'level', 'game', 'event']);

export function keywordsFor(game: string, events: Aligned['events']): string[] {
  const words = new Set<string>(game ? [game.replace(/-/g, ' ')] : []);
  for (const e of events) {
    for (const w of e.type.toLowerCase().split(/[^a-z]+/)) if (w.length >= 4 && !GENERIC.has(w)) words.add(w);
  }
  return [...words].slice(0, 30);
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; } catch { return undefined; }
}

export async function transcribe(dir: string, client: MetaClient, o: { log?: (line: string) => void } = {}): Promise<Transcript> {
  const aligned = JSON.parse(await readFile(join(dir, 'aligned.json'), 'utf8')) as Aligned;
  const session = (await readJson<{ game?: string; kidSpeaker?: string }>(join(dir, 'session.json'))) ?? {};
  const override = session.kidSpeaker;
  const keywords = keywordsFor(session.game ?? '', aligned.events);
  const turns: Turn[] = [];

  const chunks = aligned.audio?.wavChunks ?? [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const res = await client.transcribe(join(dir, chunk.file), { keywords });
    const talk = new Map<string, number>();
    for (const t of res.turns) talk.set(t.speaker, (talk.get(t.speaker) ?? 0) + (t.endMs - t.startMs));
    const ranked = [...talk.entries()].sort((a, b) => b[1] - a[1]);
    const longest = ranked[0]?.[0];
    const kidLabel = override ?? longest;
    o.log?.(`transcribe chunk ${i} (${chunk.file}): ${ranked.map(([sp, ms]) => `${sp} ${(ms / 1000).toFixed(1)} s${sp === kidLabel ? ' (kid)' : ''}`).join(', ') || 'no speech'}`);
    const shift = chunk.startMs + (aligned.audio?.offsetMs ?? 0);
    for (const t of res.turns) {
      const kid = override ? t.speaker === override : t.speaker === longest;
      turns.push({
        startMs: t.startMs + shift, endMs: t.endMs + shift, speaker: `${i}:${t.speaker}`, text: t.text,
        who: kid ? 'kid' : 'adult',
      });
    }
  }
  turns.sort((a, b) => a.startMs - b.startMs);
  const out: Transcript = { turns, kidSpeaker: override ?? null };
  await writeFile(join(dir, 'transcript.json'), JSON.stringify(out, null, 2));
  return out;
}

// Sets the kid's speaker label (the raw per-chunk label, e.g. A) in session.json, and relabels an existing transcript
// from its stored speakers, so no new transcription is needed.
export async function applyKidSpeaker(dir: string, label: string): Promise<{ relabelled: boolean }> {
  if (!/^[A-Za-z0-9]{1,8}$/.test(label)) throw new Error(`bad speaker label: "${label}"`);
  const sessionFile = join(dir, 'session.json');
  const session = (await readJson<Record<string, unknown>>(sessionFile)) ?? {};
  await writeFile(sessionFile, JSON.stringify({ ...session, kidSpeaker: label }, null, 2));
  const tFile = join(dir, 'transcript.json');
  if (!existsSync(tFile)) return { relabelled: false };
  const t = JSON.parse(await readFile(tFile, 'utf8')) as Transcript;
  const turns = t.turns.map(x => ({ ...x, who: (x.speaker.split(':').pop() === label ? 'kid' : 'adult') as Turn['who'] }));
  await writeFile(tFile, JSON.stringify({ turns, kidSpeaker: label }, null, 2));
  return { relabelled: true };
}
