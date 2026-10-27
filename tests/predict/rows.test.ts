import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sessionRows, writeRowsCsv } from '../../src/predict/rows.ts';
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
