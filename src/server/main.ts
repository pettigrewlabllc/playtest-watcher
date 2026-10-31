import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';

const PORT = Number(process.env.PORT ?? 3058);
const root = fileURLToPath(new URL('../../recordings/', import.meta.url));
// '::' takes IPv6 and IPv4 together. On 2026-10-31 another server bound only the IPv6 side of this port, so
// `localhost` reached it instead and game events were silently dropped; holding both makes that fail loudly.
const server = createApp(root).listen(PORT, '::', () => console.log(`playtest-watcher on http://localhost:${PORT}`));
server.on('error', e => { console.error(`playtest-watcher could not start on ${PORT}: ${(e as Error).message}`); process.exit(1); });
