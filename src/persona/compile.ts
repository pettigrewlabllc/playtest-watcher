// Persona file -> rules any agent can follow, plus the settings the harness enforces (spec §6). Only dimensions
// that are clearly different from the other kids, and drives the kid felt strongly about, become rules.
import type { PersonaFile } from './build.ts';

export type Harness = { firstTapS: number; actionGapS: number; readShare: number; readMsPerChar: number; errorRate: number; sourAfterFails: number };
export type Compiled = { rules: { text: string; from: string }[]; harness: Harness };

const DIM_RULES: Record<string, [string, string]> = {   // [when clearly below the group, when clearly above]
  skill: ['You often get things wrong the first time; expect to fail and retry.', 'You pick things up fast; once a rule clicks you play quickly and confidently.'],
  exploration_drive: ['Stick to the obvious next step. Ignore side menus, extra buttons and anything that is not the goal.', 'Before the obvious next step, try one thing you have not touched yet.'],
  pace: ['Take your time; you are not in a hurry.', 'Move fast; act as soon as you have a guess.'],
  recovery: ['After a fail, pause before trying again.', 'After a fail, try again right away.'],
  persistence: ['If something fails twice, think about giving up on it.', 'Keep going after fails; you do not give up easily.'],
  reading: ['Skip instructions; act on your gut.', 'Read instructions before acting.'],
  challenge_appetite: ['Easy wins are fine with you.', 'Easy, repetitive play bores you; say so.'],
  learning_rate: ['It takes you a while to get better at something.', 'You get better quickly with practice.'],
  stamina: ['You tire out over a session; patience drops after a few minutes.', 'You stay steady for a whole session.'],
  confusion_resolves: ['When confused, you tend to get frustrated.', 'When confused, you usually work it out.'],
  frustration_tolerance: ['A couple of fails in a row sours you.', 'Fails roll off you.'],
};

const n = (x: number | null | undefined, d: number) => (x == null || !Number.isFinite(x) ? d : x);

export function compile(p: PersonaFile): Compiled {
  const rules: Compiled['rules'] = [];
  for (const [name, d] of Object.entries(p.dimensions)) {
    if (!d.distinguishable || d.value == null || !DIM_RULES[name]) continue;
    rules.push({ text: DIM_RULES[name][d.value < 0 ? 0 : 1], from: name });
  }
  for (const d of p.drives) {
    if (d.pull >= 0.6) rules.push({ text: `You love games about ${d.drive}; notice and enjoy it when this game has some.`, from: `drive:${d.drive}` });
    if (d.pull <= -0.6) rules.push({ text: `Games about ${d.drive} put you off; say so if this game is like that.`, from: `drive:${d.drive}` });
  }
  // The interview's quit reasons stay on the card (for people) and out of the rules: told to treat them as
  // background, the model still recited the kid's own words. The drives and dimensions carry what they mean.
  const L = p.limits;
  return {
    rules,
    harness: {
      firstTapS: n(L.first_tap_s?.value, 3), actionGapS: n(L.action_gap_s?.value, 1.5),
      readShare: Math.max(0, Math.min(1, n(L.read_share?.value, 0.5))), readMsPerChar: n(L.read_ms_per_char?.value, 67),
      errorRate: Math.max(0, Math.min(0.9, n(L.error_rate?.value, 0.15))), sourAfterFails: Math.max(1, Math.round(n(L.sour_after_fails?.value, 3))),
    },
  };
}

export function rulesText(c: Compiled, letter: string, age: number | null): string {
  return [
    `You are playtesting as Player ${letter}${age ? `, a child aged ${age}` : ''}. Play the way they would, not the way an adult or an AI would.`,
    ...c.rules.map(r => `- ${r.text}`),
    `- You read about ${Math.round(c.harness.readShare * 100)}% of instructions; when you skip one you only see its first few words.`,
    `- After ${c.harness.sourAfterFails} fails in a row you are frustrated. Kids like you still keep playing for about ten minutes, even when lost, so keep trying different things; say so if you want to stop.`,
  ].join('\n');
}
