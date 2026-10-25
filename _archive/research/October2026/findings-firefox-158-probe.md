# Findings — Firefox 158.0 Runtime Probe

**Date:** 2026-10-21. **Browser:** official Mozilla Firefox 158.0 win64 build
(release channel), extracted from the official installer. **Mode:** headless,
fresh profile, `--remote-debugging-port=0`, no Marionette, no extensions.

This is ground truth for the plan, not a product test. The probe connected
directly to `/session` over `ws` and issued raw BiDi commands.

## 1. Startup and discovery

```text
firefox.exe --headless --remote-debugging-port=0 --profile <fresh> -no-remote about:blank
```

Resulting `<profile>/WebDriverBiDiServer.json`:

```json
{
  "ws_host": "127.0.0.1",
  "ws_port": 61735
}
```

The WebSocket URL was `ws://127.0.0.1:61735/session`. No `/json/version` was
needed or used.

## 2. Session

| Probe | Result |
|---|---|
| `session.status` before `session.new` | `{ ready: true, message: "" }` |
| `session.new` | success, session ID returned |
| `session.status` after `session.new` | `{ ready: false, message: "Session already started" }` |
| `session.end` | success |

Capabilities:

```json
{
  "acceptInsecureCerts": false,
  "browserName": "firefox",
  "browserVersion": "158.0",
  "platformName": "windows",
  "setWindowRect": true,
  "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:158.0) Gecko/20100101 Firefox/158.0",
  "moz:buildID": "20261007201254",
  "moz:headless": true,
  "moz:platformVersion": "10.0",
  "moz:processID": 3216,
  "moz:profile": "C:\\...\\ffprofile",
  "moz:shutdownTimeout": 60000
}
```

Only one session is allowed. The server must reuse it.

## 3. WebDriver flag

Evaluated in the page:

```js
navigator.webdriver === true
```

No Marionette was enabled. `--remote-debugging-port` alone is enough. This is a
product-positioning fact, not a bug to work around.

## 4. Core browsing

| Probe | Result |
|---|---|
| `browsingContext.getTree` | one top-level `about:blank` context, `userContext: "default"` |
| `browsingContext.setViewport` | success (1024×768, DPR 1) |
| `browsingContext.create` with `userContext` | success, tab created in the new context |
| `browsingContext.navigate` to a `data:` URL, `wait: complete` | success |
| `browsingContext.captureScreenshot` with `imageSize` 320×240 | success, PNG base64 |
| `browsingContext.print` | success, PDF base64 |
| `browsingContext.locateNodes` accessibility | success; found `<button aria-label="Click me">` with `sharedId` |
| `browsingContext.locateNodes` innerText | failed with `undefined: undefined` in this probe; likely a 158 bug/edge case. Use CSS/accessibility first. |
| `input.performActions` pointer click | success; page `click` handler fired |
| `script.callFunction` with `sharedId` | success; returned the element rect |
| `emulation.setUserAgentOverride` | success; `navigator.userAgent` changed |
| `emulation.setTimezoneOverride` | success; `Intl.DateTimeFormat` reported `America/New_York` |
| `emulation.setNetworkConditions` offline/reset | success |
| `permissions.setPermission` geolocation granted | success |

## 5. Contexts and storage isolation

`browser.createUserContext` returned an opaque ID. A tab created in it navigated
and interacted normally.

`browser.getUserContexts` on a fresh profile returned `default` plus four extra
opaque contexts. Do not assume a one-to-one mapping between user contexts and
visible named containers. Treat IDs as opaque; expose names only if a future
Firefox API provides them.

## 6. Network

| Probe | Result |
|---|---|
| `network.addIntercept` / `removeIntercept` | success |
| `network.setExtraHeaders` with plain string values | failed; header values are BiDi `BytesValue` objects, so the probe payload was wrong |
| `network.getData` / data collectors | not exercised |

Interception is present. The plan must add a request/response buffer and a
correct BytesValue serializer.

## 7. DevTools extensions

| Probe | Result |
|---|---|
| `moz:profiler.isActive` | `{ active: false }` |
| `moz:debugging.setDebuggerEnabled({ enabled: true })` | success |
| `webExtension.moz:listExtensions` | `{ extensions: [] }` |

These vendor modules are available on a stock release build; no special pref was
set. The public MCP surface should still treat them as optional/version-gated.

## 8. Events

No events were subscribed in this probe (`eventCount: 0`). Event behavior is
covered by source read and must be verified in integration tests:

- `browsingContext.*`
- `log.entryAdded`
- `network.*`
- `input.fileDialogOpened`
- `moz:debugging.paused/resumed`

## 9. Plan implications

1. Discovery must use the profile JSON file.
2. Session conflict handling is mandatory.
3. `navigator.webdriver` must be documented honestly.
4. `sharedId` from `locateNodes` is a viable UID resolver; screenshot/print
   work with modern arguments.
5. Accessibility locator is useful; innerText locator is not reliable in 158.
6. `moz:debugging`, `moz:profiler`, and extension listing are real; gate them.
7. Network header serialization needs its own tested helper.
8. User context IDs are opaque and may include pre-existing contexts.

## 10. Reproduction notes

- Use an official Firefox 158.0 build, a fresh profile, and a non-default port.
- Do not use the user's normal profile for probes.
- `--remote-debugging-port=0` writes the actual port to
  `WebDriverBiDiServer.json`.
- Stop the probe browser process after `session.end`; ending a session does not
  close Firefox.
