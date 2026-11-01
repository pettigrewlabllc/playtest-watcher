// Writes docs/persona-norms.md from src/persona/norms.ts, so the doc always matches the numbers the harness uses.
//   npm run norms-doc
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { NORMS, reactionMs, timingSdMs, tapMiss, readingWpm, msPerChar } from '../src/persona/norms.ts';

const conf = { V: 'read in the source itself', A: 'abstract only', M: 'measured in this project', X: 'no credible source; an assumption' };
const ages = [6, 8, 10, 12, 14, 16, null];
const row = (a: number | null) => `| ${a ?? 'adult'} | ${reactionMs(a).ms} | ${timingSdMs(a)} | ${Math.round(tapMiss(a).rate * 100)}% | ${readingWpm(a).wpm} | ${Math.round(msPerChar(readingWpm(a).wpm))} |`;
const md = [
  '# Persona norms: where the defaults come from',
  '',
  'Generated from `src/persona/norms.ts` by `npm run norms-doc`. Do not edit by hand.',
  '',
  'A persona\'s own measured numbers always win. These published norms only fill gaps (a described persona, or a',
  'person with no recording of a fast game), and every run that leans on one says so in its log.',
  '',
  '## Defaults by age',
  '',
  '| Age | Reaction (ms) | Timing spread (ms) | Tap miss | Reading (wpm) | Reading (ms/char) |',
  '|---|---|---|---|---|---|',
  ...ages.map(row),
  '',
  'Ages under 10 extrapolate the reaction-time slope below the youngest age measured, and under 7 reuse the',
  'touch value for 7-10. Both are labelled that way in run logs.',
  '',
  '## Each norm and its sources',
  '',
  ...NORMS.flatMap(n => [
    `### ${n.what} (\`${n.id}\`)`, '',
    `Used by: ${n.usedBy}.`, '',
    n.values, '',
    ...(n.note ? [n.note, ''] : []),
    ...n.sources.map(s => `- ${s.cite} [${conf[s.confidence]}] ${s.url}${s.quote ? ` ("${s.quote}")` : ''}`), '',
  ]),
  '## Left out on purpose',
  '',
  '- "300 words a minute" as the average adult reading speed: unsupported (Brysbaert 2019 finds 238).',
  '- "2-3 minutes of attention per year of age": no primary source found anywhere.',
  '- Any number of fails before a child or adult quits: none published; ours is a labelled assumption.',
  '',
].join('\n');
await writeFile(fileURLToPath(new URL('../docs/persona-norms.md', import.meta.url)), md);
console.log('docs/persona-norms.md');
