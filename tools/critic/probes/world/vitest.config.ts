import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// Critic probes for the world module (round 2) — run with
//   npx vitest run --config tools/critic/probes/world/vitest.config.ts
export default defineConfig({
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('../../../../src/core', import.meta.url)),
      '@content': fileURLToPath(new URL('../../../../src/content', import.meta.url)),
    },
  },
  test: { include: ['tools/critic/probes/world/*.test.ts'], environment: 'node', testTimeout: 120000, hookTimeout: 120000 },
});
