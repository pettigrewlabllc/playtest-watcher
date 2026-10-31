import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const exec = promisify(execFile);
// FFMPEG_PATH, else Homebrew's copy on Apple Silicon, else whatever `ffmpeg` is on PATH.
const pick = (env: string | undefined, brew: string, name: string) => env ?? (existsSync(brew) ? brew : name);
const FFMPEG = pick(process.env.FFMPEG_PATH, '/opt/homebrew/bin/ffmpeg', 'ffmpeg');
const FFPROBE = pick(process.env.FFPROBE_PATH, '/opt/homebrew/bin/ffprobe', 'ffprobe');

export async function run(args: string[]): Promise<void> {
  try {
    await exec(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { maxBuffer: 16 * 1024 * 1024 });
  } catch (e: any) {
    throw new Error(`ffmpeg failed: ${String(e.stderr ?? e.message).slice(0, 500)}`);
  }
}

async function probe(file: string, args: string[]): Promise<string> {
  const { stdout } = await exec(FFPROBE, ['-v', 'error', ...args, file]);
  return stdout.trim();
}

export async function probeDurationMs(file: string): Promise<number> {
  const out = await probe(file, ['-show_entries', 'format=duration', '-of', 'csv=p=0']);
  const sec = Number(out);
  return Number.isFinite(sec) ? Math.round(sec * 1000) : 0;
}

export async function probeSize(file: string): Promise<{ width: number; height: number }> {
  const out = await probe(file, ['-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x']);
  const [w, h] = out.split('x').map(Number);
  return { width: w, height: h };
}

export async function hasStream(file: string, kind: 'v' | 'a'): Promise<boolean> {
  return (await probe(file, ['-select_streams', kind, '-show_entries', 'stream=codec_type', '-of', 'csv=p=0'])).length > 0;
}
