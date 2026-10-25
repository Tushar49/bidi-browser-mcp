# Implementation Plan — BiDi Browser MCP

**Status:** active (2026-10-21). **Repo:** `Tushar49/bidi-browser-mcp` ·
package `bidi-browser-mcp` 0.1.3 · branch model `dev → main` promote. This plan
lives on `dev` only. Wave 0 (carcass) is implemented; Wave 1 is next.

**Research:** `_archive/research/October2026/` — start with
`01-firefox-bidi-2026.md`, `05-architecture-and-snapshot.md`,
`04-mcp-tool-surface.md`.

## 1. Goal

Make the server the best way for an AI agent to use **the user's real Firefox**:

- attach to an already-running Firefox over native WebDriver BiDi;
- preserve profile, cookies, logins, containers, and extensions;
- no geckodriver/Selenium/Marionette, no bundled browser, no profile migration;
- a compact MCP surface that is reliable on modern web apps;
- Firefox-specific capabilities (containers, debugger, profiler, extensions)
  when the user opts in.

## 2. Non-goals

- Chromium/CDP support.
- Firefox launch/bundling/profile creation.
- Cross-browser parity with Playwright.
- Test runner, trace viewer, video platform.
- Stealth/anti-detection.
- Full Chrome DevTools parity (CSS, heap, network throttling).
- Chrome/Edge/Brave/Safari backends in v1. Firefox is native and driver-free;
  Chromium needs ChromeDriver, Safari is experimental. See
  [`../../../research/October2026/06-cross-browser-bidi.md`](../../../research/October2026/06-cross-browser-bidi.md).
- MCP Apps UI or Tasks-based background jobs in v1.

## 3. Product principles

1. **Attach, never own.** The server never starts, kills, or resets Firefox
   without an explicit action.
2. **One session per server process.** Firefox allows one BiDi session; reuse
   it, never retry `session.new`. Multiple MCP processes need the future broker.
3. **Explain failures.** Every error says what happened, why, and what to do.
4. **Snapshot first.** Agents should act on UIDs, not guess selectors.
5. **Real input.** Prefer pointer/key events; DOM fallbacks are explicit.
6. **Token discipline.** Interactive snapshots by default; large payloads to
   files.
7. **Feature-detect.** Firefox changes every two weeks; degrade gracefully.
8. **No stealth.** `navigator.webdriver` is true; say so.

## 4. Architecture

```text
src/
├── bin.ts / index.ts
├── config.ts / types.ts
├── connection/
│   ├── bidi-client.ts
│   ├── browser-discovery.ts
│   ├── health-monitor.ts
│   └── event-pipeline.ts
├── session/
│   ├── session-manager.ts
│   └── context-manager.ts
├── snapshot/
│   ├── dom-snapshot.ts
│   ├── cache.ts
│   ├── element-resolver.ts
│   └── token-optimizer.ts
├── tools/
│   ├── registry.ts / base-tool.ts / dispatch.ts / output.ts
│   ├── ping.ts / browser.ts / tabs.ts / page.ts / script.ts
│   ├── interact.ts / form.ts / network.ts / storage.ts
│   ├── emulate.ts / console.ts / observe.ts / context.ts
│   └── extensions.ts / devtools.ts / cleanup.ts
└── utils/
    ├── errors.ts / wait.ts / temp-files.ts / response-builder.ts
```

No global mutable state. Everything flows through a `ServerContext` assembled in
`index.ts` and passed to tools.

## 5. Key technical decisions

