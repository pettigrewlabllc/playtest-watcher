import { describe, it, expect } from 'vitest';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { align } from '../../src/watch/align.ts';
import { cameraWarnings, compositeClip, explainStage } from '../../src/watch/explain.ts';
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
    expect(height).toBe(480);
    // at 480 high: face 4:3 -> 640, hands 4:3 -> 640, screen 16:9 -> 854
    expect(width).toBe(640 + 640 + 854);
    expect(Math.abs((await probeDurationMs(out)) - 1500)).toBeLessThan(300);
    expect(await hasStream(out, 'a')).toBe(true);
  }, 20000);

  it('still produces a clip when the hands track and mic are missing', async () => {
    const dir = await tmp();
    await fakeSession(dir, { mic: false });
    const a = await align(dir);
    const out = join(dir, 'clips', 'c001.mp4');
    await compositeClip(dir, a, cand('c001', 0, 1500), out);
    // the missing hands panel is a 480-wide black block
    expect((await probeSize(out)).width).toBe(640 + 480 + 854);
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

describe('camera roles in the prompt', () => {
  it('warns in the prompt header when the face track came from a Desk View camera', async () => {
    const dir = await sessionWithCandidates();
    const m = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    m.tracks.face.label = 'MacBook Pro Desk View Camera';
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(m));
    await writeFile(join(dir, 'candidates.json'), JSON.stringify([cand('c001', 0, 1200)]));
    const texts: string[] = [];
    const base = createMetaClient({ live: false, budgetUsd: 1, spendLog: '/dev/null' });
    const client: MetaClient = { ...base, respond: async (req: any) => { texts.push(req.content[0].text); return base.respond(req); } };
    await explainStage(dir, client);
    expect(texts[0].startsWith('WARNING: the left panel was recorded from the camera "MacBook Pro Desk View Camera"')).toBe(true);
    expect(cameraWarnings({ tracks: { face: { label: 'Anker PowerConf C200' } } })).toEqual([]);
    expect(cameraWarnings(undefined)).toEqual([]);
  }, 30000);
});
