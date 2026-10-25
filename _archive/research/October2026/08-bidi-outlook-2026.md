# BiDi Outlook — Is It the Future?

**Status:** research (2026-10-21). **Question:** is WebDriver BiDi the future of
browser automation, and what does that mean for this server?

## 1. Short answer

**Yes for cross-browser automation, with caveats.** BiDi is the W3C standard,
Firefox ships it natively, Chrome/Edge implement it through ChromeDriver, and
Safari/WebKit is progressing slowly. CDP is not going away for Chrome-specific
depth, but new automation layers are BiDi-first, not CDP-first.

## 2. Evidence

| Signal | What it shows |
|---|---|
| Firefox removed CDP in Firefox 141 | Mozilla's only supported remote protocol is BiDi (+ vendor modules) |
| W3C BiDi roadmap tracks scenarios, not just commands | Vendors are coordinating on real end-to-end flows: console, network, auth dialogs, storage, permissions |
| ChromeDriver + `chromium-bidi` | Google funds a BiDi mapper over CDP; coverage grows every Chrome release |
| Selenium 4 BiDi | Standard clients expose BiDi; WebdriverIO 10 defaults to BiDi |
| Playwright stock-Firefox channel | Playwright can drive unpatched Firefox over BiDi (`channel: moz-firefox`), still experimental but real |
| New non-JS implementations | Motus (.NET), `agent-in-browser` (Go), `browser-control-mcp` (Rust), several Python MCPs |
| MCP ecosystem | Browser MCPs in 2026 increasingly mention BiDi alongside CDP |
| WebKit | Partial BiDi, experimental, safaridriver-only; slowest of the three engines |

## 3. Timeline (best estimate)

| Window | Firefox | Chromium | WebKit |
|---|---|---|---|
| Now (late 2026) | Native, broad, vendor modules (`moz:*`) | Broad via ChromeDriver; no native `/session` | Partial/experimental |
| 2027 | Two-week cadence; more emulation/permissions modules | More modules; driver still required; CDP remains for deep debug/perf | Slow progress; do not plan around it |
| Later | Continued vendor extensions; possible dynamic remote-agent start | Possible native BiDi endpoint? Not announced | Stable BiDi eventually, unknown date |

## 4. What is still CDP-only or missing

- Full accessibility tree (BiDi has `locateNodes` accessibility locator, not the
  whole tree).
- CSS domain, heap snapshots, CPU throttling.
- Chrome debugger/profiler over BiDi (CDP only today).
- WebSocket frame inspection.
- Network/CPU throttling beyond offline.
- `setBypassCSP`.
- Browser-specific extension APIs.

## 5. Implications for this server

1. **Stay Firefox-native.** It is the only driver-free, attach-to-real-profile
   path. That advantage grows as more competitors adopt BiDi but keep drivers.
2. **Build a capability registry, not browser checks.** BiDi command coverage
   differs by engine and version.
3. **Keep the backend seam.** `FirefoxBackend` now; `ChromiumBackend` when the
   driver story is acceptable; `WebKitBackend` later.
4. **Do not wait for Cross-Browser BiDi to design tools.** The common core
   (session, browsingContext, script, input, network, storage, log) is stable
   enough to abstract.
5. **Watch for a driverless Chromium BiDi endpoint.** If Chrome ever serves
   BiDi without ChromeDriver, the cross-browser picture changes materially.
6. **Vendor modules are a moat, not a bug.** `moz:debugging`, `moz:profiler`,
   `permissions`, screencast, and `webExtension` are Firefox-specific value that
   cross-browser servers cannot match.

## 6. Sources

- [W3C WebDriver BiDi roadmap](https://github.com/w3c/webdriver-bidi/blob/HEAD/roadmap.md)
- [WebDriver BiDi specification](https://w3c.github.io/webdriver-bidi/)
- [Firefox Source Docs — Remote prefs](https://firefox-source-docs.mozilla.org/remote/Prefs.html)
- [chromium-bidi](https://github.com/GoogleChromeLabs/chromium-bidi)
- [Selenium BiDi docs](https://www.selenium.dev/documentation/webdriver/bidi/)
- [Playwright `moz-firefox` channel](https://playwright.dev/docs/browsers#firefox)
- [WebKit Contributor Meeting 2025](https://docs.webkit.org/Other/Contributor%20Meetings/ContributorMeeting2025.html)
