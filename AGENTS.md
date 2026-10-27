# bidi-browser-mcp — AGENTS.md

**Branches:** main (public) · dev (working) · **Version:** 0.1.8
Contributor + agent guide for this repo — identical file on both branches.
Short on purpose — details live in CONTRIBUTING.md (workflow), README.md
(product), CHANGELOG.md (history).

## Overview

Firefox **WebDriver BiDi** MCP server. Connects to the user's **real running
Firefox** (auth, cookies, sessions, containers preserved) over the native BiDi
WebSocket (`ws://127.0.0.1:9222/session`). Modular TypeScript, two runtime deps
only (`ws`, `@modelcontextprotocol/sdk`). No browser launch, no driver binary,
no Puppeteer/Playwright.

Status: v0.1.9 — the first public npm release. The stdio server boots and
exposes `ping`, `browser`, `tabs`, `page` (snapshot/content), `console`,
`observe`, `context` (containers), `spaces` (Zen), and `cleanup`. Socket drops
clear session state honestly and the next connect recovers. Chromium is
supported without chromedriver: the optional `chromium-bidi` mapper runs in
this process and translates BiDi↔CDP (see `docs/chromium-mapper.md`), with
Firefox-only tools gated by `UNSUPPORTED`.

## Structure

```
├── AGENTS.md                  # this file — identical on main and dev
├── README.md / CHANGELOG.md / CONTRIBUTING.md / LICENSE
├── src/
│   ├── bin.ts                 # CLI entry (shebang) → dist/bin.js
│   ├── index.ts               # public API: createServer(), VERSION — no side effects
│   ├── config.ts              # only env reader (BIDI_*)
│   ├── types.ts               # shared contracts
│   ├── connection/            # BiDi client, discovery, events, health [health planned]
│   ├── profile/               # containers.json + Zen session store (read-only)
│   ├── session/               # single-session manager, context manager
│   ├── snapshot/              # DOM snapshot, cache, resolver, optimizer
│   ├── tools/                 # base-tool, registry, ping, browser, tabs, page, console, observe, cleanup
│   ├── utils/                 # errors, result, assert (shared helpers)
│   └── __tests__/             # unit + mocks; integration/benchmark opt-in
├── scripts/                   # postbuild chmod, release + tarball checks
├── server.json                # MCP Registry metadata (never packed into npm)
├── .github/workflows/         # ci.yml, guard-main.yml, promote.yml, release.yml
└── .github/ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE
```

Dev-only material (`_archive/`, `.research/`, `.githooks/`, `.main.gitignore`)
lives on the **dev branch only** — it is deleted at every promote and never on
main. `_archive/development/plans/` holds the build plan; `_archive/research/`
holds protocol/browser research.

## BiDi constraints (do not design around CDP assumptions)

| Constraint | Consequence |
|---|---|
| Firefox allows **one BiDi session** | session-manager reuses it; a second `session.new` returns `BIDI_SESSION_BUSY`, never a retry loop |
| **No in-browser Remote Agent toggle** | only `--remote-debugging-port`; process discovery is read-only and never relaunches |
| **No accessibility tree** | snapshots use `script.evaluate` + JS DOM traversal; `locateNodes` is a resolver only |
| **No click/type command** | resolve coordinates via script, then `input.performActions` |
| `setViewport` is in **browsingContext** | not in `emulation`; emulation has geo/locale/orientation/timezone/UA/offline |
| **Debugger/profiler exist** | `moz:debugging` 153+, `moz:profiler` 154+; opt-in `devtools` toolset, not core |
| Output modes are env-driven | `BIDI_OUTPUT_MODE=full|inline` (`file` is rejected — not implemented), `BIDI_MAX_INLINE_LEN`; `BIDI_TEMP_DIR` is parsed but unused until the file mode lands |
| **One session per server process** | two MCP server processes cannot share it; broker is future work |

## Where to look

