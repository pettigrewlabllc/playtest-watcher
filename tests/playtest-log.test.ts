import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

const src = readFileSync(join(import.meta.dirname, '..', 'public', 'playtest-log.js'), 'utf8');

function storage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() };
}

function load(search: string, ls: ReturnType<typeof storage>) {
  const noop = () => {};
  const ctx: Record<string, unknown> = {
    location: { search }, localStorage: ls, URLSearchParams, Date, JSON, setInterval: noop, setTimeout: noop, clearTimeout: noop,
    fetch: async () => ({ ok: true }), navigator: { sendBeacon: () => true },
    addEventListener: noop, document: { addEventListener: noop, visibilityState: 'visible' }, screen: {}, innerWidth: 390, innerHeight: 844,
  };
  ctx.window = ctx;
  runInNewContext(src, ctx);
}

describe('playtest-log fresh start', () => {
  it('clears saved progress on the first load of a playtest session, and not on a reload', () => {
    const ls = storage({ hk2_season: '3', best: '99' });
    load('?playtest=s-1&pw=http://x:3058', ls);
    expect([...ls.m.keys()]).toEqual(['pw_fresh']);
    ls.setItem('hk2_season', '1');
    load('?playtest=s-1&pw=http://x:3058', ls);
    expect(ls.getItem('hk2_season')).toBe('1');
    load('?playtest=s-2&pw=http://x:3058', ls);
    expect(ls.getItem('hk2_season')).toBeNull();
  });

  it('never touches storage outside a playtest', () => {
    const ls = storage({ best: '99' });
    load('', ls);
    expect(ls.getItem('best')).toBe('99');
  });
});
