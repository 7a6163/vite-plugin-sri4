# vite-plugin-sri4

[![NPM Version](https://img.shields.io/npm/v/vite-plugin-sri4)](https://www.npmjs.com/package/vite-plugin-sri4)
[![codecov](https://codecov.io/gh/7a6163/vite-plugin-sri4/graph/badge.svg?token=GOVB4J3D19)](https://codecov.io/gh/7a6163/vite-plugin-sri4)
![License](https://img.shields.io/npm/l/vite-plugin-sri4)

A Vite plugin to generate Subresource Integrity (SRI) hashes for your assets during the build process. This plugin computes SRI hashes for JavaScript and CSS files and injects them as `integrity` and `crossorigin="anonymous"` attributes into your HTML, ensuring your resources have not been tampered with when loaded by browsers.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Plugin Options](#plugin-options)
- [Dynamic Routes](#dynamic-routes)
- [External Resources](#external-resources)
- [When SRI Actually Helps](#when-sri-actually-helps)
- [How It Attaches Hashes](#how-it-attaches-hashes)
- [Differences from vite-plugin-sri3](#differences-from-vite-plugin-sri3)
- [Example Project](#example-project)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Inspiration](#inspiration)
- [License](#license)

## Features

- **Automatic SRI Generation:** Computes SRI hashes for assets (chunks and files) using a configurable algorithm (default is `sha384`).
- **HTML Injection:** Automatically injects `integrity` and `crossorigin` attributes into `<script>` and `<link>` tags in your HTML.
- **External Resource Gating:** A resource on someone else's origin is hashed only when it is reachable, answers `Access-Control-Allow-Origin: *`, and its origin declares the URL immutable. Anything else is left alone with a warning naming the reason — a hash pins one snapshot of bytes, so it is only correct on a URL whose bytes never change. See [External resources](#external-resources).
- **Bypass and Trust Domains:** `bypassDomains` to leave a host alone, `trustDomains` to hash one whose headers do not declare it stable, plus a `skip-sri` attribute to opt out a single tag.
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
      // Optional. 'sha256' | 'sha384' | 'sha512'. Defaults to 'sha384'.
      hashAlgorithm: 'sha384',
      // Optional. 'anonymous' | 'use-credentials'. Defaults to 'anonymous'.
      crossorigin: 'anonymous',
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
  The hash algorithm used for computing SRI. One of `sha256`, `sha384` (default) or `sha512` — the only three the SRI spec defines. Anything else fails at startup rather than producing an attribute browsers silently reject.
* `crossorigin` (string):
  Value for the injected `crossorigin` attribute: `anonymous` (default) or `use-credentials`. Use the latter for a CDN that requires cookies or HTTP auth. Tags that already declare a `crossorigin` are left alone.
* `bypassDomains` (Array<string>):
  Hostnames to leave untouched, subdomains included. Use it to silence the warning for a host you have decided not to protect. See [External resources](#external-resources).
* `trustDomains` (Array<string>):
  Hostnames whose bytes you vouch for, subdomains included. An external resource is only hashed when its origin declares the URL immutable; a host listed here is hashed regardless. For a stable host that does not set the header — not for forcing SRI onto a vendor's rolling URL. See [External resources](#external-resources).
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

## External resources

The `writeBundle` drift check above covers **your own build outputs only**. Everything you build is hashed locally — bundle chunks and assets from their bytes, `public/` files from disk, and, with an absolute `base`, your own CDN URLs from the bundle rather than the network — so none of it depends on a server being reachable or honest at build time.

An external URL pointing at someone else's origin is different. It is fetched **once, at build time, from your build machine**, and the hash is taken from that copy. An `integrity` attribute pins those bytes forever, so it is only correct on a URL whose bytes never change — and the origin is the only party that knows whether that is true.

So the plugin asks it. One `GET` does the whole job — it carries both the bytes to hash and the headers the answer depends on. There is no separate `HEAD` probe, so a host that serves `GET` and refuses `HEAD` is not a problem; `js.tappaysdk.com` answers `403` to `HEAD` and `200` to `GET`, and is read correctly.

An external resource is hashed only when **all three** hold:

1. **The request succeeds.** A non-2xx response leaves nothing to check.
2. **`Access-Control-Allow-Origin: *`.** Injecting `integrity` also injects `crossorigin`, so a response scoped to one specific origin — or to none — would turn a working resource into a blocked one.
3. **The origin declares the URL immutable**: `Cache-Control: immutable`, or a `max-age` of a year or more — and nothing in the same header contradicting it. `private`, `no-store` and `no-cache` each veto it: freshness and shareability are orthogonal, so a per-client response can carry a long `max-age`, and `no-cache, max-age=<long>` is a real CDN spelling of "cache it, but revalidate every time". Or the host is in `trustDomains`.

Anything else is left alone, with a warning naming the URL and the reason. Nothing ships without integrity silently.

### Why immutability, and not a list of bad origins

Because the list is never finished. Version-pinned URLs and rolling ones are two clean clusters, and the CDNs drew the line themselves:

| URL | `Cache-Control` | |
|---|---|---|
| `cdnjs …/jquery/3.7.1/jquery.min.js` | `max-age=30672000, immutable` | hashed |
| `jsdelivr …/bootstrap@5.3.3/…` | `max-age=31536000, immutable` | hashed |
| `unpkg …/htmx.org@1.9.12/…` | `max-age=31536000` | hashed |
| `code.jquery.com/jquery-3.7.1.min.js` | `max-age=31536000` | hashed |
| `jsdelivr …/vue@3/…` (floating) | `max-age=604800` | skipped |
| `fonts.googleapis.com/css2?…` | `private, max-age=86400` | skipped |
| `plausible.io/js/script.js` | `public, max-age=86400` | skipped |
| `cdn.tailwindcss.com` | `max-age=14400` | skipped |
| `connect.facebook.net/en_US/sdk.js` | `public, max-age=1200` | skipped |
| `js.stripe.com/v3/` | `max-age=120` | skipped |
| `unpkg …/react@18/…` (floating) | `max-age=60` | skipped |

Nothing lands between 604800 and 30672000, so the threshold separates two clusters rather than splitting a spectrum.

A blacklist would have to catch every one of the bottom rows individually, and the ones that are ordinary `public` responses — `cdn.tailwindcss.com`, `plausible.io` — look exactly like a resource you *should* hash. Each gap ships a build that works today and breaks whenever that vendor deploys. The whitelist fails the other way: a resource you could have protected ships unprotected, and says so in the log.

`Vary` is deliberately not used. Google Fonts varies on `User-Agent` without declaring it there (`vary: Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site`), so a `Vary`-based check lets exactly that resource through.

### Getting a resource hashed

**Pin a version in the URL.** `unpkg.com/react@18.3.1/…` answers `max-age=31536000`; `unpkg.com/react@18/…` answers `max-age=60`. Same for jsdelivr. This is the fix, not a workaround — a floating URL and an integrity attribute are contradictory by construction.

**Or vouch for the host** when you know it is stable and it just does not say so. The shape to look for is a URL that already carries a version, served by an origin that simply sends no `Cache-Control` at all:

```
https://js.tappaysdk.com/sdk/tpdirect/v5.19.2

  access-control-allow-origin: *
  (no cache-control header)
```

The version is in the path, so those bytes are as fixed as any `immutable` response — the origin just never says so. That is what `trustDomains` is for:

```js
sri({ trustDomains: ['js.tappaysdk.com'] })
```

**When not to use it.** `trustDomains` overrides the one check that stands between you and a hash that stops matching. Do not point it at:

- **a URL without a version in it** — `js.stripe.com/v3/`, `cdn.tailwindcss.com`, `connect.facebook.net/en_US/sdk.js`. Stripe documents that `v3/` must not be pinned; forcing a hash onto it produces a page that works until their next deploy.
- **a floating range** — `unpkg.com/react@18/…` resolves to whatever 18.x is current.
- **a host that serves per-client responses** — `fonts.googleapis.com` answers `private` for a reason.

The test is not "do I trust this vendor". It is "will these exact bytes still be at this exact URL after their next release". If the answer comes from the URL itself, `trustDomains` is right; if it comes from hope, use `bypassDomains`.

**Or accept it and silence the warning** with `bypassDomains`. Third-party analytics and widget scripts are usually this case — they are built to auto-update, and there is nothing to pin:

```js
sri({ bypassDomains: ['www.googletagmanager.com', 'connect.facebook.net'] })
```

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

## How It Attaches Hashes

There are three places a Vite plugin can compute SRI hashes, and they are not equivalent. This one matters more than it looks, so it is worth writing down.

**In `transformIndexHtml`.** The obvious choice, and the one that reads best — you get the finished HTML and the bundle on the context. It produces wrong hashes for entry chunks. Vite's import-analysis plugin substitutes `__VITE_PRELOAD__` inside its own `generateBundle`, which runs *after* `transformIndexHtml`, so an entry chunk still reads `import("./route.js"), __VITE_PRELOAD__)` at that point while the written file reads `import("./route.js"), [])`. The hash describes bytes that never ship, and the browser rejects the file with no build error at all.

**In a plain `enforce: 'post'` `generateBundle`.** Same problem. Vite places its import-analysis plugin immediately after post user plugins, so a post hook is still one step too early.

**Where this plugin does it.** During `configResolved` it moves itself after that plugin in `config.plugins`, then works in an ordinary `generateBundle`. Measured on Vite 8.2.2, hashing the entry chunk:

| Hook | Entry chunk | Matches shipped file |
|---|---|---|
| `transformIndexHtml` (post) | `io6MKsmc4G5y` | ✗ |
| `generateBundle` (post) | `io6MKsmc4G5y` | ✗ |
| after repositioning | `lvFyraHkqPN0` | ✓ |
| written file | `lvFyraHkqPN0` | — |

Only the entry chunk is affected, so a build without a dynamic import will not reveal the difference. As a second safeguard, every hashed file is re-hashed in `writeBundle` and the build fails if anything changed after the hash was taken.

This ordering constraint was first identified by [vite-plugin-sri3](https://github.com/yoyo930021/vite-plugin-sri3), which this plugin began as a fork of. See [Differences from vite-plugin-sri3](#differences-from-vite-plugin-sri3).

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

2. **External Resources**
   - Pin a version in the URL. `unpkg.com/react@18.3.1/…` answers `max-age=31536000` and gets a hash; `unpkg.com/react@18/…` answers `max-age=60` and does not
   - Serve your own assets with `Access-Control-Allow-Origin: *` and an immutable `Cache-Control`
   - Use `bypassDomains` for a host you have decided not to protect — a vendor's auto-updating widget or analytics script
   - Use `trustDomains` only for a host you control that is stable but does not say so in its headers

3. **Performance Optimization**
   - Enable `ignoreMissingAsset` in development for faster builds
   - Use debug mode only when troubleshooting

4. **Security Considerations**
   - Always use HTTPS for external resources
   - Regularly update the plugin for security fixes
   - Keep your dependencies up to date

## Troubleshooting

### Common Issues

1. **An external resource has no integrity**
   - Read the build log. Every skip warns and names its reason
   - `does not declare this URL immutable` — the origin's `Cache-Control` is short, or carries `private` / `no-cache` / `no-store`. Pin a version in the URL, or see [Getting a resource hashed](#getting-a-resource-hashed)
   - `Access-Control-Allow-Origin is absent` / `not "*"` — nothing to do at build time; `bypassDomains` silences it

2. **A local asset has no integrity**
   - Check the file is in your build output, or in `publicDir`
   - Verify the path in the tag matches, including `base`
   - Enable debug mode to see per-resource decisions

3. **The browser blocks a resource that has integrity**
   - The bytes changed after the build. If it is your own output, a plugin ordered after this one rewrote it — the `writeBundle` drift check should have failed the build, so check the plugin order
   - If it is external, the URL is not as immutable as its headers claim. Move it to `bypassDomains`

4. **Build Performance**
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

## Differences from vite-plugin-sri3

This plugin began as a fork of [vite-plugin-sri3](https://github.com/yoyo930021/vite-plugin-sri3) and the two have since diverged. Compared against sri3 `2.0.0`:

| | sri3 2.0.0 | sri4 5.1.0 |
|---|---|---|
| Vite range | `^3 ‖ ^4 ‖ ^5 ‖ ^6 ‖ ^7 ‖ ^8` | `^6.4 ‖ ^7 ‖ ^8` |
| Bundle outputs | ✅ | ✅ |
| `publicDir` assets | ✅ | ✅ |
| `skip-sri` per-tag opt-out | ✅ | ✅ |
| TypeScript definitions | ✅ | ✅ |
| Hash algorithm | `sha384`, fixed | `sha256` / `sha384` / `sha512`, validated at startup |
| `crossorigin` attribute | not injected | injected, `anonymous` or `use-credentials` |
| External resources | fetched unconditionally | gated on reachability, CORS and immutability |
| Timeout / retry / cache on those fetches | ❌ | ✅ |
| `bypassDomains` / `trustDomains` | ❌ | ✅ |
| Hash drift detection | ❌ | re-hashed in `writeBundle`, build fails on drift |
| `import()`-loaded routes, SSR | ❌ | `importmap` and `manifest` options |
| Hook ordering | monkey-patches Vite's `generateBundle` | repositions itself in `config.plugins` |

**Where sri3 is the better fit:** it supports Vite 3 through 5, which this plugin dropped. If you are on an older Vite, it is the only one of the two that works.

**The difference that matters most:** sri3 injects `integrity` without `crossorigin`. SRI on a cross-origin resource requires CORS, so a browser blocks a cross-origin `<script>` or `<link>` that carries `integrity` and no `crossorigin` — which makes sri3's external-resource support difficult to use for the case SRI is usually reached for. That gap is what most of the column above grew out of: injecting `crossorigin` means the CORS response has to be checked at build time, and checking it exposed everything else worth checking.

## Inspiration

Other projects that influenced this work:
- [rollup-plugin-sri](https://github.com/JonasKruckenberg/rollup-plugin-sri)
- [@small-tech/vite-plugin-sri](https://github.com/small-tech/vite-plugin-sri)

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

- Create an issue for bug reports
- Star the project if you find it useful
- Follow the author for updates
