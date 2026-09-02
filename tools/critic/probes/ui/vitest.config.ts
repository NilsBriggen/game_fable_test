import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// Critic probes for the UI module's pure helpers — run with
//   npx vitest run --config tools/critic/probes/ui/vitest.config.ts
export default defineConfig({
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('../../../../src/core', import.meta.url)),
      '@content': fileURLToPath(new URL('../../../../src/content', import.meta.url)),
    },
  },
  test: { include: ['tools/critic/probes/ui/*.test.ts'], environment: 'node' },
});
