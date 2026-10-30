# Changelog

All notable changes to BiDi Browser MCP Server will be documented in this file.

## [Unreleased] — 0.2.0 work in progress

### Added
- **`interact` tool** — act on snapshot uids: click, type, clear, press,
  check, select, scroll, upload. Every action re-verifies the uid in the live
  page before dispatch (`ELEMENT_NOT_FOUND` / `STALE_UID`); clicks hit-test
  and refuse covered targets (`NOT_INTERACTABLE` names the coverer, with
  boundary-specific fix text for iframe and shadow/slot crossings); key input
  uses WebDriver private-use code points (Firefox rejects named keys); input
  state is released after every dispatch, and the snapshot cache is dropped
  so post-action state is never stale. Chained actions reuse the recorded
  uid→plan (verification stays the safety) and need no re-snapshot. Verified
  against Zen/Firefox 158 and Brave 153 through the chromium-bidi mapper,
  including same-origin iframe clicks, shadow-root click/scroll, and
  `input.setFiles` on visible and hidden file inputs.
- **`page.navigate`** with `wait: none | domContentLoaded | load` (mapped onto
  BiDi's `none|interactive|complete`); failures map to `NAVIGATION_FAILED`
  and every navigation drops the context's snapshot cache.
- **`script` tool** — `waitFor` polls the condition with short
  `script.callFunction` calls (250 ms interval, 120 s cap; syntax errors and
  thrown conditions surface immediately as `SCRIPT_ERROR` instead of a
  falsy-deadline timeout) and `evaluate`, gated by `BIDI_ALLOW_SCRIPT_EVAL=1`
  (the tool stays visible; the refusal names the flag; tool-internal scripts
  used by `interact` and verification are exempt).
- **`network` tool** (`BIDI_TOOLSET=network` or `devtools`) — read-only waits
  for request/response metadata (`until: request|response`, `method`,
  `urlPattern` substring filter). Requires `BIDI_ENABLE_NETWORK=1`; the
  subscription starts at session connect so trigger-then-wait flows still
  match buffered events. Metadata only — no bodies, no interception.
- Chromium discovery now confirms CDP liveness before a
  `DevToolsActivePort`-recorded port suppresses BiDi port probes, so a dead
  profile's recorded port can no longer shadow a Firefox listening there.
- MapperSocket startup-buffer overflow (500-message cap unchanged) is counted
  and warned once instead of dropping silently.

### Changed
- **New error codes are additive** for 0.1.x clients: `FRAME_NOT_FOUND`,
  `ELEMENT_NOT_FOUND`, `NOT_INTERACTABLE`, `STALE_UID`, `NAVIGATION_FAILED`
  join the taxonomy from Wave 0 (`UID_NOT_FOUND` already shipped in 0.1.9).
- Shared BiDi value unwrapper (`unwrapBiDiValue`) handles `null`, `undefined`,
  and `node` references (`sharedId`/`internalId` preserved for
  `input.setFiles`).
- The throwaway live-test launcher (`_archive`, dev-only) runs headless with
  an explicit window size: headed Zen opened a 0×0 content window in this
  environment, where `elementFromPoint` returns null and window commands hang.

## [0.1.10] - 2026-10-27

### Fixed
- The release workflow skips the npm publish step when the version is already
  on npm, so a manual first publish and workflow re-runs cannot fail the
  release.
- `package.json` `repository.url` is stored in the normalized form
  (`git+https://…`) npm expects, removing the publish-time auto-correction
  warning.

## [0.1.9] - 2026-10-27

### Added
- **Chromium support without chromedriver.** When a Chromium endpoint is
  discovered, the `chromium-bidi` mapper is started inside this server process
  and given a CDP connection; the tool layer keeps speaking WebDriver BiDi.
  Verified against Brave 153: `browsingContext.getTree` lists live tabs and
  `script.evaluate` runs in them. `chromium-bidi` is an optional dependency —
  without it, Chromium sessions fail with `MISSING_DEPENDENCY` and the exact
  install command.
- Chromium discovery reads `DevToolsActivePort` (port + browser WebSocket
  path) from the standard Chrome, Brave, Edge, Chromium, and Vivaldi user-data
  directories, and from the `--user-data-dir` of a running Chromium process —
  portable launchers that hide the port flag are found with no configuration.
  `BIDI_CHROMIUM_DATA_DIR` still adds directories explicitly, and a
  `BIDI_WS_URL` pointing at `/devtools/browser/…` is treated as Chromium.
  Chromium ports are no longer probed as BiDi `/session` endpoints (they always
  answer 403), so a Chromium-only machine no longer fails discovery.
- The snapshot traversal caps interactive elements at 5000 and reports the
  dropped count through snapshot metadata instead of serializing an unbounded
  element list.
- `BIDI_LOCAL_APP_DATA_ROOT` config knob so discovery stays the only module
  that reads environment variables.
- The connect timeout on the Chromium path explains the in-browser debugging
  permission dialog, which Chromium requires once per connection.

### Changed
- `BiDiClient` accepts a custom socket opener (`openSocket`), letting the
  mapper facade plug in without changing the tool layer. A generation guard
  stops a late socket open from reviving an abandoned connect attempt, and a
  socket that dies right after opening can no longer be reported as connected.
- Connect failures mention both browser families and their launch flags.
- Chromium capabilities are normalized before tools see them: the mapper's
  product string becomes `browserName`/`browserVersion`, and empty placeholder
  fields are dropped.
- Mapper messages emitted while the mapper starts are buffered and replayed
  after the session opens, so context events are not lost.

### Fixed
- The connect timeout is no longer cancelled as soon as a socket is created;
  a socket that never opens now fails at `BIDI_TIMEOUT` instead of hanging.
- Crash-recovery reattaches only to endpoints discovery would allow: a tampered
  persisted session file can no longer redirect the server to a remote host.
- A missing `chromium-bidi` install and a broken one now produce different
  errors; the version pin is named in both fixes.

## [0.1.8] - 2026-10-25

### Added
- Chromium story: `pnpm detect` marks Chromium-family processes `[cdp-only]`
  (Chrome, Brave, Edge, Vivaldi, Opera — webview noise filtered), README
  documents the chromium-bidi mapper path via `BIDI_WS_URL`, and Firefox-only
  tools (`context`, `spaces`) refuse non-Firefox sessions with `UNSUPPORTED`
  and a clear fix instead of a cryptic BiDi error.
- Session state survives socket drops: a dropped WebSocket clears the adopted
  session immediately (honest `status`), and the next `connect()` recovers
  the orphaned session through its persisted id and takes a fresh one.
- Snapshot traversal is single-pass (shadow hosts recurse before the
  interesting/visible filter, halving DOM scans per root).

## [0.1.7] - 2026-10-23

### Security
- The mozLz4 decoder no longer risks leaking uninitialized heap bytes: output
  buffers are zero-filled, a short literal read fails the decode instead of
  advancing past the gap, and the decoded size is capped at 64 MiB (the file
  cap alone does not bound LZ4 expansion).
- Profile files are read with a bounded read. The size is taken from the open
  file descriptor, so a session store that grows between the check and the
  read can no longer exceed the 16 MiB cap; `containers.json` is capped at
  1 MiB.
- Snapshots never read live field values. Passwords, tokens, and typed text
  stay out of the snapshot, the agent context, and client logs. Password
  inputs are marked `masked`.
- `tabs.new` only opens `http:`, `https:`, and `about:blank`. `file:`, `data:`,
  `javascript:`, and `blob:` are rejected.
- `context.remove` requires `confirm: true` — it deletes the container with
  its tabs, cookies, and storage.

### Fixed
- `tabs.list` keeps the URL from a `browsingContext.urlChanged` event while the
  tree still reports the old URL, so SPA navigation no longer shows a stale
  tab URL.
- Container names are dropped unless the number of live user contexts matches
  the number of profile identities; a positional join can no longer label the
  wrong container.
- `context.list` reads only `containers.json` — the Zen session store is no
  longer decoded for it. The store is size-capped (16 MiB), decoded into a
  preallocated buffer, and decode failures surface as warnings.
- A throwing event sink no longer takes down the server.
- `observe.events` with `drain` removes only the records it returned.
- `limit` must be a positive integer (`observe`, `console`, event pipeline).
- Snapshot cache invalidates on `browsingContext.urlChanged`, so SPA
  navigation no longer serves a stale snapshot.
- The token optimizer budgets the whole payload (url, title, elements, text)
  instead of guessing with a fixed 16-character allowance.
- Unknown contexts now surface as `CONTEXT_NOT_FOUND` instead of a raw BiDi
  message.
- `BIDI_OUTPUT_MODE=file` is rejected at startup; `full` and `inline` are
  implemented.
- The first `urlChanged` URL is no longer lost for a context the tree had not
  read yet, and the cached tree/event URL maps are cleaned up when a context
  closes.
- A Zen space whose `uuid` is preceded by a nested object (a theme, for
  example) is still parsed: the parser walks back to the enclosing object
  instead of reading the nested one.
- A malformed container identity is skipped instead of discarding every valid
  identity.
- `toToolResult` requires the output mode explicitly, so a caller can no
  longer truncate differently from the configured server default.
- Dead code is out: `noUnusedLocals`/`noUnusedParameters` are enabled, and
  the test files are typechecked by `pnpm typecheck`.

### Added
- `context` tool: `list` (containers joined with profile names, icons, colors,
  and live tab counts), `new`, `remove` (gated: default container refused),
  `tabs-in`.
- `spaces` tool: `list` reads Zen spaces (name, theme, bound container) from
  the profile session store — read-only, never written.
- `tabs.list` and `browsingContext.getTree` results now carry the tab's
  `userContext` id.
- `profile/` layer: Firefox containers.json reader, Zen session-store reader
  with a minimal mozLz4 decoder, and the verified positional join between
  BiDi user-context ids and profile identities.
- `tabs.new` accepts `userContext` to open a tab directly inside a container.

### Notes
- Firefox 158 exposes containers over BiDi as uuids (`browser.getUserContexts`,
  `createUserContext`, `removeUserContext`); containers.json keeps integer ids.
  The join is positional (verified: new containers append in id order) and the
  default context has no profile identity.
- Zen space tab↔space mapping is not exposed by any API; spaces list from the
  session store without per-tab joins.

### Fixed
- `connect` failed on Firefox 158 when `session.subscribe` included
  `browsingContext.urlChanged`, which that build rejects ("not a valid event
  name") — the failure was then masked by the next candidate's handshake 403.
  The event is removed; `domContentLoaded` already carries URL updates.
- WebSocket handshake failures on 403/429/503 are retried with backoff (the
  Remote Agent 403s the first upgrade while the browser finishes
  initializing); a failed upgrade never creates a session, so retrying is
  safe.
- A hung WebSocket handshake no longer crashes the process: `ws` emits the
  handshake-abort `'error'` asynchronously after `terminate()`, which crashed
  Node when the abort raced listener removal (found against Brave's hanging
  CDP endpoint); a no-op error listener now absorbs it and connect fails
  cleanly with `DISCOVERY_FAILED`.
- `close()` no longer throws when called on a still-handshaking socket.
- A `SESSION_BUSY` conflict is no longer masked by another candidate's
  handshake error in `details.lastError`.
- `connect` no longer leaks a session when session services fail to start:
  adoption into the manager happens only after `session.subscribe` and the
  initial tab sync succeed, a failed start ends the fresh session, and the
  candidate catch rolls back partially adopted state. Previously a failed
  start left a ghost `connected` status, leaked the browser's only BiDi
  session, and every later `connect` early-returned on the stale status.
- The stdio server now ends the BiDi session when the client closes stdin or
  sends a termination signal, so a killed MCP client no longer orphans the
  browser's only session.
- `connect` recovers from `SESSION_BUSY` when a previous process left a
  session behind: the last session id is persisted to the temp dir and the
  orphan is ended through its dedicated `/session/<id>` WebSocket path where
  the browser registered one (Firefox main-branch sessions created with
  `webSocketUrl`; the fix text explains the restart fallback otherwise).

## [0.1.6] - 2026-10-23

### Added
- `page` tool: `snapshot` (interactive element map with uids; text mode via
  `mode: "text"`, `refresh` to bypass the cache) and `content` (readable page
  text).
- `snapshot/` layer: DOM traversal script (roles, names, bounds, states, CSS
  resolution paths; same-origin iframes and open shadow roots), per-context
  snapshot cache invalidated on navigation/context close, token optimizer with
  the `BIDI_MAX_INLINE_LEN` budget and truncation metadata, uid resolver.
- `ConnectionRuntimeLike.snapshots` wired into the session lifecycle.

### Notes
- Element resolution is selector-first (the plan's CSS fallback path). The
  sharedId route stays open for the interaction wave; it is not needed for
  read-only snapshots.

## [0.1.5] - 2026-10-23

### Added
- `tabs` tool: `list`, `new`, `activate`, `close`, `info`, `select`.
- `console` tool: `list` (filtered), `clear`.
- `observe` tool: `status` (subscription + buffer health), `events` (filter,
  limit, drain).
- `cleanup` tool: `disconnect` ends the session without closing the browser.
- `EventPipeline`: one `session.subscribe` per session, bounded per-method
  buffers with drop-oldest counters, console entry mapping, filters.
- `ContextManager`: tree-backed tab list, event tracking
  (created/destroyed/domContentLoaded), selected-tab heuristic, context
  resolution for all future tools.
- `SessionManager.request` passthrough and a `runtime` accessor exposing the
  live event/context services.

### Fixed
- Tab selection marker is returned by `select`/`activate` consistently; the
  browser tree stays the source of truth for what exists.

## [0.1.4] - 2026-10-22

### Added
- Discovery layer with profile-file, profiles.ini, process command line, and
  common-port fallback candidates.
- `browser` tool with `status`, `profiles`, `version`, `connect`, and
  `disconnect`.
- `SessionManager` that owns one BiDi session and never relaunches, mutates, or
  closes the user's browser.
- `BiDiClient` with request IDs, timeouts, event fan-out, and clean close
  semantics.
- `scripts/dev-detect.mjs` to inspect Firefox-family processes and the parsed
  Remote Agent port.
- `pnpm detect` script and 0.1.4 docs.

### Changed
- `ping.status` now reports the real session state when a session manager is
  present.
- Explicit `BIDI_WS_URL` now wins over all other discovery candidates.

### Fixed
- BiDi error frames follow the spec shape (`error` is a flat string code,
  `message` a sibling string); the parser accepts both flat and nested shapes.
- `session.new` now sends `{ capabilities: {} }` — Firefox/Zen assert that
  `capabilities` is present.
- Session conflicts map to `SESSION_BUSY` by matching the real Zen frame
  (`session not created` / "Maximum number of active sessions").
- `disconnect` awaits an in-flight `connect` instead of silently no-oping and
  leaving the session open.
- The final `DISCOVERY_FAILED` error surfaces the last underlying failure in
  `details.lastError`.
- Discovery gates **every** candidate against `BIDI_ALLOW_REMOTE`, not just
  `BIDI_WS_URL` — a tampered profile `WebDriverBiDiServer.json` can no longer
  point the server at a remote host. `ws_port` must be an integer in 1–65535.
- `Config` carries the app-data root, so no module outside `config.ts` reads
  `process.env` (optional `BIDI_APP_DATA_ROOT` override for tests/CI).

### Fixed
- Failed connect attempts no longer leak WebSockets; every rejected candidate
  is closed before moving on.
- `disconnect()` now recovers from a dead socket: field reset and close run in
  `finally`, so the server no longer needs a restart after a dropped browser.
- A malformed BiDi error frame (empty `error` payload) no longer crashes the
  process — it rejects with `SESSION_FAILED` and a generic message.
- A connect timeout no longer leaves an abandoned socket that can flip the
  client back to `connected`; the socket is terminated and unassigned.
- `pnpm detect` no longer crashes when no Firefox-family process is running
  (empty PowerShell/CIM output is handled).
- Stale "v0.1.3/v0.1.4 will add" claims in README and TESTING updated.

## [0.1.3] - 2026-10-21

### Added
- Carcass layout: `config.ts`, `types.ts`, `utils/` (`errors`, `result`,
  `assert`), `tools/` (`base-tool`, `registry`, `ping`), and future-folder
  READMEs for `connection/`, `session/`, and `snapshot/`.
- Read-only `ping` tool with a `status` action, input/output schemas, and MCP
  annotations.
- Hermetic `MockBiDiServer` with `session.status`, `session.new`,
  `browsingContext.getTree`, `script.evaluate`, events, and request recording.
- Unit tests for config, result envelopes, registry, ping, and the mock server.
- Local OpenCode dev entry pointing at `dist/bin.js` (external config only).

### Changed
- `src/index.ts` now wires the registry and `tools/list` / `tools/call`; the
  import remains side-effect-free.
- Contributor rules updated for minimal code, reuse, testing, and the one-env
  reader rule.
- README status is now the v0.1.3 carcass; the planned surface is 16 tools with
  `core` / `network` / `devtools` toolsets, and Firefox debugger/profiler are
  documented as vendor modules.
- Version metadata aligned to 0.1.3 in `package.json` and `server.json`.

## [Unreleased]

### Added
- Repository governance: `main` (public) / `dev` (working) split, automated
  promote-and-strip workflow, and a guard that keeps dev-only material off main.
- Tag-driven npm releases from `main` via Trusted Publishing (OIDC, tokenless)
  with GitHub Release bundles.
- pnpm toolchain, TypeScript strict scaffold, and a stdio MCP entry point.
- Dev-only design notes and protocol research live on the `dev` branch.
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
