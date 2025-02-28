import { createHash } from 'crypto'
import path from 'path'
import fetch from 'cross-fetch'

// Constants definition
const VITE_INTERNAL_ANALYSIS_PLUGIN = 'vite:build-import-analysis'
const DEFAULT_TIMEOUT = 5000
const DEFAULT_HASH_ALGORITHM = 'sha384'
const DEFAULT_PLUGIN_NAME = 'vite-plugin-sri4'

// Optimized regex patterns for better readability and efficiency
const HTML_PATTERNS = {
  script: {
    regex: /<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*><\/script>/g,
    endOffset: 10
  },
  stylesheet: {
    regex: /<link\b[^>]*?\brel\s*=\s*["']stylesheet["'][^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>/g,
    endOffset: 1
  },
  modulepreload: {
    regex: /<link\b[^>]*?\brel\s*=\s*["']modulepreload["'][^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>/g,
    endOffset: 1
  }
}

// Extended caching mechanism with expiration time
class ResourceCache {
  constructor(ttl = 3600000) { // Default cache for 1 hour
    this.cache = new Map()
    this.ttl = ttl
  }

  get(key) {
    const item = this.cache.get(key)
    if (!item) return undefined

    // Check if expired
    if (Date.now() > item.expiry) {
      this.cache.delete(key)
      return undefined
    }

    return item.value
  }

  set(key, value) {
    this.cache.set(key, {
      value,
      expiry: Date.now() + this.ttl
    })
  }

  has(key) {
    return this.get(key) !== undefined
  }

  clear() {
    this.cache.clear()
  }
}

const urlSupportCache = new ResourceCache()
const resourceCache = new ResourceCache()

// Check if URL is from a bypass domain
function isUrlFromBypassDomain(url, bypassDomains = []) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return false

  try {
    const urlObj = new URL(url)
    return bypassDomains.some(domain =>
      urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`)
    )
  } catch (error) {
    console.warn(`[${DEFAULT_PLUGIN_NAME}] Invalid URL: ${url}`, error)
    return false
  }
}

// Resource check with retry mechanism
async function checkResourceSupport(url, retries = 2) {
  if (urlSupportCache.has(url)) {
    return urlSupportCache.get(url)
  }

  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT)

      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      const corsHeader = response.headers.get('access-control-allow-origin')
      const isSupported = response.ok && (corsHeader === '*' || corsHeader?.includes('*'))
      urlSupportCache.set(url, isSupported)
      return isSupported
    } catch (error) {
      lastError = error
      if (error.name === 'AbortError') {
        console.warn(`[${DEFAULT_PLUGIN_NAME}] Resource check timed out: ${url}`)
        break // Don't retry timeouts
      }

      // Don't wait after the last failed attempt
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
      }
    }
  }

  console.warn(`[${DEFAULT_PLUGIN_NAME}] Failed to check resource support: ${url}`, lastError)
  urlSupportCache.set(url, false)
  return false
}

// Optimized resource fetching function with retry mechanism and caching
async function fetchResource(url, retries = 1) {
  // Check cache
  if (resourceCache.has(url)) {
    return resourceCache.get(url)
  }

  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT)

      const response = await fetch(url, { signal: controller.signal })
      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = new Uint8Array(await response.arrayBuffer())
      resourceCache.set(url, data)
      return data
    } catch (error) {
      lastError = error
      if (error.name === 'AbortError') {
        console.warn(`[${DEFAULT_PLUGIN_NAME}] Resource fetch timed out: ${url}`)
        break // Don't retry timeouts
      }

      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
      }
    }
  }

  console.warn(`[${DEFAULT_PLUGIN_NAME}] Failed to fetch external resource: ${url}`, lastError)
  return null
}

function createTransformer(options, config) {
  const {
    ignoreMissingAsset,
    bypassDomains,
    hashAlgorithm = DEFAULT_HASH_ALGORITHM
  } = options

  // Improved method for getting bundle keys
  const getBundleKey = (htmlPath, url) => {
    // Handle absolute path URLs
    if (url.startsWith('/')) {
      // Remove leading slash to match keys in bundle
      return url.substring(1)
    }

    // Handle relative paths (when config.base is relative)
    if (config.base === './' || config.base === '') {
      return path.posix.resolve(path.posix.dirname(htmlPath), url)
    }

    // Handle other cases, remove base prefix from URL
    return url.startsWith(config.base)
      ? url.substring(config.base.length)
      : url
  }

  const calculateIntegrity = async (bundle, htmlPath, url) => {
    // Skip specified domains
    if (isUrlFromBypassDomain(url, bypassDomains)) {
      return null
    }

    let source
    if (url.startsWith('http')) {
      const isSupported = await checkResourceSupport(url)
      if (!isSupported) return null
      source = await fetchResource(url)
      if (!source) return null
    } else {
      const bundleKey = getBundleKey(htmlPath, url)
      const bundleItem = bundle[bundleKey]

      if (!bundleItem) {
        // Try to find a matching item with more flexible matching
        const possibleMatch = Object.keys(bundle).find(key =>
          key.endsWith(bundleKey) || bundleKey.endsWith(key)
        )

        if (possibleMatch) {
          source = bundle[possibleMatch].type === 'chunk'
            ? bundle[possibleMatch].code
            : bundle[possibleMatch].source
        } else if (ignoreMissingAsset) {
          console.warn(`[${DEFAULT_PLUGIN_NAME}] Asset not found in bundle: ${url} (path: ${htmlPath}, key: ${bundleKey})`)
          return null
        } else {
          throw new Error(`Asset ${url} not found in bundle (path: ${htmlPath}, key: ${bundleKey})`)
        }
      } else {
        source = bundleItem.type === 'chunk' ? bundleItem.code : bundleItem.source
      }
    }

    // Ensure source is a Uint8Array or string
    if (!source) return null

    if (typeof source === 'string') {
      return `${hashAlgorithm}-${createHash(hashAlgorithm).update(source).digest('base64')}`
    }

    return `${hashAlgorithm}-${createHash(hashAlgorithm).update(Buffer.from(source)).digest('base64')}`
  }

  const transformHTML = async (bundle, htmlPath, html) => {
    if (!html || typeof html !== 'string') {
      console.warn(`[${DEFAULT_PLUGIN_NAME}] Invalid HTML content for ${htmlPath}`)
      return html
    }

    const changes = []

    // Collect changes from all patterns in parallel
    await Promise.all(
      Object.values(HTML_PATTERNS).map(async ({ regex, endOffset }) => {
        const matches = [...html.matchAll(regex)]

        // Process each match in parallel
        const matchResults = await Promise.all(
          matches.map(async match => {
            const [, url] = match
            if (!url) return null

            const end = match.index + match[0].length
            const integrity = await calculateIntegrity(bundle, htmlPath, url)

            if (integrity) {
              return {
                integrity,
                position: end - endOffset,
                url // For logging
              }
            }
            return null
          })
        )

        // Filter out null results
        matchResults.filter(Boolean).forEach(result => changes.push(result))
      })
    )

    // Sort by position in descending order to insert from back to front (won't affect insertion points ahead)
    changes.sort((a, b) => b.position - a.position)

    // Check if identical integrity attributes already exist to avoid duplicates
    for (const { integrity, position, url } of changes) {
      const insertText = ` integrity="${integrity}"`

      // Check if integrity attribute already exists
      const segment = html.slice(Math.max(0, position - 100), position + 100)
      if (segment.includes(`integrity="${integrity}"`)) {
        continue // Skip elements that already have the same integrity
      }

      html = html.slice(0, position) + insertText + html.slice(position)
      console.debug(`[${DEFAULT_PLUGIN_NAME}] Added integrity for: ${url}`)
    }

    return html
  }

  return { transformHTML, calculateIntegrity }
}

function sri(options = {}) {
  const {
    ignoreMissingAsset = false,
    bypassDomains = [],
    hashAlgorithm = DEFAULT_HASH_ALGORITHM,
    logLevel = 'warn'
  } = options

  // Adjust log level
  const originalConsoleWarn = console.warn
  const originalConsoleDebug = console.debug

  if (logLevel === 'error') {
    console.warn = () => {}
    console.debug = () => {}
  } else if (logLevel === 'warn') {
    console.debug = () => {}
  }

  return {
    name: DEFAULT_PLUGIN_NAME,
    enforce: 'post',
    apply: 'build',

    // Cleanup work
    buildEnd() {
      // Restore console functions
      console.warn = originalConsoleWarn
      console.debug = originalConsoleDebug

      // Clear caches
      urlSupportCache.clear()
      resourceCache.clear()
    },

    configResolved(config) {
      const transformer = createTransformer({
        ignoreMissingAsset,
        bypassDomains,
        hashAlgorithm
      }, config)

      const generateBundle = async function(_, bundle) {
        const htmlFiles = Object.entries(bundle).filter(
          ([, chunk]) =>
            chunk.type === 'asset' &&
            /\.html?$/.test(chunk.fileName)
        )

        if (htmlFiles.length === 0) {
          console.debug(`[${DEFAULT_PLUGIN_NAME}] No HTML files found in bundle`)
          return
        }

        // Process all HTML files in parallel
        await Promise.all(
          htmlFiles.map(async ([name, chunk]) => {
            try {
              const originalContent = chunk.source.toString()
              chunk.source = await transformer.transformHTML(bundle, name, originalContent)

              if (originalContent !== chunk.source) {
                console.debug(`[${DEFAULT_PLUGIN_NAME}] SRI attributes added to ${name}`)
              }
            } catch (error) {
              console.warn(`[${DEFAULT_PLUGIN_NAME}] Error processing ${name}:`, error)
              // Keep original content on error
            }
          })
        )
      }

      const plugin = config.plugins.find(p => p.name === VITE_INTERNAL_ANALYSIS_PLUGIN)
      if (!plugin) {
        throw new Error(`[${DEFAULT_PLUGIN_NAME}] requires Vite 2.0.0 or higher`)
      }

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

export default sri

export { sri }
