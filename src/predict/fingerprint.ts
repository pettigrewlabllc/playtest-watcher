import { basename } from 'node:path';
import { loadSession, loadQuestionnaire } from './inputs.ts';
import type { Session, Label } from './inputs.ts';
import { buildRows, okMoments } from './rows.ts';

export type Fingerprint = {
  fail_streak_before_negative: number | null; recovery_s: number | null; explore_share: number; read_share: number | null;
  read_dwell_per_100: number | null; attempts_per_min: number; hesitation_new_s: number | null; help_per_fail: number | null;
  first_touch_main_share: number | null; talk_per_min: number | null; reaction_mix: Record<string, number>;
};
export type PlayerFingerprint = {
  letter: string; sessions: string[]; mean: Fingerprint; perGame: Record<string, Fingerprint>;
  said: Record<string, number | null>; did: Record<string, number | null>;
  gaps: { axis: string; said: number; did: number; note: string }[];
};

const READ_CHARS_PER_S = 15;
const NEGATIVE: Label[] = ['frustrated', 'bored'];
// Events that count as "acting on" a new thing.
const ACTING = new Set(['attempt', 'explore', 'help', 'first_touch']);

export const NUMERIC_FIELDS = [
  'fail_streak_before_negative', 'recovery_s', 'explore_share', 'read_share', 'read_dwell_per_100',
  'attempts_per_min', 'hesitation_new_s', 'help_per_fail', 'first_touch_main_share', 'talk_per_min',
] as const;
export type NumericField = typeof NUMERIC_FIELDS[number];

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// A first_touch is on the main action when the game says so (data.main) or the target is tagged main*.
function isMainTouch(data: Record<string, unknown>): boolean {
  if (data.main === true) return true;
  return typeof data.target === 'string' && /^main/i.test(data.target);
}

export function fingerprintOf(s: Session): Fingerprint {
  const events = s.aligned.events;
  const rows = buildRows(s.id, s.meta.game, s.aligned, s.moments);
  const durationMin = (s.aligned.durationMs || (events.length ? events[events.length - 1].ms : 0)) / 60000;
  const count = (kind: string) => events.filter(e => e.kind === kind).length;

  // Fail streak before the first frustrated or bored moment.
  let streak: number | null = null;
  if (s.moments !== null) {
    const first = okMoments(s.moments).filter(m => NEGATIVE.includes(m.label)).sort((a, b) => a.startMs - b.startMs)[0];
    if (first) {
      const inWin = rows.filter(r => r.ms >= first.startMs && r.ms <= first.endMs).map(r => r.fail_streak);
      streak = inWin.length ? Math.max(...inWin) : (rows.filter(r => r.ms < first.startMs).pop()?.fail_streak ?? 0);
    }
  } else {
    const r = rows.find(x => NEGATIVE.includes(x.label));
    if (r) streak = r.fail_streak;
  }

  // Seconds from each fail to the next attempt.
  const recoveries: number[] = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i].kind !== 'fail') continue;
    const next = events.slice(i + 1).find(e => e.kind === 'attempt');
    if (next) recoveries.push((next.ms - events[i].ms) / 1000);
  }

  // Reading: shown text that was later closed, matched by id (else in order).
  const open: { id: string | null; ms: number; chars: number }[] = [];
  const dwells: { s: number; chars: number }[] = [];
  for (const e of events) {
    const id = typeof e.data.id === 'string' ? e.data.id : null;
    if (e.kind === 'text_shown') open.push({ id, ms: e.ms, chars: typeof e.data.chars === 'number' ? e.data.chars : 0 });
    else if (e.kind === 'text_closed') {
      const at = id ? open.findIndex(t => t.id === id) : 0;
      if (at >= 0) { const [t] = open.splice(at, 1); dwells.push({ s: (e.ms - t.ms) / 1000, chars: t.chars }); }
    }
  }
  const read_share = dwells.length ? dwells.filter(d => d.s >= d.chars / READ_CHARS_PER_S).length / dwells.length : null;
  const read_dwell_per_100 = median(dwells.filter(d => d.chars > 0).map(d => (d.s / d.chars) * 100));

  // Gap before acting on each new_thing.
  const hes: number[] = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i].kind !== 'new_thing') continue;
    const next = events.slice(i + 1).find(e => ACTING.has(e.kind));
    if (next) hes.push((next.ms - events[i].ms) / 1000);
  }

  const touches = events.filter(e => e.kind === 'first_touch');
  const kidTurns = s.transcript ? s.transcript.turns.filter(t => t.who === 'kid').length : null;

  const mix: Record<string, number> = {};
  const real = okMoments(s.moments);
  for (const m of real) mix[m.label] = (mix[m.label] ?? 0) + 1;
  for (const k of Object.keys(mix)) mix[k] /= real.length;

  const fails = count('fail');
  return {
    fail_streak_before_negative: streak,
    recovery_s: median(recoveries),
    explore_share: events.length ? count('explore') / events.length : 0,
    read_share, read_dwell_per_100,
    attempts_per_min: durationMin > 0 ? count('attempt') / durationMin : 0,
    hesitation_new_s: median(hes),
    help_per_fail: fails ? count('help') / fails : null,
    first_touch_main_share: touches.length ? touches.filter(e => isMainTouch(e.data)).length / touches.length : null,
    talk_per_min: kidTurns !== null && durationMin > 0 ? kidTurns / durationMin : null,
    reaction_mix: mix,
  };
}

