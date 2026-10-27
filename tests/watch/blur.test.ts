import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseSamBoxes, padBox, boxesPerFrame, rasterMask, blurFaces, type Box } from '../../src/watch/blur.ts';
import { probeSize, probeDurationMs, run } from '../../src/watch/ffmpeg.ts';
import { createMetaClient, type MetaClient } from '../../src/meta/client.ts';
import { lavfiVideo, tmp } from './helpers.ts';

const exec = promisify(execFile);
const box = (x1: number, y1: number, x2: number, y2: number): Box => ({ x1, y1, x2, y2 });

describe('box helpers', () => {
  it('parses the real-format sample into per-frame boxes', async () => {
    const m = await parseSamBoxes(await readFile(new URL('./fixtures/sam-sample.txt', import.meta.url), 'utf8'));
    expect(m.get(0)).toEqual([box(211, 228, 270, 254), box(155, 228, 202, 254)].map(b => ({ ...b, x2: b.x2 + 1, y2: b.y2 + 1 })));
  });

  it('pads 20% per side and clamps to the frame', () => {
    expect(padBox(box(100, 100, 200, 150), 640, 480)).toEqual(box(80, 90, 220, 160));
    expect(padBox(box(0, 0, 50, 50), 60, 55)).toEqual(box(0, 0, 60, 55));
  });

  it('carries boxes forward for one second, then drops them', () => {
    const detected = new Map([[0, [box(10, 10, 30, 30)]], [8, [box(50, 50, 70, 70)]]]);
    const pf = boxesPerFrame(detected, 10, 100, 100, 5);
    expect(pf[0]).toHaveLength(1);
    expect(pf[5]).toHaveLength(1);        // 5 frames at 5 fps = 1 s: still carried
    expect(pf[6]).toHaveLength(0);        // past a second: gone
    expect(pf[8]).toEqual([padBox(box(50, 50, 70, 70), 100, 100)]);
    expect(pf[9]).toEqual(pf[8]);
  });

  it('rasterizes boxes into a gray mask', () => {
    const m = rasterMask([box(1, 1, 3, 2)], 4, 3);
    expect([...m]).toEqual([0, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0, 0]);
  });
});

async function grayCrop(file: string, x: number, y: number, w: number, h: number): Promise<Buffer> {
  const { stdout } = await exec('/opt/homebrew/bin/ffmpeg', ['-v', 'error', '-i', file, '-vf', `select=eq(n\\,1),crop=${w}:${h}:${x}:${y},format=gray`, '-frames:v', '1', '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 1 << 24 });
  return stdout;
}

describe('blurFaces', () => {
  it('blurs the boxed region and leaves the rest alone', async () => {
    const dir = await tmp();
    const raw = join(dir, 'in.webm');
    await lavfiVideo(raw, 2);
    const inMp4 = join(dir, 'in.mp4');
    await run(['-i', raw, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', inMp4]);
    const client = createMetaClient({ live: false, budgetUsd: 1, spendLog: '/dev/null' });
    const out = join(dir, 'out.mp4');
    const r = await blurFaces(client, inMp4, out);
    expect(r.frames).toBe(10);
    expect(r.facesFound).toBeGreaterThan(0);
    expect(await probeSize(out)).toEqual({ width: 320, height: 240 });
    expect(Math.abs((await probeDurationMs(out)) - 2000)).toBeLessThan(300);
    // fake SAM box is x 40..100, y 30..100; compare a crop inside it and one far outside it
    const small = join(dir, 'ref.mp4');
    await run(['-i', inMp4, '-vf', 'fps=5', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', small]);
    const inside = (await grayCrop(small, 50, 40, 40, 40)).compare(await grayCrop(out, 50, 40, 40, 40));
    expect(inside).not.toBe(0);
    const spread = (b: Buffer) => Math.max(...b) - Math.min(...b);
    expect(spread(await grayCrop(out, 50, 40, 40, 40))).toBeLessThan(spread(await grayCrop(small, 50, 40, 40, 40)));
    const outside = (await grayCrop(small, 200, 150, 60, 60));
    const outsideBlurred = await grayCrop(out, 200, 150, 60, 60);
    const diff = outside.reduce((s, v, i) => s + Math.abs(v - outsideBlurred[i]), 0) / outside.length;
    expect(diff).toBeLessThan(8);   // only codec noise
  }, 30000);

  it('throws and writes nothing when SAM finds no faces', async () => {
    const dir = await tmp();
    const raw = join(dir, 'in.webm');
    await lavfiVideo(raw, 1);
    const inMp4 = join(dir, 'in.mp4');
    await run(['-i', raw, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', inMp4]);
    const base = createMetaClient({ live: false, budgetUsd: 1, spendLog: '/dev/null' });
    const deleted: string[] = [];
    const client: MetaClient = { ...base, segmentVideo: async () => '', deleteFile: async id => { deleted.push(id); } };
    const out = join(dir, 'out.mp4');
    await expect(blurFaces(client, inMp4, out)).rejects.toThrow(/no faces/);
    expect(existsSync(out)).toBe(false);
    expect(deleted).toHaveLength(1);
  }, 20000);
});
