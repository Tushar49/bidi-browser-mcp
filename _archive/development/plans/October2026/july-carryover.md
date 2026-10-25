# July 2026 Plan — What Carries Into October

**Status:** assessment (2026-10-21). Source:
[`../July2026/bidi-mcp-server-plan.md`](../July2026/bidi-mcp-server-plan.md).

The July plan got the big shape right: single session, DOM snapshot, action-based
tools, output modes, MockBiDiServer, per-tool tests. October keeps that spine and
corrects the parts that aged or were wrong.

## 1. Keep (still valid)

| July item | Why it survives | October location |
|---|---|---|
| Single-session reuse | Firefox still allows one session | `implementation-plan.md` §5; `05-architecture-and-snapshot.md` §3 |
| `src/snapshot/` four-file split | Right separation of traversal/cache/resolver/optimizer | Same tree |
| Action-based tools | Correct for token budget and agent UX | 16-tool surface |
| `BIDI_OUTPUT_MODE` full/inline/file | Still the right output strategy | Config + release plan |
| 60K default inline budget | Still a sane default | Snapshot/output budgets |
| `ActionableError` taxonomy | Still the main UX differentiator | `utils/errors.ts` |
| MockBiDiServer + per-tool tests | Still the correct hermetic strategy | Test strategy |
| Viewport in `page`, not `emulate` | BiDi puts `setViewport` in `browsingContext` | Tool surface |
| `interact` as the biggest gap | Still true | Interaction wave |
| Progressive truncation to file | Still needed | `output.ts` / response builder |

## 2. Change (right idea, new facts)

| July item | October correction |
|---|---|
| Browser discovery: port scan + `/json/version` | Read `<profile>/WebDriverBiDiServer.json`; port scan only fallback |
| "Second `session.new` returns existing session" | Impossible. Second client gets `BIDI_SESSION_BUSY`; no takeover |
| `emulate` has only geolocation/locale/orientation | Firefox 158 adds timezone, UA, screen settings, offline network; media in 159+ |
| `network` list was mostly right | Add `setExtraHeaders`, `disownData`, data collectors; header values are `BytesValue` |
| `extensions` install/uninstall | Add `webExtension.moz:listExtensions`; gate install paths |
| No debugger/profiler | `moz:debugging` (153+) and `moz:profiler` (154+) are real |
| No screencast | `browsingContext.startScreencast` (154+) |
| `interact` clicked by CSS coordinates | UID/sharedId + actionability + `elementFromPoint` + scroll/stability checks |
| `context` included window actions | Windows moved to `browser`; `context` is user contexts only |
| 15 tools / ~90 actions | 16 tools / ~110 actions, gated toolsets |
| `cleanup` had `listSessions`/`disconnectAll`/`disconnectTab` | Multi-session leftovers; drop. Single session, `disconnect`, `reset`, `temp` |
| `browser` action `active` | `status`/`version`/`windows`/`windowState` |
| `BIDI_BROWSER`/`BIDI_BROWSER_PATH` | v1 is attach-only; keep browser path only for discovery/diagnostics |
| `engines >=18` | `>=20.19` (current package) |
| `bin: dist/index.js` | `bin: dist/bin.js` (CLI/API split already implemented) |
| `files` included README/LICENSE | `files: ["dist", "!dist/**/*.map"]`; npm auto-adds metadata |
| Integration tests on a CI schedule | Integration needs a real Firefox; never in CI |
| `FIREFOX_BIDI_WS_URL` | `BIDI_WS_URL` (current `BIDI_*` prefix) |

## 3. Drop

| July item | Reason |
|---|---|
| `listSessions`, `disconnectAll`, `disconnectTab` | Contradicts one-session model |
| `/json/version` discovery | Firefox does not expose the CDP HTTP contract |
| "Second session returns existing session" | Protocol does not allow it |
| Port scan as primary discovery | Stale/wrong instance risk; profile file is authoritative |
| 15-tool count as a hard target | 16 tools after splitting `devtools`/`cleanup`; count is not the goal |
| Chrome/CDP fallback in v1 | Separate product; cross-browser is a later backend |
| `BIDI_BROWSER_PATH` as a launch feature | No browser launch in v1 |

## 4. Reusable code ideas from July

- `defineTool()` + `COMMON_PARAMS` + dispatch preprocessing.
- `ActionableError` with code/fix/details.
- Progressive truncation: sections → tables → code → file.
- `MockBiDiServer` with `session.new`, `getTree`, `script.evaluate`, `navigate`.
- Snapshot cache + incremental diff.
- UID → selector resolver (extend to `sharedId`).
- Per-wave test gates.

## 5. What July did not anticipate

- Firefox's two-week release cadence and the 158 surface.
- `moz:debugging`, `moz:profiler`, `permissions`, screencast.
- `navigator.webdriver=true` with the Remote Agent.
- MCP `2026-07-28` (`outputSchema`, `structuredContent`, annotations).
- Mozilla's own DevTools MCP as the closest competitor.
- Playwright's stock-Firefox BiDi channel and its remaining gaps.
- The need for a shared broker if multiple MCP clients attach to one Firefox.

## 6. Net result

October is an evolution, not a rewrite. The July architecture survives; the
protocol facts, discovery, session-conflict behavior, tool surface, and release
sequence change.
