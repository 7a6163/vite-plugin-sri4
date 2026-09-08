// Global fetch, stable since Node 18 - the floor the Vite 6.4 peer range
// already implies. No dependency needed.
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
 * `Cache-Control: private`, in either the bare or the `private="field"` form.
 * Substring matching would be wrong - a directive like `x-private` is not this.
 */
function isPrivateResponse(cacheControl) {
  if (!cacheControl) return false
  return cacheControl.split(',').some(directive => {
    const token = directive.trim().toLowerCase()
    return token === 'private' || token.startsWith('private=')
  })
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

      // Only `*` can be verified at build time. Injecting integrity also means
      // injecting crossorigin="anonymous"; if the server answers with a
      // concrete origin that does not match wherever the HTML ends up being
      // served from, that turns a working script into a blocked one. Skipping
      // is the safe outcome, but say so at warn level - silence here is what
      // makes an unprotected resource easy to miss.
      const corsHeader = response.headers.get('access-control-allow-origin')

      // Reachable and CORS-eligible is not the same property as byte-stable.
      // `private` is the origin declaring this response unsafe to share
      // between clients, and a response that cannot be shared between clients
      // cannot have a hash pinned to it either: what we fetch here is one
      // client's copy. Google Fonts is the case in the wild - it answers
      // `access-control-allow-origin: *` while serving different @font-face
      // blocks per client, so the CORS gate alone waves it through and the
      // browser then blocks a stylesheet whose hash matches nothing.
      //
      // Deliberately not `vary`: Google varies on User-Agent without
      // declaring it (`vary: Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site`),
      // so a vary-based gate lets this exact resource straight through.
      const cacheControl = response.headers.get('cache-control')
      if (response.ok && isPrivateResponse(cacheControl)) {
        if (logger) {
          logger.warn(
            `Skipping SRI for ${url}: Cache-Control is "${cacheControl}", so the origin serves ` +
            'a per-client response and the bytes hashed at build time are not the bytes the ' +
            'browser receives. Add the domain to bypassDomains to silence this.'
          )
        }
        urlSupportCache.set(url, false)
        return false
      }

      const isSupported = response.ok && corsHeader === '*'
      if (response.ok && corsHeader && corsHeader !== '*' && logger) {
        logger.warn(
          `Skipping SRI for ${url}: Access-Control-Allow-Origin is "${corsHeader}", not "*", ` +
          'so crossorigin="anonymous" cannot be verified at build time. ' +
          'Add the domain to bypassDomains to silence this.'
        )
      }
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