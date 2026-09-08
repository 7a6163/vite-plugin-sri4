import type { Plugin } from 'vite'

export interface SriOptions {
  /**
   * Hash algorithm used to compute the integrity value.
   * @default 'sha384'
   */
  hashAlgorithm?: 'sha256' | 'sha384' | 'sha512'

  /**
   * Hostnames to leave untouched. Matches the host itself and its subdomains.
   * Only applies to external (http/https) URLs; use the `skip-sri` attribute
   * on a tag to opt a single element out.
   * @default []
   */
  bypassDomains?: string[]

  /**
   * Warn instead of failing the build when an asset resolves to neither a
   * bundle entry nor a file in `publicDir`.
   * @default false
   */
  ignoreMissingAsset?: boolean

  /**
   * Log verbosity.
   * @default 'warn'
   */
  logLevel?: 'silent' | 'error' | 'warn' | 'info' | 'debug'

  /**
   * Inject `<script type="importmap">` carrying an `integrity` map for every
   * JS chunk, covering modules loaded at runtime by `import()` that have no
   * build-time tag to rewrite.
   * @default false
   */
  importmap?: boolean

  /**
   * Emit `sri-manifest.json` mapping every non-HTML output file to its hash,
   * for servers that render HTML per request.
   * @default false
   */
  manifest?: boolean
}

declare function sri(options?: SriOptions): Plugin

export default sri
export { sri }
