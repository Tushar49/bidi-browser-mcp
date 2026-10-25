<p align="center">
  <h1 align="center">BiDi Browser MCP Server</h1>
  <p align="center">
    <strong>Control your real Firefox over the W3C standard protocol.</strong><br>
    Keep your cookies. Keep your sessions. Keep your containers.
  </p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.7-blue" alt="Version">
  <img src="https://img.shields.io/badge/status-connect-orange" alt="Status">
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node">
  <img src="https://img.shields.io/badge/license-MIT-yellow" alt="License">
</p>

---

## Status

v0.1.8 hardening + Chromium path. The stdio MCP server boots and exposes
`ping`, `browser`, `tabs`, `page` (snapshot/content), `console`, `observe`,
`context` (containers), `spaces` (Zen), and `cleanup`. Socket drops clear
session state honestly and the next connect recovers; Chromium runs through
the chromium-bidi mapper with Firefox-only tools gated. The full matrix and
docs land in v0.1.9 — the first public npm release.

v1 attaches to a Firefox you start; it does not launch, profile-manage, or close
the browser. Launch/private/incognito control is future work.

The full design and protocol research ship on the `dev` branch. `main` carries
product code and release artifacts only.

## Why BiDi

Firefox removed CDP in Firefox 141. WebDriver BiDi is the W3C standard that
replaced it, and it is native in Firefox 129+ — no driver binary, no
Puppeteer/Playwright, no browser download.

Firefox-family browsers such as Zen, LibreWolf, Waterfox, and Floorp should work
once their Remote Agent is enabled; profile discovery still needs testing per
browser.

This server connects to an **already-running Firefox** over its native BiDi
WebSocket. Your logins, cookies, extensions, and containers stay intact.

## Planned surface

16 action-based tools, roughly 110 actions. The default `core` toolset is 10
tools; `network` and `devtools` are opt-in.

`ping` · `browser` · `tabs` · `page` · `script` · `interact` · `form` ·
`network` · `storage` · `emulate` · `console` · `observe` · `context` ·
`extensions` · `cleanup` · `devtools`

Firefox-specific capabilities:

- **User contexts** - isolated containers / storage (not the same as a private
  window)
- **Web extension install/list/uninstall** (install is opt-in and path-gated)
- **Preload scripts** and script realms
- **Debugger and profiler** - `moz:debugging` (Firefox 153+) and
  `moz:profiler` (Firefox 154+), opt-in `devtools` toolset
- **Screencast** - Firefox 154+

Not available in BiDi (compared with CDP): full accessibility tree, CSS domain,
heap snapshots, network/CPU throttling, touch emulation. Debugger and profiler
are Firefox vendor modules, not part of the core W3C command set, and do not
exist in every browser.

## Cross-browser roadmap

v1 is Firefox-only because Firefox is the only browser that exposes a native
BiDi endpoint we can attach to without a driver. Chrome, Edge, and Brave expose
BiDi through ChromeDriver/EdgeDriver; Safari is experimental and partial. A
backend seam is planned, but "one BiDi server for every browser" is not a v1
claim.

## Requirements

- Node.js 20.19+
- Firefox 129+ for the core surface; 153 ESR recommended; 158+ for the full
  surface (debugger, profiler, screencast, newer emulation)
- Two runtime dependencies: `ws`, `@modelcontextprotocol/sdk`

## Chromium browsers (Chrome, Brave, Edge, …)

