import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const REPO = resolve(import.meta.dirname, '..');
const textOf = (r: any) => r.content.map((c: any) => c.text).join('\n');

describe('MCP server', () => {
  it('lists its tools, builds a persona from example data, shows it, and refuses a run without consent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcp-'));
    const transport = new StdioClientTransport({ command: process.execPath, args: [join(REPO, 'src', 'kit', 'mcp.ts')], cwd: REPO, env: { ...process.env, PERSONAS_DIR: dir, PW_LIVE: '' } as Record<string, string> });
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(transport);
    try {
      const tools = (await client.listTools()).tools.map(t => t.name).sort();
      expect(tools).toEqual(['get_report', 'list_personas', 'new_persona', 'run_persona', 'show_persona', 'validate_persona']);
      const made = await client.callTool({ name: 'new_persona', arguments: {
        name: 'Puzzle Fan', kind: 'person', adult: true, consent: { basis: 'self', confirmed: true },
        sources: [{ type: 'events', path: join(REPO, 'examples/data/events.csv'), map: join(REPO, 'examples/data/events.map.yaml') }] } });
      expect(textOf(made)).toMatch(/first_tap_s\s+3\.2 s/);
      expect(textOf(await client.callTool({ name: 'list_personas', arguments: {} }))).toMatch(/puzzle-fan \(person, v1\)/);
      const refused = await client.callTool({ name: 'new_persona', arguments: { name: 'Kid', kind: 'person', age: 9, sources: [{ type: 'description', text: 'x' }] } });
      expect(refused.isError).toBe(true);
      expect(textOf(refused)).toMatch(/consent/);
    } finally { await client.close(); }
  }, 60000);
});
