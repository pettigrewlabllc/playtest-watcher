// What the harness can see and point at on a page: the clickable things (for play.ts's numbered buttons) and the
// aim grid drawn over a screenshot for --point.
import type { Page } from 'playwright';

// Semantic clickables: anything the page itself says can be clicked or focused.
export const CLICKABLE_SELECTOR = [
  'button', '[role=button]', 'a[href]', '[onclick]', '[tabindex]:not([tabindex="-1"])',
  'input[type=button]', 'input[type=submit]', 'label[for]', 'summary',
].join(', ');

export const MAX_CLICKABLES = 60;

// One clickable as the page reports it, in document order. `parent` is the index of the nearest clickable that
// contains it (null if none). `ownText` is the text inside it that is not inside a nested clickable; `label` is
// its aria-label, value or title. `semantic` is false for an element found only by its pointer cursor.
export type Candidate = {
  parent: number | null; ownText: string; text: string; label: string; semantic: boolean;
  x: number; y: number;
};
export type Clickable = { i: number; text: string; x: number; y: number };

// Nested clickables (a card with a handler wrapping a "Buy" button; a tabindex div wrapping a span with the word)
// are collapsed to the innermost one that has its own text. Why innermost: a tap on it lands on the exact thing
// its words name, and the click still bubbles to any outer handler, so nothing is lost. Tapping the centre of
// the outer one instead can land on a different child than the one the model meant. An outer clickable is kept
// as well only when it has words of its own outside its children (the card's title); an inner one with no text
// at all (a bare icon inside a labelled card) is dropped in favour of the labelled ancestor.
// Must stay self-contained: play.ts ships its source into the page.
export function pickClickables(cands: Candidate[], cap: number): Clickable[] {
  const has = (c: Candidate) => (c.ownText || c.label).trim().length > 0;
  const kids = cands.map(() => [] as number[]);
  cands.forEach((c, i) => { if (c.parent != null && c.parent >= 0 && c.parent < cands.length) kids[c.parent].push(i); });
  const anyTextBelow = (i: number): boolean => kids[i].some(k => has(cands[k]) || anyTextBelow(k));
  const anyTextAbove = (i: number): boolean => { for (let p = cands[i].parent; p != null; p = cands[p].parent) if (has(cands[p])) return true; return false; };
  const keep: number[] = [];
  cands.forEach((c, i) => {
    const nested = c.parent != null || kids[i].length > 0;
    if (!nested) { keep.push(i); return; }
    if (has(c)) { keep.push(i); return; }
    // no text of its own: keep only if nothing around it is labelled either (then it is the only way to tap there)
    if (!anyTextBelow(i) && !anyTextAbove(i) && kids[i].length === 0) keep.push(i);
  });
  // Over the cap, the page's own clickables come before ones found only by cursor; then back to document order.
  const chosen = [...keep.filter(i => cands[i].semantic), ...keep.filter(i => !cands[i].semantic)].slice(0, cap).sort((a, b) => a - b);
  return chosen.map((ci, i) => {
    const c = cands[ci], keptBelow = kids[ci].some(k => chosen.includes(k));
    const words = (keptBelow ? c.ownText : c.text || c.ownText).trim() || c.label.trim();
    return { i, text: words.replace(/\s+/g, ' ').slice(0, 60), x: c.x, y: c.y };
  });
}

