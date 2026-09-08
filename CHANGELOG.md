# Changelog

All notable changes to this project will be documented in this file.

## [5.0.0] - 2026-09-08

External resources are the whole of this release. Nothing here touches how your own build outputs are hashed.

### Breaking Changes

- **An external resource is hashed only when its origin declares the URL immutable.** Previously any resource that answered `Access-Control-Allow-Origin: *` got an `integrity` attribute. That establishes the resource is reachable and CORS-eligible, and treats it as proof the resource is *byte-stable* — that the bytes fetched at build time are the bytes a browser will receive. Those are different properties, and where they diverge the injected hash matches nothing, the browser blocks the resource, and the build still exits 0.

  An `integrity` attribute pins one snapshot of bytes forever, so it is only correct on a URL whose bytes never change — and the origin is the only party that knows. It now has to say so: `Cache-Control: immutable`, or a `max-age` of a year or more, with nothing in the same header contradicting it. `private`, `no-store` and `no-cache` each veto whatever else it claims — freshness and shareability are orthogonal, so a per-client response can carry a long `max-age`, and `no-cache, max-age=<long>` is a real CDN spelling of "cache it, but revalidate every time". Everything else is left alone, with a warning naming the URL and the reason.

  The threshold separates two clusters the CDNs themselves created, rather than splitting a spectrum:

  | URL | `Cache-Control` | |
  |---|---|---|
  | `cdnjs …/jquery/3.7.1/jquery.min.js` | `max-age=30672000, immutable` | hashed |
  | `jsdelivr …/bootstrap@5.3.3/…` | `max-age=31536000, immutable` | hashed |
  | `unpkg …/htmx.org@1.9.12/…` | `max-age=31536000` | hashed |
  | `code.jquery.com/jquery-3.7.1.min.js` | `max-age=31536000` | hashed |
  | `jsdelivr …/vue@3/…` | `max-age=604800` | skipped |
  | `fonts.googleapis.com/css2?…` | `private, max-age=86400` | skipped |
  | `plausible.io/js/script.js` | `public, max-age=86400` | skipped |
  | `cdn.tailwindcss.com` | `max-age=14400` | skipped |
  | `connect.facebook.net/en_US/sdk.js` | `public, max-age=1200` | skipped |
  | `js.stripe.com/v3/` | `max-age=120` | skipped |
  | `unpkg …/react@18/…` | `max-age=60` | skipped |

  Nothing lands between 604800 and 30672000.

  A blacklist of known-bad origins was the obvious alternative and it is never finished: `cdn.tailwindcss.com` and `plausible.io/js/script.js` are ordinary `public` responses that roll just the same, and each gap ships a build that works today and breaks whenever that vendor deploys. The whitelist fails the other way — a resource that could have been protected ships unprotected, and announces itself in the build log.

  `Vary` is deliberately not the signal: Google Fonts varies on `User-Agent` without declaring it there (`vary: Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site`), so a `Vary`-based check lets exactly that resource through.

  **Migrating:** a version-pinned third-party library keeps its integrity and needs nothing. A floating or rolling URL loses it and starts warning — pin a version (`unpkg.com/react@18.3.1/…` answers `max-age=31536000`, `unpkg.com/react@18/…` answers `max-age=60`), or use `trustDomains` for a stable host that does not set the header, or `bypassDomains` to accept it and silence the warning.

### Features

- **`trustDomains` option.** Hostnames whose bytes you vouch for, matched on the host and its subdomains, hashed regardless of what the origin declares. For a stable host that does not set the header — not for forcing SRI onto a vendor's rolling URL, which breaks on their next deploy. Stripe, for one, documents that `js.stripe.com/v3/` must not be pinned.

### Bug Fixes

- **External `<link rel="stylesheet">` no longer ships a hash that can never match (regression in 4.1.0).** Google Fonts serves a different `@font-face` block per client and answers `Access-Control-Allow-Origin: *`, so it passed the 4.1/4.2 CORS gate and got an integrity the browser could never verify — a stylesheet blocked in production, from a build that exited 0 with no warning. The pre-4.1 stylesheet regex required `rel` before `href` and Google's own snippet is `<link href="…" rel="stylesheet">`, so these tags were never matched before; order-independent attribute matching in 4.1.0 started hashing them, and anyone on `^4.0.0` picked it up on their next install. The immutability check above skips it (`private, max-age=86400`), as it does `www.googletagmanager.com` (`private, max-age=900`).

