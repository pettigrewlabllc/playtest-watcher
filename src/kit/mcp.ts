#!/usr/bin/env node
// MCP server: Informed Persona Testers from any agent (Claude Code, Cursor, VS Code, Codex, Gemini CLI).
//   claude mcp add personas -- npx -y github:pettigrewlabllc/playtest-watcher informed-personas-mcp
//   (from a checkout: claude mcp add personas -- node /path/to/playtest-watcher/src/kit/mcp.ts)
// Tools: list_personas, show_persona, new_persona, validate_persona, run_persona (returns a run id at once; a run
// takes minutes), get_report, forget_persona. Personas are kept where the CLI keeps them (src/kit/home.ts: the repo
// in a checkout, ~/.informed-personas when installed; PERSONAS_HOME or PERSONAS_DIR to change it). Live runs need
// PW_LIVE=1 and a model key (Meta, Anthropic or Gemini) in <home>/.env.local or the environment; without them the
// model client is fake and costs nothing.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { clientFromEnv, createMetaClient } from '../meta/client.ts';
import { buildPersona, renderCard, type Answers } from './intake.ts';
import { listPersonas, loadPersona, savePersona, toEngine, validatePersona } from './persona.ts';
import { forgetPersona } from './forget.ts';
import { kitPaths } from './home.ts';

const P = kitPaths();
const RECORDINGS = P.runs;
const DIR = P.personas;
const client = () => process.env.PW_LIVE === '1' ? clientFromEnv(P.home) : createMetaClient({ live: false, budgetUsd: 0, spendLog: P.spend });
const FAKE = client().live ? '' : `model: fake client (needs PW_LIVE=1 and a model key in ${P.env}); steps are placeholders, not a real play.\n`;
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

type Run = { status: 'running' | 'done' | 'failed'; persona: string; member?: string; used: Record<string, string>; session?: string; dir?: string; summary?: unknown; error?: string; started: string };
const runs = new Map<string, Run>();

const source = z.discriminatedUnion('type', [
  z.object({ type: z.literal('recorder'), root: z.string(), letter: z.string() }),
  z.object({ type: z.literal('events'), path: z.string().describe('an analytics export, CSV or JSON lines'),
    map: z.string().optional().describe('leave out for a GA4/Firebase, GameAnalytics or Unity export (detected from its columns); else a preset name (ga4, gameanalytics, unity) or a mapping file, see src/kit/presets/README.md'),
    player: z.string().optional().describe('which player in the export, when it holds several') }),
  z.object({ type: z.literal('survey'), path: z.string(), map: z.string().describe('see examples/data/survey.map.yaml') }),
  z.object({ type: z.literal('profile'), path: z.string().describe('profile facts the person exported themselves, see examples/data/profile.yaml') }),
  z.object({ type: z.literal('description'), text: z.string() }),
]);

const server = new McpServer({ name: 'informed-persona-testers', version: '0.2.0' });

server.registerTool('list_personas', { description: 'List the saved personas.', inputSchema: {} },
  async () => text((await listPersonas(DIR)).map(p => `${p.slug} (${p.kind}, v${p.version}): ${p.card.who}`).join('\n') || 'no personas yet'));

server.registerTool('show_persona', { description: 'Show a persona\'s card: who, how it plays, what it plays for, every number with its basis, consent and caveats.', inputSchema: { slug: z.string() } },
  async ({ slug }) => text(`${renderCard(await loadPersona(slug, DIR))}\n\nsaved at ${join(DIR, slug, 'persona.json')} (earlier versions in ${join(DIR, slug, 'versions')})`));

server.registerTool('new_persona', {
  description: 'Build and save a persona. Ask the USER each of these, in order, and pass their answers; never answer for them: (1) person, group or described? (2) a name, (3) for real people, did they agree, and a parent for anyone under 13? (4) what data they have and where it is. Consent is checked before any file is read.',
  inputSchema: {
    name: z.string(), kind: z.enum(['person', 'group', 'described']), who: z.string().optional(),
    age: z.number().int().nullable().optional(), adult: z.boolean().optional(),
    consent: z.object({ basis: z.enum(['self', 'parent', 'participant']), confirmed: z.boolean(), note: z.string().optional() }).optional(),
    sources: z.array(source).optional(), members: z.array(z.string()).optional(),
  },
}, async (a) => {
  const p = await buildPersona(a as Answers, { root: RECORDINGS, personasDir: DIR, client: client() });
  const f = await savePersona(DIR, p);
  return text(`${renderCard(await loadPersona(f))}\n\nsaved ${f}`);
});

