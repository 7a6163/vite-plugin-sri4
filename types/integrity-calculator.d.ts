import type { ResolvedConfig, Rollup } from 'vite';
import type { CacheManager } from './cache.js';
import type { Logger } from './logger.js';
import type { BundleItem, SriHashAlgorithm, TransformOptions } from './types.js';
/**
 * Read the hashable source out of a bundle entry (chunk code or asset source)
 */
export declare function bundleSource(item: BundleItem): string | Uint8Array;
/**
 * Compute an SRI string for a source that may be a string, Buffer or Uint8Array
 */
export declare function sriHash(source: string | Uint8Array, hashAlgorithm: SriHashAlgorithm): string;
/**
 * Find a bundle key for a URL that did not match exactly.
 *
 * Matching is anchored on a path separator so `main.js` can never match
 * `assets/vendor-main.js` - a cross-filename match would inject a valid-looking
 * but wrong hash, which the browser rejects with no build-time error.
 */
export declare function findBundleKey(bundle: Rollup.OutputBundle, bundleKey: string, logger: Logger): string | undefined;
/**
 * Calculate SRI integrity hash for a given resource
 */
export declare function calculateIntegrity(bundle: Rollup.OutputBundle, htmlPath: string, url: string, options: TransformOptions, config: ResolvedConfig, cacheManager: CacheManager, logger: Logger): Promise<string | null>;
