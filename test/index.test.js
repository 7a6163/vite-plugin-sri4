import { describe, test, expect, vi, beforeEach } from 'vitest'
import { sri } from '../src/index.js'
import { createHash } from 'crypto'
import fetch from 'cross-fetch'

vi.mock('cross-fetch')
vi.mock('crypto')

describe('vite-plugin-sri4', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    createHash.mockReturnValue({
      update: vi.fn().mockReturnThis(),
      digest: vi.fn().mockReturnValue(Buffer.from('mockedHash'))
    })
  })

  test('should create plugin with default options', () => {
    const plugin = sri()
    expect(plugin.name).toBe('vite-plugin-sri4')
    expect(plugin.enforce).toBe('post')
    expect(plugin.apply).toBe('build')
  })

  describe('HTML transformation', () => {
    let plugin
    let config
    let bundle
    let generateBundleFn

    beforeEach(() => {
      plugin = sri()
      config = {
        base: '/',
        plugins: [{
          name: 'vite:build-import-analysis',
          generateBundle: vi.fn()
        }]
      }
      bundle = {
        'index.html': {
          type: 'asset',
          fileName: 'index.html',
          source: '<script src="main.js"></script>'
        },
        'main.js': {
          type: 'chunk',
          fileName: 'main.js',
          code: 'console.log("test")'
        }
      }

      plugin.configResolved(config)
      generateBundleFn = config.plugins[0].generateBundle
    })

    test('should transform local scripts', async () => {
      await generateBundleFn({}, bundle)
      expect(bundle['index.html'].source).toMatch(/integrity="sha384-/)
    })

    test('should handle external resources', async () => {
      bundle['index.html'].source = '<script src="https://example.com/script.js"></script>'

      fetch
        .mockImplementationOnce(() => Promise.resolve({
          ok: true,
          headers: new Headers({
            'access-control-allow-origin': '*'
          })
        }))
        .mockImplementationOnce(() => Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]))
        }))

      await generateBundleFn({}, bundle)

      expect(fetch).toHaveBeenCalledWith(
        'https://example.com/script.js',
        expect.any(Object)
      )
      expect(bundle['index.html'].source).toMatch(/integrity="sha384-/)
    })

    test('should handle multiple resources', async () => {
      bundle['index.html'].source = `
        <script src="main.js"></script>
        <link rel="stylesheet" href="style.css">
        <link rel="modulepreload" href="module.js">
      `
      bundle['style.css'] = {
        type: 'asset',
        fileName: 'style.css',
        source: 'body { color: red; }'
      }
      bundle['module.js'] = {
        type: 'chunk',
        fileName: 'module.js',
        code: 'export default {}'
      }

      await generateBundleFn({}, bundle)

      const html = bundle['index.html'].source
      const matches = html.match(/integrity="sha384-/g)
      expect(matches).toHaveLength(3)
    })
  })

  describe('Error handling', () => {
    test('should throw error if vite plugin not found', () => {
      const plugin = sri()
      const config = {
        plugins: []
      }
      expect(() => plugin.configResolved(config)).toThrow(/vite-plugin-sri4 requires/)
    })

    test('should handle missing assets when ignoreMissingAsset is false', async () => {
      const plugin = sri({ ignoreMissingAsset: false })
      const config = {
        base: '/',
        plugins: [{
          name: 'vite:build-import-analysis',
          generateBundle: vi.fn()
        }]
      }
      const bundle = {
        'index.html': {
          type: 'asset',
          fileName: 'index.html',
          source: '<script src="missing.js"></script>'
        }
      }

      plugin.configResolved(config)
      const generateBundle = config.plugins[0].generateBundle

      await expect(() => generateBundle({}, bundle)).rejects.toThrow(/Asset .* not found/)
    })

    test('should skip missing assets when ignoreMissingAsset is true', async () => {
      const plugin = sri({ ignoreMissingAsset: true })
      const config = {
        base: '/',
        plugins: [{
          name: 'vite:build-import-analysis',
          generateBundle: vi.fn()
        }]
      }
      const bundle = {
        'index.html': {
          type: 'asset',
          fileName: 'index.html',
          source: '<script src="missing.js"></script>'
        }
      }

      plugin.configResolved(config)
      const generateBundle = config.plugins[0].generateBundle

      await generateBundle({}, bundle)
      expect(bundle['index.html'].source).not.toMatch(/integrity=/)
    })
  })
})
