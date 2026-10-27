import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { trainPlayer, predictRows, venvAvailable } from '../../src/predict/model.ts';
import { sessionRows, writeRowsCsv } from '../../src/predict/rows.ts';
import { ev, moment, tempRoot, writeSession } from './helpers.ts';
import type { AlignedEvent } from '../../src/predict/inputs.ts';

// Deterministic stream: runs of fails of length 1..6; a frustrated moment covers every run of 4 or more.
function stream(seed: number) {
  const events: AlignedEvent[] = [];
  const moments = [];
  let ms = 0;
  for (let r = 0; r < 40; r++) {
    const len = 1 + ((r * 7 + seed * 3) % 6);
    const start = ms;
    for (let k = 0; k < len; k++) { events.push(ev(ms, 'attempt')); ms += 500; events.push(ev(ms, 'fail')); ms += 500; }
    if (len >= 4) moments.push(moment(`m${seed}-${r}`, start + 3000, ms, 'frustrated', 0.9));
    events.push(ev(ms, 'success')); ms += 1000;
  }
  return { events, moments };
}

describe.skipIf(!venvAvailable())('model wrapper (needs analysis/.venv)', () => {
  it('trains on session folders and predicts rows of another session', async () => {
    const root = await tempRoot();
    const dirs: string[] = [];
    for (const [i, g] of ['g1', 'g2', 'g3'].entries()) {
      const { events, moments } = stream(i);
      dirs.push(await writeSession(root, `a-${g}-learn`, { game: g, events, moments }));
    }
    const res = await trainPlayer('A', dirs, { root });
    expect(res.cv.folds).toHaveLength(3);
    expect(res.importances.length).toBeGreaterThan(0);
    expect(res.weakLabels).toBe(false);

    const target = stream(7);
    const tdir = await writeSession(root, 'ref-g4', { game: 'g4', events: target.events });
    const csv = join(root, 'target.csv');
    const rows = await sessionRows(tdir);
    await writeRowsCsv(rows, csv);
    const probs = await predictRows('A', csv, { root });
    expect(probs).toHaveLength(rows.length);
    expect(probs[0].stage).toBe('start');
    const sum = Object.values(probs[0].p).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  }, 120_000);
});

if (!venvAvailable()) console.warn('model.test.ts skipped: analysis/.venv not found (uv venv analysis/.venv && uv pip install -p analysis/.venv -r analysis/requirements.txt)');
