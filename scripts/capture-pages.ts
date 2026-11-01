// Screen footage of the product's pages for the demo video, recorded with Playwright at 1920x1080.
// No kid appears: the viewer shows Joel's own run, and the interview capture skips the clip screen (a kid's face).
//   node scripts/capture-pages.ts <out dir> runs|interview|viewer [...]
import { chromium, type Page } from 'playwright';
import { mkdir, rename, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const BASE = 'http://localhost:3058';
const out = resolve(process.argv[2] ?? 'video-footage');
const which = process.argv.slice(3);
const wait = (p: Page, ms: number) => p.waitForTimeout(ms);

async function record(name: string, fn: (p: Page) => Promise<void>) {
  const tmp = join(out, `.tmp-${name}`);
  await rm(tmp, { recursive: true, force: true });
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  // Recorded at 1080p with the page zoomed 1.5x, so the interface reads at video size and stays sharp. (At 1920
  // wide it sat small in a corner; a 1280x720 viewport recorded into 1080p came back padded with grey.)
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, recordVideo: { dir: tmp, size: { width: 1920, height: 1080 } } });
  await ctx.addInitScript(() => { addEventListener('DOMContentLoaded', () => { document.documentElement.style.zoom = '1.5'; }); });
  const p = await ctx.newPage();
  await fn(p);
  await ctx.close(); await b.close();
  const f = (await readdir(tmp)).find(x => x.endsWith('.webm'));
  if (f) await rename(join(tmp, f), join(out, `${name}.webm`));
  await rm(tmp, { recursive: true, force: true });
  console.log(`${name}.webm`);
}

await mkdir(out, { recursive: true });

if (which.includes('runs')) await record('runs-hoard-keeper', async p => {
  await p.goto(`${BASE}/runs.html?public&a=20261031-214957-a-hoard-keeper-agent&b=20261031-214957-b-hoard-keeper-agent`);
  await wait(p, 2500);
  for (let i = 0; i < 4; i++) { await p.click('#next'); await wait(p, 900); }
  await p.mouse.wheel(0, 520); await wait(p, 1500);
  for (let i = 0; i < 10; i++) { await p.click('#next'); await wait(p, 1500); }
});

// The newest Hoard Keeper build (after the kids' four rounds of fixes): to the King's Audit, where the oldest reads why
// the answer came up short and the youngest picks the shiny one.
if (which.includes('hk-new')) await record('runs-hk-new', async p => {
  await p.goto(`${BASE}/runs.html?public&a=20261101-141138-a-hoard-keeper-agent&b=20261101-141138-b-hoard-keeper-agent`);
  await wait(p, 2000);
  await p.mouse.wheel(0, 520); await wait(p, 600);
  for (const n of [31, 32, 33, 34, 35, 38]) { await p.locator('.strip').first().locator(`[data-i="${n}"]`).click(); await wait(p, 1900); }   // one step counter drives both runs
});

// Continental Drift, played the morning it changed: tap rings on Egypt's own pyramids, then the food hint.
if (which.includes('cd')) await record('runs-cd', async p => {
  await p.goto(`${BASE}/runs.html?public&a=20261101-141138-a-continental-drift-agent&b=20261101-141138-b-continental-drift-agent`);
  await wait(p, 2000);
  await p.mouse.wheel(0, 520); await wait(p, 600);
  for (let i = 0; i < 4; i++) { await p.click('#next'); await wait(p, 1700); }
  for (let i = 0; i < 4; i++) { await p.click('#next'); await wait(p, 900); }
  for (let i = 0; i < 3; i++) { await p.click('#next'); await wait(p, 1700); }
});

if (which.includes('described')) await record('runs-described', async p => {
  await p.goto(`${BASE}/runs.html?public&a=20261031-215034-x-hoard-keeper-agent&b=20261031-214957-a-hoard-keeper-agent`);
  await wait(p, 3000);
  await p.mouse.wheel(0, 640); await wait(p, 1200);
  for (let i = 0; i < 6; i++) { await p.click('#next'); await wait(p, 1400); }
});

if (which.includes('interview')) await record('interview', async p => {
  await p.goto(`${BASE}/interview.html?kid=A&playtest=demo-capture&pw=${encodeURIComponent(BASE)}`);
  // The clip screen plays a kid's own video: hide every video before anything is recorded past the intro.
  await p.addStyleTag({ content: 'video { display: none !important; }' });
  await wait(p, 1500);
  await p.click('#next'); await p.click('#next'); await wait(p, 1200);   // past the clip screen to the word picker
  const words = p.locator('.grid button');
  await words.nth(4).hover(); await wait(p, 700); await words.nth(4).click(); await wait(p, 1800);
  for (let i = 0; i < 11; i++) await p.click('#next');   // remaining clips, the games question and the ideas intro, to the first idea
  await wait(p, 1200);
  await p.locator('.answers button').nth(0).click(); await wait(p, 2000);
});

if (which.includes('viewer')) await record('viewer-joel', async p => {
  await p.goto(`${BASE}/view.html?s=20261029-015905-j-bond-swap-learn`);
  await wait(p, 2500);
  await p.click('#play'); await wait(p, 6000);
  await p.locator('.mo').nth(2).click(); await wait(p, 4000);
  await p.click('#play'); await wait(p, 600);
  await p.locator('#fixes').hover(); await p.mouse.wheel(0, 500); await wait(p, 3000);
});
