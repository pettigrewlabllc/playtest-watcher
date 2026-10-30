// Playtest Watcher event logger. Copy this file into a game unchanged.
// Off unless the page URL has ?playtest=<sessionId>&pw=<watcher origin>. When off, every call is a no-op.
(() => {
  const params = new URLSearchParams(location.search);
  const session = params.get('playtest');
  const origin = params.get('pw');
  const enabled = !!(session && origin && /^[a-z0-9-]{1,80}$/.test(session));
  const IDLE_MS = 8000;

  // A playtest starts from the beginning: the first load of each session clears this game's saved progress
  // (everything in its origin's localStorage), so a kid never picks up where the last player stopped.
  // A reload in the same session keeps it.
  if (enabled) {
    try {
      if (localStorage.getItem('pw_fresh') !== session) { localStorage.clear(); localStorage.setItem('pw_fresh', session); }
    } catch { /* storage blocked: nothing saved to clear */ }
  }

  let queue = [];
  let lastInput = Date.now();
  let idleLogged = false;
  let awaitingFirstTouch = null;

  function log(type, data) {
    if (!enabled || typeof type !== 'string') return;
    queue.push(data === undefined ? { t: Date.now(), type } : { t: Date.now(), type, data });
  }

  function flush(keepalive) {
    if (!queue.length) return;
    const batch = queue;
    queue = [];
    fetch(`${origin}/events/${session}`, {
      method: 'POST', body: JSON.stringify(batch), keepalive: !!keepalive,
      headers: { 'content-type': 'application/json' },
    }).catch(() => { queue = batch.concat(queue); });
  }

  function describe(el) {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (n.dataset && n.dataset.pw) return n.dataset.pw;
    }
    if (!el || !el.tagName) return 'unknown';
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
  }

  if (enabled) {
    const onInput = e => {
      lastInput = Date.now();
      idleLogged = false;
      if (e.type === 'pointerdown' && awaitingFirstTouch) {
        log('first_touch', { kind: 'first_touch', screen: awaitingFirstTouch, target: describe(e.target) });
        awaitingFirstTouch = null;
      }
    };
    addEventListener('pointerdown', onInput, true);
    addEventListener('keydown', onInput, true);
    setInterval(() => {
      const quiet = Date.now() - lastInput;
      if (quiet >= IDLE_MS && !idleLogged) {
        log('idle', { kind: 'idle', seconds: Math.round(quiet / 1000) });
        idleLogged = true;
      }
      flush(false);
    }, 500);
    addEventListener('pagehide', () => { log('page_hide', { kind: 'quit' }); flush(true); });
    log('logger_start', { kind: 'progress', url: location.pathname, w: innerWidth, h: innerHeight });
  }

  window.PlaytestLog = {
    enabled,
    log,
    // A new screen appeared; the next tap is recorded as first_touch.
    screen(name) { log('screen', { kind: 'progress', name }); awaitingFirstTouch = name; },
    text(id, chars) { log('text_shown', { kind: 'text_shown', id, chars }); },
    textClosed(id) { log('text_closed', { kind: 'text_closed', id }); },
  };
})();
