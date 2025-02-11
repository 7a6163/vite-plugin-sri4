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

      expect(mocks.mockFetch).toHaveBeenCalledWith('https://external.com/script.js', { method: 'HEAD' });
    });

    it('should skip domains in bypassDomains list', async () => {
      const bypassPlugin = sri({ bypassDomains: ['bypass.com'] });
      const html = '<script src="https://bypass.com/script.js"></script>';
      const transformedHtml = await bypassPlugin.transformIndexHtml(html);

      expect(transformedHtml).not.toContain('integrity="');
      expect(mocks.mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Options Configuration', () => {
    it('should use custom hash algorithm', () => {
      const customPlugin = sri({ algorithm: 'sha512' });
      expect(customPlugin).toBeDefined();
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
      expect(mocks.mockFetch).toHaveBeenCalledWith('https://allowed.com/script.js', { method: 'HEAD' });
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
  });
});
