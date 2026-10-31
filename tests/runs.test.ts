import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listRuns, runData, shotPath } from '../src/server/runs.ts';

async function run(base: string, id: string, round = 'agent') {
  await mkdir(join(base, id, 'shots'), { recursive: true });
  await writeFile(join(base, id, 'session.json'), JSON.stringify({ kid: 'a', game: 'hoard-keeper', round }));
  await writeFile(join(base, id, 'persona.json'), JSON.stringify({ persona: { letter: 'A', age: null, target_game: 'hoard-keeper', distinguishable: '1 of 11', observer: { note: 'm' }, card: {}, drives: [] }, compiled: { harness: {} }, rules: '- r' }));
  await writeFile(join(base, id, 'steps.jsonl'), JSON.stringify({ n: 1 }) + '\n');
}

describe('runs page data', () => {
  it('reads runs from recordings and from the committed results copy, once each', async () => {
    const top = await mkdtemp(join(tmpdir(), 'pw-runs-'));
    const rec = join(top, 'recordings'), res = join(top, 'results', 'runs');
    await run(rec, '20261031-204237-a-hoard-keeper-agent');
    await run(res, '20261031-204237-a-hoard-keeper-agent');
    await run(res, '20261031-210817-x-hoard-keeper-agent');
    await run(rec, '20261031-195210-a-hoard-keeper-agent', 'broken');
    const list = await listRuns(rec);
    expect(list.map(r => r.id)).toEqual(['20261031-210817-x-hoard-keeper-agent', '20261031-204237-a-hoard-keeper-agent']);
    expect((await runData(rec, '20261031-210817-x-hoard-keeper-agent')).steps).toHaveLength(1);
    expect(shotPath(rec, '20261031-210817-x-hoard-keeper-agent', '001.jpg')).toBe(join(res, '20261031-210817-x-hoard-keeper-agent', 'shots', '001.jpg'));
    expect(() => shotPath(rec, '20261031-210817-x-hoard-keeper-agent', '../x.jpg')).toThrow();
  });
});