| Area | Decision | Reason |
|---|---|---|
| Transport | `ws` WebSocket to `ws://host:port/session` | Native BiDi; no driver |
| Discovery | `BIDI_WS_URL` → profile file → profiles.ini → process command line → port fallback | Firefox has no `/json/version` and no in-browser toggle |
| Session | Single, reused, exclusive | Firefox hard limit |
| Session conflict | `BIDI_SESSION_BUSY` + fix; no takeover | No protocol command to hijack |
| Browser launch | Out of scope | Attach-only identity |
| Snapshot | Injected DOM traversal + `sharedId` refs | No AX tree |
| UID scope | Per snapshot generation; invalidate on navigation | `sharedId` lifetime |
| Actionability | Visible + stable + enabled + hit-test + scroll | Fewer failed clicks |
| Typing | Key events for short text; native setter + events for long | Framework compatibility |
| Tool shape | 16 action-based tools | Token-efficient, coherent |
| Toolsets | `core` / `network` / `devtools` / `all` | Safety + context budget |
| Output | `structuredContent` + text + file overflow | MCP 2026-07-28 |
| Errors | `ActionableError` codes + fix | Agent self-correction |
| Tests | MockBiDiServer + recorded fixtures; real Firefox opt-in | CI has no browser |
| Dependencies | `ws` + `@modelcontextprotocol/sdk` only | Project rule |

## 6. Tool surface

Detailed actions in `../../research/October2026/04-mcp-tool-surface.md`.

| Tool | Core actions | Toolset |
|---|---|---|
| `ping` | status | core |
| `browser` | status, connect, profiles, version, windows, windowState, permission, downloadBehavior, close* | core |
| `tabs` | list, new, close, activate, info, select | core |
| `page` | goto, reload, back, forward, screenshot, print, viewport, dialog, snapshot, content, screencast* | core |
| `script` | evaluate, call, realms, preloadAdd, preloadRemove | core |
| `interact` | click, dblclick, type, press, hover, scroll, drag, upload, tap, select, focus, check, uncheck, setValue, waitFor | core |
| `form` | inspect, fill, validate | core |
| `network` | interceptAdd/Remove, continue, continueResponse, fail, mock, auth, cache, headers, collectAdd/Remove, list, detail | network |
| `storage` | cookiesGet/Set/Delete, storageGet/Set/Clear | network |
| `emulate` | geolocation, locale, timezone, userAgent, orientation, screen, offline, media, reset | network |
| `console` | logs, clear | core |
| `observe` | console, network, request, downloads, clear | core |
| `context` | create, list, remove, info | network |
| `extensions` | install*, uninstall*, list | devtools |
| `devtools` | debugEnable, scripts, source, breakpointSet/Remove, resume, stepOver/Into/Out, debugState, profilerStatus/Start/Stop | devtools |
| `cleanup` | status, disconnect, reset, temp | core |

`*` gated by an explicit opt-in.

## 7. Execution waves

### Wave 0 — Decisions and contracts (S) — DONE in v0.1.3

**Files:** `src/config.ts`, `src/types.ts`, `src/utils/errors.ts`,
`src/tools/base-tool.ts`, `src/tools/registry.ts`, `src/__tests__/mocks/bidi-server.ts`.

**Done when:**

- Config surface documented (`BIDI_WS_URL`, `BIDI_PROFILE_DIR`, `BIDI_TOOLSET`,
  `BIDI_TIMEOUT`, `BIDI_OUTPUT_MODE`, `BIDI_MAX_INLINE_LEN`, advanced opt-ins).
- `ActionableError` codes compile.
- `defineTool()` supports `action`, annotations, input/output schema.
- MockBiDiServer accepts a connection and routes a command.

### Wave 1 — Connection, discovery, session (M) — v0.1.4 core done

**Files:** `connection/bidi-client.ts`, `connection/browser-discovery.ts`,
`connection/health-monitor.ts`, `session/session-manager.ts`, `tools/ping.ts`,
`tools/browser.ts` (status/connect/profiles/version).

**Status:** v0.1.4 ships discovery, BiDi client, session manager, `ping`, and
`browser`. `health-monitor.ts` is still planned.

**Done when:**

- Finds a real Firefox from a profile file, from `BIDI_WS_URL`, and from a
  running process command line.
