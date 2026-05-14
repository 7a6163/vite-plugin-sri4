import { calculateIntegrity } from './integrity-calculator.js'

// Optimized regex patterns for better readability and efficiency
export const HTML_PATTERNS = {
  script: {
    regex: /<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*><\/script>/g,
    endOffset: 10
  },
  stylesheet: {
    regex: /<link\b[^>]*?\brel\s*=\s*["']stylesheet["'][^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>/g,
    endOffset: 1
  },
  modulepreload: {
    regex: /<link\b[^>]*?\brel\s*=\s*["']modulepreload["'][^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>/g,
    endOffset: 1
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
 * Process a single match to create an integrity change object
 */
async function processMatch(
  match, 
  endOffset, 
  bundle, 
  htmlPath, 
  options, 
  config, 
  cacheManager,
  logger
) {
  const [, url] = match
  if (!url) return null

  const end = match.index + match[0].length
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
      position: end - endOffset,
      tagStart: match.index,
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
  const { regex, endOffset } = pattern
  const matches = [...html.matchAll(regex)]

  // Process each match in parallel
  const matchResults = await Promise.all(
    matches.map(match => 
      processMatch(match, endOffset, bundle, htmlPath, options, config, cacheManager, logger)
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

const CROSSORIGIN_ATTR_RE = /\bcrossorigin\s*=/i
const INTEGRITY_ATTR_RE = /\bintegrity\s*=/i

/**
 * Check if integrity attribute already exists in the same tag
 */
function hasExistingIntegrity(html, tagStart, position) {
  return INTEGRITY_ATTR_RE.test(html.slice(tagStart, position))
}

/**
 * Check if crossorigin attribute already exists in the same tag
 */
function hasExistingCrossorigin(html, tagStart, position) {
  return CROSSORIGIN_ATTR_RE.test(html.slice(tagStart, position))
}

/**
 * Apply integrity changes to HTML content
 */
function applyIntegrityChanges(html, changes, logger) {
  // Sort by position in descending order to insert from back to front
  changes.sort((a, b) => b.position - a.position)

  for (const { integrity, position, tagStart, url } of changes) {
    // Skip if integrity attribute already exists on this tag
    if (hasExistingIntegrity(html, tagStart, position)) {
      continue
    }

    let insertText = ` integrity="${integrity}"`
    if (!hasExistingCrossorigin(html, tagStart, position)) {
      insertText += ' crossorigin="anonymous"'
    }
    html = html.slice(0, position) + insertText + html.slice(position)
    logger.debug(`Added integrity for: ${url}`)
  }

  return html
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