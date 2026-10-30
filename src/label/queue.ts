import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LABELS, type Moment } from '../watch/explain.ts';
import { listSessions } from '../predict/study.ts';
import { isValidSessionId } from '../server/ids.ts';

// Joel's hand labels, blind to Muse's. labels.json in a session folder is { momentId: label },
// the shape reliability.ts already reads. label-queue.json in the recordings root is the order to label in.
export type QueueItem = { session: string; moment: string; kid: string; game: string; reliability: boolean };

const KIDS = /^[a-d]$/i;
const MOMENT_ID = /^[a-z0-9_-]{1,40}$/i;
const RELIABILITY_N = 60;

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

// FNV-1a, so the order is fixed by the seed and not by readdir or Math.random.
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}

// Equal shares per Muse label (none included), and within a label the kids take turns.
export async function sampleLabels(root: string, opts: { n?: number; seed?: string } = {}): Promise<QueueItem[]> {
  const n = opts.n ?? 200, seed = opts.seed ?? 'labels-v1';
  const byLabel = new Map<string, Map<string, (QueueItem & { key: number })[]>>();
  for (const s of await listSessions(root)) {
    if (!KIDS.test(s.kid)) continue;   // kids only; Joel's reference runs are not labelled
    const moments = await readJson<Moment[]>(join(s.dir, 'moments.json'), []);
    const done = await readJson<Record<string, string>>(join(s.dir, 'labels.json'), {});
    for (const m of moments) {
      if (m.status !== 'ok' || m.id in done) continue;
      const kids = byLabel.get(m.label) ?? new Map();
      const list = kids.get(s.kid.toLowerCase()) ?? [];
      list.push({ session: s.id, moment: m.id, kid: s.kid.toLowerCase(), game: s.game, reliability: false, key: hash(`${seed}:${s.id}:${m.id}`) });
      kids.set(s.kid.toLowerCase(), list);
      byLabel.set(m.label, kids);
    }
  }
  const perLabel = [...LABELS].filter(l => byLabel.has(l)).map(l => {
    const kids = [...byLabel.get(l)!.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, xs]) => xs.sort((a, b) => a.key - b.key));
    const out: QueueItem[] = [];
    for (let i = 0; kids.some(xs => i < xs.length); i++) for (const xs of kids) if (i < xs.length) out.push(xs[i]);
    return out;
  });
  const picked: QueueItem[] = [];
  for (let i = 0; picked.length < n && perLabel.some(xs => i < xs.length); i++) {
    for (const xs of perLabel) if (i < xs.length && picked.length < n) picked.push(xs[i]);
  }
  return picked.map(({ session, moment, kid, game }, i) => ({ session, moment, kid, game, reliability: i < RELIABILITY_N }));
}

export async function writeQueue(root: string, items: QueueItem[]): Promise<void> {
  await writeFile(join(root, 'label-queue.json'), JSON.stringify(items, null, 2));
}

// What is left to label, in queue order, plus progress counts.
export async function pendingQueue(root: string): Promise<{ total: number; done: number; items: QueueItem[] }> {
  const queue = await readJson<QueueItem[]>(join(root, 'label-queue.json'), []);
  const labels = new Map<string, Record<string, string>>();
  const items: QueueItem[] = [];
  for (const q of queue) {
    if (!isValidSessionId(q.session)) continue;
    if (!labels.has(q.session)) labels.set(q.session, await readJson(join(root, q.session, 'labels.json'), {}));
    if (!(q.moment in labels.get(q.session)!)) items.push(q);
  }
  return { total: queue.length, done: queue.length - items.length, items };
}

const fail = (status: number, message: string) => Object.assign(new Error(message), { status });

// label null removes the label (undo).
export async function setLabel(root: string, session: string, moment: string, label: string | null): Promise<void> {
  if (!isValidSessionId(session) || !MOMENT_ID.test(moment)) throw fail(400, 'bad session or moment');
  if (label !== null && !(LABELS as readonly string[]).includes(label)) throw fail(400, `bad label: ${label}`);
  const moments = await readJson<Moment[]>(join(root, session, 'moments.json'), []);
  if (!moments.some(m => m.id === moment && m.status === 'ok')) throw fail(404, `unknown moment: ${session}/${moment}`);
  const file = join(root, session, 'labels.json');
  const labels = await readJson<Record<string, string>>(file, {});
  if (label === null) delete labels[moment]; else labels[moment] = label;
  await writeFile(file, JSON.stringify(labels, null, 2));
}

export function clipPath(root: string, session: string, moment: string): string {
  if (!isValidSessionId(session) || !MOMENT_ID.test(moment)) throw fail(400, 'bad session or moment');
  return join(root, session, 'clips', `${moment}.mp4`);
}
