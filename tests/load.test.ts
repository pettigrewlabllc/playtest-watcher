import { describe, it, expect } from 'vitest';
import { draftToPersona } from '../src/persona/load.ts';
import { compile, rulesText } from '../src/persona/compile.ts';
import { reflexDefaults } from '../src/agent/action.ts';

const draft = {
  schema: 'persona/2-draft', name: 'Pat', slug: 'pat', kind: 'person', age: null, adult: true,
  limits: { first_tap_s: { per_game: { 'bond-swap': 3, 'hoard-keeper': 4.5 } }, read_share: { per_game: { 'bond-swap': 0.5 } }, reflex_miss: null },
  drives: { mastery: { pull: 0.4, basis: 'guess', why: 'reads tech news' }, story: { pull: 0.2, basis: 'guess', why: 'comedy' } },
  card: { who: 'Adult, a product manager.', plays_for: 'getting good at things' },
  caveats: ['Designer numbers.'],
};

describe('saved persona files', () => {
  it("takes the person's numbers from the named game and says where they came from", () => {
    const p = draftToPersona(draft as any, 'P', 'continental-drift', 'bond-swap');
    expect(p.limits.first_tap_s.value).toBe(3);
    expect(p.limits.first_tap_s.from).toEqual(['pat on bond-swap']);
    expect(p.limits.error_rate.value).toBeNull();
    expect(p.target_game).toBe('continental-drift');
    expect(p.drives[0].drive).toBe('mastery');
    expect(p.adult).toBe(true);
  });

  it('writes adult prompts without calling them a child, and guesses never become rules', () => {
    const p = draftToPersona(draft as any, 'P', 'x', 'bond-swap');
    const c = compile(p);
    expect(c.rules).toEqual([]);
    const t = rulesText(c, 'P', p.age, p.who);
    expect(t).toContain('Pat: Adult, a product manager.');
    expect(t).not.toMatch(/child|Kids like you/);
  });

  it('takes reflex defaults from the published norms, labelled', () => {
    expect(reflexDefaults(14).reactionMs).toBe(288);
    expect(reflexDefaults(18).reactionMs).toBe(292);
    expect(reflexDefaults(8).note).toMatch(/extrapolated/);
    expect(reflexDefaults(12).note).toMatch(/Rutter et al\. 2020/);
  });
});
