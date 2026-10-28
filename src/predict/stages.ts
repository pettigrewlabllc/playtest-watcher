import type { AlignedEvent } from './inputs.ts';

// A stage is a piece of game content, so the same key means the same content in another session or for another kid.
// Screen events name the screen on show, not content, and never define a stage. Mirrored in analysis/situation.py.
export type StageInfo = { key: string; run: number };

const num = (v: unknown): string | null => (typeof v === 'number' || (typeof v === 'string' && v !== '') ? String(v) : null);

type Step = (e: AlignedEvent, cur: StageInfo, st: Record<string, unknown>) => string | null;

const levelStart: Step = e => (e.type === 'level_start' && num(e.data.level) !== null ? `level ${num(e.data.level)}` : null);

// Hoard Keeper: season and phase. The shop phase starts when the last audit of a season is answered.
const hoardKeeper: Step = (e, _cur, st) => {
  if (e.type === 'rush_start' && num(e.data.season) !== null) { st.season = num(e.data.season); st.audit = null; return `season ${st.season} rush`; }
  if (st.season == null) return null;
  if (e.type === 'audit_start' && num(e.data.index) !== null) {
    st.audit = Number(e.data.index); st.of = Number(e.data.of);
    return `season ${st.season} audit-${st.audit}`;
  }
  if (e.type === 'audit_answer' && st.audit != null && st.audit === st.of) { st.audit = null; return `season ${st.season} shop`; }
  return null;
};

// Factor Slicer: the blade number. Runs repeat blades, so the run is kept beside the key, not in it.
const factorSlicer: Step = e => (e.type === 'wave_start' && num(e.data.blade) !== null ? `blade ${num(e.data.blade)}` : null);

const FALLBACK_FIELDS = ['level', 'wave', 'season', 'name'] as const;
const fallback: Step = e => {
  if (e.kind !== 'progress' || e.type === 'screen') return null;
  for (const f of FALLBACK_FIELDS) { const v = num(e.data[f]); if (v !== null) return v; }
  return null;
};

export const STAGE_MAPS: Record<string, Step> = {
  'bond-swap': levelStart,
  'current-cut': levelStart,
  'factor-slicer': factorSlicer,
  'hoard-keeper': hoardKeeper,
};

export function stageInfoOf(events: AlignedEvent[], game: string): StageInfo[] {
  const step = STAGE_MAPS[game] ?? fallback;
  const st: Record<string, unknown> = {};
  let cur: StageInfo = { key: 'start', run: 0 };
  return events.map(e => {
    const run = e.type === 'run_start' ? cur.run + 1 : cur.run;
    const key = step(e, cur, st) ?? cur.key;
    cur = { key, run };
    return cur;
  });
}

export function stagesOf(events: AlignedEvent[], game: string): string[] {
  return stageInfoOf(events, game).map(s => s.key);
}

// The stage at event i ('start' before the first stage).
export function stageOf(events: AlignedEvent[], i: number, game = ''): string {
  if (!events.length) return 'start';
  return stagesOf(events, game)[Math.min(i, events.length - 1)];
}
