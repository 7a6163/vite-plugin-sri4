import { createHash } from 'node:crypto';
import fetch from 'cross-fetch';

const LOG_PREFIX = '[vite-plugin-sri4]';

const DEFAULT_OPTIONS = {
  algorithm: 'sha384',
  bypassDomains: [],
  crossorigin: 'anonymous',
  debug: false
};

function log(message, options) {
  if (options.debug) {
    console.log(`${LOG_PREFIX} ${message}`);
  }
}

function computeSri(content, algorithm = 'sha384') {
  try {
    const hash = createHash(algorithm);
    if (Buffer.isBuffer(content) || content instanceof Uint8Array) {
      hash.update(content);
    } else if (typeof content === 'string') {
      hash.update(Buffer.from(content, 'utf-8'));
    } else {
      throw new Error('Invalid content type');
    }
    return `${algorithm}-${hash.digest('base64')}`;
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

function hasCrossOriginAttr(tag) {
  return /(?:^|\s)crossorigin(?:=["']?[^"'\s>]*["']?)?(?:\s|>|$)/i.test(tag);
}

function getBundleKey(url, base = '') {
  // Remove base prefix if exists
  let cleanUrl = url.startsWith(base) ? url.slice(base.length) : url;
  // Remove leading slash
  cleanUrl = cleanUrl.startsWith('/') ? cleanUrl.slice(1) : cleanUrl;

  // Try different path combinations
  const paths = [
    cleanUrl,
    `static/${cleanUrl}`,
    cleanUrl.replace(/^static\//, '')
  ];

  // Remove hash part if exists and try again
  const withoutHash = cleanUrl.replace(/-[a-zA-Z0-9]+\.([^.]+)$/, '.$1');
  if (withoutHash !== cleanUrl) {
    paths.push(...[
      withoutHash,
      `static/${withoutHash}`,
      withoutHash.replace(/^static\//, '')
    ]);
  }

  return [...new Set(paths)];
}

async function processTag(tag, url, options, bundle, base = '') {
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
  const possibleKeys = getBundleKey(url, base);
  let bundleItem = null;
  let source;

  log(`Looking for bundle keys:`, options);
  possibleKeys.forEach(key => log(`- ${key}`, options));

  for (const key of possibleKeys) {
    if (bundle[key]) {
      bundleItem = bundle[key];
      log(`Found bundle item for key: ${key}`, options);
      break;
    }
  }

  if (!bundleItem) {
    log(`Available bundle keys:`, options);
    Object.keys(bundle).forEach(key => log(`- ${key}`, options));
    return tag;
  }

  log(`Bundle item type: ${bundleItem.type}`, options);

  try {
    if (bundleItem.type === 'chunk') {
      source = bundleItem.code;
      log(`Processing chunk content of length: ${source.length}`, options);
    } else {
      source = bundleItem.source;
      log(`Processing asset content of length: ${source.length}`, options);
    }

    const integrity = computeSri(source, options.algorithm);
    if (integrity) {
      log(`Computing SRI for local resource ${url}: ${integrity}`, options);
      const hasCrossOrigin = hasCrossOriginAttr(tag);
      const crossOriginAttr = hasCrossOrigin ? '' : ` crossorigin="${options.crossorigin}"`;
      const newTag = tag.replace(/>$/, ` integrity="${integrity}"${crossOriginAttr}>`);
      log(`New tag: ${newTag}`, options);
      return newTag;
    }
  } catch (error) {
    log(`Error processing bundle item: ${error}`, options);
  }

  return tag;
}

export default function sri(userOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...userOptions };
  let isBuild = false;
  let base = '';

  return {
    name: 'vite-plugin-sri4',
    apply: 'build',
    enforce: 'post',

    configResolved(config) {
      options.domain = config.server?.host || '';
      isBuild = config.command === 'build';
      base = config.base || '';
      log('Plugin configured in ' + (isBuild ? 'build' : 'dev') + ' mode', options);
      log(`Base URL: ${base}`, options);
    },

    async transformIndexHtml(html, ctx) {
      if (!isBuild || !html) {
        log('Skipping HTML transform in dev mode or empty HTML', options);
        return html;
      }

      try {
        log('Starting HTML transformation', options);
        const bundle = ctx.bundle || {};
        log(`Bundle size: ${Object.keys(bundle).length}`, options);

        // Process script tags with and without quotes
        const scriptTagRegex = /<script[^>]+src=(?:["']([^"']+)["']|([^ >]+))[^>]*>/g;
        let match;
        while ((match = scriptTagRegex.exec(html)) !== null) {
          const [tag, quotedUrl, unquotedUrl] = match;
          const url = quotedUrl || unquotedUrl;
          log(`Processing script: ${url}`, options);
          const newTag = await processTag(tag, url, options, bundle, base);
          html = html.replace(tag, newTag);
        }

        // Process link tags with and without quotes
        const linkTagRegex = /<link[^>]+href=(?:["']([^"']+)["']|([^ >]+))[^>]*>/g;
        while ((match = linkTagRegex.exec(html)) !== null) {
          const [tag, quotedUrl, unquotedUrl] = match;
          const url = quotedUrl || unquotedUrl;
          if (tag.includes('stylesheet') || tag.includes('modulepreload')) {
            log(`Processing link: ${url}`, options);
            const newTag = await processTag(tag, url, options, bundle, base);
            html = html.replace(tag, newTag);
          }
        }

        return html;
      } catch (error) {
        console.error(`${LOG_PREFIX} Failed to transform HTML: ${error}`);
        return html;
      }
    }
  };
}
