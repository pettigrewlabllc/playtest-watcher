import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH ?? '/opt/homebrew/bin/ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH ?? '/opt/homebrew/bin/ffprobe';

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
