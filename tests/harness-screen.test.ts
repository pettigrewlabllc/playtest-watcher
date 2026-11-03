import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { pickClickables, gridSvg, clickables, gridShot, GRID_ID, type Candidate } from '../src/agent/screen.ts';
import { play } from '../src/agent/play.ts';
import { createMetaClient } from '../src/meta/client.ts';

const c = (o: Partial<Candidate>): Candidate => ({ parent: null, ownText: '', text: '', label: '', semantic: true, x: 0, y: 0, ...o });

describe('pickClickables', () => {
  it('keeps a lone clickable, labelled or not', () => {
    expect(pickClickables([c({ ownText: 'Play', text: 'Play' }), c({})], 60).map(b => b.text)).toEqual(['Play', '']);
  });

  it('collapses a wrapper whose words all belong to its inner clickable to the inner one', () => {
    // <div tabindex=0><button>Start</button></div>
    const out = pickClickables([c({ text: 'Start' }), c({ parent: 0, ownText: 'Start', text: 'Start', x: 5 })], 60);
    expect(out).toEqual([{ i: 0, text: 'Start', x: 5, y: 0 }]);
  });

  it('keeps a card with its own title and its inner button, the card labelled by its own words', () => {
    // <div onclick><h3>Pyramids</h3><button>Info</button></div>
    const out = pickClickables([c({ ownText: 'Pyramids', text: 'Pyramids Info' }), c({ parent: 0, ownText: 'Info', text: 'Info' })], 60);
    expect(out.map(b => b.text)).toEqual(['Pyramids', 'Info']);
    expect(out.map(b => b.i)).toEqual([0, 1]);
  });

  it('drops a bare icon inside a labelled clickable, and keeps the deepest of an unlabelled chain', () => {
    expect(pickClickables([c({ ownText: 'Settings', text: 'Settings' }), c({ parent: 0 })], 60).map(b => b.text)).toEqual(['Settings']);
    const chain = pickClickables([c({ x: 1 }), c({ parent: 0, x: 2 }), c({ parent: 1, x: 3 })], 60);
    expect(chain.map(b => b.x)).toEqual([3]);
  });

  it('caps the list, the page\'s own clickables before cursor-only ones, in document order', () => {
    const cands = Array.from({ length: 80 }, (_, i) => c({ ownText: `b${i}`, text: `b${i}`, semantic: i % 2 === 0 }));
    const out = pickClickables(cands, 60);
    expect(out).toHaveLength(60);
    expect(out.filter(b => Number(b.text.slice(1)) % 2 === 0)).toHaveLength(40);
    expect(out.map(b => Number(b.text.slice(1)))).toEqual([...out.map(b => Number(b.text.slice(1)))].sort((a, b) => a - b));
    expect(out.map(b => b.i)).toEqual(out.map((_, i) => i));
  });
});

describe('aim grid', () => {
  it('draws a line every 50 px with x labels across the top and y labels down the left', () => {
    const svg = gridSvg(390, 844);
    const xs = [...svg.matchAll(/<text x="(\d+)" y="9"/g)].map(m => Number(m[1]));
    const ys = [...svg.matchAll(/<text x="2" y="(\d+)">(\d+)</g)].map(m => Number(m[2]));
    expect(xs).toEqual([50, 100, 150, 200, 250, 300, 350]);
    expect(ys).toEqual([50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800]);
    expect(svg.match(/<line /g)).toHaveLength(7 + 16);
  });
});

// Chrome-backed checks. CI (ubuntu) may have no Chrome: these skip instead of failing.
let browser: Browser | null = null;
beforeAll(async () => {
  try { browser = await chromium.launch({ channel: 'chrome', headless: true }); } catch { browser = null; }
}, 60000);   // a cold Chrome on a CI runner has taken over 10 s to start
afterAll(async () => { await browser?.close(); });

const PAGE = `<!doctype html><html><body style="margin:0;font:16px sans-serif">
  <button id="b">Start</button>
  <div onclick="1" style="height:40px">Go north</div>
  <div class="card" style="cursor:pointer;height:60px"><span>Pyramids of Giza</span> <b>see more</b></div>
  <div tabindex="0" style="height:40px"><button>Inner</button></div>
  <div tabindex="-1" style="height:30px">not focusable</div>
  <input type="submit" value="Send"> <input type="button" value="Clear">
  <input id="c" type="checkbox"><label for="c">Remember me</label>
  <details><summary>More info</summary>hidden</details>
  <div style="height:30px">plain text</div>
  <canvas width="390" height="200" style="display:block;background:#246"></canvas>
</body></html>`;

