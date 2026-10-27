# Session layer

Owns the single BiDi session and browsing-context state.

Modules:

- `session-manager.ts` — one `session.new`, idempotent connect, busy error.
- `context-manager.ts` — tab/window tree, active context, event updates.

The context manager merges the live `browsingContext.getTree` snapshot with
event state: a `browsingContext.urlChanged` event can be newer than the tree,
so the event URL is kept until the tree catches up.

Invariants:

- Firefox allows one session per browser. Never call `session.new` in a retry
  loop, and never try to take over another client's session.
- All tools in one server process share the session. Separate server processes
  do not; that requires the future broker.
- Never close user tabs. Cleanup detaches by default.
