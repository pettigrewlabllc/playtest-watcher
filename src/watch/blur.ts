import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseVideoStream, type ResponsesEvent } from '@meta-sam/parser';
import type { MetaClient } from '../meta/client.ts';
import { run, probeDurationMs, probeSize } from './ffmpeg.ts';

export type Box = { x1: number; y1: number; x2: number; y2: number };

const PAD = 0.2;          // grow each side by 20% of the box size
const CARRY_S = 1;        // keep the last boxes for up to a second when SAM misses a frame

// Pulls face boxes out of raw SAM text, keyed by frame index.
export async function parseSamBoxes(text: string): Promise<Map<number, Box[]>> {
  async function* events(): AsyncIterable<ResponsesEvent> {
    yield { type: 'response.output_text.delta', item_id: 'm', output_index: 0, content_index: 0, delta: text };
    yield { type: 'response.output_text.done', item_id: 'm', output_index: 0, content_index: 0, text };
    yield { type: 'response.completed' };
  }
  const result = await parseVideoStream(events()).finalResult;
  const byFrame = new Map<number, Box[]>();
  for (const r of result.records) {
    if (r.kind !== 'box' || !r.frame) continue;
    const list = byFrame.get(r.frame.frameIndex) ?? [];
    list.push({ x1: r.left, y1: r.top, x2: r.right, y2: r.bottom });
    byFrame.set(r.frame.frameIndex, list);
  }
  return byFrame;
}

export function padBox(b: Box, width: number, height: number): Box {
  const px = (b.x2 - b.x1) * PAD;
  const py = (b.y2 - b.y1) * PAD;
  return {
    x1: Math.max(0, Math.floor(b.x1 - px)), y1: Math.max(0, Math.floor(b.y1 - py)),
    x2: Math.min(width, Math.ceil(b.x2 + px)), y2: Math.min(height, Math.ceil(b.y2 + py)),
  };
}

// One padded, clamped box list per frame. A frame SAM missed reuses the last known boxes for up to a second.
export function boxesPerFrame(detected: Map<number, Box[]>, frames: number, width: number, height: number, fps: number): Box[][] {
  const out: Box[][] = [];
  let last = -Infinity;
  let lastBoxes: Box[] = [];
  const carry = Math.round(CARRY_S * fps);
  for (let f = 0; f < frames; f++) {
    const found = detected.get(f);
    if (found?.length) { last = f; lastBoxes = found; }
    out.push(f - last <= carry ? lastBoxes.map(b => padBox(b, width, height)) : []);
  }
  return out;
}

export function rasterMask(boxes: Box[], width: number, height: number): Uint8Array {
  const m = new Uint8Array(width * height);
  for (const b of boxes) for (let y = b.y1; y < b.y2; y++) m.fill(255, y * width + b.x1, y * width + b.x2);
  return m;
}

const FFMPEG = process.env.FFMPEG_PATH ?? '/opt/homebrew/bin/ffmpeg';

// Feeds a gray8 mask stream (one frame per video frame) into ffmpeg's stdin.
function blurWithMask(args: string[], masks: Uint8Array[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg blur failed: ${err.slice(0, 500)}`))));
    p.stdin.on('error', () => { /* ffmpeg exited early; close handler reports why */ });
    (async () => {
      for (const m of masks) {
        if (!p.stdin.write(m)) await new Promise<void>(r => p.stdin.once('drain', () => r()));
      }
      p.stdin.end();
    })();
  });
}

// Never exports an unblurred face: if SAM fails or finds nothing, this throws and writes nothing.
export async function blurFaces(client: MetaClient, inMp4: string, outMp4: string, opts: { fps?: number } = {}): Promise<{ frames: number; facesFound: number }> {
  const fps = opts.fps ?? 5;
  const work = await mkdtemp(join(tmpdir(), 'pw-blur-'));
  let fileId: string | undefined;
  try {
    const small = join(work, 'sam.mp4');
    await run(['-i', inMp4, '-vf', `fps=${fps}`, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', small]);
    const { width, height } = await probeSize(small);
    const frames = Math.max(1, Math.round(((await probeDurationMs(small)) / 1000) * fps));

    fileId = await client.uploadFile(small, 'video/mp4');
    const text = await client.segmentVideo(fileId, 'face', { frames });
    const detected = await parseSamBoxes(text);
    const facesFound = [...detected.values()].reduce((n, l) => n + l.length, 0);
    if (!facesFound) throw new Error('SAM found no faces; refusing to export an unblurred clip');

    const perFrame = boxesPerFrame(detected, frames, width, height, fps);
    const masks = perFrame.map(b => rasterMask(b, width, height));
    await blurWithMask([
      '-i', small,
      '-f', 'rawvideo', '-pixel_format', 'gray', '-video_size', `${width}x${height}`, '-framerate', String(fps), '-i', 'pipe:0',
      '-i', inMp4,
      '-filter_complex', '[0:v]split[a][b];[b]boxblur=luma_radius=24:luma_power=3:chroma_radius=24:chroma_power=3[bl];[1:v]format=gray[m];[a][bl][m]maskedmerge[v]',
      '-map', '[v]', '-map', '2:a?', '-shortest',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', outMp4,
    ], masks);
    return { frames, facesFound };
  } catch (e) {
    await rm(outMp4, { force: true });
    throw e;
  } finally {
    if (fileId) await client.deleteFile(fileId).catch(() => {});
    await rm(work, { recursive: true, force: true });
  }
}

// The viewer's face panel: the whole frame blurred hard enough that nobody is recognisable, posture still readable.
// No model call, so it runs on every session for free; SAM's per-face blur above stays for when the budget allows.
export async function blurPanel(inMp4: string, outMp4: string): Promise<void> {
  await run(['-i', inMp4, '-an', '-vf', 'scale=320:-2,boxblur=luma_radius=18:luma_power=3', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outMp4]);
}
