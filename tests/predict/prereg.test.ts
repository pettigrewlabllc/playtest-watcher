import { describe, it, expect } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensurePreregistration } from '../../src/predict/freeze.ts';
import { pairedCounts, scoreItems } from '../../src/predict/score.ts';
import type { RealMoment } from '../../src/predict/score.ts';
import { tempRoot } from './helpers.ts';

describe('pre-registration in docs/frozen-predictions.md', () => {
  it('a new doc names the single primary metric and the paired presentation, above the hash table', async () => {
    const root = await tempRoot();
    const doc = join(root, 'frozen.md');
    await ensurePreregistration(doc, root);
    const text = await readFile(doc, 'utf8');
    expect(text).toMatch(/Primary metric:\*\* stage-level Cohen's kappa/);
    expect(text).toMatch(/matched budget/);
    expect(text).toMatch(/paired hit\/miss counts per predictor/);
    expect(text.indexOf('Pre-registered analysis')).toBeLessThan(text.indexOf('| Check |'));
    await ensurePreregistration(doc, root);
    expect(await readFile(doc, 'utf8')).toBe(text);   // written once
  });

  it('adds it to an older doc above its table, but never after a check session has been scored', async () => {
    const root = await tempRoot();
    const doc = join(root, 'frozen.md');
    const old = '# Frozen predictions\n\n| Check | Predictor | SHA-256 | Frozen at |\n| --- | --- | --- | --- |\n| c1 | null | abc | t |\n';
    await writeFile(doc, old);
    await ensurePreregistration(doc, root);
    const text = await readFile(doc, 'utf8');
    expect(text.indexOf('Pre-registered analysis')).toBeLessThan(text.indexOf('| Check |'));
    expect(text).toContain('| c1 | null | abc | t |');

    const late = await tempRoot();
    const doc2 = join(late, 'frozen.md');
    await writeFile(doc2, old);
    await writeFile(join(late, 'scoreboard.json'), JSON.stringify({ players: { A: { predictors: { null: { check: { recall: 0.5 } } } } } }));
    await expect(ensurePreregistration(doc2, late)).rejects.toThrow(/before any check score/);
    expect(await readFile(doc2, 'utf8')).toBe(old);
  });
});

describe('paired hit/miss counts', () => {
  it('counts hits per predictor over the same real moments and splits them against null', () => {
    const real: RealMoment[] = [
      { id: 'm1', label: 'stuck', stage: '1', event_type: 'x', confidence: 0.9 },
      { id: 'm2', label: 'frustrated', stage: '2', event_type: 'x', confidence: 0.9 },
      { id: 'm3', label: 'bored', stage: '3', event_type: 'x', confidence: 0.9 },
    ];
    const order = ['1', '2', '3'];
    const it = (stage: string, label: string) => ({ stage, event_type: 'x', label, p: 0.5, why: '' });
    const nul = scoreItems([it('1', 'stuck'), it('2', 'confused')], real, order);
    const persona = scoreItems([it('2', 'frustrated'), it('3', 'bored')], real, order);
    const p = pairedCounts({ null: nul, persona });
    expect(p.persona).toEqual({ hits: 2, misses: 1, vs_null: { both: 0, only_this: 2, only_null: 1, neither: 0 } });
    expect(p.null).toEqual({ hits: 1, misses: 2, vs_null: { both: 1, only_this: 0, only_null: 0, neither: 2 } });
  });
});
