# BiDi Browser MCP Server — Complete Build Plan (v2, Post-Critique)

**Name**: `bidi-browser-mcp`  
**Repo root**: `./` (relative — no absolute paths)  
**Reference project**: `../cdp-browser-mcp/MCP Server/` (Tushar49 CDP MCP v5)  
**Research**: `_archive/research/` folder (8 files covering BiDi API, protocols, Foxbridge, MCP servers)

---

## DESIGN DECISIONS (Post-Metis + Post-Momus)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Session model | **Single-session with reuse** | Firefox allows ONLY 1 BiDi session. CDP's multi-session model CANNOT be copied. |
| Snapshot | **script.evaluate + JS DOM traversal** | BiDi has NO Accessibility API. 300-500 LOC needed in dedicated `snapshot/` module. |
| Browser support | **Firefox-native only (v1)** | Chrome BiDi is experimental. Chrome users should use the CDP MCP server. |
| Lite mode | **Single entry point, BIDI_OUTPUT_MODE env var** | NOT a separate file. Same binary, different output strategy. Match CDP's CDP_SLIM_MODE pattern. |
| Output threshold | **60K chars default (like CDP), configurable via BIDI_MAX_INLINE_LEN** | 250 chars is unusable. Progressive truncation: sections → tables → code blocks → file overflow. |
| Tool dispatch | **Action-based (like CDP)** | Single tool with N sub-actions via `action` param. Adds zod param validation per action. |
| Test strategy | **MockBiDiServer in Wave 2, per-tool tests in Wave 5** | Not deferred to Wave 7. Every module tested on creation. |
| Snapshot dir | **src/snapshot/ (4 files)** | dom-snapshot.ts, cache.ts, element-resolver.ts, token-optimizer.ts. Built in Wave 2. |
| Error types | **15+ BiDi-specific errors** | sessionExistsError, contextNotFoundError, actionSequenceError, subscriptionFailedError, etc. |

---

## ARCHITECTURE (MODIFIED from original)

```
src/
├── index.ts                   # Entry point — wire everything, start MCP
├── config.ts                  # Env var config loader (BIDI_* vars)
├── types.ts                   # All shared interfaces — the "contract"
├── connection/
│   ├── bidi-client.ts         # BiDi WebSocket client (EventEmitter)
│   ├── browser-discovery.ts   # Firefox instance detection (port scan + env)
│   ├── health-monitor.ts      # Auto-connect + reconnect with backoff
│   ├── event-pipeline.ts      # session.subscribe → route to state stores
│   └── index.ts
├── session/
│   ├── session-manager.ts     # ONE session only (Firefox constraint)
│   ├── context-manager.ts     # BrowsingContext tree tracking
│   └── index.ts
├── snapshot/                  # NEW — built in Wave 2 (critical module)
│   ├── dom-snapshot.ts        # JS DOM traversal via script.evaluate
│   ├── cache.ts               # Per-tab snapshot caching + incremental diff
│   ├── element-resolver.ts    # Map UIDs → CSS selectors for interaction
│   └── token-optimizer.ts     # Truncation/compression for LLM budgets
├── tools/
│   ├── registry.ts            # Tool registration + dispatch
│   ├── base-tool.ts           # defineTool() factory + COMMON_PARAMS
│   ├── dispatch.ts            # Preprocessing (session, context, modal)
│   ├── output-mode.ts         # NEW — BIDI_OUTPUT_MODE routing (full/file/inline)
│   ├── ping.ts                # Health check
│   ├── browser.ts             # Browser info/connect/profiles
│   ├── tabs.ts                # browsingContext getTree/create/close/activate
│   ├── page.ts                # navigate, reload, screenshot, PDF, viewport, dialogs, history, SNAPSHOT (delegates to snapshot/)
│   ├── script.ts              # evaluate, callFunction, realms, preloadScript
│   ├── interact.ts            # click, type, select, scroll, drag, upload, hover, tap
│   ├── form.ts                # Multi-field smart form filling
│   ├── network.ts             # addIntercept, continueRequest, failRequest, mock, auth
│   ├── storage.ts             # Cookie get/set/delete
│   ├── emulate.ts             # geolocation, locale, orientation ONLY (viewport is in page.ts)
│   ├── console.ts             # Console log capture
│   ├── observe.ts             # Combined console + network observation
│   ├── context.ts             # User contexts (containers/incognito) ✨BiDi-unique
│   ├── extensions.ts          # Install/uninstall web extensions ✨BiDi-unique
│   └── cleanup.ts             # Session/tab/connection cleanup
└── utils/
    ├── error-handler.ts       # ActionableError (15+ BiDi-specific types)
    ├── response-builder.ts    # Progressive truncation (sections→tables→code→file)
    ├── helpers.ts             # ok/fail result builders + randomDelay
    ├── temp-files.ts          # Temp file management with auto-cleanup
    └── wait.ts                # Sleep, waitForNavigation, waitForSelector
```