| Task | Location |
|---|---|
| Add/change a tool | `src/tools/<name>.ts` + `registry.ts`, follow `base-tool.ts` (`defineTool`) |
| Change connection/reconnect | `src/connection/{bidi-client,health-monitor,browser-discovery}.ts` |
| Change Chromium bridging | `src/connection/chromium-mapper.ts` + `docs/chromium-mapper.md` |
| Change event buffering/subscription | `src/connection/event-pipeline.ts` |
| Read containers/spaces profile data | `src/profile/profile-store.ts` |
| Change snapshots/element refs | `src/snapshot/{dom-snapshot,cache,element-resolver,token-optimizer}.ts` |
| Change session/context locking | `src/session/{session-manager,context-manager}.ts` |
| Change config surface | `src/config.ts` (only env reader) + `src/types.ts` |
| Cut a release | Tag main (`v*`); release.yml builds + publishes. Never release from dev. |
| Promote dev → main | Actions → "Promote dev to main" (or manual flow below) |

## Commands

```bash
pnpm install
pnpm setup               # install + build + test + verify + smoke probe
pnpm build              # tsc → dist/ + chmod bin on Unix
pnpm typecheck          # tsc --noEmit (run before every commit — zero errors)
pnpm lint               # alias of typecheck
pnpm test               # unit (vitest)
pnpm smoke              # zero-config Firefox/Zen BiDi probe
pnpm detect             # show Firefox-family processes and Remote Agent port
pnpm test:integration   # needs a real Firefox — local/dev only, not CI
pnpm benchmark          # local/dev only
pnpm verify:release     # package.json == server.json (and tag, when passed)
pnpm verify:package     # npm tarball is dist-only — no src/docs/etc.
```

Package manager: **pnpm** (canonical). npm works for script invocation, but the
lockfile and CI are pnpm.

## Local MCP verification (dev workflow)

Point the MCP client at the **local build** (`dist/bin.js` run via `node`),
not the published package. Run this checklist on EVERY dev session that touches
server code:

1. `pnpm build` — dist must reflect your changes
2. Reconnect the server (`/mcps` in the TUI → restart `bidi-browser`)
3. Verify behavior against the local build (tools are `bidi_browser_*`)
4. Only then promote dev → main and release

Machine-specific absolute paths live only in local tool config, never in repo
files. Package-manager preference: pnpm / `pnpm dlx` first; npx/npm only when
pnpm is unavailable.

The local OpenCode config points `bidi-browser` at this checkout's
`dist/bin.js` with an absolute path. Rebuild, then restart the MCP server.
After the first npm publish, switch that entry to
`pnpm dlx bidi-browser-mcp@latest` (or a global `bidi-browser-mcp`). Never commit
the absolute path.

## Code standards (carcass rules)

- **Minimal code.** No speculative abstraction. Add a helper on the second
  real use, not the first.
- **Reuse before adding.** `utils/errors.ts`, `utils/result.ts`,
  `utils/assert.ts`, `tools/base-tool.ts`, `tools/registry.ts` are the shared
  spine. Do not create a second error/result/envelope shape.
- **One env reader.** Only `config.ts` reads `process.env`; everything else
  receives `Config` through `ServerContext`.
- **Pure first.** Prefer pure functions. Classes only for stateful things
  (registry, client, session manager).
- **Tool contract.** Every tool goes through `defineTool`, declares an action
  enum, input schema, annotations, and returns the shared result shape.
- **Validate at the boundary.** Handlers validate their own args with
  `assert.ts` (or a future tiny helper); no implicit casts.
- **No `any`** without a justifying comment. No swallowed errors. No dead code.
- **Future folders get a README**, not empty stubs. Replace it with real modules
  when the wave starts.
- **Dependency gate.** No new runtime dependency without a design note. Runtime
  deps stay `ws` + `@modelcontextprotocol/sdk`; `chromium-bidi` is an optional
  dependency pinned exactly, justified in `docs/chromium-mapper.md`.

## Development rules

Always:
1. `pnpm typecheck` green before commit.
2. Conventional commits: `feat:` `fix:` `refactor:` `docs:` `chore:`.
3. User-facing change → CHANGELOG.md entry.
4. New/changed tool → README.md tool listing + agent-friendly description.
5. Version bumps only via the release flow (package.json + server.json together;
   `VERSION` in `src/index.ts` derives from package.json).
