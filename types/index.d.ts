import type { Plugin } from 'vite';
import type { SriOptions } from './types.js';
export type { SriHashAlgorithm, SriOptions } from './types.js';
declare function sri(options?: SriOptions): Plugin;
export default sri;
export { sri };
