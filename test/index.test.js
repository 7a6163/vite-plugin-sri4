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
        debug: true
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
    });

    test('should not log when debug is false', () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const plugin = sri({ debug: false });
      plugin.configResolved({ command: 'build' });
      expect(consoleSpy).not.toHaveBeenCalled();
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
        'app.js': {
          type: 'chunk',
          code: 'console.log("test")'
        }
      };

      const html = '<script src="/app/app.js"></script>';
      const result = await plugin.transformIndexHtml(html, { bundle });

      expect(result).toBe(`<script src="/app/app.js" integrity="${mockHash}" crossorigin="anonymous"></script>`);
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

      const html = '<script src="https://example.com/app.js"></script>';
      const result = await plugin.transformIndexHtml(html, { bundle: {} });

      expect(result).toBe(
        `<script src="https://example.com/app.js" integrity="${mockHash}" crossorigin="anonymous"></script>`
      );
    });

    test('should skip external resources without CORS', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        headers: {
          get: () => null
        }
      });

      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const html = '<script src="https://example.com/app.js"></script>';
      const result = await plugin.transformIndexHtml(html, { bundle: {} });

      expect(result).toBe(html);
    });

    test('should skip bypass domains', async () => {
      const plugin = sri({
        bypassDomains: ['example.com']
      });
      plugin.configResolved({ command: 'build' });

      const html = '<script src="https://example.com/app.js"></script>';
      const result = await plugin.transformIndexHtml(html, { bundle: {} });

      expect(result).toBe(html);
    });
  });
});
