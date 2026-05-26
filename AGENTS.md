# AGENTS.md

## What this is

A browser library that loads single HTML files as Web Components. No build step for consumers — style scoping, ESM support, and URL rewriting happen at runtime.

## Commands

```bash
# Build (produces 3 variants in dist/)
npm run build        # esbuild + dts-bundle-generator

# Dev (watch mode)
npm run dev          # esbuild --dev (file watcher)

# Tests (no script in package.json)
node --test src/*.test.ts

# Type check (declaration-only, no emit)
npx tsc --noEmit
```

The build produces three bundles:
- `dist/index.js` — external deps (for bundler consumers)
- `dist/index.cdn.js` — deps loaded from esm.sh
- `dist/index.bundled.js` — fully self-contained

## Architecture

Single-package ESM-only repo. All source is in `src/`, demos in `www/`, build config in `esbuild.ts`.

Key modules:
- `components.ts` — core `loadComponent()` / `defineComponent()` pipeline (fetch HTML → parse → rewrite → register custom element)
- `signals.ts` — reactive primitives (signal, computed, effect, effectScope)
- `template.ts` — reactive DOM bindings (#if, #for, @event, :attr, .prop, {{ expr }})
- `rewriter.ts` — rewrites import specifiers to absolute/blob URLs
- `config.ts` — global config object
- `index.ts` — public API re-exports

**Critical constraint:** The library uses stack trace parsing (`getImporterUrl()`) to detect the caller's URL. All source MUST be bundled into a single file for this to work. Do not split the build output.

## Style

- ESM-only (`"type": "module"` in package.json)
- TypeScript with `esnext` target, `nodenext` module resolution
- 2 spaces, LF, UTF-8, max 100 chars (`.editorconfig`)
- No linter or formatter configured
- Conventional commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`

## Testing

- Uses Node.js built-in test runner (`node:test` + `node:assert`)
- Test files co-located: `src/*.test.ts`
- `signals.test.ts` has real unit tests; `component.test.ts` and `template.test.ts` are closer to usage examples
- Tests are excluded from TS compilation via `tsconfig.json`

## Gotchas

- No lockfile is committed (all are gitignored). Install with any package manager.
- `esbuild.ts` is run directly via `node esbuild.ts` (not via a bundler plugin). It uses Node's native TS execution.
- `dts-bundle-generator` produces the single `.d.ts` file — it's a separate step after esbuild.
- The root `index.html` is a live demo page served via GitHub Pages (entire repo is deployed).
