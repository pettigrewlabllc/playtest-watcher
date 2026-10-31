import { describe, it, expect } from 'vitest';
import { stepsOf, summarize, interviewLine } from '../src/interview/read.ts';
import { pickClips } from '../src/interview/pick.ts';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const step = (ms: number, step: string, item: string) => ({ ms, type: 'interview_step', data: { step, item } });
const tap = (ms: number, item: string, answer: string) => ({ ms, type: 'interview_answer', data: { item, answer } });

describe('reading an interview back', () => {
  const events = [
    step(0, 'intro', 'intro'),
    step(10000, 'clip', 'clip:s1:c001'), step(40000, 'feel', 'clip:s1:c001'), tap(42000, 'clip:s1:c001', 'Confused'), tap(43000, 'clip:s1:c001', 'Stuck'),
    step(50000, 'clip', 'clip:s1:c002'), step(80000, 'feel', 'clip:s1:c002'), tap(81000, 'clip:s1:c002', 'Bored'),
    step(90000, 'pitch', 'pitch:race'), tap(95000, 'pitch:race', 'Yes!'),
    step(100000, 'games', 'games'),
  ];
  const turns = [
    { startMs: 20000, endMs: 24000, text: "I didn't know where to put it", who: 'kid' },
    { startMs: 25000, endMs: 26000, text: 'What was going on?', who: 'adult' },
    { startMs: 91000, endMs: 94000, text: 'I would beat her', who: 'kid' },
    { startMs: 101000, endMs: 104000, text: 'Bond Swap was the best', who: 'kid' },
  ];

  it('gives each step its window, its last tap and who said what', () => {
    const steps = stepsOf(events, turns, 120000);
    const c1 = steps.find(s => s.step === 'clip' && s.item === 'clip:s1:c001')!;
    expect([c1.fromMs, c1.toMs]).toEqual([10000, 40000]);
    expect(c1.kid).toEqual(["I didn't know where to put it"]);
    expect(c1.adult).toEqual(['What was going on?']);
    expect(steps.find(s => s.step === 'feel' && s.item === 'clip:s1:c001')!.answer).toBe('Stuck');
  });

  it('compares the kid\'s word with Muse\'s label and keeps their words with each pitch', () => {
    const iv = summarize('A', 'iv', stepsOf(events, turns, 120000), new Map([['s1:c001', 'stuck'], ['s1:c002', 'confused']]));
    expect(iv.clips.map(c => [c.kidLabel, c.museLabel])).toEqual([['stuck', 'stuck'], ['bored', 'confused']]);
    expect(iv.agreement).toMatchObject({ n: 2, same: 1 });
    expect(iv.pitches.find(p => p.id === 'race')).toMatchObject({ drive: 'competition', answer: 'Yes!', said: ['I would beat her'] });
    expect(iv.pitches.find(p => p.id === 'build')!.answer).toBeNull();
    expect(iv.games).toEqual(['Bond Swap was the best']);
    expect(interviewLine(iv)).toMatch(/matched Muse on 1 of 2 clips.*Stuck vs stuck, Bored vs confused/);
  });

  it('finds a fresh interview that has not been aligned yet', async () => {
    const { readInterview } = await import('../src/interview/read.ts');
    const root = await mkdtemp(join(tmpdir(), 'pw-iv-'));
    await expect(readInterview(root, 'A', { live: false } as never)).rejects.toThrow(/no interview session for A/);
    const d = join(root, '20261031-180000-a-interview-interview');
    await mkdir(d);
    await writeFile(join(d, 'session.json'), JSON.stringify({ kid: 'a', game: 'interview', round: 'interview' }));
    await writeFile(join(d, 'aligned.json'), JSON.stringify({ durationMs: 120000, events: events.map(e => ({ ...e, kind: 'progress' })) }));
    const iv = await readInterview(root, 'A', { live: false } as never, { log: () => {} });
    expect(iv.session).toBe('20261031-180000-a-interview-interview');
    expect(iv.clips.map(c => c.kidWord)).toEqual(['Stuck', 'Bored']);
  });

  it('picks the kid\'s own clips across labels, never a none moment or a clip that was never cut', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pw-iv-'));
    const ms = [['c1', 'confused', 0.9], ['c2', 'confused', 0.8], ['c3', 'bored', 0.7], ['c4', 'none', 0.99], ['c5', 'focused', 0.6], ['c6', 'stuck', 0.5]] as const;
    const d = join(root, '20261027-230904-a-g1-learn');
    await mkdir(join(d, 'clips'), { recursive: true });
    await writeFile(join(d, 'session.json'), JSON.stringify({ kid: 'a', game: 'g1', round: 'learn' }));
    await writeFile(join(d, 'aligned.json'), '{}');
    await writeFile(join(d, 'moments.json'), JSON.stringify(ms.map(([id, label, confidence]) => ({ id, label, confidence, status: 'ok' }))));
    for (const [id] of ms) if (id !== 'c6') await writeFile(join(d, 'clips', `${id}.mp4`), 'x');
    const picks = await pickClips(root, 'A', 4);
    expect(picks.map(p => p.museLabel)).toEqual(['confused', 'bored', 'focused', 'confused']);
    expect(picks.map(p => p.id)).not.toContain('c4');
  });
});
