import { describe, it, expect } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { venvAvailable } from '../../src/predict/model.ts';
import { buildGroupModel, groupDir, kidTraits } from '../../src/predict/traits.ts';
import { ev, failStream, tempRoot, writeSession } from './helpers.ts';

describe.skipIf(!venvAvailable())('group model: AFM and traits (needs analysis/.venv)', () => {
  it('builds rows, afm.json and traits.json for every kid from learn sessions only', async () => {
    const root = await tempRoot();
    for (const [i, kid] of ['A', 'B'].entries()) {
      const events = failStream(i).events.flatMap(e => (e.kind === 'success' ? [ev(e.ms - 1, 'attempt'), e] : [e]));
      const evs = [ev(0, 'progress', {}, 'run_start'), ...events.map(e => ({ ...e, ms: e.ms + 10 })), ev(events.at(-1)!.ms + 20, 'progress', {}, 'run_start'), ev(events.at(-1)!.ms + 500, 'explore', {}, 'compendium_open')];
      await writeSession(root, `${kid.toLowerCase()}-g1-learn`, { kid, game: 'g1', events: evs });
    }
    await writeSession(root, 'ref-g1', { kid: 'ref', game: 'g1', round: 'reference', events: [ev(0, 'attempt'), ev(100, 'fail')] });
    await mkdir(join(root, 'kids', 'a'), { recursive: true });
    await writeFile(join(root, 'kids', 'a', 'debriefs.json'), JSON.stringify([{ game: 'g1', session: 'a-g1-learn', answers: [{ q: 'The Compendium?', a: 'accidentally', intent: 'accidental' }] }]));
    await writeFile(join(root, 'kids.json'), JSON.stringify({ A: { age: 9, name: 'NOT-IN-OUTPUT' }, B: { age: 12, name: 'NOT-IN-OUTPUT' } }));

    const g = await buildGroupModel({ root, boot: 20 });
    expect(Object.keys(g.traits.kids).sort()).toEqual(['A', 'B']);
    const a = kidTraits(g.traits, "A")!;
    expect(a.traits.recovery.per_game.g1.adjusted).toBe(true);
    expect(a.traits.skill.per_game.g1.value).not.toBeNull();
    expect(a.traits.frustration_tolerance.value).toBeNull();
    expect(a.intents).toEqual([{ session: 'a-g1-learn', type: 'compendium_open', intent: 'accidental' }]);
    const files = await Promise.all(['traits.json', 'afm.json', 'all_rows.csv'].map(f => readFile(join(groupDir({ root }), f), 'utf8')));
    expect(files.join('')).not.toContain('NOT-IN-OUTPUT');
    expect(files[2]).not.toContain('ref-g1');
  }, 60000);
});
