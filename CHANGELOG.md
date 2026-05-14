# Changelog

All notable changes to this project will be documented in this file.

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
