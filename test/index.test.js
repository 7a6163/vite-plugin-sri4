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
  });

  describe('Build Mode', () => {
    test('should only process files in build mode', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'serve' });

      const result = await plugin.renderChunk('console.log("test")', {
        fileName: 'test.js'
      });

      expect(result).toBeNull();
    });

    test('should process chunks in build mode', async () => {
      const plugin = sri({ debug: true });
      plugin.configResolved({ command: 'build' });

      const code = 'console.log("test")';
      const chunk = { fileName: 'app.js' };

      await plugin.renderChunk(code, chunk);

      expect(vi.mocked(createHash)).toHaveBeenCalledWith('sha384');
    });
  });

  describe('Debug Mode', () => {
    test('should log debug information', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const debugPlugin = sri({ debug: true });

      debugPlugin.configResolved({ command: 'build' });

      const code = 'console.log("test")';
      const chunk = { fileName: 'app.js' };
      await debugPlugin.renderChunk(code, chunk);

      // 驗證日誌順序
      expect(consoleSpy).toHaveBeenNthCalledWith(1,
        '[vite-plugin-sri4] Plugin configured in build mode'
      );
      expect(consoleSpy).toHaveBeenNthCalledWith(2,
        '[vite-plugin-sri4] Stored SRI for path app.js: sha384-mocked-hash-value'
      );
      expect(consoleSpy).toHaveBeenNthCalledWith(3,
        '[vite-plugin-sri4] Stored SRI for path static/app.js: sha384-mocked-hash-value'
      );
      expect(consoleSpy).toHaveBeenNthCalledWith(4,
        '[vite-plugin-sri4] Stored SRI for path /static/app.js: sha384-mocked-hash-value'
      );

      expect(consoleSpy).toHaveBeenCalledTimes(4);
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

    test('should process script tags', async () => {
      const plugin = sri({ debug: true });
      plugin.configResolved({ command: 'build' });

      // Pre-compute hash
      const code = 'console.log("test")';
      const chunk = { fileName: 'app.js' };
      await plugin.renderChunk(code, chunk);

      const html = '<script src="app.js"></script>';
      const result = await plugin.transformIndexHtml(html);

      expect(result).toBe(`<script src="app.js" integrity="${mockHash}" crossorigin="anonymous"></script>`);
    });

    test('should process link tags', async () => {
      const plugin = sri({ debug: true });
      plugin.configResolved({ command: 'build' });

      // Pre-compute hash for CSS
      const asset = {
        fileName: 'style.css',
        source: 'body { color: red; }',
        type: 'asset'
      };
      const bundle = { 'style.css': asset };
      await plugin.generateBundle({}, bundle);

      const html = '<link rel="stylesheet" href="style.css">';
      const result = await plugin.transformIndexHtml(html);

      expect(result).toBe(`<link rel="stylesheet" href="style.css" integrity="${mockHash}" crossorigin="anonymous">`);
    });

    test('should skip tags with existing integrity', async () => {
      const plugin = sri();
      plugin.configResolved({ command: 'build' });

      const html = '<script src="app.js" integrity="sha384-existing"></script>';
      const result = await plugin.transformIndexHtml(html);

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

      const plugin = sri({ debug: true });
      plugin.configResolved({ command: 'build' });

      const html = '<script src="https://example.com/app.js"></script>';
      const result = await plugin.transformIndexHtml(html);

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
      const result = await plugin.transformIndexHtml(html);

      expect(result).toBe(html);
    });

    test('should handle bypass domains', async () => {
      const plugin = sri({
        bypassDomains: ['example.com']
      });
      plugin.configResolved({ command: 'build' });

      const html = '<script src="https://example.com/app.js"></script>';
      const result = await plugin.transformIndexHtml(html);

      expect(result).toBe(html);
    });
  });

  describe('Error Handling', () => {
    test('should handle failed SRI computation', async () => {
      // 重要: spy 需要在拋出錯誤之前設置
      const consoleSpy = vi.spyOn(console, 'error');

      // 強制 crypto 拋出錯誤
      vi.mocked(createHash).mockImplementationOnce(() => {
        throw new Error('Mock error');
      });

      const errorPlugin = sri();
      errorPlugin.configResolved({ command: 'build' });

      // 觸發錯誤
      const code = 'console.log("test")';
      const chunk = { fileName: 'error.js' };
      await errorPlugin.renderChunk(code, chunk);

      expect(consoleSpy).toHaveBeenCalledWith(
        '[vite-plugin-sri4] Failed to compute SRI hash: Error: Mock error'
      );

      // 清理
      consoleSpy.mockRestore();
    });

    test('should handle failed external resource fetch', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Mock fetch error'));

      const plugin = sri({ debug: true });
      plugin.configResolved({ command: 'build' });

      const html = '<script src="https://example.com/app.js"></script>';
      const result = await plugin.transformIndexHtml(html);

      expect(result).toBe(html);
    });
  });
});
