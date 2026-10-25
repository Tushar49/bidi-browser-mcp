# Research Plan — October 2026

**Status: COMPLETE (2026-10-21).** Method: W3C spec read, Firefox 158 source read
at tag `FIREFOX_158_0_RELEASE`, local probe against official Firefox 158.0
win64, npm package inspection (`@mozilla/firefox-devtools-mcp` 0.10.6,
`@playwright/mcp` 0.0.83, `playwright-core` 1.64.1), Mozilla docs, MCP
2026-07-28 spec, and competitor repo reads. No product code changes.

## Research questions

### RQ-A — What does WebDriver BiDi look like in October 2026?

- A1: ✅ W3C Working Draft 2026-10-08; 10 modules (session, browser,
  browsingContext, emulation, input, log, network, script, storage,
  webExtension). ~65 commands, 24 core events. New since the July baseline:
  screencast, `setBypassCSP`, `setExtraHeaders`, `setDownloadBehavior`,
  `imageSize`, wheel input, `input.fileDialogOpened`, `script.message`,
  expanded emulation (UA, timezone, network conditions, screen settings).
- A2: ✅ MDN now documents additional modules (`permissions`, `bluetooth`,
  `userAgentClientHints`) that are not all in the W3C TR. Firefox implements
  `permissions` and vendor modules; treat MDN as a superset, not the contract.
- A3: ✅ Firefox 158 source supports most core commands plus vendor
  extensions. Exact matrix in `01-firefox-bidi-2026.md`.

### RQ-B — What is Firefox-specific and verified?

- B1: ✅ Discovery: `WebDriverBiDiServer.json` in the profile directory,
  `{ ws_host, ws_port }`; endpoint `/session`; file removed on stop.
- B2: ✅ One session only. Second `session.new` fails. Session capabilities
  include `browserName`, `browserVersion`, `platformName`, `moz:buildID`,
  `moz:processID`, `moz:profile`, `moz:headless`.
- B3: ✅ `navigator.webdriver` is `true` under `--remote-debugging-port` alone.
  Verified without Marionette.
- B4: ✅ `moz:debugging` and `moz:profiler` exist and work. Proxy/debugging
  modules are not gated by `remote.experimental.enabled` in 158.
- B5: ✅ `webExtension.moz:listExtensions` exists; install supports
  `moz:permanent` and `moz:allowPrivateBrowsing`.
- B6: ✅ `browsingContext.locateNodes` supports `accessibility`, `context`,
  `css`, `innerText`, `xpath`. The accessibility locator worked in the probe;
  the `innerText` locator did not (likely a 158 bug/edge case).
- B7: ⚠️ Network `setExtraHeaders` is present but my first probe payload was
  wrong (header values are BiDi `BytesValue` objects, not plain strings).
  Treat it as available with correct serialization; verify in integration.

### RQ-C — How does Playwright drive Firefox, and does it matter?

- C1: ✅ Default bundled Firefox is a patched build driven by **Juggler** over
  a pipe: `-no-remote`, `-profile`, `-juggler-pipe`, ready on
  "Juggler listening to the pipe".
- C2: ✅ Stock Firefox via BiDi is selected with `channel: moz-firefox`
  (also `moz-firefox-beta`, `moz-firefox-nightly`); Playwright calls this
  experimental. Issue #37277 (Aug 2026) reports ~4377 passed / 236 failed
  (>90%) with known gaps: popups/new windows, click count/double-click,
  `scrollIntoViewIfNeeded`, workers, request/response metadata, transformed
  iframes, screencast/video.
- C3: ✅ Playwright MCP `--browser firefox` uses the bundled Juggler build and
  owns/launches its browser/profile. `--extension` is Chromium-only. It does
  not attach to the user's existing Firefox.
- C4: ✅ Conclusion: do not copy Juggler. Steal actionability, auto-wait, and
  snapshot economics; keep direct BiDi and real-profile attach.

### RQ-D — Who are the competitors?

- D1: ✅ Mozilla Firefox DevTools MCP 0.10.6: 34 tools in `basic`, 48 in
  `developer`; Selenium/geckodriver; launch or `--connect-existing` with both
  `--marionette` and `--remote-debugging-port`; strong devtools features.
- D2: ✅ Playwright MCP 0.0.83: ~93 gated tools, own browser, bundled Firefox.
- D3: ✅ firefox-bidi-mcp: 7 tools, raw `ws`, attach to existing Firefox,
  explicit open/close session, no npm package.
- D4: ✅ mcp-browser-dev-tools 0.4.0: dual CDP+BiDi, 34 tools, auto/launch.
- D5: ✅ browser-harness-bidi: thin Python BiDi harness, direct Remote Agent or
  geckodriver, not a serious MCP tool-surface competitor.
- D6: ✅ Puppeteer 25.15 / Selenium 4.51 / WebdriverIO 10 / @wdio/mcp 4 are
  libraries or generic drivers, not Firefox-profile-first MCP products.
- D7: ✅ Foxbridge and Camoufox remain CDP bridges/anti-detect niche. No
  direct MCP threat, but useful proof that CDP-only clients want Firefox.

### RQ-E — What does MCP 2026-07-28 require from the tool surface?

- E1: ✅ Current spec revision: `2026-07-28`. Stateless HTTP core; stdio still
  valid. This server can stay stdio-only.
- E2: ✅ Tool fields: `name`, `title`, `description`, `icons`, `inputSchema`
  (JSON Schema 2020-12), optional `outputSchema`, `annotations`, `_meta`.
- E3: ✅ `structuredContent` is the structured result; if `outputSchema` is
  present, results must conform and clients should validate. Return serialized
  JSON in a text block for backward compatibility.
- E4: ✅ Annotations: `readOnlyHint`, `destructiveHint`, `idempotentHint`,
  `openWorldHint`; clients must treat them as untrusted.
- E5: ✅ Extensions: Tasks (`io.modelcontextprotocol/tasks`) for long-running
  work, MCP Apps for UI. Neither is needed for v1; progress/cancellation cover
  snapshot/network waits.
- E6: ✅ Registry metadata (`mcpName`, `server.json`) already matches this
  repo's packaging; no change needed for research.

### RQ-F — What should the implementation plan be?

- F1: ✅ Keep attach-only, real-profile, direct-BiDi identity.
- F2: ✅ 16 action-based tools, ~110 actions, gated `core` / `devtools` /
  `all` toolsets. Details in `04-mcp-tool-surface.md`.
- F3: ✅ Phased releases: v0.2 connect/snapshot/observe; v0.3 interact/form;
  v0.4 network/storage/contexts; v0.5 devtools; v1.0 hardening.
- F4: ✅ Test strategy: MockBiDiServer + recorded FF158 fixtures; integration
  opt-in with a real Firefox; no Firefox in CI.
- F5: ⚠️ Open product decisions: default toolset, extension-install safety,
  debugger/profiler scope, minimum Firefox version, action-based vs granular
  tool annotations. Listed in the implementation plan.

## Out of scope

- Chrome/Chromium BiDi support (Chrome users have `cdp-browser-mcp`).
- Safari/WebKit BiDi.
- Bundling or launching Firefox in v1 (attach-only).
- Stealth/anti-detection features.
- Playwright/Juggler compatibility layer.
- MCP Apps UI or Tasks-based long-running jobs.
