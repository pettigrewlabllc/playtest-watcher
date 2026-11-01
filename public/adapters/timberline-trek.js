// Playtest Watcher adapter for Timberline Trek: the game's own events into the logger, what a kid could see on
// screen as short named things, and the real-time player's hands (src/agent/realtime.ts).
//
// The game needs no changes. The harness injects playtest-log.js and this file before the page loads; this file
// catches tt-core's `TT` as it is defined and wraps TT.step, so every frame passes through here. A game that wants
// the logging without the harness can load it with one tag after tt-core.js:
//   <script src="playtest-log.js"></script><script src="tt-core.js"></script><script src="timberline-trek.js"></script>
//
// Hands: the harness hands over a plan ("when a log comes, jump") and the kid's timing (reaction time, timing
// spread, slip rate); the moment to act on each thing is worked out here, on the frame, and pressed as the game's
// own keys (Space jumps, ArrowDown held is Graze, ArrowRight/Left held push or ease). Nothing in here reads the
// course ahead beyond what is on screen.
(() => {
  const P = window.PW_RT = {
    g: null, TT: null, plan: [], kid: { rtMs: 400, timingSdMs: 70, slipRate: 0.1, seed: 1 },
    log: [], ended: [], keys: {}, queue: [], seen: new WeakMap(), plans: new WeakMap(), runs: 0,
  };
  const PL = () => window.PlaytestLog;

  // Seeded noise, so a run repeats for a seed.
  let s = 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return u - 3; };   // sd ~0.7, close enough to a bell

  const SLIPS = ['fell', 'bump', 'bough', 'zap', 'lion', 'splash', 'spook', 'clash', 'heels', 'bear'];
  const CLEAN = ['strike', 'passRival', 'lionMiss', 'streak', 'postcard', 'goldStamp', 'saved'];

  // ---- keys: the game listens on window for keydown/keyup and reads e.code
  const KEY = { jump: 'Space', graze: 'ArrowDown', push: 'ArrowRight', ease: 'ArrowLeft' };
  function key(code, down) {
    dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code === 'Space' ? ' ' : code, bubbles: true }));
  }
  function hold(name, on, why) {
    if (!!P.keys[name] === on) return;
    P.keys[name] = on; key(KEY[name], on);
    note(on ? 'hold' : 'release', { control: name, why });
  }
  function press(why, late) {
    key(KEY.jump, true); key(KEY.jump, false);
    note('press', { control: 'jump', why, late_ms: Math.round(late * 1000) });
    PL()?.log('press', { kind: 'attempt', control: 'jump', why });
  }
  function note(type, data) { if (P.g) P.log.push(Object.assign({ type, t: +P.g.t.toFixed(3), x: +P.g.x.toFixed(1) }, data)); }

  // ---- what is on screen: things ahead, named the way a kid would point at them
  const view = g => {
    const W = innerWidth, H = innerHeight, S = Math.max(7, Math.min(16, H / 34, W / 80)), EX = 0.32 + 0.14 * g.pace;
    return { ahead: (W * (1 - EX)) / S, behind: (W * EX) / S };
  };
  const ITEM = { log: 'log', rock: 'rock', ravine: 'gap', car: 'car' };
  const NAME = {
    log: 'a fallen log across the trail', rock: 'a rock on the trail', gap: 'a gap in the ground', car: 'a parked car on the road',
    creek: 'a creek across the trail', snow: 'a snow drift', branch: 'a low branch over the trail', ring: 'a lone tree with a ring on the ground around it',
    people: 'people standing on the road', bull: 'another bull elk', food: 'food', bear: 'a bear in the berry bushes', warning: 'an animal popped up and called out',
    cow: 'an elk cow waiting by the trail',
  };
  function things(g) {
    const T = P.TT.T, v = view(g), out = [];
    const add = (type, o, x, w, extra) => {
      if (x + w < g.x - 0.5 || x - g.x > v.ahead) return;
      if (!P.seen.has(o)) P.seen.set(o, g.t);
      out.push(Object.assign({ type, o, x, w, d: x - g.x, s: +((x - g.x) / T.run).toFixed(1) }, extra || {}));
    };
    const c = g.course;
    for (const it of c.items) if (!it.slipped || it.kind === 'ravine') add(ITEM[it.kind] || 'log', it, it.x, it.w);
    if (!g.SE.frozen) for (const k of c.creeks) add('creek', k, k.x, k.w);
    for (const d of c.drifts) add('snow', d, d.x, d.w);
    for (const b of c.branches) if (!b.hit) add('branch', b, b.x, b.w);
    for (const b of c.bolts) if (!b.struck) add('ring', b, b.x - b.r, 2 * b.r, b.at !== null ? { glowing: +(b.at - g.t).toFixed(1) } : {});
    for (const k of c.crowds) if (!k.calm && !k.spooked) add('people', k, k.x, k.w);
    for (const r of c.rivals) if (!r.done) add('bull', r, r.x, r.w, r.trot ? { trotting: true } : {});
    for (const p of c.plants) if (p.left > 0) add('food', p, p.x, p.w, { food: p.food });
    for (const b of c.bears) if (!b.used) add('bear', b, b.x, b.w);
    for (const k of c.cows) if (!k.joined) add('cow', k, k.x, 1);
    // the warning stays in mind for a stretch of trail after the animal calls (what it warns of is past it)
    for (const o of c.lookouts) if (o.seen && g.x < o.x + 30) add('warning', o, o.x, 30, { animal: o.kind });
    return out.sort((a, b) => a.x - b.x);
  }
  P.scene = () => {
    const g = P.g;
    if (!g) return null;
    const T = P.TT.T;
    const list = g.over ? [] : things(g).map(t => {
      let name = NAME[t.type];
      if (t.type === 'food') name = `food (${t.food})`;
      if (t.type === 'ring' && t.glowing != null) name = 'a ring glowing on the ground around a lone tree';
      if (t.type === 'bull' && t.trotting) name = 'another bull elk, coming at you';
      if (t.type === 'warning') name = `a ${t.animal} popped up and called out`;
      const where = t.type === 'warning' && t.d <= 0 ? 'just now' : t.d <= 0 ? 'right here' : `${t.s} s ahead`;
      return { id: t.type, label: `[${t.type}] ${name}, ${where}` };
    });
    return {
      over: g.over || null, t: +g.t.toFixed(2), x: +g.x.toFixed(1), miles: +((g.x / P.TT.COURSE) * 20).toFixed(1),
      energy: Math.round(g.energy), storm_s: +((g.x - g.storm) / T.run).toFixed(1), herd: g.herd,
      stretch: P.TT.stretchAt(g.x, g.season).id, first_run: !!g.firstRun,
      state: g.stumble > 0 ? 'stumbling' : g.air ? 'in the air' : g.grazing ? 'head down (grazing)' : g.wading ? 'wading' : 'running',
      things: list, holding: Object.keys(P.keys).filter(k => P.keys[k]),
    };
  };

  // ---- the plan: { when: <thing type>, do: <jump|duck|walk|wait|push|eat|dont_eat|ignore> }
  const ACTS = ['jump', 'duck', 'walk', 'wait', 'push', 'eat', 'dont_eat', 'ignore'];
  P.setPlan = (plan, kid) => {
    P.plan = (plan || []).filter(p => p && ACTS.includes(p.do));
    if (kid) { P.kid = Object.assign(P.kid, kid); if (kid.seed != null) s = kid.seed >>> 0 || 1; }
  };
  P.planFor = type => { const p = P.plan.find(e => e.when === type); return p ? p.do : null; };
  P.takeLog = () => { const l = P.log; P.log = []; return l; };

  // Per thing, drawn once when the kid first sees it: how late (or early) the hands are and whether they fumble.
  // Reaction time holds the earliest moment back from when it came into view (a glowing ring: from when it lit).
  function timing(g, t) {
    let m = P.plans.get(t.o);
    if (m) return m;
    const k = P.kid, slip = rnd() < k.slipRate;
    const rt = (k.rtMs / 1000) * Math.exp(gauss() * 0.25);
    const off = gauss() * (k.timingSdMs / 1000) / 0.7 * (slip ? 4 : 1);
    m = { rt, off, slip, skip: slip && rnd() < 0.5, from: P.seen.get(t.o) ?? g.t, done: false, held: false };
    P.plans.set(t.o, m);
    if (slip) note('slip', { thing: t.type, skip: m.skip, off_ms: Math.round(off * 1000) });
    return m;
  }

  function act(g) {
    const T = P.TT.T, sp = g.speed || T.run, AIRT = 2 * T.jumpV / T.gravity, list = things(g);
    let graze = null, push = null;   // null: no opinion this frame
    let blockEat = false, wantEat = false;
    for (const t of list) {
      const what = P.planFor(t.type);
      if (!what || what === 'ignore') continue;
      const m = timing(g, t);
      if (m.skip) continue;
      // the ring starts counting from when it lights, not from when the tree came into view
      const from = t.type === 'ring' ? (t.o.at != null ? t.o.at - T.boltCharge : null) : m.from;
      const ready = from != null && g.t >= from + m.rt;
      if (what === 'jump' && !m.done) {
        const close = t.type === 'bull' ? sp + (t.o.trot ? T.rivalSpeed : 0) : sp;
        const ideal = Math.max(0.5, (AIRT * close - t.w) / 2);
        // offset > 0 is late: wait until the thing is that much closer
        if (t.d <= ideal - m.off * close && t.d > -t.w) {
          // late: how long the press waited on the kid's reaction time after the moment the plan wanted it
          if (m.wanted == null) m.wanted = g.t;
          // in the air or stumbling the game ignores a press; a kid presses when they land, a little late
          if (ready && !g.air && g.stumble <= 0) { m.done = true; press(t.type, g.t - m.wanted); }
        } else if (t.d <= -t.w) m.done = true;
      } else if (what === 'duck' || what === 'walk' || what === 'wait') {
        // hold Graze from just before it until clear of it; a glowing ring: hold until it strikes
        // a kid slows for people and ducks a branch well before it, not on the last frame the bot uses
        const lead = (t.type === 'people' ? 8 : 3) - m.off * sp;
        if (t.type === 'ring') {
          if (t.o.at != null && ready) {
            const px = g.x + sp * (t.o.at - g.t), mid = t.x + t.w / 2;
            if (Math.abs(px - mid) <= t.w / 2 + 1.5 || m.held) { graze = true; m.held = true; }
          }
        } else if (t.d <= lead && g.x <= t.x + t.w + 0.3 && ready) graze = true;
      } else if (what === 'push') {
        if (t.type === 'ring' ? t.o.at != null && ready : t.d <= 2 && ready) push = true;
      } else if (what === 'eat' && t.type === 'food') {
        if (t.d <= 0 && g.x <= t.x + t.w) wantEat = true;
      } else if (what === 'dont_eat') {
        if (t.d <= 0.5 && g.x <= t.x + t.w + 6) blockEat = true;
        if (t.type === 'warning' && ready && g.x >= t.x) blockEat = true;
      }
    }
    // Storm: a plan "when storm, push" leans on Push while it's close and there's energy for it.
    const st = P.planFor('storm'), gap = (g.x - g.storm) / T.run;
    if (st === 'push' && gap < 3 && g.energy > 20) push = true;
    // Eating: only standing on food, only when hungry, and not with something to jump right in front.
    if (wantEat && !blockEat && graze === null) {
      const soon = list.some(t => ['log', 'rock', 'gap', 'car', 'creek', 'snow', 'bull'].includes(t.type) && t.d > 0 && t.d < 4 && P.planFor(t.type) === 'jump');
      // a kid holds Graze until they feel full, not until the bar ticks over a line (that flickered every frame)
      const hungry = P.eating ? g.energy < 92 : g.energy < 75;
      if (!soon && hungry && !(st === 'push' && gap < 2)) graze = true;
    }
    P.eating = !!(graze && wantEat);
    hold('graze', !!graze, graze ? 'plan' : 'plan');
    hold('push', !!push, 'plan');
  }

  // Timed presses the harness asked for directly ("hold Graze for 800 ms"), in game seconds.
  P.now = (what, ms) => {
    const g = P.g; if (!g) return;
    if (what === 'jump') { press('now', 0); return; }
    if (KEY[what]) { P.queue.push({ at: g.t + (ms || 500) / 1000, what }); P.direct = P.direct || {}; P.direct[what] = true; hold(what, true, 'now'); }
  };

  function before(g) {
    for (const q of P.queue.splice(0)) { if (g.t >= q.at) { P.direct[q.what] = false; hold(q.what, false, 'now'); } else P.queue.push(q); }
    if (g.over || g.stumble > 0 && !P.keys.graze) return;
    const direct = P.direct || {};
    if (direct.graze || direct.push || direct.ease) return;   // the kid's own hold wins over the plan while it lasts
    act(g);
  }

  function after(g, n) {
    for (const e of g.events.slice(n)) {
      const kind = SLIPS.includes(e.type) ? 'fail' : CLEAN.includes(e.type) ? 'success' : 'progress';
      PL()?.log(`tt_${e.type}`, Object.assign({ kind, x: Math.round(e.x), stretch: P.TT.stretchAt(e.x, g.season).id }, e.lostCow != null ? { lostCow: e.lostCow } : {}));
      note('event', { event: e.type });
    }
    if (g.over && !g.loggedOver) {
      g.loggedOver = true;
      for (const k of Object.keys(P.keys)) hold(k, false, 'run over');
      const s = P.TT.summary(g);
      P.ended.push({ run: P.runs, first_run: !!g.firstRun, summary: s,
        slips: g.events.filter(e => SLIPS.includes(e.type)).map(e => ({ type: e.type, t: +e.t.toFixed(1), stretch: P.TT.stretchAt(e.x, g.season).id, lostCow: !!e.lostCow })) });
      PL()?.log('run_end', { kind: s.over === 'home' ? 'success' : 'fail', over: s.over, miles: s.miles, t: s.t, herd: s.herd, stretch: s.stretch });
    }
  }

  function wrap(TT) {
    if (TT.__pw) return;
    const step = TT.step;
    TT.step = function (g, dt, input) {
      if (P.g !== g) { P.g = g; P.TT = TT; P.runs++; P.plans = new WeakMap(); P.seen = new WeakMap(); P.queue = []; P.keys = {}; P.direct = {};
        PL()?.log('run_start', { kind: 'progress', run: P.runs, first_run: !!g.firstRun, season: g.season, variant: g.variant }); }
      before(g);
      const n = g.events.length, streak = g.streak, out = step.call(this, g, dt, input);
      // A clean pass (a log jumped, a branch ducked) only shows in the game as the streak going up; without it the
      // harness counted fails in a row across clean jumps and told the persona it had failed seven times running.
      if (g.streak > streak) { note('event', { event: 'clean' }); PL()?.log('tt_clean', { kind: 'success', streak: g.streak }); }
      after(g, n);
      return out;
    };
    TT.__pw = true;
  }
  // ?pw_played=1: a kid who has played before, so the run is a normal one (no coach, the real storm). The logger has
  // just cleared this origin's storage for the new session; this runs after it.
  if (new URLSearchParams(location.search).has('pw_played')) {
    try { localStorage.setItem('timberline-trek.progress', JSON.stringify({ cards: [], points: [], gold: [], runs: 1 })); } catch { /* storage blocked */ }
  }
  if (window.TT) wrap(window.TT);
  else {
    let v;
    Object.defineProperty(window, 'TT', { configurable: true, get: () => v, set: x => { v = x; wrap(x); } });
  }

  // Screens: the start card, the end card and the postcard back are the game's menus.
  addEventListener('DOMContentLoaded', () => {
    const watch = id => {
      const el = document.getElementById(id); if (!el) return;
      let shown = false;
      const check = () => { const on = !el.classList.contains('hidden'); if (on && !shown) PL()?.screen(id); shown = on; };
      new MutationObserver(check).observe(el, { attributes: true, attributeFilter: ['class'] }); check();
    };
    ['start', 'end', 'cardBack'].forEach(watch);
  });
})();
