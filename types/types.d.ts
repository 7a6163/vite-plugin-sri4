import type { Rollup } from 'vite';
export declare const SUPPORTED_HASH_ALGORITHMS: readonly ["sha256", "sha384", "sha512"];
/** The only algorithms the SRI spec defines; browsers reject anything else. */
export type SriHashAlgorithm = (typeof SUPPORTED_HASH_ALGORITHMS)[number];
export type SriCrossorigin = 'anonymous' | 'use-credentials';
export type SriLogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';
export interface SriOptions {
    /**
     * Hash algorithm used to compute the integrity value.
     * @default 'sha384'
     */
    hashAlgorithm?: SriHashAlgorithm;
    /**
     * Value for the injected `crossorigin` attribute. Tags that already declare
     * one are left alone.
     * @default 'anonymous'
     */
    crossorigin?: SriCrossorigin;
    /**
     * Hostnames to leave untouched. Matches the host itself and its subdomains.
     * Only applies to external URLs, protocol-relative `//host/path` included;
     * use the `skip-sri` attribute on a tag to opt a single element out.
     * @default []
     */
    bypassDomains?: string[];
    /**
     * Hostnames whose bytes you vouch for. An external resource is normally only
     * hashed when its origin declares the URL immutable (`Cache-Control:
     * immutable`, or a max-age of a year or more); a host listed here is hashed
     * regardless. Matches the host itself and its subdomains.
     *
     * Use it for a stable host that does not set the header - not to force SRI
     * onto a vendor's rolling URL, which will break on their next deploy.
     * @default []
     */
    trustDomains?: string[];
    /**
     * Warn instead of failing the build when an asset resolves to neither a
     * bundle entry nor a file in `publicDir`.
     * @default false
     */
    ignoreMissingAsset?: boolean;
    /**
     * Log verbosity.
     * @default 'warn'
     */
    logLevel?: SriLogLevel;
    /**
     * Inject `<script type="importmap">` carrying an `integrity` map for every
     * JS chunk, covering modules loaded at runtime by `import()` that have no
     * build-time tag to rewrite.
     * @default false
     */
    importmap?: boolean;
    /**
     * Emit `sri-manifest.json` mapping every non-HTML output file to its hash,
     * for servers that render HTML per request.
     * @default false
     */
    manifest?: boolean;
}
/** A bundle entry that carries hashable bytes. */
export type BundleItem = Rollup.OutputAsset | Rollup.OutputChunk;
/**
 * Options after defaults are applied and validated, as handed to the HTML
 * transformer. Unlike `SriOptions`, every value is present.
 */
export interface TransformOptions {
    ignoreMissingAsset: boolean;
    bypassDomains: string[];
    trustDomains: string[];
    hashAlgorithm: SriHashAlgorithm;
    crossorigin: SriCrossorigin;
    /** bundle fileName -> the integrity we injected, re-checked in writeBundle */
    hashedAssets?: Map<string, string>;
}
/** One tag shape the HTML scanner knows how to rewrite. */
export interface HtmlPattern {
    regex: RegExp;
    endOffset: number;
    getUrl: (tag: string) => string | null;
}
/**
 * A pending text edit. An insertion has `start === end`; a removal has empty
 * `content`.
 */
export interface HtmlChange {
    start: number;
    end: number;
    content: string;
    url: string | null;
    skipped?: boolean;
}
export interface Transformer {
    transformHTML(bundle: Rollup.OutputBundle, htmlPath: string, html: string): Promise<string>;
}
