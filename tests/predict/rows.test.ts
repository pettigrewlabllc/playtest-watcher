import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sessionRows, writeRowsCsv, resolveIntents } from '../../src/predict/rows.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { stageOf } from '../../src/predict/stages.ts';
import { ev, moment, tempRoot, writeSession } from './helpers.ts';

function events() {
  return [
    ev(0, 'progress', { level: 1 }),                  // 0
    ev(1000, 'new_thing'),                            // 1
    ev(2000, 'text_shown', { id: 't1', chars: 120 }), // 2
    ev(3000, 'text_shown', { id: 't2', chars: 30 }),  // 3
    ev(4000, 'text_closed', { id: 't1' }),            // 4
    ev(5000, 'attempt'),                              // 5
    ev(6000, 'fail'),                                 // 6
    ev(7000, 'attempt'),                              // 7
    ev(8000, 'fail'),                                 // 8
    ev(9000, 'attempt'),                              // 9
    ev(10000, 'fail'),                                // 10
    ev(11000, 'help'),                                // 11
    ev(12000, 'explore'),                             // 12
    ev(13000, 'attempt'),                             // 13
    ev(14000, 'success'),                             // 14
    ev(15000, 'progress', { level: 2 }),              // 15
    ev(20000, 'attempt'),                             // 16
    ev(21000, 'fail'),                                // 17
    ev(40000, 'attempt'),                             // 18
    ev(41000, 'explore'),                             // 19
    ev(42000, 'idle'),                                // 20
    ev(43000, 'attempt'), ev(44000, 'attempt'), ev(45000, 'attempt'), ev(46000, 'attempt'), ev(47000, 'attempt'),
    ev(48000, 'attempt'), ev(49000, 'attempt'), ev(50000, 'attempt'), ev(51000, 'attempt'), // 21..29
  ];
}

describe('sessionRows', () => {
  it('computes features at chosen indexes', async () => {
    const root = await tempRoot();
    const dir = await writeSession(root, 's1', { game: 'g1', events: events(), moments: [] });
    const rows = await sessionRows(dir);
    expect(rows).toHaveLength(30);
    expect(rows[1].new_thing_10s).toBe(1);
    expect(rows[1].s_since_progress).toBe(1);
    expect(rows[3].text_chars_on_screen).toBe(150);
    expect(rows[4].text_chars_on_screen).toBe(30);
    expect(rows[10].fail_streak).toBe(3);
    expect(rows[10].attempts_30s).toBe(3);
    expect(rows[10].s_in_session).toBe(10);
    expect(rows[11].help_so_far).toBe(1);
    expect(rows[12].explore_so_far).toBe(1);
    expect(rows[12].new_thing_10s).toBe(0);
    expect(rows[14].fail_streak).toBe(0);
    expect(rows[14].s_since_success).toBe(0);
    expect(rows[15].s_since_success).toBe(1);
    expect(rows[15].s_since_progress).toBe(0);
    expect(rows[17].fail_streak).toBe(1);
    expect(rows[17].s_since_success).toBe(7);
    expect(rows[18].attempts_30s).toBe(3); // 13000, 20000, 40000 fall in (10000, 40000]
  });

  it('changes stage on progress', () => {
    const e = events();
    expect(stageOf(e, 14)).toBe('1');
    expect(stageOf(e, 15)).toBe('2');
    expect(stageOf(e, 29)).toBe('2');
    expect(stageOf([ev(0, 'attempt')], 0)).toBe('start');
    expect(stageOf([ev(0, 'progress', { wave: 'w3' })], 0)).toBe('w3');
  });

  it('labels from ok moments by confidence and window, ignoring weak ones', async () => {
    const root = await tempRoot();
    const dir = await writeSession(root, 's1', {
      events: events(),
      moments: [
        moment('m1', 5000, 11000, 'frustrated', 0.9),
        moment('m2', 10000, 13000, 'confused', 0.6),
        moment('m3', 20000, 22000, 'bored', 0.3),
        { ...moment('m4', 40000, 42000, 'stuck', 0.9), status: 'unanalyzed' },
      ],
    });
    const rows = await sessionRows(dir);
    expect(rows[5].label).toBe('frustrated');
    expect(rows[10].label).toBe('frustrated');
    expect(rows[12].label).toBe('confused');
    expect(rows[13].label).toBe('confused');
    expect(rows[14].label).toBe('none');
    expect(rows[16].label).toBe('none');
    expect(rows[20].label).toBe('none');
    expect(rows.every(r => r.weak_labels === 0)).toBe(true);
  });

  it('falls back to event heuristics with weak_labels when moments.json is missing', async () => {
    const root = await tempRoot();
    const evs = [ev(0, 'fail'), ev(1000, 'fail'), ev(2000, 'fail'), ev(3000, 'attempt'), ev(4000, 'success'), ev(12000, 'idle')];
    const dir = await writeSession(root, 's2', { events: evs });
    const rows = await sessionRows(dir);
    expect(rows.map(r => r.label)).toEqual(['none', 'none', 'frustrated', 'frustrated', 'none', 'stuck']);
    expect(rows.every(r => r.weak_labels === 1)).toBe(true);
  });

  it('writes a csv with a header and quoted cells', async () => {
    const root = await tempRoot();
    const dir = await writeSession(root, 's3', { events: [ev(0, 'attempt', {}, 'cut, wire')], moments: [] });
    const file = join(root, 'rows.csv');
    await writeRowsCsv(await sessionRows(dir), file);
    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    expect(lines[0].startsWith('session,game,i,ms,stage,kind,type,')).toBe(true);
    expect(lines[1]).toContain('"cut, wire"');
  });
});

