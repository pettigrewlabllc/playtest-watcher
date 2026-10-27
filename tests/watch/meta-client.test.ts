import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMetaClient } from '../../src/meta/client.ts';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'pw-meta-')); });

const noFetch = (() => { throw new Error('network call in fake mode'); }) as unknown as typeof fetch;
const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const content = [{ type: 'input_text' as const, text: 'hi' }];

describe('meta client', () => {
  it('refuses contributor model ids before any fetch', async () => {
    const c = createMetaClient({ live: true, apiKey: 'k', budgetUsd: 10, spendLog: join(dir, 's.jsonl'), fetchImpl: noFetch });
    await expect(c.respond({ model: 'muse-spark-1.2-contributor', content, kind: 'x' })).rejects.toThrow(/contributor/);
  });

  it('fake mode never fetches and returns schema-shaped data', async () => {
    const c = createMetaClient({ live: false, budgetUsd: 10, spendLog: join(dir, 's.jsonl'), fetchImpl: noFetch });
    const m = await c.respond<any>({ model: 'muse-spark-1.2', content, schema: { name: 'moment', schema: {} }, kind: 'explain' });
    expect(m.data).toMatchObject({ label: 'confused', confidence: 0.5, game_context: '', fix_hint: '' });
    expect(Object.keys(m.data.evidence)).toEqual(['face', 'voice', 'hands', 'screen']);
    const f = await c.respond<any>({ model: 'muse-wonder-1.0', content, schema: { name: 'fixes', schema: {} }, kind: 'fixes' });
    expect(Array.isArray(f.data.fixes)).toBe(true);
    expect((await c.transcribe('x.wav')).turns).toHaveLength(2);
    expect(await c.uploadFile('/a/b.mp4', 'video/mp4')).toMatch(/^fake-file/);
    expect(await c.spentUsd()).toBe(0);
  });

  it('live respond posts the documented body and parses output_text', async () => {
    let seen: any;
    const fetchImpl = (async (url: string, init: any) => {
      seen = { url, init, body: JSON.parse(init.body) };
      return json({ output_text: '{"label":"stuck"}', usage: { input_tokens: 10, output_tokens: 5 } });
    }) as unknown as typeof fetch;
    const c = createMetaClient({ live: true, apiKey: 'k', budgetUsd: 10, spendLog: join(dir, 's.jsonl'), fetchImpl });
    const r = await c.respond<{ label: string }>({ model: 'muse-spark-1.2', content, schema: { name: 'moment', schema: { type: 'object' } }, maxOutputTokens: 100, kind: 'explain' });
    expect(r.data.label).toBe('stuck');
    expect(seen.url).toBe('https://api.meta.ai/v1/responses');
    expect(seen.init.headers.Authorization).toBe('Bearer k');
    expect(seen.body.model).toBe('muse-spark-1.2');
    expect(seen.body.input[0].content).toEqual(content);
    expect(seen.body.text.format.type).toBe('json_schema');
    expect(seen.body.max_output_tokens).toBeGreaterThanOrEqual(4000);
  });

  it('also reads output[].content[].text', async () => {
    const fetchImpl = (async () => json({ output: [{ content: [{ type: 'output_text', text: '{"a":1}' }] }] })) as unknown as typeof fetch;
    const c = createMetaClient({ live: true, apiKey: 'k', budgetUsd: 10, spendLog: join(dir, 's.jsonl'), fetchImpl });
    const r = await c.respond<{ a: number }>({ model: 'muse-wonder-1.0', content, schema: { name: 'x', schema: {} }, kind: 'k' });
    expect(r.data.a).toBe(1);
  });

  it('live transcribe posts a multipart request part and maps turns', async () => {
    const wav = join(dir, 'a.wav');
    await writeFile(wav, Buffer.from('RIFF'));
    let form: FormData | undefined;
    const fetchImpl = (async (url: string, init: any) => {
      form = init.body;
      return json({ audioDurationMs: 7200, turns: [{ startMs: 0, endMs: 900, speaker: 'A', transcript: 'hello' }] });
    }) as unknown as typeof fetch;
    const c = createMetaClient({ live: true, apiKey: 'k', budgetUsd: 10, spendLog: join(dir, 's.jsonl'), fetchImpl });
    const r = await c.transcribe(wav, { keywords: ['molecule'] });
    expect(r.turns).toEqual([{ startMs: 0, endMs: 900, speaker: 'A', text: 'hello' }]);
    const req = JSON.parse(await (form!.get('request') as Blob).text());
    expect(req).toMatchObject({ mode: 'DIARIZATION', model: 'muse-voice-transcribe-1.0', keywords: ['molecule'] });
    expect(form!.get('audio')).toBeTruthy();
  });

  it('live upload sends purpose and expiry before the file', async () => {
    const f = join(dir, 'c.mp4');
    await writeFile(f, 'x');
    let form: FormData | undefined;
    const fetchImpl = (async (_u: string, init: any) => { form = init.body; return json({ id: 'file-1' }); }) as unknown as typeof fetch;
    const c = createMetaClient({ live: true, apiKey: 'k', budgetUsd: 10, spendLog: join(dir, 's.jsonl'), fetchImpl });
    expect(await c.uploadFile(f, 'video/mp4')).toBe('file-1');
    const keys = [...form!.keys()];
    expect(form!.get('purpose')).toBe('user_data');
    expect(form!.get('expires_after[seconds]')).toBe('3600');
    expect(keys.at(-1)).toBe('file');
    expect(keys.indexOf('expires_after[seconds]')).toBeLessThan(keys.indexOf('file'));
  });

  it('logs spend and refuses once the budget is reached', async () => {
    const spendLog = join(dir, 'spend.jsonl');
    let calls = 0;
    const fetchImpl = (async () => { calls++; return json({ output_text: '{}', usage: { input_tokens: 1e6, output_tokens: 0 } }); }) as unknown as typeof fetch;
    const c = createMetaClient({ live: true, apiKey: 'k', budgetUsd: 1, spendLog, fetchImpl });
    await c.respond({ model: 'muse-spark-1.2', content, schema: { name: 'x', schema: {} }, kind: 'explain' });
    const line = JSON.parse((await readFile(spendLog, 'utf8')).trim());
    expect(line.usd).toBeCloseTo(1.25);
    expect(line).toMatchObject({ model: 'muse-spark-1.2', kind: 'explain' });
    await expect(c.respond({ model: 'muse-spark-1.2', content, kind: 'explain' })).rejects.toThrow(/budget/);
    expect(calls).toBe(1);
  });

  it('retries 429 and 5xx three times with backoff, then throws', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const fetchImpl = (async () => { calls++; return new Response('busy', { status: calls === 1 ? 429 : 503 }); }) as unknown as typeof fetch;
    const c = createMetaClient({ live: true, apiKey: 'k', budgetUsd: 10, spendLog: join(dir, 's.jsonl'), fetchImpl, sleep: async ms => { sleeps.push(ms); } });
    await expect(c.respond({ model: 'muse-spark-1.2', content, kind: 'x' })).rejects.toThrow(/503/);
    expect(calls).toBe(4);
    expect(sleeps).toHaveLength(3);
    expect(sleeps[1]).toBeGreaterThan(sleeps[0]);
  });

  it('does not retry a 400', async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls++; return new Response('bad', { status: 400 }); }) as unknown as typeof fetch;
    const c = createMetaClient({ live: true, apiKey: 'k', budgetUsd: 10, spendLog: join(dir, 's.jsonl'), fetchImpl, sleep: async () => {} });
    await expect(c.respond({ model: 'muse-spark-1.2', content, kind: 'x' })).rejects.toThrow(/400/);
    expect(calls).toBe(1);
  });
});