export async function sessionFingerprint(dir: string): Promise<Fingerprint> {
  return fingerprintOf(await loadSession(dir));
}

function meanOf(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x !== null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

// Field-wise mean, ignoring nulls; reaction_mix averaged over sessions that have one.
export function averageFingerprints(fps: Fingerprint[]): Fingerprint {
  const out = {} as Record<string, unknown>;
  for (const f of NUMERIC_FIELDS) out[f] = meanOf(fps.map(fp => fp[f]));
  out.explore_share = meanOf(fps.map(fp => fp.explore_share)) ?? 0;
  out.attempts_per_min = meanOf(fps.map(fp => fp.attempts_per_min)) ?? 0;
  const mixes = fps.map(fp => fp.reaction_mix).filter(m => Object.keys(m).length);
  const mix: Record<string, number> = {};
  for (const m of mixes) for (const [k, v] of Object.entries(m)) mix[k] = (mix[k] ?? 0) + v / mixes.length;
  out.reaction_mix = mix;
  return out as Fingerprint;
}

// Typical values for ages 8 to 14, used for z-scores until there are three or more players to compare against.
const PRIORS: Record<NumericField, { mean: number; sd: number }> = {
  fail_streak_before_negative: { mean: 4, sd: 2 }, recovery_s: { mean: 3, sd: 2 }, explore_share: { mean: 0.1, sd: 0.08 },
  read_share: { mean: 0.5, sd: 0.25 }, read_dwell_per_100: { mean: 6, sd: 3 }, attempts_per_min: { mean: 20, sd: 10 },
  hesitation_new_s: { mean: 3, sd: 2 }, help_per_fail: { mean: 0.2, sd: 0.2 }, first_touch_main_share: { mean: 0.7, sd: 0.2 },
  talk_per_min: { mean: 3, sd: 2 },
};

function zscore(x: number, field: NumericField, population: Fingerprint[]): number {
  const vals = population.map(p => p[field]).filter((v): v is number => v !== null && Number.isFinite(v));
  let mean = PRIORS[field].mean, sd = PRIORS[field].sd;
  if (vals.length >= 3) {
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const s = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length);
    if (s > 1e-9) { mean = m; sd = s; }
  }
  return (x - mean) / sd;
}

const clamp = (x: number) => Math.max(-1, Math.min(1, x));
const num = (v: number | null): v is number => v !== null && Number.isFinite(v);

// Maps the fingerprint onto the questionnaire axes on the same -1..+1 scale. In the questionnaire -1 is the "A" end
// (explore, read, stick with it, look, show, fast), so a high z on the A behaviour gives a negative score.
export function didAxes(fp: Fingerprint, population: Fingerprint[] = []): Record<string, number | null> {
  const z = (f: NumericField) => (num(fp[f]) ? zscore(fp[f] as number, f, population) : null);
  const avg = (xs: (number | null)[]) => { const m = meanOf(xs); return m === null ? null : clamp(-m); };
  const persist = [z('fail_streak_before_negative'), num(fp.recovery_s) ? -(z('recovery_s') as number) : null];
  const pace = [z('attempts_per_min'), num(fp.hesitation_new_s) ? -(z('hesitation_new_s') as number) : null];
  return {
    explore: avg([z('explore_share')]),
    read: num(fp.read_share) ? clamp(1 - 2 * fp.read_share) : null,
    challenge: null,
    persist: avg(persist),
    look: null,
    social: avg([z('talk_per_min')]),
    pace: avg(pace),
  };
}

const ENDS: Record<string, [string, string]> = {
  explore: ['explore', 'go straight for the goal'], read: ['read', 'skip ahead and try'], challenge: ['want a challenge', 'keep it easy'],
  persist: ['stick with it', 'walk away'], look: ['go for the look', 'go for the system'], social: ['show people', 'play solo'], pace: ['play fast', 'play careful'],
};

export async function playerFingerprint(letter: string, sessionDirs: string[], population: Fingerprint[] = []): Promise<PlayerFingerprint> {
  const sessions = await Promise.all(sessionDirs.map(loadSession));
  const fps = sessions.map(fingerprintOf);
  const byGame: Record<string, Fingerprint[]> = {};
  sessions.forEach((s, i) => (byGame[s.meta.game] ??= []).push(fps[i]));
  const perGame = Object.fromEntries(Object.entries(byGame).map(([g, xs]) => [g, averageFingerprints(xs)]));
  const mean = averageFingerprints(fps);

  const q = sessionDirs.length ? await loadQuestionnaire(sessionDirs[0], letter) : null;
  const said: Record<string, number | null> = {};
  for (const a of Object.keys(ENDS)) { const v = q?.scores?.[a]; said[a] = typeof v === 'number' ? v : null; }
  const did = didAxes(mean, population);

  const gaps: PlayerFingerprint['gaps'] = [];
  for (const axis of Object.keys(ENDS)) {
    const s = said[axis], d = did[axis];
    if (s === null || d === null || Math.abs(s - d) < 0.75) continue;
    const [a, b] = ENDS[axis];
    const phrase = (v: number) => (v < 0 ? `would ${a}` : `would ${b}`);
    gaps.push({ axis, said: s, did: d, note: `says they ${phrase(s)} (${s.toFixed(2)}), plays like they ${phrase(d)} (${d.toFixed(2)})` });
  }
  return { letter, sessions: sessionDirs.map(d => basename(d)), mean, perGame, said, did, gaps };
}
