import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { MetaClient } from '../meta/client.ts';
import { LABELS, loadQuestionnaireAt } from './inputs.ts';
import type { Aligned, AlignedEvent, Label, Moment } from './inputs.ts';
import { stagesOf } from './stages.ts';
import { buildRows, okMoments, writeRowsCsv } from './rows.ts';
import { MODEL } from './persona.ts';
import { playerDir, predictRows, python, recordingsRoot } from './model.ts';
import type { Opts, RowProbs } from './model.ts';
import { groupDir } from './traits.ts';
import { QUESTIONS } from '../server/questionnaire.ts';
import { mmss } from '../watch/explain.ts';

// null is the floor: every label at every stage, under the same per-stage cap as the rest.
export const PREDICTORS = ['null', 'baseline', 'questionnaire', 'persona', 'model'] as const;
export type Predictor = typeof PREDICTORS[number];
// The player model's simulated-playthrough predictors (spec 3b), one per reaction-model variant.
export const MODEL_VARIANTS = ['model-traits', 'model-kid'] as const;
export type Variant = typeof MODEL_VARIANTS[number];
export type AnyPredictor = Predictor | Variant;
export const ALL_PREDICTORS: readonly AnyPredictor[] = [...PREDICTORS, ...MODEL_VARIANTS];
// group: the folder holding afm.json and reaction/models.joblib (default recordings/group); sims: simulations per variant.
export type PredictOpts = Opts & { group?: string; sims?: number };
export type PredictedItem = { stage: string; event_type: string; label: string; p: number; why: string };
// enjoyment (player-model variants only): mean P(delighted) - P(bored or frustrated) over the simulated playthrough
export type Prediction = { predictor: string; target: string; items: PredictedItem[]; enjoyment?: number };

const MAX_PER_STAGE = 2;
const REACTIONS = LABELS.filter(l => l !== 'none');

export const PREDICTION_SCHEMA = {
  name: 'prediction',
  schema: {
    type: 'object', additionalProperties: false, required: ['items'],
    properties: { items: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['stage', 'event_type', 'label', 'p', 'why'],
      properties: { stage: { type: 'string' }, event_type: { type: 'string' }, label: { type: 'string', enum: [...REACTIONS] }, p: { type: 'number' }, why: { type: 'string' } },
    } } },
  },
};

type Target = { id: string; game: string; aligned: Aligned; screenNotes: { ms: number; note: string }[] };

// Reads aligned.json and session.json only. moments.json is opened only when the target belongs to a different
// player (or none), and then only the screen notes are used, never labels: a player's own moments never feed their prediction.
async function loadTarget(dir: string, letter: string): Promise<Target> {
  const aligned = JSON.parse(await readFile(join(dir, 'aligned.json'), 'utf8')) as Aligned;
  let meta: { kid?: string; game?: string } = {};
  try { meta = JSON.parse(await readFile(join(dir, 'session.json'), 'utf8')); } catch { /* optional */ }
  let screenNotes: Target['screenNotes'] = [];
  if (String(meta.kid ?? '').toLowerCase() !== letter.toLowerCase()) {
    try {
      const moments = JSON.parse(await readFile(join(dir, 'moments.json'), 'utf8')) as Moment[];
      screenNotes = okMoments(moments).filter(m => m.evidence.screen).map(m => ({ ms: m.startMs, note: m.evidence.screen }));
    } catch { /* no moments */ }
  }
  return { id: basename(dir), game: meta.game ?? 'unknown', aligned, screenNotes };
}

type StageSummary = { stage: string; startMs: number; endMs: number; kinds: Record<string, number>; types: Record<string, number>; screen: string[] };

function summarize(t: Target): StageSummary[] {
  const events = t.aligned.events;
  const stages = stagesOf(events, t.game);
  const out: StageSummary[] = [];
  events.forEach((e, i) => {
    let s = out[out.length - 1];
    if (!s || s.stage !== stages[i]) { s = { stage: stages[i], startMs: e.ms, endMs: e.ms, kinds: {}, types: {}, screen: [] }; out.push(s); }
    s.endMs = e.ms;
    s.kinds[e.kind] = (s.kinds[e.kind] ?? 0) + 1;
    s.types[e.type] = (s.types[e.type] ?? 0) + 1;
  });
  for (const n of t.screenNotes) {
    const s = [...out].reverse().find(x => x.startMs <= n.ms) ?? out[0];
    if (s && s.screen.length < 3) s.screen.push(n.note);
  }
  return out;
}

