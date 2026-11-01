// npm run persona -- <command>
//   new [--answers answers.yaml]       build a persona: asks who, consent, what data (or reads the answers file)
//   list                               personas in ./personas
//   show <slug|path>                   the card
//   validate <path>                    schema and consent checks
//   run <slug|path> --url <game> [--game name] [--limits-game g] [--steps 30] [--seed 7] [--point] [--progress js]
//       [--no-watcher] [--out dir] --live
// Personas are saved to ./personas/<slug>/persona.json (git-ignored: real people's personas stay local).
import { createInterface } from 'node:readline/promises';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import YAML from 'yaml';
import { clientFromEnv, createMetaClient } from '../meta/client.ts';
import { buildPersona, checkConsent, renderCard, type Answers, type SourceAnswer } from './intake.ts';
import { listPersonas, loadPersona, savePersona, toEngine, validatePersona } from './persona.ts';

const REPO = resolve(import.meta.dirname, '..', '..');
const RECORDINGS = join(REPO, 'recordings');
const args = process.argv.slice(2);
const opt = (k: string, d = '') => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const has = (k: string) => args.includes(`--${k}`);
const dir = resolve(opt('dir', 'personas'));
const client = () => has('live') ? clientFromEnv(REPO) : createMetaClient({ live: false, budgetUsd: 0, spendLog: join(RECORDINGS, 'spend.jsonl') });

async function ask(): Promise<Answers> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const q = async (s: string, d = '') => (await rl.question(d ? `${s} [${d}] ` : `${s} `)).trim() || d;
  const kind = (await q('Who is this? (person / group / described)', 'person')) as Answers['kind'];
  const name = await q('Name it:');
  const a: Answers = { name, kind, sources: [] };
  if (kind !== 'described') {
    const age = await q('Age, if you know it (blank if not):');
    a.age = age ? Number(age) : null;
    a.adult = a.age == null ? /^y/i.test(await q('An adult? (y/n)', 'n')) : a.age >= 18;
    const basis = (await q(`Who agreed to this? (self / parent / participant)`, a.age != null && a.age < 13 ? 'parent' : 'self')) as NonNullable<Answers['consent']>['basis'];
    a.consent = { basis, confirmed: /^y/i.test(await q(`Did ${kind === 'group' ? 'every member' : 'they'} agree${basis === 'parent' ? ', with a parent' : ''}? (y/n)`, 'n')) };
    checkConsent(a);   // stop before any file is opened
  }
  if (kind === 'group') {
    a.members = (await q('Member personas (slugs or paths, comma separated):')).split(',').map(s => s.trim()).filter(Boolean);
  } else if (kind === 'described') {
    a.sources = [{ type: 'description', text: await q('Describe them in a sentence:') }];
  } else {
    console.log('What do you have? Add as many as you like; blank to finish.\n  recorder <recordings dir> <letter> | events <file> <map.yaml> | survey <file> <map.yaml> | profile <facts.yaml> | description <a sentence>');
    for (;;) {
      const line = await q('>');
      if (!line) break;
      const [t, ...rest] = line.split(' ');
      if (t === 'recorder') a.sources!.push({ type: 'recorder', root: rest[0], letter: rest[1] });
      else if (t === 'events' || t === 'survey') a.sources!.push({ type: t, path: rest[0], map: rest[1] } as SourceAnswer);
      else if (t === 'profile') a.sources!.push({ type: 'profile', path: rest[0] });
      else if (t === 'description') a.sources!.push({ type: 'description', text: rest.join(' ') });
      else console.log(`  don't know "${t}"`);
    }
  }
  rl.close();
  return a;
}

const cmd = args[0];
try {
  if (cmd === 'new') {
    const f = opt('answers');
    const answers = f ? (f.endsWith('.json') ? JSON.parse(await readFile(f, 'utf8')) : YAML.parse(await readFile(f, 'utf8'))) as Answers : await ask();
    const p = await buildPersona(answers, { root: RECORDINGS, personasDir: dir, client: client() });
    const saved = await savePersona(dir, p);
    console.log(renderCard(await loadPersona(saved)));
    console.log(`\nsaved ${saved}`);
  } else if (cmd === 'list') {
    for (const p of await listPersonas(dir)) console.log(`${p.slug.padEnd(24)} ${p.kind.padEnd(10)} v${p.version}  ${p.card.who.slice(0, 70)}`);
  } else if (cmd === 'show') {
    console.log(renderCard(await loadPersona(args[1], dir)));
  } else if (cmd === 'validate') {
    const errs = await validatePersona(JSON.parse(await readFile(args[1], 'utf8')));
    console.log(errs.length ? errs.join('\n') : 'valid persona/2');
    process.exitCode = errs.length ? 1 : 0;
  } else if (cmd === 'run') {
    const p = await loadPersona(args[1], dir);
    const game = opt('game', 'game'), url = opt('url');
    if (!url) throw new Error('--url <game> is required');
    const letter = opt('letter') || p.slug;   // the slug, so two personas never share a session or saved copy
    const { persona, used, member } = toEngine(p, { letter, target: game, limitsGame: opt('limits-game') || undefined, seed: Number(opt('seed', '7')) });
    console.log(`${p.name}${member ? `: this run plays ${member}` : ''}\n${Object.entries(used).map(([k, v]) => `  ${k}: ${v}`).join('\n')}`);
    const { play, summarize } = await import('../agent/play.ts');
    const out = await play(letter, { persona, game, url, steps: Number(opt('steps', '30')), seed: Number(opt('seed', '7')), client: client(),
      watcher: has('no-watcher') ? undefined : opt('watcher', 'http://localhost:3058'), point: has('point'), progress: opt('progress') || undefined,
      ...(opt('out') ? { outDir: resolve(opt('out')) } : {}) } as Parameters<typeof play>[1]);
    const sum = summarize(out.steps);
    const runDir = (out as { dir?: string }).dir ?? join(RECORDINGS, out.session);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, 'summary.json'), JSON.stringify(sum, null, 2));
    console.log(JSON.stringify(sum));
    console.log(`steps: ${join(runDir, 'steps.jsonl')}`);
  } else {
    console.log(await readFile(new URL(import.meta.url), 'utf8').then(t => t.split('\n').filter(l => l.startsWith('//')).map(l => l.slice(3)).join('\n')));
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
}
