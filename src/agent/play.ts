// Live persona play (persona engine spec §0): Muse Spark plays a real game in Chrome as one kid's persona.
// The harness, not the model, enforces the kid's limits:
//   - time: the page clock is frozen while Muse thinks, then moved on by the kid's own first-tap delay (new
//     screen) or gap between actions, so a slow persona spends more of a timed round than a fast one;
//   - reading: each new block of text is read or skipped by the kid's read share; a skipped one is hidden from
//     the screenshot and only its first words reach Muse;
//   - accuracy: by the kid's error rate a tap lands on the neighbouring button;
//   - patience: after the kid's fail streak the step is marked frustrated whatever the model said (forced: true).
// The game's own event logger stays on, so the run is an ordinary session (round "agent").
//
//   PW_LIVE=1 npm run play -- <letter> [--game hoard-keeper] [--steps 40] [--url http://localhost:3054/] --live
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { clientFromEnv, createMetaClient, type MetaClient } from '../meta/client.ts';
import { buildPersonaFile, writePersonaFile } from '../persona/build.ts';
import { compile, rulesText, type Harness } from '../persona/compile.ts';
import { LABELS } from '../watch/explain.ts';

const REPO = resolve(import.meta.dirname, '..', '..');
const ROOT = join(REPO, 'recordings');
const NEGATIVE = new Set(['confused', 'stuck', 'bored', 'frustrated']);

export type Step = {
  n: number; t: number; screen: string; action: string; target: string; intended: string | null; missed: boolean;
  read: string[]; skipped: string[]; label: string; forced: boolean; why: string; say: string; would_quit: boolean; fails_in_row: number;
};

const STEP_SCHEMA = {
  name: 'agent_step',
  schema: {
    type: 'object', additionalProperties: false, required: ['action', 'button', 'label', 'why', 'would_quit', 'say'],
    properties: {
      action: { type: 'string', enum: ['tap', 'wait', 'quit'] },
      button: { type: 'integer' },
      label: { type: 'string', enum: [...LABELS] },
      why: { type: 'string' }, would_quit: { type: 'boolean' }, say: { type: 'string' },
    },
  },
};

// Deterministic noise so a run can be repeated: a seeded generator per run.
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
// Spread around the kid's median, roughly log-normal (x0.6 to x1.7 most of the time).
export const jitter = (median: number, r: () => number) => median * Math.exp((r() + r() + r() - 1.5) * 0.6);

// Which neighbour a missed tap lands on.
export function missTarget(i: number, count: number, r: () => number): number {
  if (count < 2) return i;
  if (i === 0) return 1;
  if (i === count - 1) return count - 2;
  return r() < 0.5 ? i - 1 : i + 1;
}

type Seen = { buttons: { i: number; text: string; x: number; y: number }[]; texts: { key: string; text: string }[]; labels: string[]; screen: string };

