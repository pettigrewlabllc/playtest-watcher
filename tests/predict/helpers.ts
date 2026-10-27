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

import { createMetaClient } from '../../src/meta/client.ts';
import type { MetaClient } from '../../src/meta/client.ts';

export type Call = { kind: string; schema?: string; text: string };

// Fake-mode client that records every respond() prompt; `canned` overrides the response for a schema name.
export function recordingClient(canned: Record<string, unknown | ((text: string, kind: string) => unknown)> = {}): MetaClient & { calls: Call[] } {
  const base = createMetaClient({ live: false, budgetUsd: 1, spendLog: '/dev/null' });
  const calls: Call[] = [];
  const client = {
    ...base,
    calls,
    async respond(req: Parameters<MetaClient['respond']>[0]) {
      const text = req.content.map(c => ('text' in c ? c.text : '')).join('\n');
      calls.push({ kind: req.kind, schema: req.schema?.name, text });
      const c = req.schema ? canned[req.schema.name] : undefined;
      if (c !== undefined) {
        const data = typeof c === 'function' ? (c as (t: string, k: string) => unknown)(text, req.kind) : c;
        return { data: data as never, text: JSON.stringify(data), usage: { input_tokens: 1, output_tokens: 1 } };
      }
      return base.respond(req);
    },
  };
  return client as MetaClient & { calls: Call[] };
}

// Deterministic run-of-fails stream: runs of 1..6 fails, a frustrated moment on every run of 4+. Same as the model test.
export function failStream(seed: number, runs = 40) {
  const events: AlignedEvent[] = [];
  const moments: Moment[] = [];
  let ms = 0;
  for (let r = 0; r < runs; r++) {
    const len = 1 + ((r * 7 + seed * 3) % 6);
    const start = ms;
    for (let k = 0; k < len; k++) { events.push(ev(ms, 'attempt')); ms += 500; events.push(ev(ms, 'fail')); ms += 500; }
    if (len >= 4) moments.push(moment(`m${seed}-${r}`, start + 3000, ms, 'frustrated', 0.9));
    events.push(ev(ms, 'success')); ms += 1000;
  }
  return { events, moments };
}
