# Research — October 2026

Working research for `bidi-browser-mcp`. Dev-branch only; nothing here ships to
`main`. v0.1.3 is implemented; v0.1.4 "Connect" is next, and v0.2.0 is the first
public npm release.

This pass supersedes the July 2026 baseline in
[`../July2026/`](../July2026/index.md). Three things changed enough to
invalidate parts of that baseline:

- Firefox 158 shipped on 2026-10-13, on a new **two-week release cadence**
  (159 is due 2026-10-27). BiDi is no longer "the new thing"; it has a large
  shipped surface and vendor extensions.
- The old claim "BiDi has no debugger and no profiler" is **false for Firefox**.
  Firefox exposes `moz:debugging` and `moz:profiler` BiDi modules.
- MCP moved to the `2026-07-28` spec revision, with `outputSchema`,
  `structuredContent`, tool annotations, a stateless HTTP core, and extensions
  (Tasks, MCP Apps). The stdio transport still works.

## Files

| File | Topic |
|---|---|
| [`research_plan.md`](./research_plan.md) | Questions, method, status, and answer index |
| [`01-firefox-bidi-2026.md`](./01-firefox-bidi-2026.md) | Firefox 158 BiDi surface, discovery, sessions, gaps, security |
| [`02-playwright-firefox.md`](./02-playwright-firefox.md) | How Playwright drives Firefox (Juggler vs stock BiDi), MCP implications |
| [`03-competitors.md`](./03-competitors.md) | Firefox MCP servers and browser-automation competitors |
| [`04-mcp-tool-surface.md`](./04-mcp-tool-surface.md) | MCP 2026-07-28, tool design, annotations, structured output |
| [`05-architecture-and-snapshot.md`](./05-architecture-and-snapshot.md) | Repo seams, discovery, session, snapshot, actionability, tests |
| [`06-cross-browser-bidi.md`](./06-cross-browser-bidi.md) | BiDi on Chrome/Edge/Brave/Safari, session sharing, backend seam |
| [`07-competitor-recheck-2026-10-21.md`](./07-competitor-recheck-2026-10-21.md) | Fresh GitHub/npm competitor sweep; new entrants, trends, threats |
| [`08-bidi-outlook-2026.md`](./08-bidi-outlook-2026.md) | Is BiDi the future? Evidence, timeline, implications |
| [`improvement-backlog.md`](./improvement-backlog.md) | Prioritized work items with effort/impact |
| [`findings-firefox-158-probe.md`](./findings-firefox-158-probe.md) | Ground-truth probe against official Firefox 158.0 |

Companion plan (dev-only):
`../../development/plans/October2026/README.md`.

## Top findings

1. **Firefox 158 BiDi is broad.** The W3C Working Draft of 2026-10-08 has 10
   modules and roughly 65 commands. Firefox 158 ships most of it plus
   `permissions`, `moz:debugging`, `moz:profiler`, and
   `webExtension.moz:listExtensions`: about 70 commands and 26 events.
2. **The debugger/profiler gap is gone.** `moz:debugging` supports breakpoints,
   script listing/source, resume, step over/into/out, pause/resume events.
   `moz:profiler` supports `isActive`, `start`, `stop` and writes a Gecko
   profile JSON to disk.
3. **Discovery is not CDP.** Firefox writes
   `<profile>/WebDriverBiDiServer.json` containing `{ ws_host, ws_port }` and
   serves BiDi at `ws://<host>:<port>/session`. There is no `/json/version`
   contract to rely on.
4. **One BiDi session, one client.** A second `session.new` fails with
   "Maximum number active sessions". The server must own and reuse one session,
   and fail with an actionable message when another client already holds it.
5. **`navigator.webdriver` is true with `--remote-debugging-port`.** Verified on
   Firefox 158 headless without Marionette. This is not a stealth product; do
   not market it as one, and do not add fingerprint spoofing.
6. **Playwright still uses Juggler for its bundled Firefox.** `--browser
   firefox` launches a patched Firefox 157 build over `-juggler-pipe`. Stock
   Firefox over BiDi exists only through `channel: moz-firefox` and is
   experimental (~90% of Playwright tests, known gaps).
7. **Mozilla's Firefox DevTools MCP is the closest competitor.** 34 tools in
   its default `basic` preset, 48 in `developer`, via Selenium/geckodriver.
   `--connect-existing` requires both Marionette and the Remote Agent. It
   launches its own profile by default. Our differentiator stays: direct BiDi,
   attach-only to the user's real profile, no driver, no Marionette, compact
   action-based surface.
8. **Snapshot without an accessibility tree is still the hard part.**
   `browsingContext.locateNodes` accepts an `accessibility` locator
   (role/name), but there is no full AX-tree command. Use injected DOM
   traversal, computed role/name, shadow/iframe piercing, and stable UIDs;
   use `locateNodes` as a resolver, not as the snapshot source.
9. **MCP tool design now rewards fewer, richer tools.** Use 15–16 action-based
   tools, `outputSchema` + `structuredContent` where the shape is stable,
   annotations, progress/cancellation, and explicit destructive-action
   boundaries.
10. **BiDi is a standard, not a universal implementation.** Firefox is native
    and driver-free. Chrome/Edge/Brave need ChromeDriver/EdgeDriver. Safari is
    experimental/partial. Keep Firefox v1; add a backend seam for Chromium later.
11. **The competitor field is crowded but not in our slot.** Fresh sweep
    (`07-competitor-recheck-2026-10-21.md`): most projects launch a browser,
    use CDP, or use Selenium/geckodriver. Direct attach to a real Firefox with
    no driver remains thin. Mozilla is the serious incumbent; safety gates and
    prompt-injection fencing are the new table stakes.
12. **BiDi is the future, with caveats.** Firefox removed CDP, Chrome funds a
    BiDi mapper, and new non-JS implementations are appearing. CDP remains for
    Chrome-specific depth, and Safari is slow. See
    `08-bidi-outlook-2026.md`.
13. **Recommended first release is not "90 actions".** Ship v0.2.0 as
    "connect + snapshot + observe", then interaction, network/contexts, and
    devtools in separate releases.

## What this means for the product

Keep the identity: **the Firefox you already use, over the protocol Firefox
already speaks, with no driver and no second browser**. Do not chase Playwright's
93-tool surface, cross-browser support, or stealth. Compete on:

- real profile, cookies, logins, containers, extensions;
- direct BiDi, no geckodriver/Selenium/Marionette process;
- Firefox-specific capabilities (containers, `moz:debugging`, `moz:profiler`,
  `webExtension`, screencast);
- a compact, token-efficient MCP surface;
- snapshots and actions that work on modern apps (shadow DOM, iframes,
  framework-controlled inputs).