describe('in Chrome', () => {
  it('sees divs with handlers, pointer-cursor cards, tabindex, inputs, labels and summaries, without nested repeats', async ctx => {
    if (!browser) return ctx.skip();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent(PAGE);
    const texts = (await clickables(page)).map(b => b.text);
    await page.close();
    expect(texts).toEqual(['Start', 'Go north', 'Pyramids of Giza see more', 'Inner', 'Send', 'Clear', 'Remember me', 'More info']);
  });

  it('puts the grid on the model\'s screenshot only, and takes it off again', async ctx => {
    if (!browser) return ctx.skip();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent(PAGE);
    const plain = await page.screenshot({ type: 'jpeg', quality: 60 });
    const grid = await gridShot(page);
    const after = await page.screenshot({ type: 'jpeg', quality: 60 });
    expect(await page.evaluate(id => !!document.getElementById(id), GRID_ID)).toBe(false);
    expect(grid.equals(plain)).toBe(false);
    expect(after.equals(plain)).toBe(true);
    await page.close();
  });

  it('plays standalone: no watcher, its own session id, the game\'s events caught into --out', { timeout: 60_000 }, async ctx => {
    if (!browser) return ctx.skip();
    const web = await mkdtemp(join(tmpdir(), 'pw-game-')), out = await mkdtemp(join(tmpdir(), 'pw-out-'));
    await writeFile(join(web, 'playtest-log.js'), await readFile(resolve(import.meta.dirname, '..', 'public', 'playtest-log.js')));
    await writeFile(join(web, 'index.html'), `<!doctype html><html><body><script src="playtest-log.js"></script>
      <h1>Tiny</h1><div id="go" onclick="PlaytestLog.log('tap', {kind: 'fail'})" style="height:60px">Tap me</div></body></html>`);
    const srv: Server = createServer(async (req, res) => {
      const f = join(web, new URL(req.url ?? '/', 'http://x').pathname.replace(/^\/$/, '/index.html'));
      try { res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(await readFile(f)); } catch { res.writeHead(404).end(); }
    });
    await new Promise<void>(ok => srv.listen(0, '127.0.0.1', ok));
    try {
      const persona = JSON.parse(await readFile(resolve(import.meta.dirname, 'fixtures', 'harness-persona.json'), 'utf8'));
      const client = createMetaClient({ live: false, budgetUsd: 0, spendLog: join(out, 'spend.jsonl') });
      const res = await play('Z', { game: 'tiny', steps: 3, url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/`, client, persona, outDir: out, watcher: null, point: true, log: () => {} });
      expect(res.standalone).toBe(true);
      expect(res.dir).toBe(join(out, res.session));
      expect(JSON.parse(await readFile(join(res.dir, 'session.json'), 'utf8'))).toMatchObject({ id: res.session, kid: 'Z', game: 'tiny', round: 'agent' });
      const shots = (await readdir(join(res.dir, 'shots'))).sort();
      expect(shots).toEqual(['001-grid.jpg', '001.jpg', '002-grid.jpg', '002.jpg', '003-grid.jpg', '003.jpg']);
      const evs = (await readFile(join(res.dir, 'events.jsonl'), 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l));
      expect(evs.filter(e => e.type === 'tap')).toHaveLength(3);
      expect(res.steps.every(s => s.target === 'Tap me')).toBe(true);
      expect(res.steps.at(-1)!.fails_in_row).toBeGreaterThanOrEqual(2);   // fail counting from the caught events
      expect(res.steps.every(s => typeof s.gap_ms === 'number' && Math.abs(s.since_last_ms! - s.gap_ms!) < 40 || s.n === 1)).toBe(true);
      expect(existsSync(join(out, 'players', 'Z'))).toBe(true);   // the persona copy stays with the run
    } finally {
      srv.close();
      await rm(web, { recursive: true, force: true }); await rm(out, { recursive: true, force: true });
    }
  });
});
