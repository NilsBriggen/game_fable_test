import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// Critic probes for the party & save modules — run with
//   npx vitest run --config tools/critic/probes/party-save/vitest.config.ts
export default defineConfig({
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('../../../../src/core', import.meta.url)),
      '@content': fileURLToPath(new URL('../../../../src/content', import.meta.url)),
    },
  },
  test: { include: ['tools/critic/probes/party-save/*.test.ts'], environment: 'node' },
});
