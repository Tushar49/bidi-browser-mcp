# Cross-Browser BiDi — What Is Universal, What Is Not

**Status:** research (2026-10-21). **Question:** can this server control Chrome,
Edge, Brave, and Safari through the same WebDriver BiDi surface?

## 1. Short answer

**BiDi is a W3C standard, not a universal implementation.**

- **Firefox** is the only browser where we can attach directly to the user's
  running browser over a native `/session` WebSocket with no driver process.
- **Chrome, Edge, and Brave** expose BiDi through **ChromeDriver/EdgeDriver**.
  The driver hosts the BiDi WebSocket and translates to CDP through
  `chromium-bidi`. It works, but it is a different architecture and requires a
  version-matched driver.
- **Safari** has partial WebKit BiDi work, but it is experimental and requires
  Safari Technology Preview; it is not a production target in 2026.

So: **same protocol family, different acquisition/transport, different command
coverage.** We should not promise "one BiDi server controls every browser"
without a backend layer and driver management.

## 2. Browser matrix

| Browser | Engine | BiDi path | Attach to running browser | Driver required | 2026 status |
|---|---|---|---|---|---|
| **Firefox 158** | Gecko | Native Remote Agent, `ws://host:port/session` | ✅ start with `--remote-debugging-port` | ❌ | Broad; best target |
| **Chrome** | Chromium | ChromeDriver BiDi server (`webSocketUrl: true`) | ⚠️ via ChromeDriver `debuggerAddress` | ✅ ChromeDriver | Broad, production-used; BiDi mapper over CDP |
| **Edge** | Chromium | EdgeDriver BiDi | ⚠️ via `debuggerAddress` | ✅ msedgedriver | Expected parity with Chrome; verify per version |
| **Brave** | Chromium | ChromeDriver BiDi with Brave binary/debug address | ⚠️ experimental | ✅ ChromeDriver | Works in practice; version/branding caveats |
| **Opera/Vivaldi** | Chromium | ChromeDriver BiDi | ⚠️ experimental | ✅ ChromeDriver | Untested; same caveats as Brave |
| **Safari** | WebKit | safaridriver BiDi (experimental) | ❌ / limited | ✅ safaridriver | Partial; Technology Preview; not production |
| **Firefox forks** (LibreWolf, Waterfox, Zen) | Gecko | Native Remote Agent | ✅ likely | ❌ | Untested; profile/branding differences |

### 2.1 Chrome/Chromium details

ChromeDriver implements both WebDriver Classic and BiDi. The BiDi
implementation is `chromium-bidi`, a JavaScript mapper that runs in a Chrome tab
and translates BiDi to CDP. It is not a browser-native `/session` endpoint.

Consequences:

- You need a ChromeDriver that matches the browser major version.
- `webSocketUrl: true` in capabilities returns a driver-hosted BiDi URL.
- `debuggerAddress` can attach ChromeDriver to an already-running Chrome that
  was started with `--remote-debugging-port`.
- Chrome extensions are managed through capabilities/options, not
  `webExtension.install`.
- Chrome has no `moz:*` modules. Debugger/profiler remain CDP features, not part
  of the Chrome BiDi surface.
- Brave adds Shields and its own update cadence; ChromeDriver compatibility is
  not guaranteed. Treat as best-effort.

### 2.2 Safari details

WebKit has a partial BiDi implementation (session, log, browsing context,
storage, permissions in progress). The server lives in `safaridriver`, not in
Safari. Selenium's SafariOptions marks BiDi as **experimental and requiring
Safari Technology Preview**. Safari 27's WebDriver work is about Digital
Credentials, not full BiDi. Do not ship Safari support as a promise.

## 3. Capability matrix (approximate)

Legend: ✅ first-class, ⚠️ partial/experimental, ❌ absent, ❓ unverified.

| Capability | Firefox 158 | Chromium via ChromeDriver | WebKit/Safari |
|---|---|---|---|
| Direct attach to running browser | ✅ native | ⚠️ `debuggerAddress` + driver | ❌ |
| No driver process | ✅ | ❌ | ❌ |
| Tabs/windows/tree | ✅ | ✅ | ✅ partial |
| Navigate/reload/history | ✅ | ✅ | ✅ partial |
| Screenshot | ✅ | ✅ | ✅ |
| PDF/print | ✅ | ✅ | ✅ |
| DOM snapshot via `script` | ✅ | ✅ | ✅ partial |
| Click/type/key/wheel | ✅ | ✅ | ⚠️ |
| File upload | ✅ | ✅ | ❓ |
| Console/log events | ✅ | ✅ | ✅ |
| Network intercept/mock | ✅ | ✅ | ⚠️/❌ |
| Response bodies | ✅ | ✅ | ❓ |
| Cookies/storage | ✅ | ✅ | ✅ partial |
| User contexts / incognito | ✅ | ✅/⚠️ | ❓ |
| Permissions | ✅ | ⚠️ | ⚠️ |
| Timezone/UA/geo emulation | ✅ | ✅/⚠️ | ⚠️ |
| Offline/network conditions | ⚠️ offline only | ✅ broader | ❓ |
| WebExtension install/list | ✅ | ❌ (capabilities only) | ❌ |
| JavaScript debugger | ✅ `moz:debugging` | ❌ (CDP only) | ❌ |
| Profiler | ✅ `moz:profiler` | ❌ (CDP only) | ❌ |
| Screencast | ✅ | ⚠️/❓ | ❌ |
| Cross-browser vendor modules | ❌ | ❌ | ❌ |