Chromium does not speak WebDriver BiDi natively yet — `--remote-debugging-port`
exposes CDP, which is a different protocol. The bridge is the
[chromium-bidi mapper](https://github.com/GoogleChromeLabs/chromium-bidi):

1. Launch Chromium with `--remote-debugging-port=<port>`.
2. Run the mapper (requires chromedriver; see the repo's examples README).
3. Point this server at the mapper: `BIDI_WS_URL=ws://127.0.0.1:<mapper-port>/session`.

`ping`, `browser`, `tabs`, `page`, `console`, `observe`, and `cleanup` work
through the mapper. Firefox-family features (`context`, `spaces`) refuse with
a clear `UNSUPPORTED` error on non-Firefox sessions, and `pnpm detect` marks
Chromium processes `[cdp-only]`.

## Start Firefox with BiDi

```powershell
# Windows
& "C:\Program Files\Mozilla Firefox\firefox.exe" --remote-debugging-port=9222
```

```bash
# macOS / Linux
firefox --remote-debugging-port=9222
```

BiDi endpoint: `ws://127.0.0.1:9222/session`

Firefox sets `navigator.webdriver === true` whenever the Remote Agent is
enabled. This is not a stealth or anti-detection tool; some sites may challenge
the session. There is no spoofing layer.

## Test it now

For a quick endpoint check, use [`TESTING.md`](./TESTING.md). Short version:

```powershell
& "C:\Program Files\Mozilla Firefox\firefox.exe" --remote-debugging-port=9223
pnpm build
pnpm smoke
```

The smoke script calls `session.status` only; it does not take over the session.
`about:debugging` is not used by this MCP server.

To see whether a running Firefox-family process has the Remote Agent on:

```powershell
pnpm detect
```

## Install

v0.1.3 is a local carcass and is not published. Use **Build from source** below.
The first public npm release is planned as v0.2.0.

Once published:

```bash
npm install -g bidi-browser-mcp
```

Or reference it from an MCP client without a global install:

```json
{
  "mcpServers": {
    "bidi-browser": {
      "command": "npx",
      "args": ["-y", "bidi-browser-mcp@latest"]
    }
  }
}
```

The published package contains only compiled `dist/` plus `README`, `LICENSE`,
and `package.json`. Repository docs, tests, and build scripts are not installed.

## Setup

One-shot install/build/test/verify:

```bash
pnpm setup
```

If Firefox or Zen is running with `--remote-debugging-port`, this also probes the
BiDi endpoint automatically. No env vars are required for the common case.

Process-based discovery finds a running Firefox or Zen without env vars. There
is no supported in-browser toggle to start the Remote Agent.

## Build from source

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

Point your MCP client at `dist/bin.js` while developing. Use an absolute path in
your local client config; do not commit it:

```json
{
  "mcpServers": {
    "bidi-browser": {
      "command": "node",
      "args": ["<absolute-path-to-repo>/dist/bin.js"]
    }
  }
}
```

After `pnpm build`, restart the MCP server so it loads the new `dist/`. Once the
package is published, replace the dev entry with
`pnpm dlx bidi-browser-mcp@latest` (or a global install).

## Configuration

Only the variables below are read by v0.1.7. Connection/session variables land
with v0.2.0. `BIDI_OUTPUT_MODE=file` is not implemented yet and is rejected at
startup; the allow flags are reserved for later waves.

| Variable | Default | Description |
|---|---|---|
| `BIDI_HOST` | `127.0.0.1` | BiDi WebSocket host |
| `BIDI_PORT` | `9222` | BiDi WebSocket port |
| `BIDI_WS_URL` | auto | Override full WebSocket URL |
| `BIDI_PROFILE_DIR` | auto | Firefox profile directory for discovery |
| `BIDI_APP_DATA_ROOT` | `%APPDATA%` | App-data root used for profile discovery |
| `BIDI_TIMEOUT` | `30000` | Command timeout (ms) |
| `BIDI_TOOLSET` | `core` | `core`, `network`, or `devtools` |
| `BIDI_OUTPUT_MODE` | `full` | `full` (no inline cut; snapshots capped at 1 MiB) or `inline` (fit `BIDI_MAX_INLINE_LEN`); `file` is rejected |
| `BIDI_MAX_INLINE_LEN` | `60000` | Max inline response chars |
| `BIDI_TEMP_DIR` | `.temp` | Temp file directory — parsed and validated, but no temp files are written yet (reserved for later waves) |
| `BIDI_ALLOW_EXTENSION_INSTALL` | `false` | Gate extension install |
| `BIDI_ALLOW_BROWSER_CLOSE` | `false` | Gate `browser.close` |

## Safety limits

- Snapshots never read live field values. Passwords, tokens, and typed text
  stay out of the snapshot, the agent context, and client logs.
- `tabs.new` opens `http:`, `https:`, and `about:blank` only. `file:`, `data:`,
  `javascript:`, and `blob:` are rejected — they would turn the browser into a
  local-file or script reader.
- `context.remove` needs `confirm: true`; it deletes the container with its
  tabs, cookies, and storage.
- Non-loopback endpoints need `BIDI_ALLOW_REMOTE=1` — the gate covers every
  discovered candidate, including profile files.

## Architecture

```
src/
├── bin.ts          # CLI entry (shebang) → dist/bin.js
├── index.ts        # public API: createServer(), VERSION
├── config.ts       # env-based config (only env reader)
├── types.ts        # shared contracts
├── connection/     # planned: BiDi client, discovery, health, event pipeline
├── session/        # planned: single-session manager, context manager
├── snapshot/       # planned: JS DOM snapshots, cache, refs, token optimizer
├── tools/          # defineTool, registry, ping, browser, tabs, page, console, observe, cleanup
├── utils/          # errors, result envelope, argument guards
└── __tests__/      # hermetic unit tests + MockBiDiServer
```

Firefox allows only one BiDi session at a time, so the server reuses a single
session instead of copying CDP's multi-session model. A second client gets
`BIDI_SESSION_BUSY`, not a retry loop. All tools in **one server process** share
the session; separate MCP server processes need the future broker. BiDi has no
full accessibility-tree API, so snapshots are built with `script.evaluate` plus
DOM traversal.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [AGENTS.md](./AGENTS.md). Work
happens on `dev`; PRs target `dev`, and releases are cut from `main`.

## License

MIT © 2026 Tushar Agarwal