- **`bypassDomains` now applies to protocol-relative URLs.** `//cdn.example.com/lib.js` is fetched as `https://…`, but the bypass check matched the raw attribute value, and the matcher requires a scheme — so a host the user had explicitly excluded was fetched and hashed anyway. Present since `bypassDomains` existed; it became visible in this release because `trustDomains` matched the normalized URL and the two options then disagreed about the same tag.

- **Every skipped external resource now says why.** A `HEAD` that failed, or a response with no `Access-Control-Allow-Origin` at all, used to skip in silence — only a *concrete* non-`*` origin warned. `cdn.tailwindcss.com` (a 302 with no CORS header) shipped with no integrity and nothing in the log.

### Internal

- `isUrlFromBypassDomain` → `matchesDomain`, now that `bypassDomains` and `trustDomains` both use it. Not exported from the package entry.

## [4.2.0] - 2026-09-08

### Documentation

- **Added the missing `LICENSE` file and settled the licence to MIT.** `package.json` declared `ISC` (the `npm init` default) while the README had always claimed MIT and pointed at a `LICENSE` file that did not exist, so the package shipped no licence text at all and automated scanners disagreed with human readers. MIT was chosen because it is what the README has told users for the life of the project. All 85 commits are by a single author, so no contributor agreement was needed.

### Features

- **`hashAlgorithm` is validated at startup.** `sri({ hashAlgorithm: 'md5' })` used to build cleanly and emit `integrity="md5-..."`, which every browser rejects — the resource was blocked with no build-time error at all. Only the three algorithms the SRI spec defines are accepted; anything else throws immediately. `crossorigin` is validated the same way.
- **`crossorigin` is configurable.** `anonymous` (default) or `use-credentials`, for CDNs that require cookies or HTTP auth. Previously hardcoded.
- **`publicDir` assets are hashed.** Files copied verbatim from `public/` never become bundle entries, so a normal `<script src="/sw.js">` failed the build under the default `ignoreMissingAsset: false`. They are now read from disk, with the resolved path checked to stay inside `publicDir` so a URL can never reach outside the project.
- **`skip-sri` attribute.** Per-tag opt-out for cases `bypassDomains` cannot express, which only reaches external hosts. The marker attribute is stripped from the output.
- **TypeScript definitions.** `types/index.d.ts` ships with the package and is wired through the `exports` map. Previously TypeScript consumers got `any` for the plugin and its options.

### Improvements

- **The plugin repositions itself instead of rewriting Vite's hook.** It used to monkey-patch the `generateBundle` of Vite's internal import-analysis plugin, permanently replacing another plugin's function and handling both the function and `{ handler }` hook shapes to do it. It now moves itself after that plugin in `config.plugins` during `configResolved` and uses an ordinary `generateBundle` of its own. Same ordering, same hashes, no surgery on code it does not own - and nothing breaks if Vite changes that hook's shape or another plugin wraps it too. The private plugin *names* are still needed to know where to move.
- **Zero runtime dependencies.** Dropped `cross-fetch` in favour of global `fetch`, stable since Node 18 - the floor the Vite 6.4 peer range already implies. Added an explicit `engines.node: >=18` now that this is load-bearing.
- HTML edits are expressed uniformly as `{ start, end, content }`, so an attribute removal and an attribute insertion share one code path.

## [4.1.0] - 2026-09-08

### Features

- **Dynamic route support.** Two opt-in options cover resources that have no build-time HTML tag to rewrite:
  - `importmap: true` injects `<script type="importmap">` carrying an `integrity` map for every JS chunk, which is the only mechanism that reaches modules pulled in at runtime by `import()` / Vite's preload helper. Engines without support ignore the key rather than failing.
  - `manifest: true` emits `sri-manifest.json` mapping every non-HTML output to its hash, for SSR builds that render HTML per request. It is emitted even when the bundle contains no HTML asset at all.
  - Hashes for both are computed before any `emitFile`, so the manifest never hashes itself. Note that a plugin mutating chunk contents after `generateBundle` (`@vitejs/plugin-legacy`, in-place compression) invalidates them.
