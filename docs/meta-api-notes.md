# Meta Model API notes (read from dev.meta.ai/docs, 2026-10-27)

Base URL `https://api.meta.ai/v1`. Auth: `Authorization: Bearer $MODEL_API_KEY`. The key lives in `.env.local` as `MODEL_API_KEY` (gitignored).

## Responses API (`POST /responses`)

```json
{
  "model": "muse-spark-1.2",
  "input": [{ "role": "user", "content": [
    { "type": "input_text", "text": "..." },
    { "type": "input_video", "file_id": "file-abc" }
  ]}],
  "text": { "format": { "type": "json_schema", "name": "moment", "schema": { }, "strict": true } },
  "max_output_tokens": 4000
}
```

- Video: `input_video` with `file_id` (uploaded) or `video_url` (public URL or base64 data URL, inline max 50 MB). **MP4 only.** Embedded audio is heard by the model.
- Audio inline: `input_audio` with `data` (base64) and `format: "wav"`.
- Use `muse-spark-1.2` when audio matters. 1.3's audio is documented as degraded.
- Set `max_output_tokens` ≥ 4000, or output can come back empty with a length stop.
- The `text.format` body shape is not shown on the docs page. Assume the OpenAI Responses shape above, and verify on the first live call. Fallback: Chat Completions `POST /chat/completions` with `response_format: { type: "json_schema", json_schema: { name, schema, strict } }`, output in `choices[0].message.content`.
- Never use a `-contributor` model id (trains on our content).

## Files (`POST /files`, `DELETE /files/{id}`)

Multipart: `purpose=user_data`, optional `expires_after[anchor]=created_at` and `expires_after[seconds]` (3600 to 2592000), then `file` last. Max 1 GiB. Files never expire by default, so always set `expires_after[seconds]=3600` and delete after use. Team cap 100 GiB.

## Speech to text (`POST /asr/transcribe`)

Multipart: `request` part (JSON, `application/json`): `{"mode":"DIARIZATION","model":"muse-voice-transcribe-1.0","audioEncoding":"WAV","languageBias":["en"],"keywords":[...]}`, and `audio` part (WAV). Audio must be mono 16-bit PCM at 16 kHz or 24 kHz, **max 10 minutes and 32 MB**. Response: `{ sessionId, transcript, audioDurationMs, turns: [{ turnId, startMs, endMs, transcript, speaker }] }`. Speakers are `A`, `B`... per request, so labels don't carry across chunks. Turn-level timestamps only.

## SAM 3.1 (`POST /responses`, `model: "sam-3.1"`)

User message with `input_text` (a short noun phrase, e.g. `face`) and `input_video` (`file_id`). `stream: true`. Each frame arrives as a `response.output_text.delta` event, with lines starting `<Nf>` (frame) then object ordinal, box `x1 y1 x2 y2` plus `w h`, and a mask (default `lossless` `~`, or `metadata.mask_encoding: "one_bit"` `!`). Parse with the npm package `@meta-sam/parser` ≥ 0.0.13. Video: MP4 or MOV, H.264/H.265/MPEG-4, **no WebM**, max 15,000 frames, up to 16 objects per frame. Billed per frame, minimum 50.

## Prices (standard mode)

| Model | Input / 1M | Cached / 1M | Output / 1M | Other |
|---|---|---|---|---|
| muse-spark-1.2 / 1.3 | $1.25 | $0.15 | $4.25 | |
| muse-wonder-1.0 | $4.00 | $0.20 | $20.00 | |
| muse-voice-transcribe-1.0 | | | | $0.18 per audio hour |
| sam-3.1 | | | | $0.20 per 1,000 video frames |

How video turns into tokens is not documented. The first live call measures it from the response's `usage`.

Rate limits are 3,000 requests per minute per team for Spark, Wonder and SAM, far above what we need.
