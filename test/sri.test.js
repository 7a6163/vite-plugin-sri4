import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { build } from 'vite'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, realpathSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sri from '../src/index.js'

const sha384 = source =>
  `sha384-${createHash('sha384').update(source).digest('base64')}`

let root

beforeAll(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'sri4-')))
  mkdirSync(path.join(root, 'routes'))

  // A self-closing link and a rel-after-href link: both are valid HTML and
  // both must be picked up.
  writeFileSync(path.join(root, 'index.html'), `<!doctype html>
<html>
  <head>
    <link href="/style.css" rel="stylesheet" />
  </head>
  <body>
    <script type="module" src="/main.js"></script>
  </body>
</html>
`)
  writeFileSync(path.join(root, 'style.css'), 'body { color: red }\n')
  // The dynamic import is the case static HTML rewriting cannot cover
  writeFileSync(path.join(root, 'main.js'), `
    document.body.addEventListener('click', () => import('./routes/about.js'))
  `)
  writeFileSync(path.join(root, 'routes', 'about.js'), 'export const about = "about"\n')

  // Files copied verbatim from public/ never become bundle entries
  mkdirSync(path.join(root, 'public'))
  writeFileSync(path.join(root, 'public', 'sw.js'), 'self.addEventListener("fetch", () => {})\n')
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

async function buildWith(options, viteConfig = {}) {
  const result = await build({
    root,
    logLevel: 'silent',
    plugins: [sri(options)],
    build: { write: false },
    ...viteConfig
  })

  const output = Array.isArray(result) ? result[0].output : result.output
  const byName = Object.fromEntries(output.map(o => [o.fileName, o]))
  const html = output.find(o => o.fileName === 'index.html').source
  return { output, byName, html }
}

describe('real vite build', () => {
  test('injects integrity matching the actual emitted bytes', async () => {
    const { byName, html } = await buildWith({})

    const jsFile = Object.keys(byName).find(f => f.endsWith('.js'))
    const cssFile = Object.keys(byName).find(f => f.endsWith('.css'))
    expect(jsFile).toBeTruthy()
    expect(cssFile).toBeTruthy()

    // The hash in the HTML must be the hash of what actually shipped,
    // otherwise the browser refuses the resource.
    expect(html).toContain(sha384(byName[jsFile].code))
    expect(html).toContain(sha384(byName[cssFile].source))
    // Vite already emits `crossorigin` here; the point is every hashed tag
    // carries one, whoever put it there.
    for (const tag of html.match(/<(?:script|link)\b[^>]*integrity=[^>]*>/g)) {
      expect(tag).toMatch(/\scrossorigin/)
    }
  })

  test('hashes its own output from the bundle when base is a CDN', async () => {
    // The scenario SRI exists for. These URLs are absolute, but fetching them
    // would hit a CDN that has not been deployed yet - they must resolve to the
    // bundle instead.
    const { byName, html } = await buildWith({}, { base: 'https://cdn.example.com/' })

    const jsFile = Object.keys(byName).find(f => f.endsWith('.js'))
    expect(html).toContain('https://cdn.example.com/')
    expect(html).toContain(sha384(byName[jsFile].code))
  })

  test('does not duplicate the crossorigin Vite already emitted', async () => {
    const { html } = await buildWith({})

    for (const tag of html.match(/<(?:script|link)\b[^>]*>/g)) {
      expect(tag.match(/crossorigin/g)?.length ?? 0).toBeLessThan(2)
    }
  })

  test('emits a manifest covering every non-HTML output', async () => {
    const { output, byName } = await buildWith({ manifest: true })

    const manifest = output.find(o => o.fileName === 'sri-manifest.json')
    expect(manifest).toBeTruthy()

    const hashes = JSON.parse(manifest.source)
    expect(Object.keys(hashes).length).toBeGreaterThan(0)
    expect(hashes['sri-manifest.json']).toBeUndefined()

    for (const [fileName, integrity] of Object.entries(hashes)) {
      const item = byName[fileName]
      expect(integrity).toBe(sha384(item.type === 'chunk' ? item.code : item.source))
    }
  })

  test('covers dynamically imported chunks via the import map', async () => {
    const { byName, html } = await buildWith({ importmap: true })

    const map = JSON.parse(html.match(/<script type="importmap">(.+?)<\/script>/s)[1])

    // The route chunk has no tag in the HTML - the import map is the only
    // thing that can protect it.
    const routeChunk = Object.values(byName).find(
      o => o.type === 'chunk' && !o.isEntry && o.fileName.endsWith('.js')
    )
    expect(routeChunk).toBeTruthy()
    expect(map.integrity[`/${routeChunk.fileName}`]).toBe(sha384(routeChunk.code))

    // and it must precede every module script or it does not apply to them
    expect(html.indexOf('type="importmap"')).toBeLessThan(html.indexOf('type="module"'))

    // CSS is not a module: it belongs on the tag, not in the import map
    expect(Object.keys(map.integrity).every(k => k.endsWith('.js'))).toBe(true)
  })
})