// Runs in the page: finds every visible clickable and describes it as a Candidate. Self-contained for the same
// reason as pickClickables.
export function collectCandidates(selector: string): Candidate[] {
  const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && getComputedStyle(e).visibility !== 'hidden'; };
  const set = new Set<Element>([...document.querySelectorAll(selector)].filter(vis));
  const semantic = new Set(set);
  // Divs with a click handler usually say so only with cursor: pointer. The cursor is inherited, so only the
  // element where it starts counts (its parent's cursor isn't pointer), and only outside a listed clickable.
  const inside = (e: Element) => { for (let p = e.parentElement; p; p = p.parentElement) if (semantic.has(p)) return true; return false; };
  for (const e of document.body.querySelectorAll('*')) {
    if (set.has(e) || !vis(e)) continue;
    if (getComputedStyle(e).cursor !== 'pointer') continue;
    const p = e.parentElement;
    if (p && getComputedStyle(p).cursor === 'pointer') continue;
    if (inside(e)) continue;
    set.add(e);
  }
  const list = [...set].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const index = new Map(list.map((e, i) => [e, i]));
  const nearest = (e: Element | null) => { for (let p = e; p; p = p.parentElement) if (index.has(p)) return index.get(p)!; return null; };
  const own = list.map(() => [] as string[]);
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const t = (n.textContent ?? '').trim();
    if (!t) continue;
    const at = nearest(n.parentElement);
    if (at != null) own[at].push(t);
  }
  return list.map((e, i) => {
    const r = (e as HTMLElement).getBoundingClientRect();
    return {
      parent: nearest(e.parentElement), ownText: own[i].join(' ').replace(/\s+/g, ' ').trim(),
      text: ((e as HTMLElement).innerText || '').trim().replace(/\s+/g, ' '),
      label: (e.getAttribute('aria-label') || (e as HTMLInputElement).value || e.getAttribute('title') || '').toString().trim(),
      semantic: semantic.has(e), x: r.x + r.width / 2, y: r.y + r.height / 2,
    };
  });
}

export async function clickables(page: Page, cap = MAX_CLICKABLES): Promise<Clickable[]> {
  return page.evaluate(([collectSrc, pickSrc, sel, n]) => {
    const collect = (0, eval)(`(${collectSrc})`) as (s: string) => Candidate[];
    const pick = (0, eval)(`(${pickSrc})`) as (c: Candidate[], cap: number) => Clickable[];
    return pick(collect(sel as string), n as number);
  }, [collectCandidates.toString(), pickClickables.toString(), CLICKABLE_SELECTOR, cap] as const);
}

// The aim grid: thin lines every `step` px, x labels across the top and y labels down the left, so the model can
// read a point's coordinates off the picture instead of guessing them (its taps landed 60 to 140 px off without).
export const GRID_ID = 'pw-aim-grid';
export function gridSvg(w: number, h: number, step = 50): string {
  const lines: string[] = [], labels: string[] = [];
  for (let x = step; x < w; x += step) {
    lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke-opacity="${x % 100 ? 0.35 : 0.6}"/>`);
    labels.push(`<text x="${x}" y="9" text-anchor="middle">${x}</text>`);
  }
  for (let y = step; y < h; y += step) {
    lines.push(`<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke-opacity="${y % 100 ? 0.35 : 0.6}"/>`);
    labels.push(`<text x="2" y="${y + 3}">${y}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<g stroke="#fff" stroke-width="1" style="mix-blend-mode:difference">${lines.join('')}</g>`
    + `<g font-family="system-ui,sans-serif" font-size="9" font-weight="700" fill="#ff0" stroke="#000" stroke-width="2.5" paint-order="stroke">${labels.join('')}</g></svg>`;
}

// Takes the screenshot the model sees with the grid on, then removes the grid at once. The clock is frozen, so
// the page under it is the same frame as the human-facing screenshot taken just before.
export async function gridShot(page: Page, step = 50): Promise<Buffer> {
  const vp = page.viewportSize() ?? { width: 390, height: 844 };
  await page.evaluate(([id, svg]) => {
    const d = document.createElement('div');
    d.id = id;
    d.setAttribute('aria-hidden', 'true');
    d.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647;margin:0;padding:0';
    d.innerHTML = svg;
    document.documentElement.appendChild(d);
  }, [GRID_ID, gridSvg(vp.width, vp.height, step)] as const);
  try {
    return await page.screenshot({ type: 'jpeg', quality: 60 });
  } finally {
    await page.evaluate(id => document.getElementById(id)?.remove(), GRID_ID);
  }
}

export const GRID_PROMPT = 'The picture has a light grid drawn over it that is not part of the game: a line every 50 px, labelled with its pixel coordinate (x across the top, y down the left). Read x and y for a point off those labels.';
