// Narration for the demo video (public/narrate.html): the script's beats as a teleprompter, one recorded take per
// beat. Takes live in recordings/video/narration/ (git-ignored: it is Joel's voice), so cutting them to the
// video's beats is a matter of placing each file at its beat's start.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type Beat = { id: string; at: number; picture: string; section: string; text: string; target: number };

const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
export const VIDEO_S = 180;
export const scriptPath = (root: string) => join(root, '..', 'docs', 'video', 'script.md');
export const narrationDir = (root: string) => join(root, 'video', 'narration');
const EXT: Record<string, string> = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg' };

// A beat starts at a line like **[1:52, what's on screen]** and runs to the next one, a "## " heading or "---".
export function parseScript(md: string, videoS = VIDEO_S): Beat[] {
  const beats: Beat[] = [];
  let section = '', cur: Beat | null = null;
  for (const line of md.split('\n')) {
    const head = /^\*\*\[(\d+):(\d\d),\s*(.*)\]\*\*\s*$/.exec(line.trim());
    if (head) {
      cur = { id: `b${String(beats.length + 1).padStart(2, '0')}`, at: Number(head[1]) * 60 + Number(head[2]), picture: head[3], section, text: '', target: 0 };
      beats.push(cur);
      continue;
    }
    if (/^##\s/.test(line)) { section = line.replace(/^##\s+/, '').trim(); cur = null; continue; }
    if (/^---/.test(line)) { cur = null; continue; }
    if (cur && line.trim()) cur.text = cur.text ? `${cur.text}\n\n${line.trim()}` : line.trim();
  }
  beats.forEach((b, i) => { b.target = (beats[i + 1]?.at ?? videoS) - b.at; });
  return beats.filter(b => b.text);
}

type Takes = Record<string, { file: string; ms: number; at: number }>;
const readTakes = async (root: string): Promise<Takes> => { try { return JSON.parse(await readFile(join(narrationDir(root), 'takes.json'), 'utf8')); } catch { return {}; } };

export async function narrationData(root: string) {
  const beats = parseScript(await readFile(scriptPath(root), 'utf8'));
  const takes = await readTakes(root);
  return { beats: beats.map(b => ({ ...b, take: takes[b.id] && existsSync(join(narrationDir(root), takes[b.id].file)) ? takes[b.id] : null })) };
}

// The newest take wins; the one before it is kept as <id>.prev.<ext> in case the redo was worse.
export async function saveTake(root: string, id: string, mime: string, ms: number, audio: Buffer) {
  if (!/^b\d\d$/.test(id)) throw fail(400, 'bad beat id');
  const ext = EXT[mime.split(';')[0]];
  if (!ext) throw fail(400, `bad audio type ${mime}`);
  if (!audio.length) throw fail(400, 'bad empty take');
  const dir = narrationDir(root);
  await mkdir(dir, { recursive: true });
  const takes = await readTakes(root);
  const old = takes[id];
  if (old && existsSync(join(dir, old.file))) await rename(join(dir, old.file), join(dir, old.file.replace(/\.(\w+)$/, '.prev.$1')));
  const file = `${id}.${ext}`;
  await writeFile(join(dir, file), audio);
  takes[id] = { file, ms: Math.round(ms) || 0, at: Date.now() };
  await writeFile(join(dir, 'takes.json'), JSON.stringify(takes, null, 2));
  return takes[id];
}

export function takePath(root: string, file: string) {
  if (!/^b\d\d(\.prev)?\.(webm|m4a|ogg)$/.test(file)) throw fail(404, 'not found');
  return join(narrationDir(root), file);
}
