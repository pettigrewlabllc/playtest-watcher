// Live persona play in real time: the same idea as play.ts (Muse plays as one kid, the harness enforces the
// kid's limits), for a game that keeps moving. A tap game can wait a whole first-tap delay per move; a runner
// can't, so the clock is cut into short slices instead:
//   - the page clock is frozen while Muse looks and decides, then runs one slice (default 350 ms of game time);
//   - Muse says what to do now (jump, hold Graze for N ms, push, ease) and keeps a plan for the things on screen
//     ("when a log comes, jump"); the game adapter carries the plan out on the frame, with the kid's reaction time,
//     timing spread and slip rate (src/persona/realtime.ts says which of those are measured and which assumed);
//   - Muse is asked again only when something new is on screen, something happened, or a recheck interval has
//     passed, so a run costs tens of calls, not one per slice; between calls the plan runs on its own;
//   - menus (the start and end cards) are played like play.ts: first-tap delay, reading, a missed tap.
// The game's own events go to the watcher through playtest-log.js, so a run is an ordinary session (round "agent").
//
//   PW_LIVE=1 npm run play:rt -- <letter> --url http://localhost:3073/index.html [--seed 3] [--runs 2] [--minutes 8] --live
import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { clientFromEnv, createMetaClient, type MetaClient } from '../meta/client.ts';
import { writePersonaFile } from '../persona/build.ts';
import { buildRealtimePersona, type RealtimePersona } from '../persona/realtime.ts';
import { compile, rulesText } from '../persona/compile.ts';
import { LABELS } from '../watch/explain.ts';
import { rng, jitter, missTarget } from './play.ts';

const REPO = resolve(import.meta.dirname, '..', '..');
const ROOT = join(REPO, 'recordings');
const NEGATIVE = new Set(['confused', 'stuck', 'bored', 'frustrated']);

// The plan vocabulary. `when` is what the adapter names on screen; `do` is what the hands do about it.
export const THINGS = ['log', 'rock', 'gap', 'car', 'creek', 'snow', 'branch', 'ring', 'people', 'bull', 'food', 'bear', 'warning', 'cow', 'storm'] as const;
export const ACTS = ['jump', 'duck', 'walk', 'wait', 'push', 'eat', 'dont_eat', 'ignore'] as const;
export const NOW = ['none', 'jump', 'hold_graze', 'push', 'ease'] as const;

const RT_SCHEMA = {
  name: 'rt_step',
  schema: {
    type: 'object', additionalProperties: false,
    required: ['action', 'button', 'now', 'hold_ms', 'plan', 'label', 'why', 'would_quit', 'say'],
    properties: {
      action: { type: 'string', enum: ['play', 'tap', 'quit'] },
      button: { type: 'integer' },
      now: { type: 'string', enum: [...NOW] },
      hold_ms: { type: 'integer' },
      plan: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['when', 'do'],
        properties: { when: { type: 'string', enum: [...THINGS] }, do: { type: 'string', enum: [...ACTS] } } } },
      label: { type: 'string', enum: [...LABELS] },
      why: { type: 'string' }, would_quit: { type: 'boolean' }, say: { type: 'string' },
    },
  },
};

// What a slip means to the kid, for "what happened since you last looked".
const HAPPENED: Record<string, string> = {
  fell: 'you fell into a gap and had to climb out', bump: 'you ran into something and stopped', bough: 'a branch caught your antlers and stopped you',
  zap: 'lightning hit you', splash: 'you splashed through a creek', spook: 'the people scattered when you ran at them', clash: 'the other bull knocked you back',
  heels: 'the storm caught up with you and threw you forward', bear: 'a bear charged at you', lion: 'a mountain lion jumped out at you', join: 'an elk cow joined your herd',
  strike: 'lightning hit the tree, and you were clear of it', passRival: 'you got past the other bull', lionMiss: 'something jumped out behind you and missed',
  postcard: 'you got a postcard', leaf: 'you caught a falling leaf', home: 'you made it home', storm: 'the storm caught you, the run is over',
};

// Everything a careful player would do: the reference for what a kid's hands alone cost them.
export const HANDS_ONLY_PLAN = [
  ...['log', 'rock', 'gap', 'car', 'creek', 'snow', 'bull'].map(when => ({ when, do: 'jump' })),
  { when: 'branch', do: 'duck' }, { when: 'people', do: 'walk' }, { when: 'ring', do: 'wait' }, { when: 'food', do: 'eat' },
  { when: 'bear', do: 'dont_eat' }, { when: 'warning', do: 'dont_eat' }, { when: 'storm', do: 'push' },
];

