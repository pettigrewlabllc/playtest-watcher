import { describe, it, expect } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseEvents } from '../../src/watch/align.ts';
import { tmp } from './helpers.ts';

const T0 = 1_000_000;

describe('parseEvents: event time is the game clock, corrected by its median skew', () => {
  it('uses t minus the per-session median of t - serverT; serverT (quantised to 500 ms batches) only sets the skew', async () => {
    const dir = await tmp();
    const lines = [
      { t: T0 + 2400, type: 'a', data: { kind: 'attempt' }, serverT: T0 + 500 },
      { t: T0 + 2600, type: 'b', data: { kind: 'fail' }, serverT: T0 + 500 },
      { t: T0 + 3100, type: 'c', data: { kind: 'success' }, serverT: T0 + 1000 },
    ];
    await writeFile(join(dir, 'events.jsonl'), lines.map(l => JSON.stringify(l)).join('\n') + '\n');
    const { events, skew } = await parseEvents(dir, T0);
    expect(skew).toBe(2100);
    expect(events.map(e => [e.type, e.ms])).toEqual([['a', 300], ['b', 500], ['c', 1000]]);
  });

  it('falls back to serverT for an event without its own clock', async () => {
    const dir = await tmp();
    const lines = [{ t: T0 + 100, type: 'a', data: {}, serverT: T0 + 500 }, { type: 'b', data: {}, serverT: T0 + 900 }];
    await writeFile(join(dir, 'events.jsonl'), lines.map(l => JSON.stringify(l)).join('\n') + '\n');
    const { events } = await parseEvents(dir, T0);
    expect(events.map(e => [e.type, e.ms])).toEqual([['a', 500], ['b', 900]]);
  });
});