---

## TOOL SPECIFICATIONS (per Momus BLOCKER 1)

### 1. ping
| Action | BiDi Method | Params | Returns |
|--------|-------------|--------|---------|
| (none) | - | - | `{ status, version, connected, uptime }` |

### 2. browser
| Action | BiDi Method | Required Params | Returns |
|--------|-------------|-----------------|---------|
| `profiles` | browser-discovery scan | - | `BrowserInstance[]` |
| `connect` | browser-discovery reconnect | `instance` (port/name) | `{ connected, wsUrl }` |
| `active` | session.status | - | `{ browser, version, sessionId }` |

### 3. tabs
| Action | BiDi Method | Required Params | Returns |
|--------|-------------|-----------------|---------|
| `list` | `browsingContext.getTree` | - | `ContextInfo[]` (nested tree) |
| `new` | `browsingContext.create` | - | `{ context }` |
| `close` | `browsingContext.close` | `context` | - |
| `activate` | `browsingContext.activate` | `context` | - |
| `info` | `browsingContext.getTree` filtered | `context` | `ContextInfo` |

### 4. page
| Action | BiDi Method | Required | Notes |
|--------|-------------|----------|-------|
| `goto` | `browsingContext.navigate` | `url` | wait: none/interactive/complete |
| `reload` | `browsingContext.reload` | - | |
| `back` | `browsingContext.traverseHistory` | - | delta: -1 |
| `forward` | `browsingContext.traverseHistory` | - | delta: +1 |
| `screenshot` | `browsingContext.captureScreenshot` | - | format: png/jpeg |
| `print` | `browsingContext.print` | - | PDF options |
| `setViewport` | `browsingContext.setViewport` | `viewport` | In BiDi's browsingContext module, NOT emulation |
| `dialog` | `browsingContext.handleUserPrompt` | `accept` | |
| `snapshot` | **script.evaluate + JS DOM traversal** | - | Delegates to snapshot/ module. No a11y tree in BiDi! |
| `content` | `script.evaluate` | - | Returns innerText or innerHTML |

### 5. script
| Action | BiDi Method | Required | Notes |
|--------|-------------|----------|-------|
| `evaluate` | `script.evaluate` | `expression` | target: { context } |
| `call` | `script.callFunction` | `functionDeclaration` | |
| `realms` | `script.getRealms` | - | |
| `addPreload` | `script.addPreloadScript` | `functionDeclaration` | ✨BiDi-unique |
| `removePreload` | `script.removePreloadScript` | `preloadScript` | ✨BiDi-unique |

### 6. interact (BIGGEST BiDi gap vs CDP)
| Action | BiDi Method | Required | Implementation |
|--------|-------------|----------|----------------|
| `click` | script.evaluate → input.performActions (pointer) | `selector` | Find element coords → pointerMove + pointerDown + pointerUp |
| `type` | script.evaluate → input.performActions (key) | `selector`, `text` | Focus element → keyDown+keyUp per character |
| `select` | script.evaluate → dispatch change event | `selector`, `value` | Find option element → set selected + fire events |
| `press` | input.performActions (key) | `key` | Single key press |
| `scroll` | script.evaluate | `selector`, `direction?` | el.scrollIntoView() or window.scrollBy() |
| `drag` | input.performActions (pointer move) | `sourceSelector`, `targetSelector` | Sequence: move to source → down → move to target → up |
| `upload` | `input.setFiles` | `selector`, `files` | file paths |
| `hover` | input.performActions (pointerMove) | `selector` | Just pointerMove, no down/up |
| `tap` | input.performActions (pointer touch) | `selector` | touch pointer type |

