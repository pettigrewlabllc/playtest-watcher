// Where the kit keeps what it makes: personas, run folders, the spend log and the model keys. A git checkout keeps
// them in the repo (as it always has); an installed copy keeps them in ~/.playtest-doubles, never inside the
// package. PERSONAS_HOME moves the whole lot, PERSONAS_DIR just the personas.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const PACKAGE = resolve(import.meta.dirname, '..', '..');

export function kitPaths() {
  const home = process.env.PERSONAS_HOME ? resolve(process.env.PERSONAS_HOME)
    : existsSync(join(PACKAGE, '.git')) ? PACKAGE : join(homedir(), '.playtest-doubles');
  return {
    home,
    personas: resolve(process.env.PERSONAS_DIR || join(home, 'personas')),   // <slug>/persona.json, <slug>/versions/
    runs: join(home, 'recordings'),                                          // one folder per run, plus players/
    env: join(home, '.env.local'),                                           // model keys, never committed
    spend: join(home, 'recordings', 'spend.jsonl'),
  };
}