export type RtStep = {
  n: number; t: number; kind: 'menu' | 'play'; scene: string; things: string[]; action: string; target: string; intended: string | null; missed: boolean;
  now: string; hold_ms: number; plan: { when: string; do: string }[]; label: string; forced: boolean; why: string; say: string; would_quit: boolean;
  happened: string[]; fails_in_row: number;
};
type Scene = { over: string | null; t: number; x: number; miles: number; energy: number; storm_s: number; herd: number; stretch: string; first_run: boolean; state: string;
  things: { id: string; label: string }[]; holding: string[] };
type Menu = { id: string; buttons: { i: number; text: string; x: number; y: number }[]; texts: string[] } | null;
type Answer = { action: string; button: number; now: string; hold_ms: number; plan: { when: string; do: string }[]; label: string; why: string; would_quit: boolean; say: string };

// One do per kind of thing, the first one given: Muse once answered with every action for every kind.
export function cleanPlan(plan: { when: string; do: string }[]): { when: string; do: string }[] {
  const seen = new Set<string>();
  return plan.filter(p => (THINGS as readonly string[]).includes(p.when) && (ACTS as readonly string[]).includes(p.do) && !seen.has(p.when) && (seen.add(p.when), true));
}

// When to spend a call: something new on screen, something happened, or it has been a while.
export function shouldAsk(o: { thingsNow: string[]; askedAbout: Set<string>; happened: number; sinceAskMs: number; recheckMs: number; first: boolean }): string | null {
  if (o.first) return 'run start';
  if (o.happened) return 'something happened';
  const fresh = o.thingsNow.filter(t => !o.askedAbout.has(t));
  if (fresh.length) return `new on screen: ${fresh.join(', ')}`;
  if (o.sinceAskMs >= o.recheckMs) return 'recheck';
  return null;
}

