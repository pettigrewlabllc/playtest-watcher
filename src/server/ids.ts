const ID = /^[a-z0-9-]{1,80}$/;

export function isValidSessionId(id: string): boolean {
  return ID.test(id);
}

export function newSessionId(parts: string[], now = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  const slug = parts.map(p => p.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).filter(Boolean);
  return [stamp, ...slug].join('-').slice(0, 80);
}

// Claim a session folder exclusively: two runs started in the same second for the same player would otherwise share
// one folder and write over each other (seen 2026-11-01 when two personas both took the letter "P").
export async function claimSessionDir(root: string, id: string): Promise<string> {
  const { mkdir } = await import('node:fs/promises');
  const { join } = await import('node:path');
  await mkdir(root, { recursive: true });
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? id : `${id}-${n}`.slice(0, 80);
    try { await mkdir(join(root, candidate)); return candidate; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || n > 50) throw e; }
  }
}
