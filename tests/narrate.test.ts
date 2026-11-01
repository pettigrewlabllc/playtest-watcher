import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseScript, saveTake, narrationData, takePath } from '../src/server/narrate.ts';

const MD = `# Script

intro text that is not a beat

---

## Situation

**[0:00, two runs side by side]**

First line. / After a pause.

**[0:10, title screens]**

Second beat.

Second paragraph.

## Result

**[2:48, end card]**

Last one.

---

## Truth sheet

| a | b |
`;

describe('narration', () => {
  it('splits the script into beats with sections and target lengths', () => {
    const b = parseScript(MD, 180);
    expect(b.map(x => [x.id, x.at, x.section, x.target])).toEqual([['b01', 0, 'Situation', 10], ['b02', 10, 'Situation', 158], ['b03', 168, 'Result', 12]]);
    expect(b[0].text).toBe('First line. / After a pause.');
    expect(b[1].text).toBe('Second beat.\n\nSecond paragraph.');
    expect(b[2].text).toBe('Last one.');
  });

  it('parses the real script', async () => {
    const b = parseScript(await readFile(join(import.meta.dirname, '..', 'docs', 'video', 'script.md'), 'utf8'));
    expect(b.length).toBeGreaterThan(8);
    expect(b.every(x => x.text && x.target > 0)).toBe(true);
  });

  it('saves a take, keeps the previous one as a backup, and refuses bad input', async () => {
    const root = await mkdtemp(join(tmpdir(), 'narr-'));
    const t1 = await saveTake(root, 'b01', 'audio/webm;codecs=opus', 4200, Buffer.from('one'));
    expect(t1.file).toBe('b01.webm');
    await saveTake(root, 'b01', 'audio/webm', 3900, Buffer.from('two'));
    expect(await readFile(join(root, 'video', 'narration', 'b01.webm'), 'utf8')).toBe('two');
    expect(existsSync(join(root, 'video', 'narration', 'b01.prev.webm'))).toBe(true);
    await expect(saveTake(root, '../x', 'audio/webm', 1, Buffer.from('x'))).rejects.toThrow(/bad beat/);
    await expect(saveTake(root, 'b02', 'text/html', 1, Buffer.from('x'))).rejects.toThrow(/bad audio/);
    await expect(saveTake(root, 'b02', 'audio/webm', 1, Buffer.alloc(0))).rejects.toThrow(/empty/);
    expect(() => takePath(root, '../takes.json')).toThrow();
  });

  it('marks which beats have a take', async () => {
    const base = await mkdtemp(join(tmpdir(), 'narr-'));
    const root = join(base, 'recordings');
    await mkdir(join(base, 'docs', 'video'), { recursive: true });
    await writeFile(join(base, 'docs', 'video', 'script.md'), MD);
    await saveTake(root, 'b02', 'audio/mp4', 9000, Buffer.from('a'));
    const d = await narrationData(root);
    expect(d.beats.map(b => b.take?.file ?? null)).toEqual([null, 'b02.m4a', null]);
  });
});
