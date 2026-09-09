import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { ResourceCache, CacheManager } from '../src/cache.js'
import { Logger } from '../src/logger.js'
import { matchesDomain } from '../src/network-utils.js'
import { findBundleKey, sriHash, bundleSource } from '../src/integrity-calculator.js'
import { injectImportmapIntegrity, transformHTML, HTML_PATTERNS } from '../src/html-parser.js'

// The plugin-level suite in index.test.js drives everything through
// generateBundle. These reach the branches that only appear at the edges:
// an expired cache entry, a log level that suppresses, a URL that will not
// parse, an HTML file with nowhere obvious to put a tag.

describe('ResourceCache', () => {
  test('returns undefined and evicts once an entry is past its TTL', () => {
    const cache = new ResourceCache(50)
    cache.set('k', 'v')
    expect(cache.get('k')).toBe('v')
    expect(cache.has('k')).toBe(true)

    vi.setSystemTime(Date.now() + 51)

    expect(cache.get('k')).toBeUndefined()
    expect(cache.has('k')).toBe(false)
  })

  test('has() is true for a stored null - a rejected resource is a cached answer', () => {
    const cache = new ResourceCache()
    cache.set('k', null)
    // fetchVerifiedResource stores null to mean "asked, and the answer is no",
    // which must not be re-fetched
    expect(cache.has('k')).toBe(true)
    expect(cache.get('k')).toBeNull()
  })

  test('clear empties the cache', () => {
    const cache = new ResourceCache()
    cache.set('k', 'v')
    cache.clear()
    expect(cache.has('k')).toBe(false)
  })

  test('CacheManager.clearAll clears the resource cache', () => {
    const manager = new CacheManager()
    manager.getResourceCache().set('k', 'v')
    manager.clearAll()
    expect(manager.getResourceCache().has('k')).toBe(false)
  })
})

describe('Logger', () => {
  const spies = {}

  beforeEach(() => {
    for (const m of ['error', 'warn', 'info', 'debug']) {
      spies[m] = vi.spyOn(console, m).mockImplementation(() => {})
    }
  })

  afterEach(() => vi.restoreAllMocks())

  test('emits every level at debug', () => {
    const logger = new Logger('debug')
    logger.error('e'); logger.warn('w'); logger.info('i'); logger.debug('d')
    for (const m of ['error', 'warn', 'info', 'debug']) {
      expect(spies[m]).toHaveBeenCalledWith('[vite-plugin-sri4] ' + m[0])
    }
  })

  test('silent suppresses everything, including errors', () => {
    const logger = new Logger('silent')
    logger.error('e'); logger.warn('w'); logger.info('i'); logger.debug('d')
    for (const m of ['error', 'warn', 'info', 'debug']) {
      expect(spies[m]).not.toHaveBeenCalled()
    }
  })

  test('warn is the default, so info and debug stay quiet', () => {
    const logger = new Logger()
    logger.error('e'); logger.warn('w'); logger.info('i'); logger.debug('d')
    expect(spies.error).toHaveBeenCalled()
    expect(spies.warn).toHaveBeenCalled()
    expect(spies.info).not.toHaveBeenCalled()
    expect(spies.debug).not.toHaveBeenCalled()
  })

  test('error level prints errors and nothing else', () => {
    const logger = new Logger('error')
    logger.error('e'); logger.warn('w'); logger.info('i'); logger.debug('d')
    expect(spies.error).toHaveBeenCalled()
    expect(spies.warn).not.toHaveBeenCalled()
    expect(spies.info).not.toHaveBeenCalled()
  })

  test('info level prints info but not debug', () => {
    const logger = new Logger('info')
    logger.info('i'); logger.debug('d')
    expect(spies.info).toHaveBeenCalled()
    expect(spies.debug).not.toHaveBeenCalled()
  })

  test('an unknown level falls back to warn rather than going silent', () => {
    const logger = new Logger('chatty')
    logger.warn('w')
    logger.debug('d')
    expect(spies.warn).toHaveBeenCalled()
    expect(spies.debug).not.toHaveBeenCalled()
  })

  test('a non-string message is passed through, not concatenated', () => {
    const logger = new Logger('debug')
    const err = new Error('boom')
    logger.error(err, 'extra')
    expect(spies.error).toHaveBeenCalledWith('[vite-plugin-sri4]', err, 'extra')
  })

  test('extra arguments survive a string message', () => {
    const logger = new Logger('debug')
    const err = new Error('boom')
    logger.warn('failed', err)
    expect(spies.warn).toHaveBeenCalledWith('[vite-plugin-sri4] failed', err)
  })
})

