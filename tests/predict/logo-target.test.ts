import { describe, it, expect } from 'vitest';
import { logo, meanScores } from '../../src/predict/score.ts';
import { failStream, recordingClient, tempRoot, writeSession } from './helpers.ts';

// A learns g1, g2, g3. g2 has a reference playthrough, g1 only another kid's learn session, g3 nothing else.
async function world() {
  const root = await tempRoot();
  for (const [i, g] of ['g1', 'g2', 'g3'].entries()) {
    const { events, moments } = failStream(i);
    await writeSession(root, `a-${g}-learn`, { kid: 'A', game: g, events, moments });
  }
  const b = failStream(7);
  await writeSession(root, 'b-g1-learn', { kid: 'B', game: 'g1', events: b.events, moments: b.moments });
  await writeSession(root, 'ref-g2', { kid: 'ref', game: 'g2', round: 'reference', events: failStream(8).events });
  return root;
}

describe('logo predicts a reference target and scores against the kid\'s own session', () => {
  it('uses the reference, else another kid\'s learn session, else tags a self-target fold and leaves it out of the mean', async () => {
    const root = await world();
    const client = recordingClient();
    const rep = await logo('A', client, { root, log: () => {}, predictors: ['null', 'baseline'], variants: false });
    const fold = (g: string) => rep.folds.find(f => f.game === g)!;
    expect(fold('g1')).toMatchObject({ target: 'b-g1-learn' });
    expect(fold('g1').self_target).toBeFalsy();
    expect(fold('g2')).toMatchObject({ target: 'ref-g2' });
    expect(fold('g3')).toMatchObject({ target: 'a-g3-learn', self_target: true });

    const kinds = client.calls.map(c => c.kind);
    expect(kinds).toContain('predict:A:baseline:b-g1-learn');
    expect(kinds).toContain('predict:A:baseline:ref-g2');
    expect(kinds).not.toContain('predict:A:baseline:a-g1-learn');

    const headline = meanScores([fold('g1').scores.null!, fold('g2').scores.null!]);
    expect(rep.mean.null?.recall).toBeCloseTo(headline.recall!);
    expect(rep.mean.null?.kappa ?? null).toEqual(headline.kappa ?? null);
  }, 180_000);
});
