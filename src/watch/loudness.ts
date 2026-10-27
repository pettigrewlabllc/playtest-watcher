import { readFile } from 'node:fs/promises';

export function rmsWindows(pcm: Int16Array, sampleRate: number, windowMs: number): number[] {
  const size = Math.max(1, Math.round((sampleRate * windowMs) / 1000));
  const out: number[] = [];
  for (let i = 0; i < pcm.length; i += size) {
    const end = Math.min(i + size, pcm.length);
    let sum = 0;
    for (let j = i; j < end; j++) sum += pcm[j] * pcm[j];
    out.push(Math.sqrt(sum / (end - i)) / 32768);
  }
  return out;
}

// Walks the RIFF chunks (ffmpeg may put a LIST chunk before data) and returns the 16-bit samples.
export async function readWavPcm(file: string): Promise<{ pcm: Int16Array; sampleRate: number }> {
  const buf = await readFile(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`not a wav: ${file}`);
  let pos = 12;
  let sampleRate = 16000;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    let len = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') sampleRate = buf.readUInt32LE(pos + 12);
    if (id === 'data') {
      if (pos + 8 + len > buf.length) len = buf.length - pos - 8;
      const bytes = buf.subarray(pos + 8, pos + 8 + (len & ~1));
      const copy = new Uint8Array(bytes);
      return { pcm: new Int16Array(copy.buffer, 0, copy.length / 2), sampleRate };
    }
    pos += 8 + len + (len & 1);
  }
  throw new Error(`no data chunk: ${file}`);
}
