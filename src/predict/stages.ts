import type { AlignedEvent } from './inputs.ts';

const STAGE_FIELDS = ['level', 'wave', 'season', 'name'] as const;

function stageField(e: AlignedEvent): string | null {
  if (e.kind !== 'progress') return null;
  for (const f of STAGE_FIELDS) {
    const v = e.data[f];
    if (typeof v === 'string' || typeof v === 'number') return String(v);
  }
  return null;
}

// The game's own progress unit, from the most recent progress event at or before i. Before any, 'start'.
export function stageOf(events: AlignedEvent[], i: number): string {
  for (let j = Math.min(i, events.length - 1); j >= 0; j--) {
    const s = stageField(events[j]);
    if (s !== null) return s;
  }
  return 'start';
}

export function stagesOf(events: AlignedEvent[]): string[] {
  let cur = 'start';
  return events.map(e => { cur = stageField(e) ?? cur; return cur; });
}
