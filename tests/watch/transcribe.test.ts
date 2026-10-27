import { describe, it, expect } from 'vitest';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { transcribe, keywordsFor } from '../../src/watch/transcribe.ts';
import { createMetaClient, type MetaClient } from '../../src/meta/client.ts';
import { tmp } from './helpers.ts';

async function setup(session: object = { game: 'bond-swap' }, events: unknown[] = []) {
  const dir = await tmp();
  await writeFile(join(dir, 'aligned.json'), JSON.stringify({
    t0: 0, durationMs: 1_300_000, tracks: {}, events,
    audio: { offsetMs: 50, wavChunks: [{ file: 'mic_000.wav', startMs: 0 }, { file: 'mic_001.wav', startMs: 570_000 }] },
  }));
  await writeFile(join(dir, 'session.json'), JSON.stringify(session));
  return dir;
}

function stub(perChunk: { speaker: string; startMs: number; endMs: number; text: string }[][]): MetaClient {
  const base = createMetaClient({ live: false, budgetUsd: 1, spendLog: '/dev/null' });
  let i = 0;
  return { ...base, transcribe: async () => ({ turns: perChunk[i++], audioDurationMs: 1 }) };
}

describe('transcribe', () => {
  it('shifts times per chunk, re-keys speakers and picks the longest talker as the kid', async () => {
    const dir = await setup();
    const client = stub([
      [{ speaker: 'A', startMs: 1000, endMs: 2000, text: 'hm' }, { speaker: 'B', startMs: 3000, endMs: 9000, text: 'what is this' }],
      [{ speaker: 'A', startMs: 500, endMs: 8000, text: 'oh cool' }, { speaker: 'B', startMs: 9000, endMs: 9500, text: 'yes' }],
    ]);
    const t = await transcribe(dir, client);
    expect(t.turns.map(x => [x.startMs, x.speaker, x.who])).toEqual([
      [1050, '0:A', 'adult'],
      [3050, '0:B', 'kid'],
      [570_550, '1:A', 'kid'],
      [579_050, '1:B', 'adult'],
    ]);
    expect(JSON.parse(await readFile(join(dir, 'transcript.json'), 'utf8'))).toEqual(t);
  });

  it('a single speaker in a chunk is the kid', async () => {
    const dir = await setup();
    const t = await transcribe(dir, stub([[{ speaker: 'A', startMs: 0, endMs: 100, text: 'x' }], []]));
    expect(t.turns[0].who).toBe('kid');
  });

  it('session.json kidSpeaker overrides the heuristic', async () => {
    const dir = await setup({ game: 'g', kidSpeaker: 'A' });
    const t = await transcribe(dir, stub([
      [{ speaker: 'A', startMs: 0, endMs: 100, text: 'short' }, { speaker: 'B', startMs: 200, endMs: 9000, text: 'long' }],
      [],
    ]));
    expect(t.kidSpeaker).toBe('A');
    expect(t.turns.map(x => x.who)).toEqual(['kid', 'adult']);
  });

  it('works with no audio', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'aligned.json'), JSON.stringify({ t0: 0, durationMs: 1, tracks: {}, events: [] }));
    expect((await transcribe(dir, stub([]))).turns).toEqual([]);
  });

  it('builds keywords from the game and event types', () => {
    const kw = keywordsFor('hoard-keeper', [{ ms: 0, type: 'molecule_bonded', kind: 'progress', data: {} }, { ms: 1, type: 'audit_start', kind: 'progress', data: {} }]);
    expect(kw).toEqual(expect.arrayContaining(['hoard keeper', 'molecule', 'bonded', 'audit']));
    expect(kw).not.toContain('start');
  });
});
