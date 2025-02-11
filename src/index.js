import { createHash } from 'crypto';
import fetch from 'node-fetch'; // Install node-fetch using: npm install node-fetch

/**
 * Compute the SRI (Subresource Integrity) hash for the given content.
 * @param {string | Buffer} content - The content to hash.
 * @param {string} algorithm - The SHA algorithm to use (default is 'sha384').
 * @returns {string} - The SRI string in the format "algorithm-base64hash".
 */
function computeSri(content, algorithm = 'sha384') {
  const hash = createHash(algorithm)
    .update(content)
    .digest('base64');
  return `${algorithm}-${hash}`;
}

/**
 * Check if an external resource supports CORS.
 * It sends a HEAD request to the given URL and examines the "Access-Control-Allow-Origin" header.
 * Adjust the logic to match your security policy.
 * @param {string} url - The URL to check.
 * @returns {Promise<boolean>} - A promise that resolves to true if CORS is enabled.
 */
async function externalResourceIsCorsEnabled(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    const acao = response.headers.get('access-control-allow-origin');
    // Adjust the check as needed. This example allows "*" or domains including 'your-domain.com'.
    if (acao && (acao === '*' || acao.includes('your-domain.com'))) {
      return true;
    }
    return false;
  } catch (error) {
    console.warn(`Failed to fetch CORS headers from ${url}:`, error);
    return false;
  }
}

/**
 * Helper function to perform an asynchronous replacement in a string.
 * @param {string} str - The input string.
 * @param {RegExp} regex - The regular expression to match parts of the string.
 * @param {Function} asyncFn - An async function to compute the replacement.
 * @returns {Promise<string>} - The string with replaced values.
 */
async function replaceAsync(str, regex, asyncFn) {
  const matches = [];
  str.replace(regex, (...args) => {
    matches.push(args);
    return '';
  });
  for (const args of matches) {
    const match = args[0];
    const replacement = await asyncFn(...args);
    str = str.replace(match, replacement);
  }
  return str;
}

/**
 * Determines if the URL belongs to a domain specified in the bypassDomains array.
 * If so, the SRI injection will be skipped for that resource.
 * @param {string} url - The URL to check.
 * @param {Array<string>} bypassDomains - Array of domains to bypass SRI injection.
 * @returns {boolean} - True if the URL should bypass SRI injection.
 */
function isBypassDomain(url, bypassDomains = []) {
  if (!bypassDomains.length) return false;
  try {
    // If url starts with '//' assume default protocol 'http:'
    const parsedUrl = url.startsWith('//') ? new URL(url, 'http://dummy') : new URL(url);
    // Checks if the hostname ends with any of the bypass domains.
    return bypassDomains.some((domain) => parsedUrl.hostname === domain || parsedUrl.hostname.endsWith(`.${domain}`));
  } catch (e) {
    return false;
  }
}

/**
 * vite-plugin-sri4
 *
 * Plugin options:
 * - algorithm: The algorithm used to compute SRI hash (default: 'sha384').
 * - bypassDomains: Array of domains for which to skip injecting the integrity attribute.
 *
 * This plugin works during the build process:
 * 1. In the generateBundle hook, it calculates the SRI hash for all assets/chunks and stores them in sriMap.
 * 2. In the transformIndexHtml hook, it injects the integrity and crossorigin attributes into the HTML.
 *    For external links, it verifies via a CORS check if the resource supports cross-origin access.
 *
 * @param {Object} options - Plugin configuration options.
 * @returns {Object} - The Vite plugin.
 */
export default function sri(options = {}) {
  // Use the provided algorithm from options, defaulting to 'sha384' if not specified.
  const algorithm = options.algorithm || 'sha384';
  // Array for domains to bypass SRI injection.
  const bypassDomains = options.bypassDomains || [];
  // Map to store SRI hashes for assets; key is the file name.
  const sriMap = {};

  return {
    name: 'vite-plugin-sri4',
    apply: 'build',

    /**
     * The generateBundle hook iterates through each asset or chunk in the bundle,
     * computes its SRI hash, and stores it in the sriMap.
     */
    async generateBundle(_, bundle) {
      for (const fileName in bundle) {
        const chunk = bundle[fileName];
        if (chunk.type === 'chunk' || chunk.type === 'asset') {
          const content = chunk.code || chunk.source;
          if (content) {
            sriMap[fileName] = computeSri(content, algorithm);
            console.log(`Computed SRI for ${fileName}: ${sriMap[fileName]}`);
          }
        }
      }
    },

    /**
     * The transformIndexHtml hook processes the generated HTML and injects the integrity and crossorigin attributes.
     * For external resources, a CORS check is performed first.
     * If the URL belongs to a bypass domain, the injection is skipped.
     * @param {string} html - The HTML content to transform.
     * @returns {Promise<string>} - The transformed HTML.
     */
    async transformIndexHtml(html) {
      // Determines if a URL is external by checking if it starts with http://, https://, or //
      const isExternalUrl = (url) => /^(https?:)?\/\//i.test(url);

      // Process <script> tags.
      html = await replaceAsync(
        html,
        /(<script[^>]+src="([^"]+)"[^>]*>)/g,
        async (match, tag, src) => {
          // Skip SRI injection for external URLs that are in the bypass list.
          if (isExternalUrl(src) && isBypassDomain(src, bypassDomains)) {
            console.log(`Skipping SRI injection for bypass domain: ${src}`);
            return tag;
          }

          if (isExternalUrl(src)) {
            // For external links not bypassed, perform a CORS check.
            const corsOk = await externalResourceIsCorsEnabled(src);
            if (!corsOk) {
              console.warn(`External resource ${src} does not support CORS. Skipping SRI injection.`);
              return tag;
            }
          }
          // For relative URLs or valid external URLs, use the file name as the key.
          const fileName = src.startsWith('/') ? src.slice(1) : src;
          if (sriMap[fileName]) {
            return tag.replace(/>$/, ` integrity="${sriMap[fileName]}" crossorigin="anonymous">`);
          }
          return tag;
        }
      );

      // Process <link> tags.
      html = await replaceAsync(
        html,
        /(<link[^>]+href="([^"]+)"[^>]*>)/g,
        async (match, tag, href) => {
          // Skip SRI injection for external URLs that are in the bypass list.
          if (isExternalUrl(href) && isBypassDomain(href, bypassDomains)) {
            console.log(`Skipping SRI injection for bypass domain: ${href}`);
            return tag;
          }

          if (isExternalUrl(href)) {
            // For external links not in the bypass list, perform a CORS check.
            const corsOk = await externalResourceIsCorsEnabled(href);
            if (!corsOk) {
              console.warn(`External resource ${href} does not support CORS. Skipping SRI injection.`);
              return tag;
            }
          }
          const fileName = href.startsWith('/') ? href.slice(1) : href;
          if (sriMap[fileName]) {
            return tag.replace(/>$/, ` integrity="${sriMap[fileName]}" crossorigin="anonymous">`);
          }
          return tag;
        }
      );

      return html;
    }
  };
}
