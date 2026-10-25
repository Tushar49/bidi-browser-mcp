# Firefox BiDi in 2026 — Surface, Discovery, Sessions, Gaps

**Status:** research. **Date:** 2026-10-21. **Verified against:** Firefox 158.0
official win64 build, source tag `FIREFOX_158_0_RELEASE`, W3C WebDriver BiDi
Working Draft 2026-10-08.

## 1. Version and protocol state

| Fact | Value |
|---|---|
| Firefox stable | **158.x** (158.0 released 2026-10-13; 158.0.1 patch exists) |
| Next | 159, due 2026-10-27 |
| Cadence | **two weeks** starting with 155 |
| Current ESR | **153** (140 is end-of-life as of 157) |
| BiDi native since | Firefox 129 (Aug 2024) |
| CDP | removed in Firefox 141 (July 2025) |
| W3C BiDi spec | Working Draft, 2026-10-08 |
| Spec modules | 10: session, browser, browsingContext, emulation, input, log, network, script, storage, webExtension |
| Spec surface | ~65 commands, 24 core events |
| Firefox 158 surface | ~70 commands, 26 events, including `permissions` and vendor modules |

Firefox 158 is the first release where the old July 2026 research is clearly
stale: debugger, profiler, screencast, timezone/UA/offline emulation, file
dialogs, wheel input, and permissions are all real.

## 2. Transport and discovery

### 2.1 Starting the Remote Agent

```bash
firefox --remote-debugging-port=9222
# optional: --remote-debugging-port=0  -> ephemeral port
```

The Remote Agent serves WebDriver BiDi at:

```text
ws://127.0.0.1:9222/session
```

There is **no CDP-style `/json/version` contract**. Do not port the CDP
discovery logic. Firefox writes a discovery file into the active profile:

```json
{
  "ws_host": "127.0.0.1",
  "ws_port": 61735
}
```

Path: `<profileDir>/WebDriverBiDiServer.json`. The file is written when BiDi
starts and removed on a clean stop. A crashed Firefox can leave a stale file, so
always probe the TCP/WebSocket endpoint after reading it.

### 2.2 Discovery candidates

Ordered strategy for the server:

1. `BIDI_WS_URL` — explicit override; highest priority.
2. `BIDI_PROFILE_DIR` — read `WebDriverBiDiServer.json` from that profile.
3. Known profile roots:
   - Windows: `%APPDATA%\Mozilla\Firefox\Profiles\*`
   - macOS: `~/Library/Application Support/Firefox/Profiles/*`
   - Linux: `~/.mozilla/firefox/*`
   - portable builds: `<install>/Data/profile` and custom `-profile` paths
4. Parse `profiles.ini` for profile paths instead of assuming directory names.
5. Running process command lines with `--remote-debugging-port=...`; read-only
   and only used as a fallback.
6. Optional port scan on `9222–9232` with a WebSocket handshake and
   `session.status`; only for fallback/diagnostics, never the primary path.

The discovery file gives the actual port when `--remote-debugging-port=0` is
used. It does not give the browser version; `session.new` capabilities do.

### 2.3 HTTP security

The Remote Agent is a local debugging server. Defaults are localhost-only.
Relevant flags:

- `--remote-allow-hosts <hosts>` — `Host` header allowlist.
- `--remote-allow-origins <origins>` — `Origin` header allowlist.
- `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1` — privileged/system access; never set this
  for the public MCP server.

The MCP server connects to localhost by default. Remote hosts are opt-in and
must be documented as unsafe.

## 3. Session model

### 3.1 One session, one client

Firefox allows **one active BiDi session**. The server must:

- open one WebSocket to `/session`;
- call `session.new` once;
- reuse the session for every tool call;
- never create a session per tab or per request;
- never close the user's browser on disconnect.

Observed behavior:

```text
session.status before session.new -> { ready: true, message: "" }
session.new                        -> sessionId + capabilities
session.status after session.new  -> { ready: false, message: "Session already started" }
```

A second client calling `session.new` gets a "Maximum number active sessions"
error. There is no takeover command. The correct product behavior is an
actionable error that tells the user another BiDi client is attached and which
process/port to detach, not a retry loop.

### 3.2 Session capabilities

Verified on Firefox 158.0:

