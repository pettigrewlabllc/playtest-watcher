import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AlignedEvent, Moment, Transcript } from '../../src/predict/inputs.ts';

export function ev(ms: number, kind: string, data: Record<string, unknown> = {}, type = kind): AlignedEvent {
  return { ms, type, kind, data: { kind, ...data } };
}

export function moment(id: string, startMs: number, endMs: number, label: Moment['label'], confidence = 0.8): Moment {
  return { id, startMs, endMs, triggers: [], label, confidence, evidence: { face: '', voice: '', hands: '', screen: '' }, game_context: '', fix_hint: '', status: 'ok' };
}

export async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pw-predict-'));
}

export async function writeSession(root: string, id: string, o: {
  kid?: string; game?: string; round?: string; events: AlignedEvent[]; durationMs?: number;
  moments?: Moment[]; transcript?: Transcript;
}): Promise<string> {
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  const last = o.events.length ? o.events[o.events.length - 1].ms : 0;
  await writeFile(join(dir, 'session.json'), JSON.stringify({ id, kid: o.kid ?? 'a', game: o.game ?? 'g1', round: o.round ?? 'learn' }));
  await writeFile(join(dir, 'aligned.json'), JSON.stringify({ t0: 0, durationMs: o.durationMs ?? last, tracks: {}, events: o.events }));
  if (o.moments) await writeFile(join(dir, 'moments.json'), JSON.stringify(o.moments));
  if (o.transcript) await writeFile(join(dir, 'transcript.json'), JSON.stringify(o.transcript));
  return dir;
}
