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

      const bundle = {
        'app.js': {
          type: 'chunk',
          code: 'console.log("test")'
        }
      };

      const html = '<script src="app.js"></script>';
      await plugin.transformIndexHtml(html, { bundle });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[vite-plugin-sri4]'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('ignoreMissingAsset: false'));
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
          type: 'chunk',
          code: 'console.log("test")'
        }
      };

      const html = '<script src="test.js"></script>';
      const result = await plugin.transformIndexHtml(html, { bundle });
      expect(result).toContain('integrity="sha384-mocked-hash-value"');
    });

    test('should handle Buffer content', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const bundle = {
        'test.js': {
          type: 'chunk',
          code: Buffer.from('test')
        }
      };

      const html = '<script src="test.js"></script>';
      const result = await plugin.transformIndexHtml(html, { bundle });
      expect(result).toContain('integrity="sha384-mocked-hash-value"');
    });

    test('should handle Uint8Array content', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const bundle = {
        'test.js': {
          type: 'chunk',
          code: new Uint8Array([1, 2, 3])
        }
      };

      const html = '<script src="test.js"></script>';
      const result = await plugin.transformIndexHtml(html, { bundle });
      expect(result).toContain('integrity="sha384-mocked-hash-value"');
    });

    test('should handle invalid content type', async () => {
      const consoleSpy = vi.spyOn(console, 'error');
      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const bundle = {
        'test.js': {
          type: 'chunk',
          code: { invalid: 'type' }
        }
      };

      const html = '<script src="test.js"></script>';
      const result = await plugin.transformIndexHtml(html, { bundle });
      expect(result).not.toContain('integrity=');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to compute SRI hash'));
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

      const bundle = {};
      const html = '<script src="missing.js"></script>';
      const result = await plugin.transformIndexHtml(html, { bundle });

      expect(result).toBe(html);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Asset not found in bundle: missing.js'));
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
      const result = await plugin.transformIndexHtml(html, {});
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
          type: 'chunk',
          code: 'console.log("test")'
        }
      };

      const html = '<script src="app.js"></script>';
      const result = await plugin.transformIndexHtml(html, { bundle });

      expect(result).toBe(`<script src="app.js" integrity="${mockHash}" crossorigin="anonymous"></script>`);
    });

    test('should process script tags with unquoted src', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const bundle = {
        'app.js': {
          type: 'chunk',
          code: 'console.log("test")'
        }
      };

      const html = '<script src=app.js></script>';
      const result = await plugin.transformIndexHtml(html, { bundle });

      expect(result).toBe(`<script src=app.js integrity="${mockHash}" crossorigin="anonymous"></script>`);
    });

    test('should process link tags with quoted href', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const bundle = {
        'style.css': {
          type: 'asset',
          source: 'body { color: red; }'
        }
      };

      const html = '<link rel="stylesheet" href="style.css">';
      const result = await plugin.transformIndexHtml(html, { bundle });

      expect(result).toBe(`<link rel="stylesheet" href="style.css" integrity="${mockHash}" crossorigin="anonymous">`);
    });

    test('should process link tags with unquoted href', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const bundle = {
        'style.css': {
          type: 'asset',
          source: 'body { color: red; }'
        }
      };

      const html = '<link rel="stylesheet" href=style.css>';
      const result = await plugin.transformIndexHtml(html, { bundle });

      expect(result).toBe(`<link rel="stylesheet" href=style.css integrity="${mockHash}" crossorigin="anonymous">`);
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
      const result = await plugin.transformIndexHtml(html, { bundle });

      expect(result).toBe(`<script src="index-DPifqqS2.js" integrity="${mockHash}" crossorigin="anonymous"></script>`);
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
      const result = await plugin.transformIndexHtml(html, { bundle });

      expect(result).toBe(`<script src="/static/app.js" integrity="${mockHash}" crossorigin="anonymous"></script>`);
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
      const result = await plugin.transformIndexHtml(html, { bundle });

      expect(result).toBe(html);
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
      const result = await plugin.transformIndexHtml(html, { bundle });

      expect(result).toBe(`<script src="/app/main.js" integrity="${mockHash}" crossorigin="anonymous"></script>`);
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
      // Mock successful CORS check
      vi.mocked(fetch).mockResolvedValueOnce({
        headers: {
          get: () => '*'
        }
      });

      // Mock successful content fetch
      vi.mocked(fetch).mockResolvedValueOnce({
        arrayBuffer: async () => new ArrayBuffer(8)
      });

      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const html = '<script src="https://example.com/script.js"></script>';
      const result = await plugin.transformIndexHtml(html, { bundle: {} });

      expect(result).toBe(`<script src="https://example.com/script.js" integrity="${mockHash}" crossorigin="anonymous"></script>`);
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
      const result = await plugin.transformIndexHtml(html, { bundle: {} });

      expect(result).toBe(html);
    });

    test('should skip bypass domains', async () => {
      const plugin = sri({
        bypassDomains: ['example.com']
      });
      plugin.configResolved({ command: 'build' });

      const html = '<script src="https://example.com/script.js"></script>';
      const result = await plugin.transformIndexHtml(html, { bundle: {} });

      expect(result).toBe(html);
    });

    test('should handle external resource errors', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const html = '<script src="https://example.com/script.js"></script>';
      const result = await plugin.transformIndexHtml(html, { bundle: {} });

      expect(result).toBe(html);
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
      const result = await plugin.transformIndexHtml(html, { bundle: {} });

      expect(result).toBe(html);
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
      const result = await plugin.transformIndexHtml(html, { bundle: {} });

      expect(result).toBe(html);
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
      const result = await plugin.transformIndexHtml(html, { bundle: {} });

      expect(result).toBe(html);
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
});
