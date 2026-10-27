import { describe, it, expect } from 'vitest';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { align } from '../../src/watch/align.ts';
import { compositeClip, explainStage } from '../../src/watch/explain.ts';
import { probeDurationMs, probeSize, hasStream } from '../../src/watch/ffmpeg.ts';
import { createMetaClient, type MetaClient } from '../../src/meta/client.ts';
import { fakeSession, tmp, T0 } from './helpers.ts';

const cand = (id: string, startMs: number, endMs: number) => ({ id, startMs, endMs, triggers: ['fail:die'] });

describe('compositeClip', () => {
  it('stacks three panels, trims to the window and keeps audio', async () => {
    const dir = await tmp();
    await fakeSession(dir, { hands: true });
    const a = await align(dir);
    const out = join(dir, 'clips', 'c001.mp4');
    await compositeClip(dir, a, cand('c001', 500, 2000), out);
    const { width, height } = await probeSize(out);
    expect(height).toBe(360);
    // face 4:3 -> 480, hands 4:3 -> 480, screen 16:9 -> 640
    expect(width).toBe(480 + 480 + 640);
    expect(Math.abs((await probeDurationMs(out)) - 1500)).toBeLessThan(300);
    expect(await hasStream(out, 'a')).toBe(true);
  }, 20000);

  it('still produces a clip when the hands track and mic are missing', async () => {
    const dir = await tmp();
    await fakeSession(dir, { mic: false });
    const a = await align(dir);
    const out = join(dir, 'clips', 'c001.mp4');
    await compositeClip(dir, a, cand('c001', 0, 1500), out);
    expect((await probeSize(out)).width).toBe(480 + 480 + 640);
    expect(await hasStream(out, 'a')).toBe(true);
  }, 20000);
});

function spyClient(throwFor?: string) {
  const base = createMetaClient({ live: false, budgetUsd: 1, spendLog: '/dev/null' });
  const log = { uploaded: [] as string[], deleted: [] as string[], responded: [] as string[] };
  const client: MetaClient = {
    ...base,
    uploadFile: async (p, m) => { const id = await base.uploadFile(p, m); log.uploaded.push(id); return id; },
    deleteFile: async id => { log.deleted.push(id); },
    respond: async (req: any) => {
      const id = req.content.find((c: any) => c.type === 'input_video').file_id as string;
      log.responded.push(id);
      if (throwFor && id.includes(throwFor)) throw new Error('boom');
      return base.respond(req);
    },
  };
  return { client, log };
}

async function sessionWithCandidates(): Promise<string> {
  const dir = await tmp();
  await fakeSession(dir, {
    events: [{ t: T0, type: 'swap', data: { kind: 'attempt', a: 1 }, serverT: T0 + 900 }],
  });
  await align(dir);
  await writeFile(join(dir, 'candidates.json'), JSON.stringify([cand('c001', 0, 1200), cand('c002', 800, 2000), cand('c003', 1500, 3000)]));
  return dir;
}

describe('explainStage', () => {
  it('writes a moment per candidate, marks failures unanalyzed, and deletes every upload', async () => {
    const dir = await sessionWithCandidates();
    const { client, log } = spyClient('c002');
    const moments = await explainStage(dir, client, { concurrency: 2 });
    expect(moments.map(m => [m.id, m.status, m.label])).toEqual([
      ['c001', 'ok', 'confused'], ['c002', 'unanalyzed', 'none'], ['c003', 'ok', 'confused'],
    ]);
    expect(moments[1].confidence).toBe(0);
    expect(log.deleted.sort()).toEqual(log.uploaded.sort());
    expect(log.uploaded).toHaveLength(3);
    expect(JSON.parse(await readFile(join(dir, 'moments.json'), 'utf8'))).toEqual(moments);
  }, 30000);

  it('on rerun only re-asks the moments that were not ok', async () => {
    const dir = await sessionWithCandidates();
    await explainStage(dir, spyClient('c002').client);
    const second = spyClient();
    const moments = await explainStage(dir, second.client);
    expect(second.log.responded).toHaveLength(1);
    expect(second.log.responded[0]).toContain('c002');
    expect(moments.every(m => m.status === 'ok')).toBe(true);
  }, 30000);
});
