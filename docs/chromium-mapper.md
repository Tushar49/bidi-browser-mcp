# Design note: Chromium via an in-process mapper

Status: adopted in 0.1.9. Satisfies the AGENTS.md dependency gate for adding
`chromium-bidi`.

## Problem

Firefox-family browsers serve WebDriver BiDi natively. Chromium serves CDP only
on the `--remote-debugging-port` endpoint, so attaching to a running Chrome,
Brave, or Edge requires a translation layer.

## Options considered

| Option | Verdict |
|---|---|
| chromedriver + `webSocketUrl` capability | Rejected: needs an external binary and a driver process; the project is attach-only and install-free. |
| Mapper as a browser extension | Rejected: requires `--load-extension` at launch and a browser restart. |
| Reimplement a BiDi→CDP shim | Rejected: large, untested surface; the mapper already exists and is maintained by the Chromium team. |
| **Host `chromium-bidi`'s mapper in this process** | **Adopted**: zero installs, no browser restart, no second process. |

## How it works

`src/connection/chromium-mapper.ts`:

1. Opens a WebSocket to the browser's CDP endpoint
   (`ws://127.0.0.1:<port>/devtools/browser/<id>`). Discovery gets that URL
   from `DevToolsActivePort`: standard user-data directories are checked, and a
   running Chromium process's `--user-data-dir` is read too, so portable
   launchers that hide the port flag are found without configuration.
2. Builds `MapperCdpConnection` over that socket.
3. Calls `BidiServer.createAndStart(...)` with an in-process `BidiTransport`.
4. Returns a `MapperSocket` facade that implements the subset of the `ws`
   surface `BiDiClient` uses. Commands from `BiDiClient` are fed into the
   mapper; mapper replies are re-emitted as `message` events; a CDP drop
   becomes a socket `close`, which triggers the existing session reset.
   Messages the mapper emits while it is still starting are buffered and
   flushed after `open`, so startup context events are not lost.

`BiDiClient` gains one optional constructor option (`openSocket`) and a
generation guard so an abandoned attempt cannot be revived.

The mapper's `session.new` result is normalized once, in `SessionManager`,
because it is CDP-shaped: `browserName` is a product string
(`Chrome/153.0.8010.53`), `browserVersion` is a CDP revision, and unused fields
are empty strings.

## Dependency

- `chromium-bidi` is an **optionalDependency, pinned exactly**
  (`158.0.8123-0`). The mapper's `MapperCdpConnection` is not exported from the
  package index, so the server deep-imports
  `chromium-bidi/out/Default/gen/src/cdp/CdpConnection.js`. That path is a build
  artifact and may move between versions — hence the exact pin. A failed import
  surfaces as `MISSING_DEPENDENCY` with the install command, never a crash.
- Runtime dependency count otherwise stays `ws` + `@modelcontextprotocol/sdk`.
- License: Apache-2.0 (Google/Microsoft); compatible with this project's MIT.

## Constraints

- Chromium shows a **debugging permission dialog per connection**. The user
  approves it once per server connect; timeouts explain this.
- The mapper reports a synthetic session id (`"unknown"`) and holds no
  browser-side session, so Chromium sessions are never persisted for crash
  recovery (there is nothing to reclaim).
- Firefox-only tools (`context`, `spaces`) keep returning `UNSUPPORTED` on
  Chromium sessions.
- Chromium ports are never probed as BiDi `/session` endpoints: they answer
  403, and a fake candidate would burn the handshake retries (or fail
  discovery on a Chromium-only machine).
- Firefox endpoints are preferred when both families are discovered; set
  `BIDI_WS_URL` to force a specific browser.

## Test strategy

- Hermetic unit tests cover `DevToolsActivePort` parsing, Chromium candidate
  discovery, and `BiDiClient`'s custom-opener path (including the late-open
  guard and socket-drop handling).
- Live verification (no chromedriver): Brave 153 — discovery, `session.new`,
  `browsingContext.getTree` (11 tabs), `script.evaluate` in a live tab, clean
  disconnect. Firefox/Zen regression re-run on every change to `BiDiClient`.
