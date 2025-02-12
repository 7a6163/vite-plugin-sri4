import { createHash } from 'node:crypto';
import fetch from 'cross-fetch';

const DEFAULT_OPTIONS = {
  algorithm: 'sha384',
  bypassDomains: [],
  crossorigin: 'anonymous',
  debug: false
};

function log(message, options) {
  if (options.debug) {
    console.log(`[vite-plugin-sri4] ${message}`);
  }
}

function computeSri(content, algorithm = 'sha384') {
  try {
    const hash = createHash(algorithm)
      .update(content)
      .digest('base64');
    return `${algorithm}-${hash}`;
  } catch (error) {
    console.error(`[vite-plugin-sri4] Failed to compute SRI hash: ${error}`);
    return null;
  }
}

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

async function replaceAsync(str, regex, asyncFn) {
  const promises = [];
  const matches = [];

  str.replace(regex, (...args) => {
    matches.push(args);
    promises.push(asyncFn(...args));
    return '';
  });

  const results = await Promise.all(promises);

  let lastIndex = 0;
  let result = '';

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i][0];
    const index = str.indexOf(match, lastIndex);
    result += str.slice(lastIndex, index) + results[i];
    lastIndex = index + match.length;
  }

  result += str.slice(lastIndex);
  return result;
}

function isBypassDomain(url, bypassDomains = []) {
  if (!bypassDomains.length) return false;
  try {
    const parsedUrl = url.startsWith('//')
      ? new URL(url, 'http://dummy')
      : new URL(url);
    return bypassDomains.some(
      (domain) => parsedUrl.hostname === domain ||
                 parsedUrl.hostname.endsWith(`.${domain}`)
    );
  } catch (e) {
    return false;
  }
}

function hasCrossOriginAttr(tag) {
  return /crossorigin=/i.test(tag);
}

export default function sri(userOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...userOptions };
  const sriMap = new Map();

  return {
    name: 'vite-plugin-sri4',
    apply: 'build',

    configResolved(config) {
      options.domain = config.server?.host || '';
    },

    async generateBundle(_, bundle) {
      for (const fileName in bundle) {
        const chunk = bundle[fileName];
        if (chunk.type === 'chunk' || chunk.type === 'asset') {
          const content = chunk.code || chunk.source;
          if (content) {
            const hash = computeSri(content, options.algorithm);
            if (hash) {
              sriMap.set(fileName, hash);
              log(`Computed SRI for ${fileName}: ${hash}`, options);
            }
          }
        }
      }
    },

    async transformIndexHtml(html) {
      const hasIntegrity = (tag) => /integrity=/i.test(tag);
      const isExternalUrl = (url) => /^(https?:)?\/\//i.test(url);

      const processTag = async (match, tag, src, moduleSrc) => {
        const actualSrc = src || moduleSrc;

        if (hasIntegrity(tag)) {
          return tag;
        }

        if (isExternalUrl(actualSrc) &&
            isBypassDomain(actualSrc, options.bypassDomains)) {
          log(`Skipping SRI injection for bypass domain: ${actualSrc}`, options);
          return tag;
        }

        if (isExternalUrl(actualSrc)) {
          const corsOk = await externalResourceIsCorsEnabled(actualSrc, options);
          if (!corsOk) {
            log(`External resource ${actualSrc} does not support CORS`, options);
            return tag;
          }
        }

        const fileName = actualSrc.startsWith('/') ? actualSrc.slice(1) : actualSrc;
        const integrity = sriMap.get(fileName);

        if (integrity) {
          const hasCrossOrigin = hasCrossOriginAttr(tag);
          if (hasCrossOrigin) {
            return tag.replace(
              />$/,
              ` integrity="${integrity}">`
            );
          }
          return tag.replace(
            />$/,
            ` integrity="${integrity}" crossorigin="${options.crossorigin}">`
          );
        }

        return tag;
      };

      html = await replaceAsync(
        html,
        /(<script[^>]+(?:src="([^"]+)"[^>]*|type="module"[^>]*src="([^"]+)"[^>]*)>)/g,
        processTag
      );

      html = await replaceAsync(
        html,
        /(<link[^>]+href="([^"]+)"[^>]*>)/g,
        processTag
      );

      return html;
    }
  };
}