async function observe(page: Page): Promise<Seen> {
  return page.evaluate(() => {
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < innerHeight && getComputedStyle(e).visibility !== 'hidden'; };
    const buttons = [...document.querySelectorAll('button, [role=button], a[href]')].filter(vis).map((e, i) => {
      const r = (e as HTMLElement).getBoundingClientRect();
      return { i, text: ((e as HTMLElement).innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 60), x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    // text blocks: leaf-ish elements with real sentences that are not buttons
    // Long text is reading (the reading limit applies); short labels are glanced at and always seen.
    const texts: { key: string; text: string }[] = [];
    const labels: string[] = [];
    document.querySelectorAll('p, li, h1, h2, h3, span, b, .coach, .small, .note, .banner, .toast, div').forEach(e => {
      if (!vis(e) || e.closest('button')) return;
      if ([...e.children].some(c => /^(P|DIV|UL|OL|LI|H1|H2|H3)$/.test(c.tagName))) return;
      const t = (e as HTMLElement).innerText.trim().replace(/\s+/g, ' ');
      if (!t) return;
      if (t.length < 25) { if (!labels.includes(t) && labels.length < 40) labels.push(t); return; }
      const key = t.slice(0, 80);
      (e as HTMLElement).dataset.pwText = key;
      texts.push({ key, text: t });
    });
    // Pictures by their alt text, as a screen reader gives them: a kid sees a red fire dragon at a glance, but Muse
    // misread the dragon art often enough to file over half the slips wrong (the page itself never mis-taps).
    const pics = [...document.querySelectorAll('img[alt]')].filter(vis).map(e => `[picture: ${e.getAttribute('alt')}]`).filter(t => t.length > 12);
    for (const t of pics) if (!labels.includes(t) && labels.length < 60) labels.unshift(t);
    const screen = (document.querySelector('h1, h2, .title')?.textContent ?? '').trim().slice(0, 50) || buttons.slice(0, 3).map(b => b.text).join(' | ');
    return { buttons, texts, labels, screen };
  });
}

async function hideSkipped(page: Page, keys: string[]) {
  await page.evaluate(ks => {
    const set = new Set(ks);
    document.querySelectorAll<HTMLElement>('[data-pw-text]').forEach(e => { if (set.has(e.dataset.pwText!)) { e.style.color = 'transparent'; e.style.textShadow = 'none'; } });
  }, keys);
}

async function readEvents(session: string): Promise<{ t: number; type: string; data?: Record<string, unknown> }[]> {
  try { return (await readFile(join(ROOT, session, 'events.jsonl'), 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; }
}

export async function play(letter: string, o: { game: string; steps: number; url: string; watcher: string; client: MetaClient; seed?: number; log?: (l: string) => void }) {
  const log = o.log ?? console.log;
  const persona = await buildPersonaFile(ROOT, letter, o.game);
  await writePersonaFile(ROOT, persona);
  const compiled = compile(persona);
  const h: Harness = compiled.harness;
  const rules = rulesText(compiled, persona.letter, persona.age);
  const r = rng(o.seed ?? 7);

  const sres = await fetch(`${o.watcher}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kid: persona.letter, game: o.game, round: 'agent', device: 'agent' }) });
  const session = ((await sres.json()) as { id: string }).id;
  const dir = join(ROOT, session);
  await mkdir(join(dir, 'shots'), { recursive: true });
  await writeFile(join(dir, 'persona.json'), JSON.stringify({ persona, compiled, rules }, null, 2));
  log(`session ${session}: Player ${persona.letter} on ${o.game}; first tap ${h.firstTapS.toFixed(1)} s, gap ${h.actionGapS.toFixed(1)} s, reads ${Math.round(h.readShare * 100)}%, misses ${Math.round(h.errorRate * 100)}%, sours after ${h.sourAfterFails}`);

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const t0 = Date.now();
  await page.clock.install({ time: t0 });
  await page.goto(`${o.url}?playtest=${session}&pw=${encodeURIComponent(o.watcher)}`);
  await page.clock.pauseAt(t0 + 1500);
  let gameMs = 1500;

  const steps: Step[] = [];
  const decided = new Map<string, boolean>();   // text block -> read?
  let lastScreen = '', failsInRow = 0, seenEvents = 0, badAnswers = 0, sourSteps = 0;
  try {
    for (let n = 1; n <= o.steps; n++) {
      // The kid's time passes first (first-tap delay on a new screen, else the gap between actions); then the
      // agent looks and decides with the clock frozen, and acts at once. Looking first and waiting after made it
      // answer a slip the Rush had already moved past.
      const glance = await observe(page);
      const screenKey = glance.buttons.map(b => b.text).join('|');
      const delayS = jitter(screenKey !== lastScreen ? h.firstTapS : h.actionGapS, r);
      lastScreen = screenKey;
      await page.clock.runFor(Math.round(delayS * 1000));
      gameMs += delayS * 1000;
      const seen = await observe(page);
      const fresh = seen.texts.filter(t => !decided.has(t.key));
      for (const t of fresh) decided.set(t.key, r() < h.readShare);
      const skipped = seen.texts.filter(t => decided.get(t.key) === false);
      await hideSkipped(page, skipped.map(t => t.key));
      // With the page clock frozen Chrome may not paint, and screenshots came back a frame behind the page (the
      // agent filed slips that were already gone). Let ~80 ms of real time run so a fresh frame exists, then freeze.
      await page.clock.resume();
      await page.waitForTimeout(80);
      const nowMs = await page.evaluate(() => Date.now());
      await page.clock.pauseAt(nowMs + 20);
      gameMs += 100;
      const shotBuf = await page.screenshot({ type: 'jpeg', quality: 60 });
      await writeFile(join(dir, 'shots', `${String(n).padStart(3, '0')}.jpg`), shotBuf);
      const shot = shotBuf.toString('base64');

      const evs = await readEvents(session);
      for (const e of evs.slice(seenEvents)) {
        const kind = String(e.data?.kind ?? '');
        if (kind === 'fail') failsInRow++; else if (kind === 'success') failsInRow = 0;
      }
      seenEvents = evs.length;
      const sour = failsInRow >= h.sourAfterFails;

      const prompt = [
        rules, '',
        `You are playing a game on a phone. Game time so far: ${Math.round(gameMs / 1000)} s.`,
        sour ? `You have failed ${failsInRow} times in a row. You are frustrated now.` : failsInRow ? `You have failed ${failsInRow} time${failsInRow === 1 ? '' : 's'} in a row.` : '',
        'TEXT ON SCREEN THAT YOU READ:', ...seen.texts.filter(t => decided.get(t.key)).map(t => `- ${t.text}`),
        'SHORT LABELS YOU CAN SEE:', seen.labels.join(' · ') || '(none)',
        'TEXT YOU DID NOT READ (you only glanced at the first words):', ...skipped.map(t => `- ${t.text.split(' ').slice(0, 4).join(' ')}...`),
        'BUTTONS (tap by number):', ...seen.buttons.map(b => `[${b.i}] ${b.text || '(no label)'}`),
        '',
        'Choose your next action as this child: tap a button by its number, wait (do nothing for a few seconds), or quit. label: how you feel right now. say: what you would say out loud, in your words (empty if nothing). why: one short sentence.',
      ].filter(Boolean).join('\n');
      type Answer = { action: string; button: number; label: string; why: string; would_quit: boolean; say: string };
      let d: Answer;
      try {
        d = (await o.client.respond<Answer>({
          model: 'muse-spark-1.2', kind: `play:${persona.letter}:${o.game}`, schema: STEP_SCHEMA, maxOutputTokens: 8000,
          content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: `data:image/jpeg;base64,${shot}` }],
        })).data;
        badAnswers = 0;
      } catch (e) {
        // Muse sometimes pads a finished answer with blank space until the cap; log a pause and go on.
        if (++badAnswers >= 3) { log(`stopping: three bad answers in a row (${(e as Error).message.slice(0, 80)})`); break; }
        d = { action: 'wait', button: 0, label: 'none', why: `no usable answer: ${(e as Error).message.slice(0, 80)}`, would_quit: false, say: '' };
      }

      let target = '', intended: string | null = null, missed = false;
      if (d.action === 'tap' && seen.buttons.length) {
        let i = Math.max(0, Math.min(seen.buttons.length - 1, d.button | 0));
        intended = seen.buttons[i].text;
        if (r() < h.errorRate) { i = missTarget(i, seen.buttons.length, r); missed = seen.buttons[i].text !== intended; }
        const b = seen.buttons[i];
        target = b.text;
        await page.mouse.click(b.x, b.y);
      } else if (d.action === 'wait') {
        await page.clock.runFor(3000); gameMs += 3000;
      }
      await page.clock.runFor(400); gameMs += 400;
      // Quitting is the harness's call: only after the fail limit has held for two steps in a row. Every real kid
      // played the full ten minutes, so a model's early "quit" is kept as would_quit and play goes on.
      sourSteps = sour ? sourSteps + 1 : 0;
      const quit = d.action === 'quit' && sourSteps >= 2;

      const label = (LABELS as readonly string[]).includes(d.label) ? d.label : 'none';
      const forced = sour && !NEGATIVE.has(label);
      const step: Step = {
        n, t: Math.round(gameMs) / 1000, screen: seen.screen, action: d.action === 'quit' && !quit ? 'wait' : d.action, target, intended: missed ? intended : null, missed,
        read: seen.texts.filter(t => decided.get(t.key)).map(t => t.text.slice(0, 60)), skipped: skipped.map(t => t.text.slice(0, 60)),
        label: forced ? 'frustrated' : label, forced, why: d.why, say: d.say, would_quit: d.would_quit || d.action === 'quit', fails_in_row: failsInRow,
      };
      steps.push(step);
      log(`${String(n).padStart(2)} ${step.t.toFixed(1).padStart(6)}s ${step.label.padEnd(10)}${forced ? '*' : ' '} ${d.action} ${target.slice(0, 30)}${missed ? ` (meant ${intended})` : ''} | ${d.say || d.why}`.slice(0, 160));
      await writeFile(join(dir, 'steps.jsonl'), steps.map(s => JSON.stringify(s)).join('\n') + '\n');
      if (quit) { log('quit'); break; }
    }
    await page.clock.runFor(1500);   // let the logger flush
  } finally {
    await browser.close();
  }
  return { session, steps, persona, compiled };
}

export function summarize(steps: Step[]) {
  const labels: Record<string, number> = {};
  for (const s of steps) labels[s.label] = (labels[s.label] ?? 0) + 1;
  return { steps: steps.length, game_s: steps.at(-1)?.t ?? 0, missed: steps.filter(s => s.missed).length, forced: steps.filter(s => s.forced).length,
    skipped_texts: new Set(steps.flatMap(s => s.skipped)).size, read_texts: new Set(steps.flatMap(s => s.read)).size, labels, quit: steps.some(s => s.action === 'quit') };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const args = process.argv.slice(2);
  const letter = args.find(a => /^[A-Za-z]$/.test(a));
  const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  if (!letter) { console.error('usage: npm run play -- <letter> [--game hoard-keeper] [--steps 40] [--url http://localhost:3054/] [--watcher http://localhost:3058] [--seed 7] --live'); process.exit(1); }
  const live = args.includes('--live');
  const client = live ? clientFromEnv(REPO) : createMetaClient({ live: false, budgetUsd: 0, spendLog: join(ROOT, 'spend.jsonl') });
  if (live && !client.live) console.warn('--live given but PW_LIVE=1 and MODEL_API_KEY are not both set; fake mode');
  const out = await play(letter, { game: opt('game', 'hoard-keeper'), steps: Number(opt('steps', '40')), url: opt('url', 'http://localhost:3054/'), watcher: opt('watcher', 'http://localhost:3058'), seed: Number(opt('seed', '7')), client });
  const sum = summarize(out.steps);
  await writeFile(join(ROOT, out.session, 'summary.json'), JSON.stringify(sum, null, 2));
  console.log(JSON.stringify(sum));
  if (existsSync(join(ROOT, out.session))) console.log(`steps: ${join(ROOT, out.session, 'steps.jsonl')}`);
}
