import { createHash } from 'node:crypto';
import fetch from 'cross-fetch';

const LOG_PREFIX = '[vite-plugin-sri4]';

const DEFAULT_OPTIONS = {
  algorithm: 'sha384',
  bypassDomains: [],
  crossorigin: 'anonymous',
  debug: false
};

/**
 * Log debug messages if debug mode is enabled
 * @param {string} message - Message to log
 * @param {Object} options - Plugin options
 */
function log(message, options) {
  if (options.debug) {
    console.log(`${LOG_PREFIX} ${message}`);
  }
}

/**
 * Compute SRI hash for given content
 * @param {string|Buffer} content - Content to hash
 * @param {string} algorithm - Hash algorithm to use
 * @returns {string|null} SRI hash string or null if failed
 */
function computeSri(content, algorithm = 'sha384') {
  try {
    const hash = createHash(algorithm)
      .update(content)
      .digest('base64');
    return `${algorithm}-${hash}`;
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to compute SRI hash: ${error}`);
    return null;
  }
}

/**
 * Check if external resource has CORS enabled
 * @param {string} url - URL to check
 * @param {Object} options - Plugin options
 * @returns {Promise<boolean>} Whether CORS is enabled
 */
async function externalResourceIsCorsEnabled(url, options) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      timeout: 5000
    });
    const acao = response.headers.get('access-control-allow-origin');
    if (acao && (acao === '*' || acao.includes(options.domain || ''))) {
      return true;
    }
    return false;
  } catch (error) {
    log(`Failed to fetch CORS headers from ${url}: ${error}`, options);
    return false;
  }
}

/**
 * Check if URL belongs to bypass domains
 * @param {string} url - URL to check
 * @param {string[]} bypassDomains - List of domains to bypass
 * @returns {boolean} Whether URL belongs to bypass domains
 */
function isBypassDomain(url, bypassDomains = []) {
  if (!bypassDomains.length) return false;
  try {
    const parsedUrl = url.startsWith('//')
      ? new URL(`http:${url}`)
      : new URL(url, 'http://dummy');
    return bypassDomains.some(
      (domain) => parsedUrl.hostname === domain ||
                 parsedUrl.hostname.endsWith(`.${domain}`)
    );
  } catch (e) {
    return false;
  }
}

/**
 * Check if tag already has crossorigin attribute
 * @param {string} tag - HTML tag to check
 * @returns {boolean} Whether tag has crossorigin attribute
 */
function hasCrossOriginAttr(tag) {
  return /(?:^|\s)crossorigin(?:=["']?[^"'\s>]*["']?)?(?:\s|>|$)/i.test(tag);
}

/**
 * Process individual HTML tags and add SRI attributes
 * @param {string} tag - HTML tag to process
 * @param {string} url - Resource URL
 * @param {Object} options - Plugin options
 * @param {Map} sriMap - Map of file names to SRI hashes
 * @returns {Promise<string>} Processed HTML tag
 */
async function processTag(tag, url, options, sriMap) {
  if (tag.includes('integrity=')) {
    log(`Skip tag with existing integrity attribute: ${tag}`, options);
    return tag;
  }

  // Handle external resources
  if (/^(https?:)?\/\//i.test(url)) {
    if (isBypassDomain(url, options.bypassDomains)) {
      log(`Skip SRI for bypass domain: ${url}`, options);
      return tag;
    }

    const corsOk = await externalResourceIsCorsEnabled(url, options);
    if (!corsOk) {
      log(`External resource ${url} does not support CORS`, options);
      return tag;
    }

    try {
      const response = await fetch(url);
      const content = await response.arrayBuffer();
      const hash = computeSri(Buffer.from(content), options.algorithm);
      if (hash) {
        log(`Computing SRI for external resource ${url}: ${hash}`, options);
        const hasCrossOrigin = hasCrossOriginAttr(tag);
        const crossOriginAttr = hasCrossOrigin ? '' : ` crossorigin="${options.crossorigin}"`;
        return tag.replace(/>$/, ` integrity="${hash}"${crossOriginAttr}>`);
      }
    } catch (error) {
      log(`Failed to process external resource ${url}: ${error}`, options);
    }
    return tag;
  }

  // Handle local resources
  const fileName = url.startsWith('/') ? url.slice(1) : url;
  const integrity = sriMap.get(fileName);
  if (integrity) {
    log(`Using precomputed SRI for ${fileName}: ${integrity}`, options);
    const hasCrossOrigin = hasCrossOriginAttr(tag);
    const crossOriginAttr = hasCrossOrigin ? '' : ` crossorigin="${options.crossorigin}"`;
    return tag.replace(/>$/, ` integrity="${integrity}"${crossOriginAttr}>`);
  }

  log(`No SRI hash found for ${fileName}`, options);
  return tag;
}

/**
 * Vite plugin for adding Subresource Integrity (SRI) hashes to assets
 * @param {Object} userOptions - Plugin options
 * @returns {import('vite').Plugin} Vite plugin object
 */
export default function sri(userOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...userOptions };
  const sriMap = new Map();
  let isBuild = false;

  return {
    name: 'vite-plugin-sri4',
    apply: 'build',
    enforce: 'post',

    configResolved(config) {
      options.domain = config.server?.host || '';
      isBuild = config.command === 'build';
      log('Plugin configured in ' + (isBuild ? 'build' : 'dev') + ' mode', options);
    },

    async renderChunk(code, chunk) {
      if (!isBuild) return null;

      const hash = computeSri(code, options.algorithm);
      if (hash) {
        sriMap.set(chunk.fileName, hash);
        log(`Computing SRI for chunk ${chunk.fileName}: ${hash}`, options);
      }
      return null;
    },

    async generateBundle(_, bundle) {
      if (!isBuild) return;

      for (const fileName in bundle) {
        const chunk = bundle[fileName];
        if (chunk.type === 'asset' && !sriMap.has(fileName)) {
          const hash = computeSri(chunk.source, options.algorithm);
          if (hash) {
            sriMap.set(fileName, hash);
            log(`Computing SRI for asset ${fileName}: ${hash}`, options);
          }
        }
      }
    },

    async transformIndexHtml(html) {
      if (!isBuild || !html) {
        log('Skipping HTML transform in dev mode or empty HTML', options);
        return html;
      }

      try {
        // Process script tags
        const scriptTags = html.match(/<script[^>]+src=["']([^"']+)["'][^>]*>/g) || [];
        for (const tag of scriptTags) {
          const url = tag.match(/src=["']([^"']+)["']/)[1];
          const newTag = await processTag(tag, url, options, sriMap);
          html = html.replace(tag, newTag);
        }

        // Process link tags
        const linkTags = html.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/g) || [];
        for (const tag of linkTags) {
          const url = tag.match(/href=["']([^"']+)["']/)[1];
          const newTag = await processTag(tag, url, options, sriMap);
          html = html.replace(tag, newTag);
        }

        return html;
      } catch (error) {
        console.error(`${LOG_PREFIX} Failed to transform HTML: ${error}`);
        return html;
      }
    }
  };
}
