import { createHash } from 'crypto'
import path from 'path'
import fetch from 'cross-fetch'

const VITE_INTERNAL_ANALYSIS_PLUGIN = 'vite:build-import-analysis'
const HTML_PATTERNS = {
  script: {
    regex: /<script[^<>]*['"]*src['"]*=['"]*([^ '"]+)['"]*[^<>]*><\/script>/g,
    endOffset: 10
  },
  stylesheet: {
    regex: /<link[^<>]*['"]*rel['"]*=['"]*stylesheet['"]*[^<>]+['"]*href['"]*=['"]([^^ '"]+)['"][^<>]*>/g,
    endOffset: 1
  },
  modulepreload: {
    regex: /<link[^<>]*['"]*rel['"]*=['"]*modulepreload['"]*[^<>]+['"]*href['"]*=['"]([^^ '"]+)['"][^<>]*>/g,
    endOffset: 1
  }
}

const urlSupportCache = new Map()

function isUrlFromBypassDomain(url, bypassDomains = []) {
  if (!url.startsWith('http')) return false
  try {
    const urlObj = new URL(url)
    return bypassDomains.some(domain =>
      urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`)
    )
  } catch {
    return false
  }
}

async function checkResourceSupport(url) {
  if (urlSupportCache.has(url)) {
    return urlSupportCache.get(url)
  }

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      timeout: 5000
    })
    const corsHeader = response.headers.get('access-control-allow-origin')
    const isSupported = response.ok && (corsHeader === '*' || corsHeader?.includes('*'))
    urlSupportCache.set(url, isSupported)
    return isSupported
  } catch {
    urlSupportCache.set(url, false)
    return false
  }
}

async function fetchResource(url) {
  try {
    const response = await fetch(url, { timeout: 5000 })
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  } catch (error) {
    console.warn(`[vite-plugin-sri4] Failed to fetch external resource: ${url}`, error)
    return null
  }
}

function createTransformer(options, config) {
  const { ignoreMissingAsset, bypassDomains, hashAlgorithm = 'sha384' } = options

  const getBundleKey = (htmlPath, url) => {
    if (config.base === './' || config.base === '') {
      return path.posix.resolve(htmlPath, url)
    }
    return url.replace(config.base, '')
  }

  const calculateIntegrity = async (bundle, htmlPath, url) => {
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
      const bundleItem = bundle[getBundleKey(htmlPath, url)]
      if (!bundleItem) {
        if (ignoreMissingAsset) return null
        throw new Error(`Asset ${url} not found in bundle`)
      }
      source = bundleItem.type === 'chunk' ? bundleItem.code : bundleItem.source
    }

    return `${hashAlgorithm}-${createHash(hashAlgorithm).update(source).digest('base64')}`
  }

  const transformHTML = async (bundle, htmlPath, html) => {
    const changes = []

    for (const { regex, endOffset } of Object.values(HTML_PATTERNS)) {
      const matches = [...html.matchAll(regex)]
      for (const match of matches) {
        const [, url] = match
        const end = match.index + match[0].length

        const integrity = await calculateIntegrity(bundle, htmlPath, url)
        if (integrity) {
          changes.push({
            integrity,
            position: end - endOffset
          })
        }
      }
    }

    changes.sort((a, b) => b.position - a.position)

    for (const { integrity, position } of changes) {
      const insertText = ` integrity="${integrity}"`
      html = html.slice(0, position) + insertText + html.slice(position)
    }

    return html
  }

  return { transformHTML, calculateIntegrity }
}

export function sri(options = {}) {
  const {
    ignoreMissingAsset = false,
    bypassDomains = [],
    hashAlgorithm = 'sha384'
  } = options

  return {
    name: 'vite-plugin-sri4',
    enforce: 'post',
    apply: 'build',
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

        await Promise.all(
          htmlFiles.map(async ([name, chunk]) => {
            chunk.source = await transformer.transformHTML(bundle, name, chunk.source.toString())
          })
        )
      }

      const plugin = config.plugins.find(p => p.name === VITE_INTERNAL_ANALYSIS_PLUGIN)
      if (!plugin) {
        throw new Error('vite-plugin-sri4 requires Vite 2.0.0 or higher')
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
