// The installable build: Node won't strip types from files under node_modules, so `npx` needs plain JS. Compiles
// src/ to dist/src/ with the layout kept (module-relative paths still resolve), then copies the data files those
// paths point at: the schema, the measured players' limits, the export presets.
import { execFileSync } from 'node:child_process';
import { cp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..');
const DIST = join(REPO, 'dist');
await rm(DIST, { recursive: true, force: true });
execFileSync(process.execPath, [join(REPO, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(REPO, 'tsconfig.build.json')], { stdio: 'inherit' });
for (const f of ['schema', join('results', 'group', 'limits.json'), join('src', 'kit', 'presets')]) await cp(join(REPO, f), join(DIST, f), { recursive: true });
console.log(`built ${DIST}`);
