import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import sri from '../src/index.js';

const mocks = vi.hoisted(() => {
  const mockFetch = vi.fn();
  const mockDigest = vi.fn(() => 'mocked-hash-value');
  const mockUpdate = vi.fn().mockReturnThis();
  const mockCreateHash = vi.fn(() => ({
    update: mockUpdate,
    digest: mockDigest
  }));

  return {
    mockFetch,
    mockDigest,
    mockUpdate,
    mockCreateHash
  };
});

vi.mock('cross-fetch', () => ({
  default: mocks.mockFetch
}));

vi.mock('crypto', () => ({
  createHash: mocks.mockCreateHash
}));

describe('vite-plugin-sri4', () => {
  let plugin;
  const sriHash = 'sha384-mocked-hash-value';
  let consoleSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = sri();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mocks.mockFetch.mockResolvedValue({
      headers: new Map([
        ['access-control-allow-origin', '*']
      ])
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('Plugin Configuration', () => {
    it('should create plugin with default options', () => {
      expect(plugin.name).toBe('vite-plugin-sri4');
      expect(plugin.apply).toBe('build');
    });

    it('should create plugin with custom options', () => {
      const customPlugin = sri({
        algorithm: 'sha512',
        crossorigin: 'use-credentials',
        bypassDomains: ['example.com'],
        debug: true
      });
      expect(customPlugin).toBeDefined();
    });

    it('should handle invalid algorithm gracefully', () => {
      const invalidPlugin = sri({ algorithm: 'invalid-algo' });
      expect(invalidPlugin).toBeDefined();
    });

    it('should handle undefined options', () => {
      const undefinedPlugin = sri(undefined);
      expect(undefinedPlugin).toBeDefined();
    });
  });

  describe('Bundle Processing', () => {
    it('should process empty bundle', async () => {
      await plugin.generateBundle({}, {});
      expect(mocks.mockCreateHash).not.toHaveBeenCalled();
    });

    it('should process chunk with code', async () => {
      const bundle = {
        'app.js': {
          type: 'chunk',
          code: 'console.log("test")'
        }
      };
      await plugin.generateBundle({}, bundle);
      expect(mocks.mockCreateHash).toHaveBeenCalled();
    });

    it('should process asset with source', async () => {
      const bundle = {
        'style.css': {
          type: 'asset',
          source: '.test { color: red; }'
        }
      };
      await plugin.generateBundle({}, bundle);
      expect(mocks.mockCreateHash).toHaveBeenCalled();
    });

    it('should handle bundle items without code', async () => {
      const bundle = {
        'empty.js': {
          type: 'chunk'
        }
      };
      await plugin.generateBundle({}, bundle);
      expect(mocks.mockCreateHash).not.toHaveBeenCalled();
    });

    it('should handle missing type in bundle items', async () => {
      const bundle = {
        'unknown.js': {}
      };
      await plugin.generateBundle({}, bundle);
      expect(mocks.mockCreateHash).not.toHaveBeenCalled();
    });
  });

  describe('HTML Processing', () => {
    it('should process script tags', async () => {
      const bundle = {
        'app.js': {
          type: 'chunk',
          code: 'console.log("test")'
        }
      };
      await plugin.generateBundle({}, bundle);

      const html = '<script src="app.js"></script>';
      const result = await plugin.transformIndexHtml(html);
      expect(result).toContain('integrity="');
      expect(result).toContain('crossorigin="anonymous"');
    });

    it('should process link tags', async () => {
      const bundle = {
        'style.css': {
          type: 'asset',
          source: '.test { color: red; }'
        }
      };
      await plugin.generateBundle({}, bundle);

      const html = '<link rel="stylesheet" href="style.css">';
      const result = await plugin.transformIndexHtml(html);
      expect(result).toContain('integrity="');
      expect(result).toContain('crossorigin="anonymous"');
    });

    it('should handle script tags with existing attributes', async () => {
      const bundle = {
        'app.js': {
          type: 'chunk',
          code: 'console.log("test")'
        }
      };
      await plugin.generateBundle({}, bundle);

      const html = '<script src="app.js" type="module" async></script>';
      const result = await plugin.transformIndexHtml(html);
      expect(result).toContain('integrity="');
      expect(result).toContain('type="module"');
      expect(result).toContain('async');
    });

    it('should handle link tags with existing attributes', async () => {
      const bundle = {
        'style.css': {
          type: 'asset',
          source: '.test { color: red; }'
        }
      };
      await plugin.generateBundle({}, bundle);

      const html = '<link rel="stylesheet" href="style.css" media="screen">';
      const result = await plugin.transformIndexHtml(html);
      expect(result).toContain('integrity="');
      expect(result).toContain('media="screen"');
    });

    it('should handle resources with query parameters', async () => {
      const bundle = {
        'app.js': {
          type: 'chunk',
          code: 'console.log("test")',
          fileName: 'app.js'
        }
      };
      await plugin.generateBundle({}, bundle);

      const html = '<script src="app.js?v=123"></script>';
      const result = await plugin.transformIndexHtml(html);
      expect(result).toBe(html);
    });

    it('should process resources without query parameters', async () => {
      const bundle = {
        'app.js': {
          type: 'chunk',
          code: 'console.log("test")',
          fileName: 'app.js'
        }
      };
      await plugin.generateBundle({}, bundle);

      const html = '<script src="app.js"></script>';
      const result = await plugin.transformIndexHtml(html);
      expect(result).toContain('integrity="');
    });

    it('should handle malformed HTML gracefully', async () => {
      const html = '<script src=malformed"script.js">';
      const result = await plugin.transformIndexHtml(html);
      expect(result).toBe(html);
    });

    it('should skip processing for bypassed domains', async () => {
      const bypassPlugin = sri({ bypassDomains: ['example.com'] });
      const html = '<script src="https://example.com/script.js"></script>';
      const result = await bypassPlugin.transformIndexHtml(html);
      expect(result).not.toContain('integrity="');
    });
  });

  describe('External Resource Handling', () => {
    it('should handle CORS-enabled external resources', async () => {
      const html = '<script src="https://external.com/script.js"></script>';
      await plugin.transformIndexHtml(html);
      expect(mocks.mockFetch).toHaveBeenCalledWith(
        'https://external.com/script.js',
        expect.objectContaining({
          method: 'HEAD'
        })
      );
    });

    it('should handle CORS check failure', async () => {
      mocks.mockFetch.mockRejectedValueOnce(new Error('CORS check failed'));
      const html = '<script src="https://external.com/script.js"></script>';
      const result = await plugin.transformIndexHtml(html);
      expect(result).not.toContain('integrity="');
    });

    it('should handle network timeout', async () => {
      mocks.mockFetch.mockImplementationOnce(() =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 100)
        )
      );
      const html = '<script src="https://slow.com/script.js"></script>';
      const result = await plugin.transformIndexHtml(html);
      expect(result).not.toContain('integrity="');
    });

    it('should handle invalid URLs', async () => {
      const html = '<script src="invalid://url"></script>';
      const result = await plugin.transformIndexHtml(html);
      expect(result).toBe(html);
    });
  });

  describe('Debug Mode', () => {
    it('should log debug messages when enabled', async () => {
      const debugPlugin = sri({ debug: true });
      const bundle = {
        'app.js': {
          type: 'chunk',
          code: 'console.log("test")'
        }
      };
      await debugPlugin.generateBundle({}, bundle);

      const html = '<script src="app.js"></script>';
      await debugPlugin.transformIndexHtml(html);

      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should not log debug messages when disabled', async () => {
      const bundle = {
        'app.js': {
          type: 'chunk',
          code: 'console.log("test")'
        }
      };
      await plugin.generateBundle({}, bundle);

      const html = '<script src="app.js"></script>';
      await plugin.transformIndexHtml(html);

      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should log bundle generation messages', async () => {
      const debugPlugin = sri({ debug: true });
      await debugPlugin.generateBundle({}, {
        'app.js': {
          type: 'chunk',
          code: 'console.log("test")'
        }
      });
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should log HTML transformation messages', async () => {
      const debugPlugin = sri({ debug: true });

      await debugPlugin.generateBundle({}, {
        'app.js': {
          type: 'chunk',
          code: 'console.log("test")',
          fileName: 'app.js'
        }
      });

      await debugPlugin.transformIndexHtml('<script src="app.js"></script>');
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty HTML', async () => {
      const result = await plugin.transformIndexHtml('');
      expect(result).toBe('');
    });

    it('should handle HTML without any scripts or links', async () => {
      const html = '<div>Hello World</div>';
      const result = await plugin.transformIndexHtml(html);
      expect(result).toBe(html);
    });

    it('should handle multiple resources in same HTML', async () => {
      const bundle = {
        'app.js': {
          type: 'chunk',
          code: 'console.log("test")'
        },
        'style.css': {
          type: 'asset',
          source: '.test { color: red; }'
        }
      };
      await plugin.generateBundle({}, bundle);

      const html = `
        <script src="app.js"></script>
        <link rel="stylesheet" href="style.css">
      `;
      const result = await plugin.transformIndexHtml(html);
      const matches = result.match(/integrity="/g);
      expect(matches).toHaveLength(2);
    });

    it('should handle resources without file extension', async () => {
      const html = '<script src="/api/data"></script>';
      const result = await plugin.transformIndexHtml(html);
      expect(result).toBe(html);
    });
  });
});
