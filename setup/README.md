# Setup

For local development, use the cross-platform script:

```bash
pnpm setup
```

This folder is for optional platform-specific helpers only. Do **not** put
machine-specific absolute paths here. If a helper exists, it should only wrap
`pnpm install`, `pnpm build`, `pnpm test`, `pnpm verify:*`, and
`node scripts/dev-smoke.mjs`.

There is no supported in-browser UI toggle that starts the Remote Agent. A
helper may only *launch* Firefox or Zen with `--remote-debugging-port`, and it
must never mutate prefs or profiles silently.

v0.1.4 adds process-based discovery, so `pnpm setup` and `pnpm smoke` should be
able to find a running Firefox or Zen without env vars. `pnpm detect` shows
whether a running Firefox-family process has the Remote Agent on.

Nothing in this folder ships to npm.
