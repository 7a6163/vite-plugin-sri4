import { calculateIntegrity } from './integrity-calculator.js'

/**
 * Match an attribute regardless of quoting style. Attribute order inside a tag
 * is not significant in HTML, so attributes are read out of the matched tag
 * rather than being baked into the tag regex.
 */
function attrPattern(name) {
  // Lookbehind on whitespace, not `\b` - `\b` matches after the hyphen in
  // `data-src`, and getAttr takes the first match, so a decoy attribute would
  // hijack the URL.
  return new RegExp(`(?<=\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i')
}

// Attributes are always preceded by whitespace inside a tag, so anchoring on
// it avoids matching `data-integrity`. `crossorigin` is matched with or without
// a value - Vite emits the valueless form, and duplicating it is invalid HTML.
const CROSSORIGIN_ATTR_RE = /\scrossorigin(?=[\s=>/]|$)/i
const INTEGRITY_ATTR_RE = /\sintegrity\s*=/i

const SRC_RE = attrPattern('src')
const HREF_RE = attrPattern('href')
const REL_RE = attrPattern('rel')

// rel values whose tags carry an integrity attribute
const SRI_LINK_RELS = new Set(['stylesheet', 'modulepreload'])

function getAttr(tag, re) {
  const match = tag.match(re)
  if (!match) return null
  return match[1] ?? match[2] ?? match[3] ?? null
}

export const HTML_PATTERNS = {
  script: {
    regex: /<script\b[^>]*><\/script>/gi,
    endOffset: 10, // length of '></script>'
    getUrl: tag => getAttr(tag, SRC_RE)
  },
  link: {
    regex: /<link\b[^>]*>/gi,
    endOffset: 1, // length of '>'
    getUrl: tag => {
      const rel = getAttr(tag, REL_RE)
      if (!rel || !SRI_LINK_RELS.has(rel.trim().toLowerCase())) return null
      return getAttr(tag, HREF_RE)
    }
  }
}

/**
 * Validate HTML input
 */
function validateHtmlInput(html, htmlPath, logger) {
  if (!html || typeof html !== 'string') {
    logger.warn(`Invalid HTML content for ${htmlPath}`)
    return false
  }
  return true
}

/**
 * Offset inside the matched tag where new attributes should go: just before the
 * closing `>`, skipping back over the self-closing slash and any whitespace so
 * `<link ... />` does not become `<link ... / integrity="...">`.
 */
function insertOffset(tag, endOffset) {
  let at = tag.length - endOffset
  while (at > 0 && (tag[at - 1] === '/' || /\s/.test(tag[at - 1]))) at--
  return at
}

/**
 * Process a single match to create an integrity change object
 */
async function processMatch(
  match,
  pattern,
  bundle,
  htmlPath,
  options,
  config,
  cacheManager,
  logger
) {
  const tag = match[0]
  if (INTEGRITY_ATTR_RE.test(tag)) return null

  const url = pattern.getUrl(tag)
  if (!url) return null

  const integrity = await calculateIntegrity(
    bundle,
    htmlPath,
    url,
    options,
    config,
    cacheManager,
    logger
  )

  if (integrity) {
    return {
      integrity,
      position: match.index + insertOffset(tag, pattern.endOffset),
      tag,
      url // For logging
    }
  }
  return null
}

/**
 * Process matches for a specific HTML pattern
 */
async function processPatternMatches(
  html,
  pattern,
  bundle,
  htmlPath,
  options,
  config,
  cacheManager,
  logger
) {
  const matches = [...html.matchAll(pattern.regex)]

  // Process each match in parallel
  const matchResults = await Promise.all(
    matches.map(match =>
      processMatch(match, pattern, bundle, htmlPath, options, config, cacheManager, logger)
    )
  )

  // Filter out null results
  return matchResults.filter(Boolean)
}

/**
 * Collect all integrity changes from HTML patterns
 */
async function collectIntegrityChanges(
  html,
  bundle,
  htmlPath,
  options,
  config,
  cacheManager,
  logger
) {
  const changes = []

  // Collect changes from all patterns in parallel
  await Promise.all(
    Object.values(HTML_PATTERNS).map(async pattern => {
      const patternChanges = await processPatternMatches(
        html,
        pattern,
        bundle,
        htmlPath,
        options,
        config,
        cacheManager,
        logger
      )
      changes.push(...patternChanges)
    })
  )

  return changes
}

// Attributes are always preceded by whitespace inside a tag, so anchoring on
// it avoids matching `data-integrity`. `crossorigin` is matched with or without
// a value - Vite emits the valueless form, and duplicating it is invalid HTML.

/**
 * Apply integrity changes to HTML content
 */
function applyIntegrityChanges(html, changes, logger) {
  // Sort by position in descending order to insert from back to front
  changes.sort((a, b) => b.position - a.position)

  for (const { integrity, position, tag, url } of changes) {
    let insertText = ` integrity="${integrity}"`
    if (!CROSSORIGIN_ATTR_RE.test(tag)) {
      insertText += ' crossorigin="anonymous"'
    }
    html = html.slice(0, position) + insertText + html.slice(position)
    logger.debug(`Added integrity for: ${url}`)
  }

  return html
}

const EXISTING_IMPORTMAP_RE = /<script\b[^>]*\btype\s*=\s*["']importmap["']/i
const FIRST_SCRIPT_RE = /<script\b/i
const HEAD_CLOSE_RE = /<\/head\s*>/i

/**
 * Inject an import map carrying an `integrity` map.
 *
 * This is the only mechanism that covers modules pulled in at runtime by
 * `import()` / Vite's preload helper, which have no build-time HTML tag to
 * rewrite. Engines without support ignore the key rather than failing.
 */
export function injectImportmapIntegrity(html, integrity, logger) {
  if (!html || typeof html !== 'string' || Object.keys(integrity).length === 0) {
    return html
  }

  if (EXISTING_IMPORTMAP_RE.test(html)) {
    logger.warn('HTML already contains an import map; skipping SRI import map injection')
    return html
  }

  // `<` is escaped so a filename can never close the script element early
  const json = JSON.stringify({ integrity }).replace(/</g, '\\u003c')
  const tag = `<script type="importmap">${json}</script>`

  // Must precede every module script, otherwise the map does not apply to them
  for (const re of [FIRST_SCRIPT_RE, HEAD_CLOSE_RE]) {
    const at = html.search(re)
    if (at !== -1) return html.slice(0, at) + tag + html.slice(at)
  }

  return html + tag
}

/**
 * Transform HTML by adding SRI integrity attributes
 */
export async function transformHTML(
  bundle,
  htmlPath,
  html,
  options,
  config,
  cacheManager,
  logger
) {
  if (!validateHtmlInput(html, htmlPath, logger)) {
    return html
  }

  const changes = await collectIntegrityChanges(
    html,
    bundle,
    htmlPath,
    options,
    config,
    cacheManager,
    logger
  )

  return applyIntegrityChanges(html, changes, logger)
}

/**
 * Create HTML transformer with given options and config
 */
export function createTransformer(options, config, cacheManager, logger) {
  return {
    transformHTML: (bundle, htmlPath, html) =>
      transformHTML(bundle, htmlPath, html, options, config, cacheManager, logger),
    calculateIntegrity: (bundle, htmlPath, url) =>
      calculateIntegrity(bundle, htmlPath, url, options, config, cacheManager, logger)
  }
}
