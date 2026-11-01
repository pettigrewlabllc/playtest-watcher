import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { rng, jitter, paceRunMs, paceToAction, settleAfterAction, watcherSession, SETTLE_MS, WAIT_MS, FRESH_FRAME_MS, type PaceClock } from '../src/agent/play.ts';

// A game clock that only moves when the harness moves it; the fresh-frame step costs a little more or less real
// time each step, the way it does in Chrome.
function fakeClock(r: () => number) {
  let now = 0;
  const marks: number[] = [];
  const clock: PaceClock = {
    async runFor(ms) { now += ms; },
    async freshFrame() { const ms = 100 + Math.round((r() - 0.5) * 6); now += ms; return ms; },
  };
  return { clock, now: () => now, tap: () => marks.push(now), marks };
}

describe('pace', () => {
  it('moves the game clock by exactly the jittered gap between two taps, harness steps included', async () => {
    const r = rng(11), f = fakeClock(rng(5));
    let since = 0, est = FRESH_FRAME_MS, waited = 0;
    const gaps: number[] = [];
    for (let n = 0; n < 40; n++) {
      const gap = jitter(n % 7 ? 1.3 : 7, r) * 1000;   // a new screen now and then (first-tap delay), else the gap
      gaps.push(gap);
      const p = await paceToAction(f.clock, gap, since, est);
      est = p.freshMs;
      f.tap();
      const s = await settleAfterAction(f.clock, false);
      since = s.sinceActionMs; waited = s.waitedMs;
    }
    expect(waited).toBe(0);
    for (let n = 1; n < f.marks.length; n++) {
      // the fresh frame's real cost wobbles by up to 6 ms between steps; the next step corrects with the last one
      expect(Math.abs(f.marks[n] - f.marks[n - 1] - gaps[n])).toBeLessThanOrEqual(6);
    }
  });

  it('was 1.5x+ slow before: the old order added the settle and the fresh frame on top of the gap', () => {
    const gap = 1300, old = gap + SETTLE_MS + FRESH_FRAME_MS;
    expect(old / gap).toBeGreaterThan(1.35);
    expect(SETTLE_MS + paceRunMs(gap, SETTLE_MS, FRESH_FRAME_MS) + FRESH_FRAME_MS).toBe(gap);
  });

  it('never runs the clock backwards when the gap is shorter than the harness steps', async () => {
    expect(paceRunMs(300, SETTLE_MS, FRESH_FRAME_MS)).toBe(0);
    const f = fakeClock(() => 0.5);
    const p = await paceToAction(f.clock, 300, SETTLE_MS, FRESH_FRAME_MS);
    expect(p.runMs).toBe(0);
    expect(f.now()).toBe(100);   // only the fresh frame
  });

  it('keeps a wait as its own explicit pause on top of the next gap', async () => {
    const f = fakeClock(() => 0.5);
    f.tap();
    const s = await settleAfterAction(f.clock, true);
    expect(s).toEqual({ sinceActionMs: SETTLE_MS, waitedMs: WAIT_MS });
    await paceToAction(f.clock, 1300, s.sinceActionMs, FRESH_FRAME_MS);
    f.tap();
    expect(f.marks[1] - f.marks[0]).toBe(WAIT_MS + 1300);
  });

  it('runs the in-between step after the clock moves and before the fresh frame', async () => {
    const f = fakeClock(() => 0.5);
    let at = -1;
    await paceToAction(f.clock, 2000, SETTLE_MS, FRESH_FRAME_MS, async () => { at = f.now(); });
    expect(at).toBe(2000 - SETTLE_MS - FRESH_FRAME_MS);
  });
});

describe('standalone session', () => {
  it('is standalone with no watcher, an unreachable one, or one that never answers within ~1 s', async () => {
    const meta = { kid: 'T', game: 'g', round: 'agent', device: 'agent' };
    expect(await watcherSession(null, meta)).toBeNull();
    expect(await watcherSession(undefined, meta)).toBeNull();
    expect(await watcherSession('', meta)).toBeNull();
    expect(await watcherSession('http://127.0.0.1:1', meta)).toBeNull();
    const hang = createServer(() => { /* never answers */ });
    await new Promise<void>(ok => hang.listen(0, '127.0.0.1', ok));
    const t = Date.now();
    expect(await watcherSession(`http://127.0.0.1:${(hang.address() as AddressInfo).port}`, meta, 300)).toBeNull();
    expect(Date.now() - t).toBeLessThan(1500);
    hang.closeAllConnections(); hang.close();
  });

  it('uses the watcher id when it answers', async () => {
    let got: unknown = null;
    const srv = createServer((req, res) => {
      let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { got = JSON.parse(b); res.writeHead(200, { 'content-type': 'application/json' }).end('{"id":"20261101-120000-t-g-agent"}'); });
    });
    await new Promise<void>(ok => srv.listen(0, '127.0.0.1', ok));
    const id = await watcherSession(`http://127.0.0.1:${(srv.address() as AddressInfo).port}`, { kid: 'T', game: 'g', round: 'agent', device: 'agent' });
    srv.close();
    expect(id).toBe('20261101-120000-t-g-agent');
    expect(got).toMatchObject({ kid: 'T', game: 'g', round: 'agent' });
  });
});