describe('situation features (player model)', () => {
  it('prev_label, s_since_moment, rapid_retry, attempts_no_success, block and kid', async () => {
    const root = await tempRoot();
    const evs = [
      ev(0, 'progress', { level: 1 }, 'level_start'), // 0
      ev(1000, 'attempt'),                            // 1
      ev(1200, 'fail'),                               // 2
      ev(1200, 'fail', {}, 'life_lost'),              // 3 same failure, logged twice
      ev(1800, 'attempt'),                            // 4 rapid retry (< 1 s after the fail)
      ev(2000, 'fail'),                               // 5
      ev(4000, 'attempt'),                            // 6 not rapid
      ev(4500, 'success'),                            // 7
      ev(6000, 'progress', { level: 2 }, 'level_start'), // 8
      ev(7000, 'attempt'),                            // 9
      ev(9000, 'explore'),                            // 10
    ];
    const dir = await writeSession(root, 's1', {
      kid: 'C', events: evs,
      moments: [moment('m1', 1000, 2500, 'frustrated', 0.9), moment('m2', 6500, 6800, 'delighted', 0.3)],
    });
    const rows = await sessionRows(dir);
    expect(rows.every(r => r.kid === 'C')).toBe(true);
    expect(rows[1].prev_label).toBe('none');
    expect(rows[1].s_since_moment).toBe(1);        // no moment yet: seconds since the session started
    expect(rows[6].prev_label).toBe('frustrated');
    expect(rows[6].s_since_moment).toBe(1.5);
    expect(rows[9].prev_label).toBe('frustrated');  // m2 is below the confidence floor
    expect(rows[4].rapid_retry).toBe(1);
    expect(rows[6].rapid_retry).toBe(0);
    expect(rows[1].rapid_retry).toBe(0);
    expect(rows[5].fail_streak).toBe(2);           // the duplicate fail at the same ms counts once
    expect(rows[1].attempts_no_success).toBe(1);
    expect(rows[6].attempts_no_success).toBe(3);
    expect(rows[7].attempts_no_success).toBe(0);
    expect(rows[9].attempts_no_success).toBe(1);
    expect(rows[0].block).toBe(1);
    expect(rows[7].block).toBe(1);
    expect(rows[8].block).toBe(2);
    expect(rows.every(r => r.intent === 'none')).toBe(true);
  });

  it('a debrief that calls an event accidental marks that event type', async () => {
    const root = await tempRoot();
    const evs = [ev(0, 'attempt'), ev(1000, 'explore', {}, 'compendium_open'), ev(2000, 'explore', {}, 'menu_look')];
    const dir = await writeSession(root, 's-acc', { kid: 'C', game: 'g1', events: evs, moments: [] });
    await mkdir(join(root, 'kids', 'c'), { recursive: true });
    await writeFile(join(root, 'kids', 'c', 'debriefs.json'), JSON.stringify([
      { game: 'g1', session: 's-acc', answers: [
        { q: 'From 1 to 5, how fun was that?', a: '4', fun: 4 },
        { q: 'You opened the Compendium once. Why?', a: 'I hit that accidentally.', intent: 'accidental' },
      ] },
      { game: 'g1', session: 'other', answers: [{ q: 'menu?', a: 'oops', intent: 'accidental', event: 'menu_look' }] },
    ]));
    const rows = await sessionRows(dir);
    expect(rows.map(r => r.intent)).toEqual(['none', 'accidental', 'none']);
  });

  it('an explicit event field wins over the text match', () => {
    const intents = resolveIntents([
      { game: 'g', session: 's', answers: [{ q: 'the compendium', a: 'oops', intent: 'accidental', event: 'menu_look' }] },
    ], 's', 'g', [ev(0, 'explore', {}, 'compendium_open'), ev(1, 'explore', {}, 'menu_look')]);
    expect(intents).toEqual({ menu_look: 'accidental' });
  });
});

describe('recording window', () => {
  it('keeps rows only between the recording start and stop, and before the debrief', async () => {
    const root = await tempRoot();
    const evs = [ev(-5000, 'explore', {}, 'menu_look'), ev(0, 'attempt'), ev(1000, 'fail'), ev(2000, 'attempt'),
      ev(3000, 'debrief_start', {}, 'debrief_start'), ev(4000, 'attempt'), ev(9000, 'idle')];
    const dir = await writeSession(root, 's', { events: evs, durationMs: 8000, moments: [] });
    const rows = await sessionRows(dir);
    expect(rows.map(r => r.i)).toEqual([1, 2, 3]);
    expect(rows[0].explore_so_far).toBe(1);   // state still counts what came before the window
  });
});

describe('wheel-spinning count', () => {
  it('counts only attempt types that ever get an outcome (Hoard Keeper query steps never do)', async () => {
    const root = await tempRoot();
    const evs = [ev(0, 'attempt', {}, 'file_item'), ev(100, 'fail', {}, 'file_item'), ev(1000, 'attempt', {}, 'query_step'),
      ev(1100, 'fail', {}, 'audit_answer'), ev(2000, 'attempt', {}, 'query_step'), ev(3000, 'attempt', {}, 'file_item'), ev(3100, 'success', {}, 'file_item')];
    const dir = await writeSession(root, 's', { events: evs, moments: [] });
    const rows = await sessionRows(dir);
    expect(rows.map(r => r.attempts_no_success)).toEqual([1, 1, 1, 1, 1, 2, 0]);
  });
});
