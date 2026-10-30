// Data for the viewer page (public/view.html). Faces: only face-blur.mp4 is ever served, never face.mp4.
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isValidSessionId } from './ids.ts';
import { stagesOf } from '../predict/stages.ts';

export const VIEW_MEDIA = ['face-blur', 'screen', 'hands'] as const;
const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
const readJson = async <T>(f: string): Promise<T | null> => { try { return JSON.parse(await readFile(f, 'utf8')) as T; } catch { return null; } };

export async function listViewable(root: string) {
  const out = [];
  for (const id of (await readdir(root)).sort().reverse()) {
    if (!isValidSessionId(id) || !existsSync(join(root, id, 'aligned.json'))) continue;
    const s = await readJson<{ kid?: string; game?: string; round?: string }>(join(root, id, 'session.json'));
    const moments = (await readJson<{ status: string }[]>(join(root, id, 'moments.json'))) ?? [];
    out.push({ id, kid: String(s?.kid ?? '').toUpperCase(), game: s?.game ?? '', round: s?.round ?? '', moments: moments.filter(m => m.status === 'ok').length, blurred: existsSync(join(root, id, 'face-blur.mp4')) });
  }
  return out;
}

export async function viewData(root: string, id: string) {
  if (!isValidSessionId(id)) throw fail(400, 'bad session id');
  const dir = join(root, id);
  const aligned = await readJson<{ durationMs: number; tracks: Record<string, { offsetMs: number }>; events: { ms: number; type: string; data?: Record<string, unknown> }[] }>(join(dir, 'aligned.json'));
  if (!aligned) throw fail(404, 'session not analyzed yet');
  const s = await readJson<{ kid?: string; game?: string; round?: string }>(join(dir, 'session.json'));
  const moments = ((await readJson<any[]>(join(dir, 'moments.json'))) ?? []).filter(m => m.status === 'ok').map(m => ({
    id: m.id, startMs: m.startMs, endMs: m.endMs, peakMs: m.startMs + Math.round((m.peak_s ?? 0) * 1000), label: m.label, secondary: m.secondary_label,
    confidence: m.confidence, quote: m.quote ?? '', context: m.game_context ?? '', evidence: m.evidence ?? {}, asked_for_help: !!m.asked_for_help,
  }));
  // the same stage keys scoring uses; one marker where each new stage begins
  const keys = stagesOf(aligned.events as never, s?.game ?? '');
  const levels = aligned.events.flatMap((e, i) => (i === 0 || keys[i] !== keys[i - 1] ? [{ ms: e.ms, name: keys[i] }] : []));
  let fixes = '';
  try { fixes = await readFile(join(dir, 'fixes.md'), 'utf8'); } catch { /* not run yet */ }
  const tracks = Object.fromEntries(VIEW_MEDIA.map(n => [n, { offsetMs: aligned.tracks[n === 'face-blur' ? 'face' : n]?.offsetMs ?? 0, available: existsSync(join(dir, `${n}.mp4`)) }]));
  return { id, kid: String(s?.kid ?? '').toUpperCase(), game: s?.game ?? '', round: s?.round ?? '', durationMs: aligned.durationMs, tracks, moments, levels, fixes };
}

export function mediaPath(root: string, id: string, name: string): string {
  if (!isValidSessionId(id) || !(VIEW_MEDIA as readonly string[]).includes(name)) throw fail(404, 'not found');
  return join(root, id, `${name}.mp4`);
}
