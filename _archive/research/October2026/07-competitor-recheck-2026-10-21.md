# Competitor Recheck — 2026-10-21

**Status:** research snapshot. **Method:** GitHub API search (repositories),
`npm view`, `grep.app`, and Exa web search. GitHub star counts are volatile; treat
them as ordering signals, not truth.

## 1. Headline

The browser-MCP field is crowded and moving fast, but the **direct-attach,
real-Firefox, no-driver** slot is still thin. Most active projects either launch
their own browser, use CDP/Puppeteer, or use Selenium/geckodriver. Mozilla's
`firefox-devtools-mcp` is the serious incumbent and the one to beat.

## 2. Active and new competitors

| Project | Stack | Browser/protocol | Attach vs launch | Driver | Created / stars | Notes |
|---|---|---|---|---|---|---|
| `ChromeDevTools/chrome-devtools-mcp` | TypeScript | Chrome via CDP | either | none (Puppeteer) | 2025-09 / ~54k | Category leader; Chrome only; no BiDi Firefox |
| `mozilla/firefox-devtools-mcp` | TypeScript | Firefox via BiDi + WebDriver Classic | `--connect-existing` requires `--marionette --remote-debugging-port` | geckodriver/Selenium | 2025-10 / ~510 | v0.10.6 (2026-10-16): `print_page`, `send_bidi_command`, BiDi `browsingContext.getTree`, profile reuse; warns about `navigator.webdriver` |
| `@playwright/mcp` | TypeScript | Chromium/Firefox/WebKit via Playwright | launch | bundled | — / high | Bundled Firefox 157 Juggler; stock Firefox BiDi `channel: moz-firefox` still experimental |
| `webdriverio/mcp` (`@wdio/mcp` 4.0.0) | TypeScript | Chrome/Firefox/Edge/Safari + iOS/Android | either (attach Chrome) | WebDriverIO-managed drivers | 2025-12 / ~31 | Single active session; BiDi default; device emulation; TOON output |
| `deeishere/ZenMCP` | Python | Zen Browser (Firefox-based) via WebDriver BiDi | attach-only | none | 2026-09 / 0 | 7 tools: tabs, navigate, text, JS, screenshot; minimal but exactly in our Firefox-family niche |
| `Gwakko/agent-in-browser` | Go | Chrome/Edge/Brave CDP; Firefox BiDi; Safari roadmap | either | none/CDP | 2026-10-21 / 0 | MCP + CLI + scenario runner in one binary; multi-browser; brand new, watch |
| `leetomo2528/firefox-use` | JavaScript | Firefox BiDi | launches Firefox itself | none | 2026-09 / 0 | Claude Code plugin; same tool names as Claude-for-Chrome; no npm deps |
| `raultov/browser-control-mcp` | Rust | Chrome CDP; Firefox BiDi + RDP | either | none | 2026-10 / 1 | Debugger-first (breakpoints, stepping, call frames); BETA |
| `UnknownCaz/firefox-mcp` | Python | Firefox raw BiDi | attach-only | none | 2026-07 / 0 | Confirmation gates, domain allowlists, prompt-injection fencing; documents Remote Agent prefs |
| `surpasses/firefox-mcp` | JavaScript | Firefox BiDi | attach to running Firefox | none | 2026-09 / 0 | Tabs, navigate, snapshot refs, click/type, console/network; relaunch helper |
| `KevinTrinhDev/gaze` | JavaScript | Chromium CDP; Firefox BiDi | attach to logged-in browser | none | 2026-08 / 0 | CLI + MCP; consent gate on writes; injection-scanned page content |
| `MathiasPaulenko/wavexis-mcp` | Python | Chrome/Edge/Firefox CDP + BiDi | either | none | 2026-07 / 3 | 220 tools, 13 tiers, stealth mode, Lighthouse; opposite of compact |
| `DataficationSDK/Motus` | C#/.NET | Chromium CDP; Firefox BiDi | either | none | 2026-03 / 15 | Test framework + MCP; direct WebSocket; source-generated protocol bindings |
| `VitexSoftware/mcp-server-webdriver` | Python | Firefox via Selenium + geckodriver | launches | geckodriver | 2026-06 / 4 | DevTools/diagnostics focus; BiDi listeners |
| `SCV-Consultants/selenium-mcp` | Python | Chrome + Firefox via Selenium 4 | launches | chromedriver/geckodriver | 2026-04 / 0 | Multi-session, BiDi event streaming |
| `feder-cr/invisible_playwright_mcp` | Python | anti-detect Firefox via Playwright | launches | bundled | 2026-09 / ~873 | Stealth/anti-bot market; explicitly not our direction |
| `roxybrowserlabs/roxybrowser-playwright-mcp` | TypeScript | Chromium CDP; Firefox BiDi | attach | none | 2025-08 / ~19 | Protocol-agnostic adapter; humanized input |
| `sadym-chromium/webdriver-spec-mcp` | TypeScript | WebDriver BiDi + Classic spec | n/a | n/a | 2026-01 / 0 | Spec/reference MCP, not automation |

