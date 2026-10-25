# Firefox Automation Competitors — October 2026

**Status:** research. **Date:** 2026-10-21. Versions are the npm latest observed
on 2026-10-21.

> **See also:** [`07-competitor-recheck-2026-10-21.md`](./07-competitor-recheck-2026-10-21.md)
> for the fresh GitHub sweep, new entrants, safety trends, and threat
> assessment.

## 1. Competitive set

### 1.1 Mozilla Firefox DevTools MCP — the closest competitor

| Fact | Value |
|---|---|
| Package | `@mozilla/firefox-devtools-mcp` **0.10.6** |
| Maintainer | Mozilla |
| Transport to Firefox | Selenium WebDriver (BiDi + Classic) |
| Driver | geckodriver, managed automatically |
| Default mode | Launches Firefox with its own `firefox_devtools_mcp_profile` subfolder |
| Attach mode | `--connect-existing` requires **both** `--marionette` and `--remote-debugging-port` |
| Default tools | 34 (`basic` preset) |
| Developer tools | 48 (`developer` preset) |
| Public-package extras | extensions, profiler, screencast, debugging, script, downloads, management |
| Private/Mozilla-build only | privileged context, prefs, launch/restart, raw `send_bidi_command` |
| Android | geckodriver + adb, wipes app data |
| Security posture | Dedicated profile recommended; warns that Marionette enables `navigator.webdriver` |

Tool modules and counts:

| Module | Tools |
|---|---|
| pages | 6 |
| snapshot | 3 |
| input | 8 |
| network | 3 |
| console | 2 |
| screenshot | 2 |
| print | 1 |
| downloads | 3 |
| utilities | 4 |
| management | 3 |
| webextension | 2 |
| profiler | 3 |
| screencast | 2 |
| script | 1 |
| debugging | 6 |

Strengths:

- Mozilla distribution and trust.
- Broad DevTools surface: debugger, profiler, screencast, network, console.
- Extension install/uninstall/list.
- Presets and `saveTo` for large outputs.
- Android support.
- Mature snapshot with UID-based actions.

Weaknesses relevant to us:

- Requires Selenium/geckodriver for the public path.
- `--connect-existing` requires Marionette, which adds a second automation
  channel and its own fingerprint effects.
- Defaults to launching a new Firefox profile; attaching to the **user's real
  profile** is a secondary mode.
- 34–48 tools, more schema/context overhead.
- Not direct BiDi-only; Classic fallback is part of the design.

### 1.2 Playwright MCP

| Fact | Value |
|---|---|
| Package | `@playwright/mcp` **0.0.83** |
| Engine | Playwright 1.64 alpha |
| Firefox | Bundled patched Firefox **157** over Juggler |
| Browser ownership | Launches/owns profile; persistent by default |
| Tool surface | ~93 tools gated by capabilities |
| Real Firefox attach | No |
| Cross-browser | Chromium, Firefox, WebKit |

See `02-playwright-firefox.md`. This is a generic agent browser, not a
Firefox-profile product. It is the benchmark for snapshot/actionability, not the
direct competitor.

### 1.3 firefox-bidi-mcp

| Fact | Value |
|---|---|
| Repo | `Enne2/firefox-bidi-mcp` |
| Language | JavaScript, single file |
| Tools | **7**: open_session, close_session, list_tabs, select_tab, navigate, evaluate, screenshot |
| Transport | Raw `ws` |
| Browser ownership | Attach to already-running Firefox |
| Session | Explicit open/close |

This is the closest in **philosophy** (attach-only, raw BiDi), but it is a
minimal wrapper. No snapshot, interaction, network, contexts, extensions, or
recovery. It validates the demand and the session-exclusivity pain.

### 1.4 mcp-browser-dev-tools

| Fact | Value |
|---|---|
| Package | `mcp-browser-dev-tools` **0.4.0** |
| Tools | **34** |
| Protocols | Chromium CDP + Firefox BiDi |
| Browser | Auto/launch/ensure |
| Discovery | Ports 9222–9226 |
| WSL relay | Yes |

