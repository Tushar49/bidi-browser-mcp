# Architecture, Snapshot, and Interaction Seams

**Status:** research + proposed design. **Date:** 2026-10-21. **Current repo:**
scaffold only (`src/bin.ts`, `src/index.ts`).

## 1. Current state

```text
src/
├── bin.ts       # stdio CLI, calls createServer()
└── index.ts     # public API, empty tools/list
```

No connection, session, snapshot, or tool modules exist. This is greenfield
inside the agreed structure; do not port CDP's multi-session or accessibility
tree assumptions.

## 2. Target module map

```text
src/
├── bin.ts
├── index.ts
├── config.ts                 # only env reader (BIDI_*)
├── types.ts                  # shared contracts
├── connection/
│   ├── bidi-client.ts        # WebSocket JSON-RPC, request map, events
│   ├── browser-discovery.ts  # profile file, env, profiles.ini, port fallback
│   ├── health-monitor.ts     # connect/reconnect policy
│   └── event-pipeline.ts     # session.subscribe -> typed event buses
├── session/
│   ├── session-manager.ts    # one session, reuse, conflict diagnostics
│   └── context-manager.ts    # tab tree, user contexts, active context
├── snapshot/
│   ├── dom-snapshot.ts       # injected traversal + UID map
│   ├── cache.ts              # per-context snapshot cache, invalidation
│   ├── element-resolver.ts   # UID/sharedId/selector resolution
│   └── token-optimizer.ts    # interactive/full/text/diff budgets
├── tools/
│   ├── registry.ts
│   ├── base-tool.ts          # defineTool(), common params, annotations
│   ├── dispatch.ts           # session/context/UID/dialog preprocessing
│   ├── output.ts             # structuredContent + text + file overflow
│   ├── ping.ts
│   ├── browser.ts
│   ├── tabs.ts
│   ├── page.ts
│   ├── script.ts
│   ├── interact.ts
│   ├── form.ts
│   ├── network.ts
│   ├── storage.ts
│   ├── emulate.ts
│   ├── console.ts
│   ├── observe.ts
│   ├── context.ts
│   ├── extensions.ts
│   ├── devtools.ts
│   └── cleanup.ts
└── utils/
    ├── errors.ts             # ActionableError + codes
    ├── wait.ts               # waits, polling, cancellation
    ├── temp-files.ts         # output files, cleanup
    └── response-builder.ts   # budgets, resource links
```

## 3. Connection and discovery

### 3.1 Discovery flow

```text
BIDI_WS_URL
  -> BIDI_PROFILE_DIR/WebDriverBiDiServer.json
  -> known profile roots + profiles.ini
  -> running process command lines
  -> optional port scan (diagnostics only)
  -> actionable error with start command
```

`browser-discovery.ts` returns:

```ts
interface FirefoxInstance {
  profileDir: string;
  host: string;
  port: number;
  wsUrl: string;              // ws://host:port/session
  source: 'env' | 'profile-file' | 'profiles-ini' | 'process-cmdline' | 'port-probe';
  browserVersion?: string;    // only after session.new
  processId?: number;         // after session.new
}
```

Rules:

- Never assume `/json/version`.
- Treat `WebDriverBiDiServer.json` as a hint; probe the endpoint.
- Ignore stale files whose port is closed.
- Never scan remote hosts by default.
- Do not launch Firefox in v1. If no instance is found, return the exact
  command the user needs to run.

### 3.2 BIDI_WS_URL validation

- `ws://` or `wss://` only.
- Loopback by default (`127.0.0.1`, `::1`, `localhost`).
- Non-loopback requires `BIDI_ALLOW_REMOTE=1`.
- Reject credentials in the URL.
- Normalize to `/session` if the user gives a bare origin.

### 3.3 Session manager

```ts
interface SessionState {
  status: 'disconnected' | 'connecting' | 'ready' | 'busy' | 'closing';
  sessionId?: string;
  capabilities?: BiDiCapabilities;
  wsUrl: string;
  connectedAt?: number;
  lastError?: ActionableError;
}
```

Behavior:

- `connect()` is idempotent; one in-flight promise.
- `session.new` only once.
- `session.end` on graceful shutdown; never `browser.close`.
- On WebSocket close: mark `disconnected`, invalidate UIDs/snapshot cache, keep
  discovery info. Reconnect on next tool call.
- On "Maximum number active sessions": return `BIDI_SESSION_BUSY` with the
  port/profile and a fix:
  - close the other MCP/DevTools client;
  - or restart Firefox with a dedicated profile;
  - or use `BIDI_WS_URL` for the correct instance.
