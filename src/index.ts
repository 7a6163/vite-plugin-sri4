import type { Plugin, ResolvedConfig, Rollup } from 'vite'
import { CacheManager } from './cache.js'
import { createTransformer, injectImportmapIntegrity } from './html-parser.js'
import { bundleSource, sriHash } from './integrity-calculator.js'
import { Logger } from './logger.js'
import { SUPPORTED_HASH_ALGORITHMS } from './types.js'
import type { SriCrossorigin, SriHashAlgorithm, SriOptions, Transformer } from './types.js'

export type { SriHashAlgorithm, SriOptions } from './types.js'

// Vite 6/7 uses `vite:build-import-analysis`; Vite 8 Rolldown native path adds
// `native:import-analysis-build`.
//
// Why we care where these sit: they substitute `__VITE_PRELOAD__` in entry
// chunks inside their own generateBundle, and Vite places them immediately
// AFTER `enforce: 'post'` user plugins - so by default we would hash an entry
// chunk still containing `import("./x.js"),__VITE_PRELOAD__)` while the
// written file contains `import("./x.js"),[])`.
//
// Measured on both Vite 6.4.3 and 8.2.2: a plain post plugin lands at the
// index immediately before the analysis plugin and sees the unsubstituted
// placeholder in its own generateBundle, while the emitted file has none. The
// failure is identical on every supported major, not a Vite 8 quirk.
//
// The fix is to move THIS plugin one place later, not to rewrite someone
// else's hook. `config.plugins` is a plain, unfrozen array at configResolved
// time and Rollup reads it afterwards, so repositioning takes effect.
// `test/sri.test.js > injects integrity matching the actual emitted bytes` is
// the pin, and the writeBundle drift check is the second net.
const VITE_INTERNAL_ANALYSIS_PLUGINS = [
  'vite:build-import-analysis',
  'native:import-analysis-build'
]
const DEFAULT_HASH_ALGORITHM = 'sha384'
const CROSSORIGIN_VALUES = ['anonymous', 'use-credentials'] as const
const DEFAULT_PLUGIN_NAME = 'vite-plugin-sri4'
const MANIFEST_FILE_NAME = 'sri-manifest.json'
const HTML_RE = /\.html?$/
const JS_MODULE_RE = /\.m?js$/

function toText(source: string | Uint8Array): string {
  return typeof source === 'string' ? source : Buffer.from(source).toString('utf8')
}

function withTrailingSlash(base: string): string {
  if (!base) return '/'
  return base.endsWith('/') ? base : `${base}/`
}

/**
 * Hash every non-HTML output, keyed by bundle file name.
 */
function hashBundle(
  bundle: Rollup.OutputBundle,
  hashAlgorithm: SriHashAlgorithm
): Record<string, string> {
  const hashes: Record<string, string> = {}
  for (const [fileName, item] of Object.entries(bundle)) {
    if (HTML_RE.test(fileName)) continue
    const source = bundleSource(item)
    if (source) hashes[fileName] = sriHash(source, hashAlgorithm)
  }
  return hashes
}

/**
 * `Array.includes` on a narrowly typed list will not accept a wide string, so
 * the widening is spelled once, here, rather than at each call site.
 */
function isOneOf<T extends string>(allowed: readonly T[], value: string): value is T {
  return (allowed as readonly string[]).includes(value)
}

/**
 * Reject configuration that would build cleanly and then fail in the browser.
 *
 * Both parameters are `string`, not the narrow published types, on purpose: a
 * plain JS `vite.config.js` gets no type checking at all, and these two throws
 * are the only thing standing between `hashAlgorithm: 'md5'` and a resource the
 * browser blocks with no build-time error. Returns the values narrowed, so the
 * validation is what produces the types the rest of the plugin relies on.
 */
function validateOptions(hashAlgorithm: string, crossorigin: string): {
  hashAlgorithm: SriHashAlgorithm
  crossorigin: SriCrossorigin
} {
  if (!isOneOf(SUPPORTED_HASH_ALGORITHMS, hashAlgorithm)) {
    throw new Error(
      `[${DEFAULT_PLUGIN_NAME}] unsupported hashAlgorithm "${hashAlgorithm}". ` +
      `The SRI spec defines ${SUPPORTED_HASH_ALGORITHMS.join(', ')}; browsers reject ` +
      `anything else, so the build would succeed and the resource would be blocked.`
    )
  }

  if (!isOneOf(CROSSORIGIN_VALUES, crossorigin)) {
    throw new Error(
      `[${DEFAULT_PLUGIN_NAME}] crossorigin must be one of ${CROSSORIGIN_VALUES.join(', ')}, ` +
      `got "${crossorigin}"`
    )
  }

  return { hashAlgorithm, crossorigin }
}