```json
{
  "browserName": "firefox",
  "browserVersion": "158.0",
  "platformName": "windows",
  "acceptInsecureCerts": false,
  "setWindowRect": true,
  "userAgent": "Mozilla/5.0 ... Firefox/158.0",
  "moz:buildID": "20261007201254",
  "moz:headless": true,
  "moz:platformVersion": "10.0",
  "moz:processID": 3216,
  "moz:profile": "C:\\...\\ffprofile",
  "moz:shutdownTimeout": 60000
}
```

Use `moz:profile` to correlate the session with the discovered profile. Use
`moz:processID` only for diagnostics; do not kill processes without explicit
user action.

### 3.3 Firefox strictness quirks (verified live on Zen 1.23.4b / Firefox 158.0)

Firefox's BiDi implementation asserts fields the spec marks optional. Send them
explicitly:

- `session.new` requires `params.capabilities` (object); `{}` is fine. Sending
  `{}` as params fails with `invalid argument` / "Expected capabilities to be
  an object".
- `script.evaluate` requires `awaitPromise` (boolean); omitting it fails with
  "Expected awaitPromise to be a boolean".
- `session.subscribe` rejects unknown event names and fails the whole
  subscription: `browsingContext.urlChanged` is not a valid event on Firefox
  158 ("not a valid event name"). Only subscribe to events the target build
  supports; unknown events must never break a connect.
- Error frames follow the spec shape: `error` is a flat string code (e.g.
  `"session not created"`, `"invalid argument"`, `"invalid session id"`),
  `message` is a sibling string, plus a `stacktrace`. There is no nested
  `{code, message}` object.
- The one-session conflict is `error: "session not created"` with message
  "Maximum number of active sessions"; a ready:false `session.status` reports
  "Session already started".
- A session is bound to its WebSocket connection. If the client dies without
  `session.end`, the session stays active in the browser; a new connection
  cannot `session.end` it (`invalid session id`). Recovery is a browser
  restart. The server must therefore always `session.end` on shutdown.

### 3.4 Containers and Zen spaces (verified live on Zen 1.23.4b / Firefox 158.0)

- Containers are exposed over BiDi as **uuids**: `browser.getUserContexts`
  (`[{userContext: 'default'}, {userContext: uuid}...]`),
  `browser.createUserContext`, `browser.removeUserContext`. The integer ids in
  `containers.json` are internal; there is no direct id bridge.
- `browsingContext.create` accepts `userContext`; `browsingContext.getTree`
  entries carry `userContext`.
- Name join is **positional**: `getUserContexts` lists public containers in
  internal-id order (verified: a freshly created container appends last, and
  gets the next id in `containers.json`). The `default` context has no
  containers.json identity. Containers.json is written lazily by the browser;
  BiDi is the live truth.
- A freshly created tab's `getTree` URL is `about:blank` until navigation
  commits; the create response echoes the requested URL.
- Zen spaces live in the profile session store (`zen-sessions.jsonlz4`,
  mozLz4): `{"uuid":"{...}","name":"...","theme":{...},"containerTabId":N}` —
  `containerTabId` is the bound container's integer id. Window state carries
  `zenWorkspace` (active space). `zen-space-routing.jsonlz4` holds URL→space
  rules; `zen-spaces-sync.json` maps container ids to space sync uuids. No API
  exposes per-tab space membership; space listing is read-only.

### 3.3 `navigator.webdriver` is true

Verified on Firefox 158 headless with `--remote-debugging-port` and **no**
Marionette:

```js
navigator.webdriver === true
```

**Plain language:** Firefox sets a JavaScript flag that says "this browser is
being controlled by automation." Any website can read it. The flag is true
whenever the Remote Agent is enabled, even if Marionette is off. It is not a
bug in our server, and hiding it is not a feature. Sites may show a CAPTCHA or
block the session; that is expected.

This contradicts the common assumption that only Marionette sets it. The Remote
Agent's browser-automation flag is active when started from the command line.
Consequences:

- Do not claim stealth or anti-detection.
- Do not add `navigator.webdriver` spoofing; it is fragile and dishonest.
- Document that sites may challenge automated sessions.
- `remote.prefs.recommended=false` changes browser behavior but does **not**
  clear the WebDriver flag.

**Can the server switch it off with a config flag?** No. There is no BiDi
command that clears `navigator.webdriver`. Firefox sets it when the Remote Agent
starts. The only code-level ways are:

1. a preload script that redefines `Navigator.prototype.webdriver` before page
   scripts run — opt-in spoofing, detectable, and against this project's policy;
2. a patched browser (Playwright/Juggler/Camoufox) — breaks attach-only direct
   BiDi.

Neither is planned. A config flag can only document or gate behavior; it cannot
make Firefox unset the flag.

### 3.4 Remote Agent and profile preferences

Starting Firefox with `--remote-debugging-port` enables the Remote Agent.
Mozilla's security model is explicit: **there is no supported browser-side toggle**
to start the listener. `remote.enabled` was removed in Firefox 89. Current
remote prefs (`remote.force-local`, `remote.prefs.recommended`,
`remote.experimental.enabled`) tune behavior, but none of them starts the
agent. `about:debugging` is a DevTools client UI, not a BiDi switch.

Mozilla's `RecommendedPreferences` module applies a set of automation
preferences (Telemetry off, update checks off, first-run UX suppressed, focus and
throttling changes). Key facts from Mozilla source and docs:

- `remote.prefs.recommended` defaults to `true`; set it to `false` before start
  to skip the recommended set.
- The recommended preferences are set on the **default branch**, so they are
  **not written to `prefs.js`** and last only until the process fully exits.
- A **user preference always wins** over a recommended value.
- Geckodriver additionally writes prefs to the profile **before** launch
  (`prefs.rs`); we do not use geckodriver, so that path does not apply to us.
- The `--remote-debugging-port` flag itself performs startup work; review the
  profile after use if it holds data you cannot lose.

Consequences for the product:

- The server itself must never write prefs or profiles. Attach-only means
  read-only on the profile from our side.
- Process-based discovery is the fallback when the profile file is missing; it
  must never relaunch or mutate the browser.
- Document `remote.prefs.recommended=false` for users who want a closer-to-normal
  browser session. If they set it, it must be in the profile or launch args
  **before** Firefox starts.
- Do not promise "zero profile impact"; promise "the server writes nothing."

## 4. Firefox 158 module matrix

Legend: ✅ available, ⚠️ partial/quirky, ❌ absent.

### 4.1 session

| Command | Status | Notes |
|---|---|---|
| `session.status` | ✅ | Works before and after `session.new` |
| `session.new` | ✅ | One only |
| `session.end` | ✅ | Ends session; does not close browser |
| `session.subscribe` | ✅ | Events + contexts/userContexts |
| `session.unsubscribe` | ✅ | — |

### 4.2 browser

| Command | Status | Notes |
|---|---|---|
| `browser.close` | ✅ | Destructive; do not expose by default |
| `browser.createUserContext` | ✅ | Containers/isolated storage |
| `browser.getUserContexts` | ✅ | Returns opaque IDs, not container names |
| `browser.removeUserContext` | ✅ | Closes its tabs |
| `browser.getClientWindows` | ✅ | Window IDs + states |
| `browser.setClientWindowState` | ✅ | minimize/maximize/fullscreen/normal |
| `browser.setDownloadBehavior` | ✅ | `allowed` requires `destinationFolder` since 157 |

Probe note: a fresh profile returned `default` plus four extra user-context IDs.
Do not assume "one user context = one visible container"; IDs are opaque and
Firefox may pre-create contexts.

### 4.3 browsingContext

| Command | Status | Notes |
|---|---|---|
| `activate` | ✅ | Top-level only |
| `captureScreenshot` | ✅ | `format`, `clip` (box/element), `origin`, `imageSize` (158+) |
| `close` | ✅ | `promptUnload` option |
| `create` | ✅ | `type: tab/window`, `userContext`, `referenceContext` |
| `getTree` | ✅ | `maxDepth`; includes `userContext`, `clientWindow` |
| `handleUserPrompt` | ✅ | alert/confirm/prompt/beforeunload |
| `locateNodes` | ✅ | `css`, `xpath`, `innerText`, `accessibility`, `context` |
| `navigate` | ✅ | `wait: none/interactive/complete` |
| `print` | ✅ | PDF options; returns base64 |
| `reload` | ✅ | `ignoreCache` |
| `setViewport` | ✅ | viewport + devicePixelRatio; lives here, not emulation |
| `startScreencast` | ✅ | 154+; `destinationFolder` 158+ |
| `stopScreencast` | ✅ | returns recording path/details |
| `traverseHistory` | ✅ | delta |
| `setBypassCSP` | ❌ | In spec, not in 158 |

