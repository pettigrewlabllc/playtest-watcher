import { describe, it, expect } from 'vitest';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixesStage } from '../../src/watch/fixes.ts';
import { createMetaClient, type MetaClient } from '../../src/meta/client.ts';
import { tmp } from './helpers.ts';

const moment = (id: string, startMs: number, label: string, status = 'ok') => ({
  id, startMs, endMs: startMs + 10000, triggers: [], label, confidence: 0.8, status,
  evidence: { face: '', voice: '', hands: '', screen: '' }, game_context: 'ctx', fix_hint: 'hint',
});

async function setup(moments: unknown[]) {
  const dir = await tmp();
  await writeFile(join(dir, 'session.json'), JSON.stringify({ game: 'bond-swap', kid: 'b', createdAt: Date.UTC(2026, 9, 28, 12) }));
  await writeFile(join(dir, 'moments.json'), JSON.stringify(moments));
  return dir;
}

function stub(fixes: unknown[]) {
  const base = createMetaClient({ live: false, budgetUsd: 1, spendLog: '/dev/null' });
  const calls: any[] = [];
  const client: MetaClient = { ...base, respond: (async (req: any) => { calls.push(req); return { data: { fixes }, text: '', usage: {} }; }) as any };
  return { client, calls };
}

describe('fixesStage', () => {
  it('orders fixes high to low and links moments', async () => {
    const dir = await setup([moment('c001', 30_000, 'delighted'), moment('c004', 192_000, 'stuck'), moment('c005', 200_000, 'none')]);
    const { client, calls } = stub([
      { title: 'Polish the win', why: 'smiled', evidence_moment_ids: ['c001'], severity: 'low', suggestion: 'keep it' },
      { title: 'Explain the bond', why: 'stuck 20s', evidence_moment_ids: ['c004', 'c999'], severity: 'high', suggestion: 'add a hint' },
    ]);
    const md = await fixesStage(dir, client);
    expect(md.split('\n')[0]).toBe('# Fix list: bond-swap, kid B, 2026-10-28');
    expect(md.indexOf('Explain the bond')).toBeLessThan(md.indexOf('Polish the win'));
    expect(md).toContain('[c004 at 03:12](#c004)');
    expect(md).not.toContain('c999');
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe('muse-wonder-1.0');
    expect(calls[0].content[0].text).not.toContain('c005');   // "none" moments are not sent
    expect(await readFile(join(dir, 'fixes.md'), 'utf8')).toBe(md);
  });

  it('makes no call when nothing was flagged', async () => {
    const dir = await setup([moment('c001', 0, 'none'), moment('c002', 5000, 'stuck', 'unanalyzed')]);
    const { client, calls } = stub([]);
    const md = await fixesStage(dir, client);
    expect(calls).toHaveLength(0);
    expect(md).toContain('# Fix list: bond-swap, kid B');
    expect(md).toMatch(/No moments/);
  });
});
