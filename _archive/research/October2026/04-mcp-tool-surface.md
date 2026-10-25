# MCP 2026-07-28 and the Tool Surface

**Status:** research + proposed design. **Date:** 2026-10-21. **SDK:**
`@modelcontextprotocol/sdk` **1.32.1** (already installed).

## 1. What changed in MCP

The current spec revision is **2026-07-28**. The headline is a stateless HTTP
core, but stdio servers remain valid and are still the right transport for a
local, profile-attached browser server.

Relevant to this project:

| Feature | State | Use here |
|---|---|---|
| stdio transport | Supported | Yes; local-only, no OAuth/HTTP |
| `inputSchema` | JSON Schema 2020-12 by default | One schema per tool, `action` enum |
| `outputSchema` | Optional | Use where the shape is stable; validate `structuredContent` |
| `structuredContent` | Any JSON value | Return `{ ok, action, data, warnings? }` |
| `annotations` | `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` | Set per tool; document action-level risk |
| `title`, `icons` | Optional metadata | Add `title`; skip icons for now |
| Progress / cancellation | `notifications/progress`, `notifications/cancelled` | Long snapshots/network waits, screencast |
| Tasks extension | `io.modelcontextprotocol/tasks` | Not v1; no long-running background jobs yet |
| MCP Apps | Server-rendered UI | Not v1; no UI requirement |
| Registry | `mcpName` + `server.json` | Already implemented in this repo |

The SDK's `registerTool()` supports `outputSchema` and `annotations`; use it
instead of the deprecated `tool()` overloads.

## 2. Tool design principles

1. **Few tools, explicit actions.** 16 tools / ~110 actions. Agents pick a tool
   by domain, then an action. This keeps the tool list under ~6K tokens.
2. **Action names are verbs.** `click`, `type`, `setCookie`, `startScreencast`.
   Avoid `do`, `run`, `execute` as the only action.
3. **Flat parameters.** No nested `options` bag unless the underlying command
   requires it. Common params: `context`, `uid`, `selector`, `timeout`.
4. **Structured results.** Every success returns `structuredContent`; every
   failure returns `isError: true` with a machine-readable code and a fix hint.
5. **No silent destructive actions.** Closing tabs/windows, clearing storage,
   installing extensions, and ending the browser are explicit actions with
   annotations and (for extension install) an opt-in gate.
6. **Token discipline.** Snapshots default to interactive mode; large
   screenshots/PDFs/profiles go to files with resource links.
7. **Feature detection.** `moz:*`, screencast, permissions, and newer emulation
   commands are optional. Missing features return `unsupportedFeature` with the
   required Firefox version, not a crash.

## 3. Proposed 16-tool surface

### 3.1 `ping`

| Action | Returns |
|---|---|
| `status` | server version, Firefox version, connected, session ID, uptime |

Read-only. No browser dependency; works before attach.

### 3.2 `browser`

| Action | BiDi | Notes |
|---|---|---|
| `status` | `session.status` + capabilities | readiness, version, profile, process |
| `connect` | discovery + `session.new` | explicit reconnect |
| `profiles` | discovery scan | endpoint + `source` (`profile-file`, `process-cmdline`, `port-probe`) + live marker |
| `version` | capabilities | `browserVersion`, `moz:buildID` |
| `windows` | `browser.getClientWindows` | IDs, states |
| `windowState` | `browser.setClientWindowState` | normal/minimize/maximize/fullscreen |
| `permission` | `permissions.setPermission` | descriptor/state/origin/userContext |
| `downloadBehavior` | `browser.setDownloadBehavior` | allowed/denied, destination folder |
| `close` | `browser.close` | **gated**, destructive, never default |

### 3.3 `tabs`

| Action | BiDi | Notes |
|---|---|---|
| `list` | `browsingContext.getTree` | top-level + children, userContext, clientWindow |
| `new` | `browsingContext.create` | tab/window, userContext, referenceContext |
| `close` | `browsingContext.close` | `promptUnload` optional |
| `activate` | `browsingContext.activate` | top-level only |
| `info` | `getTree` filtered | URL, title, parent, userContext |
| `select` | `activate` + state | active tab heuristic |

### 3.4 `page`

| Action | BiDi | Notes |
|---|---|---|
| `goto` | `browsingContext.navigate` | `wait: none/interactive/complete` |
| `reload` | `browsingContext.reload` | `ignoreCache` |
| `back` / `forward` | `traverseHistory` | delta −1/+1 |
| `screenshot` | `captureScreenshot` | format, clip, origin, imageSize; file/resource |
| `print` | `browsingContext.print` | PDF to file/resource |
| `viewport` | `setViewport` | width/height/devicePixelRatio |
| `dialog` | `handleUserPrompt` | accept/dismiss, prompt text |
| `snapshot` | injected DOM traversal | interactive/full/text/diff |
| `content` | `script.evaluate` | innerText/HTML, budgeted |
| `screencastStart` | `startScreencast` | 154+; destinationFolder 158+ |
| `screencastStop` | `stopScreencast` | returns path |

