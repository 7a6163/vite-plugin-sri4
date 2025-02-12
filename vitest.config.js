import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'test/',
        'rollup.config.mjs',
        'dist/',
        '**/*.d.ts',
        '**/*.config.js',
        'coverage/**'
      ]
    }
  }
});