// Regressions. These are the failure modes that ship a green build and only
// break in the browser, so each one is pinned.
const analysisPlugin = () => ({ name: 'vite:build-import-analysis', generateBundle() {} })

const run = async (options, bundle, config = {}) => {
  const plugin = sri({ logLevel: 'silent', ...options })
  const resolved = { base: '/', plugins: [analysisPlugin()], ...config }
  plugin.configResolved(resolved)
  await resolved.plugins[0].generateBundle.call({ emitFile() {} }, {}, bundle)
  return bundle
}

const html = source => ({ type: 'asset', fileName: 'index.html', source })
const chunk = (fileName, code) => ({ type: 'chunk', fileName, code })

describe('regressions', () => {

  test('never matches a bundle key across a filename boundary', async () => {
    const bundle = {
      'index.html': html('<script src="/main.js"></script>'),
      'assets/vendor-main.js': chunk('assets/vendor-main.js', 'wrong')
    }

    // `main.js` used to suffix-match `vendor-main.js` and inject its hash
    await expect(run({}, bundle)).rejects.toThrow(/not found in bundle/)
  })

  test('still matches a hashed filename through a path boundary', async () => {
    const bundle = {
      'index.html': html('<script src="/main.js"></script>'),
      'assets/main.js': chunk('assets/main.js', 'console.log(1)')
    }

    await run({}, bundle)
    expect(bundle['index.html'].source).toContain(sha384('console.log(1)'))
  })

  test('keeps a self-closing tag well-formed', async () => {
    const bundle = {
      'index.html': html('<link rel="stylesheet" href="/a.css" />'),
      'a.css': { type: 'asset', fileName: 'a.css', source: 'a{}' }
    }

    await run({}, bundle)
    // used to produce `<link ... / integrity="...">`
    expect(bundle['index.html'].source).not.toMatch(/\/\s+integrity=/)
    expect(bundle['index.html'].source).toMatch(/crossorigin="anonymous" \/>$/)
  })

  test('does not add a second crossorigin to a valueless one', async () => {
    const bundle = {
      'index.html': html('<script crossorigin src="/main.js"></script>'),
      'main.js': chunk('main.js', 'console.log(1)')
    }

    await run({}, bundle)
    expect(bundle['index.html'].source.match(/crossorigin/g)).toHaveLength(1)
    expect(bundle['index.html'].source).toContain('integrity=')
  })

  test('reads link attributes regardless of order', async () => {
    const bundle = {
      'index.html': html('<link href="/a.css" rel="stylesheet">'),
      'a.css': { type: 'asset', fileName: 'a.css', source: 'a{}' }
    }

    await run({}, bundle)
    expect(bundle['index.html'].source).toContain(sha384('a{}'))
  })

  test('skips URLs that are not bundle assets instead of failing', async () => {
    const bundle = {
      'index.html': html(
        '<script src="data:text/javascript,void 0"></script>' +
        '<script src="//cdn.example.com/x.js"></script>'
      )
    }

    await run({}, bundle)
    expect(bundle['index.html'].source).not.toMatch(/integrity=/)
  })

  test('resolves an asset URL carrying a query string', async () => {
    const bundle = {
      'index.html': html('<script src="/main.js?v=1"></script>'),
      'main.js': chunk('main.js', 'console.log(1)')
    }

    await run({}, bundle)
    expect(bundle['index.html'].source).toContain(sha384('console.log(1)'))
  })

  test('handles an HTML asset whose source is a Uint8Array', async () => {
    const source = new TextEncoder().encode('<script src="/main.js"></script>')
    const bundle = {
      'index.html': { type: 'asset', fileName: 'index.html', source },
      'main.js': chunk('main.js', 'console.log(1)')
    }

    await run({}, bundle)
    expect(bundle['index.html'].source).toContain(sha384('console.log(1)'))
  })

  test('emits the manifest for a build with no HTML at all (SSR)', async () => {
    const emitted = []
    const plugin = sri({ manifest: true, logLevel: 'silent' })
    const config = { base: '/', plugins: [analysisPlugin()] }
    plugin.configResolved(config)

    await config.plugins[0].generateBundle.call(
      { emitFile: file => emitted.push(file) },
      {},
      { 'entry-server.js': chunk('entry-server.js', 'export default 1') }
    )

    expect(JSON.parse(emitted[0].source)['entry-server.js']).toBe(sha384('export default 1'))
  })

  test('fails the build if a later plugin rewrites hashed content', async () => {
    const plugin = sri({ logLevel: 'silent' })
    const config = { base: '/', plugins: [analysisPlugin()] }
    plugin.configResolved(config)

    const bundle = {
      'index.html': html('<script src="/main.js"></script>'),
      'main.js': chunk('main.js', 'console.log(1)')
    }
    await config.plugins[0].generateBundle.call({ emitFile() {} }, {}, bundle)
    expect(bundle['index.html'].source).toContain(sha384('console.log(1)'))

    // A plugin ordered after this one rewrites the chunk. Without this check
    // the build stays green and only the browser rejects the file.
    bundle['main.js'].code = 'console.log(2)'
    expect(() => plugin.writeBundle({}, bundle)).toThrow(/content changed after integrity/)
  })

  test('writeBundle stays quiet when nothing drifted', async () => {
    const plugin = sri({ logLevel: 'silent' })
    const config = { base: '/', plugins: [analysisPlugin()] }
    plugin.configResolved(config)

    const bundle = {
      'index.html': html('<script src="/main.js"></script>'),
      'main.js': chunk('main.js', 'console.log(1)')
    }
    await config.plugins[0].generateBundle.call({ emitFile() {} }, {}, bundle)

    expect(() => plugin.writeBundle({}, bundle)).not.toThrow()
  })

  test('is not fooled by a decoy data-src / data-href attribute', async () => {
    const bundle = {
      'index.html': html(
        '<script data-src="/track.js" src="/main.js"></script>' +
        '<link data-href="/x.css" rel="stylesheet" href="/a.css">'
      ),
      'main.js': chunk('main.js', 'console.log(1)'),
      'a.css': { type: 'asset', fileName: 'a.css', source: 'a{}' }
    }

    await run({}, bundle)
    expect(bundle['index.html'].source).toContain(sha384('console.log(1)'))
    expect(bundle['index.html'].source).toContain(sha384('a{}'))
  })

  test('runs once when both analysis plugin names are present', async () => {
    const emitted = []
    const plugin = sri({ manifest: true, importmap: true, logLevel: 'silent' })
    const config = {
      base: '/',
      plugins: [
        { name: 'vite:build-import-analysis', generateBundle() {} },
        { name: 'native:import-analysis-build', generateBundle() {} }
      ]
    }
    plugin.configResolved(config)

    const bundle = {
      'index.html': html('<script type="module" src="/main.js"></script>'),
      'main.js': chunk('main.js', 'console.log(1)')
    }
    const ctx = { emitFile: f => emitted.push(f) }
    for (const p of config.plugins) await p.generateBundle.call(ctx, {}, bundle)

    // A duplicate fileName makes Rollup throw, and the second import map pass
    // warns about the map it just injected.
    expect(emitted.map(f => f.fileName)).toEqual(['sri-manifest.json'])
    expect(bundle['index.html'].source.match(/type="importmap"/g)).toHaveLength(1)
  })

  test('does not claim drift for a tag it never touched', async () => {
    const plugin = sri({ logLevel: 'silent' })
    const config = { base: '/', plugins: [analysisPlugin()] }
    plugin.configResolved(config)

    const bundle = {
      'index.html': html('<script src="/main.js" integrity="sha384-theirs"></script>'),
      'main.js': chunk('main.js', 'console.log(1)')
    }
    await config.plugins[0].generateBundle.call({ emitFile() {} }, {}, bundle)
    expect(bundle['index.html'].source).toContain('sha384-theirs')

    // The tag kept its own hash, so a later rewrite of this chunk is not our
    // problem and must not fail the build.
    bundle['main.js'].code = 'console.log(2)'
    expect(() => plugin.writeBundle({}, bundle)).not.toThrow()
  })

  test('hashes an asset that lives in publicDir, not the bundle', async () => {
    const bundle = { 'index.html': html('<script src="/sw.js"></script>') }

    await run({}, bundle, { publicDir: path.join(root, 'public') })

    const source = readFileSync(path.join(root, 'public', 'sw.js'))
    expect(bundle['index.html'].source).toContain(sha384(source))
  })

  test('refuses to read outside publicDir', async () => {
    const bundle = { 'index.html': html('<script src="/../../etc/passwd"></script>') }

    // Escaping publicDir must not resolve; with the default policy that is a
    // build failure, never a hash of a file outside the project.
    await expect(run({}, bundle, { publicDir: path.join(root, 'public') }))
      .rejects.toThrow(/not found in bundle or publicDir/)
  })

  test('leaves a skip-sri tag alone and strips the marker', async () => {
    const bundle = {
      'index.html': html('<script skip-sri src="/main.js"></script><script src="/a.js"></script>'),
      'main.js': chunk('main.js', 'console.log(1)'),
      'a.js': chunk('a.js', 'console.log(2)')
    }

    await run({}, bundle)
    const out = bundle['index.html'].source

    expect(out).not.toContain('skip-sri')
    expect(out).not.toContain(sha384('console.log(1)'))
    // the neighbouring tag is untouched by the opt-out
    expect(out).toContain(sha384('console.log(2)'))
  })

  test('uses the configured crossorigin value', async () => {
    const bundle = {
      'index.html': html('<script src="/main.js"></script>'),
      'main.js': chunk('main.js', 'console.log(1)')
    }

    await run({ crossorigin: 'use-credentials' }, bundle)
    expect(bundle['index.html'].source).toContain('crossorigin="use-credentials"')
  })

  test('caches survive until closeBundle', () => {
    const plugin = sri()
    expect(plugin.buildEnd).toBeUndefined()
    expect(typeof plugin.closeBundle).toBe('function')
  })
})
