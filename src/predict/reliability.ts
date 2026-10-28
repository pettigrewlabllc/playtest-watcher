// Label reliability gate (spec 3b revision 1): Joel's blind hand labels against Muse's, before any prediction score.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listSessions } from './study.ts';
import type { Moment } from './inputs.ts';

export const KAPPA_GATE = 0.6;

export function cohenKappa(a: string[], b: string[]): number | null {
  if (!a.length || a.length !== b.length) return null;
  const n = a.length;
  const cats = [...new Set([...a, ...b])];
  const po = a.filter((x, i) => x === b[i]).length / n;
  const pe = cats.reduce((s, c) => s + (a.filter(x => x === c).length / n) * (b.filter(x => x === c).length / n), 0);
  return pe >= 1 ? null : (po - pe) / (1 - pe);
}

export type Reliability = {
  n: number; kappa: number | null; agreement: number | null; below_gate: boolean; gate: number;
  per_label: Record<string, { kappa: number | null; joel: number; muse: number }>; sessions: string[];
};

// labels.json in a session folder: { momentId: label }, Joel's labels made blind to Muse's. Pairs with that session's moments.json.
export async function reliability(root: string): Promise<Reliability> {
  const joel: string[] = [], muse: string[] = [], sessions: string[] = [];
  for (const s of await listSessions(root)) {
    let labels: Record<string, string>, moments: Moment[];
    try { labels = JSON.parse(await readFile(join(s.dir, 'labels.json'), 'utf8')); } catch { continue; }
    try { moments = JSON.parse(await readFile(join(s.dir, 'moments.json'), 'utf8')); } catch { continue; }
    const byId = new Map(moments.filter(m => m.status === 'ok').map(m => [m.id, m.label]));
    let used = false;
    for (const [id, label] of Object.entries(labels)) {
      const m = byId.get(id);
      if (!m) continue;
      joel.push(label); muse.push(m); used = true;
    }
    if (used) sessions.push(s.id);
  }
  const per_label: Reliability['per_label'] = {};
  for (const l of [...new Set([...joel, ...muse])].sort()) {
    per_label[l] = { kappa: cohenKappa(joel.map(x => String(x === l)), muse.map(x => String(x === l))), joel: joel.filter(x => x === l).length, muse: muse.filter(x => x === l).length };
  }
  const kappa = cohenKappa(joel, muse);
  return {
    n: joel.length, kappa, agreement: joel.length ? joel.filter((x, i) => x === muse[i]).length / joel.length : null,
    below_gate: kappa === null || kappa < KAPPA_GATE, gate: KAPPA_GATE, per_label, sessions,
  };
}

export function reliabilityLine(r: Reliability): string {
  if (!r.n) return `label reliability: no hand labels yet (labels.json); every score below rests on Muse's labels alone, unchecked`;
  const per = Object.entries(r.per_label).map(([l, x]) => `${l} ${x.kappa == null ? '-' : x.kappa.toFixed(2)}`).join(', ');
  const head = `label reliability: Cohen's kappa ${r.kappa == null ? '-' : r.kappa.toFixed(2)} between Joel and Muse over ${r.n} moments (per label: ${per})`;
  return r.below_gate ? `${head}\nWARNING: kappa is below ${r.gate}; Muse's labels aren't reliable enough to score predictions against` : head;
}
