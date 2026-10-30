// Label stability: Muse against itself. Hand labelling was dropped (spec 3b+), so Muse's labels are ground truth;
// the cheapest check on that is asking Muse twice about the same clip and measuring how often it agrees.
import { mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { MetaClient } from '../meta/client.ts';
import { explainStage, LABELS } from '../watch/explain.ts';
import type { Moment } from '../watch/explain.ts';
import { listSessions } from './study.ts';
import { cohenKappa } from './reliability.ts';
import { groupDir } from './traits.ts';

export type Pick = { session: string; id: string; label: string };
export type Stability = {
  n: number; kappa: number | null; agreement: number | null; secondary_agreement: number | null;
  per_label: Record<string, { n: number; same: number }>;
  pairs: (Pick & { again: string; again_secondary: string; confidence: number; again_confidence: number })[];
};

// Round-robin over Muse's labels so rare labels get picked too, in a fixed order (sessions and ids sorted).
export function pickClips(byLabel: Map<string, Pick[]>, n: number): Pick[] {
  const queues = LABELS.map(l => [...(byLabel.get(l) ?? [])]).filter(q => q.length);
  const out: Pick[] = [];
  while (out.length < n && queues.some(q => q.length)) for (const q of queues) if (q.length && out.length < n) out.push(q.shift()!);
  return out;
}

// A throwaway copy of the session (links, not copies) holding only the picked candidates and no moments.json,
// so explainStage asks again instead of reusing the stored answer, and the real folder is never written.
async function scratchCopy(src: string, ids: string[], base: string): Promise<string> {
  const dir = join(base, 'session');
  await mkdir(join(dir, 'clips'), { recursive: true });
  for (const f of await readdir(src)) {
    if (['moments.json', 'candidates.json', 'clips', 'fixes.md', 'fixes.json'].includes(f)) continue;
    await symlink(join(src, f), join(dir, f));
  }
  if (existsSync(join(src, '..', 'kids.json'))) await symlink(join(src, '..', 'kids.json'), join(base, 'kids.json'));
  const cands = JSON.parse(await readFile(join(src, 'candidates.json'), 'utf8')) as { id: string }[];
  await writeFile(join(dir, 'candidates.json'), JSON.stringify(cands.filter(c => ids.includes(c.id))));
  return dir;
}

export async function stability(root: string, client: MetaClient, o: { n?: number; log?: (l: string) => void } = {}): Promise<Stability> {
  const log = o.log ?? console.log;
  const byLabel = new Map<string, Pick[]>();
  const dirs = new Map<string, string>();
  const first = new Map<string, Moment>();
  for (const s of (await listSessions(root)).filter(x => x.round === 'learn').sort((a, b) => a.id.localeCompare(b.id))) {
    let moments: Moment[];
    try { moments = JSON.parse(await readFile(join(s.dir, 'moments.json'), 'utf8')); } catch { continue; }
    dirs.set(s.id, s.dir);
    for (const m of moments.filter(x => x.status === 'ok').sort((a, b) => a.id.localeCompare(b.id))) {
      (byLabel.get(m.label) ?? byLabel.set(m.label, []).get(m.label)!).push({ session: s.id, id: m.id, label: m.label });
      first.set(`${s.id}:${m.id}`, m);
    }
  }
  const picks = pickClips(byLabel, o.n ?? 30);
  const pairs: Stability['pairs'] = [];
  for (const session of [...new Set(picks.map(p => p.session))]) {
    const mine = picks.filter(p => p.session === session);
    const base = join(tmpdir(), `pw-stability-${process.pid}-${session}`);
    await rm(base, { recursive: true, force: true });
    try {
      const again = await explainStage(await scratchCopy(dirs.get(session)!, mine.map(p => p.id), base), client);
      for (const p of mine) {
        const a = again.find(m => m.id === p.id);
        if (!a || a.status !== 'ok') { log(`stability: ${session}:${p.id} failed the second time; left out`); continue; }
        const f = first.get(`${session}:${p.id}`)!;
        pairs.push({ ...p, again: a.label, again_secondary: a.secondary_label, confidence: f.confidence, again_confidence: a.confidence });
      }
      log(`stability: ${session} ${mine.length} clips asked again`);
    } finally { await rm(base, { recursive: true, force: true }); }
  }
  const a = pairs.map(p => p.label), b = pairs.map(p => p.again);
  const per_label: Stability['per_label'] = {};
  for (const p of pairs) { const x = (per_label[p.label] ??= { n: 0, same: 0 }); x.n++; if (p.again === p.label) x.same++; }
  const out: Stability = {
    n: pairs.length, kappa: cohenKappa(a, b),
    agreement: pairs.length ? pairs.filter(p => p.again === p.label).length / pairs.length : null,
    // a softer read: the second answer's top label is the first answer's label, or one of the two is the other's runner-up
    secondary_agreement: pairs.length ? pairs.filter(p => p.again === p.label || p.again_secondary === p.label || first.get(`${p.session}:${p.id}`)!.secondary_label === p.again).length / pairs.length : null,
    per_label, pairs,
  };
  await mkdir(groupDir({ root }), { recursive: true });
  await writeFile(join(groupDir({ root }), 'stability.json'), JSON.stringify(out, null, 2));
  return out;
}

export function stabilityLine(s: Stability): string {
  if (!s.n) return 'label stability: not measured yet (npm run predict -- stability --live)';
  const per = Object.entries(s.per_label).map(([l, x]) => `${l} ${x.same}/${x.n}`).join(', ');
  const pc = (x: number | null) => (x == null ? '-' : `${Math.round(x * 100)}%`);
  return `label stability: Muse asked twice about ${s.n} clips agreed ${pc(s.agreement)} of the time (kappa ${s.kappa == null ? '-' : s.kappa.toFixed(2)}; ${pc(s.secondary_agreement)} counting runner-up labels). Same label again by first label: ${per}`;
}
