// The kid's own clips for the interview: a spread across Muse's labels (never shown), clearest first.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { listSessions, sameKid } from '../predict/study.ts';
import { LABELS } from '../watch/explain.ts';

export type InterviewClip = { session: string; id: string; game: string; museLabel: string };

export async function pickClips(root: string, letter: string, n = 5): Promise<InterviewClip[]> {
  const byLabel = new Map<string, InterviewClip[]>();
  const all: (InterviewClip & { confidence: number })[] = [];
  for (const s of (await listSessions(root)).filter(x => sameKid(x.kid, letter) && x.round === 'learn')) {
    let moments: { id: string; label: string; confidence: number; status: string }[];
    try { moments = JSON.parse(await readFile(join(s.dir, 'moments.json'), 'utf8')); } catch { continue; }
    for (const m of moments) {
      if (m.status !== 'ok' || m.label === 'none' || !existsSync(join(s.dir, 'clips', `${m.id}.mp4`))) continue;
      all.push({ session: s.id, id: m.id, game: s.game, museLabel: m.label, confidence: m.confidence });
    }
  }
  all.sort((a, b) => b.confidence - a.confidence || a.session.localeCompare(b.session) || a.id.localeCompare(b.id));
  for (const c of all) (byLabel.get(c.museLabel) ?? byLabel.set(c.museLabel, []).get(c.museLabel)!).push(c);
  // round-robin over labels, most common first, so a kid who is mostly "confused" still sees other kinds
  const queues = [...byLabel.entries()].sort((a, b) => b[1].length - a[1].length || LABELS.indexOf(a[0] as never) - LABELS.indexOf(b[0] as never)).map(([, q]) => q);
  const out: InterviewClip[] = [];
  const games = new Set<string>();
  while (out.length < n && queues.some(q => q.length)) {
    for (const q of queues) {
      if (out.length >= n || !q.length) continue;
      // prefer a game not shown yet, so the clips cover their games
      const i = Math.max(0, q.findIndex(c => !games.has(c.game)));
      const [c] = q.splice(i, 1);
      games.add(c.game);
      out.push({ session: c.session, id: c.id, game: c.game, museLabel: c.museLabel });
    }
  }
  return out;
}