This table is intentionally coarse. Per-command differences matter; use a
capability registry and integration tests per browser/version.

## 4. Session sharing — the part users get wrong

A BiDi session is **one session per browser instance**, bound to **one
WebSocket connection**. It is not a shared bus that every client can join.

- Within **one MCP server process**, all tool calls share the single session.
  That is the intended model.
- If **two MCP server processes** (two editors, two AI CLIs, one editor and one
  script) each launch their own stdio server, both call `session.new`. Firefox
  allows one. The second gets "Maximum number active sessions".
- There is no protocol command to "join" or "take over" another client's
  session.
- Therefore, "shared among all CLI tools and AIs" is true only if they all talk
  to **one server process**. Otherwise we need a **local broker/daemon**.

### 4.1 Options

| Option | What it means | Verdict |
|---|---|---|
| One MCP server per Firefox | Each client owns its own session | Simple; conflicts when multiple clients start |
| Single-owner broker | One daemon owns the session; MCP servers/clients connect locally | Correct long-term; needs IPC, auth, lifecycle |
| Browser-side multiplexing | Multiple WebSockets to one session | Not available in Firefox BiDi |
| Multiple Firefox instances | One profile/port per client | Works but defeats "my real profile" |

**Recommendation:** v1 is one server process, exclusive attach. Add a broker in
v2/ToBeImplemented. Document the limitation clearly.

## 5. Architecture recommendation

Do **not** build a fake universal layer now. Build a **backend seam**:

```ts
interface BrowserBackend {
  readonly kind: 'firefox' | 'chromium' | 'webkit';
  connect(): Promise<SessionInfo>;
  disconnect(): Promise<void>;
  contexts: ContextApi;
  snapshot: SnapshotApi;
  input: InputApi;
  network: NetworkApi;
  storage: StorageApi;
  emulation: EmulationApi;
  capabilities: CapabilityRegistry;
}
```

- `FirefoxBackend` (v1): direct Remote Agent, native BiDi, `moz:*`.
- `ChromiumBackend` (future): ChromeDriver/EdgeDriver, driver lifecycle,
  Chromium capabilities.
- `WebKitBackend` (deferred): safaridriver, experimental.

Tools call the backend interface plus a capability registry. Do not scatter
`if (browser === 'firefox')` through tool handlers. Vendor features are
capabilities, not assumptions.

## 6. Launch control and incognito

The user asked for launch control and incognito. Split it:

| Feature | Firefox today | Chromium future |
|---|---|---|
| Attach to running browser | ✅ flag + profile | ✅ ChromeDriver `debuggerAddress` |
| Launch a browser | ❌ v1 (attach-only) | Future; ChromeDriver can launch |
| Private/incognito window | ⚠️ user context is isolated, not the same as a private window | ✅ `--incognito` or BiDi user context |
| Isolated container | ✅ `browser.createUserContext` | ✅ BiDi user context / incognito context |
| Profile selection | ✅ profile dir/discovery | Future; `--user-data-dir` |
| Close browser | ⚠️ gated `browser.close` | Future; driver quit |

"Incognito" is not one thing across browsers. Firefox containers, Firefox
private windows, and Chromium incognito contexts have different semantics. The
tool surface should expose **contexts** with a `kind`/`isolated` description, not
pretend they are identical.

## 7. Verdict

- **v1:** Firefox direct BiDi only. This is the differentiator and the only
  no-driver path.
- **v2:** add Chromium backend (Chrome/Edge/Brave) via ChromeDriver, optional
  driver management, capability-gated tools.
- **Safari:** defer until WebKit ships stable BiDi and safaridriver supports it.
- **Do not** market "universal BiDi" until the backend matrix and tests exist.

## 8. Sources

- [W3C WebDriver BiDi](https://www.w3.org/TR/webdriver-bidi/)
- [ChromeDriver](https://developer.chrome.com/docs/chromedriver)
- [Selenium WebDriver BiDi](https://www.selenium.dev/documentation/webdriver/bidi/)
- [chromium-bidi](https://github.com/GoogleChromeLabs/chromium-bidi)
- [WebKit Contributor Meeting 2025 — WebDriver BiDi](https://docs.webkit.org/Other/Contributor%20Meetings/ContributorMeeting2025.html)
- [Selenium SafariOptions `enableBiDi()`](https://www.selenium.dev/selenium/docs/api/java/org/openqa/selenium/safari/SafariOptions.html)
- [WebKit Features for Safari 27.0](https://webkit.org/blog/18325/webkit-features-for-safari-27-0/)
