import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';

export default {
  input: 'src/index.ts',
  output: [
    {
      file: 'dist/index.js',
      format: 'esm'
    },
    {
      file: 'dist/index.cjs',
      format: 'cjs'
    }
  ],
  plugins: [
    nodeResolve(),
    commonjs(),
    // Declarations are emitted by `tsc` in the build script instead, so they
    // land in types/ rather than alongside the bundles.
    typescript({
      tsconfig: './tsconfig.json',
      declaration: false,
      outDir: undefined
    })
  ],
  external: [
    'vite',
    'node:crypto',
    'node:fs/promises',
    'node:path'
  ]
};
