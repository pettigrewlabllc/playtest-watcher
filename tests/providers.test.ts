import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { anthropicBody, createProviderClient, geminiBody } from '../src/meta/providers.ts';
import { clientFromEnv } from '../src/meta/client.ts';

const shot = 'data:image/jpeg;base64,AAAA';
const req = { model: 'claude-opus-5-5', maxOutputTokens: 8000, schema: { name: 'plan', schema: { type: 'object', properties: { tap: { type: 'string' } }, required: ['tap'], additionalProperties: false } },
  content: [{ type: 'input_text' as const, text: 'what next?' }, { type: 'input_image' as const, image_url: shot }] };

describe('other model providers', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('turns a respond() request into Anthropic and Gemini requests', () => {
    const a = anthropicBody(req);
    expect(a.messages[0].content[1]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } });
    expect(a.output_config!.format.schema).toEqual(req.schema.schema);
    expect(a).toMatchObject({ max_tokens: 8000, fallbacks: 'default' });
    expect(anthropicBody({ ...req, model: 'claude-haiku-5-5' })).not.toHaveProperty('fallbacks');
    const g = geminiBody({ ...req, model: 'gemini-3-flash-preview' });
    expect(g.contents[0].parts[1]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } });
    expect(g.config).toMatchObject({ responseMimeType: 'application/json', responseJsonSchema: req.schema.schema, maxOutputTokens: 8000 });
    expect(() => anthropicBody({ ...req, content: [{ type: 'input_video', file_id: 'f' } as never] })).toThrow(/needs Meta/);
  });

  it('logs spend, parses JSON, stops at the budget, and leaves recordings to Meta', async () => {
    const spendLog = join(await mkdtemp(join(tmpdir(), 'prov-')), 'spend.jsonl');
    const c = createProviderClient({ provider: 'anthropic', apiKey: 'x', budgetUsd: 0.05, spendLog, send: async () => ({ text: '{"tap":"Start"}', usage: { input_tokens: 10000, output_tokens: 1000 } }) });
    const r = await c.respond<{ tap: string }>({ model: 'muse-spark-1.2', kind: 'play:t', ...req });
    expect(r.data.tap).toBe('Start');
    const line = JSON.parse((await readFile(spendLog, 'utf8')).trim());
    expect(line).toMatchObject({ model: 'claude-opus-5-5', kind: 'play:t' });
    expect(line.usd).toBeCloseTo(0.06);                 // 10k in at $4/M, 1k out at $20/M
    await expect(c.respond({ model: 'muse-spark-1.2', kind: 'play:t', ...req })).rejects.toThrow(/budget reached/);
    await expect(c.uploadFile('x.mp4', 'video/mp4')).rejects.toThrow(/needs Meta/);
    expect(() => createProviderClient({ provider: 'gemini', apiKey: 'x', model: 'gemini-9', budgetUsd: 1, spendLog })).toThrow(/PW_PRICE_IN/);
  });

  it('picks the provider from the key that is there, Meta first', async () => {
    const root = await mkdtemp(join(tmpdir(), 'prov-'));
    for (const k of ['MODEL_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'PW_PROVIDER', 'PW_MODEL']) delete process.env[k];
    process.env.PW_LIVE = '1';
    await writeFile(join(root, '.env.local'), 'ANTHROPIC_API_KEY=test\n');
    await expect(clientFromEnv(root).uploadFile('x', 'y')).rejects.toThrow(/anthropic only builds/);
    await writeFile(join(root, '.env.local'), 'ANTHROPIC_API_KEY=test\nMODEL_API_KEY=test\n');
    expect(clientFromEnv(root).live).toBe(true);
    await expect(clientFromEnv(root).uploadFile(join(root, 'missing.mp4'), 'video/mp4')).rejects.not.toThrow(/only builds/);
    process.env.PW_PROVIDER = 'gemini';
    expect(() => clientFromEnv(root)).toThrow(/PW_PROVIDER=gemini but there's no GEMINI_API_KEY/);   // a live run never silently goes fake
    process.env.PW_LIVE = '';
    expect(clientFromEnv(root).live).toBe(false);
  });
});