describe('matchesDomain', () => {
  test('matches the host and its subdomains, not a lookalike suffix', () => {
    expect(matchesDomain('https://example.com/a.js', ['example.com'])).toBe(true)
    expect(matchesDomain('https://cdn.example.com/a.js', ['example.com'])).toBe(true)
    expect(matchesDomain('https://notexample.com/a.js', ['example.com'])).toBe(false)
  })

  test('is false for a non-http URL, an empty list, or no URL', () => {
    expect(matchesDomain('/local.js', ['example.com'])).toBe(false)
    expect(matchesDomain('https://example.com/a.js', [])).toBe(false)
    expect(matchesDomain('https://example.com/a.js')).toBe(false)
    expect(matchesDomain(null, ['example.com'])).toBe(false)
    expect(matchesDomain(123, ['example.com'])).toBe(false)
  })

  test('warns and returns false for a URL that will not parse', () => {
    const logger = { warn: vi.fn() }
    // Starts with `http` so it gets past the cheap guard, then fails `new URL`
    expect(matchesDomain('http://[bad', ['example.com'], logger)).toBe(false)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid URL'),
      expect.any(Error)
    )
  })
})

describe('findBundleKey', () => {
  const bundle = { 'assets/main-abc.js': {}, 'nested/assets/main-abc.js': {} }

  test('warns when more than one bundle key matches, and takes the first', () => {
    const logger = { warn: vi.fn() }
    expect(findBundleKey(bundle, 'assets/main-abc.js', logger)).toBe('assets/main-abc.js')
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Ambiguous bundle key'))
  })

  test('returns undefined when nothing matches', () => {
    expect(findBundleKey(bundle, 'missing.js', { warn: vi.fn() })).toBeUndefined()
  })
})

describe('sriHash and bundleSource', () => {
  test('hashes strings and byte arrays to the same value', () => {
    const fromString = sriHash('abc', 'sha384')
    const fromBytes = sriHash(new Uint8Array([97, 98, 99]), 'sha384')
    expect(fromString).toBe(fromBytes)
    expect(fromString).toMatch(/^sha384-/)
  })

  test('reads code from a chunk and source from an asset', () => {
    expect(bundleSource({ type: 'chunk', code: 'x' })).toBe('x')
    expect(bundleSource({ type: 'asset', source: 'y' })).toBe('y')
  })
})

describe('injectImportmapIntegrity', () => {
  const logger = { warn: vi.fn(), debug: vi.fn() }
  const map = { '/a.js': 'sha384-x' }

  beforeEach(() => vi.clearAllMocks())

  test('returns the HTML untouched when there is nothing to inject', () => {
    expect(injectImportmapIntegrity('<html></html>', {}, logger)).toBe('<html></html>')
    expect(injectImportmapIntegrity('', map, logger)).toBe('')
    expect(injectImportmapIntegrity(null, map, logger)).toBeNull()
    expect(injectImportmapIntegrity(42, map, logger)).toBe(42)
  })

  test('refuses to inject over an import map the page already has', () => {
    const html = '<script type="importmap">{}</script>'
    expect(injectImportmapIntegrity(html, map, logger)).toBe(html)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('already contains an import map'))
  })

  test('injects before the first script', () => {
    const out = injectImportmapIntegrity('<head></head><script src="a.js"></script>', map, logger)
    expect(out.indexOf('type="importmap"')).toBeLessThan(out.indexOf('src="a.js"'))
  })

  test('falls back to </head> when the page has no script', () => {
    const out = injectImportmapIntegrity('<head><title>t</title></head>', map, logger)
    expect(out.indexOf('type="importmap"')).toBeLessThan(out.indexOf('</head>'))
  })

  test('appends when there is neither a script nor a head to anchor on', () => {
    const out = injectImportmapIntegrity('<p>hi</p>', map, logger)
    expect(out.startsWith('<p>hi</p>')).toBe(true)
    expect(out).toContain('type="importmap"')
  })

  test('escapes `<` so a file name cannot close the script element early', () => {
    const out = injectImportmapIntegrity('<head></head>', { '/a</script>.js': 'sha384-x' }, logger)
    expect(out).not.toContain('</script>.js')
    expect(out).toContain('\\u003c')
  })
})