## 3. Trends

1. **BiDi adoption is real.** Non-JS implementations now exist in Go, Rust,
   Python, and .NET. BiDi is no longer a Firefox-only curiosity.
2. **Attach-only to a real profile is still a niche.** Firefox-specific attach
   servers exist, but most have few stars and little hardening. Mozilla still
   launches its own profile by default.
3. **Safety is the new differentiator.** `gaze` (consent gate), `UnknownCaz`
   (confirmation gates, domain allowlist, prompt-injection fencing), and `gaze`
   (injection scanning) compete on trust. Our backlog has these as future work.
4. **Stealth is a large adjacent market.** `invisible_playwright_mcp` at ~873
   stars shows demand. We stay out; `navigator.webdriver=true` is inherent.
5. **Tool count splits the market.** Mozilla has presets (`slim`/`basic`/
   `developer`/`mozilla`); Playwright has a large catalog; `wavexis` has 220
   tools. Our 16-tool, action-based surface remains the token-efficiency bet.
6. **CDP still owns visibility.** Chrome DevTools MCP has ~54k stars. Firefox
   MCP projects are in the hundreds at best.
7. **Mozilla is converging on BiDi.** v0.10.5–0.10.6 migrated page listing and
   snapshot/dom interactions to BiDi. It still needs geckodriver plus Marionette
   for existing profiles; that remains our advantage.
8. **Raw-protocol escape hatches are appearing.** Mozilla added
   `send_bidi_command`. A gated `bidi.command` is worth adding later.

## 4. What to take

- **Confirmation gates** for write actions, with per-client opt-in.
- **Domain allowlist** and **read-only mode**.
- **Prompt-injection fencing**: page text is untrusted, never instructions.
- **Tool presets** validate our `core`/`network`/`devtools` split.
- **Raw BiDi escape hatch** in `devtools` only.
- **Print/PDF** (`browsingContext.print`), already on the backlog.
- **BiDi-first migrations** for whichever Selenium/CDP features map cleanly.

## 5. What not to copy

- Launch-by-default. Attach-only is the identity.
- Driver dependency. It is the reason this project exists.
- 220-tool catalogs. Token cost and agent confusion.
- Stealth/anti-detect. Fragile, dishonest, and detectable.
- Multi-session emulation. Firefox allows one; fail clearly instead.

## 6. Threat assessment

| Threat | Level | Why |
|---|---|---|
| Mozilla `firefox-devtools-mcp` | High | Official, funded, improving fast; but needs geckodriver + Marionette for existing profile, launches by default, larger surface |
| `firefox-use` / `surpasses/firefox-mcp` | Medium | Closest attach-only Firefox MCPs; small, unhardened, but directly overlapping |
| Playwright MCP + `moz-firefox` | Medium | If the stock-Firefox channel stabilizes, it becomes a drop-in for many users |
| `agent-in-browser` | Medium | Multi-browser, one binary, BiDi for Firefox; new but ambitious |
| WebdriverIO MCP | Medium | Broad browser/mobile coverage, driver-managed; not attach-first |
| Chrome DevTools MCP | Low for our niche | Chrome/CDP only; validates the category but not the Firefox profile story |

## 7. Verdict

The differentiator is intact: **the Firefox you already use, over native BiDi,
with no driver, no Marionette, no second browser**. The competition is moving
toward the same protocol but not toward the same attach model. Add safety
features, keep the surface compact, and do not chase stealth or tool count.

## 8. Sources

- GitHub API repository search and repo READMEs (2026-10-21).
- `npm view @mozilla/firefox-devtools-mcp@0.10.6`, `@playwright/mcp@0.0.83`,
  `@wdio/mcp@4.0.0`, `chrome-devtools-mcp@1.11.0`, `mcp-browser-dev-tools@0.4.0`.
- [mozilla/firefox-devtools-mcp](https://github.com/mozilla/firefox-devtools-mcp)
- [ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)
- [webdriverio/mcp](https://github.com/webdriverio/mcp)
- [Gwakko/agent-in-browser](https://github.com/Gwakko/agent-in-browser)
- [leetomo2528/firefox-use](https://github.com/leetomo2528/firefox-use)
- [raultov/browser-control-mcp](https://github.com/raultov/browser-control-mcp)
- [UnknownCaz/firefox-mcp](https://github.com/UnknownCaz/firefox-mcp)
- [KevinTrinhDev/gaze](https://github.com/KevinTrinhDev/gaze)
- [MathiasPaulenko/wavexis-mcp](https://github.com/MathiasPaulenko/wavexis-mcp)
- [DataficationSDK/Motus](https://github.com/DataficationSDK/Motus)
- [feder-cr/invisible_playwright_mcp](https://github.com/feder-cr/invisible_playwright_mcp)
