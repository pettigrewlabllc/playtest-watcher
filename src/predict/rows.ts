import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { loadSession } from './inputs.ts';
import type { Aligned, AlignedEvent, Label, Moment } from './inputs.ts';
import { stagesOf } from './stages.ts';

export type Row = {
  session: string; game: string; i: number; ms: number; stage: string; kind: string; type: string;
  fail_streak: number; s_since_success: number; s_since_progress: number; attempts_30s: number;
  new_thing_10s: 0 | 1; text_chars_on_screen: number; s_in_session: number; explore_so_far: number; help_so_far: number;
  label: Label; weak_labels: 0 | 1;
  kid: string; block: number; prev_label: Label; s_since_moment: number; rapid_retry: 0 | 1; attempts_no_success: number; intent: string;
};

export const ROW_COLUMNS: (keyof Row)[] = [
  'session', 'game', 'i', 'ms', 'stage', 'kind', 'type', 'fail_streak', 's_since_success', 's_since_progress',
  'attempts_30s', 'new_thing_10s', 'text_chars_on_screen', 's_in_session', 'explore_so_far', 'help_so_far', 'label', 'weak_labels',
  'kid', 'block', 'prev_label', 's_since_moment', 'rapid_retry', 'attempts_no_success', 'intent',
];

export type DebriefAnswer = { q: string; a: string; fun?: number; intent?: string; event?: string };
export type Debrief = { game: string; session?: string; answers: DebriefAnswer[] };

// An answer with an intent applies to the event type named in its `event` field, else to every event type of the
// session whose long name tokens (5+ letters, e.g. "compendium" in compendium_open) start a word in the question or answer.
export function resolveIntents(debriefs: Debrief[], sessionId: string, game: string, events: AlignedEvent[]): Record<string, string> {
  const mine = debriefs.filter(d => d.session === sessionId);
  const pool = mine.length ? mine : debriefs.filter(d => !d.session && d.game === game);
  const types = [...new Set(events.map(e => e.type))];
  const out: Record<string, string> = {};
  for (const d of pool) for (const ans of d.answers ?? []) {
    if (!ans.intent) continue;
    if (ans.event) { out[ans.event] = ans.intent; continue; }
    const text = `${ans.q} ${ans.a}`.toLowerCase();
    for (const t of types) {
      const tokens = t.toLowerCase().split(/[^a-z0-9]+/).filter(x => x.length >= 5);
      if (tokens.some(x => new RegExp(`\\b${x}`).test(text))) out[t] = ans.intent;
    }
  }
  return out;
}

const SAME_FAILURE_MS = 50;
const RAPID_RETRY_MS = 1000;
const isBlockStart = (e: AlignedEvent) => e.kind === 'progress' && /_start$/.test(e.type) && e.type !== 'logger_start';
const hasStageNumber = (e: AlignedEvent) => e.kind === 'progress' && ['level', 'wave', 'season'].some(f => e.data[f] !== undefined);

// Run or level blocks, for bootstrapping: a new block at every *_start progress event (run_start, level_start, wave_start...).
// A session with fewer than two of those falls back to progress events that carry a level, wave or season.
export function blocksOf(events: AlignedEvent[]): number[] {
  const starts = events.filter(isBlockStart).length >= 2 ? isBlockStart : hasStageNumber;
  let b = 0;
  return events.map(e => (starts(e) ? ++b : b));
}

const MIN_CONFIDENCE = 0.5;

export function okMoments(moments: Moment[] | null): Moment[] {
  return (moments ?? []).filter(m => m.status === 'ok' && m.label !== 'none' && m.confidence >= MIN_CONFIDENCE);
}

export type RowOpts = { kid?: string; intents?: Record<string, string> };

