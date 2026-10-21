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

## [0.1.0] - 2026-10-21

### Added
- Initial pre-alpha scaffold: `package.json`, `tsconfig.json`, Vitest configs,
  and a bootable stdio MCP server (`src/index.ts`). Tool surface lands with v1.
