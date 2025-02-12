import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    reporters: ['junit'],
    outputFile: './test-report.junit.xml',
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
