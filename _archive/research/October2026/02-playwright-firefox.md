# Playwright and Firefox — Juggler, BiDi, and What to Copy

**Status:** research. **Date:** 2026-10-21. **Ground truth:** `playwright-core`
1.64.1 (npm pack), `@playwright/mcp` 0.0.83, Playwright issue #37277, and
Playwright source.

## 1. The short version

Playwright still drives **its own patched Firefox build through Juggler** by
default. It does not attach to the user's Firefox, and it does not use WebDriver
BiDi for `--browser firefox`.

Stock Firefox over BiDi exists, but it is a separate channel and is still
experimental:

```ts
// Playwright API
firefox.launch({ channel: 'moz-firefox' })        // stock Firefox + BiDi
firefox.launch({ channel: 'moz-firefox-beta' })
firefox.launch({ channel: 'moz-firefox-nightly' })
```

The default `firefox` executable is the bundled patched build. That is the one
Playwright MCP uses.

## 2. How the bundled Firefox is launched

From `playwright-core` 1.64.1 (`browsers.json` and the bundled launcher):

| Fact | Value |
|---|---|
| Bundled Firefox version | **157.0** |
| Revision | `1555` |
| Transport | Juggler over pipe (FD 3/4), null-byte framed JSON |
| Launch args | `-no-remote`, `-profile <dir>`, `-juggler-pipe` |
| Headless | `-headless` |
| Headed | `-wait-for-browser -foreground` |
| Ready signal | `Juggler listening to the pipe` |
| Profile | Playwright-owned, temporary or persistent |
| User prefs | `firefoxUserPrefs` injected into the profile |

Playwright's bundled build is not stock Firefox. It contains browser patches
needed for Juggler features that BiDi does not expose yet.

`@playwright/mcp` 0.0.83 depends on a Playwright 1.64 alpha build and exposes
`--browser firefox`, which resolves to the bundled Juggler build. `--extension`
is Chromium/Edge-only. `--executable-path` can point at another binary, but the
launch path is still Juggler; it is not a BiDi attach path.

## 3. Stock Firefox over BiDi

Playwright registers `moz-firefox`, `moz-firefox-beta`, and
`moz-firefox-nightly` as separate browser channels that delegate to its BiDi
Firefox implementation. This is the compatibility path, not the default.

Status from issue #37277 (comment dated 2026-08-21):

- ~**4377 passed / 236 failed** tests (>90%) against stock Firefox + BiDi.
- Still failing or incomplete:
  - popups and new windows
  - click count / double-click semantics
  - `scrollIntoViewIfNeeded`
  - workers
  - request/response metadata
  - transformed iframes
  - screencast/video
- Playwright maintainers treat protocol choice as an internal detail and do not
  want users selecting Juggler vs BiDi. Their default remains Juggler.

This matters because it validates BiDi as a real automation protocol, but it
also shows where a direct BiDi MCP server must do its own work: popups, workers,
iframes, actionability, request metadata, and video.

## 4. What Playwright MCP does

| Area | Playwright MCP 0.0.83 |
|---|---|
| Browser ownership | Launches and owns its browser; persistent profile by default |
| Firefox | Bundled patched Firefox 157 over Juggler |
| Real Firefox attach | No (except Chromium CDP/extension paths) |
| Containers | Browser contexts, not Firefox containers |
| Extensions | Chromium extension relay only |
| Tool surface | ~93 tools gated by capabilities |
| Snapshot | Accessibility-tree snapshot with element refs |
| Actionability | Mature auto-wait matrix |
| Network | Routes/mocking; full Chromium coverage |
| Debugger/profiler | None (not a DevTools product) |
| Cross-browser | Chromium, Firefox, WebKit |

Playwright MCP is an excellent **generic agent browser**. It is not a
Firefox-profile product. That is the gap.

## 5. Where Playwright leads

| Capability | Why it matters | What to copy |
|---|---|---|
| Actionability | Clicks fail less when visibility, stability, hit-testing, enabled, and inertness are checked | Implement a BiDi-side actionability loop with `elementFromPoint`, two-frame stability, `scrollIntoView`, and disabled/readonly checks |
| Auto-wait | Agents should not hand-roll sleeps | `waitFor` on selector/UID with network/DOM settle, bounded timeout, actionable failure |
| Snapshot economics | A11y tree + refs is token-efficient | Build a DOM-derived interactive snapshot with role/name, states, bounds, and stable UIDs |
| Trace/video | Debuggability | Screencast (Firefox 154+) and snapshot diffs, not a full trace format |
| Test runner | Deterministic E2E | Integration tests and recorded fixtures, not a test framework product |
| Cross-browser | Reach | Not our game; Firefox-only is the identity |

## 6. Where Playwright lags (and we can lead)

| Area | Playwright MCP | Our opportunity |
|---|---|---|
| Real profile | Own profile | Attach to the user's running Firefox with cookies/logins/containers |
| Firefox containers | Browser contexts | Native user contexts with real container semantics |
| Extensions | Chromium relay | `webExtension.install/uninstall/list` on Firefox |
| JavaScript debugger | None | `moz:debugging` breakpoints/stepping |
| Profiler | None | `moz:profiler` Gecko profiles |
| Driver | Bundled browser | No driver, no browser download |
| Firefox-specific APIs | Generic | `moz:*`, permissions, screencast, file dialogs |
| Tool count | ~93 | 16 compact tools, lower context cost |

## 7. Architecture lessons

Do **not** copy:

- Juggler or a protocol abstraction layer.
- A browser launcher or bundled binary.
- The 93-tool surface.
- Playwright's profile ownership model.
- A test-runner-shaped API.

Do copy:

- Actionability and auto-wait concepts.
- Snapshot UID model and token discipline.
- Capability-gated tools.
- Clear error messages when an element is not actionable.
- Integration-test discipline.

## 8. Product positioning

> Playwright MCP gives an agent a browser it owns. BiDi Browser MCP gives an
> agent the Firefox you already use.

That sentence should survive every roadmap decision. If a feature requires
launching a separate browser or bundling a patched build, it is not v1.

## 9. Sources

- [`playwright-core` browsers.json, 1.64.1](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/browsers.json)
- [`firefox.ts` launcher](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/firefox/firefox.ts)
- [Playwright issue #37277 — Juggler vs WebDriver BiDi](https://github.com/microsoft/playwright/issues/37277)
- [Playwright MCP README](https://github.com/microsoft/playwright-mcp)
- [`@playwright/mcp` 0.0.83](https://www.npmjs.com/package/@playwright/mcp)
