import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cohenKappa, reliability, reliabilityLine } from '../../src/predict/reliability.ts';
import { kendallTau, rankingCheck } from '../../src/predict/score.ts';
import { ev, moment, tempRoot, writeSession } from './helpers.ts';

describe('label reliability', () => {
  it('computes Cohen kappa overall and per label between Joel and Muse', async () => {
    const root = await tempRoot();
    const ms = [moment('c1', 0, 1, 'frustrated'), moment('c2', 2, 3, 'frustrated'), moment('c3', 4, 5, 'bored'), moment('c4', 6, 7, 'delighted')];
    const dir = await writeSession(root, 's1', { events: [ev(0, 'attempt')], moments: ms });
    await writeFile(join(dir, 'labels.json'), JSON.stringify({ c1: 'frustrated', c2: 'stuck', c3: 'bored', c4: 'delighted', zz: 'bored' }));
    await writeSession(root, 's2', { events: [ev(0, 'attempt')], moments: [moment('c1', 0, 1, 'stuck')] });   // no labels: ignored
    const r = await reliability(root);
    expect(r.n).toBe(4);   // zz has no Muse moment
    // Joel: f, s, b, d; Muse: f, f, b, d. po = 3/4; pe = (1/4*2/4) + (1/4*0) + (1/4*1/4) + (1/4*1/4) = 1/4
    expect(r.kappa).toBeCloseTo((0.75 - 0.25) / 0.75);
    expect(r.per_label.bored.kappa).toBeCloseTo(1);
    expect(r.below_gate).toBe(false);
    expect(reliabilityLine(r)).toMatch(/kappa 0\.67/);
    expect(reliabilityLine({ ...r, kappa: 0.4, below_gate: true })).toMatch(/below 0\.6/);
    expect(reliabilityLine(await reliability(await tempRoot()))).toMatch(/no hand labels/);
  });

  it('kappa is null when there is nothing to compare', () => {
    expect(cohenKappa([], [])).toBeNull();
    expect(cohenKappa(['a', 'a'], ['a', 'a'])).toBeNull();
  });
});

describe('ranking check', () => {
  it('Kendall tau between the kid order and predicted enjoyment', async () => {
    expect(kendallTau(['a', 'b', 'c'], { a: 3, b: 2, c: 1 })).toBe(1);
    expect(kendallTau(['a', 'b'], { a: 0, b: 1 })).toBe(-1);
    expect(kendallTau(['a', 'b', 'c'], { a: 1, c: 0 })).toBe(1);   // b unpredicted: only the a-c pair counts
    expect(kendallTau(['a'], { a: 1 })).toBeNull();
    const root = await tempRoot();
    await mkdir(join(root, 'kids', 'd'), { recursive: true });
    await writeFile(join(root, 'kids', 'd', 'ranking.json'), JSON.stringify({ order: ['g1', 'g2'] }));
    const report = { folds: [{ game: 'g1', enjoyment: { 'model-traits': 0.2, 'model-kid': -0.1 } }, { game: 'g2', enjoyment: { 'model-traits': 0.1, 'model-kid': 0.3 } }] };
    const r = await rankingCheck('D', report, root);
    expect(r).toEqual({ order: ['g1', 'g2'], tau: { 'model-traits': 1, 'model-kid': -1 }, n: 2 });
    expect(await rankingCheck('A', report, root)).toBeNull();
  });
});
