import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Stryker copies the whole project, tests included, into its sandbox.
    // Without this, a mutation run globs those copies and tests itself.
    exclude: ['**/node_modules/**', '**/dist/**', '.stryker-tmp/**'],
    reporters: ['default', 'junit'],
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
      ],
      reportsDirectory: './coverage',
      // Every line and branch in src/ is reachable from a test. Enforced so a
      // new uncovered path fails CI instead of quietly lowering the number.
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100
      }
    }
  }
});
