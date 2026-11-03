// Other model providers behind the same respond(): Anthropic (Claude) and Google (Gemini). Building and running a
// persona only needs respond() with text and screenshots in and JSON out, so that is all these do. Watching a
// recording (video, audio, SAM) stays on Meta's models and says so if asked.
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { priceFor, usd, type Usage } from './prices.ts';
import type { ContentPart, MetaClient } from './client.ts';

export type Provider = 'meta' | 'anthropic' | 'gemini';
export const DEFAULT_MODEL: Record<Exclude<Provider, 'meta'>, string> = { anthropic: 'claude-opus-5-5', gemini: 'gemini-3-flash-preview' };
// Models that take the server-side refusal fallback (a declined request re-runs on a model that will answer).
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

export type ProviderRequest = { model: string; content: ContentPart[]; schema?: { name: string; schema: object }; maxOutputTokens: number };
export type Send = (req: ProviderRequest) => Promise<{ text: string; usage: Usage }>;

const image = (url: string) => {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(url);
  if (!m) throw new Error('only data: URL images are supported for this provider');
  return { mime: m[1], data: m[2] };
};
const unsupported = (part: ContentPart) => new Error(`${part.type} needs Meta's models (MODEL_API_KEY): this provider only reads text and images`);

// ---- request shapes, pure so they can be tested without a key -------------------------------------------------
export function anthropicBody(r: ProviderRequest) {
  const content = r.content.map(p => {
    if (p.type === 'input_text') return { type: 'text' as const, text: p.text };
    if (p.type === 'input_image') { const i = image(p.image_url); return { type: 'image' as const, source: { type: 'base64' as const, media_type: i.mime as 'image/jpeg', data: i.data } }; }
    throw unsupported(p);
  });
  return {
    model: r.model, max_tokens: r.maxOutputTokens, messages: [{ role: 'user' as const, content }],
    ...(r.schema ? { output_config: { format: { type: 'json_schema' as const, schema: r.schema.schema as Record<string, unknown> } } } : {}),
    ...(FALLBACK_MODELS.has(r.model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
  };
}
export function geminiBody(r: ProviderRequest) {
  const parts = r.content.map(p => {
    if (p.type === 'input_text') return { text: p.text };
    if (p.type === 'input_image') { const i = image(p.image_url); return { inlineData: { mimeType: i.mime, data: i.data } }; }
    throw unsupported(p);
  });
  return {
    model: r.model, contents: [{ role: 'user', parts }],
    config: { maxOutputTokens: r.maxOutputTokens, ...(r.schema ? { responseMimeType: 'application/json', responseJsonSchema: r.schema.schema } : {}) },
  };
}

function anthropicSend(apiKey: string): Send {
  const client = new Anthropic({ apiKey });
  return async (r) => {
    const res = await client.beta.messages.create(anthropicBody(r) as Parameters<typeof client.beta.messages.create>[0]) as Anthropic.Beta.BetaMessage;
    if (res.stop_reason === 'refusal') throw new Error(`${r.model} declined the request${res.stop_details && 'category' in res.stop_details && res.stop_details.category ? ` (${res.stop_details.category})` : ''}`);
    if (res.stop_reason === 'max_tokens') throw new Error(`${r.model} ran out of output tokens at ${r.maxOutputTokens}`);
    const text = res.content.map(b => (b.type === 'text' ? b.text : '')).join('');
    return { text, usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens } };
  };
}
function geminiSend(apiKey: string): Send {
  const ai = new GoogleGenAI({ apiKey });
  return async (r) => {
    const res = await ai.models.generateContent(geminiBody(r));
    const text = res.text ?? '';
    if (!text) throw new Error(`${r.model} returned no text (${res.candidates?.[0]?.finishReason ?? 'no candidate'})`);
    return { text, usage: { input_tokens: res.usageMetadata?.promptTokenCount ?? 0, output_tokens: (res.usageMetadata?.candidatesTokenCount ?? 0) + (res.usageMetadata?.thoughtsTokenCount ?? 0) } };
  };
}

// A live client for Anthropic or Gemini, with the same budget stop and spend log as the Meta client.
export function createProviderClient(o: { provider: 'anthropic' | 'gemini'; apiKey: string; model?: string; budgetUsd: number; spendLog: string; send?: Send }): MetaClient {
  const model = o.model || DEFAULT_MODEL[o.provider];
  priceFor(model);   // fail now, not after the first paid call, if there's no price to keep the budget with
  const send = o.send ?? (o.provider === 'anthropic' ? anthropicSend(o.apiKey) : geminiSend(o.apiKey));
  async function spentUsd() {
    let total = 0;
    try { for (const l of (await readFile(o.spendLog, 'utf8')).split('\n')) if (l.trim()) try { total += Number(JSON.parse(l).usd) || 0; } catch { /* skip */ } } catch { /* no log yet */ }
    return total;
  }
  const metaOnly = (what: string) => async () => { throw new Error(`${what} needs Meta's models (MODEL_API_KEY); ${o.provider} only builds and runs personas`); };
  return {
    live: true,
    spentUsd,
    uploadFile: metaOnly('uploading a recording'), deleteFile: metaOnly('deleting an upload'),
    transcribe: metaOnly('transcribing'), segmentVideo: metaOnly('video segmentation'),
    async respond<T>(req: { model: string; content: ContentPart[]; schema?: { name: string; schema: object }; maxOutputTokens?: number; kind: string }) {
      const spent = await spentUsd();
      if (spent >= o.budgetUsd) throw new Error(`budget reached: $${spent.toFixed(2)} of $${o.budgetUsd}`);
      const { text, usage } = await send({ model, content: req.content, schema: req.schema, maxOutputTokens: req.maxOutputTokens ?? 4000 });
      await mkdir(dirname(o.spendLog), { recursive: true });
      await appendFile(o.spendLog, JSON.stringify({ at: new Date().toISOString(), model, kind: req.kind, usd: usd(model, usage), usage }) + '\n');
      let data: T;
      try { data = (req.schema ? JSON.parse(text) : text) as T; } catch { throw new Error(`${model} answered with something that isn't JSON: ${text.slice(0, 120)}`); }
      return { data, text, usage };
    },
  };
}
