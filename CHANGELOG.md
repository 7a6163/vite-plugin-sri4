# Changelog

All notable changes to this project will be documented in this file.

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