function sri(options: SriOptions = {}): Plugin {
  const {
    ignoreMissingAsset = false,
    bypassDomains = [],
    trustDomains = [],
    logLevel = 'warn',
    manifest = false,
    importmap = false
  } = options

  const { hashAlgorithm, crossorigin } = validateOptions(
    options.hashAlgorithm ?? DEFAULT_HASH_ALGORITHM,
    options.crossorigin ?? 'anonymous'
  )

  // Create cache manager and logger instances for this plugin instance
  const cacheManager = new CacheManager()
  const logger = new Logger(logLevel, DEFAULT_PLUGIN_NAME)

  // bundle fileName -> the integrity we injected, re-checked in writeBundle
  const hashedAssets = new Map<string, string>()

  // Set in configResolved, read in generateBundle. Vite always calls
  // configResolved first, which the type system cannot see - hence the `!` at
  // the two read sites, rather than guards that would add branches no test can
  // reach and no build can hit.
  let config: ResolvedConfig | undefined
  let transformer: Transformer | undefined

  return {
    name: DEFAULT_PLUGIN_NAME,
    enforce: 'post',
    apply: 'build',

    // Every generateBundle hook has run by now. A plugin that rewrites chunk
    // contents after ours (plugin-legacy, in-place compression) would leave the
    // injected hashes describing bytes that no longer ship - a green build that
    // only fails in the browser. Fail here instead.
    writeBundle(_, bundle) {
      const drifted: string[] = []
      for (const [fileName, integrity] of hashedAssets) {
        const item = bundle[fileName]
        if (!item) continue
        const source = bundleSource(item)
        if (source && sriHash(source, hashAlgorithm) !== integrity) {
          drifted.push(fileName)
        }
      }
      hashedAssets.clear()

      if (drifted.length > 0) {
        throw new Error(
          `[${DEFAULT_PLUGIN_NAME}] content changed after integrity was computed: ` +
          `${drifted.join(', ')}. A plugin running after this one rewrote these ` +
          `files, so the injected hashes no longer match what ships. Move that ` +
          `plugin before ${DEFAULT_PLUGIN_NAME}, or drop it.`
        )
      }
    },

    // Cleanup. Note this must not be `buildEnd`, which Rollup runs before the
    // output phase - clearing there would empty the caches before use.
    closeBundle() {
      cacheManager.clearAll()
      hashedAssets.clear()
    },

    configResolved(resolvedConfig) {
      config = resolvedConfig
      transformer = createTransformer({
        ignoreMissingAsset,
        bypassDomains,
        trustDomains,
        hashAlgorithm,
        crossorigin,
        hashedAssets
      }, config, cacheManager, logger)

      // Vite types `plugins` as readonly, which is Vite saying "do not reorder
      // this". Reordering it is precisely the fix described above, and the
      // array is a plain unfrozen one at runtime - so the cast is the
      // deliberate part of the mechanism, not an oversight.
      const plugins = config.plugins as Plugin[]

      // The last one wins: if both names are present we must follow both
      let target = -1
      for (let i = 0; i < plugins.length; i++) {
        if (plugins[i] && VITE_INTERNAL_ANALYSIS_PLUGINS.includes(plugins[i].name)) target = i
      }

      if (target === -1) {
        throw new Error(
          `[${DEFAULT_PLUGIN_NAME}] could not find a Vite import-analysis plugin to run after ` +
          `(looked for: ${VITE_INTERNAL_ANALYSIS_PLUGINS.join(', ')}). ` +
          `Requires Vite 6.4.0 or higher.`
        )
      }

      const self = plugins.findIndex(p => p && p.name === DEFAULT_PLUGIN_NAME)
      if (self === -1) {
        // Only reachable when the plugin was not registered through Vite, as
        // in a unit test driving the hook directly. Hashes may then be taken a
        // step early, which the writeBundle drift check catches.
        logger.debug('Plugin not present in config.plugins; leaving hook order alone')
        return
      }

      if (target > self) {
        // Removing ourselves shifts target down one, so inserting at `target`
        // lands immediately after it.
        const [me] = plugins.splice(self, 1)
        plugins.splice(target, 0, me)
        logger.debug(`Repositioned after ${plugins[target - 1].name}`)
      }
    },

    async generateBundle(_, bundle) {
      // Computed before emitting anything so the manifest never hashes itself.
      // `{}` rather than null when neither output is wanted: the two readers
      // below are already gated on the same flags, and a nullable here buys
      // only a type the compiler cannot narrow.
      const hashes = manifest || importmap ? hashBundle(bundle, hashAlgorithm) : {}

      const htmlFiles = Object.entries(bundle).filter(
        (entry): entry is [string, Rollup.OutputAsset] =>
          entry[1].type === 'asset' &&
          HTML_RE.test(entry[1].fileName)
      )

      if (htmlFiles.length === 0) {
        // Normal for SSR / library builds, which render HTML at request time
        // - the manifest below is how those builds get their hashes.
        logger.debug('No HTML files found in bundle')
      }

      // Errors are intentionally not caught: a resource that cannot be
      // hashed must fail the build rather than ship without integrity.
      await Promise.all(
        htmlFiles.map(async ([name, chunk]) => {
          const originalContent = toText(chunk.source)
          let html = await transformer!.transformHTML(bundle, name, originalContent)

          if (importmap) {
            const moduleIntegrity: Record<string, string> = {}
            const base = withTrailingSlash(config!.base)
            for (const [fileName, integrity] of Object.entries(hashes)) {
              if (JS_MODULE_RE.test(fileName)) moduleIntegrity[base + fileName] = integrity
            }
            html = injectImportmapIntegrity(html, moduleIntegrity, logger)
          }

          chunk.source = html

          if (originalContent !== chunk.source) {
            logger.debug(`SRI attributes added to ${name}`)
          }
        })
      )

      if (manifest) {
        this.emitFile({
          type: 'asset',
          fileName: MANIFEST_FILE_NAME,
          source: JSON.stringify(hashes, null, 2)
        })
        logger.debug(`Emitted ${MANIFEST_FILE_NAME} with ${Object.keys(hashes).length} entries`)
      }
    }
  }
}

export default sri

export { sri }
