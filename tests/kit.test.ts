import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { measureEvents, mergeParts, profileDrives, readMap, readRows, fromSurvey, type EventMap } from '../src/kit/adapters.ts';
import { buildPersona, checkConsent, renderCard, type Answers } from '../src/kit/intake.ts';
import { loadPersona, pickMember, savePersona, toEngine, validatePersona, type Persona2 } from '../src/kit/persona.ts';
import { createMetaClient } from '../src/meta/client.ts';

const EX = resolve(import.meta.dirname, '..', 'examples');
const fake = () => createMetaClient({ live: false, budgetUsd: 0, spendLog: join(tmpdir(), 'kit-spend.jsonl') });
const build = (a: Answers, dir: string) => buildPersona(a, { root: join(tmpdir(), 'no-recordings'), personasDir: dir, client: fake() });
const analytics = async (): Promise<Answers> => {
  const YAML = (await import('yaml')).default;
  const a = YAML.parse(await readFile(join(EX, 'answers', 'analytics-player.yaml'), 'utf8')) as Answers;
  a.sources = a.sources!.map(s => ({ ...s, ...('path' in s ? { path: resolve(EX, '..', s.path) } : {}), ...('map' in s ? { map: resolve(EX, '..', s.map) } : {}) })) as Answers['sources'];
  return a;
};

describe('event logs through a mapping file', () => {
  it('measures first tap, pace, errors and fail streaks from any export', async () => {
    const rows = await readRows(join(EX, 'data', 'events.csv'));
    const map = await readMap<EventMap>(join(EX, 'data', 'events.map.yaml'));
    const { limits } = measureEvents(rows, map);
    expect(limits.first_tap_s!.value).toBeCloseTo(3.2);      // screen to next tap: 3.2, 2.6, 3.8 s
    expect(limits.error_rate!.value).toBeCloseTo(4 / 7);
    expect(limits.sour_after_fails!.value).toBe(2);          // streaks of 3 and 1, reset only by a right answer
    expect(limits.first_tap_s!.basis).toBe('measured');
  });
  it('flags whole-second timestamps as too coarse', () => {
    const { notes } = measureEvents([{ t: '1', e: 'screen_view' }, { t: '4', e: 'tap' }], { time: 't', event: 'e', time_unit: 's', measures: { first_tap_s: { median_gap: ['screen_view', 'tap'] } } });
    expect(notes.join(' ')).toMatch(/whole seconds/);
  });
});

describe('surveys and profile facts', () => {
  it('scales survey answers into drives as self-report', async () => {
    const p = await fromSurvey(join(EX, 'data', 'survey.csv'), join(EX, 'data', 'survey.map.yaml'));
    expect(p.drives.mastery).toMatchObject({ pull: 1, basis: 'self-report' });
    expect(p.drives.speed!.pull).toBe(-1);
  });
  it('turns profile facts into small drive guesses, never limits', () => {
    const d = profileDrives({ interests: ['chess', 'puzzles', 'science', 'math', 'strategy games', 'programming'] });
    expect(d.mastery).toMatchObject({ pull: 0.4, basis: 'guess' });   // capped
  });
  it('lets measured numbers beat guesses', () => {
    const m = mergeParts([
      { limits: { first_tap_s: { value: 9, basis: 'guess', sources: [] } }, drives: { story: { pull: 0.4, basis: 'guess', why: 'x' } }, source: { type: 'profile', read_at: '', summary: '' } },
      { limits: { first_tap_s: { value: 3, basis: 'measured', sources: [] } }, drives: { story: { pull: -0.5, basis: 'self-report', why: 'y' } }, source: { type: 'events', read_at: '', summary: '' } },
    ]);
    expect(m.limits.first_tap_s!.value).toBe(3);
    expect(m.drives.story!.pull).toBe(-0.5);
  });
});

