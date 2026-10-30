import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MetaClient } from '../meta/client.ts';
import { mmss, type Moment } from './explain.ts';

type Fix = { title: string; why: string; evidence_moment_ids: string[]; severity: 'high' | 'medium' | 'low'; suggestion: string };

const str = { type: 'string' };
const FIXES_SCHEMA = {
  name: 'fixes',
  schema: {
    type: 'object', additionalProperties: false, required: ['fixes'],
    properties: {
      fixes: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['title', 'why', 'evidence_moment_ids', 'severity', 'suggestion'],
          properties: { title: str, why: str, evidence_moment_ids: { type: 'array', items: str }, severity: { type: 'string', enum: ['high', 'medium', 'low'] }, suggestion: str },
        },
      },
    },
  },
};
const RANK = { high: 0, medium: 1, low: 2 } as const;

async function readJson<T>(file: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; } catch { return undefined; }
}

export async function fixesStage(dir: string, client: MetaClient): Promise<string> {
  const session = (await readJson<{ game?: string; kid?: string; createdAt?: number }>(join(dir, 'session.json'))) ?? {};
  const moments = (await readJson<Moment[]>(join(dir, 'moments.json'))) ?? [];
  const date = new Date(session.createdAt ?? Date.now()).toISOString().slice(0, 10);
  const game = session.game ?? 'unknown game';
  const heading = `# Fix list: ${game}, kid ${(session.kid ?? '?').toUpperCase()}, ${date}`;
  const real = moments.filter(m => m.label !== 'none' && m.status === 'ok');

  let md: string;
  if (!real.length) {
    md = `${heading}\n\nNo moments worth a fix this session. Nothing came out as confused, stuck, bored, frustrated or delighted.\n`;
  } else {
    const byId = new Map(real.map(m => [m.id, m]));
    const payload = real.map(m => ({
      id: m.id, time: mmss(m.startMs), label: m.label, confidence: m.confidence,
      evidence: m.evidence, game_context: m.game_context, fix_hint: m.fix_hint,
    }));
    const r = await client.respond<{ fixes: Fix[] }>({
      // Reasoning counts against the cap; 6000 ran out before the JSON on an 8-moment session.
      model: 'muse-wonder-1.0', kind: 'fixes', schema: FIXES_SCHEMA, maxOutputTokens: 16000,
      content: [{
        type: 'input_text',
        text: [
          `A child playtested a kids' game called "${game}". Below are the moments an observer flagged, as JSON.`,
          'Group related moments into a short ranked list of changes the developer should make. Each fix needs a short title, why it matters (what the kid did or felt), the ids of the moments that show it, a severity (high: blocks or sours the game; medium: slows or confuses; low: polish), and one concrete suggestion. Only cite ids that appear below. Do not name the child.',
          '',
          JSON.stringify(payload, null, 1),
        ].join('\n'),
      }],
    });
    // An empty list for real moments is a bad answer, not "nothing to fix": fail so fixes.md is not written blank.
    if (!Array.isArray(r.data?.fixes) || !r.data.fixes.length) throw new Error(`fixes came back empty for ${real.length} moments: ${r.text.slice(0, 300)}`);
    const fixes = [...r.data.fixes].sort((a, b) => (RANK[a.severity] ?? 3) - (RANK[b.severity] ?? 3));
    const body = fixes.map(f => {
      const links = f.evidence_moment_ids.filter(id => byId.has(id)).map(id => `[${id} at ${mmss(byId.get(id)!.startMs)}](#${id})`);
      return [`## ${f.title}`, '', `Severity: ${f.severity}`, '', f.why, '', `Fix: ${f.suggestion}`, ...(links.length ? ['', `Moments: ${links.join(', ')}`] : [])].join('\n');
    });
    md = [heading, '', ...body.flatMap(b => [b, ''])].join('\n');
  }
  await writeFile(join(dir, 'fixes.md'), md);
  return md;
}
