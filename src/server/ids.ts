const ID = /^[a-z0-9-]{1,80}$/;

export function isValidSessionId(id: string): boolean {
  return ID.test(id);
}

export function newSessionId(parts: string[], now = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  const slug = parts.map(p => p.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).filter(Boolean);
  return [stamp, ...slug].join('-').slice(0, 80);
}
