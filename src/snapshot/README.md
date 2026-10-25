# Snapshot layer

Owns DOM capture, UID resolution, and token budgeting.

Modules:

- `dom-snapshot.ts` — injected traversal, computed role/name, shadow/iframe
  piercing. Never reads live field values; password inputs are marked
  `masked`.
- `cache.ts` — per-context snapshot + UID map, invalidated on navigation
  (`domContentLoaded`, `urlChanged`) and on context close.
- `element-resolver.ts` — UID → element, plus a pure resolution plan
  (frame chain, shadow host, selector) for the interaction wave.
- `token-optimizer.ts` — progressive truncation of the whole payload
  (url, title, elements, text) into a character budget.

Invariants:

- There is no full accessibility-tree command in Firefox BiDi. Use DOM
  traversal; `browsingContext.locateNodes` is a resolver, not the snapshot.
- UIDs are session-scoped and invalid after navigation or DOM replacement.
- Never inline secrets or huge payloads. The overflow-to-file path
  (`BIDI_TEMP_DIR`) is not implemented yet: `BIDI_OUTPUT_MODE=file` is rejected
  at startup, and a single snapshot payload is capped at 1 MiB.
