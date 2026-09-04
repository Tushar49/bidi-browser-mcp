# WebDriver BiDi API Reference — Complete Module/Command/Event Catalog

> Full reference based on [W3C WebDriver BiDi Working Draft](https://www.w3.org/TR/webdriver-bidi/) (July 2, 2025). Editors: James Graham (Mozilla), Alex Rudenko (Google), Maksim Sadym (Google).

## Module Overview

| # | Module | Commands | Events | CDP Equivalent | Playwright Equivalent |
|---|--------|----------|--------|----------------|----------------------|
| 7.1 | **session** | 5 | 0 | (connection-level) | browser.newContext() |
| 7.2 | **browser** | 6 | 0 | Browser.* | browser.* |
| 7.3 | **browsingContext** | 12 | 14 | Page.*, Target.* | page.* |
| 7.4 | **emulation** | 3 | 0 | Emulation.* | context.setGeolocation() |
| 7.5 | **network** | 12 | 5 | Network.*, Fetch.* | page.route() |
| 7.6 | **script** | 6 | 3 | Runtime.*, Debugger.* | page.evaluate() |
| 7.7 | **storage** | 3 | 0 | Storage.*, Network.* | context.cookies() |
| 7.8 | **log** | 0 | 1 | Console.* | page.on('"'"'console'"'"') |
| 7.9 | **input** | 3 | 1 | Input.* | page.click(), page.fill() |
| 7.10 | **webExtension** | 2 | 0 | -- (Chrome extensions API) | -- |

**Total**: 52 commands + 24 events = **76 protocol methods**

## Module-by-Module Reference

### 7.1 session Module

BiDi sessions must be created explicitly (unlike CDP where connection = session).

| Command | Parameters | Returns | Description |
|---------|-----------|---------|-------------|
| `session.status` | -- | `{ ready, message }` | Check if session is ready |
| `session.new` | `{ capabilities }` | `{ sessionId, capabilities }` | Create a new BiDi session |
| `session.end` | -- | -- | End the session |
| `session.subscribe` | `{ events, contexts? }` | -- | Subscribe to events |
| `session.unsubscribe` | `{ events, contexts? }` | -- | Unsubscribe from events |

**CDP equivalent**: CDP auto-creates session on WebSocket connect. No explicit `session.new` needed.

**Important**: Firefox allows only **one active BiDi session at a time**. The `firefox-bidi-mcp` server manages this lifecycle explicitly.

### 7.2 browser Module

| Command | Parameters | Returns | Description |
|---------|-----------|---------|-------------|
| `browser.close` | -- | -- | Close the browser |
| `browser.createUserContext` | -- | `{ userContext }` | Create isolated user context |
| `browser.getClientWindows` | -- | `{ clientWindows }` | Get all browser windows |
| `browser.getUserContexts` | -- | `{ userContexts }` | Get all user contexts |
| `browser.removeUserContext` | `{ userContext }` | -- | Remove a user context |
| `browser.setClientWindowState` | `{ clientWindow, state }` | -- | Minimize/maximize/fullscreen window |

**CDP equivalent**: `Browser.getWindowBounds`, `Browser.getWindowForTarget`, `Target.createBrowserContext`, `Target.disposeBrowserContext`.

**User Contexts** = Firefox Containers = Chrome BrowserContext. Isolated storage (cookies, cache, localStorage) per context.

### 7.3 browsingContext Module (Most Important)

This is the BiDi equivalent of CDP'"'"'s `Page`, `Target`, and parts of `DOM` domains.

| Command | Parameters | Returns | Description |
|---------|-----------|---------|-------------|
| `browsingContext.activate` | `{ context }` | -- | Bring tab to foreground |
| `browsingContext.captureScreenshot` | `{ context, format?, clip? }` | `{ data }` | Take screenshot (PNG/JPEG) |
| `browsingContext.close` | `{ context }` | -- | Close a tab/context |
| `browsingContext.create` | `{ type, referenceContext?, userContext? }` | `{ context }` | Create new tab or window |
| `browsingContext.getTree` | `{ maxDepth? }` | `{ contexts }` | Get all browsing contexts (tabs) |
| `browsingContext.handleUserPrompt` | `{ context, accept?, userText? }` | -- | Dismiss alert/confirm/prompt |
| `browsingContext.locateNodes` | `{ context, locator, maxNodeCount? }` | `{ nodes }` | Find DOM nodes by locator |
| `browsingContext.navigate` | `{ context, url, wait? }` | `{ navigation, url }` | Navigate to URL |
| `browsingContext.print` | `{ context, options? }` | `{ data }` | Print page to PDF |
| `browsingContext.reload` | `{ context, ignoreCache? }` | `{ navigation }` | Reload page |
| `browsingContext.setViewport` | `{ context, viewport?, devicePixelRatio? }` | -- | Set viewport size and DPR |
| `browsingContext.traverseHistory` | `{ context, delta }` | -- | Go back/forward |

**Events** (14): contextCreated, contextDestroyed, navigationStarted, fragmentNavigated, historyUpdated, domContentLoaded, load, downloadWillBegin, downloadEnd, navigationAborted, navigationCommitted, navigationFailed, userPromptClosed, userPromptOpened

**CDP equivalent comparison**:

| BiDi | CDP |
|------|-----|
| `browsingContext.navigate` | `Page.navigate` |
| `browsingContext.reload` | `Page.reload` |
| `browsingContext.captureScreenshot` | `Page.captureScreenshot` |
| `browsingContext.print` | `Page.printToPDF` |
| `browsingContext.setViewport` | `Emulation.setDeviceMetricsOverride` |
| `browsingContext.getTree` | `Target.getTargets` |
| `browsingContext.create` | `Target.createTarget` |
| `browsingContext.close` | `Target.closeTarget` |
| `browsingContext.activate` | `Target.activateTarget` |
| `browsingContext.handleUserPrompt` | `Page.handleJavaScriptDialog` |
| `browsingContext.locateNodes` | No direct CDP equivalent (use JS) |
| `browsingContext.traverseHistory` | `Page.navigateToHistoryEntry` |

### 7.4 emulation Module

| Command | Parameters | Description |
|---------|-----------|-------------|
| `emulation.setGeolocationOverride` | `{ geolocation? }` | Override geolocation |
| `emulation.setLocaleOverride` | `{ locale? }` | Override browser locale |
| `emulation.setScreenOrientationOverride` | `{ orientation? }` | Override screen orientation |

**What CDP has that BiDi emulation lacks**: UserAgent override, touch emulation, CPU throttling, network throttling, vision deficiency, auto dark mode.

### 7.5 network Module

| Command | Description |
|---------|-------------|
| `network.addDataCollector` | Start collecting network data |
| `network.addIntercept` | Start intercepting requests |
| `network.continueRequest` | Resume a paused request |
| `network.continueResponse` | Resume a paused response |
| `network.continueWithAuth` | Provide auth credentials |
| `network.disownData` | Release ownership of network data |
| `network.failRequest` | Abort a request with error |
| `network.getData` | Retrieve collected network data |
| `network.provideResponse` | Provide a complete mock response |
| `network.removeDataCollector` | Stop collecting data |
| `network.removeIntercept` | Stop intercepting |
| `network.setCacheBehavior` | Control cache (bypass/cache) |

**Events**: authRequired, beforeRequestSent, fetchError, responseCompleted, responseStarted

### 7.6 script Module

| Command | Parameters | Description |
|---------|-----------|-------------|
| `script.addPreloadScript` | `{ functionDeclaration, arguments? }` | Inject script before any page JS |
| `script.callFunction` | `{ functionDeclaration, target, arguments?, ... }` | Call a function in a realm |
| `script.disown` | `{ handles, target }` | Release remote object handles |
| `script.evaluate` | `{ expression, target, awaitPromise?, ... }` | Evaluate JS expression |
| `script.getRealms` | `{ context? }` | List all JS execution realms |
| `script.removePreloadScript` | `{ preloadScript }` | Remove a preload script |

**CDP comparison**:
- `script.evaluate` = `Runtime.evaluate`
- `script.callFunction` = `Runtime.callFunctionOn`
- `script.getRealms` = `Runtime.executionContexts`
- `script.addPreloadScript` = `Page.addScriptToEvaluateOnNewDocument`
- **No BiDi equivalent**: No debugger (no breakpoints, no step, no call stack)

### 7.7 storage Module

| Command | Description |
|---------|-------------|
| `storage.getCookies` | Get cookies |
| `storage.setCookie` | Set a cookie |
| `storage.deleteCookies` | Delete cookies by filter |

### 7.8 log Module

| Event | Description |
|-------|-------------|
| `log.entryAdded` | Console log (level: debug/info/warn/error) |

### 7.9 input Module

| Command | Parameters | Description |
|---------|-----------|-------------|
| `input.performActions` | `{ context, actions }` | Perform input actions (key, pointer, wheel) |
| `input.releaseActions` | `{ context }` | Release all input actions |
| `input.setFiles` | `{ context, element, files }` | Set file input value |

**CDP equivalent**: `Input.dispatchKeyEvent`, `Input.dispatchMouseEvent`, `Input.dispatchTouchEvent`, `Input.dispatchWheelEvent`, `DOM.setFileInputFiles`.

### 7.10 webExtension Module

| Command | Parameters | Description |
|---------|-----------|-------------|
| `webExtension.install` | `{ extensionData? }` | Install a web extension |
| `webExtension.uninstall` | `{ extension }` | Uninstall a web extension |

**CDP equivalent**: No direct equivalent. Extensions are managed differently in Chromium.

## Feature Gap: CDP vs BiDi

| Feature | CDP | BiDi | Notes |
|---------|-----|------|-------|
| Navigation | Yes | Yes | |
| Screenshot | Yes | Yes | |
| PDF | Yes | Yes (print) | |
| Click/Type | Yes | Yes | BiDi uses action sequences |
| JavaScript evaluation | Yes | Yes | BiDi has preload scripts |
| Network interception | Yes | Yes | Both support mock/modify/block |
| Console logs | Yes | Yes | |
| Cookie management | Yes | Yes | |
| Viewport emulation | Yes | Yes | |
| Geolocation emulation | Yes | Yes | |
| User agent emulation | Yes | **No** | |
| Network throttling | Yes | **No** | |
| CPU throttling | Yes | **No** | |
| Touch emulation | Yes | **No** | |
| JavaScript debugger | Yes (full) | **No** | No breakpoints, stepping, call stack |
| Accessibility tree | Yes | **No** | Must use evaluate() + JS |
| Performance metrics | Yes | **No** | |
| Memory profiling | Yes | **No** | |
| CSS manipulation | Yes | **No** | |
| File upload | Yes | Yes (setFiles) | |
| Preload scripts | Yes | Yes | |
| User contexts | Yes | Yes | |
| Extensions management | **No** | Yes | BiDi can install/uninstall extensions |
| Dialogs | Yes | Yes | |
| Downloads | Yes | Yes | |

## Incognito Mode / Private Browsing

**CDP**: Create a new browser context with `Target.createBrowserContext`. New tabs in that context have isolated storage.

**BiDi**: Use `browser.createUserContext` which creates an isolated user context (equivalent to Firefox containers or Chrome incognito contexts):
```javascript
const uc = await bidiCall('"'"'browser.createUserContext'"'"', {});
const ctx = await bidiCall('"'"'browsingContext.create'"'"', {
  type: '"'"'tab'"'"',
  userContext: uc.userContext
});
```
