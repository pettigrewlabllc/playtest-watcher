// npm run demo: the whole watch pipeline on a made-up 30-second session, with no API key and no spend.
// Video is ffmpeg test patterns, the event log is scripted, and the Meta client runs in fake mode, so every
// label and fix is canned. It shows the shape of what a real session produces, not real analysis.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createMetaClient } from '../src/meta/client.ts';
import { runWatch } from '../src/watch/run.ts';
import { run as ffmpeg } from '../src/watch/ffmpeg.ts';

const OUT = resolve(import.meta.dirname, '..', 'demo-out', 'session');
const T0 = 1_000_000;
const SECONDS = 30;

async function video(file: string, size: string) {
  await ffmpeg(['-f', 'lavfi', '-i', `testsrc=size=${size}:rate=10`, '-t', String(SECONDS), '-c:v', 'libvpx', '-b:v', '200k', file]);
}

// A kid making steady progress, then failing the same move four times, going idle, and recovering.
function events() {
  const ev = (s: number, type: string, kind: string, data: Record<string, unknown> = {}) => ({ t: T0 + s * 1000 - 40, serverT: T0 + s * 1000, type, data: { kind, ...data } });
  const out = [ev(0, 'level_start', 'progress', { level: 'w1-01' })];
  for (let s = 1; s < 10; s++) out.push(ev(s, 'swap', 'progress'));
  for (const s of [11, 12.5, 14, 15.5]) out.push(ev(s, 'bad_swap', 'fail'));
  out.push(ev(17, 'idle', 'other'));
  for (let s = 23; s < 29; s++) out.push(ev(s, 'swap', 'progress'));
  out.push(ev(29, 'level_complete', 'success', { level: 'w1-01' }));
  return out;
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
console.log(`making a synthetic session in ${OUT}`);
await video(join(OUT, 'face.webm'), '320x240');
await video(join(OUT, 'screen.webm'), '640x360');
await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', String(SECONDS), '-c:a', 'libopus', join(OUT, 'mic.webm')]);
const track = (off: number) => ({ startedAt: T0 + off, mimeType: 'video/webm', settings: {}, bytes: 1, chunks: 1 });
await writeFile(join(OUT, 'manifest.json'), JSON.stringify({ id: 'demo', startedAt: T0, stoppedAt: T0 + SECONDS * 1000, tracks: { face: track(120), screen: track(0), mic: track(50) } }));
await writeFile(join(OUT, 'session.json'), JSON.stringify({ id: 'demo', kid: 'z', game: 'demo-game', round: 'learn', createdAt: T0 - 5000 }));
await writeFile(join(OUT, 'events.jsonl'), events().map(e => JSON.stringify(e)).join('\n'));

const client = createMetaClient({ live: false, budgetUsd: 0, spendLog: join(OUT, 'spend.jsonl') });
await runWatch(OUT, client);

const moments = JSON.parse(await readFile(join(OUT, 'moments.json'), 'utf8')) as { id: string; startMs: number; endMs: number; triggers: string[]; label: string }[];
console.log('\nmoments (labels are canned in fake mode):');
for (const m of moments) console.log(`  ${m.id}  ${(m.startMs / 1000).toFixed(1)}-${(m.endMs / 1000).toFixed(1)}s  ${m.label.padEnd(10)} triggered by ${m.triggers.join(', ')}`);
console.log(`\nfix list: ${join(OUT, 'fixes.md')}\nclips sent to the model: ${join(OUT, 'clips')}`);
console.log('\nOn a real session: put MODEL_API_KEY in .env.local, then PW_LIVE=1 npm run watch -- <sessionId> --live');
