import { describe, it, expect } from 'vitest';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { rmsWindows, findCandidates, candidatesStage } from '../../src/watch/candidates.ts';
import { run } from '../../src/watch/ffmpeg.ts';
import { tmp } from './helpers.ts';

const ev = (ms: number, type: string, kind: string) => ({ ms, type, kind, data: {} });
const base = { durationMs: 120_000, events: [], turns: [], rms: [], rmsWindowMs: 500 };
const find = (over: object) => findCandidates({ ...base, ...over });
const has = (cs: ReturnType<typeof find>, trig: string) => cs.find(c => c.triggers.includes(trig));

describe('rmsWindows', () => {
  it('is ~1 for a full-scale square wave and 0 for silence', () => {
    const sq = new Int16Array(16000).map((_, i) => (i % 2 ? 32767 : -32768));
    expect(rmsWindows(sq, 16000, 500)[0]).toBeGreaterThan(0.99);
    expect(rmsWindows(new Int16Array(16000), 16000, 500)).toEqual([0, 0]);
  });
});

describe('findCandidates', () => {
  it('fail events make a window, and a second fail within 10 s extends it', () => {
    const one = find({ events: [ev(30_000, 'die', 'fail')] });
    expect(has(one, 'fail:die')).toMatchObject({ startMs: 24_000, endMs: 38_000 });
    const two = find({ events: [ev(30_000, 'die', 'fail'), ev(38_000, 'die', 'fail')] });
    expect(two.filter(c => c.triggers.includes('fail:die'))).toHaveLength(1);
    expect(has(two, 'fail:die')).toMatchObject({ startMs: 24_000, endMs: 46_000 });
  });

  it('retry: 3 attempts of one type within 5 s', () => {
    const cs = find({ events: [ev(50_000, 'swap', 'attempt'), ev(51_000, 'swap', 'attempt'), ev(52_000, 'swap', 'attempt')] });
    expect(has(cs, 'retry:swap')).toBeTruthy();
    expect(has(find({ events: [ev(50_000, 'swap', 'attempt'), ev(51_000, 'swap', 'attempt')] }), 'retry:swap')).toBeUndefined();
  });

  it('idle: idle event or a gap of 8 s+', () => {
    expect(has(find({ events: [ev(20_000, 'idle', 'other')] }), 'idle')).toBeTruthy();
    expect(has(find({ events: [ev(10_000, 'a', 'other'), ev(19_000, 'b', 'other')] }), 'idle')).toBeTruthy();
    expect(has(find({ events: [ev(10_000, 'a', 'other'), ev(17_000, 'b', 'other')] }), 'idle')).toBeUndefined();
  });

  it('quit, fast progress, kid speech and loud windows', () => {
    expect(has(find({ events: [ev(80_000, 'back', 'quit')] }), 'quit')).toBeTruthy();
    expect(has(find({ events: [ev(70_000, 'level_done', 'progress'), ev(85_000, 'level_done', 'progress')] }), 'fast_progress')).toBeTruthy();
    expect(has(find({ events: [ev(70_000, 'level_done', 'progress'), ev(95_000, 'level_done', 'progress')] }), 'fast_progress')).toBeUndefined();
    const turns = [{ startMs: 75_000, endMs: 77_000, speaker: '0:A', text: 'hm', who: 'kid' as const }, { startMs: 10_000, endMs: 11_000, speaker: '0:B', text: 'x', who: 'adult' as const }];
    const sp = find({ turns });
    expect(has(sp, 'speech')).toMatchObject({ startMs: 69_000 });
    expect(sp.filter(c => c.triggers.includes('speech'))).toHaveLength(1);
    const rms = new Array(240).fill(0.01);
    rms[100] = 0.9;
    expect(has(find({ rms }), 'loud')).toMatchObject({ startMs: 44_000 });
    expect(has(find({ rms: new Array(240).fill(0.01) }), 'loud')).toBeUndefined();
  });

  it('adapts to a busy game: steady play makes no windows, a real burst does', () => {
    // Slicer-like pace: an attempt every second, a wave every 8 s, a fail every 12 s, for 3 minutes.
    const events = [];
    for (let ms = 1000; ms < 180_000; ms += 1000) events.push(ev(ms, 'slice', 'attempt'));
    for (let ms = 4000; ms < 180_000; ms += 8000) events.push(ev(ms, 'wave_start', 'progress'));
    for (let ms = 6500; ms < 180_000; ms += 12_000) events.push(ev(ms, 'wrong_cut', 'fail'));
    // a burst: four fails in six seconds around 100 s
    for (const ms of [100_200, 101_700, 103_300, 105_900]) events.push(ev(ms, 'life_lost', 'fail'));
    events.sort((a, b) => a.ms - b.ms);
    const cs = find({ events, durationMs: 180_000 });
    const nonSweep = cs.filter(c => c.triggers.some(t => t !== 'sweep'));
    expect(nonSweep).toHaveLength(1);
    expect(nonSweep[0].triggers.some(t => t.startsWith('fail'))).toBe(true);
    expect(nonSweep[0].startMs).toBeLessThanOrEqual(100_200);
    expect(nonSweep[0].endMs).toBeGreaterThanOrEqual(105_900);
    expect(nonSweep[0].endMs - nonSweep[0].startMs).toBeLessThan(25_000);
    expect(cs.flatMap(c => c.triggers)).not.toContain('retry:slice');
    expect(cs.flatMap(c => c.triggers)).not.toContain('fast_progress');
  });

  it('marks the end of a run or level', () => {
    expect(has(find({ events: [ev(60_000, 'run_end', 'progress')] }), 'end')).toBeTruthy();
    expect(has(find({ events: [ev(60_000, 'level_end', 'progress')] }), 'end')).toBeTruthy();
    expect(has(find({ events: [ev(60_000, 'wave_start', 'progress')] }), 'end')).toBeUndefined();
  });

  it('ignores the spoken debrief after play: no windows start after debrief_start', () => {
    const events = [ev(30_000, 'die', 'fail'), ev(80_000, 'debrief_start', 'note'), ev(90_000, 'quit_now', 'quit')];
    const cs = find({ events, durationMs: 120_000 });
    expect(cs.every(c => c.endMs <= 80_000)).toBe(true);
    expect(has(cs, 'quit')).toBeUndefined();
  });

  it('merges overlapping windows and unions triggers', () => {
    const cs = find({ events: [ev(30_000, 'die', 'fail'), ev(42_000, 'back', 'quit')] });
    const merged = cs.find(c => c.triggers.includes('fail:die'))!;
    expect(merged.triggers).toEqual(expect.arrayContaining(['fail:die', 'quit']));
    expect(merged).toMatchObject({ startMs: 24_000, endMs: 50_000 });
  });

  it('clamps to the session', () => {
    const cs = find({ events: [ev(2000, 'die', 'fail'), ev(118_000, 'die', 'fail')] });
    expect(cs[0].startMs).toBe(0);
    expect(cs.at(-1)!.endMs).toBe(120_000);
  });

  it('splits a long window at 30 s', () => {
    // A minute of fails every 3 s: one long burst.
    const events = Array.from({ length: 20 }, (_, i) => ev(20_000 + i * 3000, `e${i}`, 'fail'));
    const cs = find({ events, durationMs: 200_000 }).filter(c => c.triggers.some(t => t.startsWith('fail')));
    expect(cs.length).toBeGreaterThan(1);
    expect(cs.every(c => c.endMs - c.startMs <= 40_000)).toBe(true);
    expect(cs[1].startMs).toBe(cs[0].endMs);
  });

  it('adds a sweep window every 60 s on an empty session, with sequential ids', () => {
    const cs = find({ durationMs: 200_000 });
    expect(cs.map(c => c.triggers)).toEqual([['sweep'], ['sweep'], ['sweep']]);
    expect(cs.map(c => c.id)).toEqual(['c001', 'c002', 'c003']);
  });
});

describe('candidatesStage', () => {
  it('reads aligned.json, transcript.json and the wav chunk, and writes candidates.json', async () => {
    const dir = await tmp();
    // 4 s: quiet sine, then a loud burst at 2 s
    await run(['-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=16000', '-af', 'volume=0.02,volume=enable=\'between(t,2,2.6)\':volume=200', '-t', '4', '-ac', '1', '-c:a', 'pcm_s16le', join(dir, 'mic_000.wav')]);
    await writeFile(join(dir, 'aligned.json'), JSON.stringify({ t0: 0, durationMs: 100_000, tracks: {}, events: [], audio: { offsetMs: 10_000, wavChunks: [{ file: 'mic_000.wav', startMs: 0 }] } }));
    const cs = await candidatesStage(dir);
    expect(JSON.parse(await readFile(join(dir, 'candidates.json'), 'utf8'))).toEqual(cs);
    const loud = cs.find(c => c.triggers.includes('loud'));
    expect(loud).toBeTruthy();
    expect(loud!.startMs).toBeGreaterThanOrEqual(5000);   // 10 s offset + 2 s - 6 s window lead
    expect(loud!.startMs).toBeLessThanOrEqual(7000);
  }, 10000);
});