export function buildRows(session: string, game: string, aligned: Aligned, moments: Moment[] | null, o: RowOpts = {}): Row[] {
  const events = aligned.events;
  const stages = stagesOf(events);
  const blocks = blocksOf(events);
  const ended = okMoments(moments).slice().sort((a, b) => a.endMs - b.endMs);
  const weak = moments === null;
  const real = okMoments(moments);
  const rows: Row[] = [];

  let failStreak = 0;
  let lastFailMs = -Infinity;
  let noSuccess = 0;
  let lastSuccessMs = 0;
  let lastProgressMs = 0;
  let explore = 0;
  let help = 0;
  const attempts: number[] = [];
  const newThings: number[] = [];
  const openText: { id: string; chars: number }[] = [];

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const chars = typeof e.data.chars === 'number' ? e.data.chars : 0;
    const textId = typeof e.data.id === 'string' ? e.data.id : null;
    let rapid: 0 | 1 = 0;
    if (e.kind === 'fail') {
      if (e.ms - lastFailMs > SAME_FAILURE_MS) failStreak++;   // a consequence event (life_lost after wrong_cut) is the same failure
      lastFailMs = e.ms;
    }
    else if (e.kind === 'success') { failStreak = 0; noSuccess = 0; lastSuccessMs = e.ms; }
    else if (e.kind === 'progress') lastProgressMs = e.ms;
    else if (e.kind === 'attempt') { attempts.push(e.ms); noSuccess++; rapid = e.ms - lastFailMs < RAPID_RETRY_MS ? 1 : 0; }
    else if (e.kind === 'new_thing') newThings.push(e.ms);
    else if (e.kind === 'explore') explore++;
    else if (e.kind === 'help') help++;
    else if (e.kind === 'text_shown') openText.push({ id: textId ?? `#${i}`, chars });
    else if (e.kind === 'text_closed') {
      const at = textId ? openText.findIndex(t => t.id === textId) : 0;
      if (at >= 0) openText.splice(at, 1);
    }

    let label: Label = 'none';
    if (weak) {
      if (failStreak >= 3) label = 'frustrated';
      else if (e.kind === 'idle') label = 'stuck';
    } else {
      let best = -1;
      for (const m of real) {
        if (e.ms >= m.startMs && e.ms <= m.endMs && m.confidence > best) { best = m.confidence; label = m.label; }
      }
    }

    let prev: Moment | null = null;
    for (const m of ended) { if (m.endMs < e.ms) prev = m; else break; }

    rows.push({
      session, game, i, ms: e.ms, stage: stages[i], kind: e.kind, type: e.type,
      fail_streak: failStreak,
      s_since_success: (e.ms - lastSuccessMs) / 1000,
      s_since_progress: (e.ms - lastProgressMs) / 1000,
      attempts_30s: attempts.filter(t => t > e.ms - 30000 && t <= e.ms).length,
      new_thing_10s: newThings.some(t => t >= e.ms - 10000 && t <= e.ms) ? 1 : 0,
      text_chars_on_screen: openText.reduce((s, t) => s + t.chars, 0),
      s_in_session: e.ms / 1000,
      explore_so_far: explore, help_so_far: help,
      label, weak_labels: weak ? 1 : 0,
      kid: o.kid ?? '', block: blocks[i],
      prev_label: prev ? prev.label : 'none',
      s_since_moment: (e.ms - (prev ? prev.endMs : 0)) / 1000,
      rapid_retry: rapid, attempts_no_success: noSuccess,
      intent: o.intents?.[e.type] ?? 'none',
    });
  }
  return rows;
}

export async function loadDebriefs(root: string, letter: string): Promise<Debrief[]> {
  for (const l of [letter.toLowerCase(), letter.toUpperCase()]) {
    try {
      const d = JSON.parse(await readFile(join(root, 'kids', l, 'debriefs.json'), 'utf8'));
      return Array.isArray(d) ? d : [];
    } catch { /* try the other case */ }
  }
  return [];
}

// Debriefs are read from <root>/kids/<letter>/debriefs.json, root being the folder that holds the session folders.
export async function sessionRows(dir: string): Promise<Row[]> {
  const s = await loadSession(dir);
  const kid = s.meta.kid && s.meta.kid !== '?' ? s.meta.kid.toUpperCase() : '';
  const intents = kid ? resolveIntents(await loadDebriefs(dirname(dir), kid), s.id, s.meta.game, s.aligned.events) : {};
  return buildRows(s.id, s.meta.game, s.aligned, s.moments, { kid, intents });
}

function csvCell(v: unknown): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function writeRowsCsv(rows: Row[], file: string): Promise<void> {
  const lines = [ROW_COLUMNS.join(',')];
  for (const r of rows) lines.push(ROW_COLUMNS.map(c => csvCell(r[c])).join(','));
  await writeFile(file, lines.join('\n') + '\n');
}
