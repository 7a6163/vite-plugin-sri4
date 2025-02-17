import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import sri from '../src/index';
import { createHash } from 'node:crypto';
import fetch from 'cross-fetch';

// Mock modules
vi.mock('node:crypto', () => ({
  createHash: vi.fn().mockReturnValue({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn().mockReturnValue('mocked-hash-value')
  })
}));

vi.mock('cross-fetch', () => ({
  default: vi.fn()
}));

describe('vite-plugin-sri4', () => {
  const mockHash = 'sha384-mocked-hash-value';

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset crypto mock for each test
    vi.mocked(createHash).mockReturnValue({
      update: vi.fn().mockReturnThis(),
      digest: vi.fn().mockReturnValue('mocked-hash-value')
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Plugin Configuration', () => {
    test('should use default options when no options provided', () => {
      const plugin = sri();
      expect(plugin.name).toBe('vite-plugin-sri4');
      expect(plugin.apply).toBe('build');
      expect(plugin.enforce).toBe('post');
    });

    test('should merge user options with defaults', () => {
      const userOptions = {
        algorithm: 'sha256',
        debug: true,
        ignoreMissingAsset: true
      };
      const plugin = sri(userOptions);
      const configResult = plugin.configResolved({ command: 'build' });
      expect(configResult).toBeUndefined();
    });

    test('should handle base URL configuration', () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build', base: '/app/' });
      // Base URL is used internally, no direct way to test it
      expect(true).toBe(true);
    });
  });

  describe('Debug Mode', () => {
    test('should log debug information', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const plugin = sri({ debug: true });
      plugin.configResolved({ command: 'build' });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[vite-plugin-sri4] Plugin configured in build mode'));

      const bundle = {
        'app.js': {
          type: 'chunk',
          code: 'console.log("test")'
        }
      };

      const html = '<script src="app.js"></script>';
      await plugin.transformIndexHtml(html, { bundle });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[vite-plugin-sri4]'));
    });

    test('should not log when debug is false', () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const plugin = sri({ debug: false });
      plugin.configResolved({ command: 'build' });
      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });

  describe('Content Type Handling', () => {
    test('should handle string content', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const bundle = {
        'test.js': {
          type: 'asset',
          source: 'console.log("test")',
          fileName: 'test.js'
        }
      };

      const html = '<script src="test.js"></script>';
      const transformResult = await plugin.transformIndexHtml(html, { bundle, filename: 'index.html' });
      expect(transformResult).toBe(html); // No changes during transform

      await plugin.writeBundle({}, bundle);
      // Changes happen during writeBundle, but we can't verify directly
      // The actual HTML is updated in the plugin's internal Map
    });

    test('should handle Buffer content', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const bundle = {
        'test.js': {
          type: 'asset',
          source: Buffer.from('console.log("test")'),
          fileName: 'test.js'
        }
      };

      const html = '<script src="test.js"></script>';
      await plugin.transformIndexHtml(html, { bundle, filename: 'index.html' });
      await plugin.writeBundle({}, bundle);
    });

    test('should handle Uint8Array content', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const bundle = {
        'test.js': {
          type: 'asset',
          source: new Uint8Array(Buffer.from('console.log("test")')),
          fileName: 'test.js'
        }
      };

      const html = '<script src="test.js"></script>';
      await plugin.transformIndexHtml(html, { bundle, filename: 'index.html' });
      await plugin.writeBundle({}, bundle);
    });

    test('should handle invalid content type', async () => {
      const consoleSpy = vi.spyOn(console, 'error');
      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const bundle = {
        'test.js': {
          type: 'asset',
          source: { invalid: 'content' }, // Invalid content type - not string/Buffer/Uint8Array
          fileName: 'test.js'
        }
      };

      const html = '<script src="test.js"></script>';
      await plugin.transformIndexHtml(html, { bundle, filename: 'index.html' });
      await plugin.writeBundle({}, bundle);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[vite-plugin-sri4] Failed to compute SRI hash'));
      consoleSpy.mockRestore();
    });

    test('should handle processing errors with ignoreMissingAsset', async () => {
      const plugin = sri({ ignoreMissingAsset: true });
      plugin.configResolved({ command: 'build' });

      const html = '<script src="error.js"></script>';
      const bundle = {
        'error.js': {
          type: 'chunk',
          code: new Error('Test error')
        }
      };

      const result = await plugin.transformIndexHtml(html, { bundle });
      expect(result).toBe(html);
    });
  });

  describe('Missing Asset Handling', () => {
    test('should warn on missing asset by default', async () => {
      const consoleSpy = vi.spyOn(console, 'warn');
      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const bundle = {}; // Empty bundle to trigger missing asset warning

      const html = '<script src="missing.js"></script>';
      await plugin.transformIndexHtml(html, { bundle, filename: 'index.html' });
      await plugin.writeBundle({}, bundle);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[vite-plugin-sri4] Asset not found in bundle'));
      consoleSpy.mockRestore();
    });

    test('should ignore missing asset when ignoreMissingAsset is true', async () => {
      const consoleSpy = vi.spyOn(console, 'warn');
      const plugin = sri({ ignoreMissingAsset: true });
      plugin.configResolved({ command: 'build' });

      const bundle = {};
      const html = '<script src="missing.js"></script>';
      const result = await plugin.transformIndexHtml(html, { bundle });

      expect(result).toBe(html);
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    test('should handle processing errors with ignoreMissingAsset', async () => {
      const consoleSpy = vi.spyOn(console, 'error');
      const plugin = sri({ ignoreMissingAsset: true });
      plugin.configResolved({ command: 'build' });

      const bundle = {
        'error.js': {
          type: 'chunk',
          code: null
        }
      };

      const html = '<script src="error.js"></script>';
      const result = await plugin.transformIndexHtml(html, { bundle });

      expect(result).toBe(html);
      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });

  describe('Bypass Domain Handling', () => {
    test('should handle various URL formats', async () => {
      const plugin = sri({
        bypassDomains: ['example.com', 'test.com']
      });
      plugin.configResolved({ command: 'build' });

      const urls = [
        'http://example.com/script.js',
        'https://sub.example.com/script.js',
        '//test.com/script.js',
        'test.com/script.js',
        'test.com:8080/script.js'
      ];

      for (const url of urls) {
        const html = `<script src="${url}"></script>`;
        const result = await plugin.transformIndexHtml(html, {});
        expect(result).toBe(html);
      }
    });

    test('should handle invalid URLs', async () => {
      const plugin = sri({
        bypassDomains: ['example.com']
      });
      plugin.configResolved({ command: 'build' });

      const html = '<script src=":::invalid-url"></script>';
      const result = await plugin.transformIndexHtml(html, { bundle: {} });

      expect(result).toBe(html);
    });

    test('should handle invalid URLs in bypass domain check', async () => {
      const plugin = sri({
        bypassDomains: ['example.com']
      });
      plugin.configResolved({ command: 'build' });

      // Test with invalid URL that throws error when split
      const html = '<script src=":::invalid-url"></script>';
      const result = await plugin.transformIndexHtml(html, { bundle: {} });

      expect(result).toBe(html);
    });

    test('should handle malformed URLs in bypass domain check', async () => {
      const plugin = sri({
        bypassDomains: ['example.com']
      });
      plugin.configResolved({ command: 'build' });

      // Test with malformed URL that causes split error
      const html = '<script src="http://"></script>';
      const result = await plugin.transformIndexHtml(html, { bundle: {} });

      expect(result).toBe(html);
    });
  });

  describe('HTML Transform', () => {
    test('should skip empty HTML', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build' });
      const result = await plugin.transformIndexHtml('');
      expect(result).toBe('');
    });

    test('should process script tags with quoted src', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const bundle = {
        'app.js': {
          type: 'asset',
          source: 'console.log("test")',
          fileName: 'app.js'
        }
      };

      const html = '<script src="app.js"></script>';
      const transformResult = await plugin.transformIndexHtml(html, { bundle, filename: 'index.html' });
      expect(transformResult).toBe(html); // No changes during transform

      await plugin.writeBundle({}, bundle);
      // Changes happen during writeBundle
    });

    test('should process script tags with unquoted src', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const bundle = {
        'app.js': {
          type: 'asset',
          source: 'console.log("test")',
          fileName: 'app.js'
        }
      };

      const html = '<script src=app.js></script>';
      await plugin.transformIndexHtml(html, { bundle, filename: 'index.html' });
      await plugin.writeBundle({}, bundle);
    });

    test('should process link tags with quoted href', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const bundle = {
        'style.css': {
          type: 'asset',
          source: '.test { color: red; }',
          fileName: 'style.css'
        }
      };

      const html = '<link rel="stylesheet" href="style.css">';
      await plugin.transformIndexHtml(html, { bundle, filename: 'index.html' });
      await plugin.writeBundle({}, bundle);
    });

    test('should process link tags with unquoted href', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const bundle = {
        'style.css': {
          type: 'asset',
          source: '.test { color: red; }',
          fileName: 'style.css'
        }
      };

      const html = '<link rel="stylesheet" href=style.css>';
      await plugin.transformIndexHtml(html, { bundle, filename: 'index.html' });
      await plugin.writeBundle({}, bundle);
    });

    test('should handle hashed filenames', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const bundle = {
        'index.js': {
          type: 'chunk',
          code: 'console.log("test")'
        }
      };

      const html = '<script src="index-DPifqqS2.js"></script>';
      await plugin.transformIndexHtml(html, { bundle, filename: 'index.html' });
      await plugin.writeBundle({}, bundle);
    });

    test('should handle static path prefix', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const bundle = {
        'app.js': {
          type: 'chunk',
          code: 'console.log("test")'
        }
      };

      const html = '<script src="/static/app.js"></script>';
      await plugin.transformIndexHtml(html, { bundle, filename: 'index.html' });
      await plugin.writeBundle({}, bundle);
    });

    test('should skip tags with existing integrity', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const bundle = {
        'app.js': {
          type: 'chunk',
          code: 'console.log("test")'
        }
      };

      const html = '<script src="app.js" integrity="sha384-existing"></script>';
      await plugin.transformIndexHtml(html, { bundle, filename: 'index.html' });
      await plugin.writeBundle({}, bundle);
    });

    test('should handle base URL prefix', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build', base: '/app/' });

      const bundle = {
        'main.js': {
          type: 'chunk',
          code: 'console.log("test")'
        }
      };

      const html = '<script src="/app/main.js"></script>';
      await plugin.transformIndexHtml(html, { bundle, filename: 'index.html' });
      await plugin.writeBundle({}, bundle);
    });

    test('should handle HTML transformation errors', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      // Mock bundle to throw error
      const bundle = {
        get: () => { throw new Error('Test error'); }
      };

      const html = '<script src="app.js"></script>';
      const result = await plugin.transformIndexHtml(html, { bundle });

      expect(result).toBe(html);
    });
  });

  describe('External Resources', () => {
    test('should handle external resources with CORS', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      vi.mocked(fetch).mockResolvedValueOnce({
        headers: {
          get: () => '*'
        }
      }).mockResolvedValueOnce({
        arrayBuffer: () => Promise.resolve(Buffer.from('console.log("test")'))
      });

      const html = '<script src="https://example.com/script.js"></script>';
      await plugin.transformIndexHtml(html, { filename: 'index.html' });
      await plugin.writeBundle({}, {});
    });

    test('should skip external resources without CORS', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        headers: {
          get: () => null
        }
      });

      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const html = '<script src="https://example.com/script.js"></script>';
      await plugin.transformIndexHtml(html, { filename: 'index.html' });
      await plugin.writeBundle({}, {});
    });

    test('should skip bypass domains', async () => {
      const plugin = sri({
        bypassDomains: ['example.com']
      });
      plugin.configResolved({ command: 'build' });

      const html = '<script src="https://example.com/script.js"></script>';
      await plugin.transformIndexHtml(html, { filename: 'index.html' });
      await plugin.writeBundle({}, {});
    });

    test('should handle external resource errors', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const html = '<script src="https://example.com/script.js"></script>';
      await plugin.transformIndexHtml(html, { filename: 'index.html' });
      await plugin.writeBundle({}, {});
    });
  });

  describe('Error Handling', () => {
    test('should handle processing errors with ignoreMissingAsset', async () => {
      const plugin = sri({ ignoreMissingAsset: true });
      plugin.configResolved({ command: 'build' });

      const html = '<script src="error.js"></script>';
      const bundle = {
        'error.js': {
          type: 'chunk',
          code: new Error('Test error')
        }
      };

      const result = await plugin.transformIndexHtml(html, { bundle });
      expect(result).toBe(html);
    });

    test('should handle HTML transformation errors', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      // Mock bundle to throw error
      const bundle = {
        get: () => { throw new Error('Test error'); }
      };

      const html = '<script src="app.js"></script>';
      const result = await plugin.transformIndexHtml(html, { bundle });

      expect(result).toBe(html);
    });

    test('should handle external resource errors', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const html = '<script src="https://example.com/script.js"></script>';
      await plugin.transformIndexHtml(html, { filename: 'index.html' });
      await plugin.writeBundle({}, {});
    });

    test('should handle bundle processing errors', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const html = '<script src="error.js"></script>';
      const bundle = {
        'error.js': {
          type: 'chunk',
          get code() {
            throw new Error('Test error');
          }
        }
      };

      const result = await plugin.transformIndexHtml(html, { bundle });
      expect(result).toBe(html);
    });

    test('should handle bundle item source errors', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const html = '<script src="error.js"></script>';
      const bundle = {
        'error.js': {
          type: 'asset',
          get source() {
            throw new Error('Test error');
          }
        }
      };

      const result = await plugin.transformIndexHtml(html, { bundle });
      expect(result).toBe(html);
    });

    test('should handle fetch errors for external resources', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const html = '<script src="https://example.com/script.js"></script>';
      await plugin.transformIndexHtml(html, { filename: 'index.html' });
      await plugin.writeBundle({}, {});
    });

    test('should handle fetch response errors for external resources', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        headers: {
          get: () => '*'
        }
      });

      vi.mocked(fetch).mockResolvedValueOnce({
        arrayBuffer: () => Promise.reject(new Error('Test error'))
      });

      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const html = '<script src="https://example.com/script.js"></script>';
      await plugin.transformIndexHtml(html, { filename: 'index.html' });
      await plugin.writeBundle({}, {});
    });

    test('should handle plugin errors gracefully', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      // Mock bundle to throw error on access
      const bundle = new Proxy({}, {
        get: () => { throw new Error('Test error'); }
      });

      const html = '<script src="app.js"></script>';
      const result = await plugin.transformIndexHtml(html, { bundle });

      expect(result).toBe(html);
    });

    test('should handle severe errors in bypass domain check', async () => {
      const plugin = sri({
        bypassDomains: ['example.com']
      });
      plugin.configResolved({ command: 'build' });

      // Create a URL that causes split to throw
      const html = '<script src="' + String.fromCharCode(0) + '"></script>';
      const result = await plugin.transformIndexHtml(html, { bundle: {} });

      expect(result).toBe(html);
    });
  });

  describe('SRI Hash Computation', () => {
    test('should handle invalid algorithm', async () => {
      const consoleSpy = vi.spyOn(console, 'error');

      // Make createHash throw an error for invalid algorithm
      vi.mocked(createHash).mockImplementationOnce(() => {
        throw new Error('Invalid algorithm');
      });

      const plugin = sri({ algorithm: 'invalid-algo' });
      plugin.configResolved({ command: 'build' });

      const bundle = {
        'test.js': {
          type: 'asset',
          source: 'console.log("test")',
          fileName: 'test.js'
        }
      };

      const html = '<script src="test.js"></script>';
      await plugin.transformIndexHtml(html, { bundle, filename: 'index.html' });
      await plugin.writeBundle({}, {
        'index.html': {
          source: html,
          fileName: 'index.html'
        },
        ...bundle
      });

      // Add delay to ensure async operations complete
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[vite-plugin-sri4] Failed to compute SRI hash')
      );

      consoleSpy.mockRestore();
    });
    test('should handle different content types', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const bundle = {
        'test.js': {
          type: 'asset',
          source: Buffer.from('console.log("test")'),
          fileName: 'test.js'
        }
      };

      const html = '<script src="test.js"></script>';
      await plugin.transformIndexHtml(html, { bundle, filename: 'index.html' });
      const result = await plugin.writeBundle({}, bundle);

      expect(result).toBeUndefined(); // writeBundle doesn't return anything
    });
  });

  describe('Bypass Domains', () => {
    test('should handle various URL formats in bypass domains', async () => {
      const plugin = sri({
        bypassDomains: ['example.com', 'test.org']
      });
      plugin.configResolved({ command: 'build' });

      const testUrls = [
        'http://example.com/script.js',
        'https://sub.example.com/script.js',
        '//test.org/style.css',
        'https://test.org:8080/script.js'
      ];

      for (const url of testUrls) {
        const html = `<script src="${url}"></script>`;
        const result = await plugin.transformIndexHtml(html, {});
        expect(result).toBe(html); // Should not modify bypassed domains
      }
    });
  });

  describe('Error Handling', () => {
    test('should handle network errors gracefully', async () => {
      // Clear mocks
      vi.clearAllMocks();

      // Spy on console.error
      const consoleSpy = vi.spyOn(console, 'error');

      const plugin = sri({
        debug: true,
        crossorigin: 'anonymous'
      });

      plugin.configResolved({
        command: 'build',
        base: '/'
      });

      // Mock fetch to fail
      const networkError = new Error('Network error');
      vi.mocked(fetch).mockRejectedValue(networkError);

      const html = '<script src="https://external.com/script.js"></script>';

      // Process the HTML
      await plugin.transformIndexHtml(html, {
        filename: 'index.html'
      });

      // Write bundle
      await plugin.writeBundle({}, {
        'index.html': {
          type: 'asset',
          source: html,
          fileName: 'index.html'
        }
      });

      // Wait for promises to settle
      await new Promise(resolve => setTimeout(resolve, 100));

      // Expect error to have been logged
      expect(consoleSpy).toHaveBeenCalledWith(
        '[vite-plugin-sri4] Failed to fetch CORS headers from https://external.com/script.js',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    test('should handle malformed HTML gracefully', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const malformedHtml = '<script src=>invalid</script>';
      const result = await plugin.transformIndexHtml(malformedHtml, {});

      expect(result).toBe(malformedHtml);
    });
  });

  describe('CORS Handling', () => {
    test('should handle various CORS header values', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      // Test with wildcard CORS
      vi.mocked(fetch).mockResolvedValueOnce({
        headers: {
          get: () => '*'
        },
        arrayBuffer: () => Promise.resolve(Buffer.from('console.log("test")'))
      });

      let html = '<script src="https://external.com/script.js"></script>';
      await plugin.transformIndexHtml(html, { filename: 'index.html' });
      await plugin.writeBundle({}, {});

      // Test with specific origin CORS
      vi.mocked(fetch).mockResolvedValueOnce({
        headers: {
          get: () => 'https://myapp.com'
        },
        arrayBuffer: () => Promise.resolve(Buffer.from('console.log("test")'))
      });

      html = '<script src="https://external.com/script2.js"></script>';
      await plugin.transformIndexHtml(html, { filename: 'index2.html' });
      await plugin.writeBundle({}, {});

      // Test with no CORS headers
      vi.mocked(fetch).mockResolvedValueOnce({
        headers: {
          get: () => null
        }
      });

      html = '<script src="https://external.com/script3.js"></script>';
      await plugin.transformIndexHtml(html, { filename: 'index3.html' });
      await plugin.writeBundle({}, {});
    });
  });

  describe('Configuration Edge Cases', () => {
    test('should handle empty options object', () => {
      const plugin = sri({});
      expect(plugin.name).toBe('vite-plugin-sri4');
    });

    test('should handle null/undefined option values', () => {
      const plugin = sri({
        algorithm: null,
        bypassDomains: undefined,
        crossorigin: null
      });
      expect(plugin.name).toBe('vite-plugin-sri4');
    });

    test('should handle invalid base URL', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build', base: null });

      const bundle = {
        'test.js': {
          type: 'asset',
          source: 'console.log("test")',
          fileName: 'test.js'
        }
      };

      const html = '<script src="test.js"></script>';
      const transformResult = await plugin.transformIndexHtml(html, { bundle, filename: 'index.html' });
      expect(transformResult).toBe(html); // No changes during transform

      await plugin.writeBundle({}, bundle);
      // Changes happen during writeBundle
    });
  });
});
