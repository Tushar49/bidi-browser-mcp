<p align="center">
  <h1 align="center">BiDi Browser MCP Server</h1>
  <p align="center">
    <strong>Control your real Firefox over the W3C standard protocol.</strong><br>
    Keep your cookies. Keep your sessions. Keep your containers.
  </p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/status-pre--alpha-orange" alt="Status">
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node">
  <img src="https://img.shields.io/badge/license-MIT-yellow" alt="License">
</p>

---

## Status

Pre-alpha scaffold. The stdio MCP server boots and the repository/release
infrastructure is in place; the connection, session, snapshot, and tool modules
land next. No tools are exposed yet.

The full design and protocol research ship on the `dev` branch. `main` carries
product code and release artifacts only.

## Why BiDi

Firefox removed CDP in Firefox 141. WebDriver BiDi is the W3C standard that
replaced it, and it is native in Firefox 129+ — no driver binary, no
Puppeteer/Playwright, no browser download.

This server connects to an **already-running Firefox** over its native BiDi
WebSocket. Your logins, cookies, extensions, and containers stay intact.

## Planned surface

15 action-based tools, roughly 90 actions:

`ping` · `browser` · `tabs` · `page` · `script` · `interact` · `form` ·
`network` · `storage` · `emulate` · `console` · `observe` · `context` ·
`extensions` · `cleanup`

BiDi-only capabilities:

- **User contexts** — isolated containers / incognito storage
- **Web extension install/uninstall**
- **Preload scripts** and script realms

Not available in BiDi (compared with CDP): JavaScript debugger, performance and
memory profiling, accessibility tree, user-agent override, network/CPU
throttling, touch emulation, CSS manipulation.

## Requirements

- Node.js 20.19+
- Firefox 129+ (BiDi is built in)
- Two runtime dependencies: `ws`, `@modelcontextprotocol/sdk`

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

## Install

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

## Build from source

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

Point your MCP client at `dist/bin.js` while developing.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `BIDI_HOST` | `127.0.0.1` | BiDi WebSocket host |
| `BIDI_PORT` | `9222` | BiDi WebSocket port |
| `BIDI_WS_URL` | auto | Override full WebSocket URL |
| `BIDI_TIMEOUT` | `30000` | Command timeout (ms) |
| `BIDI_SESSION_TTL` | `300000` | Session TTL (ms) |
| `BIDI_OUTPUT_MODE` | `full` | `full`, `inline`, or `file` |
| `BIDI_MAX_INLINE_LEN` | `60000` | Max inline response chars |
| `BIDI_CLEANUP_STRATEGY` | `detach` | `close`, `detach`, or `none` |
| `BIDI_TEMP_DIR` | `.temp` | Temp file directory |
| `BIDI_BROWSER` | `firefox` | Browser type (v1: Firefox only) |
| `BIDI_BROWSER_PATH` | auto-detect | Path to the Firefox binary |

## Architecture

```
src/
├── bin.ts          # CLI entry (shebang) → dist/bin.js
├── index.ts        # public API: createServer(), VERSION
├── config.ts       # env-based config
├── types.ts        # shared contracts
├── connection/     # BiDi client, discovery, health, event pipeline
├── session/        # single-session manager, browsing-context manager
├── snapshot/       # JS DOM snapshots, cache, element refs, token optimizer
├── tools/          # action-based tool registry and handlers
└── utils/          # errors, response builder, wait, temp files
```

Firefox allows only one BiDi session at a time, so the server reuses a single
session instead of copying CDP's multi-session model. BiDi has no
accessibility-tree API, so snapshots are built with `script.evaluate` plus DOM
traversal.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [AGENTS.md](./AGENTS.md). Work
happens on `dev`; PRs target `dev`, and releases are cut from `main`.

## License

MIT © 2026 Tushar Agarwal
