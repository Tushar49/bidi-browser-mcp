# Contributing to BiDi Browser MCP Server

## Quick Start

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm verify:package
```

Requires Node.js 20.19+ and Firefox 129+ (BiDi is built in).

## Development Workflow

1. Fork the repo
2. Create a branch from `dev`: `git checkout dev && git checkout -b feat/my-feature`
3. Make changes in `src/`
4. Run `pnpm typecheck` (must pass)
5. Run `pnpm test` (must pass)
6. Update docs if needed (README, CHANGELOG, tool descriptions)
7. Commit with conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`
8. Push and open a PR against `dev` (not `main`)

## Architecture

See `AGENTS.md` (repo root) for the full contributor and agent guide.

Key principles:
- **DI via ServerContext** — no global mutable state
- **TypeScript strict mode** — no `any` without justification
- **Actionable errors** — every error tells the user how to fix it
- **Agent-friendly** — tool descriptions are the documentation
- **Minimal dependencies** — only `ws` and `@modelcontextprotocol/sdk`
- **BiDi-native** — no CDP assumptions (single session, no a11y tree)

## Adding a New Tool

1. Create `src/tools/my-tool.ts`
2. Use `defineTool()` from `./base-tool.js`
3. Export `registerMyToolTools(registry, ctx)`
4. Register it in `createServer()` in `src/index.ts`
5. Update README.md tool listing
6. Update CHANGELOG.md
7. Add unit tests under `src/__tests__/unit/`

## Packaging

The npm tarball is runtime-only. `files` allows `dist/` and npm always adds
`README`, `LICENSE`, and `package.json`. Source, tests, scripts, configs,
`AGENTS.md`, `CHANGELOG.md`, `server.json`, and `_archive/` must never ship.

```bash
pnpm verify:package    # fails if npm pack contains anything outside dist + metadata
pnpm verify:release    # package.json == server.json; add a tag to check versions
```

Release versions are bumped in `package.json` and `server.json` together.

## Running Tests

```bash
pnpm test                 # Unit tests (hermetic, MockBiDiServer)
pnpm test:integration     # Integration tests (needs a live Firefox)
pnpm benchmark            # Local benchmarks (needs a live Firefox)
```

Integration tests opt in via `FIREFOX_BIDI_WS_URL`; they never run in CI.

## Code Style
- TypeScript strict mode
- No `any` without comment explaining why
- Actionable errors via `Errors.*` factories
- Tool descriptions include agent guidance
