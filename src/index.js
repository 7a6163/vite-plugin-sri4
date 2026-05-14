import { CacheManager } from './cache.js'
import { createTransformer } from './html-parser.js'
import { Logger } from './logger.js'

// Constants definition
// Vite 6/7 uses `vite:build-import-analysis`; Vite 8 Rolldown native path
// adds `native:import-analysis-build`. We patch whichever (or both) is present.
const VITE_INTERNAL_ANALYSIS_PLUGINS = [
  'vite:build-import-analysis',
  'native:import-analysis-build'
]
const DEFAULT_HASH_ALGORITHM = 'sha384'
const DEFAULT_PLUGIN_NAME = 'vite-plugin-sri4'

function sri(options = {}) {
  const {
    ignoreMissingAsset = false,
    bypassDomains = [],
    hashAlgorithm = DEFAULT_HASH_ALGORITHM,
    logLevel = 'warn'
  } = options

  // Create cache manager and logger instances for this plugin instance
  const cacheManager = new CacheManager()
  const logger = new Logger(logLevel, DEFAULT_PLUGIN_NAME)

  return {
    name: DEFAULT_PLUGIN_NAME,
    enforce: 'post',
    apply: 'build',

    // Cleanup work
    buildEnd() {
      // Clear caches
      cacheManager.clearAll()
    },

    configResolved(config) {
      const transformer = createTransformer({
        ignoreMissingAsset,
        bypassDomains,
        hashAlgorithm
      }, config, cacheManager, logger)

      const generateBundle = async function(_, bundle) {
        const htmlFiles = Object.entries(bundle).filter(
          ([, chunk]) =>
            chunk.type === 'asset' &&
            /\.html?$/.test(chunk.fileName)
        )

        if (htmlFiles.length === 0) {
          logger.debug('No HTML files found in bundle')
          return
        }

        // Process all HTML files in parallel
        await Promise.all(
          htmlFiles.map(async ([name, chunk]) => {
            try {
              const originalContent = chunk.source.toString()
              chunk.source = await transformer.transformHTML(bundle, name, originalContent)

              if (originalContent !== chunk.source) {
                logger.debug(`SRI attributes added to ${name}`)
              }
            } catch (error) {
              logger.warn(`Error processing ${name}:`, error)
              // Keep original content on error
            }
          })
        )
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