function targetText(t: Target, stages: StageSummary[]): string {
  const lines = stages.map(s => {
    const kinds = Object.entries(s.kinds).map(([k, n]) => `${k} x${n}`).join(', ');
    const types = Object.entries(s.types).map(([k, n]) => `${k} x${n}`).join(', ');
    return `- stage ${s.stage} (${mmss(s.startMs)} to ${mmss(s.endMs)}): ${kinds}. Event types: ${types}.` + (s.screen.length ? ` On screen: ${s.screen.join(' / ')}` : '');
  });
  return [`GAME: ${t.game}. A playthrough of it, stage by stage (stage = a piece of the game's content: a level, a blade or a season phase):`, ...lines].join('\n');
}

const TASK = [
  'Predict how this child will react to the playthrough. A reaction is one of: confused, stuck, bored, frustrated, delighted.',
  `Give at most ${MAX_PER_STAGE} predicted reactions per stage, each with the stage exactly as written, an event_type taken from that stage's event types (the kind of event it would happen around), the label, p (your probability that it really happens, 0 to 1) and a one-sentence why. Predict nothing for a stage where you expect no notable reaction. Do not invent facts about the child beyond what is given.`,
].join('\n');

function questionnaireText(answers: Record<string, string>): string {
  const lines = QUESTIONS.flatMap(q => {
    const a = answers[String(q.id)];
    if (a !== 'a' && a !== 'b') return [];
    return [`Q: ${q.text}\nA: ${a === 'a' ? q.a : q.b}`];
  });
  return lines.length ? lines.join('\n') : '(no answers recorded)';
}

const topType = (s: StageSummary) => Object.entries(s.types).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

// At most MAX_PER_STAGE items per stage key, highest p first (ties keep their order). A stage key can recur (a revisit).
export function capPerStage(items: PredictedItem[]): PredictedItem[] {
  const out: PredictedItem[] = [];
  for (const stage of new Set(items.map(i => i.stage))) {
    out.push(...items.filter(i => i.stage === stage).sort((a, b) => b.p - a.p).slice(0, MAX_PER_STAGE));
  }
  return out;
}

function clean(items: PredictedItem[] | undefined, stages: StageSummary[]): PredictedItem[] {
  const byStage = new Map(stages.map(s => [s.stage, s]));
  const kept: PredictedItem[] = [];
  for (const it of items ?? []) {
    const s = byStage.get(String(it.stage));
    if (!s || !REACTIONS.includes(it.label as Label)) continue;
    const types = Object.entries(s.types).sort((a, b) => b[1] - a[1]).map(x => x[0]);
    kept.push({
      stage: s.stage, label: it.label, p: Math.max(0, Math.min(1, Number(it.p) || 0)), why: String(it.why ?? ''),
      event_type: types.includes(it.event_type) ? it.event_type : (types[0] ?? ''),
    });
  }
  return capPerStage(kept);
}

// Per stage: the reaction labels ranked by mean probability over the stage's events, top MAX_PER_STAGE kept (the
// budget every predictor gets). The event type is where that label peaks. Ranks, not thresholds: calibration varies.
export function itemsFromProbs(probs: RowProbs[], typeOf: (i: number) => string, source = 'model'): PredictedItem[] {
  const items: PredictedItem[] = [];
  for (const stage of new Set(probs.map(r => r.stage))) {
    const rs = probs.filter(r => r.stage === stage);
    for (const l of REACTIONS) {
      const mean = rs.reduce((s, r) => s + r.p[l], 0) / rs.length;
      if (!(mean > 0)) continue;
      const top = rs.reduce((a, b) => (b.p[l] > a.p[l] ? b : a));
      items.push({ stage, event_type: typeOf(top.i), label: l, p: mean, why: `${source}: mean ${l} probability ${mean.toFixed(2)} over ${rs.length} events` });
    }
  }
  return capPerStage(items);
}

async function modelPredictor(letter: string, t: Target, o: Opts): Promise<PredictedItem[]> {
  // labels are irrelevant to prediction; null moments keeps the target's own moments out of the rows
  const rows = buildRows(t.id, t.game, t.aligned, null);
  const csv = join(playerDir(letter, o), `target-${t.id}.csv`);
  await mkdir(playerDir(letter, o), { recursive: true });
  await writeRowsCsv(rows, csv);
  const probs = await predictRows(letter, csv, o);
  const byI = new Map(rows.map(r => [r.i, r]));
  return itemsFromProbs(probs, i => byI.get(i)?.type ?? '');
}