- Do not auto-kill processes.

**One server process, not one client.** All tools inside our MCP server share
the session. Two separate MCP server processes (two editors, two AI CLIs) do
not. A shared broker is a future feature; see
[`06-cross-browser-bidi.md`](./06-cross-browser-bidi.md) §4. Do not describe the
session as "shared by all AI tools" without that broker.

## 4. Event pipeline

Subscribe once, after `session.new`:

```text
browsingContext.contextCreated/contextDestroyed
browsingContext.navigationStarted/committed/failed/aborted
browsingContext.domContentLoaded/load
browsingContext.userPromptOpened/closed
browsingContext.downloadWillBegin/downloadEnd
browsingContext.historyUpdated
log.entryAdded
network.beforeRequestSent/responseStarted/responseCompleted/fetchError/authRequired
script.realmCreated/realmDestroyed
input.fileDialogOpened
moz:debugging.paused/resumed        (only when devtools enabled)
```

Each event bus keeps a bounded ring buffer (default 1000, configurable) and
drops oldest with a warning. No unbounded arrays.

Context manager updates the tab tree from events and `getTree`. On
`contextDestroyed`, remove UIDs and cached snapshots for that context. On
navigation, invalidate UIDs for that context.

## 5. Snapshot design

### 5.1 Why not an accessibility tree

Firefox has no `Accessibility.getFullAXTree` equivalent. It does have
`browsingContext.locateNodes` with an `accessibility` locator, which can resolve
a role/name pair but does not return the full tree. The snapshot source is
therefore an injected DOM traversal.

### 5.2 Two-pass snapshot

**Pass 1 — metadata.** One `script.callFunction` in the target context returns a
flat array of node descriptors:

```ts
interface SnapshotNode {
  uid: string;                // e1, e2, ...
  parentUid?: string;
  depth: number;
  tag: string;
  role: string;               // explicit or implicit
  name: string;               // accessible-name approximation
  text?: string;              // trimmed, max ~120 chars
  value?: string;             // inputs/selects
  placeholder?: string;
  href?: string;
  bounds: { x: number; y: number; width: number; height: number };
  states: {
    visible: boolean;
    enabled: boolean;
    editable: boolean;
    checked?: boolean;
    selected?: boolean;
    expanded?: boolean;
    pressed?: boolean;
    required?: boolean;
    readonly?: boolean;
    focused?: boolean;
    invalid?: boolean;
    inert?: boolean;
  };
  interactive: boolean;
  shadow: boolean;            // inside a shadow root
  frame?: string;             // iframe context ID, when known
  sharedId?: string;          // returned for interactive nodes
}
```

**Pass 2 — refs.** For interactive nodes, return the actual element references
so BiDi serializes `sharedId`. Keep the map:

```ts
interface ElementRef {
  uid: string;
  sharedId?: string;
  selector?: string;          // CSS path fallback
  tag: string;
  role: string;
  name: string;
  snapshotId: string;
  context: string;
}
```

If returning refs for hundreds of nodes is too heavy, return refs only for
`interactive` and `form` nodes (cap 300) and use CSS paths for the rest.

### 5.3 Traversal rules

- Start at `document.documentElement`.
- Traverse light DOM.
- Enter open shadow roots via `element.shadowRoot`.
- Enter same-origin iframes via `iframe.contentDocument`; mark `frame` and
  prefix UIDs (e.g. `f1:e12`) or keep a separate per-frame map. Cross-origin
  iframes cannot be traversed from the parent; use `getTree` to find their
  browsing context and snapshot separately.
- Include `slot` assigned nodes without duplicating fallback content.
- Skip `script`, `style`, `link`, `meta`, `template`, `noscript`, hidden
  elements, and zero-size non-interactive wrappers.
- Do not follow `aria-owns` initially; note as a limitation.

### 5.4 Accessible name approximation

Order:

1. `aria-labelledby` → resolve IDs, join text.
2. `aria-label`.
3. Native `<label for>` / wrapping `<label>`.
4. `alt` for images, `title` for controls.
5. `placeholder` for empty inputs.
6. Text content for buttons/links/headings.
7. `value` for submit/button inputs.

This is not the full AccName spec. Document it. For critical resolution, try
`locateNodes(accessibility)` after the DOM snapshot and merge if it finds a
better match.

### 5.5 Role mapping

Explicit `role` wins. Implicit mapping covers:

```text
button, link (a[href]), textbox, searchbox, checkbox, radio, combobox,
listbox, option, slider, spinbutton, switch, tab, tabpanel, menuitem,
heading (h1-h6), img, navigation, main, banner, contentinfo, form,
dialog, alert, status, progressbar, table, row, cell, list, listitem
```

