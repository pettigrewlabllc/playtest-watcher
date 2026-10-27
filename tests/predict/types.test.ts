import { describe, it, expect } from 'vitest';
import { playerTypes, nearestType } from '../../src/predict/types.ts';
import type { Fingerprint } from '../../src/predict/fingerprint.ts';

function fp(o: Partial<Fingerprint>): Fingerprint {
  return {
    fail_streak_before_negative: 4, recovery_s: 3, explore_share: 0.1, read_share: 0.5, read_dwell_per_100: 6,
    attempts_per_min: 20, hesitation_new_s: 3, help_per_fail: 0.2, first_touch_main_share: 0.7, talk_per_min: 3,
    reaction_mix: {}, ...o,
  };
}

// Two obvious clusters: explorers who read and talk, and fast grinders who skim and stay quiet.
const explorers = [fp({ explore_share: 0.4, read_share: 0.9, talk_per_min: 6 }), fp({ explore_share: 0.38, read_share: 0.85, talk_per_min: 5.5 }), fp({ explore_share: 0.42, read_share: 0.95, talk_per_min: 6.5 })];
const grinders = [fp({ explore_share: 0.02, read_share: 0.1, talk_per_min: 0.5, attempts_per_min: 50 }), fp({ explore_share: 0.03, read_share: 0.15, talk_per_min: 0.4, attempts_per_min: 48 }), fp({ explore_share: 0.01, read_share: 0.05, talk_per_min: 0.6, attempts_per_min: 52 })];

describe('playerTypes', () => {
  it('finds two obvious clusters and names them from their extreme fields', () => {
    const t = playerTypes([...explorers, ...grinders], 2);
    expect(t.types).toHaveLength(2);
    const a = t.types.find(x => x.members.includes(0))!;
    const b = t.types.find(x => x.members.includes(3))!;
    expect(a.members.sort()).toEqual([0, 1, 2]);
    expect(b.members.sort()).toEqual([3, 4, 5]);
    expect(a.name).toMatch(/explores a lot|reads text|talks a lot/);
    expect(b.name).toMatch(/stays on the main path|skims text|plays quietly|plays fast/);
    expect(a.name).not.toBe(b.name);
    expect(a.centroid.explore_share).toBeCloseTo(0.4, 1);
  });

  it('is deterministic', () => {
    const all = [...explorers, ...grinders];
    expect(JSON.stringify(playerTypes(all, 2))).toBe(JSON.stringify(playerTypes(all, 2)));
  });

  it('defaults k to min(3, players - 1) and marks under 6 players illustrative', () => {
    expect(playerTypes([...explorers, grinders[0]]).types).toHaveLength(3);
    expect(playerTypes([explorers[0], grinders[0]]).types).toHaveLength(1);
    expect(playerTypes([...explorers, ...grinders]).confidence).toBe('ok');
    expect(playerTypes([...explorers, grinders[0]]).confidence).toBe('illustrative');
  });

  it('puts a thin player in the nearest type, treating missing fields as average', () => {
    const t = playerTypes([...explorers, ...grinders], 2);
    const thin = fp({ explore_share: 0.35, read_share: null, talk_per_min: null, recovery_s: null, hesitation_new_s: null });
    expect(nearestType(t, thin).members).toContain(0);
    expect(nearestType(t, fp({ explore_share: 0.02, attempts_per_min: 49 })).members).toContain(3);
  });

  it('handles all-null columns without NaN', () => {
    const t = playerTypes([fp({ talk_per_min: null }), fp({ talk_per_min: null, explore_share: 0.5 })], 1);
    expect(Number.isNaN(t.types[0].centroid.talk_per_min)).toBe(false);
  });
});