async function menuState(page: Page): Promise<Menu> {
  return page.evaluate(() => {
    const open = ['cardBack', 'end', 'start'].map(id => document.getElementById(id)).find(e => e && !e.classList.contains('hidden'));
    if (!open) return null;
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(e).visibility !== 'hidden'; };
    const buttons = [...open.querySelectorAll('button')].filter(vis).map((e, i) => {
      const r = e.getBoundingClientRect();
      return { i, text: (e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 60), x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    const texts = [...open.querySelectorAll('h1, p, li, .big')].filter(vis).map(e => (e as HTMLElement).innerText.trim().replace(/\s+/g, ' ')).filter(Boolean);
    return { id: open.id, buttons, texts };
  });
}

// Game text on the field: the stretch banner and the toast (the coach's cues are painted on the canvas, so they
// reach Muse only through the screenshot).
const fieldTexts = (page: Page) => page.evaluate(() =>
  ['banner', 'toast'].map(id => document.getElementById(id)).filter(e => e && Number(getComputedStyle(e).opacity) > 0.2)
    .map(e => (e as HTMLElement).innerText.trim().replace(/\s+/g, ' ')).filter(Boolean));

export async function playRealtime(letter: string, o: {
  game: string; url: string; watcher: string; client: MetaClient; seed?: number; runs?: number; minutes?: number; sliceMs?: number;
  recheckMs?: number; maxCalls?: number; course?: number; playedBefore?: boolean; fixedPlan?: { when: string; do: string }[]; log?: (l: string) => void;
}) {
  const log = o.log ?? console.log;
  const sliceMs = o.sliceMs ?? 350, recheckMs = o.recheckMs ?? 2500, maxCalls = o.maxCalls ?? 160, runsWanted = o.runs ?? 2, capMs = (o.minutes ?? 8) * 60000;
  const persona: RealtimePersona = await buildRealtimePersona(ROOT, letter, o.game);
  await writePersonaFile(ROOT, persona);
  const compiled = compile(persona), h = compiled.harness, kid = persona.realtime;
  const rules = rulesText(compiled, persona.letter, persona.age);
  const r = rng(o.seed ?? 7);

  const sres = await fetch(`${o.watcher}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kid: persona.letter, game: o.game, round: 'agent', device: 'agent' }) });
  const session = ((await sres.json()) as { id: string }).id;
  const dir = join(ROOT, session);
  await mkdir(join(dir, 'shots'), { recursive: true });
  await writeFile(join(dir, 'persona.json'), JSON.stringify({ persona, compiled, rules, realtime: kid }, null, 2));
  log(`session ${session}: Player ${persona.letter} (age ${persona.age}) on ${o.game}; reaction ${kid.rtMs} ms and spread ${kid.timingSdMs} ms (assumed, age norm), slips ${Math.round(kid.slipRate * 100)}% (measured on ${kid.nearest}), first tap ${h.firstTapS.toFixed(1)} s, reads ${Math.round(h.readShare * 100)}%`);

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  // Joel's iPad, sideways: the game waits for landscape on a touch screen.
  const page = await browser.newPage({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 });
  await page.addInitScript({ path: join(REPO, 'public', 'playtest-log.js') });
  await page.addInitScript({ path: join(REPO, 'public', 'adapters', `${o.game}.js`) });
  const t0 = Date.now();
  await page.clock.install({ time: t0 });
  const q = new URLSearchParams({ playtest: session, pw: o.watcher, ...(o.course ? { seed: String(o.course) } : {}), ...(o.playedBefore ? { pw_played: '1' } : {}) });
  await page.goto(`${o.url}${o.url.includes('?') ? '&' : '?'}${q}`);
  await page.clock.pauseAt(t0 + 1500);
  await page.evaluate(k => (window as any).PW_RT.setPlan([], k), { rtMs: kid.rtMs, timingSdMs: kid.timingSdMs, slipRate: kid.slipRate, seed: (o.seed ?? 7) * 31 + 1 });
  let gameMs = 1500;
  const run = async (ms: number) => { await page.clock.runFor(Math.round(ms)); gameMs += ms; };

  const steps: RtStep[] = [], actions: unknown[] = [];
  let plan: { when: string; do: string }[] = [], calls = 0, failsInRow = 0, badAnswers = 0, sourSteps = 0, lastMenu = '', sinceAsk = 0, firstSlice = true, quit = false;
  const askedAbout = new Set<string>(), decidedText = new Map<string, boolean>();
  let pending: string[] = [];
  let cut: Record<string, unknown> | null = null;
  let ended: { run: number; first_run: boolean; summary: Record<string, unknown>; slips: { type: string; stretch: string }[] }[] = [];

  async function ask(n: number, prompt: string): Promise<Answer> {
    // Hands only: a fixed, complete plan and no model, to see what the kid's timing alone does (costs nothing).
    if (o.fixedPlan) return { action: 'tap', button: 0, now: 'none', hold_ms: 0, plan: o.fixedPlan, label: 'none', why: 'hands-only run', would_quit: false, say: '' };
    // A fresh frame: with the clock frozen Chrome may not paint (play.ts), so let a moment of real time pass.
    await page.clock.resume(); await page.waitForTimeout(60);
    const nowMs = await page.evaluate(() => Date.now()); await page.clock.pauseAt(nowMs + 20); gameMs += 80;
    const shot = await page.screenshot({ type: 'jpeg', quality: 55 });
    await writeFile(join(dir, 'shots', `${String(n).padStart(3, '0')}.jpg`), shot);
    calls++;
    try {
      const d = (await o.client.respond<Answer>({
        model: 'muse-spark-1.2', kind: `play-rt:${persona.letter}:${o.game}`, schema: RT_SCHEMA, maxOutputTokens: 8000,
        content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: `data:image/jpeg;base64,${shot.toString('base64')}` }],
      })).data;
      badAnswers = 0;
      return d;
    } catch (e) {
      if (++badAnswers >= 3) throw new Error(`three bad answers in a row (${(e as Error).message.slice(0, 80)})`);
      return { action: 'play', button: 0, now: 'none', hold_ms: 0, plan, label: 'none', why: `no usable answer: ${(e as Error).message.slice(0, 80)}`, would_quit: false, say: '' };
    }
  }

  const head = () => [rules, '',
    'This game keeps moving while you play; it pauses only while you think. Your hands are a child\'s: they follow your plan a little late and not always exactly.',
    `Game time so far: ${Math.round(gameMs / 1000)} s. Runs finished: ${ended.length}.`,
    failsInRow >= h.sourAfterFails ? `Things have gone wrong ${failsInRow} times in a row. You are frustrated now.` : failsInRow ? `Things went wrong ${failsInRow} time${failsInRow === 1 ? '' : 's'} in a row.` : ''];

  try {
    for (let n = 1; gameMs < capMs && calls < maxCalls && !quit; ) {
      const menu = await menuState(page);
      if (menu) {
        if (ended.length >= runsWanted && menu.id === 'end') break;
        const key = menu.id + '|' + menu.buttons.map(b => b.text).join('|');
        await run(jitter(key !== lastMenu ? h.firstTapS : h.actionGapS, r) * 1000);
        lastMenu = key;
        for (const t of menu.texts) if (!decidedText.has(t)) decidedText.set(t, t.length < 25 || r() < h.readShare);
        const read = menu.texts.filter(t => decidedText.get(t)), skipped = menu.texts.filter(t => !decidedText.get(t));
        const prompt = [...head(),
          'A card is showing.', 'TEXT YOU READ:', ...read.map(t => `- ${t}`),
          'TEXT YOU DID NOT READ (first words only):', ...skipped.map(t => `- ${t.split(' ').slice(0, 4).join(' ')}...`),
          'BUTTONS (tap by number):', ...menu.buttons.map(b => `[${b.i}] ${b.text || '(no label)'}`), '',
          'Choose as this child: action "tap" with a button number, or "quit". Leave now as "none", hold_ms 0 and plan empty. label: how you feel. say: what you would say out loud (empty if nothing). why: one short sentence.',
        ].filter(Boolean).join('\n');
        const d = await ask(n, prompt);
        // hands only: press the card's go button (Start, Run it again), not whatever is first
        if (o.fixedPlan) d.button = Math.max(0, menu.buttons.findIndex(b => /^(start|run it again|ok|got it)/i.test(b.text)));
        let target = '', intended: string | null = null, missed = false;
        if (d.action === 'tap' && menu.buttons.length) {
          let i = Math.max(0, Math.min(menu.buttons.length - 1, d.button | 0));
          intended = menu.buttons[i].text;
          if (r() < h.errorRate) { i = missTarget(i, menu.buttons.length, r); missed = menu.buttons[i].text !== intended; }
          target = menu.buttons[i].text;
          await page.mouse.click(menu.buttons[i].x, menu.buttons[i].y);
        }
        sourSteps = failsInRow >= h.sourAfterFails ? sourSteps + 1 : 0;
        quit = d.action === 'quit' && sourSteps >= 2;
        const label = (LABELS as readonly string[]).includes(d.label) ? d.label : 'none', forced = failsInRow >= h.sourAfterFails && !NEGATIVE.has(label);
        steps.push({ n, t: gameMs / 1000, kind: 'menu', scene: menu.id, things: [], action: d.action === 'quit' && !quit ? 'wait' : d.action, target, intended: missed ? intended : null, missed,
          now: 'none', hold_ms: 0, plan, label: forced ? 'frustrated' : label, forced, why: d.why, say: d.say, would_quit: d.would_quit || d.action === 'quit', happened: [], fails_in_row: failsInRow });
        log(`${String(n).padStart(3)} ${(gameMs / 1000).toFixed(1).padStart(6)}s ${steps.at(-1)!.label.padEnd(10)} [${menu.id}] tap ${target}${missed ? ` (meant ${intended})` : ''} | ${d.say || d.why}`.slice(0, 170));
        n++;
        await run(400);
        if (menu.id === 'start' || menu.id === 'end') firstSlice = true;
        continue;
      }

      const sc = await page.evaluate(() => (window as any).PW_RT.scene()) as Scene | null;
      // drain what the hands did and what happened in the last slice
      const did = await page.evaluate(() => (window as any).PW_RT.takeLog()) as { type: string; event?: string }[];
      actions.push(...did);
      for (const a of did) if (a.type === 'event' && a.event) {
        // a caught leaf is too small to stop and think about; it doesn't count as something happening
        if (HAPPENED[a.event] && a.event !== 'leaf') pending.push(HAPPENED[a.event]);
        if (['fell', 'bump', 'bough', 'zap', 'lion', 'splash', 'spook', 'clash', 'heels', 'bear'].includes(a.event)) failsInRow++;
        else if (['clean', 'strike', 'passRival', 'lionMiss', 'postcard', 'home'].includes(a.event)) failsInRow = 0;
      }
      ended = await page.evaluate(() => (window as any).PW_RT.ended);
      if (!sc || sc.over) { await run(sliceMs); continue; }

      const thingsNow = [...new Set(sc.things.map(t => t.id))];
      const why = shouldAsk({ thingsNow, askedAbout, happened: pending.length, sinceAskMs: sinceAsk, recheckMs, first: firstSlice });
      if (why) {
        const texts = await fieldTexts(page);
        for (const t of texts) if (!decidedText.has(t)) decidedText.set(t, t.length < 25 || r() < h.readShare);
        const prompt = [...head(),
          'You are running. Your controls: the JUMP button, the GRAZE button (hold it down), and dragging across the field (right to speed up, left to slow down).',
          pending.length ? `SINCE YOUR LAST LOOK: ${pending.join('; ')}.` : '',
          `ON SCREEN: energy ${sc.energy}%, the storm is ${sc.storm_s} s behind you, herd ${sc.herd}, you are ${sc.state}${sc.holding.length ? `, holding ${sc.holding.join(' and ')}` : ''}.`,
          'THINGS YOU CAN SEE AHEAD (named by type in brackets):', ...(sc.things.length ? sc.things.map(t => `- ${t.label}`) : ['- nothing in the way']),
          'GAME TEXT YOU READ:', ...texts.filter(t => decidedText.get(t)).map(t => `- ${t}`),
          ...(texts.some(t => !decidedText.get(t)) ? ['GAME TEXT YOU DID NOT READ:', ...texts.filter(t => !decidedText.get(t)).map(t => `- ${t.split(' ').slice(0, 3).join(' ')}...`)] : []),
          `YOUR PLAN SO FAR: ${plan.length ? plan.map(p => `${p.when}: ${p.do}`).join(', ') : '(none yet)'}`, '',
          'Decide as this child. action "play". now: what you do this instant (none, jump, hold_graze for hold_ms, push or ease for hold_ms). plan: your whole plan for the kinds of things you have seen, one when/do pair per kind '
          + '(jump, duck, walk, wait, push, eat, dont_eat, ignore); a kind you leave out you do nothing about. Only plan for kinds you have seen or been told about. '
          + 'label: how you feel right now. say: what you would say out loud (empty if nothing). why: one short sentence. action "quit" only if you would put the iPad down.',
        ].filter(Boolean).join('\n');
        const d = await ask(n, prompt);
        thingsNow.forEach(t => askedAbout.add(t));
        // an empty plan mid-run was Muse forgetting it (C, "I was in the air so I did nothing"), not a choice; keep the old one
        const next = Array.isArray(d.plan) ? cleanPlan(d.plan) : [];
        if (next.length || !plan.length) plan = next;
        await page.evaluate(p => (window as any).PW_RT.setPlan(p), plan);
        // a decision made now lands after the kid's reaction time
        if (d.now !== 'none' && (NOW as readonly string[]).includes(d.now)) {
          await run(kid.rtMs * Math.exp((r() + r() + r() - 1.5) * 0.25));
          const ms = Math.max(150, Math.min(4000, d.hold_ms || 600));
          await page.evaluate(([w, m]) => (window as any).PW_RT.now(w, m), [d.now === 'hold_graze' ? 'graze' : d.now, ms] as const);
        }
        sourSteps = failsInRow >= h.sourAfterFails ? sourSteps + 1 : 0;
        quit = d.action === 'quit' && sourSteps >= 2;
        const label = (LABELS as readonly string[]).includes(d.label) ? d.label : 'none', forced = failsInRow >= h.sourAfterFails && !NEGATIVE.has(label);
        steps.push({ n, t: +(gameMs / 1000).toFixed(2), kind: 'play', scene: `${sc.stretch} mile ${sc.miles}, energy ${sc.energy}, storm ${sc.storm_s} s, herd ${sc.herd}`, things: sc.things.map(t => t.label),
          action: d.action === 'quit' && !quit ? 'play' : d.action, target: '', intended: null, missed: false, now: d.now, hold_ms: d.hold_ms, plan, label: forced ? 'frustrated' : label, forced,
          why: d.why, say: d.say, would_quit: d.would_quit || d.action === 'quit', happened: pending, fails_in_row: failsInRow });
        log(`${String(n).padStart(3)} ${(gameMs / 1000).toFixed(1).padStart(6)}s ${steps.at(-1)!.label.padEnd(10)} m${sc.miles} e${sc.energy} s${sc.storm_s} (${why}) now:${d.now} plan:${plan.map(p => `${p.when}=${p.do}`).join(',')} | ${d.say || d.why}`.slice(0, 220));
        await writeFile(join(dir, 'steps.jsonl'), steps.map(s => JSON.stringify(s)).join('\n') + '\n');
        pending = []; sinceAsk = 0; firstSlice = false; n++;
      }
      await run(sliceMs); sinceAsk += sliceMs;
    }
    await run(1500);   // let the logger flush
    ended = await page.evaluate(() => (window as any).PW_RT.ended);
    actions.push(...await page.evaluate(() => (window as any).PW_RT.takeLog()));
    // a run cut off by the call or time cap: where it had got to
    cut = await page.evaluate(() => { const P = (window as any).PW_RT; return P.g && !P.g.over ? { run: P.runs, ...P.scene(), things: undefined } : null; });
  } finally {
    await writeFile(join(dir, 'steps.jsonl'), steps.map(s => JSON.stringify(s)).join('\n') + '\n');
    await writeFile(join(dir, 'actions.jsonl'), actions.map(a => JSON.stringify(a)).join('\n') + '\n');
    await browser.close();
  }
  return { session, steps, actions, ended, cut, persona, calls, gameS: gameMs / 1000 };
}

export function summarizeRt(out: { steps: RtStep[]; actions: any[]; ended: any[]; cut?: Record<string, unknown> | null; calls: number; gameS: number }) {
  const labels: Record<string, number> = {};
  for (const s of out.steps) labels[s.label] = (labels[s.label] ?? 0) + 1;
  const presses = out.actions.filter(a => a.type === 'press');
  return {
    calls: out.calls, game_s: Math.round(out.gameS), labels,
    runs: out.ended.map(e => ({ run: e.run, first_run: e.first_run, over: e.summary.over, miles: e.summary.miles, t: e.summary.t, herd: e.summary.herd, stretch: e.summary.stretch,
      slips: e.slips.reduce((m: Record<string, number>, s: any) => ((m[s.type] = (m[s.type] ?? 0) + 1), m), {}) })),
    cut_off: out.cut ?? null,
    presses: presses.length, late_presses: presses.filter(p => p.late_ms > 0).length, slips_drawn: out.actions.filter(a => a.type === 'slip').length,
    negative: out.steps.filter(s => NEGATIVE.has(s.label)).map(s => ({ n: s.n, t: s.t, label: s.label, scene: s.scene, say: s.say, why: s.why })),
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const args = process.argv.slice(2);
  const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const letter = args.find(a => /^[A-Za-z]$/.test(a));
  if (!letter) { console.error('usage: npm run play:rt -- <letter> --url <game url> [--game timberline-trek] [--course 3] [--runs 2] [--minutes 8] [--slice 350] [--recheck 2500] [--max-calls 160] [--seed 7] [--watcher http://localhost:3058] --live'); process.exit(1); }
  const live = args.includes('--live');
  const client = live ? clientFromEnv(REPO) : createMetaClient({ live: false, budgetUsd: 0, spendLog: join(ROOT, 'spend.jsonl') });
  if (live && !client.live) console.warn('--live given but PW_LIVE=1 and MODEL_API_KEY are not both set; fake mode');
  const out = await playRealtime(letter, {
    game: opt('game', 'timberline-trek'), url: opt('url', 'http://localhost:3073/index.html'), watcher: opt('watcher', 'http://localhost:3058'), client,
    seed: Number(opt('seed', '7')), course: Number(opt('course', '0')) || undefined, runs: Number(opt('runs', '2')), minutes: Number(opt('minutes', '8')),
    sliceMs: Number(opt('slice', '350')), recheckMs: Number(opt('recheck', '2500')), maxCalls: Number(opt('max-calls', '160')),
    fixedPlan: args.includes('--hands-only') ? HANDS_ONLY_PLAN : undefined, playedBefore: args.includes('--played-before'),
  });
  const sum = summarizeRt(out);
  await writeFile(join(ROOT, out.session, 'summary.json'), JSON.stringify(sum, null, 2));
  console.log(JSON.stringify(sum, null, 1));
}
