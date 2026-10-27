import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Aligned } from './align.ts';
import type { Transcript } from './transcribe.ts';
import { readWavPcm, rmsWindows } from './loudness.ts';

export { rmsWindows };
export type Candidate = { id: string; startMs: number; endMs: number; triggers: string[] };

const BEFORE_MS = 6000;
const AFTER_MS = 8000;
const FAIL_STREAK_MS = 10_000;
const RETRY_COUNT = 3;
const RETRY_SPAN_MS = 5000;
const IDLE_GAP_MS = 8000;
const FAST_PROGRESS_MS = 20_000;
const SWEEP_MS = 60_000;
const RARE_FAILS_PER_MIN = 2;
const BURST_SPAN_MS = 10_000;
const RETRY_MAX_PER_MIN = 6;
const FAST_PROGRESS_FRACTION = 0.4;
const END_TYPE = /(^|_)(end|over|clear|finish|done)$/;
const MAX_WINDOW_MS = 40_000;
const SPLIT_MS = 30_000;

type Trigger = { label: string; from: number; to: number };

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

export function findCandidates(input: {
  durationMs: number; events: Aligned['events']; turns: Transcript['turns']; rms: number[]; rmsWindowMs: number; rmsOffsetMs?: number;
}): Candidate[] {
  // Everything after the operator starts the spoken debrief is talk about the game, not play.
  const debrief = input.events.find(e => e.type === 'debrief_start');
  const durationMs = debrief ? Math.min(input.durationMs, debrief.ms) : input.durationMs;
  const events = input.events.filter(e => e.ms < durationMs && e.kind !== 'note');
  const turns = input.turns.filter(t => t.startMs < durationMs);
  const { rms, rmsWindowMs } = input;
  const triggers: Trigger[] = [];

  const minutes = Math.max(durationMs, 1) / 60_000;

  // Fails. Triggers adapt to the game's pace: in a slow game every fail is worth a look; in a busy one
  // (a swipe game fails every few seconds) only a burst well above the session's own rate is.
  // Fails less than 1 s apart (a wrong cut and the life it costs) count once.
  const fails: Aligned['events'] = [];
  for (const e of events.filter(e => e.kind === 'fail')) {
    if (!fails.length || e.ms - fails[fails.length - 1].ms >= 1000) fails.push(e);
  }
  if (fails.length / minutes <= RARE_FAILS_PER_MIN) {
    let streak: Trigger | undefined;
    let lastFail = -Infinity;
    for (const e of fails) {
      if (streak && e.ms - lastFail <= FAIL_STREAK_MS) streak.to = e.ms;
      else { streak = { label: `fail:${e.type}`, from: e.ms, to: e.ms }; triggers.push(streak); }
      lastFail = e.ms;
    }
  } else {
    const expected = fails.length / (Math.max(durationMs, 1) / BURST_SPAN_MS);
    const need = Math.max(3, Math.ceil(2.5 * expected));
    let burst: Trigger | undefined;
    for (let i = 0; i < fails.length; i++) {
      let j = i;
      while (j + 1 < fails.length && fails[j + 1].ms - fails[i].ms <= BURST_SPAN_MS) j++;
      if (j - i + 1 < need) continue;
      if (burst && fails[i].ms <= burst.to) burst.to = Math.max(burst.to, fails[j].ms);
      else { burst = { label: `fail_burst:${fails[i].type}`, from: fails[i].ms, to: fails[j].ms }; triggers.push(burst); }
    }
  }

  // Retries: the same attempt 3+ times inside 5 s, only for actions that are normally occasional.
  const attempts = new Map<string, number[]>();
  for (const e of events.filter(e => e.kind === 'attempt')) attempts.set(e.type, [...(attempts.get(e.type) ?? []), e.ms]);
  for (const [type, times] of attempts) {
    if (times.length / minutes > RETRY_MAX_PER_MIN) continue;
    for (let i = 0; i + RETRY_COUNT - 1 < times.length; i++) {
      if (times[i + RETRY_COUNT - 1] - times[i] <= RETRY_SPAN_MS) triggers.push({ label: `retry:${type}`, from: times[i], to: times[i + RETRY_COUNT - 1] });
    }
  }

  // idle: an idle event, or 8 s+ between consecutive events
  for (const e of events) if (e.type === 'idle') triggers.push({ label: 'idle', from: e.ms, to: e.ms });
  for (let i = 1; i < events.length; i++) {
    if (events[i].ms - events[i - 1].ms >= IDLE_GAP_MS) triggers.push({ label: 'idle', from: events[i - 1].ms, to: events[i].ms });
  }

  for (const e of events) if (e.kind === 'quit') triggers.push({ label: 'quit', from: e.ms, to: e.ms });

  // The end of a run or level is where pride or frustration shows.
  for (const e of events) if (e.kind === 'progress' && END_TYPE.test(e.type)) triggers.push({ label: 'end', from: e.ms, to: e.ms });

  // Fast progress: faster than this session's usual pace for that kind of progress (or under 20 s when there's
  // too little history to know the usual pace).
  const progressTimes = new Map<string, number[]>();
  for (const e of events.filter(e => e.kind === 'progress')) progressTimes.set(e.type, [...(progressTimes.get(e.type) ?? []), e.ms]);
  for (const times of progressTimes.values()) {
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    const limit = times.length >= 4 ? FAST_PROGRESS_FRACTION * median(gaps) : FAST_PROGRESS_MS;
    gaps.forEach((g, i) => { if (g < limit) triggers.push({ label: 'fast_progress', from: times[i], to: times[i + 1] }); });
  }

  for (const t of turns) if (t.who === 'kid') triggers.push({ label: 'speech', from: t.startMs, to: t.startMs });

  const thresh = Math.max(0.2, 3 * median(rms));
  rms.forEach((v, i) => {
    if (v > thresh) { const ms = i * rmsWindowMs + (input.rmsOffsetMs ?? 0); triggers.push({ label: 'loud', from: ms, to: ms }); }
  });


  // windows, clamped, merged
  const wins = triggers
    .map(t => ({ startMs: Math.max(0, t.from - BEFORE_MS), endMs: Math.min(durationMs, t.to + AFTER_MS), triggers: new Set([t.label]) }))
    .filter(w => w.endMs > w.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  const merged: typeof wins = [];
  for (const w of wins) {
    const last = merged.at(-1);
    if (last && w.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, w.endMs);
      w.triggers.forEach(x => last.triggers.add(x));
    } else merged.push(w);
  }

  // Sweeps make sure quiet stretches still get looked at; skip any that would overlap a real window.
  for (let t = SWEEP_MS / 2; t < durationMs; t += SWEEP_MS) {
    const w = { startMs: Math.max(0, t - BEFORE_MS), endMs: Math.min(durationMs, t + AFTER_MS), triggers: new Set(['sweep']) };
    if (!merged.some(m => w.startMs < m.endMs && w.endMs > m.startMs)) merged.push(w);
  }
  merged.sort((a, b) => a.startMs - b.startMs);

  const pieces: { startMs: number; endMs: number; triggers: string[] }[] = [];
  for (const w of merged) {
    let s = w.startMs;
    while (w.endMs - s > MAX_WINDOW_MS) { pieces.push({ startMs: s, endMs: s + SPLIT_MS, triggers: [...w.triggers] }); s += SPLIT_MS; }
    pieces.push({ startMs: s, endMs: w.endMs, triggers: [...w.triggers] });
  }
  return pieces.map((p, i) => ({ id: `c${String(i + 1).padStart(3, '0')}`, ...p }));
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; } catch { return undefined; }
}

const RMS_WINDOW_MS = 500;

export async function candidatesStage(dir: string): Promise<Candidate[]> {
  const aligned = JSON.parse(await readFile(join(dir, 'aligned.json'), 'utf8')) as Aligned;
  const transcript = await readJson<Transcript>(join(dir, 'transcript.json'));
  const rms: number[] = [];
  for (const chunk of aligned.audio?.wavChunks ?? []) {
    try {
      const { pcm, sampleRate } = await readWavPcm(join(dir, chunk.file));
      rms.push(...rmsWindows(pcm, sampleRate, RMS_WINDOW_MS));
    } catch { /* skip an unreadable chunk */ }
  }
  const out = findCandidates({
    durationMs: aligned.durationMs, events: aligned.events, turns: transcript?.turns ?? [],
    rms, rmsWindowMs: RMS_WINDOW_MS, rmsOffsetMs: aligned.audio?.offsetMs ?? 0,
  });
  await writeFile(join(dir, 'candidates.json'), JSON.stringify(out, null, 2));
  return out;
}
