import { mkdir, appendFile, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isValidSessionId, newSessionId } from './ids.ts';

export type SessionMeta = { kid: string; game: string; round: string; device?: string };
export type GameEvent = { t: number; type: string; data?: unknown };

const TRACK = /^[a-z]{1,16}$/;
const JSON_NAMES = new Set(['manifest', 'report', 'session']);
const KID = /^[a-d]$/;
const KID_JSON = new Set(['questionnaire']);

export function createStore(root: string) {
  const nextSeq = new Map<string, number>();

  function dir(id: string): string {
    if (!isValidSessionId(id)) throw new Error(`bad session id: ${id}`);
    return join(root, id);
  }

  return {
    dir,

    async createSession(meta: SessionMeta): Promise<string> {
      const id = newSessionId([meta.kid, meta.game, meta.round]);
      await mkdir(dir(id), { recursive: true });
      await writeFile(join(dir(id), 'session.json'), JSON.stringify({ id, ...meta, createdAt: Date.now() }, null, 2));
      return id;
    },

    async appendChunk(id: string, track: string, seq: number, buf: Buffer): Promise<void> {
      const d = dir(id);
      if (!TRACK.test(track)) throw new Error(`bad track: ${track}`);
      const key = `${id}/${track}`;
      const seqFile = join(d, `${track}.seq`);
      // <track>.seq holds the next expected seq on disk, so a restarted server carries on where it was
      let expected = nextSeq.get(key);
      if (expected === undefined) {
        const saved = Number((await readFile(seqFile, 'utf8').catch(() => '0')).trim());
        expected = Number.isInteger(saved) && saved >= 0 ? saved : 0;
      }
      if (seq === expected - 1) return;   // a retry of a chunk already stored (its response was lost)
      if (seq !== expected) throw new Error(`expected seq ${expected}, got ${seq}`);
      await mkdir(d, { recursive: true });
      await appendFile(join(d, `${track}.webm`), buf);
      await writeFile(seqFile, String(expected + 1));
      nextSeq.set(key, expected + 1);
    },

    async writeJson(id: string, name: string, obj: unknown): Promise<void> {
      if (!JSON_NAMES.has(name)) throw new Error(`bad json name: ${name}`);
      await mkdir(dir(id), { recursive: true });
      await writeFile(join(dir(id), `${name}.json`), JSON.stringify(obj, null, 2));
    },

    async writeKidJson(kid: string, name: string, obj: unknown): Promise<void> {
      if (!KID.test(kid)) throw new Error(`bad kid: ${kid}`);
      if (!KID_JSON.has(name)) throw new Error(`bad json name: ${name}`);
      const d = join(root, 'kids', kid);
      await mkdir(d, { recursive: true });
      await writeFile(join(d, `${name}.json`), JSON.stringify(obj, null, 2));
    },

    async summary(id: string): Promise<{ eventCount: number; files: Record<string, number> }> {
      const d = dir(id);
      const files: Record<string, number> = {};
      for (const f of await readdir(d)) files[f] = (await stat(join(d, f))).size;
      let eventCount = 0;
      if (files['events.jsonl']) eventCount = (await readFile(join(d, 'events.jsonl'), 'utf8')).split('\n').filter(Boolean).length;
      return { eventCount, files };
    },

    async appendEvents(id: string, events: GameEvent[], serverT: number): Promise<number> {
      const ok = events.filter(e => e && typeof e.t === 'number' && typeof e.type === 'string');
      // A stale game tab can keep sending to an old or deleted session; never recreate one from events.
      const d = dir(id);
      try { await stat(join(d, 'session.json')); } catch { throw Object.assign(new Error(`no such session: ${id}`), { status: 404 }); }
      if (ok.length === 0) return 0;
      await appendFile(join(dir(id), 'events.jsonl'), ok.map(e => JSON.stringify({ ...e, serverT })).join('\n') + '\n');
      return ok.length;
    },
  };
}
