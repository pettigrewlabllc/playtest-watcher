import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';

const PORT = Number(process.env.PORT ?? 3058);
const root = fileURLToPath(new URL('../../recordings/', import.meta.url));
createApp(root).listen(PORT, '0.0.0.0', () => console.log(`playtest-watcher on http://localhost:${PORT}`));
