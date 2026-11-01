// Action mode for live persona play: fast games where timing is the skill (a runner, a slicer). Turn-based play
// (play.ts) takes one move per look; here the page clock is frozen every `lookMs` of game time, Muse Spark sees
// the screen and plans up to three timed moves for the next stretch, and the harness carries them out the way
// the kid would:
//   - no move lands sooner than the kid's reaction time after the look (a published norm for their age, not measured);
//   - each lands off by the kid's timing error (a published norm for their age, not measured);
//   - a share of moves never happen, at the kid's reflex miss rate (measured: numbers they let fall in Factor Slicer).
// Muse's thinking time never counts: game time only moves when the harness moves it.
// The game's own state can be recorded every look with --state (a JS expression); it's for scoring, never shown
// to the model, which plays from the screen alone.
//
//   PW_LIVE=1 node src/agent/action.ts <letter> --url <game> --keys "Space,ArrowDown" \
//     --controls "Space jumps. Hold ArrowDown to duck." [--state "<js>"] [--looks 40] [--look-ms 1200] --live
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { clientFromEnv, createMetaClient, type MetaClient } from '../meta/client.ts';
import { buildPersonaFile, writePersonaFile, type PersonaFile } from '../persona/build.ts';
import { describePersona } from '../persona/describe.ts';
import { loadPersonaFile } from '../persona/load.ts';
import { reactionMs, timingSdMs, REFLEX_MISS_DEFAULT } from '../persona/norms.ts';
import { blendPersona } from '../persona/blend.ts';
import { compile, rulesText } from '../persona/compile.ts';
import { LABELS } from '../watch/explain.ts';
import { newSessionId } from '../server/ids.ts';
import { rng } from './play.ts';

const REPO = resolve(import.meta.dirname, '..', '..');
const ROOT = join(REPO, 'recordings');

// Reaction time and its spread by age come from published norms (src/persona/norms.ts: Rutter et al. 2020, a
// web-based sample of 12,327 people aged 10 to 70), labelled as norms in every run, never as measured.
export function reflexDefaults(age: number | null): { reactionMs: number; timingSdMs: number; note: string } {
  const r = reactionMs(age);
  return { reactionMs: r.ms, timingSdMs: timingSdMs(age), note: r.note };
}

export type Reflex = { reactionMs: number; timingSdMs: number; missRate: number; sources: string[] };

export async function reflexFor(p: PersonaFile, root = ROOT): Promise<Reflex> {
  const d = reflexDefaults(p.adult && p.age == null ? 18 : p.age);
  let missRate = REFLEX_MISS_DEFAULT, src = 'reflex miss: default (the four kids measured 5 to 9%)';
  try {
    const lim = JSON.parse(await readFile(join(root, 'group', 'limits.json'), 'utf8'));
    const v = lim.per_game?.[p.blend?.id ?? p.letter]?.['factor-slicer']?.reflex_miss;
    if (typeof v === 'number') { missRate = v; src = 'reflex miss: measured, numbers they let fall in Factor Slicer'; }
  } catch { /* no limits yet */ }
  return { reactionMs: d.reactionMs, timingSdMs: d.timingSdMs, missRate, sources: [d.note, src] };
}

export type Move = { kind: 'press' | 'hold' | 'tap'; key: string; button: number; at_ms: number; for_ms: number };
export type Planned = Move & { fire_ms: number | null; skipped: boolean };

