import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runWatch } from '../../src/watch/run.ts';
import { createMetaClient } from '../../src/meta/client.ts';
import { fakeSession, tmp, T0 } from './helpers.ts';

function syntheticEvents() {
  const ev = (ms: number, type: string, kind: string) => ({ t: T0 + ms - 40, type, data: { kind }, serverT: T0 + ms });
  const out = [];
  for (let i = 0; i < 20; i++) out.push(ev(i * 100, i === 10 || i === 13 ? 'die' : 'swap', i === 10 || i === 13 ? 'fail' : 'progress'));
  for (let i = 0; i < 20; i++) out.push(ev(9500 + i * 100, 'swap', 'progress'));   // 7.6 s after the first batch; the idle event and two fails cover those triggers
  out.push(ev(2500, 'idle', 'other'));
  return out;
}

const quiet = () => {};

describe('runWatch', () => {
  it('runs all five stages in fake mode, skips on a second run, and --force reruns downstream only', async () => {
    const dir = await tmp();
    await fakeSession(dir, { seconds: 12, hands: true, events: syntheticEvents() });
    const client = createMetaClient({ live: false, budgetUsd: 1, spendLog: join(dir, 'spend.jsonl') });

    const first = await runWatch(dir, client, { log: quiet });
    expect(first.ran).toEqual(['align', 'transcribe', 'candidates', 'explain', 'fixes']);
    for (const f of ['aligned.json', 'transcript.json', 'candidates.json', 'moments.json', 'fixes.md']) expect(existsSync(join(dir, f))).toBe(true);
    expect(existsSync(join(dir, 'clips', 'c001.mp4'))).toBe(true);
    expect(existsSync(join(dir, 'spend.jsonl'))).toBe(false);   // fake mode spends nothing

    const second = await runWatch(dir, client, { log: quiet });
    expect(second.ran).toEqual([]);
    expect(second.skipped).toHaveLength(5);

    const third = await runWatch(dir, client, { force: 'candidates', log: quiet });
    expect(third.ran).toEqual(['candidates', 'explain', 'fixes']);
    expect(third.skipped).toEqual(['align', 'transcribe']);
  }, 60000);
});
