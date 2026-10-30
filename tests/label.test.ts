import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { sampleLabels, writeQueue, pendingQueue, setLabel } from '../src/label/queue.ts';
import { createApp } from '../src/server/app.ts';
import { LABELS } from '../src/watch/explain.ts';

let root: string;

async function session(id: string, kid: string, labels: string[]) {
  const dir = join(root, id);
  await mkdir(join(dir, 'clips'), { recursive: true });
  await writeFile(join(dir, 'session.json'), JSON.stringify({ id, kid, game: 'g', round: 'learn' }));
  await writeFile(join(dir, 'aligned.json'), '{}');
  const moments = labels.map((label, i) => ({ id: `c${String(i + 1).padStart(3, '0')}`, startMs: 0, endMs: 1, triggers: [], label, confidence: 0.5, evidence: {}, game_context: '', fix_hint: '', status: 'ok' }));
  await writeFile(join(dir, 'moments.json'), JSON.stringify(moments));
  for (const m of moments) await writeFile(join(dir, 'clips', `${m.id}.mp4`), 'clip');
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pw-label-'));
  // 20 moments per label per kid, so every share can be filled.
  for (const kid of ['a', 'b', 'c', 'd']) await session(`20261030-000000-${kid}-g-learn`, kid, LABELS.flatMap(l => Array(20).fill(l)));
  await session('20261030-000000-j-g-reference', 'j', ['confused', 'bored']);
});

describe('sampleLabels', () => {
  it('takes equal shares per Muse label and spreads them over the kids', async () => {
    const q = await sampleLabels(root, { n: 120 });
    expect(q).toHaveLength(120);
    const label = async (x: { session: string; moment: string }) =>
      JSON.parse(await readFile(join(root, x.session, 'moments.json'), 'utf8')).find((m: any) => m.id === x.moment).label;
    const counts: Record<string, number> = {};
    for (const x of q) counts[await label(x)] = (counts[await label(x)] ?? 0) + 1;
    for (const l of LABELS) expect(counts[l]).toBe(20);
    const kids: Record<string, number> = {};
    for (const x of q) kids[x.kid] = (kids[x.kid] ?? 0) + 1;
    expect(Object.values(kids)).toEqual([30, 30, 30, 30]);
  });

  it('flags the first 60 for the reliability check', async () => {
    const q = await sampleLabels(root, { n: 100 });
    expect(q.filter(x => x.reliability)).toHaveLength(60);
    expect(q.slice(0, 60).every(x => x.reliability)).toBe(true);
  });

  it('is deterministic for a seed and changes with it', async () => {
    const a = await sampleLabels(root, { n: 50 }), b = await sampleLabels(root, { n: 50 });
    expect(a).toEqual(b);
    expect(await sampleLabels(root, { n: 50, seed: 'other' })).not.toEqual(a);
  });

  it('skips Joel\'s reference runs and moments already labelled', async () => {
    await writeFile(join(root, '20261030-000000-a-g-learn', 'labels.json'), JSON.stringify({ c001: 'confused' }));
    const q = await sampleLabels(root, { n: 1000 });
    expect(q.some(x => x.kid === 'j')).toBe(false);
    expect(q.some(x => x.session === '20261030-000000-a-g-learn' && x.moment === 'c001')).toBe(false);
  });
});

describe('labels', () => {
  it('saves, undoes and reports progress', async () => {
    await writeQueue(root, await sampleLabels(root, { n: 10 }));
    const first = (await pendingQueue(root)).items[0];
    await setLabel(root, first.session, first.moment, 'stuck');
    expect(await pendingQueue(root)).toMatchObject({ total: 10, done: 1 });
    expect(JSON.parse(await readFile(join(root, first.session, 'labels.json'), 'utf8'))).toEqual({ [first.moment]: 'stuck' });
    await setLabel(root, first.session, first.moment, null);
    expect((await pendingQueue(root)).done).toBe(0);
  });

  it('rejects a bad label and an unknown moment', async () => {
    await expect(setLabel(root, '20261030-000000-a-g-learn', 'c001', 'sleepy')).rejects.toMatchObject({ status: 400 });
    await expect(setLabel(root, '20261030-000000-a-g-learn', 'c999', 'stuck')).rejects.toMatchObject({ status: 404 });
  });
});

describe('label endpoints', () => {
  let server: ReturnType<typeof createApp>, base: string;
  afterAll(() => server?.close());

  it('serves the queue without Muse labels, takes labels, and streams clips', async () => {
    server = createApp(root);
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await writeQueue(root, await sampleLabels(root, { n: 5 }));

    const q = await (await fetch(`${base}/api/label-queue`)).json();
    expect(q.items).toHaveLength(5);
    expect(JSON.stringify(q)).not.toMatch(/confused|stuck|bored|frustrated|delighted/);

    const { session, moment } = q.items[0];
    const post = (b: unknown) => fetch(`${base}/api/sessions/${session}/labels`, { method: 'POST', body: JSON.stringify(b), headers: { 'content-type': 'application/json' } });
    expect((await post({ moment, label: 'bored' })).status).toBe(204);
    expect((await post({ moment, label: 'sleepy' })).status).toBe(400);
    expect((await post({ moment: 'c999', label: 'bored' })).status).toBe(404);
    expect((await (await fetch(`${base}/api/label-queue`)).json()).done).toBe(1);

    const clip = await fetch(`${base}/clips/${session}/${moment}.mp4`, { headers: { range: 'bytes=1-2' } });
    expect(clip.status).toBe(206);
    expect(await clip.text()).toBe('li');
    expect((await fetch(`${base}/clips/..%2Fx/c001.mp4`)).status).toBe(400);
  });
});
