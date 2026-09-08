// Global fetch, stable since Node 18 - the floor the Vite 6.4 peer range
// already implies. No dependency needed.
const DEFAULT_TIMEOUT = 5000

/**
 * Does an external URL's host match one of `domains`, or a subdomain of one?
 * Used by both `bypassDomains` and `trustDomains`.
 */
export function matchesDomain(url, domains = [], logger = null) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return false
  if (domains.length === 0) return false

  try {
    const urlObj = new URL(url)
    return domains.some(domain =>
      urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`)
    )
  } catch (error) {
    if (logger) {
      logger.warn(`Invalid URL: ${url}`, error)
    }
    return false
  }
}

// A year. The conventional encoding of "this URL's bytes will never change",
// and what every CDN puts on a version-pinned path.
const IMMUTABLE_MAX_AGE = 31536000

/**
 * Does the origin declare this URL's bytes immutable - `Cache-Control:
 * immutable`, or a max-age of a year or more - and nothing in the same header
 * contradicting it?
 *
 * Measured, because the split is what makes this usable as a gate. Pinned
 * third-party libraries, the case SRI actually exists for:
 *
 *   cdnjs    jquery/3.7.1       max-age=30672000, immutable
 *   jsdelivr bootstrap@5.3.3    max-age=31536000, immutable
 *   unpkg    htmx.org@1.9.12    max-age=31536000
 *   code.jquery.com  3.7.1      max-age=31536000
 *
 * Everything that rolls under a stable URL:
 *
 *   jsdelivr vue@3              max-age=604800
 *   fonts.googleapis.com        max-age=86400   (also `private`)
 *   plausible.io/js/script.js   max-age=86400
 *   cdn.tailwindcss.com         max-age=14400
 *   connect.facebook.net        max-age=1200
 *   js.stripe.com/v3/           max-age=120
 *   unpkg    react@18           max-age=60
 *
 * Nothing lands between 604800 and 30672000, so the threshold is not a
 * balancing act - it separates two clusters the CDNs themselves created.
 */
function isImmutableResponse(cacheControl) {
  if (!cacheControl) return false

  let immutable = false

  for (const directive of cacheControl.split(',')) {
    // Token equality, not substring: `x-immutable` is not this directive
    const token = directive.trim().toLowerCase()

    // These veto whatever else the header claims, and are checked against the
    // whole header rather than returning early, because freshness and
    // shareability are orthogonal - a per-client response can carry a long
    // max-age, and `no-cache, max-age=<long>` is a real CDN spelling of "cache
    // it, but revalidate every time", i.e. the bytes may have changed.
    //
    // The qualified forms (`private="set-cookie"`, `no-cache="set-cookie"`)
    // only scope the directive to those headers, so vetoing on them is
    // stricter than the spec requires. That is the right way to be wrong here:
    // the cost is losing SRI on a resource that would have been fine, and it
    // is logged. Not vetoing costs a page that only breaks in the browser.
    if (
      token === 'no-store' ||
      token === 'private' || token.startsWith('private=') ||
      token === 'no-cache' || token.startsWith('no-cache=')
    ) {
      return false
    }

    if (token === 'immutable') immutable = true

    if (token.startsWith('max-age=')) {
      // RFC 9111 permits a quoted-string value: `max-age="31536000"`
      const seconds = Number(token.slice('max-age='.length).replace(/^"|"$/g, ''))
      if (Number.isFinite(seconds) && seconds >= IMMUTABLE_MAX_AGE) immutable = true
    }
  }

  return immutable
}

/**
 * Resource check with retry mechanism
 */
/**
 * Fetch an external resource and return its bytes, or null if it must not be
 * hashed. The reason is always logged - a tag that silently ships without
 * integrity is the thing that is easy to miss.
 *
 * One GET, not a HEAD probe followed by a GET. The headers the gates need
 * arrive on the response that carries the bytes anyway, so probing separately
 * doubled the requests and threw the useful copy away - and made the plugin
 * depend on HEAD being served at all. It often is not: js.tappaysdk.com
 * answers 403 to HEAD and 200 to GET, which used to read as "could not be
 * checked" on a payment SDK, exactly the kind of script SRI is for.
 *
 * The cost is that a rejected resource is downloaded before it is rejected.
 * That is the right side to lose on: the accepted case, which is every build
 * that actually ships hashes, goes from two requests to one.
 */
export async function fetchVerifiedResource(url, resourceCache, logger = null, trusted = false, retries = 1) {
  if (resourceCache.has(url)) {
    return resourceCache.get(url)
  }

  const reject = (message) => {
    if (logger && message) logger.warn(message)
    resourceCache.set(url, null)
    return null
  }

  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT)

      const response = await fetch(url, { signal: controller.signal })

      clearTimeout(timeoutId)

      if (!response.ok) {
        return reject(
          `Skipping SRI for ${url}: the server answered ${response.status}. ` +
          'Add the domain to bypassDomains to silence this.'
        )
      }

      // Only `*` can be verified at build time. Injecting integrity also means
      // injecting crossorigin="anonymous"; if the server answers with a
      // concrete origin that does not match wherever the HTML ends up being
      // served from, that turns a working script into a blocked one.
      const corsHeader = response.headers.get('access-control-allow-origin')
      if (corsHeader !== '*') {
        return reject(
          `Skipping SRI for ${url}: Access-Control-Allow-Origin is ` +
          `${corsHeader ? `"${corsHeader}", not "*"` : 'absent'}, so crossorigin="anonymous" ` +
          'cannot be verified at build time. ' +
          'Add the domain to bypassDomains to silence this.'
        )
      }

      // Reachable and CORS-eligible is not the same property as byte-stable.
      // A hash pins one snapshot of bytes forever, so it is only safe on a URL
      // whose bytes never change - and the origin is the only party that knows.
      // Require it to say so rather than hunting for reasons to skip: a
      // blacklist of known-bad origins is never finished (Google Fonts is
      // `private`, but cdn.tailwindcss.com and plausible.io are ordinary
      // `public` responses that roll just the same), and every gap in it ships
      // a build that works today and breaks whenever the vendor deploys.
      //
      // Deliberately not `vary`: Google Fonts varies on User-Agent without
      // declaring it (`vary: Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site`),
      // so a vary-based gate would let that resource straight through.
      const cacheControl = response.headers.get('cache-control')
      if (!trusted && !isImmutableResponse(cacheControl)) {
        return reject(
          `Skipping SRI for ${url}: Cache-Control is ` +
          `${cacheControl ? `"${cacheControl}"` : 'absent'}, so the origin does not declare ` +
          'this URL immutable and its bytes may differ from the ones hashed here. Pin a ' +
          'version in the URL, or add the domain to bypassDomains to accept it unprotected. ' +
          'Only reach for trustDomains on a host you control - forcing a hash onto a ' +
          "vendor's rolling URL ships a page that breaks on their next deploy."
        )
      }

      const data = new Uint8Array(await response.arrayBuffer())
      resourceCache.set(url, data)
      return data
    } catch (error) {
      lastError = error
      if (error.name === 'AbortError') {
        return reject(`Skipping SRI for ${url}: the request timed out.`)
      }

      // Don't wait after the last failed attempt
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
      }
    }
  }

  if (logger) {
    logger.warn(`Skipping SRI for ${url}: the request failed.`, lastError)
  }
  resourceCache.set(url, null)
  return null
}
