import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isValidSessionId, newSessionId } from './ids.ts';

export type SessionMeta = { kid: string; game: string; round: string; device?: string };
export type GameEvent = { t: number; type: string; data?: unknown };

const TRACK = /^[a-z]{1,16}$/;
const JSON_NAMES = new Set(['manifest', 'report', 'session']);

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
      const expected = nextSeq.get(key) ?? 0;
      if (seq !== expected) throw new Error(`expected seq ${expected}, got ${seq}`);
      await mkdir(d, { recursive: true });
      await appendFile(join(d, `${track}.webm`), buf);
      nextSeq.set(key, expected + 1);
    },

    async writeJson(id: string, name: string, obj: unknown): Promise<void> {
      if (!JSON_NAMES.has(name)) throw new Error(`bad json name: ${name}`);
      await mkdir(dir(id), { recursive: true });
      await writeFile(join(dir(id), `${name}.json`), JSON.stringify(obj, null, 2));
    },

    async appendEvents(id: string, events: GameEvent[], serverT: number): Promise<number> {
      const ok = events.filter(e => e && typeof e.t === 'number' && typeof e.type === 'string');
      if (ok.length === 0) return 0;
      await mkdir(dir(id), { recursive: true });
      await appendFile(join(dir(id), 'events.jsonl'), ok.map(e => JSON.stringify({ ...e, serverT })).join('\n') + '\n');
      return ok.length;
    },
  };
}
