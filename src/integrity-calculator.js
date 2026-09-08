import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { matchesDomain, fetchVerifiedResource } from './network-utils.js'

/**
 * Read the hashable source out of a bundle entry (chunk code or asset source)
 */
export function bundleSource(item) {
  return item.type === 'chunk' ? item.code : item.source
}

// The only algorithms the SRI spec defines. Browsers reject anything else,
// which blocks the resource with no build-time error at all.
export const SUPPORTED_HASH_ALGORITHMS = ['sha256', 'sha384', 'sha512']

/**
 * Compute an SRI string for a source that may be a string, Buffer or Uint8Array
 */
export function sriHash(source, hashAlgorithm) {
  const hash = createHash(hashAlgorithm)
  hash.update(typeof source === 'string' ? source : Buffer.from(source))
  return `${hashAlgorithm}-${hash.digest('base64')}`
}

// Anything carrying a scheme (data:, blob:, invalid:) is not a path into the
// bundle. Protocol-relative `//host/path` is excluded here - it is a real HTTP
// URL and is fetched, not skipped.
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i
const HTTP_RE = /^https?:/i

/**
 * The URL to fetch for an external resource, or null if it is not fetchable.
 */
function externalUrl(url) {
  if (HTTP_RE.test(url)) return url
  // Protocol-relative: same origin scheme as the page, https at build time
  if (url.startsWith('//')) return `https:${url}`
  return null
}

/**
 * Improved method for getting bundle keys
 */
function getBundleKey(htmlPath, url, config) {
  // Bundle keys never carry a query string or fragment
  const cleanUrl = url.replace(/[?#].*$/, '')

  // Handle absolute path URLs
  if (cleanUrl.startsWith('/')) {
    // Remove leading slash to match keys in bundle
    return cleanUrl.substring(1)
  }

  // Handle relative paths (when config.base is relative). `join`, not
  // `resolve` - bundle keys are relative to the output root, and `resolve`
  // would make the key absolute against the process CWD.
  if (config.base === './' || config.base === '') {
    return path.posix.join(path.posix.dirname(htmlPath), cleanUrl)
  }

  // Handle other cases, remove base prefix from URL
  return cleanUrl.startsWith(config.base)
    ? cleanUrl.substring(config.base.length)
    : cleanUrl
}

/**
 * Find a bundle key for a URL that did not match exactly.
 *
 * Matching is anchored on a path separator so `main.js` can never match
 * `assets/vendor-main.js` - a cross-filename match would inject a valid-looking
 * but wrong hash, which the browser rejects with no build-time error.
 */
export function findBundleKey(bundle, bundleKey, logger = null) {
  const candidates = Object.keys(bundle).filter(key =>
    key === bundleKey ||
    key.endsWith(`/${bundleKey}`) ||
    bundleKey.endsWith(`/${key}`)
  )

  if (candidates.length > 1 && logger) {
    logger.warn(
      `Ambiguous bundle key for "${bundleKey}": ${candidates.join(', ')} - using ${candidates[0]}`
    )
  }

  return candidates[0]
}

/**
 * Read an asset that lives in `publicDir` rather than the bundle.
 *
 * Files copied verbatim from `public/` never appear as bundle entries, so
 * without this a perfectly normal `<script src="/sw.js">` fails the build.
 * Returns null rather than throwing so the caller keeps its own missing-asset
 * policy.
 */
async function readPublicAsset(config, bundleKey, logger) {
  const publicDir = config.publicDir
  if (!publicDir) return null

  // Bundle keys come from URLs, which may be percent-encoded
  let decoded
  try {
    decoded = decodeURIComponent(bundleKey)
  } catch {
    decoded = bundleKey
  }

  const filePath = path.resolve(publicDir, decoded)

  // A URL must never reach outside publicDir, however it is spelled
  const relative = path.relative(publicDir, filePath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    if (logger) {
      logger.warn(`Refusing to read outside publicDir: ${bundleKey}`)
    }
    return null
  }

  try {
    const source = await readFile(filePath)
    if (logger) {
      logger.debug(`Resolved from publicDir: ${bundleKey}`)
    }
    return source
  } catch {
    return null
  }
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
    trustDomains,
    hashAlgorithm,
    hashedAssets
  } = options

  // With an absolute `base` (assets on a CDN) Vite emits absolute URLs for our
  // own build output. Those must be hashed from the bundle, not fetched - the
  // CDN may not have been deployed yet, and this is the very case SRI exists
  // for. Checked before the network path.
  const base = config.base || '/'
  const ownAsset = (HTTP_RE.test(base) || base.startsWith('//')) && url.startsWith(base)
  const fetchUrl = ownAsset ? null : externalUrl(url)

  // Both domain options match the URL that would actually be fetched.
  // `matchesDomain` needs a scheme, so matching the raw `url` silently missed
  // every protocol-relative `//host/path` - and `trustDomains` below, which
  // already saw the normalized form, would then disagree with `bypassDomains`
  // about the same tag.
  if (matchesDomain(fetchUrl ?? url, bypassDomains, logger)) {
    return null
  }

  let source
  let bundleFileName = null
  if (fetchUrl) {
    const trusted = matchesDomain(fetchUrl, trustDomains, logger)
    source = await fetchVerifiedResource(
      fetchUrl, cacheManager.getResourceCache(), logger, trusted
    )
    if (!source) return null
  } else if (!ownAsset && SCHEME_RE.test(url)) {
    // data:/blob: and unknown schemes cannot be resolved to a bundle asset
    if (logger) {
      logger.debug(`Skipping URL that is not a bundle asset: ${url}`)
    }
    return null
  } else {
    const bundleKey = getBundleKey(htmlPath, url, config)
    const bundleItem = bundle[bundleKey]

    if (!bundleItem) {
      // Fall back to a path-anchored suffix match to absorb hashed filenames
      // AND base-prefix mismatches (e.g. URL "/base/main.js" with bare bundle
      // key "main.js").
      const possibleMatch = findBundleKey(bundle, bundleKey, logger)

      if (possibleMatch) {
        if (logger) {
          logger.debug(`Bundle key fallback: ${bundleKey} -> ${possibleMatch}`)
        }
        bundleFileName = possibleMatch
        source = bundleSource(bundle[possibleMatch])
      } else {
        // Not a build output - it may still be a file copied from publicDir
        source = await readPublicAsset(config, bundleKey, logger)

        if (!source) {
          if (ignoreMissingAsset) {
            if (logger) {
              logger.warn(
                `Asset not found in bundle or publicDir: ${url} (path: ${htmlPath}, key: ${bundleKey})`
              )
            }
            return null
          }
          throw new Error(
            `Asset ${url} not found in bundle or publicDir (path: ${htmlPath}, key: ${bundleKey})`
          )
        }
      }
    } else {
      bundleFileName = bundleKey
      source = bundleSource(bundleItem)
    }
  }

  // Ensure source is a Uint8Array or string
  if (!source) return null

  const integrity = sriHash(source, hashAlgorithm)
  // Recorded so writeBundle can catch a later plugin rewriting these bytes
  if (bundleFileName && hashedAssets) hashedAssets.set(bundleFileName, integrity)
  return integrity
}
