/**
 * What `fetchVerifiedResource` stores: the bytes, or `null` for "already
 * checked, must not be hashed". `undefined` from `get` means "not checked yet",
 * which is a different answer and must stay distinguishable.
 */
export type CachedResource = Uint8Array | null;
interface CacheEntry {
    value: CachedResource;
    expiry: number;
}
/**
 * Extended caching mechanism with expiration time
 */
export declare class ResourceCache {
    cache: Map<string, CacheEntry>;
    ttl: number;
    constructor(ttl?: number);
    get(key: string): CachedResource | undefined;
    set(key: string, value: CachedResource): void;
    has(key: string): boolean;
    clear(): void;
}
/**
 * Cache manager for plugin instances
 */
export declare class CacheManager {
    resourceCache: ResourceCache;
    constructor();
    getResourceCache(): ResourceCache;
    clearAll(): void;
}
export {};