Events: `contextCreated`, `contextDestroyed`, `navigationStarted`,
`navigationCommitted`, `navigationAborted`, `navigationFailed`,
`fragmentNavigated`, `historyUpdated`, `domContentLoaded`, `load`,
`downloadWillBegin`, `downloadEnd`, `userPromptOpened`, `userPromptClosed`.

### 4.4 emulation

| Command | Status | Notes |
|---|---|---|
| `setGeolocationOverride` | ✅ | — |
| `setLocaleOverride` | ✅ | — |
| `setNetworkConditions` | ⚠️ | **Offline only** in 158 |
| `setScreenOrientationOverride` | ✅ | — |
| `setScreenSettingsOverride` | ✅ | screen width/height |
| `setTimezoneOverride` | ✅ | Verified `America/New_York` |
| `setUserAgentOverride` | ✅ | Verified custom UA |
| `setMediaFeaturesOverride` | ❌ | In main/159+, not 158 |
| `setForcedColorsModeThemeOverride` | ❌ | Spec only |
| `setScriptingEnabled` | ❌ | Spec only |
| `setScrollbarTypeOverride` | ❌ | Spec only |
| `setTextLayoutModeOverride` | ❌ | Spec only |
| `setTouchOverride` | ❌ | Spec only |
| `setViewportMetaOverride` | ❌ | Spec only |

No CPU throttling and no bandwidth/latency emulation beyond offline.

### 4.5 input

| Command | Status | Notes |
|---|---|---|
| `performActions` | ✅ | Pointer, key, wheel, touch pointer type |
| `releaseActions` | ✅ | — |
| `setFiles` | ✅ | Requires a node reference (`sharedId`) |

Event: `input.fileDialogOpened`. This is useful for native file choosers but
needs a policy: the server can auto-cancel and tell the agent to use
`input.setFiles`.

### 4.6 network

| Command | Status | Notes |
|---|---|---|
| `addIntercept` | ✅ | Phases: beforeRequestSent, responseStarted, authRequired |
| `removeIntercept` | ✅ | — |
| `continueRequest` | ✅ | URL/method/headers/body modifications |
| `continueResponse` | ✅ | Status/headers/body |
| `continueWithAuth` | ✅ | Credentials or cancel |
| `failRequest` | ✅ | — |
| `provideResponse` | ✅ | Mock response |
| `setCacheBehavior` | ✅ | — |
| `setExtraHeaders` | ✅ | Header values are BiDi `BytesValue` objects |
| `addDataCollector` | ✅ | Response bodies/data |
| `getData` | ✅ | — |
| `disownData` | ✅ | — |
| `removeDataCollector` | ✅ | — |

Events: `authRequired`, `beforeRequestSent`, `responseStarted`,
`responseCompleted`, `fetchError`.

This is enough for mock/modify/block/auth and response-body capture. It is not a
full CDP Network domain: no WebSocket frame events, no resource-type
classification guarantees, and response body collection has memory costs.

### 4.7 script

| Command | Status | Notes |
|---|---|---|
| `evaluate` | ✅ | `awaitPromise`, `resultOwnership`, `serializationOptions` |
| `callFunction` | ✅ | Best for passing node references |
| `getRealms` | ✅ | window, worker, worklet realms |
| `addPreloadScript` | ✅ | contexts/userContexts/sandbox |
| `removePreloadScript` | ✅ | — |
| `disown` | ✅ | Release handles |

Events: `realmCreated`, `realmDestroyed`, `script.message` (channel arguments).

`script.message` + channel arguments enable a page→server channel without
polling. Useful for long-running page instrumentation, not needed for v1.

### 4.8 storage

`getCookies`, `setCookie`, `deleteCookies` with partition/user-context support.

No direct localStorage/sessionStorage/IndexedDB commands. Use `script.evaluate`
for those; document the limitation.

### 4.9 permissions

`permissions.setPermission` with `{ descriptor, state, origin, userContext? }`.
Firefox 158 added `camera` and `microphone`; geolocation worked in the probe.
This is the correct way to unblock media/geolocation flows without clicking
browser chrome.

### 4.10 webExtension

