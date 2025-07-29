/**
 * Extended caching mechanism with expiration time
 */
export class ResourceCache {
  constructor(ttl = 3600000) { // Default cache for 1 hour
    this.cache = new Map()
    this.ttl = ttl
  }

  get(key) {
    const item = this.cache.get(key)
    if (!item) return undefined

    // Check if expired
    if (Date.now() > item.expiry) {
      this.cache.delete(key)
      return undefined
    }

    return item.value
  }

  set(key, value) {
    this.cache.set(key, {
      value,
      expiry: Date.now() + this.ttl
    })
  }

  has(key) {
    return this.get(key) !== undefined
  }

  clear() {
    this.cache.clear()
  }
}

/**
 * Cache manager for plugin instances
 */
export class CacheManager {
  constructor() {
    this.urlSupportCache = new ResourceCache()
    this.resourceCache = new ResourceCache()
  }

  getUrlSupportCache() {
    return this.urlSupportCache
  }

  getResourceCache() {
    return this.resourceCache
  }

  clearAll() {
    this.urlSupportCache.clear()
    this.resourceCache.clear()
  }
}