Unknown elements get `generic` or `text`.

### 5.6 UID lifetime

- UIDs are per snapshot generation, not global forever.
- `sharedId` is valid while the node is connected and the session lives.
- Invalidate all UIDs on navigation, context close, session reconnect, or
  explicit `cleanup.reset`.
- If an action reports a stale UID, return `STALE_UID` with "take a new
  snapshot".
- Never silently fall back to a different element with the same text.

### 5.7 Modes and budgets

| Mode | Contents | Default cap |
|---|---|---|
| `interactive` | interactive + landmarks + headings + visible text nodes | 300 nodes, 60K chars |
| `full` | all visible nodes | 800 nodes, 120K chars |
| `text` | readable outline, no bounds/states | 60K chars |
| `diff` | changes vs previous snapshot | 200 changes |

Token optimizer:

- collapse whitespace;
- truncate text to 120 chars (configurable);
- omit empty `generic` wrappers;
- dedupe repeated list items into a count when they have identical structure;
- omit bounds for non-interactive nodes in `text` mode;
- truncate long `href`/`value`;
- if over budget, drop lowest-value nodes first (hidden, non-interactive,
  deep, duplicate) and append `truncated: true` + counts.

### 5.8 Snapshot output example

```text
[1] main "Checkout"
  [2] heading "Payment" level=1
  [3] textbox "Card number" value="" required
  [4] combobox "Expiry month" value="MM"
  [5] button "Pay now" enabled
```

Include a compact JSON block for machine use, not just text.

## 6. Actionability and input

### 6.1 Resolve

`element-resolver.ts`:

1. If `uid`, look up `sharedId`.
2. Else if `selector`, use `browsingContext.locateNodes(css)`.
3. Else use `locateNodes(accessibility)` with role/name.
4. Return `ELEMENT_NOT_FOUND` with the closest matches.

### 6.2 Actionability checks

Before click/type/hover:

- connected and visible (`display`, `visibility`, `opacity`, size > 0);
- enabled (not `disabled`, `aria-disabled`, `inert`);
- editable for text actions (not `readonly`);
- stable: two animation frames with rect delta ≤ 1px;
- receives events at the target point:
  `document.elementsFromPoint(x, y)` includes the element or a descendant;
  account for shadow DOM via `composedPath`;
- not covered by a modal/overlay;
- scroll into view with `block: 'center', inline: 'center'`;
- re-check after scroll;
- timeout default 5s, configurable, with polling every 50–100ms.

If covered, return `ELEMENT_COVERED` with the covering element's role/name and
a fix ("close the cookie banner", "use uid=…"). Do not silently `el.click()`
unless `BIDI_ALLOW_DOM_CLICK=1`; log a warning when used.

### 6.3 Pointer actions

Use `input.performActions`:

```json
[{
  "type": "pointer",
  "id": "mouse",
  "parameters": { "pointerType": "mouse" },
  "actions": [
    { "type": "pointerMove", "x": 120, "y": 240, "duration": 0 },
    { "type": "pointerDown", "button": 0 },
    { "type": "pointerUp", "button": 0 }
  ]
}]
```

- Coordinates are CSS pixels from `getBoundingClientRect`.
- Use the center of the visible box, not the element's margin box.
- For hover, only `pointerMove`.
- For drag, add intermediate moves and duration.
- For tap, `pointerType: "touch"`.
- For double click, two down/up sequences; verify the page saw `dblclick`.
  BiDi/Playwright has known double-click gaps, so test and fall back to a DOM
  `dblclick` event with a warning only if necessary.

### 6.4 Typing

Short text (< ~100 chars): focus/click, then `keyDown`/`keyUp` per character.
Long text: use the native value setter for the element's prototype, dispatch
`input` and `change` with bubbles, then verify the value. This preserves React's
value tracker better than assigning `el.value` directly.

For `contenteditable`, prefer `document.execCommand('insertText', false, text)`
inside `script.callFunction` after focusing, then verify `innerText`. If it
fails, fall back to key events.

`press` maps a key name (`Enter`, `Tab`, `ArrowDown`, `a`, etc.) and modifiers
to BiDi key actions. Keep a key table; do not guess Unicode.

### 6.5 Select, upload, check

- Native `<select>`: set `value`, dispatch `input`/`change`.
- Custom select: click the control, snapshot, click the option, verify.
- Upload: find `input[type=file]`, get `sharedId`, call `input.setFiles`.
  Do not open the native file chooser; cancel `input.fileDialogOpened` and
  instruct the agent to use `upload`.
