import { CacheManager } from './cache.js'
import { createTransformer, injectImportmapIntegrity } from './html-parser.js'
import { bundleSource, sriHash } from './integrity-calculator.js'
import { Logger } from './logger.js'

// Vite 6/7 uses `vite:build-import-analysis`; Vite 8 Rolldown native path
// adds `native:import-analysis-build`. We patch whichever (or both) is present.
//
// Why patch at all, rather than use `transformIndexHtml` (order: 'post') or our
// own `enforce: 'post'` generateBundle? Both of those run BEFORE this plugin
// substitutes `__VITE_PRELOAD__` in entry chunks, so any hash taken there
// describes bytes that never ship. Measured on Vite 8.2.2: at both of those
// points the entry chunk still ends `import("./about-*.js"),__VITE_PRELOAD__)`,
// while the written file ends `import("./about-*.js"),[])`. Wrapping this
// plugin's own handler is the only hook position after that substitution.
// `test/sri.test.js > injects integrity matching the actual emitted bytes`
// fails if this is ever "simplified" away.
const VITE_INTERNAL_ANALYSIS_PLUGINS = [
  'vite:build-import-analysis',
  'native:import-analysis-build'
]
const DEFAULT_HASH_ALGORITHM = 'sha384'
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

function sri(options = {}) {
  const {
    ignoreMissingAsset = false,
    bypassDomains = [],
    hashAlgorithm = DEFAULT_HASH_ALGORITHM,
    logLevel = 'warn',
    manifest = false,
    importmap = false
  } = options

  // Create cache manager and logger instances for this plugin instance
  const cacheManager = new CacheManager()
  const logger = new Logger(logLevel, DEFAULT_PLUGIN_NAME)

  // bundle fileName -> the integrity we injected, re-checked in writeBundle
  const hashedAssets = new Map()

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

    configResolved(config) {
      const transformer = createTransformer({
        ignoreMissingAsset,
        bypassDomains,
        hashAlgorithm,
        hashedAssets
      }, config, cacheManager, logger)

      // Both analysis plugin names can be present at once, and each is wrapped.
      // Without this guard the body runs twice per bundle: `emitFile` throws on
      // the duplicate manifest fileName, and the import map warns about the one
      // it just injected. If the skipped pass was the one that finalised chunk
      // contents, the writeBundle drift check fails the build loudly.
      const handled = new WeakSet()

      const generateBundle = async function(_, bundle) {
        if (handled.has(bundle)) return
        handled.add(bundle)

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

      const targets = config.plugins.filter(
        p => p && VITE_INTERNAL_ANALYSIS_PLUGINS.includes(p.name)
      )
      if (targets.length === 0) {
        throw new Error(
          `[${DEFAULT_PLUGIN_NAME}] could not find a Vite import-analysis plugin to hook into ` +
          `(looked for: ${VITE_INTERNAL_ANALYSIS_PLUGINS.join(', ')}). ` +
          `Requires Vite 6.0.0 or higher.`
        )
      }

      for (const plugin of targets) {
        if (typeof plugin.generateBundle === 'object' && plugin.generateBundle.handler) {
          const originalHandler = plugin.generateBundle.handler
          plugin.generateBundle.handler = async function(...args) {
            await originalHandler.apply(this, args)
            await generateBundle.apply(this, args)
          }
        } else if (typeof plugin.generateBundle === 'function') {
          const originalHandler = plugin.generateBundle
          plugin.generateBundle = async function(...args) {
            await originalHandler.apply(this, args)
            await generateBundle.apply(this, args)
          }
        }
      }
    }
  }
}

export default sri

export { sri }
