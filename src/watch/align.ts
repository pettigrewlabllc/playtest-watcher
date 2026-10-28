import { readFile, writeFile, stat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { run, probeDurationMs, probeSize } from './ffmpeg.ts';

export type AlignedEvent = { ms: number; type: string; kind: string; data: Record<string, unknown> };
export type Aligned = {
  t0: number; durationMs: number;
  tracks: Partial<Record<'face' | 'hands' | 'screen', { mp4: string; offsetMs: number; width: number; height: number }>>;
  audio?: { wavChunks: { file: string; startMs: number }[]; offsetMs: number };
  events: AlignedEvent[];
  gameClockSkewMs?: number;
};

const VIDEO_TRACKS = ['face', 'hands', 'screen'] as const;
const WAV_SEGMENT_S = 570;

async function size(file: string): Promise<number> {
  try { return (await stat(file)).size; } catch { return 0; }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Event time is the game's own clock (t), moved onto the server clock by the session's median t - serverT.
// serverT alone is only the batch arrival time (batches go out every 500 ms), so it sets the skew and nothing else.
export async function parseEvents(dir: string, t0: number): Promise<{ events: AlignedEvent[]; skew?: number }> {
  let raw = '';
  try { raw = await readFile(join(dir, 'events.jsonl'), 'utf8'); } catch { return { events: [] }; }
  const parsed: { t?: number; serverT: number; type: string; data: Record<string, unknown> }[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (typeof e.serverT !== 'number' || typeof e.type !== 'string') continue;
      const data = e.data && typeof e.data === 'object' ? e.data : {};
      parsed.push({ t: typeof e.t === 'number' ? e.t : undefined, serverT: e.serverT, type: e.type, data });
    } catch { /* skip malformed line */ }
  }
  const skews = parsed.flatMap(e => (e.t === undefined ? [] : [e.t - e.serverT]));
  const skew = skews.length ? median(skews) : undefined;
  const events: AlignedEvent[] = parsed.map(e => ({
    ms: (e.t !== undefined && skew !== undefined ? e.t - skew : e.serverT) - t0,
    type: e.type, kind: typeof e.data.kind === 'string' ? e.data.kind : 'other', data: e.data,
  }));
  events.sort((a, b) => a.ms - b.ms);
  return { events, skew };
}

export async function align(dir: string): Promise<Aligned> {
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  const t0: number = manifest.startedAt;
  const out: Aligned = { t0, durationMs: manifest.stoppedAt - t0, tracks: {}, events: [] };

  for (const name of VIDEO_TRACKS) {
    const src = join(dir, `${name}.webm`);
    if (!(await size(src))) continue;
    const mp4 = join(dir, `${name}.mp4`);
    try {
      await run(['-i', src, '-vf', 'scale=-2:480,fps=10', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-an', mp4]);
    } catch { continue; }
    const { width, height } = await probeSize(mp4);
    out.tracks[name] = { mp4: `${name}.mp4`, offsetMs: (manifest.tracks?.[name]?.startedAt ?? t0) - t0, width, height };
  }

  const mic = join(dir, 'mic.webm');
  if (await size(mic)) {
    try {
      for (const f of await readdir(dir)) if (/^mic_\d+\.wav$/.test(f)) await rm(join(dir, f));
      await run(['-i', mic, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'segment', '-segment_time', String(WAV_SEGMENT_S), '-reset_timestamps', '1', join(dir, 'mic_%03d.wav')]);
      const files = (await readdir(dir)).filter(f => /^mic_\d+\.wav$/.test(f)).sort();
      const wavChunks: { file: string; startMs: number }[] = [];
      let start = 0;
      for (const file of files) {
        wavChunks.push({ file, startMs: start });
        start += await probeDurationMs(join(dir, file));
      }
      if (wavChunks.length) out.audio = { wavChunks, offsetMs: (manifest.tracks?.mic?.startedAt ?? t0) - t0 };
    } catch { /* degrade: no audio */ }
  }

  const { events, skew } = await parseEvents(dir, t0);
  out.events = events;
  if (skew !== undefined) out.gameClockSkewMs = skew;
  await writeFile(join(dir, 'aligned.json'), JSON.stringify(out, null, 2));
  return out;
}