| Command | Status | Notes |
|---|---|---|
| `webExtension.install` | ✅ | `path`, `archivePath`, or base64; `moz:permanent`, `moz:allowPrivateBrowsing` |
| `webExtension.uninstall` | ✅ | — |
| `webExtension.moz:listExtensions` | ✅ | Firefox vendor command; non-hidden extensions |

This is a real differentiator for testing with uBlock Origin or a user's
existing extensions. It is also dangerous: installing arbitrary extensions can
execute privileged code. Gate it behind an explicit opt-in and a path allowlist.

### 4.11 log

`log.entryAdded` — console messages and JavaScript errors with level, text,
timestamp, source, stack trace. This is the primary console source.

### 4.12 vendor: `moz:debugging`

Available in Firefox 153+.

| Command | Notes |
|---|---|
| `setDebuggerEnabled` | Global/context/user-context |
| `listScripts` | Script URLs for a context |
| `getScriptSource` | Source for a loaded script |
| `setBreakpoint` | URL/line/column |
| `removeBreakpoint` | — |
| `resume` | — |
| `stepOver` / `stepInto` / `stepOut` | — |

Events: `moz:debugging.paused`, `moz:debugging.resumed`.

This gives a real JavaScript debugger surface: breakpoints, stepping, script
source, and pause events. It is Firefox-only and not part of W3C BiDi. It does
not provide CDP's full call-stack/evaluate-on-frame workflow in the public MCP
surface yet; the plan should treat it as an advanced, opt-in tool.

### 4.13 vendor: `moz:profiler`

Available in Firefox 154+.

| Command | Notes |
|---|---|
| `moz:profiler.isActive` | `{ active: boolean }` |
| `moz:profiler.start` | Preset or explicit entries/interval/features/threads |
| `moz:profiler.stop` | Writes `profile-<uuid>.json` to the download directory; returns path |

This is a Gecko profiler, not CDP `Performance`/`HeapProfiler`. It gives CPU
samples, threads, and features; it does not give DOM/CSS metrics or heap
snapshots. The profile file can be large and sensitive; return a path/resource
link, not inline JSON.

## 5. What is still missing or weak

| Capability | State | Product consequence |
|---|---|---|
| Full accessibility tree | ❌ no AX-tree command | Snapshot via DOM; `locateNodes(accessibility)` for resolution |
| CSS domain / computed styles at scale | ❌ | Use `getComputedStyle` selectively |
| Memory heap snapshots | ❌ | Not a DevTools replacement |
| CPU/network throttling | ❌/⚠️ | Offline only; no latency/bandwidth/CPU |
| `setBypassCSP` | ❌ in 158 | Don't promise CSP bypass |
| WebSocket frame inspection | ❌ | Network tool covers HTTP only |
| Storage commands beyond cookies | ❌ | JS fallback |
| Cross-browser | ❌ | Firefox-only by design |
| Multiple BiDi clients | ❌ | Exclusive attach; actionable conflict error |
| Stealth | ❌ `navigator.webdriver=true` | Don't market it |

## 6. Version support recommendation

- **Core (connect, tabs, navigate, script, screenshot, snapshot, basic input):**
  Firefox 129+.
- **Recommended baseline:** Firefox 153 ESR for core + debugger; **158 stable**
  for the full surface. 154 adds the profiler and screencast; 158 adds
  camera/mic permissions, `imageSize`, and `destinationFolder`.
- **Full surface:** Firefox 158+.
- Feature-detect vendor/optional commands. Never fail the whole server because
  `moz:debugging`, `moz:profiler`, or screencast is absent.

## 7. Sources

- [W3C WebDriver BiDi Working Draft](https://www.w3.org/TR/webdriver-bidi/)
- [MDN BiDi modules](https://developer.mozilla.org/en-US/docs/Web/WebDriver/Reference/BiDi/Modules)
- [Firefox 158 developer release notes](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/158)
- [Firefox WebDriver Newsletter 158](https://fxdx.dev/firefox-webdriver-newsletter-158/)
- [Firefox source, tag FIREFOX_158_0_RELEASE](https://github.com/mozilla-firefox/firefox/tree/FIREFOX_158_0_RELEASE/remote/webdriver-bidi)
- [Firefox Remote Protocols docs](https://firefox-source-docs.mozilla.org/remote/)
- [Firefox Remote protocol preferences](https://firefox-source-docs.mozilla.org/remote/Prefs.html)
- [Firefox Remote Agent security](https://firefox-source-docs.mozilla.org/remote/Security.html)