describe('intake', () => {
  it('stops before reading anything when a real person has no consent', async () => {
    const a: Answers = { name: 'Kid', kind: 'person', age: 9, sources: [{ type: 'events', path: '/does/not/exist.csv', map: '/nope.yaml' }] };
    await expect(build(a, tmpdir())).rejects.toThrow(/confirm consent/);
    expect(() => checkConsent({ ...a, consent: { basis: 'self', confirmed: true } })).toThrow(/parent/);
  });
  it('builds a valid persona from an analytics export, a survey and profile facts, and saves versions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kit-'));
    const p = await build(await analytics(), dir);
    expect(await validatePersona(p)).toEqual([]);
    expect(p.limits.first_tap_s!.basis).toBe('measured');
    expect(p.drives.mastery!.basis).toBe('self-report');
    expect(p.provenance.sources.map(s => s.type)).toEqual(['events', 'survey', 'profile']);
    expect(renderCard(p)).toMatch(/from norms by age/);
    await savePersona(dir, p);
    await savePersona(dir, p);
    expect((await loadPersona('puzzle-fan', dir)).version).toBe(2);
    expect(existsSync(join(dir, 'puzzle-fan', 'versions', 'v1.json'))).toBe(true);
  });
  it('builds a group that plays one whole member per run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kit-'));
    const one = await build(await analytics(), dir);
    await savePersona(dir, one);
    await savePersona(dir, { ...one, name: 'Fast Fan', slug: 'fast-fan', limits: { ...one.limits, first_tap_s: { value: 1, basis: 'measured', sources: [] } } });
    const g = await build({ name: 'Club', kind: 'group', consent: { basis: 'participant', confirmed: true }, members: ['puzzle-fan', 'fast-fan'] }, dir);
    expect(await validatePersona(g)).toEqual([]);
    expect(g.caveats[0]).toMatch(/Small group/);
    const runs = [1, 2, 3, 4, 5, 6].map(seed => toEngine(g, { letter: 'G', target: 'x', seed }));
    expect(new Set(runs.map(r => r.member)).size).toBe(2);
    for (const r of runs) expect([1, 3.2]).toContainEqual(expect.closeTo(r.persona.limits.first_tap_s.value!, 5));
  });
});

describe('persona/2 rules', () => {
  const base = (): Persona2 => ({
    schema: 'persona/2', name: 'P', slug: 'p', version: 1, kind: 'person', built: '', age: 30, adult: true, who: 'an adult',
    limits: { first_tap_s: { value: 2, basis: 'measured', sources: [], per_game: { g1: 2.5 } } }, drives: {},
    card: { who: '', plays_like: '', plays_for: '' }, provenance: { sources: [], consent: { required: true, basis: 'self', confirmed_at: '2026-11-01' } }, validation: null, caveats: [],
  });
  it('rejects quoted speech, missing consent and bad fields', async () => {
    expect(await validatePersona(base())).toEqual([]);
    expect((await validatePersona({ ...base(), drives: { story: { pull: 1, basis: 'self-report', why: 'said "I love it"' } } })).join()).toMatch(/quotes/);
    expect((await validatePersona({ ...base(), provenance: { sources: [], consent: { required: true, basis: 'self', confirmed_at: null } } })).join()).toMatch(/consent/);
    expect((await validatePersona({ ...base(), limits: { speedz: {} } } as any)).length).toBeGreaterThan(0);
  });
  it('uses the target game, else a named similar game, else the overall value', () => {
    const p = base();
    expect(toEngine(p, { letter: 'P', target: 'g1' }).persona.limits.first_tap_s.value).toBe(2.5);
    expect(toEngine(p, { letter: 'P', target: 'new', limitsGame: 'g1' }).used.first_tap_s).toMatch(/borrowed from g1/);
    expect(toEngine(p, { letter: 'P', target: 'new' }).persona.limits.first_tap_s.value).toBe(2);
    expect(toEngine(p, { letter: 'P', target: 'new' }).used.read_share).toMatch(/norm/);
  });
  it('spreads seeds across members', () => {
    expect(new Set(Array.from({ length: 30 }, (_, s) => pickMember(5, s))).size).toBe(5);
  });
});
