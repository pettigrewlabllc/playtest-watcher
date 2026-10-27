import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../../src/watch/ffmpeg.ts';

export async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pw-watch-'));
}

export async function lavfiVideo(file: string, seconds: number, size = '320x240'): Promise<void> {
  await run(['-f', 'lavfi', '-i', `testsrc=size=${size}:rate=10`, '-t', String(seconds), '-c:v', 'libvpx', '-b:v', '200k', file]);
}

export async function lavfiAudio(file: string, seconds: number): Promise<void> {
  await run(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', String(seconds), '-c:a', 'libopus', file]);
}

// A session folder as Plan 1 leaves it: t0 = 1_000_000, face starts 120 ms late.
export const T0 = 1_000_000;

export async function fakeSession(dir: string, opts: { events?: unknown[]; seconds?: number; hands?: boolean; mic?: boolean } = {}): Promise<void> {
  const seconds = opts.seconds ?? 3;
  await lavfiVideo(join(dir, 'face.webm'), seconds);
  await lavfiVideo(join(dir, 'screen.webm'), seconds, '640x360');
  if (opts.hands) await lavfiVideo(join(dir, 'hands.webm'), seconds);
  if (opts.mic !== false) await lavfiAudio(join(dir, 'mic.webm'), seconds);
  const track = (off: number) => ({ startedAt: T0 + off, mimeType: 'video/webm', settings: {}, bytes: 1, chunks: 1 });
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({
    id: 's', startedAt: T0, stoppedAt: T0 + seconds * 1000,
    tracks: { face: track(120), screen: track(0), mic: track(50), ...(opts.hands ? { hands: track(30) } : {}) },
  }));
  await writeFile(join(dir, 'session.json'), JSON.stringify({ id: 's', kid: 'a', game: 'bond-swap', round: 'learn', createdAt: T0 - 5000 }));
  const ev = opts.events ?? [];
  await writeFile(join(dir, 'events.jsonl'), ev.map(e => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n'));
}
