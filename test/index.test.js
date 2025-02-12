import { describe, it, expect, vi, beforeEach } from 'vitest';
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

vi.mock('node-fetch', () => ({
  default: mocks.mockFetch
}));

vi.mock('crypto', () => ({
  createHash: mocks.mockCreateHash
}));

describe('vite-plugin-sri4', () => {
  let plugin;
  const sriHash = 'sha384-mocked-hash-value';

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = sri();

    mocks.mockFetch.mockResolvedValue({
      headers: new Map([
        ['access-control-allow-origin', '*']
      ])
    });

    // Mock the bundle assets
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

    // Generate SRI hashes for the bundle
    plugin.generateBundle({}, bundle);
  });

  describe('Basic Configuration', () => {
    it('should create a plugin with correct name', () => {
      expect(plugin.name).toBe('vite-plugin-sri4');
    });

    it('should only run during build', () => {
      expect(plugin.apply).toBe('build');
    });
  });

  describe('generateBundle', () => {
    it('should generate SRI hash for chunks', async () => {
      const bundle = {
        'app.js': {
          type: 'chunk',
          code: 'console.log("test")'
        }
      };

      await plugin.generateBundle({}, bundle);
      expect(mocks.mockCreateHash).toHaveBeenCalled();
    });

    it('should generate SRI hash for assets', async () => {
      const bundle = {
        'style.css': {
          type: 'asset',
          source: '.test { color: red; }'
        }
      };

      await plugin.generateBundle({}, bundle);
      expect(mocks.mockCreateHash).toHaveBeenCalled();
    });
  });

  describe('transformIndexHtml', () => {
    beforeEach(() => {
      mocks.mockFetch.mockReset();
      mocks.mockFetch.mockResolvedValue({
        headers: new Map([
          ['access-control-allow-origin', '*']
        ])
      });
    });

    it('should add integrity attribute to internal scripts', async () => {
      const bundle = {
        'app.js': {
          type: 'chunk',
          code: 'console.log("test")'
        }
      };
      await plugin.generateBundle({}, bundle);

      const html = '<script src="/app.js"></script>';
      const transformedHtml = await plugin.transformIndexHtml(html);

      expect(transformedHtml).toContain(`integrity="${sriHash}"`);
      expect(transformedHtml).toContain('crossorigin="anonymous"');
    });

    it('should add integrity attribute to internal stylesheets', async () => {
      const bundle = {
        'style.css': {
          type: 'asset',
          source: '.test { color: red; }'
        }
      };
      await plugin.generateBundle({}, bundle);

      const html = '<link rel="stylesheet" href="/style.css">';
      const transformedHtml = await plugin.transformIndexHtml(html);

      expect(transformedHtml).toContain(`integrity="${sriHash}"`);
      expect(transformedHtml).toContain('crossorigin="anonymous"');
    });

    it('should handle CORS check for external resources', async () => {
      const html = '<script src="https://external.com/script.js"></script>';
      await plugin.transformIndexHtml(html);

      expect(mocks.mockFetch).toHaveBeenCalledWith(
        'https://external.com/script.js',
        expect.objectContaining({
          method: 'HEAD'
        })
      );
    });

    it('should skip domains in bypassDomains list', async () => {
      const bypassPlugin = sri({ bypassDomains: ['bypass.com'] });
      const html = '<script src="https://bypass.com/script.js"></script>';
      const transformedHtml = await bypassPlugin.transformIndexHtml(html);

      expect(transformedHtml).not.toContain('integrity="');
      expect(mocks.mockFetch).not.toHaveBeenCalled();
    });

    it('should handle module scripts', async () => {
      const bundle = {
        'module.js': {
          type: 'chunk',
          code: 'export const test = "test";'
        }
      };
      await plugin.generateBundle({}, bundle);

      const html = '<script type="module" src="/module.js"></script>';
      const transformedHtml = await plugin.transformIndexHtml(html);

      expect(transformedHtml).toContain(`integrity="${sriHash}"`);
      expect(transformedHtml).toContain('crossorigin="anonymous"');
    });

    it('should handle multiple resources in the same HTML', async () => {
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
        <script src="/app.js"></script>
        <link rel="stylesheet" href="/style.css">
      `;
      const transformedHtml = await plugin.transformIndexHtml(html);

      expect(transformedHtml).toMatch(/integrity="[^"]+"/g);
      expect(transformedHtml.match(/crossorigin="anonymous"/g).length).toBe(2);
    });
  });

  describe('Options Configuration', () => {
    it('should use custom hash algorithm', () => {
      const customPlugin = sri({ algorithm: 'sha512' });
      expect(customPlugin).toBeDefined();
      expect(mocks.mockCreateHash).not.toHaveBeenCalledWith('sha512');
    });

    it('should handle bypassDomains configuration correctly', async () => {
      const bypassPlugin = sri({
        bypassDomains: ['bypass.com', 'skip.org']
      });

      const html = `
        <script src="https://bypass.com/script.js"></script>
        <script src="https://skip.org/other.js"></script>
        <script src="https://allowed.com/script.js"></script>
      `;

      const transformedHtml = await bypassPlugin.transformIndexHtml(html);

      expect(transformedHtml).not.toContain('bypass.com/script.js" integrity="');
      expect(transformedHtml).not.toContain('skip.org/other.js" integrity="');
      expect(mocks.mockFetch).toHaveBeenCalledWith(
        'https://allowed.com/script.js',
        expect.objectContaining({
          method: 'HEAD'
        })
      );
    });

    it('should handle custom crossorigin attribute', async () => {
      const customPlugin = sri({ crossorigin: 'use-credentials' });
      const bundle = {
        'app.js': {
          type: 'chunk',
          code: 'console.log("test")'
        }
      };
      await customPlugin.generateBundle({}, bundle);

      const html = '<script src="/app.js"></script>';
      const transformedHtml = await customPlugin.transformIndexHtml(html);

      expect(transformedHtml).toContain('crossorigin="use-credentials"');
    });
  });

  describe('Error Handling', () => {
    it('should gracefully handle CORS check failure', async () => {
      mocks.mockFetch.mockRejectedValueOnce(new Error('CORS check failed'));

      const html = '<script src="https://external.com/script.js"></script>';
      const transformedHtml = await plugin.transformIndexHtml(html);

      expect(transformedHtml).not.toContain('integrity="');
    });

    it('should handle invalid URLs', async () => {
      const html = '<script src="invalid-url"></script>';
      const transformedHtml = await plugin.transformIndexHtml(html);

      expect(transformedHtml).toBe(html);
    });

    it('should handle missing content in bundle', async () => {
      const bundle = {
        'empty.js': {
          type: 'chunk'
        }
      };

      await plugin.generateBundle({}, bundle);
      const html = '<script src="/empty.js"></script>';
      const transformedHtml = await plugin.transformIndexHtml(html);

      expect(transformedHtml).toBe(html);
    });

    it('should handle network timeouts', async () => {
      mocks.mockFetch.mockImplementationOnce(() =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 6000)
        )
      );

      const html = '<script src="https://slow.com/script.js"></script>';
      const transformedHtml = await plugin.transformIndexHtml(html);

      expect(transformedHtml).not.toContain('integrity="');
    });
  });

  describe('Debug Mode', () => {
    it('should log debug messages when debug is enabled', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const debugPlugin = sri({ debug: true });

      const bundle = {
        'app.js': {
          type: 'chunk',
          code: 'console.log("test")'
        }
      };

      await debugPlugin.generateBundle({}, bundle);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[vite-plugin-sri4]')
      );
    });

    it('should not log debug messages when debug is disabled', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const bundle = {
        'app.js': {
          type: 'chunk',
          code: 'console.log("test")'
        }
      };

      await plugin.generateBundle({}, bundle);

      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[vite-plugin-sri4]')
      );
    });
  });
});
