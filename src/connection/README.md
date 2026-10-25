# Connection layer

Owns the WebSocket transport and Firefox-family discovery.

Modules:

- `bidi-client.ts` — JSON-RPC framing, request IDs, timeouts, events.
- `browser-discovery.ts` — profile-file, `profiles.ini`, process command-line,
  and common-port candidates; endpoints are always probed before use.

Planned modules:

- `health-monitor.ts` — ping, reconnect state, session loss.
- `index.ts` — public connection API used by `session/`.

Invariants:

- One WebSocket, one BiDi session.
- No `process.env` reads here; use `Config`.
- No retries that create a second session. Return `BIDI_SESSION_BUSY` instead.
- Process discovery is read-only; never launch, mutate, or kill the browser.