### 3.5 `script`

| Action | BiDi | Notes |
|---|---|---|
| `evaluate` | `script.evaluate` | expression, awaitPromise, serialization |
| `call` | `script.callFunction` | function + arguments, node refs |
| `realms` | `script.getRealms` | window/worker/worklet |
| `preloadAdd` | `addPreloadScript` | contexts/userContexts/sandbox |
| `preloadRemove` | `removePreloadScript` | — |

### 3.6 `interact`

| Action | Implementation |
|---|---|
| `click` | UID/selector → actionability → pointer move/down/up |
| `dblclick` | two pointer sequences with click count |
| `type` | focus + key events for short text; native setter + InputEvent for long text |
| `press` | keyDown/keyUp |
| `hover` | pointerMove |
| `scroll` | `element.scrollIntoView` or wheel actions |
| `drag` | pointer move/down/move/up with duration |
| `upload` | `input.setFiles` with sharedId |
| `tap` | touch pointer |
| `select` | native select or option click; dispatch change |
| `focus` | `element.focus()` |
| `check` / `uncheck` | click + verify checked state |
| `setValue` | native setter + input/change events |
| `waitFor` | selector/UID + visible/attached/stable/network idle |

Every action returns the resolved UID, selector, box, and whether a fallback was
used.

### 3.7 `form`

| Action | Notes |
|---|---|
| `inspect` | fields, labels, types, required, options, current values |
| `fill` | multi-field fill with per-type strategies |
| `validate` | required/pattern/min/max/error text |

Smart-form features from the CDP repo (country codes, location autocomplete,
per-type strategies) are a later increment; the first version is a reliable
generic filler.

### 3.8 `network`

| Action | BiDi |
|---|---|
| `interceptAdd` / `interceptRemove` | `addIntercept` / `removeIntercept` |
| `continue` | `continueRequest` |
| `continueResponse` | `continueResponse` |
| `fail` | `failRequest` |
| `mock` | `provideResponse` |
| `auth` | `continueWithAuth` |
| `cache` | `setCacheBehavior` |
| `headers` | `setExtraHeaders` (BytesValue serialization) |
| `collectAdd` / `collectRemove` | `addDataCollector` / `removeDataCollector` |
| `list` | buffered `beforeRequestSent` / `responseStarted` / `responseCompleted` |
| `detail` | buffered request + optional `getData` body |

### 3.9 `storage`

| Action | Implementation |
|---|---|
| `cookiesGet` | `storage.getCookies` |
| `cookiesSet` | `storage.setCookie` |
| `cookiesDelete` | `storage.deleteCookies` |
| `storageGet` | JS localStorage/sessionStorage |
| `storageSet` | JS |
| `storageClear` | JS; destructive, scoped by origin |

### 3.10 `emulate`

| Action | BiDi |
|---|---|
| `geolocation` | `setGeolocationOverride` |
| `locale` | `setLocaleOverride` |
| `timezone` | `setTimezoneOverride` |
| `userAgent` | `setUserAgentOverride` |
| `orientation` | `setScreenOrientationOverride` |
| `screen` | `setScreenSettingsOverride` |
| `offline` | `setNetworkConditions` (offline only in 158) |
| `media` | `setMediaFeaturesOverride` (159+; feature-detect) |
| `reset` | null/empty reset for each |

### 3.11 `console`

| Action | Notes |
|---|---|
| `logs` | buffered `log.entryAdded`, filter by level/text/source, limit |
| `clear` | clear buffer |

### 3.12 `observe`

| Action | Notes |
|---|---|
| `console` | alias to `console.logs` with a combined window |
| `network` | summary of buffered requests |
| `request` | full request/response by request ID |
| `downloads` | download events/files |
| `clear` | clear console/network/download buffers |

### 3.13 `context`

| Action | BiDi |
|---|---|
| `create` | `browser.createUserContext` |
| `list` | `browser.getUserContexts` + tab counts |
| `remove` | `browser.removeUserContext` |
| `info` | user context + tabs + storage isolation notes |

### 3.14 `extensions`

| Action | BiDi |
|---|---|
| `install` | `webExtension.install`; **gated**, path allowlist |
| `uninstall` | `webExtension.uninstall`; **gated** |
| `list` | `webExtension.moz:listExtensions` |

### 3.15 `devtools`