describe('HTML_PATTERNS.getUrl', () => {
  test('reads an attribute however it is quoted', () => {
    const { script, link } = HTML_PATTERNS

    expect(script.getUrl('<script src="a.js"></script>')).toBe('a.js')
    expect(script.getUrl("<script src='a.js'></script>")).toBe('a.js')
    expect(script.getUrl('<script src=a.js></script>')).toBe('a.js')
    expect(script.getUrl('<script></script>')).toBeNull()

    expect(link.getUrl('<link rel="stylesheet" href="a.css">')).toBe('a.css')
    expect(link.getUrl("<link rel='modulepreload' href='a.js'>")).toBe('a.js')
    expect(link.getUrl('<link rel=stylesheet href=a.css>')).toBe('a.css')
  })

  test('ignores a link whose rel carries no integrity', () => {
    expect(HTML_PATTERNS.link.getUrl('<link rel="preconnect" href="https://x">')).toBeNull()
    expect(HTML_PATTERNS.link.getUrl('<link href="a.css">')).toBeNull()
  })

  test('rel is matched case- and whitespace-insensitively', () => {
    expect(HTML_PATTERNS.link.getUrl('<link rel=" StyleSheet " href="a.css">')).toBe('a.css')
  })
})

const immutableResponse = () => ({
  ok: true,
  headers: new Map([
    ['access-control-allow-origin', '*'],
    ['cache-control', 'public, max-age=31536000, immutable']
  ]),
  arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer)
})

