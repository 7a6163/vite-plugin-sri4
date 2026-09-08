# CLAUDE.md

Vite plugin that injects SRI `integrity` + `crossorigin` attributes into built HTML.

## Commands

```bash
npm test              # vitest run (single test file: test/index.test.js)
npm run test:watch
npm run test:coverage # what CI runs
npm run build         # rollup -> dist/index.js (esm) + dist/index.cjs
```

## Architecture

ESM-only source in `src/`, bundled by rollup. Externals: `vite`, `cross-fetch`, `node:crypto`.

- `index.js` — plugin factory. `enforce: 'post'`, `apply: 'build'`.
- `html-parser.js` — regex patterns for `<script src>`, `<link rel=stylesheet>`, `<link rel=modulepreload>`; collects insert positions, applies them back-to-front.
- `integrity-calculator.js` — URL → bundle key resolution + hashing.
- `network-utils.js` — CORS `HEAD` check + fetch for external URLs, with retries/timeout.
- `cache.js` — TTL map (1h), per plugin instance, cleared in `buildEnd`.
- `logger.js` — level-gated console wrapper. Never hijack global console.

### The hook-patching trick

The plugin's own `generateBundle` does the work, but **only because it moves itself in `config.plugins` first**.

Vite places `vite:build-import-analysis` (Vite 6/7) / `native:import-analysis-build` (Vite 8 Rolldown) *immediately after* `enforce: 'post'` user plugins, and those substitute `__VITE_PRELOAD__` in entry chunks inside their own `generateBundle`. Measured on Vite 8.2.2:

```
plugin order      : sri=25, vite:build-import-analysis=26, total=37, frozen=false
generateBundle    : io6MKsmc4G5y   (entry chunk, stale)
writeBundle       : lvFyraHkqPN0   (entry chunk, final)
file on disk      : lvFyraHkqPN0
```

So by default we would hash an entry chunk still ending `import("./x.js"),__VITE_PRELOAD__)` while the written file ends `import("./x.js"),[])`. `configResolved` therefore splices this plugin to just after the *last* matching analysis plugin. `config.plugins` is a plain unfrozen array at that point and Rollup reads it afterwards, so this takes effect.

**Do not replace this with `transformIndexHtml` (`order: 'post'`) or a plain `enforce: 'post'` hook** — both were measured and both run at the stale point above. Earlier versions instead monkey-patched the analysis plugin's `generateBundle`; repositioning achieves the same ordering without rewriting another plugin's hook, and without needing to handle both the function and `{ handler }` hook shapes.

Only the entry chunk is affected, so a fixture without a dynamic import will not catch a regression here. `test/sri.test.js > injects integrity matching the actual emitted bytes` is the pin; the `writeBundle` drift check is the second net.

### Bundle key resolution

`getBundleKey` maps an HTML URL to a bundle key: strip query/fragment, strip leading `/`, or `path.posix.join` against the HTML dir when `config.base` is `./`/empty (`join`, never `resolve` — `resolve` makes the key absolute against CWD). On miss, `findBundleKey` falls back to a suffix match **anchored on `/`**, so `main.js` can never match `assets/vendor-main.js`. Multiple candidates warn.

URLs with a scheme (`data:`, `blob:`, `invalid:`) or protocol-relative `//host/...` are skipped, not treated as missing bundle assets.

`ignoreMissingAsset: false` (default) **throws**, and that error is deliberately *not* caught in `generateBundle` — a resource that cannot be hashed must fail the build rather than ship without integrity.

### Dynamic routes

Tag rewriting only covers tags that exist at build time. Two opt-in options cover the rest, both fed by `hashBundle()` in `index.js`:
- `importmap: true` — injects `<script type="importmap">{"integrity":{...}}</script>` before the first `<script>`, covering `import()`-loaded chunks.
- `manifest: true` — emits `sri-manifest.json` via `this.emitFile`, the only route for SSR builds with no HTML asset. Runs even when `htmlFiles` is empty.

Hashes are computed before any `emitFile` so the manifest never hashes itself.

### Drift check

`calculateIntegrity` records every `fileName -> integrity` it injects into `hashedAssets` (passed in via the options object). `writeBundle` re-hashes those files and throws if any changed, catching a plugin ordered after this one that rewrites chunk contents. Without it that failure is invisible until the browser refuses the file.

## Conventions

- No semicolons, 2-space indent, single quotes.
- `logger` is threaded through as an explicit argument (nullable in the lower-level modules), not a module global.
- Attribute matching reads attrs out of the matched tag (`getAttr`), never bakes attribute order into the tag regex — `<link href rel>` and `<link rel href>` are both valid HTML.
- Cleanup lives in `closeBundle`, not `buildEnd` — Rollup runs `buildEnd` *before* the output phase, so clearing there empties the caches before they're used.

## Tests

- `test/index.test.js` — legacy suite; mocks `cross-fetch` and `crypto` at module level, so it never verifies a real hash.
- `test/sri.test.js` — real hashes. `real vite build` runs an actual `vite build` (`write: false`) over a temp fixture with a dynamic import; `regressions` pins each browser-only failure mode (wrong-file hash, corrupted self-closing tag, duplicate `crossorigin`, silent skip). Add new coverage here.
- The temp fixture uses `realpathSync` — macOS `tmpdir()` is a symlink into `/private`, and Vite compares root paths literally.
