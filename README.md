# vite-plugin-sri4

![NPM Version](https://img.shields.io/npm/v/vite-plugin-sri4)
[![codecov](https://codecov.io/gh/7a6163/vite-plugin-sri4/graph/badge.svg?token=GOVB4J3D19)](https://codecov.io/gh/7a6163/vite-plugin-sri4)
![License](https://img.shields.io/npm/l/vite-plugin-sri4)

A Vite plugin to generate Subresource Integrity (SRI) hashes for your assets during the build process. This plugin computes SRI hashes for JavaScript and CSS files and injects them as `integrity` and `crossorigin="anonymous"` attributes into your HTML, ensuring your resources have not been tampered with when loaded by browsers.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Plugin Options](#plugin-options)
- [Dynamic Routes](#dynamic-routes)
- [When SRI Actually Helps](#when-sri-actually-helps)
- [Example Project](#example-project)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Inspiration](#inspiration)
- [License](#license)

## Features

- **Automatic SRI Generation:** Computes SRI hashes for assets (chunks and files) using a configurable algorithm (default is `sha384`).
- **HTML Injection:** Automatically injects `integrity` and `crossorigin` attributes into `<script>` and `<link>` tags in your HTML.
- **CORS Support Check:** For external resources, a CORS check is performed to verify access via `Access-Control-Allow-Origin`.
- **Bypass Domains:** Option to specify domains to bypass SRI injection, plus a `skip-sri` attribute to opt out a single tag.
- **Public Directory Support:** Assets served verbatim from `publicDir` are hashed from disk, not just bundle outputs.
- **Zero Dependencies:** No runtime dependencies, and TypeScript definitions are included.
- **Missing Asset Handling:** Configurable warning suppression for missing assets.
- **Robust Content Support:** Handles various content types including strings, Buffer, and Uint8Array.
- **Dynamic Routes:** Optional import map integrity and an SRI manifest cover `import()`-loaded chunks and SSR builds, which have no build-time HTML tag to rewrite.
- **Vite Compatibility:** Compatible with Vite 6.4, 7.0 and 8.0 (including the Rolldown-based native build path). `6.4` is the floor because it is the only Vite 6 line still receiving upstream security patches.

## Installation

```bash
npm install vite-plugin-sri4 --save-dev
```

## Usage

Add the plugin to your Vite configuration by updating your vite.config.js or vite.config.ts file:

```javascript
// vite.config.js
import { defineConfig } from 'vite';
import sri from 'vite-plugin-sri4';

export default defineConfig({
  plugins: [
    sri({
      // Optional. The security hash algorithm. Defaults to "sha384".
      hashAlgorithm: 'sha384',
      // Optional. Domains to bypass SRI injection.
      bypassDomains: ['example.com'],
      // Optional. Suppress warnings for missing assets.
      ignoreMissingAsset: false,
      // Optional. Log verbosity: 'silent' | 'error' | 'warn' | 'info' | 'debug'. Defaults to 'warn'.
      logLevel: 'warn',
      // Optional. Inject an import map carrying integrity for every JS chunk,
      // covering dynamically imported routes. Defaults to false.
      importmap: false,
      // Optional. Emit dist/sri-manifest.json for SSR to read. Defaults to false.
      manifest: false
    })
  ]
});
```

### Example HTML Output

Input:
```html
<script src="app.js"></script>
<link rel="stylesheet" href="style.css">
```

Output:
```html
<script src="app.js" integrity="sha384-..." crossorigin="anonymous"></script>
<link rel="stylesheet" href="style.css" integrity="sha384-..." crossorigin="anonymous">
```

## Plugin Options

* `hashAlgorithm` (string):
  The hash algorithm used for computing SRI. Default is `sha384`. You may change it to other supported algorithms like `sha256` or `sha512`.
* `bypassDomains` (Array<string>):
  Array of domain names where SRI injection should be skipped. This allows external resources from specified domains to be excluded from SRI checks (for example, when they may not support CORS).
* `ignoreMissingAsset` (boolean):
  When true, warns instead of failing the build for assets found in neither the bundle nor `publicDir`. Default is `false`, which fails the build rather than shipping a tag with no integrity.
* `logLevel` (string):
  Log verbosity. One of `silent`, `error`, `warn`, `info`, `debug`. Default is `warn`. Use `debug` to see per-resource decisions during the build.
* `importmap` (boolean):
  Inject a `<script type="importmap">` containing an `integrity` map for every JS chunk in the build. Default is `false`. See [Dynamic routes](#dynamic-routes).
* `manifest` (boolean):
  Emit `sri-manifest.json` alongside the build, mapping every non-HTML output file to its SRI hash. Default is `false`. See [Dynamic routes](#dynamic-routes).

## Dynamic routes

Rewriting HTML tags can only protect resources that have a tag at build time. A route loaded with `import()` has none - Vite's preload helper creates the `<link rel="modulepreload">` at runtime - and an SSR build emits no HTML at all. Two options cover those cases.

### `importmap: true` (client-side dynamic imports)

Emits an import map whose `integrity` key covers every JS chunk, including chunks only ever reached through `import()`:

```html
<script type="importmap">{"integrity":{"/assets/about-a1b2c3.js":"sha384-..."}}</script>
```

The map is injected before the first `<script>` so it applies to every module. Engines without support ignore the `integrity` key rather than failing, so this degrades safely - but check current browser support before relying on it as your only protection.

### `manifest: true` (SSR / server-rendered HTML)

Emits `sri-manifest.json` mapping output file names to hashes, which a server rendering HTML per request can read:

```json
{
  "assets/index-a1b2c3.js": "sha384-...",
  "assets/index-d4e5f6.css": "sha384-..."
}
```

This is the only mechanism available when the build produces no HTML asset.

### Caveat for both

Hashes are computed during the build. A plugin that mutates chunk contents after this one (`@vitejs/plugin-legacy`, compression plugins that rewrite in place) would invalidate them, so the plugin re-hashes every file it touched in `writeBundle` and fails the build if anything drifted. You get a build error rather than a page that only breaks in the browser.

## When SRI Actually Helps

SRI is worth the most when your HTML and your assets have **different trust boundaries** - typically HTML served from your own origin and JS/CSS served from a CDN (`base: 'https://cdn.example.com/'`). If the CDN is compromised or a cache is poisoned, the integrity attribute in your origin-served HTML is what stops the browser from running the tampered file. That is the case this plugin is built for.

If everything is served from a single origin, SRI buys much less than it appears to: an attacker who can rewrite `/assets/index-abc123.js` on your server can usually rewrite the `index.html` carrying its hash just as easily. It is not useless - it narrows some deploy and cache-layer mistakes - but for same-origin builds, a Content Security Policy and Vite's default hashed, immutable filenames do more for you than SRI does. Enable it because it is cheap, not because it closes the hole you think it closes.

### Skipping a Single Tag

`bypassDomains` only reaches external hosts. To exclude one specific element, add `skip-sri` to it. The attribute is stripped from the output:

```html
<script skip-sri src="/legacy.js"></script>
```

```html
<!-- built output -->
<script src="/legacy.js"></script>
```

## Example Project

The plugin includes an example project in the `example` directory that demonstrates its usage with a simple Vite application. To try it:

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   cd example
   npm install
   ```
3. Build the example:
   ```bash
   npm run build
   ```
4. Check the generated `dist/index.html` to see the SRI hashes in action

The example project shows:
- Basic setup with Vite
- SRI hash generation for JS and CSS files
- Handling of hashed filenames
- Static file handling

## Best Practices

1. **Hash Algorithm Selection**
   - Use `sha384` (default) for a good balance of security and performance
   - Consider `sha512` for maximum security
   - Avoid `sha1` as it's considered cryptographically weak

2. **CORS Configuration**
   - Ensure your CDN or hosting service supports CORS
   - Set appropriate `Access-Control-Allow-Origin` headers
   - Use `bypassDomains` for trusted domains that don't support CORS

3. **Performance Optimization**
   - Enable `ignoreMissingAsset` in development for faster builds
   - Use debug mode only when troubleshooting

4. **Security Considerations**
   - Always use HTTPS for external resources
   - Regularly update the plugin for security fixes
   - Keep your dependencies up to date

## Troubleshooting

### Common Issues

1. **Missing Integrity Attributes**
   - Check if the file is in your build output
   - Verify the file path is correct
   - Enable debug mode to see detailed logs

2. **CORS Errors**
   - Ensure the resource supports CORS
   - Add the domain to `bypassDomains` if needed
   - Check network tab for CORS headers

3. **Build Performance**
   - Use `ignoreMissingAsset` if you have many external resources
   - Disable debug mode in production
   - Consider using a CDN for external resources

### Debug Mode

Set `logLevel: 'debug'` to see detailed logs:

```javascript
sri({
  logLevel: 'debug'
})
```

This will show:
- Asset processing steps
- SRI hash computation
- CORS checks
- Missing asset warnings
- Bundle-key fallback matches (when a URL is resolved via suffix match)

## Contributing

We welcome contributions! Here's how you can help:

1. Fork the repository
2. Create your feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -am 'Add some feature'`
4. Push to the branch: `git push origin feature/my-feature`
5. Submit a pull request

Please make sure to:
- Update the documentation
- Add tests for new features
- Follow the existing code style
- Update the CHANGELOG.md

## Inspiration

This project was inspired by [vite-plugin-sri3](https://github.com/yoyo930021/vite-plugin-sri3), which provides subresource integrity for Vite. We've built upon its foundation to create an enhanced version with additional features and improved compatibility.

Other projects that influenced this work:
- [rollup-plugin-sri](https://github.com/JonasKruckenberg/rollup-plugin-sri)
- [@small-tech/vite-plugin-sri](https://github.com/small-tech/vite-plugin-sri)

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

- Create an issue for bug reports
- Star the project if you find it useful
- Follow the author for updates
