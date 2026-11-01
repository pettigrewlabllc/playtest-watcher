// Limits for a real-time game the kids haven't played (live play in real time, src/agent/realtime.ts).
//
// What is measured and what is assumed, plainly:
//   - measured: everything the persona engine already measures (dimensions, drives, fail streak, first tap, reading),
//     plus the slip rate, which is the kid's own error rate on Factor Slicer, the only real-time game they played
//     (a wrong cut under a moving blade). Here it is the chance a press is fumbled: badly mistimed, or not made.
//   - assumed: split-second reaction time and the spread of a timed press. None of the four games times a reaction
//     to something appearing, so these are rough age norms from the developmental literature on simple visual
//     reaction time and coincidence-anticipation timing (both shorten and tighten through childhood into the
//     teens). They are labelled `assumed` in every persona file and run, and are never presented as the kids'.
import { buildPersonaFile, type PersonaFile, type Limit } from './build.ts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// [age, simple visual reaction time ms, sd of a timed press against something approaching, ms]
export const AGE_NORMS: [number, number, number][] = [[6, 520, 110], [8, 450, 90], [10, 390, 75], [12, 350, 65], [14, 310, 55], [18, 260, 40]];
export const AGE_NORMS_SOURCE = 'assumed: rough developmental age norms for simple visual reaction time and for the spread of a press timed '
  + 'to something approaching; not measured from these kids (none of their four games times a reaction)';

export function reactionFor(age: number | null): { rtMs: number; timingSdMs: number } {
  const a = age ?? 10, N = AGE_NORMS;
  if (a <= N[0][0]) return { rtMs: N[0][1], timingSdMs: N[0][2] };
  for (let i = 1; i < N.length; i++) {
    if (a <= N[i][0]) {
      const [a0, r0, s0] = N[i - 1], [a1, r1, s1] = N[i], k = (a - a0) / (a1 - a0);
      return { rtMs: Math.round(r0 + (r1 - r0) * k), timingSdMs: Math.round(s0 + (s1 - s0) * k) };
    }
  }
  return { rtMs: N.at(-1)![1], timingSdMs: N.at(-1)![2] };
}

export type Realtime = { rtMs: number; timingSdMs: number; slipRate: number; nearest: string; source: { reaction: string; slip: string } };
export type RealtimePersona = PersonaFile & { realtime: Realtime };

// The persona for a new real-time game: dimensions and drives as always; limits measured on the nearest real-time
// game the kid did play (their own numbers there, not a transfer, since the target has no reference run).
export async function buildRealtimePersona(root: string, letter: string, target: string, nearest = 'factor-slicer'): Promise<RealtimePersona> {
  const base = await buildPersonaFile(root, letter, nearest);
  const L = letter.toUpperCase();
  const lim = JSON.parse(await readFile(join(root, 'group', 'limits.json'), 'utf8'));
  const own: Record<string, number | null> | undefined = lim.per_game?.[L]?.[nearest];
  if (!own) throw new Error(`no measured ${nearest} limits for ${L}`);
  const limits = { ...base.limits };
  for (const [m, v] of Object.entries(own)) limits[m] = { value: v, ratio: null, lo: null, hi: null, from: [`measured:${nearest}`] } as Limit;
  const slip = Math.max(0, Math.min(0.5, own.error_rate ?? 0.15));
  return {
    ...base, target_game: target, limits,
    realtime: {
      ...reactionFor(base.age), slipRate: slip, nearest,
      source: { reaction: AGE_NORMS_SOURCE, slip: `measured: Player ${L}'s error rate on ${nearest} (${(slip * 100).toFixed(0)}%), used as the chance a press is fumbled` },
    },
  };
}
