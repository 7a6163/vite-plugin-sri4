import { createHash } from 'node:crypto';
import fetch from 'cross-fetch';

const LOG_PREFIX = '[vite-plugin-sri4]';

const DEFAULT_OPTIONS = {
  algorithm: 'sha384',
  bypassDomains: [],
  crossorigin: 'anonymous',
  debug: false,
  inlineScripts: false
};

function log(message, options) {
  if (options.debug) {
    console.log(`${LOG_PREFIX} ${message}`);
  }
}

function computeSri(content, algorithm = 'sha384') {
  try {
    if (typeof content === 'string') {
      content = Buffer.from(content, 'utf-8');
    }
    const hash = createHash(algorithm)
      .update(content)
      .digest('base64');
    return `${algorithm}-${hash}`;
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to compute SRI hash: ${error}`);
    return null;
  }
}

async function externalResourceIsCorsEnabled(url, options) {
  try {
    const response = await fetch(url, {
      method: 'HEAD'
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

function isBypassDomain(url, bypassDomains = []) {
  if (!bypassDomains.length) return false;
  try {
    let parsedUrl;
    if (url.startsWith('//')) {
      parsedUrl = new URL(`http:${url}`);
    } else if (url.startsWith('http://') || url.startsWith('https://')) {
      parsedUrl = new URL(url);
    } else {
      parsedUrl = new URL(url, 'http://dummy');
    }

    return bypassDomains.some(
      (domain) => parsedUrl.hostname === domain ||
                 parsedUrl.hostname.endsWith(`.${domain}`)
    );
  } catch (e) {
    console.error(`${LOG_PREFIX} Failed to parse URL: ${url}`, e);
    return false;
  }
}

function hasCrossOriginAttr(tag) {
  return /(?:^|\s)crossorigin(?:=["']?[^"'\s>]*["']?)?(?:\s|>|$)/i.test(tag);
}

function getAllPossiblePaths(url) {
  const paths = [
    url,
    url.startsWith('/') ? url.slice(1) : url,
    url.startsWith('/static/') ? url.slice(8) : url,
    !url.startsWith('/static/') ? `static/${url}` : url,
    !url.startsWith('/static/') ? `/static/${url}` : url,
    url.replace(/^\/static\//, ''),
    url.replace(/^static\//, '')
  ];

  // Handle Vite's hashed filenames (e.g., index-DPifqqS2.js -> index.js)
  const withoutHash = url.replace(/-[a-zA-Z0-9]{8}\./, '.');
  if (withoutHash !== url) {
    paths.push(...getAllPossiblePaths(withoutHash));
  }

  // Handle variations with and without /static/ prefix for hashed files
  const hashedMatch = url.match(/^(?:\/static\/)?(.*?)-[a-zA-Z0-9]{8}(\..*?)$/);
  if (hashedMatch) {
    const [, base, ext] = hashedMatch;
    paths.push(
      `${base}${ext}`,
      `/static/${base}${ext}`,
      `static/${base}${ext}`
    );
  }

  return [...new Set(paths)];
}

async function processTag(tag, url, options, sriMap) {
  if (tag.includes('integrity=')) {
    log(`Skip tag with existing integrity attribute: ${tag}`, options);
    return tag;
  }

  log(`Processing tag: ${tag}`, options);
  log(`URL: ${url}`, options);

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
        const newTag = tag.replace(/>$/, ` integrity="${hash}"${crossOriginAttr}>`);
        log(`New tag: ${newTag}`, options);
        return newTag;
      }
    } catch (error) {
      log(`Failed to process external resource ${url}: ${error}`, options);
    }
    return tag;
  }

  // Handle local resources
  const possiblePaths = getAllPossiblePaths(url);
  let integrity = null;

  log(`Checking possible paths for ${url}:`, options);
  log(`Possible paths:`, options);
  possiblePaths.forEach(path => log(`  - ${path}`, options));

  for (const path of possiblePaths) {
    log(`- Checking path: ${path}`, options);
    if (sriMap.has(path)) {
      integrity = sriMap.get(path);
      log(`Found integrity for path ${path}: ${integrity}`, options);
      break;
    }
  }

  if (integrity) {
    log(`Using precomputed SRI for ${url}: ${integrity}`, options);
    const hasCrossOrigin = hasCrossOriginAttr(tag);
    const crossOriginAttr = hasCrossOrigin ? '' : ` crossorigin="${options.crossorigin}"`;
    const newTag = tag.replace(/>$/, ` integrity="${integrity}"${crossOriginAttr}>`);
    log(`New tag: ${newTag}`, options);
    return newTag;
  }

  log(`No SRI hash found for ${url}`, options);
  log(`Available paths in sriMap: ${Array.from(sriMap.keys()).join(', ')}`, options);
  return tag;
}

async function processInlineScript(tag, options) {
  if (tag.includes('integrity=')) {
    log(`Skip inline script with existing integrity attribute: ${tag}`, options);
    return tag;
  }

  const content = tag.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1]?.trim();
  if (!content) {
    log(`Skip empty inline script: ${tag}`, options);
    return tag;
  }

  const hash = computeSri(content, options.algorithm);
  if (hash) {
    log(`Computing SRI for inline script: ${hash}`, options);
    const newTag = tag.replace('>', ` integrity="${hash}">`);
    log(`New inline script tag: ${newTag}`, options);
    return newTag;
  }

  return tag;
}

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
        for (const path of getAllPossiblePaths(chunk.fileName)) {
          sriMap.set(path, hash);
          log(`Stored SRI for path ${path}: ${hash}`, options);
        }
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
            for (const path of getAllPossiblePaths(fileName)) {
              sriMap.set(path, hash);
              log(`Computing SRI for asset ${path}: ${hash}`, options);
            }
          }
        }
      }

      log('Final sriMap contents:', options);
      for (const [key, value] of sriMap.entries()) {
        log(`${key} => ${value}`, options);
      }
    },

    async transformIndexHtml(html) {
      if (!isBuild || !html) {
        log('Skipping HTML transform in dev mode or empty HTML', options);
        return html;
      }

      try {
        log('Starting HTML transformation', options);
        log(`SRI Map size: ${sriMap.size}`, options);

        // Process script tags
        const scriptTags = html.match(/<script[^>]+src=["']([^"']+)["'][^>]*>/g) || [];
        log(`Found ${scriptTags.length} script tags`, options);
        for (const tag of scriptTags) {
          const url = tag.match(/src=["']([^"']+)["']/)[1];
          log(`Processing script: ${url}`, options);
          const newTag = await processTag(tag, url, options, sriMap);
          html = html.replace(tag, newTag);
        }

        // Process inline scripts if enabled
        if (options.inlineScripts) {
          const inlineScripts = html.match(/<script[^>]*>([^<]+)<\/script>/g) || [];
          log(`Found ${inlineScripts.length} inline script tags`, options);
          for (const tag of inlineScripts) {
            const newTag = await processInlineScript(tag, options);
            html = html.replace(tag, newTag);
          }
        }

        // Process link tags
        const linkTags = html.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/g) || [];
        log(`Found ${linkTags.length} link tags`, options);
        for (const tag of linkTags) {
          const url = tag.match(/href=["']([^"']+)["']/)[1];
          log(`Processing link: ${url}`, options);
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
