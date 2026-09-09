import type { ResolvedConfig, Rollup } from 'vite';
import type { CacheManager } from './cache.js';
import type { Logger } from './logger.js';
import type { HtmlPattern, TransformOptions, Transformer } from './types.js';
export declare const HTML_PATTERNS: Record<'script' | 'link', HtmlPattern>;
/**
 * Inject an import map carrying an `integrity` map.
 *
 * This is the only mechanism that covers modules pulled in at runtime by
 * `import()` / Vite's preload helper, which have no build-time HTML tag to
 * rewrite. Engines without support ignore the key rather than failing.
 */
export declare function injectImportmapIntegrity(html: string, integrity: Record<string, string>, logger: Logger): string;
/**
 * Transform HTML by adding SRI integrity attributes
 */
export declare function transformHTML(bundle: Rollup.OutputBundle, htmlPath: string, html: string, options: TransformOptions, config: ResolvedConfig, cacheManager: CacheManager, logger: Logger): Promise<string>;
/**
 * Create HTML transformer with given options and config
 */
export declare function createTransformer(options: TransformOptions, config: ResolvedConfig, cacheManager: CacheManager, logger: Logger): Transformer;
