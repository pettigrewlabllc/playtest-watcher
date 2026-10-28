import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

type Rec = { ondataavailable: (e: { data: { size: number } }) => void; onstop: () => void; mimeType: string; start: () => void; stop: () => void };

// Loads public/recorder.js in a bare context with a fake MediaRecorder and fetch.
function load(fetchImpl: (url: string) => Promise<{ ok: boolean; status: number }>) {
  const recs: Rec[] = [];
  class FakeRecorder {
    static isTypeSupported() { return true; }
    mimeType = 'video/webm'; ondataavailable = (_: unknown) => {}; onstop = () => {};
    constructor() { recs.push(this as unknown as Rec); }
    start() {} stop() { this.onstop(); }
  }
  const window: Record<string, any> = {};
  const calls: string[] = [];
  runInNewContext(readFileSync(join(import.meta.dirname, '..', 'public', 'recorder.js'), 'utf8'), {
    window, MediaRecorder: FakeRecorder, Date, Promise, String, Error,
    fetch: (url: string) => { calls.push(url); return fetchImpl(url); },
    setTimeout: (f: () => void) => { f(); return 0; },
  });
  return { PW: window.PW, recs, calls };
}

const stream = { getVideoTracks: () => [{}] };
const chunk = { data: { size: 3 } };

describe('recorder.js upload durability', () => {
  it('retries a failed chunk 3 times with backoff and succeeds without reporting a failure', async () => {
    let n = 0;
    const { PW, recs, calls } = load(async () => (++n <= 2 ? { ok: false, status: 503 } : { ok: true, status: 200 }));
    const waits: number[] = [];
    const failures: string[] = [];
    const r = PW.startTrackRecorder('s1', 'face', stream, { sleep: async (ms: number) => { waits.push(ms); }, onFail: (t: string) => failures.push(t) });
    recs[0].ondataavailable(chunk);
    await r.stop();
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([500, 1000]);
    expect(failures).toEqual([]);
    expect(r.stats().error).toBeNull();
  });

  it('after 4 failed attempts marks the track failed, tells the page at once, and stops sending later chunks', async () => {
    const { PW, recs, calls } = load(async () => { throw new Error('network down'); });
    const failures: string[] = [];
    const r = PW.startTrackRecorder('s1', 'hands', stream, { sleep: async () => {}, onFail: (t: string) => failures.push(t) });
    recs[0].ondataavailable(chunk);
    recs[0].ondataavailable(chunk);
    await r.stop();
    expect(calls).toHaveLength(4);             // chunk 0: 1 try + 3 retries; chunk 1 is not sent after the track failed
    expect(failures).toEqual(['hands']);
    expect(r.stats().error).toMatch(/network down/);
  });
});