### 7. form
| Action | BiDi Method | Required | Notes |
|--------|-------------|----------|-------|
| `fill` | combo of interact actions | `fields[]` | Auto-detect field type, route to click/type/select |

### 8. network
| Action | BiDi Method | Required | Notes |
|--------|-------------|----------|-------|
| `addIntercept` | `network.addIntercept` | `urlPatterns?` | |
| `removeIntercept` | `network.removeIntercept` | `intercept` | |
| `continueRequest` | `network.continueRequest` | `request` | Optional: modify url/method/headers/body |
| `continueResponse` | `network.continueResponse` | `request` | Optional: modify statusCode/headers |
| `failRequest` | `network.failRequest` | `request` | |
| `provideResponse` | `network.provideResponse` | `request`, `body` | Mock response |
| `continueWithAuth` | `network.continueWithAuth` | `request` | Optional: credentials |
| `addDataCollector` | `network.addDataCollector` | `urlPatterns?` | |
| `getData` | `network.getData` | `dataCollectorConfiguration` | |
| `setCache` | `network.setCacheBehavior` | `cacheBehavior` | bypass/cache |

### 9. storage
| Action | BiDi Method | Required | Notes |
|--------|-------------|----------|-------|
| `getCookies` | `storage.getCookies` | - | |
| `setCookie` | `storage.setCookie` | `cookie` (object) | |
| `deleteCookies` | `storage.deleteCookies` | - | Optional: filter |

### 10. emulate
| Action | BiDi Method | Required | Notes |
|--------|-------------|----------|-------|
| `setGeolocation` | `emulation.setGeolocationOverride` | `geolocation` | |
| `setLocale` | `emulation.setLocaleOverride` | `locale` | |
| `setOrientation` | `emulation.setScreenOrientationOverride` | `orientation` | |
| ⚠️ viewport is NOT here — it's in page.ts via `browsingContext.setViewport` |

### 11. console
| Action | Event | Implementation |
|--------|-------|----------------|
| `getLogs` | `log.entryAdded` | Return buffered console entries with level/timestamps |
| `clearLogs` | - | Clear the buffer |

### 12. observe
| Action | Delegates to | Notes |
|--------|-------------|-------|
| `console` | console.getLogs | |
| `network` | network request tracker | |
| `request` | network request buffer | Get full request/response |
| `clear` | console + network clear | |

### 13. context — ✨ BiDi-Unique
| Action | BiDi Method | Notes |
|--------|-------------|-------|
| `create` | `browser.createUserContext` | Isolated container (incognito) |
| `list` | `browser.getUserContexts` | |
| `remove` | `browser.removeUserContext` | |
| `setWindowState` | `browser.setClientWindowState` | minimize/maximize/fullscreen |
| `getWindows` | `browser.getClientWindows` | |

### 14. extensions — ✨ BiDi-Unique
| Action | BiDi Method | Notes |
|--------|-------------|-------|
| `install` | `webExtension.install` | |
| `uninstall` | `webExtension.uninstall` | |

### 15. cleanup
| Action | Description |
|--------|-------------|
| `session` | End agent session |
| `listSessions` | List all active sessions |
| `disconnectAll` | Disconnect all tabs |
| `disconnectTab` | Disconnect specific tab |
| `cleanTemp` | Delete temp files |
| `status` | Server status |
| `reset` | Reset all state |

---

## OUTPUT MODE STRATEGY

`BIDI_OUTPUT_MODE` env var (single binary, no separate lite.ts):

| Mode | Behavior | Use case |
|------|----------|----------|
| `full` (default) | Progressive truncation at 60K chars → file overflow. Full tool descriptions. | Full-context models |
| `inline` | Never use files. Hard truncate at 60K. | No filesystem access |
| `file` | Aggressive file redirect. Any response >5K chars → temp file. Strip verbose tool descriptions from ListTools. | Low-context models |

`BIDI_MAX_INLINE_LEN` env var overrides the 60K/5K defaults.

File output format: `{ content: [{ type: "resource", resource: { uri: "file:///path/to/output.txt", mimeType: "text/plain" } }] }`

---

## EXECUTION WAVES (with Definition of Done)

### WAVE 1: Project Scaffold
**Done when**: `tsc --noEmit` passes · `npm run build` produces `dist/` · `npm test` runs (0 tests)