- **Vite 6 support restored.** Peer range widened back to `^6.4.0 || ^7.0.0 || ^8.0.0`, verified against Vite `6.4.3`, `7.0.0`, `7.3.6` and `8.x` with a real build. The Vite 6 floor is `6.4` rather than `6.0` because `6.4` is the only Vite 6 line upstream still patches.

### Bug Fixes

- **Integrity drift is now detected.** Every hashed file is re-hashed in `writeBundle` and the build fails if a plugin ordered after this one rewrote it. Previously this was a documentation caveat only: the build stayed green and the browser silently refused the file.
- **The `ignoreMissingAsset: false` default now actually fails the build.** `generateBundle` caught and downgraded the thrown error to a warning, so an unresolvable asset shipped a tag with no integrity and a green build. Because collection runs under `Promise.all`, one missing asset also stripped SRI from *every* tag in that HTML file.
- **Assets on a CDN are hashed from the bundle.** With an absolute `base` (`https://cdn.example.com/`) Vite emits absolute URLs for your own output, and every one of them took the network path: three retries against a CDN that has not been deployed yet, then shipping without integrity. This is the scenario SRI exists for, and it did not work.
- **A decoy `data-src` / `data-href` no longer hijacks the URL.** Attribute matching used `\b`, which matches after the hyphen, so `<script data-src="/track.js" src="/main.js">` resolved `/track.js` - a build failure, or a hash for the wrong file.
- **`manifest`/`importmap` no longer break when both analysis plugin names are present.** The wrapped hook ran once per patched plugin, so `emitFile` threw on the duplicate manifest name and the import map warned about the one it had just injected.
- **A non-`*` `Access-Control-Allow-Origin` is skipped again, but loudly.** Accepting any origin meant injecting `crossorigin="anonymous"` on a resource whose CORS policy does not match the serving origin, turning a working script into a blocked one. Only `*` is verifiable at build time; anything else now warns instead of being silently dropped.
- **Protocol-relative URLs are fetched, not skipped.** `//cdn.example.com/x.js` is a real HTTP reference, and lumping it in with `data:`/`blob:` shipped it unprotected.
- **The drift check no longer fires for tags left alone.** A tag that already carries its own `integrity` is now skipped before hashing, so a later rewrite of that chunk cannot fail the build over a hash this plugin never injected.
- **Bundle-key fallback no longer matches across filename boundaries.** `key.endsWith(bundleKey)` let `/main.js` match `assets/vendor-main.js` and inject that file's hash — the browser rejects the entry script and the build reports nothing. Matching is now anchored on a path separator, and ambiguous candidates warn.
- **No duplicate `crossorigin` attribute.** The idempotency check required `crossorigin=`, missing the valueless form Vite itself emits, producing `<script crossorigin ... crossorigin="anonymous">`.
- **Self-closing tags stay well-formed.** Insertion landed after the `/`, producing `<link ... / integrity="...">`.
- **`rel` may follow `href`.** The stylesheet and modulepreload patterns required `rel` before `href`, silently skipping valid tags. Attributes are now read out of the matched tag instead of being baked into the tag regex.
- **Caches are cleared in `closeBundle`, not `buildEnd`.** Rollup runs `buildEnd` before the output phase, so the caches were emptied before they were ever populated — external resources were refetched on every watch-mode rebuild.
- **Non-bundle URLs are skipped instead of treated as missing assets.** `data:`, `blob:`, protocol-relative `//host/...` and unknown schemes previously took the bundle-lookup path and threw.
- **Asset URLs with a query string or fragment resolve.** `main.js?v=1` is now stripped to `main.js` before bundle lookup.
- **Relative-base bundle keys use `path.posix.join`, not `resolve`.** `resolve` produced a key absolute against the process CWD, which only ever matched via the suffix fallback.
- **HTML assets whose source is a `Uint8Array` are decoded**, rather than stringified into `"60,33,100,..."` and silently left without SRI.
- **A concrete `Access-Control-Allow-Origin` counts as CORS support.** Only `*` was accepted, so a CDN scoped to your origin was silently skipped; the `includes('*')` branch also wrongly accepted `https://*.example.com`.

### Tests

