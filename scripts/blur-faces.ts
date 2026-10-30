// npm run blur [sessionId...]: writes face-blur.mp4 (whole face panel blurred) for every analyzed session that lacks
// one, or for the ones named. The viewer serves only this file, never face.mp4.
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { blurPanel } from '../src/watch/blur.ts';

const root = resolve(import.meta.dirname, '..', 'recordings');
const named = process.argv.slice(2);
const ids = named.length ? named : (await readdir(root)).filter(d => existsSync(join(root, d, 'aligned.json')));
for (const id of ids.sort()) {
  const face = join(root, id, 'face.mp4'), out = join(root, id, 'face-blur.mp4');
  if (!existsSync(face)) { console.log(`${id}: no face.mp4, skipped`); continue; }
  if (existsSync(out) && !named.length) continue;
  const t = Date.now();
  await blurPanel(face, out);
  console.log(`${id}: face-blur.mp4 in ${((Date.now() - t) / 1000).toFixed(0)} s`);
}
