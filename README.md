# vite-plugin-sri4

A Vite plugin to generate Subresource Integrity (SRI) hashes for your assets during the build process. This plugin computes SRI hashes for JavaScript and CSS files and injects them as `integrity` and `crossorigin="anonymous"` attributes into your HTML, ensuring your resources have not been tampered with when loaded by browsers.

## Features

- **Automatic SRI Generation:** Computes SRI hashes for assets (chunks and files) using a configurable algorithm (default is `sha384`).
- **HTML Injection:** Automatically injects `integrity` and `crossorigin` attributes into `<script>` and `<link>` tags in your HTML.
- **CORS Support Check:** For external resources, a CORS check is performed to verify access via `Access-Control-Allow-Origin`.
- **Bypass Domains:** Option to specify domains to bypass SRI injection.

## Installation

If the plugin has been published to npm:

```bash
npm install vite-plugin-sri4 --save-dev
```

Alternatively, if you're developing locally, you can use npm link or install via a relative path.

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
      algorithm: 'sha384',
      // Optional. Domains to bypass SRI injection.
      bypassDomains: ['example.com']
    })
  ]
});
```

Now, when you run the build command:

```bash
npm run build
```

The plugin will process the generated bundles, compute SRI hashes, and inject the attributes into the HTML.

## Plugin Options

* algorithm (string):
The hash algorithm used for computing SRI. Default is sha384. You may change it to other supported algorithms like sha256.
* bypassDomains (Array<string>):
Array of domain names where SRI injection should be skipped. This allows external resources from specified domains to be excluded from SRI checks (for example, when they may not support CORS).
