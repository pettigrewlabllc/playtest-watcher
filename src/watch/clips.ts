import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Aligned } from './align.ts';
import type { Candidate } from './candidates.ts';
import { run } from './ffmpeg.ts';

const PANEL_H = 360;
const BLACK_W = 480;
const FPS = 5;
const PANELS = ['face', 'hands', 'screen'] as const;

// Face, hands and screen side by side for one candidate window, with the mic mixed in.
export async function compositeClip(dir: string, aligned: Aligned, c: Candidate, out: string): Promise<void> {
  await mkdir(dirname(out), { recursive: true });
  const start = c.startMs / 1000;
  const dur = (c.endMs - c.startMs) / 1000;
  const end = c.endMs / 1000;
  const args: string[] = [];
  const filters: string[] = [];
  const labels: string[] = [];
  let n = 0;

  for (const name of PANELS) {
    const t = aligned.tracks[name];
    if (t) {
      // -itsoffset puts the proxy on session time, so the trim below is in session seconds.
      args.push('-itsoffset', String(t.offsetMs / 1000), '-i', join(dir, t.mp4));
      filters.push(`[${n}:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,fps=${FPS},scale=-2:${PANEL_H},setsar=1,format=yuv420p[p${labels.length}]`);
      n++;
    } else {
      filters.push(`color=c=black:s=${BLACK_W}x${PANEL_H}:r=${FPS}:d=${dur},format=yuv420p[p${labels.length}]`);
    }
    labels.push(`[p${labels.length}]`);
  }
  filters.push(`${labels.join('')}hstack=inputs=${labels.length}[v]`);

  if (aligned.audio) {
    args.push('-itsoffset', String(aligned.audio.offsetMs / 1000), '-i', join(dir, 'mic.webm'));
    filters.push(`[${n}:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,aresample=16000,apad[a]`);
  } else {
    filters.push(`anullsrc=r=16000:cl=mono,atrim=duration=${dur}[a]`);
  }

  await run([
    ...args, '-filter_complex', filters.join(';'), '-map', '[v]', '-map', '[a]', '-t', String(dur),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '1', '-movflags', '+faststart', out,
  ]);
}
