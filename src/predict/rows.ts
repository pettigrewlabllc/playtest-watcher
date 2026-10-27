import { writeFile } from 'node:fs/promises';
import { loadSession } from './inputs.ts';
import type { Aligned, Label, Moment } from './inputs.ts';
import { stagesOf } from './stages.ts';

export type Row = {
  session: string; game: string; i: number; ms: number; stage: string; kind: string; type: string;
  fail_streak: number; s_since_success: number; s_since_progress: number; attempts_30s: number;
  new_thing_10s: 0 | 1; text_chars_on_screen: number; s_in_session: number; explore_so_far: number; help_so_far: number;
  label: Label; weak_labels: 0 | 1;
};

export const ROW_COLUMNS: (keyof Row)[] = [
  'session', 'game', 'i', 'ms', 'stage', 'kind', 'type', 'fail_streak', 's_since_success', 's_since_progress',
  'attempts_30s', 'new_thing_10s', 'text_chars_on_screen', 's_in_session', 'explore_so_far', 'help_so_far', 'label', 'weak_labels',
];

const MIN_CONFIDENCE = 0.5;

export function okMoments(moments: Moment[] | null): Moment[] {
  return (moments ?? []).filter(m => m.status === 'ok' && m.label !== 'none' && m.confidence >= MIN_CONFIDENCE);
}

export function buildRows(session: string, game: string, aligned: Aligned, moments: Moment[] | null): Row[] {
  const events = aligned.events;
  const stages = stagesOf(events);
  const weak = moments === null;
  const real = okMoments(moments);
  const rows: Row[] = [];

  let failStreak = 0;
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
    if (e.kind === 'fail') failStreak++;
    else if (e.kind === 'success') { failStreak = 0; lastSuccessMs = e.ms; }
    else if (e.kind === 'progress') lastProgressMs = e.ms;
    else if (e.kind === 'attempt') attempts.push(e.ms);
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
    });
  }
  return rows;
}

export async function sessionRows(dir: string): Promise<Row[]> {
  const s = await loadSession(dir);
  return buildRows(s.id, s.meta.game, s.aligned, s.moments);
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