- Added `test/sri.test.js`. The existing suite mocks `crypto`, so it never verified a real hash; the new file runs an actual `vite build` over a temp fixture containing a dynamic import and checks the injected hashes against the emitted bytes, plus pins each regression above.
- Upgraded the build/test toolchain: `vitest` and `@vitest/coverage-v8` 3 -> 5, `@rollup/plugin-commonjs` 25 -> 29, `@rollup/plugin-node-resolve` 15 -> 16, plus `rollup` and `vite` to current. No source or config changes were needed; both dist formats smoke-tested after the rebuild.
- Removed the unused `memfs` devDependency - it was declared but never imported, the same dead weight `cheerio` was in 4.0.0.
- Bumped CI actions to their current majors (`actions/checkout@v7`, `actions/setup-node@v7`, `codecov/codecov-action@v7`) and moved both workflows to Node `24`, the Active LTS - Node `22` entered maintenance on 2025-10-21. All codecov inputs in use (`token`, `files`, `directory`, `report_type`, `fail_ci_if_error`) are unchanged in v7.
- Added `oxlint` with a `lint` npm script and a CI job. Only the `correctness` and `suspicious` categories are enabled: `correctness` is the category that finds real defects, and both are clean. `perf` was rejected because its only finding here is `no-await-in-loop` against the retry loops in `network-utils.js`, where sequential awaiting is the point and the rule's `Promise.all` suggestion would break the retry; `pedantic`, `style` and `restriction` produce ~1000 findings between them with no defect among them.
- Added a `compat` CI matrix running the real-build tests against Vite `6.4`, `7.0` and `8`, so the peer range is verified rather than asserted. The existing job still owns coverage reporting on the pinned devDependency.
- Removed a broken `path` mock from `test/index.test.js` that targeted `path` rather than `node:path` and exposed no default export, so the relative-base code path was never exercised.

- **`logLevel: 'silent'` now actually silences output.** The level lookup used `||`, and `silent` is `0`, so it fell through to `warn` — the one level whose entire purpose is suppression behaved identically to a typo.

### Documentation

- Added a Dynamic Routes section to the README covering both new options and their shared staleness caveat.
- Added a "When SRI Actually Helps" section: SRI earns its keep when HTML and assets have different trust boundaries (origin HTML, CDN assets). For a single-origin build, an attacker who can rewrite the asset can usually rewrite the HTML carrying its hash too, and CSP plus hashed immutable filenames do more.
- Documented in `CLAUDE.md`, with measurements, why the import-analysis patching cannot be replaced by `transformIndexHtml` or an `enforce: 'post'` generateBundle.
- `example/vite.config.js` used `debug: true`, which has not been an option since 4.0.0; corrected to `logLevel: 'debug'`.

## [4.0.0] - 2026-05-14

### Breaking Changes

- Dropped support for Vite 6. Peer dependency range is now `^7.0.0 || ^8.0.0`.
- Renamed README-documented options to match the actual code: `algorithm` → `hashAlgorithm`, `debug` → `logLevel`. The code has always used the new names; users following the old README had their config silently ignored. Audit your `sri({ ... })` call if you set `algorithm` or `debug`.

### Features

- **Vite 8 support.** Verified against Vite `8.0.12`, including the Rolldown-based native build path. The plugin now patches both `vite:build-import-analysis` (legacy/Rollup path) and `native:import-analysis-build` (Rolldown native path) when present.
- **`crossorigin="anonymous"` is now actually injected** alongside `integrity="..."`. The README and example HTML have always claimed this, but the source only inserted `integrity`. Without `crossorigin`, browsers fail SRI checks on cross-origin resources. Tags that already declare `crossorigin` (with any value) are left untouched.

### Improvements

- `createHash` and `path` imports use the `node:` prefix to match the rollup externals list, removing a potential bundler mismatch.
- Removed unused `cheerio` dependency (HTML parsing is regex-based; cheerio was never imported).
- Removed duplicate `cross-fetch` entry from `devDependencies`.
- Bundle-key suffix fallback now emits a debug log when it fires, with an inline comment explaining why both match directions are needed (hashed filenames and base-prefix mismatches) and why it is failure-closed (wrong hash → browser rejects the load).
- Error message now lists both internal-plugin names searched and the minimum supported Vite version.
- Idempotency checks for `integrity` and `crossorigin` use word-boundary regexes scoped to the matched tag, replacing a ±100-char substring window that could false-match across adjacent tags.

### Tests

- Added regression tests for crossorigin injection (local + external resources), Rolldown native plugin patching, the handler-object form of `generateBundle`, and both directions of the bundle-key suffix fallback.

