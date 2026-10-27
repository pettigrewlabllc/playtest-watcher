import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { usd, type Usage } from './prices.ts';
import { fakeFileId, fakeRespond, fakeSam, fakeTranscribe } from './fake.ts';

export type { Usage };
export type ContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_video'; file_id: string }
  | { type: 'input_audio'; data: string; format: 'wav' };

export interface MetaClient {
  live: boolean;
  uploadFile(path: string, mime: string): Promise<string>;
  deleteFile(id: string): Promise<void>;
  respond<T>(req: { model: string; content: ContentPart[]; schema?: { name: string; schema: object }; maxOutputTokens?: number; kind: string }): Promise<{ data: T; text: string; usage: Usage }>;
  transcribe(wavPath: string, opts?: { keywords?: string[] }): Promise<{ turns: { startMs: number; endMs: number; speaker: string; text: string }[]; audioDurationMs: number }>;
  segmentVideo(fileId: string, prompt: string, opts?: { frames?: number }): Promise<string>;
  spentUsd(): Promise<number>;
}

const BASE = 'https://api.meta.ai/v1';
const RETRIES = 3;

type Opts = { live: boolean; apiKey?: string; budgetUsd: number; spendLog: string; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> };

function refuseContributor(model: string): void {
  if (model.includes('contributor')) throw new Error(`refusing contributor model id: ${model}`);
}

export function createMetaClient(opts: Opts): MetaClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));

  async function spentUsd(): Promise<number> {
    let raw: string;
    try { raw = await readFile(opts.spendLog, 'utf8'); } catch { return 0; }
    let total = 0;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { total += Number(JSON.parse(line).usd) || 0; } catch { /* skip bad line */ }
    }
    return total;
  }

  async function guard(): Promise<void> {
    if (!opts.apiKey) throw new Error('live mode needs MODEL_API_KEY');
    const spent = await spentUsd();
    if (spent >= opts.budgetUsd) throw new Error(`budget reached: $${spent.toFixed(2)} of $${opts.budgetUsd}`);
  }

  async function record(model: string, kind: string, usage: Usage): Promise<void> {
    await mkdir(dirname(opts.spendLog), { recursive: true });
    await appendFile(opts.spendLog, JSON.stringify({ at: new Date().toISOString(), model, kind, usd: usd(model, usage), usage }) + '\n');
  }

  // FormData bodies are rebuilt per attempt, so callers pass a factory.
  async function call(path: string, init: () => RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const i = init();
      const res = await doFetch(BASE + path, { ...i, headers: { ...(i.headers as object), Authorization: `Bearer ${opts.apiKey}` } });
      if (res.ok) return res;
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= RETRIES) throw new Error(`Meta API ${path} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
      await sleep(500 * 2 ** attempt);
    }
  }

  function pickText(body: any): string {
    if (typeof body.output_text === 'string') return body.output_text;
    for (const item of body.output ?? []) {
      for (const c of item.content ?? []) if (typeof c.text === 'string') return c.text;
    }
    return '';
  }

  return {
    live: opts.live,
    spentUsd,

    async uploadFile(path, mime) {
      if (!opts.live) return fakeFileId(path);
      await guard();
      const bytes = await readFile(path);
      const form = () => {
        const f = new FormData();
        f.append('purpose', 'user_data');
        f.append('expires_after[anchor]', 'created_at');
        f.append('expires_after[seconds]', '3600');
        f.append('file', new Blob([bytes], { type: mime }), basename(path));
        return f;
      };
      const res = await call('/files', () => ({ method: 'POST', body: form() }));
      return ((await res.json()) as { id: string }).id;
    },

    async deleteFile(id) {
      if (!opts.live) return;
      await guard();
      await call(`/files/${encodeURIComponent(id)}`, () => ({ method: 'DELETE' }));
    },

    async respond<T>(req: Parameters<MetaClient['respond']>[0]) {
      refuseContributor(req.model);
      if (!opts.live) {
        const f = fakeRespond(req.schema?.name);
        return { data: f.data as T, text: JSON.stringify(f.data), usage: f.usage };
      }
      await guard();
      const body: Record<string, unknown> = {
        model: req.model,
        input: [{ role: 'user', content: req.content }],
        max_output_tokens: Math.max(req.maxOutputTokens ?? 4000, 4000),
      };
      if (req.schema) body.text = { format: { type: 'json_schema', name: req.schema.name, schema: req.schema.schema, strict: true } };
      const res = await call('/responses', () => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
      const json: any = await res.json();
      const usage: Usage = { input_tokens: json.usage?.input_tokens ?? 0, output_tokens: json.usage?.output_tokens ?? 0 };
      await record(req.model, req.kind, usage);
      const text = pickText(json);
      let data: unknown = text;
      if (req.schema) {
        try { data = JSON.parse(text); } catch { throw new Error(`model returned non-JSON for ${req.kind}: ${text.slice(0, 200)}`); }
      }
      return { data: data as T, text, usage };
    },

    async transcribe(wavPath, o) {
      if (!opts.live) return fakeTranscribe();
      await guard();
      const wav = await readFile(wavPath);
      const request = { mode: 'DIARIZATION', model: 'muse-voice-transcribe-1.0', audioEncoding: 'WAV', languageBias: ['en'], keywords: o?.keywords ?? [] };
      const form = () => {
        const f = new FormData();
        f.append('request', new Blob([JSON.stringify(request)], { type: 'application/json' }), 'request.json');
        f.append('audio', new Blob([wav], { type: 'audio/wav' }), basename(wavPath));
        return f;
      };
      const res = await call('/asr/transcribe', () => ({ method: 'POST', body: form() }));
      const json: any = await res.json();
      const audioDurationMs = Number(json.audioDurationMs) || 0;
      await record('muse-voice-transcribe-1.0', 'transcribe', { audio_ms: audioDurationMs });
      const turns = (json.turns ?? []).map((t: any) => ({ startMs: t.startMs, endMs: t.endMs, speaker: String(t.speaker), text: t.transcript }));
      return { turns, audioDurationMs };
    },

    async segmentVideo(fileId, prompt, o) {
      if (!opts.live) return fakeSam(o?.frames ?? 10);
      await guard();
      const body = { model: 'sam-3.1', stream: true, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_video', file_id: fileId }] }] };
      const res = await call('/responses', () => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
      let text = '';
      let sseBuf = '';
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        sseBuf += new TextDecoder().decode(chunk, { stream: true });
        let nl: number;
        while ((nl = sseBuf.indexOf('\n')) >= 0) {
          const line = sseBuf.slice(0, nl).trim();
          sseBuf = sseBuf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const ev = JSON.parse(payload);
            if (ev.type === 'response.output_text.delta' && typeof ev.delta === 'string') text += ev.delta;
          } catch { /* ignore non-JSON keepalives */ }
        }
      }
      const frames = o?.frames ?? (text.match(/<\d+f>/g) ?? []).length;
      await record('sam-3.1', 'segment', { frames });
      return text;
    },
  };
}

function readEnvLocal(rootDir: string): Record<string, string> {
  const file = join(rootDir, '.env.local');
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

export function clientFromEnv(rootDir: string): MetaClient {
  const env = readEnvLocal(rootDir);
  const apiKey = env.MODEL_API_KEY || process.env.MODEL_API_KEY;
  const live = process.env.PW_LIVE === '1' && !!apiKey;
  const budgetUsd = Number(process.env.PW_BUDGET_USD ?? env.PW_BUDGET_USD ?? 120);
  return createMetaClient({ live, apiKey, budgetUsd, spendLog: join(rootDir, 'recordings', 'spend.jsonl') });
}
