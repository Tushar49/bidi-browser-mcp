# Release Plan — v0.2.0 "Connect + See"

**Status:** planned (2026-10-21). **Source:** `implementation-plan.md` waves 0–4
minus interaction. **Version:** 0.1.3 → **0.2.0**. **Branch:** build on `dev`,
release from `main`.

Internal split:

- **v0.1.4 "Connect"** — discovery, WebSocket client, single session, `browser`
  status/connect/disconnect/profiles/version, `ping` reads real state.
- **v0.1.5 "Contexts"** — events, tabs/context, console, observe v1, buffers.
- **v0.1.6 "Snapshot"** — script, page, DOM snapshot, screenshot/PDF.
- **v0.2.0** — combines the three above and publishes to npm.

## Theme

Make the server genuinely useful on a real Firefox session:

- find the right Firefox;
- open one BiDi session and reuse it;
- list/select tabs;
- navigate, screenshot, PDF, viewport, dialogs;
- evaluate JavaScript;
- capture console logs;
- return a structured DOM snapshot with UIDs;
- explain every failure.

No clicking/typing yet. Interaction ships in 0.3.0.

## In scope

### 1. Config and contracts (S)

- `src/config.ts`: `BIDI_WS_URL`, `BIDI_PROFILE_DIR`, `BIDI_HOST`, `BIDI_PORT`,
  `BIDI_TIMEOUT`, `BIDI_TOOLSET`, `BIDI_OUTPUT_MODE`,
  `BIDI_MAX_INLINE_LEN`, `BIDI_TEMP_DIR`, `BIDI_ALLOW_REMOTE`.
- `src/types.ts`: session, context, snapshot, tool result, error contracts.
- `src/utils/errors.ts`: `ActionableError` + codes.
- `src/tools/base-tool.ts`, `registry.ts`, `dispatch.ts`.
- `src/tools/output.ts`: structured + text + file overflow.

**Acceptance:** config is read only in `config.ts`; no `process.env` elsewhere;
invalid config fails at startup with a fix.

### 2. Discovery (M)

- `BIDI_WS_URL` validation/normalization.
- `BIDI_PROFILE_DIR/WebDriverBiDiServer.json`.
- Known profile roots + `profiles.ini`.
- Running process command lines with `--remote-debugging-port`.
- Port fallback for diagnostics.
- Stale file/port detection.

**Acceptance:** finds a Firefox started with `--remote-debugging-port=0` from
the profile file; finds it via `BIDI_WS_URL` or from a running process command
line; returns `BIDI_NOT_FOUND`/`BIDI_PORT_CLOSED` with the exact start command.

### 3. WebSocket client and session (M)

- Request ID map, timeout, error mapping, event emitter.
- `session.status`, `session.new`, `session.end`.
- One session; idempotent connect; reconnect on next call.
- Capabilities: browser version, profile, process, headless.
- `BIDI_SESSION_BUSY` conflict diagnostics.

**Acceptance:** one session; second `session.new` produces an actionable error;
WebSocket drop is recovered on the next tool call; disconnect never closes
Firefox.

### 4. Events and contexts (M)

- Subscribe to browsingContext/log/network/userPrompt/download events.
- Bounded ring buffers.
- Tab tree + active tab.
- Context invalidation on navigation/close.

**Acceptance:** `tabs.list` reflects new/closed/navigated tabs; console buffer
fills; dialog event sets `DIALOG_OPEN`; buffers cap and warn.

### 5. Snapshot v1 (L)

- Interactive and text modes.
- Role/name approximation, bounds, states, UIDs.
- Open shadow DOM and same-origin iframes.
- `sharedId` for interactive/form nodes; CSS fallback.
- 60K default budget; truncation metadata.
- Snapshot cache per context; invalidate on navigation/actions.

**Acceptance:** a fixture page returns a useful interactive tree; UIDs resolve
back to nodes; navigation invalidates them; budget is enforced.

### 6. Tools: `ping`, `browser`, `tabs`, `page`, `script`, `console`, `observe`, `cleanup` (L)

Actions in scope:

- `ping.status`
- `browser.status/connect/profiles/version/windows/windowState/permission/downloadBehavior`
- `tabs.list/new/close/activate/info/select`
- `page.goto/reload/back/forward/screenshot/print/viewport/dialog/snapshot/content`
- `script.evaluate/call/realms/preloadAdd/preloadRemove`
- `console.logs/clear`
- `observe.console/network/request/downloads/clear`
- `cleanup.status/disconnect/reset/temp`

**Acceptance:** every action has a unit test against MockBiDiServer; every
action returns `{ok, action, data}`; failures are `isError` with a code.

## Out of scope

- click/type/drag/upload/select/check/hover/tap
- form fill
- network interception/mock
- storage/cookies
- user contexts/containers
- emulation/permissions
- debugger/profiler/screencast
- extension install
- cross-origin iframe snapshots

## Files expected

```text
src/config.ts
src/types.ts
src/utils/{errors,wait,temp-files,response-builder}.ts
src/connection/{bidi-client,browser-discovery,health-monitor,event-pipeline}.ts
src/session/{session-manager,context-manager}.ts
src/snapshot/{dom-snapshot,cache,element-resolver,token-optimizer}.ts
src/tools/{registry,base-tool,dispatch,output,ping,browser,tabs,page,script,console,observe,cleanup}.ts
src/__tests__/mocks/bidi-server.ts
src/__tests__/... (unit tests + fixture DOMs)
```

## Test gates

| Gate | Requirement |
|---|---|
| Typecheck | `pnpm typecheck` zero errors |
| Build | `pnpm build` produces `dist/bin.js` with shebang |
| Unit | `pnpm test` green; no real browser |
| Discovery | Finds profile-file and env instances |
| Session conflict | Test asserts `BIDI_SESSION_BUSY` and fix text |
| Snapshot | Fixture tests for plain DOM, shadow DOM, same-origin iframe |
| Output | >60K response goes to file with resource link + preview |
| Integration | Manual/local against Firefox 158: navigate, snapshot, screenshot, PDF, console, script |

## Docs

- README: status no longer "no tools"; list the 0.2.0 tools, discovery, session
  conflict, `navigator.webdriver` fact, output modes.
- CHANGELOG: 0.2.0 entry.
- AGENTS: update status/wave progress if needed.
- Research/plan links stay dev-only; README points at the concept, not paths.

## Release steps

1. Finish waves 0–4 on `dev`; `pnpm typecheck`, `build`, `test`.
2. Manual MCP verification against Firefox 158 with `dist/bin.js`.
3. Bump `package.json` and `server.json` to `0.2.0` together.
4. Update CHANGELOG; commit `feat: ship v0.2.0 connect and snapshot`.
5. Promote `dev → main` via workflow; verify dev-only paths stripped.
6. On `main`: `pnpm verify:release v0.2.0`, `pnpm verify:package`.
7. Tag `v0.2.0`; push tag; release workflow publishes npm + GitHub release.
8. Publish `server.json` to MCP Registry after npm is live.
9. Re-run local MCP handshake from the published package.

## Success criteria

- A user can start Firefox with one flag, add the MCP server, and ask an agent
  to inspect a page without any other setup.
- The agent gets a snapshot with UIDs and can read console/network history.
- If Firefox is not reachable or another client owns the session, the message
  tells the user exactly what to do.
- No browser launch, no driver, no new runtime dependency.