- Opens one WebSocket, calls `session.new` once, reuses the session.
- `session.status` and capabilities surface browser version/profile/process.
- Conflict returns `BIDI_SESSION_BUSY` with a fix.
- WebSocket drop marks disconnected and reconnects on the next call.
- No browser close on disconnect.
- Unit tests with MockBiDiServer.

### Wave 2 — Events and contexts (M)

**Files:** `connection/event-pipeline.ts`, `session/context-manager.ts`,
`tools/tabs.ts`, `tools/console.ts`, `tools/observe.ts`,
`tools/cleanup.ts`.

**Done when:**

- Subscribe once to browsingContext/log/network/userPrompt/download events.
- Bounded buffers; drop-oldest warnings.
- Tab tree updates on context created/destroyed/navigation.
- Active tab heuristic; `tabs.list/new/close/activate/info/select`.
- Console logs filter/clear.
- `cleanup.disconnect` ends session without closing Firefox.
- Tests for event routing and context cleanup.

### Wave 3 — Snapshot and UID resolver (L)

**Files:** `snapshot/dom-snapshot.ts`, `snapshot/cache.ts`,
`snapshot/element-resolver.ts`, `snapshot/token-optimizer.ts`,
`tools/page.ts` (snapshot/content).

**Done when:**

- Interactive snapshot with role/name/bounds/states/UIDs.
- Shadow DOM and same-origin iframe traversal.
- `sharedId` map for interactive/form nodes; CSS fallback.
- Invalidate on navigation/context close/reconnect.
- 60K default budget, truncation metadata.
- Text mode; diff mode optional.
- Tests on fixture DOMs and a real page.

### Wave 4 — Core browsing tools (M)

**Files:** `tools/page.ts` (goto/reload/back/forward/screenshot/print/viewport/
dialog), `tools/script.ts`, `tools/browser.ts` (windows/windowState/permission/
downloadBehavior).

**Done when:**

- Navigate with wait modes; history; viewport.
- Screenshot/PDF to file with resource link + preview.
- Dialog accept/dismiss; `DIALOG_OPEN` guard.
- `script.evaluate/call/realms/preload`.
- Browser windows and permissions.
- Unit tests for every action.

### Wave 5 — Interaction and forms (L)

**Files:** `tools/interact.ts`, `tools/form.ts`,
`snapshot/element-resolver.ts` extensions, `utils/wait.ts`.

**Done when:**

- Click/type/press/hover/scroll/select/upload/check/tap/drag.
- Actionability checks with actionable failures.
- Framework-compatible typing (React/Vue).
- `waitFor` supports attached/visible/stable/network-idle.
- Form inspect/fill/validate.
- Integration tests on a local React-ish fixture page and shadow DOM.

### Wave 6 — Network, storage, contexts, emulation (L)

**Files:** `tools/network.ts`, `tools/storage.ts`, `tools/context.ts`,
`tools/emulate.ts`, `tools/observe.ts` (downloads).

**Done when:**

- Request list/detail, intercept/mock/fail/continue/auth.
- Header `BytesValue` serialization tested.
- Response body collection with size cap and `disownData`.
- Cookie CRUD; localStorage/sessionStorage; scoped clear.
- User context create/list/remove; isolation verified.
- Geo/locale/timezone/UA/orientation/screen/offline; permissions.
- Downloads tracked.
- Sensitive headers redacted by default.

### Wave 7 — DevTools and extensions (L)

**Files:** `tools/devtools.ts`, `tools/extensions.ts`,
`tools/page.ts` screencast.

**Done when:**

- Debugger enable, scripts/source, breakpoint set/remove, resume/step.
- Pause/resume state surfaced; no stuck paused session after cancel.
- Profiler start/stop/status; profile path returned; discard option.
- Screencast start/stop with bounded duration and cleanup.
- Extension install/uninstall/list with path allowlist + opt-in.
- Feature detection for Firefox 153/158 differences.