// When each planned move really happens: never before the kid's reaction time, off by their timing error, and
// sometimes not at all.
export function schedule(moves: Move[], rx: Reflex, r: () => number): Planned[] {
  const gauss = () => { const u = Math.max(1e-9, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  return [...moves].sort((a, b) => a.at_ms - b.at_ms).map(m => {
    if (r() < rx.missRate) return { ...m, fire_ms: null, skipped: true };
    const t = Math.max(rx.reactionMs, m.at_ms) + gauss() * rx.timingSdMs;
    return { ...m, fire_ms: Math.round(Math.max(rx.reactionMs * 0.7, t)), skipped: false };
  });
}

const PLAN_SCHEMA = {
  name: 'action_plan',
  schema: {
    type: 'object', additionalProperties: false, required: ['moves', 'label', 'say', 'why', 'would_quit'],
    properties: {
      moves: {
        type: 'array', maxItems: 3,
        items: { type: 'object', additionalProperties: false, required: ['kind', 'key', 'button', 'at_ms', 'for_ms'],
          properties: { kind: { type: 'string', enum: ['press', 'hold', 'tap'] }, key: { type: 'string' }, button: { type: 'integer' }, at_ms: { type: 'integer', minimum: 0 }, for_ms: { type: 'integer', minimum: 0 } } },
      },
      label: { type: 'string', enum: [...LABELS] }, say: { type: 'string' }, why: { type: 'string' }, would_quit: { type: 'boolean' },
    },
  },
};

async function freshShot(page: Page): Promise<Buffer> {
  // Under a frozen clock Chrome may not paint; let a few real milliseconds run so the screenshot is current.
  await page.clock.resume();
  await page.waitForTimeout(60);
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 20);
  return page.screenshot({ type: 'jpeg', quality: 60 });
}

async function buttons(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll('button, [role=button]')].map(e => {
    const r = (e as HTMLElement).getBoundingClientRect();
    return { text: ((e as HTMLElement).innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40), x: r.x + r.width / 2, y: r.y + r.height / 2, ok: r.width > 4 && r.height > 4 };
  }).filter(b => b.ok));
}

