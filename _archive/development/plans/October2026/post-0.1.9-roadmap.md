# Post-0.1.9 Roadmap

Status: live plan (2026-10-27). Supersedes the version mapping in
`revised-roadmap-2026-10-23.md` and the `release-plan-v0.2.0.md` tool list.
Those files stay as history; this one is the current commitment.

## Reality check

0.1.9 shipped 9 tools (`ping`, `browser`, `tabs`, `page`, `console`, `observe`,
`context`, `spaces`, `cleanup`), dual-family discovery, and Chromium via the
in-process `chromium-bidi` mapper. The earlier table called 0.1.9 the "full
tool matrix" — that was not achievable and is deferred. 0.2.0 is now the
automation loop, not a polish pass.

Verified on Firefox 158 (Zen) today: all 21 commands the remaining waves need
are supported — `script.callFunction` / `addPreloadScript`,
`input.performActions` / `releaseActions` / `setFiles`, `storage.getCookies` /
`setCookie`, `network.addIntercept` / `continueRequest`, all six
`emulation.set*Override` + `setNetworkConditions`,
`browsingContext.setViewport` / `startScreencast` / `print` /
`captureScreenshot`, `webExtension.install`, `session.subscribe`. The constraint
is our tool layer, not the browser.

## Packaging decisions (locked)

- `package.json` `engines` stays `>=20.19`. Mirroring the mapper's range would
  refuse Node 22.0–22.11 installs for Firefox-only users, which is the wrong
  trade. Chromium's narrower range is explained at runtime instead.
- `chromium-bidi` stays an exact-pinned `optionalDependency`; the failure path
  names the pin, the same-prefix install, `--omit=optional`, and the Node range
  when relevant. No `postinstall` warning (breaks under `--ignore-scripts`).
- `pnpm verify:release` fails when the code pin and
  `optionalDependencies.chromium-bidi` drift. Clean `npm pack` → `npm i` →
  deep-import load is part of release verification. pnpm was verified too:
  `pnpm add -g <tarball>` installs the optional mapper and the deep import
  resolves; a **separate** `pnpm add -g chromium-bidi` does not (isolated
  virtual store), so pnpm recovery is "reinstall the server" or `pnpm dlx`.
- Rejected: making `chromium-bidi` a hard dependency (Firefox installs would
  pay ~30 MB for a feature they do not use).

## Wave 0 — foundations (before any new tool)

1. **Error taxonomy** in `src/connection/bidi-client.ts`. Every BiDi error is
   currently collapsed to `SESSION_FAILED` (line ~359), so "no such frame" and
   "invalid argument" teach the agent to retry the wrong thing. Store the
   method on each pending request; include `details.biDiCode` and
   `details.method`; map only unambiguous codes:
   `no such frame` → `FRAME_NOT_FOUND`, `no such element`/`node` →
   `ELEMENT_NOT_FOUND`, `unknown command`/`unsupported operation` →
   `UNSUPPORTED`, `no such request`/`intercept` → `NETWORK_ERROR`,
   `move target out of bounds` → `NOT_INTERACTABLE`,
   `detached shadow root` → `STALE_UID`, `invalid argument` →
   `INVALID_ARGUMENT` (keep the raw code). Leave `unknown error` as
   `SESSION_FAILED`. `toContextError` checks `details.biDiCode` first.
2. **UID verification** before dispatch: re-query the snapshot selector,
   compare tag/role/name/bounds, require selector uniqueness; otherwise
   `STALE_UID`/`ELEMENT_NOT_FOUND`. No auto-refresh, no silent retry.
3. **Redact profile paths** in `ping.status`, `browser.status`,
   `browser.profiles` (today they print the Windows user name verbatim).
4. **`bin.ts`** must print `formatError` (code + fix), not just the message.
5. Small fixes while the files are open: `context.tabs-in` returning `[]` for
   the default container; `fitToBudget` escaped-length overshoot.

Exit: new tests for every mapping and the uid check; full suite green.

## Wave 1 — 0.2.0 "Act"

- `interact` (absorbs `form`; there is no BiDi form domain): `click`, `type`,
  `clear`, `press`, `select`, `check`, `upload`, `scroll`. Uses
  `input.performActions` for pointer/key and script for value setting.
  Rules: `input.releaseActions` in `finally`; never auto-retry a mutating
  action; hit-test with `elementFromPoint` and fail `NOT_INTERACTABLE` naming
  the covering element; resolve → verify → dispatch.
- `page.navigate` with `wait: none | domContentLoaded | load`. Today the only
  way to load a URL is `tabs.new`, which leaks tabs.
- `network` (opt-in, read-only): wait for request/response metadata. No
  bodies, no intercepts.
- gated `script.evaluate`: `script.evaluate` makes every other tool optional
  and can read credentials, so it ships behind an explicit flag (name decided
  in implementation: `BIDI_ALLOW_SCRIPT_EVAL` or the `devtools` toolset).
  `script.waitFor` is the safe default helper.

Research gates before code freeze: live-run every action on Firefox 158 and
Chromium 153 (mapper); confirm `input.setFiles` needs a visible file input;
confirm scroll semantics on shadow hosts.

Exit: snapshot → navigate → act → verify loop works on both families; wrong-uid
and covered-element failures are explicit; no leaked pointer state after a
failure.

## Wave 2 — 0.2.x state and environment

- `storage`: cookies first (partition resolved from the target tab's context and
  echoed in the result; `httpOnly` reads gated), then web storage. Reject
  `userContext` partitions on Chromium.
- `emulate` subset: locale, timezone, geolocation — each with a tested
  null-reset; session registry; `cleanup` clears. UA/orientation/network
  conditions deferred until reset behavior is proven.
- Network intercepts: require explicit `contexts`, track ids, auto-remove at
  call end unless `persist: true`, `cleanup` removes all.

Exit: overrides do not leak into later calls; a failed intercept call cannot
leave a request paused.

## Wave 3 — 0.3+ Firefox depth

`extensions` (gated by `BIDI_ALLOW_EXTENSION_INSTALL` + path allowlist),
`devtools` (`moz:debugging` 153+, `moz:profiler` 154+), screencast, preload
scripts/realms. `BIDI_OUTPUT_MODE=file` and the health monitor ride here.

Explicitly dropped: a separate `form` tool (merged), a driver manager (no
drivers exist in this design), Safari (WebKit BiDi is still partial).

## Chromium parity

Waves 0–2 work through the mapper. Firefox-only forever: `context`, `spaces`,
`extensions`, `devtools`, screencast, preload scripts. Dispatch should check a
static capability matrix by family + mapper version and return `UNSUPPORTED`
with the Firefox alternative, not a generic failure.

## Release gates (0.1.9 → main)

- `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm verify:release`,
  `pnpm verify:package` green.
- Clean tarball install in an empty directory: optional dep resolves and the
  mapper loads.
- MCP smoke: `ping`, `browser.profiles`, connect, tabs, snapshot, disconnect.
- Docs match reality: install section, Node range, `--omit=optional`,
  troubleshooting.
- Promote `dev → main`, tag `v0.1.9`, release workflow publishes npm and the
  GitHub Release, then point the local MCP config at the published package.

## Open decisions

- Name the script gate (`BIDI_ALLOW_SCRIPT_EVAL` vs `devtools` toolset).
- Whether cookie reads ship behind a flag or in `core` for 0.2.x.
- Chromium "Allow per connection" prompt: document only (current) or offer a
  copy-paste launch command in the error fix.
