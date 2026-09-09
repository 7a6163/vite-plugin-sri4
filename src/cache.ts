/**
 * What `fetchVerifiedResource` stores: the bytes, or `null` for "already
 * checked, must not be hashed". `undefined` from `get` means "not checked yet",
 * which is a different answer and must stay distinguishable.
 */
export type CachedResource = Uint8Array | null

interface CacheEntry {
  value: CachedResource
  expiry: number
}

/**
 * Extended caching mechanism with expiration time
 */
export class ResourceCache {
  cache: Map<string, CacheEntry>
  ttl: number

  constructor(ttl: number = 3600000) { // Default cache for 1 hour
    this.cache = new Map()
    this.ttl = ttl
  }

  get(key: string): CachedResource | undefined {
    const item = this.cache.get(key)
    if (!item) return undefined

    // Check if expired
    if (Date.now() > item.expiry) {
      this.cache.delete(key)
      return undefined
    }

    return item.value
  }

  set(key: string, value: CachedResource): void {
    this.cache.set(key, {
      value,
      expiry: Date.now() + this.ttl
    })
  }

  has(key: string): boolean {
    return this.get(key) !== undefined
  }

  clear(): void {
    this.cache.clear()
  }
}

/**
 * Cache manager for plugin instances
 */
export class CacheManager {
  resourceCache: ResourceCache

  constructor() {
    this.resourceCache = new ResourceCache()
  }

  getResourceCache(): ResourceCache {
    return this.resourceCache
  }

  clearAll(): void {
    this.resourceCache.clear()
  }
}
