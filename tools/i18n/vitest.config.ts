import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('../../src/core', import.meta.url)),
      '@content': fileURLToPath(new URL('../../src/content', import.meta.url)),
    },
  },
  test: { include: ['tools/i18n/extract.test.ts', 'tools/i18n/check.test.ts'], environment: 'node' },
});