| Action | BiDi |
|---|---|
| `debugEnable` | `moz:debugging.setDebuggerEnabled` |
| `scripts` | `moz:debugging.listScripts` |
| `source` | `moz:debugging.getScriptSource` |
| `breakpointSet` / `breakpointRemove` | `moz:debugging.setBreakpoint` / `removeBreakpoint` |
| `resume` | `moz:debugging.resume` |
| `stepOver` / `stepInto` / `stepOut` | `moz:debugging.*` |
| `debugState` | latest `paused`/`resumed` event |
| `profilerStatus` | `moz:profiler.isActive` |
| `profilerStart` | `moz:profiler.start` |
| `profilerStop` | `moz:profiler.stop`; return profile path/resource |

### 3.16 `cleanup`

| Action | Notes |
|---|---|
| `status` | connection, session, buffers, temp usage |
| `disconnect` | close WebSocket + `session.end`; do not close browser |
| `reset` | clear server state, buffers, caches |
| `temp` | list/delete server temp files |

## 4. Toolsets and gating

| Toolset | Tools | Default |
|---|---|---|
| `core` | ping, browser, tabs, page, script, interact, form, console, observe, cleanup | ✅ |
| `network` | + network, storage, emulate, context | opt-in |
| `devtools` | + extensions, devtools | opt-in |
| `all` | all 16 | opt-in |

`BIDI_TOOLSET=core|network|devtools|all`. Extension install also requires
`BIDI_ALLOW_EXTENSION_INSTALL=1` and a path under `BIDI_EXTENSION_ROOT`.
`browser.close` requires `BIDI_ALLOW_BROWSER_CLOSE=1`.

Rationale: default surface stays small and safe; advanced Firefox features are
one env var away.

## 5. Annotations

Action-based tools have mixed semantics. Be conservative:

| Tool | `readOnlyHint` | `destructiveHint` | `openWorldHint` |
|---|---|---|---|
| ping | true | false | false |
| browser | false | true (close/window state) | false |
| tabs | false | true (close) | false |
| page | false | false | true |
| script | false | false | true |
| interact | false | true (submit/navigate side effects) | true |
| form | false | true (submit) | true |
| network | false | true (mock/fail) | true |
| storage | false | true (delete/clear) | true |
| emulate | false | false | true |
| console | true | false | false |
| observe | true | false | false |
| context | false | true (remove) | false |
| extensions | false | true (install/uninstall) | false |
| devtools | false | true (breakpoints/profiler) | true |
| cleanup | false | true (temp/reset) | false |

The annotation is a hint, not a permission system. Document the destructive
actions in the description and return explicit warnings.

## 6. Structured output

Preferred shape:

```json
{
  "ok": true,
  "action": "snapshot",
  "data": { "...": "..." },
  "warnings": []
}
```

On failure:

```json
{
  "ok": false,
  "action": "click",
  "error": {
    "code": "ELEMENT_NOT_ACTIONABLE",
    "message": "Element is covered by another element.",
    "fix": "Use page.snapshot and target uid=12, or close the cookie banner."
  }
}
```

`outputSchema`:

- Strict for `ping`, `browser.status`, `tabs.list`, `page.snapshot`,
  `console.logs`, `network.list`, `context.list`, `extensions.list`,
  `devtools.profilerStatus`.
- Loose object schema for mixed-action tools (`data: object`), with runtime
  validation per action.
- Always include a serialized JSON text block for clients that do not consume
  `structuredContent`.
- Large payloads return a `resource_link` / file path and a short preview.

## 7. Progress and cancellation

- `page.snapshot`, `interact.waitFor`, `page.goto(wait=complete)`, and
  `page.print` can emit progress notifications every 500ms.
- Respect `notifications/cancelled`; abort waits and close temp files.
- Do not leave Firefox in a paused state after a cancelled debug action.
- Screencast is the only long-running action; if it cannot be made
  cancellation-safe, defer it to v0.5+.

## 8. Security notes for the tool surface

- Page content is untrusted. Snapshot text can contain prompt injection.
- Tool annotations are untrusted per MCP; enforce server-side policy.
- Extension install from an arbitrary path is code execution. Path allowlist
  and explicit opt-in are mandatory.
- `script.evaluate` is arbitrary code in the page; it is powerful but not
  privileged browser code.
- Debugger/profiler output can contain secrets, tokens, and PII. Keep profiles
  on disk and return paths, not inline blobs.
- Default to localhost; refuse non-loopback `BIDI_WS_URL` unless
  `BIDI_ALLOW_REMOTE=1`.

## 9. Sources

- [MCP specification 2026-07-28 — tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [MCP 2026-07-28 release notes](https://blog.modelcontextprotocol.io/posts/2026-07-28-spec-ga/)
- [MCP roadmap](https://modelcontextprotocol.io/development/roadmap)
- [`@modelcontextprotocol/sdk` 1.32.1](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