describe('fetchVerifiedResource', () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)

  let fetchVerifiedResource

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.useRealTimers()
    ;({ fetchVerifiedResource } = await import('../src/network-utils.js'))
  })

  test('serves a repeat URL from cache without asking the network again', async () => {
    const cache = new ResourceCache()
    fetchMock.mockImplementation(() => Promise.resolve(immutableResponse()))

    const logger = { warn: vi.fn() }
    const first = await fetchVerifiedResource('https://cdn.example.com/a.js', cache, logger)
    const second = await fetchVerifiedResource('https://cdn.example.com/a.js', cache, logger)

    expect(first).toEqual(new Uint8Array([1, 2, 3]))
    expect(second).toEqual(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('caches a rejection too, so a bad URL is not re-fetched', async () => {
    const cache = new ResourceCache()
    const logger = { warn: vi.fn() }
    fetchMock.mockImplementation(() => Promise.resolve({ ok: false, status: 404 }))

    expect(await fetchVerifiedResource('https://cdn.example.com/gone.js', cache, logger)).toBeNull()
    expect(await fetchVerifiedResource('https://cdn.example.com/gone.js', cache, logger)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('trusted skips the immutability gate but not the CORS one', async () => {
    const cache = new ResourceCache()
    const logger = { warn: vi.fn() }
    fetchMock.mockImplementation(() => Promise.resolve({
      ok: true,
      headers: new Map([['access-control-allow-origin', 'https://elsewhere.example']]),
      arrayBuffer: () => Promise.resolve(new Uint8Array([1]).buffer)
    }))

    expect(await fetchVerifiedResource('https://cdn.example.com/a.js', cache, logger, true)).toBeNull()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Access-Control-Allow-Origin'))
  })

  test('retries a network error, then gives up and says so', async () => {
    const cache = new ResourceCache()
    const logger = { warn: vi.fn() }
    fetchMock.mockImplementation(() => Promise.reject(new Error('ECONNRESET')))

    expect(await fetchVerifiedResource('https://cdn.example.com/a.js', cache, logger, false, 1)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('the request failed'),
      expect.any(Error)
    )
  })

  test('recovers when a retry succeeds', async () => {
    const cache = new ResourceCache()
    fetchMock
      .mockImplementationOnce(() => Promise.reject(new Error('ECONNRESET')))
      .mockImplementationOnce(() => Promise.resolve(immutableResponse()))

    expect(await fetchVerifiedResource('https://cdn.example.com/a.js', cache, { warn: vi.fn() }, false, 1))
      .toEqual(new Uint8Array([1, 2, 3]))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test.each([
    ['no-store', 'public, max-age=31536000, no-store'],
    ['bare private', 'private, max-age=31536000, immutable'],
    ['qualified private', 'private="set-cookie", max-age=31536000'],
    ['bare no-cache', 'no-cache, max-age=31536000'],
    ['qualified no-cache', 'no-cache="set-cookie", max-age=31536000']
  ])('%s vetoes an otherwise immutable response', async (_label, cacheControl) => {
    const cache = new ResourceCache()
    const logger = { warn: vi.fn() }
    fetchMock.mockImplementation(() => Promise.resolve({
      ok: true,
      headers: new Map([
        ['access-control-allow-origin', '*'],
        ['cache-control', cacheControl]
      ]),
      arrayBuffer: () => Promise.resolve(new Uint8Array([1]).buffer)
    }))

    expect(await fetchVerifiedResource('https://cdn.example.com/a.js', cache, logger)).toBeNull()
  })

  test.each([
    ['immutable alone, with a short max-age', 'public, max-age=60, immutable'],
    ['a year-long max-age alone', 'public, max-age=31536000'],
    ['a quoted year-long max-age', 'public, max-age="31536000"'],
    ['more than a year', 'public, max-age=30672000, immutable']
  ])('%s is enough on its own', async (_label, cacheControl) => {
    const cache = new ResourceCache()
    fetchMock.mockImplementation(() => Promise.resolve({
      ok: true,
      headers: new Map([
        ['access-control-allow-origin', '*'],
        ['cache-control', cacheControl]
      ]),
      arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer)
    }))

    expect(await fetchVerifiedResource('https://cdn.example.com/a.js', cache, { warn: vi.fn() }))
      .toEqual(new Uint8Array([1, 2, 3]))
  })

  test('a max-age just under a year is not immutable enough', async () => {
    const cache = new ResourceCache()
    fetchMock.mockImplementation(() => Promise.resolve({
      ok: true,
      headers: new Map([
        ['access-control-allow-origin', '*'],
        ['cache-control', 'public, max-age=31535999']
      ]),
      arrayBuffer: () => Promise.resolve(new Uint8Array([1]).buffer)
    }))

    expect(await fetchVerifiedResource('https://cdn.example.com/a.js', cache, { warn: vi.fn() })).toBeNull()
  })

  test('does not retry a timeout', async () => {
    const cache = new ResourceCache()
    const logger = { warn: vi.fn() }
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    fetchMock.mockImplementation(() => Promise.reject(abort))

    expect(await fetchVerifiedResource('https://cdn.example.com/a.js', cache, logger, false, 2)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('timed out'))
  })
})

describe('fetchVerifiedResource timeout', () => {
  test('aborts a request that never settles', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { fetchVerifiedResource } = await import('../src/network-utils.js')

    // Resolve only when the AbortController fires, which is what the real
    // fetch does - this pins that the timeout is actually wired to a signal.
    fetchMock.mockImplementation((_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => {
        const err = new Error('aborted')
        err.name = 'AbortError'
        reject(err)
      })
    }))

    const logger = { warn: vi.fn() }
    const promise = fetchVerifiedResource('https://cdn.example.com/slow.js', new ResourceCache(), logger)
    await vi.advanceTimersByTimeAsync(5000)

    expect(await promise).toBeNull()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('timed out'))
    vi.useRealTimers()
  })
})

describe('transformHTML input guard', () => {
  const logger = { warn: vi.fn(), debug: vi.fn() }
  const opts = { hashAlgorithm: 'sha384', crossorigin: 'anonymous', bypassDomains: [], trustDomains: [] }

  beforeEach(() => vi.clearAllMocks())

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['a number', 42],
    ['an object', {}]
  ])('returns %s unchanged and warns', async (_label, input) => {
    const out = await transformHTML({}, 'index.html', input, opts, { base: '/' }, null, logger)
    expect(out).toBe(input)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid HTML content'))
  })
})