Files: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/config.ts`, `src/types.ts`

**Depends on**: Nothing

### WAVE 2: Core Connection + Test Infrastructure (split into 3 parallel groups)

**Group A** (bidi-client + browser-discovery):
- `src/connection/bidi-client.ts` — EventEmitter-based WS client. Methods: connect(), send(), on('event'), close()
- `src/connection/browser-discovery.ts` — Scan ports 9222-9226, check /json/version, env var fallback
- **Done when**: bidi-client connects to real Firefox · browser-discovery finds Firefox on port 9222 · MockBiDiServer accepts WS connections

**Group B** (registry + utils + ping):
- `src/tools/registry.ts` + `src/tools/base-tool.ts` — Tool registration, defineTool(), COMMON_PARAMS
- `src/utils/error-handler.ts` + `src/utils/response-builder.ts` + `src/utils/helpers.ts` + `src/utils/temp-files.ts` + `src/utils/wait.ts`
- `src/tools/ping.ts` — Health check tool
- **Done when**: Tools register and dispatch correctly · ping tool responds to MCP CallTool

**Group C** (MockBiDiServer):
- `src/__tests__/mocks/bidi-server.ts` — Lightweight WS server. Handles session.new, browsingContext.getTree, script.evaluate. Returns fixture data.
- **Done when**: bidi-client unit tests pass against MockBiDiServer

### WAVE 3: Session + Health
- `src/session/session-manager.ts` — Single-session with reuse. Methods: create(), end(), subscribe(), status()
- `src/connection/health-monitor.ts` — Auto-connect, reconnect with exponential backoff
- **Done when**: session-manager reuses existing session · health-monitor reconnects after WS drop · second session.new returns existing session (doesn't error)

### WAVE 4: Events + Contexts + Dispatch
- `src/connection/event-pipeline.ts` — session.subscribe, event routing to state stores
- `src/session/context-manager.ts` — browsingContext tracking, tree traversal
- `src/tools/dispatch.ts` — Preprocessing: session resolution, context claiming, modal checks
- **Done when**: Event pipeline routes browsingContext.contextCreated → context-manager · context-manager tracks all contexts · dispatch injects _agentSessionId

### WAVE 5a: Pilot Tools (validate pattern before scaling)
- `src/tools/browser.ts` — 3 actions
- `src/tools/tabs.ts` — 5 actions
- `src/tools/page.ts` — 10+ actions (includes viewport, snapshot delegating to snapshot/)
- **Done when**: All 3 tools register · Each action calls correct BiDi method against MockBiDiServer · Snapshot returns structured DOM tree from JS traversal

### WAVE 5b: Remaining 11 Tools (PARALLEL)
All remaining tool files parallel: script.ts, interact.ts, form.ts, network.ts, storage.ts, emulate.ts, console.ts, observe.ts, context.ts, extensions.ts, cleanup.ts

**Done when**: All 14 tools registered · Each action handler works · Unit tests pass per tool

### WAVE 6: Entry Point + Output Mode
- `src/tools/output-mode.ts` — BIDI_OUTPUT_MODE routing
- `src/index.ts` — Wire ALL modules, start MCP server, ListTools + CallToolRequest handlers
- **Done when**: Server starts · All tools listed in ListTools · Auto-connect on first call · Output mode respects env var

### WAVE 7: Docs + Release
- `README.md` — Full docs: quick start, config reference, tool reference, architecture diagram
- `CHANGELOG.md` — v1.0.0 initial release
- `.gitignore`, git init, initial commit
- Verify `npm pack` produces correct tarball
- `docs/dual-mode-design.md` — Plan for v2 CDP fallback
- **Done when**: README covers all sections · `npm pack` works · git commit with clean history

---

## DEFINITION OF DONE (per wave — gates)

| Wave | Gate 1 (Build) | Gate 2 (Typecheck) | Gate 3 (Test) | Gate 4 (Integration) |
|------|----------------|-------------------|----------------|----------------------|
| 1 | `npm run build` | `tsc --noEmit` | `npm test` runs | - |
| 2 | All source files exist | No TS errors | bidi-client test connects to MockBiDiServer | Can connect to real Firefox |
| 3 | session + health files done | No TS errors | Unit tests for session lifecycle | Tests pass with MockBiDiServer |
| 4 | events + context + dispatch done | No TS errors | Unit tests for event routing | context-manager tracks MockBiDiServer contexts |
| 5a | 3 pilot tools done | No TS errors | Per-tool unit tests pass | Each action returns correct response shape |
| 5b | All 14 tools done | No TS errors | All tool tests pass | (Deferred to Wave 7 integration) |
| 6 | index.ts wired | No TS errors | Server startup test | - |
| 7 | Docs + git | - | `npm test` full suite | Integration tests against real Firefox |

---

## TEST STRATEGY

**MockBiDiServer** (`src/__tests__/mocks/bidi-server.ts`): Lightweight WebSocket server that:
- Handles `session.new` → returns sessionId
- Handles `browsingContext.getTree` → returns fixture context tree
- Handles `script.evaluate` → returns fixture result
- Handles `browsingContext.navigate` → returns navigation ID
- Any unknown method → returns `{ error: { message: "unknown method" } }`

**Unit tests**: Every module has vitest tests using MockBiDiServer. Run on every `npm test`.

**Integration tests**: Opt-in via `FIREFOX_BIDI_WS_URL` env var. Run via `vitest --config vitest.integration.config.ts`. Tests actual Firefox interaction.

**CI**: GitHub Actions — unit tests on push, integration tests on schedule.

---

## PACKAGE.JSON

```json
{
  "name": "bidi-browser-mcp",
  "version": "1.0.0",
  "description": "WebDriver BiDI Browser MCP Server — control Firefox via the W3C standard protocol",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": {
    "bidi-browser-mcp": "./dist/index.js"
  },
  "files": ["dist/", "README.md", "LICENSE"],
  "engines": { "node": ">=18" },
  "publishConfig": { "access": "public" },
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/<user>/bidi-browser-mcp.git"
  },
  "keywords": ["mcp", "bidi", "webdriver", "browser-automation", "firefox", "model-context-protocol"],
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "lint": "tsc --noEmit",
    "typecheck": "tsc --noEmit",
    "clean": "node -e \"require('fs').rmSync('dist',{recursive:true,force:true})\"",
    "prepublishOnly": "npm run build",
    "prepack": "npm run build"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "ws": "^8.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/ws": "^8.0.0",
    "typescript": "^5.0.0",
    "vitest": "^2.0.0"
  }
}
```

---

## ENV VAR REFERENCE

| Variable | Default | Description |
|----------|---------|-------------|
| `BIDI_HOST` | `127.0.0.1` | BiDi WebSocket host |
| `BIDI_PORT` | `9222` | BiDi WebSocket port |
| `BIDI_WS_URL` | auto | Override full WebSocket URL |
| `BIDI_TIMEOUT` | `30000` | Command timeout (ms) |
| `BIDI_SESSION_TTL` | `300000` | Session TTL (ms, 5 min) |
| `BIDI_OUTPUT_MODE` | `full` | `full`, `inline`, or `file` |
| `BIDI_MAX_INLINE_LEN` | `60000` | Max inline response chars |
| `BIDI_CLEANUP_STRATEGY` | `detach` | `close`, `detach`, or `none` |
| `BIDI_TEMP_DIR` | `.temp` | Temp file directory |
| `BIDI_BROWSER` | `firefox` | Browser type (v1: firefox only) |
| `BIDI_BROWSER_PATH` | auto-detect | Path to Firefox binary |

---

## BLOCKERS ADDRESSED

| Blocker | From | Resolution in v2 Plan |
|---------|------|----------------------|
| Wave 5 zero specification per tool | Momus | Full tool specification table with actions, BiDi methods, params |
| Snapshot module has no home | Momus + Metis | Added `src/snapshot/` with 4 files, built in Wave 2 |
| No acceptance criteria per wave | Momus | Definition of Done table per wave with gates |
| Lite mode contradiction | Momus | Resolved: single entry point, BIDI_OUTPUT_MODE env var |
| Emulation includes viewport incorrectly | Momus | Fixed: viewport in page.ts, emulate.ts has only 3 commands |
| Tests deferred to Wave 7 | Momus + Metis | Per-wave test gates, MockBiDiServer in Wave 2 |
| Single-session model unclear | Metis | session-manager explicitly single-session with reuse |
| Snapshot without a11y API | Metis | dom-snapshot.ts uses script.evaluate + JS DOM traversal |