Broad and dual-protocol, but not Firefox-profile-first and not attach-only.
Useful reference for a dual-protocol broker if we ever add Chromium; not a v1
competitor.

### 1.5 browser-harness-bidi

| Fact | Value |
|---|---|
| Repo | `AndrewDzzz/browser-harness-bidi` |
| Language | Python |
| Model | Thin editable harness, not a fixed MCP tool surface |
| Firefox paths | geckodriver or direct Remote Agent |
| Strength | Agent writes helpers during execution |

Interesting architecture, but not a packaged MCP product. Its explicit statement
that BiDi is not a stealth layer matches our position.

### 1.6 Libraries and drivers

| Product | Version | Firefox path | Relevance |
|---|---|---|---|
| Puppeteer | 25.15.0 | WebDriver BiDi; launches Firefox | Library, not MCP; validates BiDi |
| Selenium | 4.51.0 | geckodriver/Marionette + BiDi | Infrastructure, not a product |
| WebdriverIO | 10.1.0 | WebDriver/BiDi | Test framework |
| `@wdio/mcp` | 4.0.0 | WebDriver | Generic MCP over WDIO |
| Foxbridge | — | CDP → Juggler/BiDi proxy | Compatibility niche |
| Camoufox | — | Firefox-based anti-detect | Different market |

## 2. Feature matrix

Legend: ✅ first-class, ⚠️ partial/conditional, ❌ absent.

| Capability | Us (planned) | Mozilla DevTools MCP | Playwright MCP | firefox-bidi-mcp | mcp-browser-dev-tools |
|---|---|---|---|---|---|
| Attach to user's real Firefox | ✅ | ⚠️ `--connect-existing` + Marionette | ❌ | ✅ | ⚠️ |
| No geckodriver/Selenium | ✅ | ❌ | ✅ (Juggler) | ✅ | ✅ |
| No Marionette | ✅ | ❌ in attach mode | ✅ | ✅ | ✅ |
| No browser download | ✅ | ✅ (uses installed Firefox) | ❌ bundled | ✅ | ✅ |
| Containers/user contexts | ✅ | ⚠️ via BiDi | ❌ real containers | ⚠️ raw | ⚠️ |
| Extension install/uninstall/list | ✅ planned | ✅ | ❌ Firefox | ❌ | ❌ |
| JavaScript debugger | ✅ planned | ✅ | ❌ | ❌ | ❌ |
| Profiler | ✅ planned | ✅ | ❌ | ❌ | ❌ |
| Screencast | ✅ planned | ✅ | ⚠️ video via Playwright | ❌ | ❌ |
| Network interception | ✅ | ✅ | ✅ | ❌ | ⚠️ |
| Snapshot + UID actions | ✅ planned | ✅ | ✅ | ❌ | ⚠️ |
| Actionability/auto-wait | ✅ planned | ✅ | ✅ | ❌ | ⚠️ |
| Cross-browser | ❌ | ❌ | ✅ | ❌ | ✅ |
| Tool count | ~16 | 34–48 | ~93 | 7 | 34 |
| Real-profile security model | ✅ explicit | ⚠️ dedicated profile advised | ❌ owns profile | ✅ | ⚠️ |
| Stealth | ❌ (`navigator.webdriver`) | ❌ | ⚠️ Playwright patches | ❌ | ⚠️ |

## 3. Positioning

> **The Firefox you already use, over the protocol Firefox already speaks.**

Three pillars:

1. **Real context.** Cookies, logins, containers, extensions, open tabs. No
   migration, no separate profile, no re-auth.
2. **Direct protocol.** One WebSocket to Firefox's native Remote Agent. No
   geckodriver, Selenium, Marionette, Puppeteer, or Playwright.
3. **Compact agent surface.** 16 action-based tools, structured results,
   token-aware snapshots, actionable errors.

Not our game:

- Cross-browser automation (Playwright).
- Test runner / trace viewer (Playwright).
- Stealth/anti-detect (Camoufox/Foxbridge).
- Full Chrome DevTools parity (CDP MCP).
- Android (Mozilla MCP).

## 4. Threats and responses