6. Unit tests are hermetic (MockBiDiServer); integration tests opt in via
   `BIDI_WS_URL`.
7. Every new module has a unit test; every bug fix gets a regression test. Test
   the contract, not the implementation detail.

Never:
1. Don't copy CDP's multi-session or accessibility-tree model into this repo.
2. No global mutable state — everything through `ServerContext` DI.
3. No swallowed errors — `ActionableError` with fix suggestions.
4. No `any` without a justifying comment.
5. Never close user tabs — cleanup default is detach.
6. No heavy deps — `ws` + `@modelcontextprotocol/sdk` only.
7. Integration/benchmark tests never run in CI (need a live browser).

## Packaging rules

The npm tarball is **runtime-only**. `package.json` uses an allowlist:
`files: ["dist", "!dist/**/*.map"]`. npm always adds `package.json`, `README`,
and `LICENSE`. Nothing else ships.

Never publish:
- `src/`, `scripts/`, tests, `tsconfig.json`, `vitest*.config.ts`
- `AGENTS.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `server.json`
- `.github/`, `_archive/`, `.research/`, `.githooks/`, lockfiles

`pnpm verify:package` runs `npm pack --dry-run` and fails on any unexpected
path. `pnpm verify:release` enforces `package.json` == `server.json` and, when
given a tag, `vX.Y.Z` == package version. Both run in CI and in the release
workflow. `server.json` stays at the repo root for MCP Registry publication;
it is intentionally not shipped to npm.

## Branch policy (main vs dev)

- **main** = public. Ships: product code, docs, workflows, templates. Never
  ships: `_archive/`, `.research/`, agent instructions, hooks, scratch.
  `.gitignore` on main enforces this; `guard-main.yml` fails any push/PR that
  breaks it.
- **dev** = working branch. Tracks everything main has PLUS `_archive/`
  (dev-only plans/research), `.research/` (active analysis being written now;
  parked under `_archive/` when done), `.githooks/`, and its own `.gitignore`
  (no `_archive`/`.research`/`.githooks` rules). Dev never cuts releases; CI
  runs typecheck + build + unit tests on every dev push.
- **`.gitignore` is branch-divergent by design.** main's copy is what ships.
  While working on dev, edit the shadow copy `.main.gitignore` (tracked on dev
  only) instead of `.gitignore` when the rule must also apply to main — at
  promote time it is copied over main's file (only when it changed) and the
  shadow copy itself is deleted, so it never lands on main. If dev adds a
  *shared* rule, it belongs in `.main.gitignore`. `guard-main.yml` fails if
  `.main.gitignore` reappears on main.
- **Promote flow (dev → main):** Actions → "Promote dev to main" workflow, or
  manually:
  `git checkout main && git pull` →
  `git merge --no-ff --no-commit origin/dev` →
  sync `.gitignore` from `.main.gitignore` when it changed →
  `git rm -r -f _archive .research .githooks .main.gitignore` →
  verify `git status` shows no strays →
  commit `Merge dev → main: <version>`.
  `.gitignore` alone never blocks a merge (it only affects untracked files) —
  deletion is explicit, policy second. Dev-only files modified since the last
  promote appear as modify/delete conflicts; `-f` resolves them as deletions.
- **Reference duty:** files that ship to main (README, CONTRIBUTING,
  changelogs) must not reference dev-only paths (`_archive/`, `.research/`,
  agent scratch). Point at the concept ("full design ships on dev") instead of
  the path.
- **Releases:** bump `package.json` and `server.json` together, promote to main,
  then tag `main` with `vX.Y.Z`; `release.yml` verifies metadata and the
  dist-only tarball, publishes a GitHub Release, and publishes to npm via
  Trusted Publishing (OIDC, no token). Prerelease tags (`vX.Y.Z-foo`) use the
  `alpha` dist-tag; stable tags use `latest`. Never release from dev.
