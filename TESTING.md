# Testing `bidi-browser-mcp`

Quick test loop for the dev branch. **Do not commit machine-specific paths.**

## 1. What to turn on

Firefox-family browsers need the Remote Agent. Use Firefox or a Firefox-family
browser such as Zen.

If another browser is already listening on port `9222`, use a different port for
Firefox/Zen. For example, `9223`.

`pnpm detect` only scans Firefox-family processes. A Chromium-based browser such
as Brave may still occupy port `9222`, but that is not a BiDi endpoint.

### Firefox

```powershell
# Windows
& "C:\Program Files\Mozilla Firefox\firefox.exe" --remote-debugging-port=9223
```

```bash
# macOS / Linux
firefox --remote-debugging-port=9223
```

### Zen Browser

```powershell
# Windows
& "C:\Program Files\Zen Browser\zen.exe" --remote-debugging-port=9223
```

If you want a dedicated test profile, use `-no-remote -profile <path>`. Do **not**
use `-no-remote` if you want your normal profile.

### about:debugging is not enough

`about:debugging#/setup` connects Firefox DevTools to another browser. It does
not create the BiDi endpoint this MCP server uses. Firefox currently has no
supported UI/pref toggle to start the Remote Agent; the supported path is still
launching the browser with `--remote-debugging-port`.

Process-based discovery is in, so a running Firefox or Zen with the flag
can be found without env vars. We never relaunch or mutate the browser from the
server. The smoke script runs full `discoverBrowsers()` — profile files,
process command lines, and common loopback ports.

We only care about:

```text
ws://127.0.0.1:9223/session
```

## 2. No env vars needed

The smoke script auto-detects Firefox or Zen profiles and tries the usual
loopback ports. If you want to override it, use:

```powershell
$env:BIDI_WS_URL = "ws://127.0.0.1:9223/session"
```

or:

```powershell
$env:BIDI_PROFILE_DIR = "C:/path/to/profile"
```

## 3. Fast smoke test

This script only calls `session.status`. It never takes over the session, so it
is safe while Firefox is open.

```powershell
pnpm build
pnpm smoke
```

If you want a full one-shot setup instead:

```powershell
pnpm setup
```

Expected output is `session.status ok` and the reported browser name/version.

## 3.1 Running browser processes

`pnpm detect` shows Firefox-family processes and whether the Remote Agent port
is on:

```powershell
pnpm detect
```

`off` means the browser is running without `--remote-debugging-port`. In that
case there is nothing to attach to.

## 4. MCP-level test

OpenCode local config should point at the local build, not npm:

```jsonc
"bidi-browser": {
  "type": "local",
  "command": [
    "node",
    "<absolute-path-to-repo>/dist/bin.js"
  ]
}
```

Then:

1. `pnpm build`
2. restart the `bidi-browser` MCP server in OpenCode
3. call `ping.status`

`ping.status` reports the real Firefox attach state (connected/disconnected).

## 5. Mock-only test loop

When Firefox is not running, run the hermetic suite:

```powershell
pnpm test
```

All unit tests use `MockBiDiServer`; no real browser is needed.

## 6. Common mistakes

| Symptom | Fix |
|---|---|
| Connection refused | Firefox is not running with the remote port |
| Wrong endpoint | `BIDI_WS_URL` and the Firefox port disagree |
| Session busy | Another BiDi client already owns the session |
| about:debugging thinks it is connected | That is DevTools, not this MCP server |

## 7. Next

v0.1.4 added discovery from `<profile>/WebDriverBiDiServer.json` and a real
`browser.status`. Beyond that, the smoke script and MCP Inspector are enough.
