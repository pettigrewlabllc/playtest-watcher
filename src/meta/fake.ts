import { basename } from 'node:path';
import type { Usage } from './prices.ts';

export function fakeRespond(schemaName: string | undefined): { data: unknown; usage: Usage } {
  const usage = { input_tokens: 1000, output_tokens: 200 };
  if (schemaName === 'moment') {
    return {
      usage,
      data: {
        label: 'confused', confidence: 0.5,
        evidence: { face: 'fake: brow furrowed', voice: 'fake: quiet', hands: 'fake: hovering', screen: 'fake: no change' },
        game_context: '', fix_hint: '',
      },
    };
  }
  if (schemaName === 'fixes') {
    return {
      usage,
      data: { fixes: [{ title: 'Fake fix', why: 'Fake reason', evidence_moment_ids: [], severity: 'medium', suggestion: 'Fake suggestion' }] },
    };
  }
  return { usage, data: {} };
}

export function fakeTranscribe(): { turns: { startMs: number; endMs: number; speaker: string; text: string }[]; audioDurationMs: number } {
  return {
    audioDurationMs: 10_000,
    turns: [
      { startMs: 1000, endMs: 4000, speaker: 'A', text: 'fake: wait, what does this do?' },
      { startMs: 5000, endMs: 6000, speaker: 'B', text: 'fake: try tapping it' },
    ],
  };
}

export function fakeFileId(path: string): string {
  return `fake-file-${basename(path)}`;
}

// Mask payload copied from the @meta-sam/parser README example (a real API sample); the parser rejects a box without a mask.
const SAMPLE_MASK = "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>";

// One face box per frame, drifting right. Same line format the real API emits.
export function fakeSam(frames: number): string {
  const lines: string[] = [];
  for (let f = 0; f < frames; f++) {
    const x = 40 + f;
    lines.push(`<${f}f>0<|box;x1=${x};y1=30;x2=${x + 59};y2=99;w=320;h=240|>${SAMPLE_MASK}`);
  }
  return lines.join('\n') + '\n';
}
