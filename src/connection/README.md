# Connection layer

Owns the WebSocket transport and browser discovery for both families.

Modules:

- `bidi-client.ts` — JSON-RPC framing, request IDs, timeouts, events, and the
  optional in-process socket opener.
- `browser-discovery.ts` — Firefox profile-file / `profiles.ini` / process
  command-line / common-port candidates plus Chromium `DevToolsActivePort`
  (standard dirs and running-process `--user-data-dir`); endpoints are always
  probed before use.
- `chromium-mapper.ts` — hosts the optional `chromium-bidi` mapper in-process
  over CDP and exposes the `ws`-compatible socket `BiDiClient` expects.
- `event-pipeline.ts` — event buffering and subscription fan-out.

Planned modules:

- `health-monitor.ts` — ping, reconnect state, session loss.
- `index.ts` — public connection API used by `session/`.

Invariants:

- One WebSocket, one BiDi session.
- No `process.env` reads here; use `Config`.
- No retries that create a second session. Return `BIDI_SESSION_BUSY` instead.
- Process discovery is read-only; never launch, mutate, or kill the browser.