| Threat | Likelihood | Response |
|---|---|---|
| Mozilla MCP becomes the default Firefox choice | High | Differentiate on real-profile attach, no driver, containers, compact surface; interoperate by not owning the browser |
| Playwright MCP adds real Firefox attach | Medium | It would still own a Playwright context; our direct BiDi + containers + debugger/profiler remain distinct |
| firefox-bidi-mcp grows | Medium | It is minimal and single-file; we win on snapshot/interaction/network/devtools and reliability |
| Firefox changes BiDi/vendor APIs | High | Feature detection, version matrix, integration tests, graceful degradation |
| Users expect stealth | Medium | State the `navigator.webdriver` fact clearly; do not pretend otherwise |
| MCP spec churn | Medium | SDK 1.32.1, outputSchema optional, stdio-first, version-pinned tests |

## 5. What "better" means

We do not need more tools. We need:

- a snapshot an agent can act on without guessing;
- clicks/types that work on React/Vue and shadow DOM;
- a clear answer when Firefox is not reachable or another client owns the
  session;
- containers and extensions exposed safely;
- debugger/profiler when the user opts in;
- no surprise browser launches or profile changes.

## 6. Coverage of the July research

All eight July research files and the July plan were read. Firefox-relevant
competitors were re-checked against current npm/repo state; Chromium-only
entries were not re-verified because they are out of scope.

| July file | What happened |
|---|---|
| `MCP_SERVERS.md` | Rechecked the Firefox-relevant entries (Mozilla DevTools MCP, firefox-bidi-mcp, mcp-browser-dev-tools, browser-mcp); added current versions/tool counts |
| `FOXBRIDGE.md` | Kept as a CDP→Firefox bridge reference; not a direct MCP competitor |
| `BROWSER_PROTOCOLS.md` | Superseded by `01-firefox-bidi-2026.md` and `06-cross-browser-bidi.md` |
| `BIDI_API_REFERENCE.md` | Superseded by the Firefox 158 module matrix in `01` |
| `BUILDING_BIDI_MCP.md` | Used for the original skeleton; superseded by `05-architecture-and-snapshot.md` |
| `BROWSERS.md` | Read; RAM/benchmark content is not relevant to this product decision |
| `MIGRATION_TOOLS.md` | Read; Chrome→Firefox migration tools are not automation competitors |
| `index.md` | Moved to `../July2026/`; now an archive index |
| July plan | Assessed line by line in `../../development/plans/October2026/july-carryover.md` |

What was re-verified:

- `@mozilla/firefox-devtools-mcp` 0.10.6 — tool modules, 34/48 counts, Selenium
  and `--connect-existing` behavior.
- `@playwright/mcp` 0.0.83 — bundled Firefox 157 Juggler, `moz-firefox` BiDi
  channel, issue #37277 status.
- `mcp-browser-dev-tools` 0.4.0, `firefox-bidi-mcp` repo, `browser-harness-bidi`
  repo.
- Puppeteer 25.15.0, Selenium 4.51.0, WebdriverIO 10.1.0, `@wdio/mcp` 4.0.0.
- Foxbridge/Camoufox positioning.

## 7. Sources

- [`@mozilla/firefox-devtools-mcp` 0.10.6](https://www.npmjs.com/package/@mozilla/firefox-devtools-mcp)
- [Mozilla Firefox DevTools MCP](https://github.com/mozilla/firefox-devtools-mcp)
- [Mozilla MCP tool reference](https://github.com/mozilla/firefox-devtools-mcp/blob/main/docs/tools.md)
- [`@playwright/mcp` 0.0.83](https://www.npmjs.com/package/@playwright/mcp)
- [firefox-bidi-mcp](https://github.com/Enne2/firefox-bidi-mcp)
- [mcp-browser-dev-tools](https://github.com/Hinaser/mcp-browser-dev-tools)
- [browser-harness-bidi](https://github.com/AndrewDzzz/browser-harness-bidi)
- [Puppeteer](https://pptr.dev/) · [Selenium](https://www.selenium.dev/) ·
  [WebdriverIO](https://webdriver.io/)
- [Foxbridge](https://github.com/VulpineOS/foxbridge)