server.registerTool('validate_persona', { description: 'Check a persona/2 file against the schema and the consent rules.', inputSchema: { path: z.string() } },
  async ({ path }) => { const errs = await validatePersona(JSON.parse(await readFile(path, 'utf8'))); return text(errs.length ? errs.join('\n') : 'valid persona/2'); });

server.registerTool('run_persona', {
  description: 'Play a web game or app as a persona, held to its limits. Returns a run id at once; call get_report with it (a 30-step run takes several minutes). Use point=true for canvas games.',
  inputSchema: {
    slug: z.string(), url: z.string(), game: z.string().default('game'), limits_game: z.string().optional().describe('a similar game the persona has numbers for, when it has none for this one'),
    steps: z.number().int().min(1).max(80).default(30), seed: z.number().int().default(7), point: z.boolean().default(false), progress: z.string().optional(),
  },
}, async (o) => {
  const p = await loadPersona(o.slug, DIR);
  const letter = p.slug;
  const { persona, used, member } = toEngine(p, { letter, target: o.game, limitsGame: o.limits_game, seed: o.seed });
  const id = `run-${Date.now().toString(36)}`;
  const run: Run = { status: 'running', persona: p.slug, member, used, started: new Date().toISOString() };
  runs.set(id, run);
  const { play, summarize } = await import('../agent/play.ts');
  play(letter, { persona, game: o.game, url: o.url, steps: o.steps, seed: o.seed, client: client(), point: o.point, outDir: RECORDINGS, progress: o.progress, log: (l: string) => { const m = /^session (\S+):/.exec(l); if (m) run.session = m[1]; } } as Parameters<typeof play>[1])
    .then(r => { run.status = 'done'; run.session = r.session; run.dir = (r as { dir?: string }).dir; run.summary = summarize(r.steps); })
    .catch(e => { run.status = 'failed'; run.error = (e as Error).message; });
  return text(`${FAKE}${id}: ${p.name}${member ? ` (this run plays ${member})` : ''} started on ${o.url}\nlimits: ${Object.entries(used).map(([k, v]) => `${k} ${v}`).join('; ')}`);
});

server.registerTool('get_report', { description: 'Status of a run, and when done its summary and where the step log is.', inputSchema: { run_id: z.string() } },
  async ({ run_id }) => {
    const r = runs.get(run_id);
    if (!r) return text('no such run in this server session');
    const dir = r.dir ?? (r.session ? join(RECORDINGS, r.session) : null);
    const steps = dir && existsSync(join(dir, 'steps.jsonl')) ? (await readFile(join(dir, 'steps.jsonl'), 'utf8')).trim().split('\n').length : 0;
    return text(FAKE + JSON.stringify({ ...r, steps, step_log: dir ? join(dir, 'steps.jsonl') : null }, null, 2));
  });

server.registerTool('forget_persona', {
  description: `Delete a persona for good: its file, every earlier version, every run it played and the copies those runs saved. Ask the USER first and pass their confirmation; never decide it for them. The data it was built from (exports, surveys, profile files) is the user's and is not touched; the result lists it. A group holds full copies of its members, so a member held by a group needs with_groups=true, which deletes those groups too. Personas are kept in ${DIR}; runs in ${RECORDINGS}.`,
  inputSchema: { slug: z.string(), confirm_slug: z.string().describe('the slug again, exactly as the user confirmed it'), with_groups: z.boolean().default(false) },
}, async ({ slug, confirm_slug, with_groups }) => {
  if (confirm_slug !== slug) return text('nothing deleted: confirm_slug has to match slug');
  const r = await forgetPersona(slug, { personasDir: DIR, runsRoot: RECORDINGS, withGroups: with_groups });
  return text([`deleted:`, ...r.removed.map(f => `  ${f}`), ...(r.groups.length ? [`groups that held it, deleted too: ${r.groups.join(', ')}`] : []),
    ...(r.left.length ? ['not touched, the data it was built from (the user\'s to delete):', ...r.left.map(f => `  ${f}`)] : [])].join('\n'));
});

await server.connect(new StdioServerTransport());