## [3.1.0] - 2025-07-29

### Improvements

#### Code Architecture
- **Modular Design**: Completely refactored codebase into separate modules for better maintainability
  - `src/cache.js` - ResourceCache class with TTL and CacheManager for instance management
  - `src/network-utils.js` - Network operations including CORS checks and resource fetching
  - `src/integrity-calculator.js` - SRI hash computation and bundle key resolution
  - `src/html-parser.js` - HTML parsing, transformation, and integrity attribute injection
  - `src/logger.js` - Logger abstraction with configurable log levels

#### Logging System
- **Replaced Console Hijacking**: Eliminated the anti-pattern of modifying global console object
- **Instance-based Logger**: Each plugin instance now has its own logger with configurable levels
- **Better Log Formatting**: Automatic message formatting with plugin name prefix
- **Support for Child Loggers**: Hierarchical logging support for modular components
- **Log Levels**: Support for `silent`, `error`, `warn`, `info`, and `debug` levels

#### HTML Transformation
- **Function Decomposition**: Broke down complex `transformHTML` into smaller, focused functions:
  - `validateHtmlInput()` - Input validation
  - `processMatch()` - Single match processing
  - `processPatternMatches()` - Pattern-specific match processing
  - `collectIntegrityChanges()` - Change collection
  - `hasExistingIntegrity()` - Duplicate detection
  - `applyIntegrityChanges()` - Change application
- **Better Separation of Concerns**: Each function has a single responsibility
- **Improved Testability**: Smaller functions are easier to test independently

#### Memory Management
- **Instance-based Caching**: Eliminated global cache instances that could cause memory leaks
- **Proper Cleanup**: Each plugin instance manages its own cache lifecycle
- **No Global State Pollution**: Removed shared state between plugin instances

### Technical Details
- All functionality remains backward compatible
- No breaking changes to the public API
- All existing tests continue to pass (56/56)
- Build system unchanged

## [3.0.0] - 2025-07-02

### Breaking Changes

- Dropped support for Vite 4.0 and 5.0
- Bumped version to 3.0.0 to reflect major dependency changes

### Features

- Added support for Vite 7.0


## [2.0.0] - 2025-02-28

### Breaking Changes

- Bumped version to 2.0.0 to reflect major dependency updates

### Features

- Updated Vite dependency to v6.2.0 in example project
- Enhanced test coverage for HTML attribute handling

### Improvements

- Added console.log mock in tests for better coverage
- Added tests for various HTML attribute formats and spacing
- Added tests for non-standard crossorigin attribute values
- Added tests for silent log level handling

## [1.8.6] - 2025-02-17

### Features

- Added `ignoreMissingAsset` option to suppress warnings for missing assets
- Added example project for demonstration and testing
- Improved content type handling for different asset formats (string, Buffer, Uint8Array)

### Improvements

- Enhanced URL parsing for bypass domains
- Better error handling and logging
- Improved test coverage to 100%
- Removed TypeScript type annotations for better compatibility

## [1.8.5] - 2025-02-17

### Improvements

- Added .npmignore to exclude development files from npm package
- Optimized package size by excluding example directory and development configs

## [1.8.4] - 2025-02-17

### Features

- Added example project to demonstrate plugin usage with Vite
- Improved TypeScript support for content type handling
- Enhanced debug logging for bundle processing

### Improvements

- Better handling of different content types (string, Buffer, Uint8Array)
- Optimized bundle key resolution for hashed filenames
- Added detailed debug logging for bundle item processing

## [1.8.3] - 2025-02-17

### Breaking Changes

- Removed `inlineScripts` feature
- Changed from sriMap to direct bundle-based approach for SRI hash calculation

### Improvements

- Improved handling of Vite's hashed filenames (e.g., index-DPifqqS2.js)
- Added support for unquoted attributes in script and link tags
- Better path resolution for static and base URL prefixes
- More efficient bundle processing by removing intermediate hash storage
- Enhanced debug logging for easier troubleshooting

### Bug Fixes

- Fixed SRI hash calculation for internal resources with content hashes
- Fixed path resolution when using base URL configuration
- Fixed handling of static path prefix in resource URLs

## [1.8.1] - Previous Version

Initial version with basic SRI hash calculation functionality.
