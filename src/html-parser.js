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

/**
 * Check if integrity attribute already exists in HTML segment
 */
function hasExistingIntegrity(html, position, integrity) {
  const segment = html.slice(Math.max(0, position - 100), position + 100)
  return segment.includes(`integrity="${integrity}"`)
}

/**
 * Apply integrity changes to HTML content
 */
function applyIntegrityChanges(html, changes, logger) {
  // Sort by position in descending order to insert from back to front
  changes.sort((a, b) => b.position - a.position)

  for (const { integrity, position, url } of changes) {
    // Skip if integrity attribute already exists
    if (hasExistingIntegrity(html, position, integrity)) {
      continue
    }

    const insertText = ` integrity="${integrity}"`
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