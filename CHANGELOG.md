# Changelog

All notable changes to BiDi Browser MCP Server will be documented in this file.

## [Unreleased]

### Added
- Repository governance: `main` (public) / `dev` (working) split, automated
  promote-and-strip workflow, and a guard that keeps dev-only material off main.
- Tag-driven npm releases from `main` via Trusted Publishing (OIDC, tokenless)
  with GitHub Release bundles.
- pnpm toolchain, TypeScript strict scaffold, and a stdio MCP entry point.
- Dev-only `_archive/` with the BiDi build plan and protocol research.
- MCP Registry metadata (`mcpName`, `server.json`) and version-alignment checks.
- Dist-only npm packaging: `bin`/API split, postbuild executable mode, and
  `verify:package` / `verify:release` guards that keep repo docs and source out
  of the published tarball.

### Changed
- CLI entry moved to `src/bin.ts`; `src/index.ts` is now a side-effect-free
  `createServer()` API. `VERSION` derives from `package.json`.
- Node baseline raised to 20.19; CI matrix is Node 22/24.
- Release bundles now contain only `dist/`, `package.json`, `README.md`,
  `LICENSE`, and `server.json`.

## [0.1.0] - 2026-10-21

### Added
- Initial pre-alpha scaffold: `package.json`, `tsconfig.json`, Vitest configs,
  and a bootable stdio MCP server (`src/index.ts`). Tool surface lands with v1.
