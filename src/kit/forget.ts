// Forget a persona: its file and every earlier version, the runs it played and the copies they saved, and a
// cached reading of its description. The data the person brought (exports, surveys, profile files) is theirs and
// stays where it is; the result lists it so they can delete it too. A group holds a full copy of each member, so
// a member can't be forgotten while a group still holds it, unless the groups go as well (withGroups).
import { readdir, readFile, rm, rmdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Persona2 } from './persona.ts';

export type Forgotten = { removed: string[]; left: string[]; groups: string[] };
const fail = (m: string) => Object.assign(new Error(m), { status: 400 });
const readJson = async (f: string) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return null; } };
const dirs = async (d: string) => { try { return (await readdir(d, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name); } catch { return []; } };

async function groupsHolding(personasDir: string, slug: string): Promise<string[]> {
  const out: string[] = [];
  for (const s of await dirs(personasDir)) {
    if (s === slug) continue;
    const files = [join(personasDir, s, 'persona.json'), ...(await readdir(join(personasDir, s, 'versions')).catch(() => [])).map(f => join(personasDir, s, 'versions', f))];
    for (const f of files) {
      const g = await readJson(f) as Persona2 | null;
      if (g?.kind === 'group' && g.members?.some(m => m.persona?.slug === slug || m.label === slug)) { out.push(s); break; }
    }
  }
  return out;
}

export async function forgetPersona(slug: string, o: { personasDir: string; runsRoot: string; withGroups?: boolean }): Promise<Forgotten> {
  if (!/^[a-z0-9-]+$/.test(slug)) throw fail(`not a persona slug: "${slug}"`);
  const dir = join(o.personasDir, slug);
  const p = await readJson(join(dir, 'persona.json')) as Persona2 | null;
  if (!p) throw fail(`no persona "${slug}" in ${o.personasDir}`);
  const res: Forgotten = { removed: [], left: [], groups: await groupsHolding(o.personasDir, slug) };
  if (res.groups.length && !o.withGroups) throw fail(`${res.groups.join(', ')} still hold${res.groups.length === 1 ? 's' : ''} a full copy of ${slug}. Forget ${res.groups.length === 1 ? 'that group' : 'those groups'} too (--with-groups), or forget ${res.groups.length === 1 ? 'it' : 'them'} first.`);
  for (const g of res.groups) { const r = await forgetPersona(g, { ...o, withGroups: false }); res.removed.push(...r.removed); res.left.push(...r.left); }

  await rm(dir, { recursive: true, force: true });
  res.removed.push(dir);

  // Runs: a kit run plays under the persona's slug, so its folder's persona.json names the slug exactly.
  for (const s of await dirs(o.runsRoot)) {
    const f = join(o.runsRoot, s, 'persona.json');
    if ((await readJson(f))?.persona?.letter === slug) { await rm(join(o.runsRoot, s), { recursive: true, force: true }); res.removed.push(join(o.runsRoot, s)); }
  }
  // The copy each run played (players/<slug>/persona-<game>.json). Matched on the letter inside, case and all,
  // because players/ also holds recorder folders and a case-insensitive disk would let "a" reach "A".
  const pl = join(o.runsRoot, 'players', slug);
  for (const f of await readdir(pl).catch(() => [] as string[])) {
    if (/^persona-.*\.json$/.test(f) && (await readJson(join(pl, f)))?.letter === slug) { await rm(join(pl, f)); res.removed.push(join(pl, f)); }
  }
  if (existsSync(pl)) await rmdir(pl).catch(() => { /* not empty: something else lives there */ });
  // A described persona's reading, cached under the first letter of its name, only when it is this description.
  const cache = join(o.runsRoot, 'players', (slug[0] ?? '').toUpperCase(), 'described.json');
  const c = await readJson(cache);
  if (p.kind === 'described' && c?.description && c.description === p.who) { await rm(cache); res.removed.push(cache); }

  for (const s of p.provenance?.sources ?? []) if (s.path && ['events', 'survey', 'profile'].includes(s.type)) res.left.push(s.path);
  return res;
}
