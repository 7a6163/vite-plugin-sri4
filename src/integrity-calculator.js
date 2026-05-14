import { createHash } from 'node:crypto'
import path from 'node:path'
import { isUrlFromBypassDomain, checkResourceSupport, fetchResource } from './network-utils.js'

/**
 * Improved method for getting bundle keys
 */
function getBundleKey(htmlPath, url, config) {
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

/**
 * Calculate SRI integrity hash for a given resource
 */
export async function calculateIntegrity(
  bundle, 
  htmlPath, 
  url, 
  options, 
  config, 
  cacheManager,
  logger = null
) {
  const { 
    ignoreMissingAsset, 
    bypassDomains, 
    hashAlgorithm 
  } = options

  // Skip specified domains
  if (isUrlFromBypassDomain(url, bypassDomains, logger)) {
    return null
  }

  let source
  if (url.startsWith('http')) {
    const isSupported = await checkResourceSupport(url, cacheManager.getUrlSupportCache(), logger)
    if (!isSupported) return null
    source = await fetchResource(url, cacheManager.getResourceCache(), logger)
    if (!source) return null
  } else {
    const bundleKey = getBundleKey(htmlPath, url, config)
    const bundleItem = bundle[bundleKey]

    if (!bundleItem) {
      // Fall back to suffix match in either direction to absorb hashed
      // filenames AND base-prefix mismatches (e.g. URL "/base/main.js" with
      // bare bundle key "main.js"). A mismatch here just produces a wrong
      // integrity hash, which the browser rejects — failure-closed.
      const possibleMatch = Object.keys(bundle).find(key =>
        key.endsWith(bundleKey) || bundleKey.endsWith(key)
      )

      if (possibleMatch) {
        if (logger) {
          logger.debug(`Bundle key fallback: ${bundleKey} -> ${possibleMatch}`)
        }
        source = bundle[possibleMatch].type === 'chunk'
          ? bundle[possibleMatch].code
          : bundle[possibleMatch].source
      } else if (ignoreMissingAsset) {
        if (logger) {
          logger.warn(`Asset not found in bundle: ${url} (path: ${htmlPath}, key: ${bundleKey})`)
        }
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