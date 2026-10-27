import { NUMERIC_FIELDS } from './fingerprint.ts';
import type { Fingerprint, NumericField } from './fingerprint.ts';

export type PlayerType = { id: number; name: string; centroid: Record<NumericField, number>; members: number[] };
export type PlayerTypes = {
  types: PlayerType[];
  // 'illustrative' under 6 players: the clusters show the method, they aren't discovered types.
  confidence: 'ok' | 'illustrative';
  scale: { mean: number[]; sd: number[] };
  centers: number[][];   // standardized centroids, used by nearestType
};

const PHRASE: Record<NumericField, [string, string]> = {
  fail_streak_before_negative: ['gives up fast', 'takes a lot of fails before souring'],
  recovery_s: ['bounces back quickly', 'recovers slowly'],
  explore_share: ['stays on the main path', 'explores a lot'],
  read_share: ['skims text', 'reads text'],
  read_dwell_per_100: ['spends little time on text', 'lingers on text'],
  attempts_per_min: ['plays slowly', 'plays fast'],
  hesitation_new_s: ['jumps at new things', 'hesitates at new things'],
  help_per_fail: ['rarely asks for help', 'asks for help often'],
  first_touch_main_share: ['pokes at side things first', 'goes for the main action first'],
  talk_per_min: ['plays quietly', 'talks a lot'],
};

const dist2 = (a: number[], b: number[]) => a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0);

function standardize(fps: Fingerprint[]) {
  const cols = NUMERIC_FIELDS.map(f => fps.map(fp => fp[f]).filter((v): v is number => v !== null && Number.isFinite(v)));
  const mean = cols.map(c => (c.length ? c.reduce((a, b) => a + b, 0) / c.length : 0));
  const sd = cols.map((c, i) => {
    const s = c.length ? Math.sqrt(c.reduce((a, b) => a + (b - mean[i]) ** 2, 0) / c.length) : 0;
    return s > 1e-9 ? s : 1;
  });
  return { mean, sd };
}

function vectorOf(fp: Fingerprint, scale: { mean: number[]; sd: number[] }): number[] {
  return NUMERIC_FIELDS.map((f, i) => {
    const v = fp[f];
    return v === null || !Number.isFinite(v) ? 0 : (v - scale.mean[i]) / scale.sd[i];   // missing = average
  });
}

// Deterministic: farthest-point start from the first player, then Lloyd iterations.
function kmeans(points: number[][], k: number): { centers: number[][]; assign: number[] } {
  const centers = [points[0]];
  while (centers.length < k) {
    let best = -1, bestD = -1;
    points.forEach((p, i) => {
      const d = Math.min(...centers.map(c => dist2(p, c)));
      if (d > bestD) { bestD = d; best = i; }
    });
    centers.push(points[best]);
  }
  let assign: number[] = points.map(() => 0);
  for (let iter = 0; iter < 100; iter++) {
    const next = points.map(p => centers.reduce((bi, c, ci) => (dist2(p, c) < dist2(p, centers[bi]) ? ci : bi), 0));
    const changed = next.some((a, i) => a !== assign[i]);
    assign = next;
    centers.forEach((_, ci) => {
      const m = points.filter((_, i) => assign[i] === ci);
      if (m.length) centers[ci] = m[0].map((_, d) => m.reduce((s, p) => s + p[d], 0) / m.length);
    });
    if (!changed && iter > 0) break;
  }
  return { centers, assign };
}

function nameOf(center: number[]): string {
  const ranked = center.map((z, i) => ({ z, i })).filter(x => Math.abs(x.z) >= 0.5)
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 2);
  if (!ranked.length) return 'typical across the board';
  return ranked.map(({ z, i }) => PHRASE[NUMERIC_FIELDS[i]][z > 0 ? 1 : 0]).join(', ');
}

export function playerTypes(fingerprints: Fingerprint[], k?: number): PlayerTypes {
  const n = fingerprints.length;
  if (!n) throw new Error('playerTypes needs at least one fingerprint');
  const scale = standardize(fingerprints);
  const points = fingerprints.map(fp => vectorOf(fp, scale));
  const kk = Math.max(1, Math.min(k ?? Math.min(3, n - 1), n));
  const { centers, assign } = kmeans(points, kk);
  const types: PlayerType[] = centers.map((c, id) => ({
    id, name: nameOf(c), members: assign.flatMap((a, i) => (a === id ? [i] : [])),
    centroid: Object.fromEntries(NUMERIC_FIELDS.map((f, d) => [f, c[d] * scale.sd[d] + scale.mean[d]])) as Record<NumericField, number>,
  }));
  return { types, confidence: n < 6 ? 'illustrative' : 'ok', scale, centers };
}

// Nearest type for a player with little data; missing fields count as average.
export function nearestType(model: PlayerTypes, fp: Fingerprint): PlayerType {
  const v = vectorOf(fp, model.scale);
  let best = 0;
  model.centers.forEach((c, i) => { if (dist2(v, c) < dist2(v, model.centers[best])) best = i; });
  return model.types[best];
}
