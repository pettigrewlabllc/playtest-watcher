// Standard-mode prices from docs/meta-api-notes.md (2026-10-27).
export type Usage = { input_tokens?: number; output_tokens?: number; audio_ms?: number; frames?: number };

const PER_MILLION: Record<string, { input: number; output: number }> = {
  'muse-spark-1.2': { input: 1.25, output: 4.25 },
  'muse-spark-1.3': { input: 1.25, output: 4.25 },
  'muse-wonder-1.0': { input: 4.0, output: 20.0 },
};
const TRANSCRIBE_PER_HOUR = 0.18;
const SAM_PER_1000_FRAMES = 0.2;
const SAM_MIN_FRAMES = 50;

export function usd(model: string, usage: Usage): number {
  if (model === 'muse-voice-transcribe-1.0') return ((usage.audio_ms ?? 0) / 3_600_000) * TRANSCRIBE_PER_HOUR;
  if (model === 'sam-3.1') return (Math.max(usage.frames ?? 0, SAM_MIN_FRAMES) / 1000) * SAM_PER_1000_FRAMES;
  const p = PER_MILLION[model];
  if (!p) throw new Error(`no price for model ${model}`);
  return ((usage.input_tokens ?? 0) * p.input + (usage.output_tokens ?? 0) * p.output) / 1e6;
}
