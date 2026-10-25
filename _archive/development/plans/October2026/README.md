# Implementation Plans — October 2026

Dev-branch only. This folder turns the October research into an executable
roadmap. The recommended options below are accepted; do not reopen them without
a concrete counterexample.

## Read order

1. [`v0.1.3-build-plan.md`](./v0.1.3-build-plan.md) — carcass (done).
2. [`v0.1.4-build-plan.md`](./v0.1.4-build-plan.md) — connection, discovery,
   session, `browser` status (done).
3. [`implementation-plan.md`](./implementation-plan.md) — product decisions,
   architecture, waves, release mapping.
4. [`release-plan-v0.2.0.md`](./release-plan-v0.2.0.md) — first usable release.
5. [`risk-register.md`](./risk-register.md) — what can go wrong and mitigation.
6. [`july-carryover.md`](./july-carryover.md) — what survived the July plan.
7. [`ToBeImplemented.md`](./ToBeImplemented.md) — parked features; not release
   commitments.

Research companions:
`../../research/October2026/README.md`.

## Current repo state

- Branch `dev`; `main` holds the previous scaffold via prior promote.
- `package.json` 0.1.4; stdio server boots; `tools/list` returns `ping` and
  `browser`.
- v0.1.3 and v0.1.4 are kept local. The first public npm release is v0.2.0.
- Config/errors/result/registry, discovery, BiDi client, and single-session
  manager are implemented and tested (28 unit tests).
- `pnpm setup`, `pnpm smoke`, and `pnpm detect` exist.
- Packaging, CI, promote, release, and registry metadata are already in place.
- No snapshot/browsing-tool code beyond `browser` exists yet.

## Product identity (fixed unless we explicitly change it)

> The Firefox you already use, over the protocol Firefox already speaks.

- Attach-only in v1. No browser launch, no bundled browser, no profile migration.
  Launch/private/incognito is future work, not a v1 promise.
- Direct WebDriver BiDi. No geckodriver, Selenium, Marionette, Puppeteer, or
  Playwright.
- Firefox-first in v1. Chromium via ChromeDriver is a future backend; Safari is
  deferred. Do not market "universal BiDi" yet.
- Real profile, cookies, logins, containers, extensions.
- Compact action-based MCP surface, not a 90-tool catalog.
- No stealth claims. `navigator.webdriver` is true.

## Decisions (accepted as recommended)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Default toolset | `core` (10 tools); `network`/`devtools` opt-in |
| D2 | First release scope | Connect + snapshot + observe + basic interaction (v0.2.0) |
| D3 | Minimum Firefox | Core 129+; recommended 153 ESR/158 stable; feature-detect |
| D4 | Debugger/profiler | Ship in v0.5 as opt-in `devtools` toolset |
| D5 | Extension install | Only with `BIDI_ALLOW_EXTENSION_INSTALL=1` + path allowlist |
| D6 | Snapshot UID strategy | `sharedId` for interactive nodes + CSS fallback |
| D7 | Output schema | Strict for stable tools; loose `{ok,action,data}` for mixed |
| D8 | Tool annotations | Conservative; document per-action risk because tools are action-based |
| D9 | `navigator.webdriver` messaging | Explicit in README and tool docs; no spoofing |
| D10 | Browser launch | Out of scope for v1; error with exact start command |
| D11 | Cross-browser | Backend seam now; Firefox only in v1; Chromium later; Safari deferred |
| D12 | Session sharing | One server process owns the session; broker is future work |

## Release map

| Version | Theme | Scope |
|---|---|---|
| 0.1.0 | Scaffold | Bootable stdio shell |
| **0.1.3** | Carcass | Done: directories, config/types/errors/result, registry, `ping`, `MockBiDiServer`, tests, contributor rules |
| **0.1.4** | Connect | Done: BiDi client, discovery, single session, `browser` status/profiles/connect/disconnect |
| **0.1.5** | Contexts | Done: events, tabs, context manager, console, observe, cleanup |
| **0.1.6** | Snapshot | Done: interactive DOM snapshot, cache, optimizer, `page` tool |
| **0.1.7** | Firefox-specific | Containers, Zen spaces, tab folders — `revised-roadmap-2026-10-23.md` |
| **0.1.8** | Chromium | Optimization pass + Chrome/Brave/Edge support |
| **0.1.9** | Complete | Full matrix, extreme cross-browser testing, docs → **first public npm release** |
| **0.2.0** | Polished | De-slop pass, sober style enforcement, fixes → release |

The post-0.1.6 mapping supersedes the original wave plan; see
[`revised-roadmap-2026-10-23.md`](./revised-roadmap-2026-10-23.md).

## Definition of done for any release

- `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm verify:release`,
  `pnpm verify:package` green.
- No new runtime dependencies (`ws` + `@modelcontextprotocol/sdk` only).
- Every new tool has a unit test against `MockBiDiServer`.
- Every error path has an `ActionableError` code and fix text.
- README tool table and CHANGELOG updated.
- Local MCP verification against a real Firefox before promote.
- Release only from `main`, tag `vX.Y.Z`.