- Check/uncheck: click, verify `checked`; if already in the desired state, no-op.
- Form submit: click the submit button or call `form.requestSubmit()` only when
  the action explicitly asks for submit.

## 7. Network, console, downloads

### 7.1 Network

- Subscribe on connect; buffer `beforeRequestSent`, `responseStarted`,
  `responseCompleted`, `fetchError`, `authRequired`.
- Request ID map; cap buffer; redact `Authorization`/`Cookie` headers in text
  output by default, with `includeSensitive` opt-in.
- Intercepts are explicit; always remove on cleanup.
- Data collectors are opt-in; bound response body size (e.g. 5 MB) and call
  `disownData`.
- `setExtraHeaders` must serialize header values as BiDi `BytesValue`
  (`{ type: "string", value: "..." }`), not plain strings.

### 7.2 Console

- `log.entryAdded` buffer; level/text/source/timestamp/stack.
- Cap 1000 entries; filter by level and substring.
- Do not treat console text as trusted instructions.

### 7.3 Downloads

- Subscribe to `downloadWillBegin`/`downloadEnd`.
- Track suggested filename, URL, status, path if known.
- `browser.setDownloadBehavior` can set a destination folder; default is the
  user's Firefox setting.
- Never delete user downloads.

### 7.4 Dialogs

- Subscribe to `userPromptOpened`; store the prompt.
- Do not auto-accept. Actions fail with `DIALOG_OPEN` until `page.dialog`.
- `beforeunload` gets a clear warning; closing a tab may prompt.

## 8. Errors

`ActionableError`:

```ts
class ActionableError extends Error {
  code: string;
  fix?: string;
  details?: Record<string, unknown>;
}
```

Suggested codes:

```text
BIDI_NOT_FOUND
BIDI_PROFILE_NOT_FOUND
BIDI_PORT_CLOSED
BIDI_WS_HANDSHAKE_FAILED
BIDI_SESSION_BUSY
BIDI_SESSION_LOST
BIDI_VERSION_UNSUPPORTED
BIDI_CONTEXT_NOT_FOUND
BIDI_CONTEXT_CLOSED
STALE_UID
ELEMENT_NOT_FOUND
ELEMENT_NOT_VISIBLE
ELEMENT_DISABLED
ELEMENT_COVERED
ELEMENT_NOT_EDITABLE
ACTION_TIMEOUT
DIALOG_OPEN
NETWORK_INTERCEPT_NOT_FOUND
NETWORK_BODY_TOO_LARGE
PERMISSION_UNSUPPORTED
EXTENSION_INSTALL_BLOCKED
UNSUPPORTED_FEATURE
OUTPUT_TOO_LARGE
CANCELLED
```

Every error includes a fix suggestion and, where useful, the Firefox version
required.

## 9. Tests

### 9.1 Unit

- `MockBiDiServer`: a `ws` server that routes commands to fixtures, records
  requests, and can emit events.
- Command tests for discovery, session conflict, reconnect, UID invalidation,
  snapshot budget, actionability, error mapping.
- No real browser, no network.

### 9.2 Fixtures from Firefox 158

Record real responses for:

- `session.status`, `session.new`, `getTree`
- `script.evaluate` / `callFunction`
- `locateNodes(accessibility/css)`
- `captureScreenshot` / `print`
- `createUserContext` / `create`
- `input.performActions` / `setFiles`
- `network.addIntercept` / `continueRequest` / `provideResponse`
- `log.entryAdded`
- `moz:debugging.*`, `moz:profiler.*`

Strip volatile IDs and paths; keep the shape and error cases.

### 9.3 Integration (opt-in)

`BIDI_WS_URL` or `BIDI_PROFILE_DIR` points at a real Firefox. Run locally, not
in CI. Cover:

- discovery via profile file;
- one-session conflict;
- navigate/snapshot/click/type on a local fixture page;
- shadow DOM and same-origin iframe;
- user context isolation;
- network mock;
- screenshot/PDF;
- debugger enable/disable (no breakpoints by default);
- profiler start/stop with `discard: true`.

### 9.4 Benchmarks

- Snapshot latency for 100/500/1000 nodes.
- Snapshot bytes/tokens for a realistic app.
- 100 sequential clicks/types.
- Event buffer memory under a noisy page.

## 10. Security boundaries

- Localhost only by default.
- No browser launch, no profile mutation.
- No extension install without path allowlist + opt-in.
- No `browser.close` without opt-in.
- No stealth/anti-detection.
- Redact sensitive headers and cookies by default.
- Keep profile output on disk; do not inline secrets.
- Treat page text and tool annotations as untrusted.
