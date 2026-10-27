# Contributing to BiDi Browser MCP Server

## Quick Start

```bash
pnpm install
pnpm setup
pnpm build
pnpm typecheck
pnpm test
pnpm smoke
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
- **BiDi-native** — no CDP assumptions (single session, no full a11y tree)
- **Minimal code** — add a helper on the second real use, not the first
- **Tested** — every new module has a unit test; every fix gets a regression test

## Carcass conventions (v0.1.3)

- `src/config.ts` is the only place that reads `process.env`.
- Shared result/error/validation helpers live in `src/utils/`; do not duplicate
  the envelope.
- Future folders (`connection/`, `session/`, `snapshot/`) have a README until
  their wave starts. Replace the README with real modules, not empty stubs.
- `src/index.ts` stays side-effect-free on import; `src/bin.ts` owns stdio.
- `dist/` is generated. Never edit it.

## Adding a New Tool

1. Create `src/tools/my-tool.ts`
2. Use `defineTool()` from `./base-tool.js`; declare `toolset`, actions, input
   schema, output schema where stable, and annotations
3. Validate arguments with `src/utils/assert.ts` (or a future tiny helper)
4. Return the shared result via `ok()` / `fail()` from `src/utils/result.js`
5. Register the exported tool in `createServer()` in `src/index.ts`
6. Update README.md tool listing
7. Update CHANGELOG.md
8. Add unit tests under `src/__tests__/unit/`; use `MockBiDiServer`, not Firefox

## Local OpenCode config

The local dev entry points at `dist/bin.js` with an absolute path, outside the
repo. Run `pnpm build`, then restart the MCP server. After the first npm
publish, switch to `pnpm dlx bidi-browser-mcp@latest` (or a global install).
Do not commit machine-specific paths.

## Packaging

The npm tarball is runtime-only. `files` allows `dist/` and npm always adds
`README`, `LICENSE`, and `package.json`. Source, tests, scripts, configs,
`AGENTS.md`, `CHANGELOG.md`, `server.json`, and any dev-only material must
never ship.

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

Integration tests opt in via `BIDI_WS_URL`; they never run in CI.

## Code Style
- TypeScript strict mode
- No `any` without comment explaining why
- Actionable errors via `ActionableError` (`src/utils/errors.ts`)
- Tool descriptions include agent guidance
