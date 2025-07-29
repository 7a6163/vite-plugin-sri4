import fetch from 'cross-fetch'

const DEFAULT_TIMEOUT = 5000

/**
 * Check if URL is from a bypass domain
 */
export function isUrlFromBypassDomain(url, bypassDomains = [], logger = null) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return false

  try {
    const urlObj = new URL(url)
    return bypassDomains.some(domain =>
      urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`)
    )
  } catch (error) {
    if (logger) {
      logger.warn(`Invalid URL: ${url}`, error)
    }
    return false
  }
}

/**
 * Resource check with retry mechanism
 */
export async function checkResourceSupport(url, urlSupportCache, logger = null, retries = 2) {
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
        if (logger) {
          logger.warn(`Resource check timed out: ${url}`)
        }
        break // Don't retry timeouts
      }

      // Don't wait after the last failed attempt
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
      }
    }
  }

  if (logger) {
    logger.warn(`Failed to check resource support: ${url}`, lastError)
  }
  urlSupportCache.set(url, false)
  return false
}

/**
 * Optimized resource fetching function with retry mechanism and caching
 */
export async function fetchResource(url, resourceCache, logger = null, retries = 1) {
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
        if (logger) {
          logger.warn(`Resource fetch timed out: ${url}`)
        }
        break // Don't retry timeouts
      }

      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
      }
    }
  }

  if (logger) {
    logger.warn(`Failed to fetch external resource: ${url}`, lastError)
  }
  return null
}