function readProbs(text: string): (RowProbs & { type: string })[] {
  const [header, ...lines] = text.trim().split('\n');
  const cols = header.split(',');
  const at = (name: string) => cols.indexOf(name);
  return lines.filter(Boolean).map(line => {
    const cells = line.split(',');   // stage and type are game event names: no commas
    const p = {} as Record<Label, number>;
    for (const l of LABELS) p[l] = Number(cells[at(`p_${l}`)]);
    return { i: Number(cells[at('i')]), stage: cells[at('stage')], type: cells[at('type')], p };
  });
}

// Simulates the kid's own playthrough of the target (analysis/simulate.py) under both reaction-model variants.
// Reads only the target's aligned.json and session.json, never its moments.
export async function simulateVariants(letter: string, targetSessionDir: string, o: PredictOpts = {}): Promise<Record<Variant, Prediction>> {
  const group = o.group ?? groupDir(o);
  const id = basename(targetSessionDir);
  const out = join(playerDir(letter, o), `sim-${id}`);
  await mkdir(out, { recursive: true });
  await python('simulate.py', ['--models', join(group, 'reaction'), '--afm', join(group, 'afm.json'), '--kid', letter,
    '--target', targetSessionDir, '--out', out, '--n', String(o.sims ?? 200)]);
  const res = {} as Record<Variant, Prediction>;
  for (const v of MODEL_VARIANTS) {
    const probs = readProbs(await readFile(join(out, `probs-${v.replace('model-', '')}.csv`), 'utf8'));
    const byI = new Map(probs.map(r => [r.i, r.type]));
    const enjoyment = probs.length ? probs.reduce((s, r) => s + r.p.delighted - r.p.bored - r.p.frustrated, 0) / probs.length : 0;
    res[v] = { predictor: v, target: id, items: itemsFromProbs(probs, i => byI.get(i) ?? '', `${v} (simulated)`), enjoyment };
  }
  return res;
}

export async function predictSession(
  letter: string, targetSessionDir: string, client: MetaClient, predictors: readonly AnyPredictor[] = PREDICTORS, o: PredictOpts = {},
): Promise<Record<Predictor, Prediction> & Partial<Record<Variant, Prediction>>> {
  const t = await loadTarget(targetSessionDir, letter);
  const stages = summarize(t);
  const world = targetText(t, stages);
  const out = {} as Record<Predictor, Prediction> & Partial<Record<Variant, Prediction>>;

  if (predictors.some(p => (MODEL_VARIANTS as readonly string[]).includes(p))) {
    const sim = await simulateVariants(letter, targetSessionDir, o);
    for (const v of MODEL_VARIANTS) if (predictors.includes(v)) out[v] = sim[v];
  }
  for (const name of predictors) {
    if ((MODEL_VARIANTS as readonly string[]).includes(name)) continue;
    let items: PredictedItem[];
    if (name === 'model') {
      items = await modelPredictor(letter, t, o);
    } else if (name === 'null') {
      items = capPerStage(stages.flatMap(st => REACTIONS.map(label => ({ stage: st.stage, event_type: topType(st), label, p: 1 / REACTIONS.length, why: 'null: every label at every stage' }))));
    } else {
      let who: string;
      if (name === 'baseline') who = 'WHO THEY ARE: a child aged 8 to 14. Nothing else is known.';
      else if (name === 'questionnaire') {
        const q = await loadQuestionnaireAt(recordingsRoot(o), letter);
        who = `WHO THEY ARE: a child aged 8 to 14. Before playing, they answered a short questionnaire about how they like to play:\n${questionnaireText(q?.answers ?? {})}`;
      } else {
        let persona: string;
        try { persona = await readFile(join(playerDir(letter, o), 'persona.json'), 'utf8'); }
        catch { throw new Error(`no persona for ${letter}; run: npm run predict -- persona ${letter}`); }
        who = `WHO THEY ARE: a child aged 8 to 14. A persona built from watching them play other games (JSON):\n${persona}`;
      }
      const res = await client.respond<{ items: PredictedItem[] }>({
        model: MODEL, kind: `predict:${letter}:${name}:${t.id}`, schema: PREDICTION_SCHEMA, maxOutputTokens: 4000,
        content: [{ type: 'input_text', text: [who, '', world, '', TASK].join('\n') }],
      });
      items = clean(res.data.items, stages);
    }
    out[name] = { predictor: name, target: t.id, items };
  }
  return out;
}

export async function writePredictions(dir: string, preds: Partial<Record<AnyPredictor, Prediction>>): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const files: string[] = [];
  for (const [name, p] of Object.entries(preds)) {
    const f = join(dir, `${name}.json`);
    await writeFile(f, JSON.stringify(p, null, 2));
    files.push(f);
  }
  return files;
}
