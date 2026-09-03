import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// Critic probes for the quest & dialogue module — run with
//   npx vitest run --config tools/critic/probes/quest/vitest.config.ts
export default defineConfig({
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('../../../../src/core', import.meta.url)),
      '@content': fileURLToPath(new URL('../../../../src/content', import.meta.url)),
    },
  },
  test: { include: ['tools/critic/probes/quest/*.test.ts'], environment: 'node' },
});
