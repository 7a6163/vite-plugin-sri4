import { CacheManager } from './cache.js'
import { createTransformer, injectImportmapIntegrity } from './html-parser.js'
import { SUPPORTED_HASH_ALGORITHMS, bundleSource, sriHash } from './integrity-calculator.js'
import { Logger } from './logger.js'

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
const CROSSORIGIN_VALUES = ['anonymous', 'use-credentials']
const DEFAULT_PLUGIN_NAME = 'vite-plugin-sri4'
const MANIFEST_FILE_NAME = 'sri-manifest.json'
const HTML_RE = /\.html?$/
const JS_MODULE_RE = /\.m?js$/

function toText(source) {
  return typeof source === 'string' ? source : Buffer.from(source).toString('utf8')
}

function withTrailingSlash(base) {
  if (!base) return '/'
  return base.endsWith('/') ? base : `${base}/`
}

/**
 * Hash every non-HTML output, keyed by bundle file name.
 */
function hashBundle(bundle, hashAlgorithm) {
  const hashes = {}
  for (const [fileName, item] of Object.entries(bundle)) {
    if (HTML_RE.test(fileName)) continue
    const source = bundleSource(item)
    if (source) hashes[fileName] = sriHash(source, hashAlgorithm)
  }
  return hashes
}

/**
 * Reject configuration that would build cleanly and then fail in the browser.
 */
function validateOptions(hashAlgorithm, crossorigin) {
  if (!SUPPORTED_HASH_ALGORITHMS.includes(hashAlgorithm)) {
    throw new Error(
      `[${DEFAULT_PLUGIN_NAME}] unsupported hashAlgorithm "${hashAlgorithm}". ` +
      `The SRI spec defines ${SUPPORTED_HASH_ALGORITHMS.join(', ')}; browsers reject ` +
      `anything else, so the build would succeed and the resource would be blocked.`
    )
  }

  if (!CROSSORIGIN_VALUES.includes(crossorigin)) {
    throw new Error(
      `[${DEFAULT_PLUGIN_NAME}] crossorigin must be one of ${CROSSORIGIN_VALUES.join(', ')}, ` +
      `got "${crossorigin}"`
    )
  }
}

function sri(options = {}) {
  const {
    ignoreMissingAsset = false,
    bypassDomains = [],
    trustDomains = [],
    hashAlgorithm = DEFAULT_HASH_ALGORITHM,
    crossorigin = 'anonymous',
    logLevel = 'warn',
    manifest = false,
    importmap = false
  } = options

  validateOptions(hashAlgorithm, crossorigin)

  // Create cache manager and logger instances for this plugin instance
  const cacheManager = new CacheManager()
  const logger = new Logger(logLevel, DEFAULT_PLUGIN_NAME)

  // bundle fileName -> the integrity we injected, re-checked in writeBundle
  const hashedAssets = new Map()

  let config
  let transformer

  return {
    name: DEFAULT_PLUGIN_NAME,
    enforce: 'post',
    apply: 'build',

    // Every generateBundle hook has run by now. A plugin that rewrites chunk
    // contents after ours (plugin-legacy, in-place compression) would leave the
    // injected hashes describing bytes that no longer ship - a green build that
    // only fails in the browser. Fail here instead.
    writeBundle(_, bundle) {
      const drifted = []
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

      const plugins = config.plugins

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
      // Computed before emitting anything so the manifest never hashes itself
      const hashes = manifest || importmap ? hashBundle(bundle, hashAlgorithm) : null

      const htmlFiles = Object.entries(bundle).filter(
        ([, chunk]) =>
          chunk.type === 'asset' &&
          HTML_RE.test(chunk.fileName)
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
          let html = await transformer.transformHTML(bundle, name, originalContent)

          if (importmap) {
            const moduleIntegrity = {}
            const base = withTrailingSlash(config.base)
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
