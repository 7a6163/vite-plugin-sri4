import type { CachedResource, ResourceCache } from './cache.js';
import type { Logger } from './logger.js';
/**
 * Does an external URL's host match one of `domains`, or a subdomain of one?
 * Used by both `bypassDomains` and `trustDomains`.
 */
export declare function matchesDomain(url: string, domains: string[] | undefined, logger: Logger): boolean;
/**
 * Resource check with retry mechanism
 */
/**
 * Fetch an external resource and return its bytes, or null if it must not be
 * hashed. The reason is always logged - a tag that silently ships without
 * integrity is the thing that is easy to miss.
 *
 * One GET, not a HEAD probe followed by a GET. The headers the gates need
 * arrive on the response that carries the bytes anyway, so probing separately
 * doubled the requests and threw the useful copy away - and made the plugin
 * depend on HEAD being served at all. It often is not: js.tappaysdk.com
 * answers 403 to HEAD and 200 to GET, which used to read as "could not be
 * checked" on a payment SDK, exactly the kind of script SRI is for.
 *
 * The cost is that a rejected resource is downloaded before it is rejected.
 * That is the right side to lose on: the accepted case, which is every build
 * that actually ships hashes, goes from two requests to one.
 */
export declare function fetchVerifiedResource(url: string, resourceCache: ResourceCache, logger: Logger, trusted?: boolean, retries?: number): Promise<CachedResource>;