### Wave 8 — Hardening and release (M)

**Files:** README, CHANGELOG, docs, tests, scripts, `server.json` version.

**Done when:**

- Full unit suite; opt-in integration suite.
- Benchmarks recorded.
- Version matrix: FF153 ESR and FF158 stable.
- README tool reference and security notes.
- `verify:release`, `verify:package` green.
- Local MCP verification against real Firefox.
- Promote to `main`, tag, publish.

## 8. Test strategy

### Unit

- MockBiDiServer, no browser.
- Every tool action has a request/response test.
- Error mapping tests.
- Snapshot fixture tests (plain DOM, shadow DOM, iframe, forms).
- Actionability tests with fake DOM.

### Integration

- Opt-in via `BIDI_WS_URL` or `BIDI_PROFILE_DIR`.
- Real Firefox 158, dedicated profile.
- Fixture pages served from a local HTTP server (no external sites).
- Cases: discovery, session conflict, navigate/snapshot/click/type, shadow DOM,
  same-origin iframe, user context isolation, network mock, screenshot/PDF,
  dialog, debugger enable/disable, profiler discard.
- Never in CI.

### CI

- `pnpm typecheck`, `pnpm build`, `pnpm test`.
- `verify:release`, `verify:package`.
- Node 22/24.
- No Firefox download in CI.

## 9. Version and feature matrix

| Feature | Minimum Firefox | Fallback |
|---|---|---|
| Core BiDi, snapshot, basic input | 129 | — |
| `moz:debugging` | 153 | `UNSUPPORTED_FEATURE` |
| `moz:profiler`, screencast | 154 | `UNSUPPORTED_FEATURE` |
| Camera/mic permissions, `imageSize`, `destinationFolder` | 158 | omit/ignore |
| Media features emulation | 159+ | `UNSUPPORTED_FEATURE` |
| `setBypassCSP` | not in 158 | `UNSUPPORTED_FEATURE` |

Detect at runtime; cache capabilities per session. Do not hard-fail the server
for optional features.

## 10. Security model

- Loopback only by default; `BIDI_ALLOW_REMOTE=1` for non-loopback.
- No browser launch/kill.
- `browser.close` gated by `BIDI_ALLOW_BROWSER_CLOSE=1`.
- Extension install gated by `BIDI_ALLOW_EXTENSION_INSTALL=1` + path under
  `BIDI_EXTENSION_ROOT`.
- Redact `Authorization`, `Cookie`, `Set-Cookie` by default.
- Keep profiler output on disk; no inline secrets.
- Treat page content and tool annotations as untrusted.
- Document `navigator.webdriver=true` and bot-detection risk.

## 11. Open questions

1. Should `core` include `form`/`observe`, or start with 8 tools?
2. Should `network`, `storage`, and `context` be one `network` toolset or
   separate flags?
3. Do we expose `browser.close` at all in v1?
4. Is screencast worth the file/cancel complexity in v0.5, or defer to v1?
5. Do we need a `snapshot` tool separate from `page.snapshot` for discoverability?
6. Should debugger actions live in `devtools` or a separate `debug` tool?
7. What is the minimum Firefox we test in CI matrix? 153 ESR + 158 stable?
8. Do we publish a `server.json` update only at 1.0, or every release?
9. How much of the CDP smart-form logic do we port, and when?
10. Do we use `outputSchema` strictly for every action or only stable tools?

## 12. Acceptance for 1.0

- Attach to a real Firefox profile with cookies/logins.
- Snapshot and interact reliably on a modern React app, shadow DOM, and a
  same-origin iframe.
- Network mock/modify/block works.
- Containers isolate storage and are usable.
- Debugger and profiler work when opted in.
- No browser launch, no driver, no extra runtime dependency.
- Clear errors for every common failure.
- Docs, tests, package, registry, and release pipeline green.