export async function playAction(letter: string, o: {
  url: string; keys: string[]; controls: string; looks: number; lookMs: number; state?: string; client: MetaClient; seed?: number; persona?: PersonaFile; game: string; limitsGame?: string; log?: (l: string) => void;
  film?: boolean; keyNames?: Record<string, string>; hide?: string;
  outDir?: string;   // where the run is written (default <repo>/recordings); persona inputs still come from there
}) {
  const log = o.log ?? console.log;
  // A game nobody played has no limits of its own: the persona borrows them from the kid's fastest game (built
  // from their other games, as always), and the reflexes come from reflexFor().
  const persona = o.persona ?? await buildPersonaFile(ROOT, letter, o.limitsGame ?? 'factor-slicer');
  await writePersonaFile(o.outDir ? resolve(o.outDir) : ROOT, persona);
  const compiled = compile(persona);
  const rules = rulesText(compiled, persona.letter, persona.age, persona.who);
  const rx = await reflexFor(persona);
  const r = rng(o.seed ?? 7);

  const id = newSessionId([persona.letter, o.game, 'action']);
  const dir = join(o.outDir ? resolve(o.outDir) : ROOT, id);
  await mkdir(join(dir, 'shots'), { recursive: true });
  await writeFile(join(dir, 'session.json'), JSON.stringify({ id, kid: persona.letter, game: o.game, round: 'agent', mode: 'action' }, null, 2));
  await writeFile(join(dir, 'persona.json'), JSON.stringify({ persona, compiled, rules, reflex: rx }, null, 2));
  log(`${id}: Player ${persona.letter}, reaction ${rx.reactionMs} ms ± ${rx.timingSdMs}, misses ${Math.round(rx.missRate * 100)}% of moves, looks every ${o.lookMs} ms`);

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
  const t0 = Date.now();
  await page.clock.install({ time: t0 });
  await page.goto(o.url);
  await page.clock.pauseAt(t0 + 1500);
  let gameMs = 1500;
  const held = new Map<string, number>();   // key -> game ms at which to let go
  // Film mode: every 1/30 s of game time becomes a frame (canvas frames are fresh under the frozen clock, checked
  // 20 of 20), and a badge shows the key the persona pressed so a viewer can see its moves.
  const FRAME_MS = 1000 / 30;
  let frame = 0, frameDebt = 0;
  const framesDir = join(dir, 'frames');
  if (o.film) {
    await mkdir(framesDir, { recursive: true });
    // Debug readouts the harness needs for --state but the footage shouldn't show (Timberline: #dbg).
    if (o.hide) await page.addStyleTag({ content: `${o.hide} { visibility: hidden !important; }` });
    await page.evaluate(names => {
      const b = document.createElement('div');
      b.style.cssText = 'position:fixed;right:18px;top:18px;z-index:99999;padding:8px 14px;border-radius:10px;font:700 22px system-ui;color:#111;background:#fde68a;opacity:0;transition:none;pointer-events:none';
      document.body.appendChild(b);
      let until = 0;
      const show = (txt: string) => { b.textContent = txt; b.style.opacity = '1'; until = performance.now() + 350; };
      addEventListener('keydown', e => show(names[e.code] ?? e.key), true);
      addEventListener('pointerdown', () => show('TAP'), true);
      const tick = () => { if (performance.now() > until) b.style.opacity = '0'; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }, o.keyNames ?? {});
  }
  async function advance(ms: number) {
    if (!o.film) { await page.clock.runFor(Math.round(ms)); return; }
    frameDebt += ms;
    while (frameDebt >= FRAME_MS) {
      await page.clock.runFor(Math.round(FRAME_MS));
      frameDebt -= FRAME_MS;
      await page.screenshot({ path: join(framesDir, `${String(frame++).padStart(6, '0')}.jpg`), type: 'jpeg', quality: 88 });
    }
  }
  const steps: unknown[] = [];

  // Move the clock to `untilMs`, letting go of held keys on time along the way.
  async function runTo(untilMs: number) {
    for (;;) {
      const next = [...held.entries()].filter(([, t]) => t <= untilMs).sort((a, b) => a[1] - b[1])[0];
      if (!next) break;
      if (next[1] > gameMs) { await advance(next[1] - gameMs); gameMs = next[1]; }
      await page.keyboard.up(next[0]); held.delete(next[0]);
    }
    if (untilMs > gameMs) { await advance(untilMs - gameMs); gameMs = untilMs; }
  }

  try {
    for (let n = 1; n <= o.looks; n++) {
      // Filming, the latest frame is current and real time must not leak into the game; otherwise refresh first.
      const shot = o.film ? await page.screenshot({ type: 'jpeg', quality: 60 }) : await freshShot(page);
      if (!o.film) gameMs += 80;
      await writeFile(join(dir, 'shots', `${String(n).padStart(3, '0')}.jpg`), shot);
      const btns = await buttons(page);
      const state = o.state ? await page.evaluate(o.state).catch(() => null) : null;

      const prompt = [
        rules, '',
        `The game is moving. This picture is right now, and you have about ${(o.lookMs / 1000).toFixed(1)} seconds until you look again.`,
        `CONTROLS: ${o.controls}`, `KEYS YOU CAN USE: ${o.keys.join(', ')}`,
        'BUTTONS ON SCREEN (tap by number):', ...btns.map((b, i) => `[${i}] ${b.text || '(no label)'}`),
        `Plan what you will do in that time: up to 3 moves, each with at_ms (milliseconds from now). press = tap a key; hold = keep a key down for for_ms; tap = tap a button by number. No moves is fine if nothing needs doing. You are a child, not a perfect player: plan what this kid would try. label: how you feel. say: what you'd say out loud (empty if nothing). why: one short sentence.`,
      ].join('\n');
      type Plan = { moves: Move[]; label: string; say: string; why: string; would_quit: boolean };
      let plan: Plan;
      try {
        plan = (await o.client.respond<Plan>({ model: 'muse-spark-1.2', kind: `action:${persona.letter}:${o.game}`, schema: PLAN_SCHEMA, maxOutputTokens: 8000,
          content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: `data:image/jpeg;base64,${shot.toString('base64')}` }] })).data;
      } catch (e) {
        plan = { moves: [], label: 'none', say: '', why: `no usable answer: ${(e as Error).message.slice(0, 80)}`, would_quit: false };
      }
      const moves = (plan.moves ?? []).filter(m => (m.kind === 'tap' ? m.button >= 0 && m.button < btns.length : o.keys.includes(m.key))).slice(0, 3);
      const timed = schedule(moves, rx, r).map(m => ({ ...m, target: m.kind === 'tap' ? btns[m.button]?.text ?? '' : m.key }));
      const start = gameMs;
      for (const m of timed) {
        if (m.skipped || m.fire_ms == null || m.fire_ms > o.lookMs) continue;   // past the next look: the kid hasn't got there yet
        await runTo(start + m.fire_ms);
        if (m.kind === 'tap') { const b = btns[m.button]; await page.mouse.click(b.x, b.y); }
        else if (m.kind === 'press') { await page.keyboard.down(m.key); held.set(m.key, gameMs + 80); }
        else { await page.keyboard.down(m.key); held.set(m.key, gameMs + Math.max(80, m.for_ms)); }
      }
      await runTo(start + o.lookMs);
      const label = (LABELS as readonly string[]).includes(plan.label) ? plan.label : 'none';
      const step = { n, t: Math.round(start) / 1000, label, say: plan.say, why: plan.why, would_quit: plan.would_quit, planned: moves, timed, state };
      steps.push(step);
      const did = timed.map(m => `${m.kind} ${m.kind === 'tap' ? btns[m.button]?.text : m.key}@${m.at_ms}${m.skipped ? ' (froze)' : `→${m.fire_ms}`}`).join(', ') || 'nothing';
      log(`${String(n).padStart(2)} ${step.t.toFixed(1).padStart(6)}s ${label.padEnd(10)} ${did} | ${plan.say || plan.why}`.slice(0, 170) + (state ? `  [${JSON.stringify(state).slice(0, 80)}]` : ''));
      await writeFile(join(dir, 'steps.jsonl'), steps.map(s => JSON.stringify(s)).join('\n') + '\n');
      if (state && typeof state === 'object' && (state as { over?: unknown }).over) { log('game over'); break; }
    }
  } finally {
    await browser.close();
  }
  if (o.film && frame) {
    execFileSync(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', join(framesDir, '%06d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', join(dir, 'film.mp4')]);
    await rm(framesDir, { recursive: true, force: true });
    log(`film: ${join(dir, 'film.mp4')} (${(frame / 30).toFixed(1)} s)`);
  }
  const all = steps as { label: string; timed: { skipped: boolean }[]; state: unknown }[];
  const labels: Record<string, number> = {};
  for (const st of all) labels[st.label] = (labels[st.label] ?? 0) + 1;
  await writeFile(join(dir, 'summary.json'), JSON.stringify({ steps: all.length, game_s: Math.round(gameMs) / 1000, moves: all.flatMap(x => x.timed).length,
    froze: all.flatMap(x => x.timed).filter(m => m.skipped).length, labels, last_state: all.at(-1)?.state ?? null }, null, 2));
  return { id, steps, dir };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const args = process.argv.slice(2);
  const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const description = opt('describe', '');
  const letter = description ? opt('name', 'X').toUpperCase() : args.find(a => /^[A-Za-z]$/.test(a));
  const url = opt('url', '');
  if (!letter || !url) { console.error('usage: node src/agent/action.ts <letter> | --describe "<a kid>" --url <game> --keys "Space,ArrowDown" --controls "<how to play>" [--game name] [--state "<js>"] [--looks 40] [--look-ms 1200] [--film] [--hide "#dbg"] [--key-names "Space=JUMP,ArrowDown=GRAZE"] [--out <dir>] --live'); process.exit(1); }
  const live = args.includes('--live');
  const client = live ? clientFromEnv(REPO) : createMetaClient({ live: false, budgetUsd: 0, spendLog: join(ROOT, 'spend.jsonl') });
  const game = opt('game', 'action-game');
  const limitsGame = opt('limits-game', 'factor-slicer');
  const personaFile = opt('persona-file', '');
  const blendFile = opt('blend', '');
  const persona = description ? await describePersona(ROOT, letter, description, limitsGame, client)
    : blendFile ? await blendPersona(ROOT, JSON.parse(await readFile(blendFile, 'utf8')), Number(opt('seed', '7')), letter, game, limitsGame)
    : personaFile ? await loadPersonaFile(personaFile, letter, game, limitsGame) : undefined;
  if (persona?.blend) console.log(`blend ${persona.blend.name}: this run plays as member ${persona.blend.index} of ${persona.blend.of} (${persona.blend.member})`);
  const out = await playAction(letter, { url, game, persona, client, keys: opt('keys', 'Space').split(',').map(s => s.trim()), controls: opt('controls', ''),
    looks: Number(opt('looks', '40')), lookMs: Number(opt('look-ms', '1200')), state: opt('state', '') || undefined, seed: Number(opt('seed', '7')), limitsGame,
    outDir: opt('out', '') || undefined, film: args.includes('--film'), hide: opt('hide', '') || undefined, keyNames: Object.fromEntries(opt('key-names', '').split(',').filter(Boolean).map(kv => kv.split('=') as [string, string])) });
  console.log(`steps: ${join(out.dir, 'steps.jsonl')}`);
}
