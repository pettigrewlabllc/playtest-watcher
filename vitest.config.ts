import { defineConfig } from 'vitest/config';

// recordings/ holds copied game sources with their own node:test files; never collect those.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } });
