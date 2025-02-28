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
- **Bypass Domains:** Option to specify domains to bypass SRI injection.
- **Missing Asset Handling:** Configurable warning suppression for missing assets.
- **Robust Content Support:** Handles various content types including strings, Buffer, and Uint8Array.

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
      algorithm: 'sha384',
      // Optional. Domains to bypass SRI injection.
      bypassDomains: ['example.com'],
      // Optional. Suppress warnings for missing assets.
      ignoreMissingAsset: false,
      // Optional. Enable debug logging.
      debug: false
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

* `algorithm` (string):
  The hash algorithm used for computing SRI. Default is sha384. You may change it to other supported algorithms like sha256.
* `bypassDomains` (Array<string>):
  Array of domain names where SRI injection should be skipped. This allows external resources from specified domains to be excluded from SRI checks (for example, when they may not support CORS).
* `ignoreMissingAsset` (boolean):
  When true, suppresses warnings for assets that are not found in the bundle. Default is false.
* `debug` (boolean):
  When true, enables detailed debug logging. Default is false.

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

Enable debug mode to see detailed logs:

```javascript
sri({
  debug: true
})
```

This will show:
- Asset processing steps
- SRI hash computation
- CORS checks
- Missing asset warnings

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
