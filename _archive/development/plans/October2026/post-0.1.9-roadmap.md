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
  names the pin, the manager-specific recovery (npm sibling install vs pnpm
  isolation), `--omit=optional`, and the Node range when relevant. No
  `postinstall` warning (breaks under `--ignore-scripts`).
- `pnpm verify:release` fails when the code pin and
  `optionalDependencies.chromium-bidi` drift. Clean `npm pack` → `npm i` →
  deep-import load is part of release verification. pnpm was verified too:
  `pnpm add -g <tarball>` installs the optional mapper and the deep import
  resolves; a **separate** `pnpm add -g chromium-bidi` does not (isolated
  virtual store), so pnpm recovery is "reinstall the server" or `pnpm dlx`.
- Rejected: making `chromium-bidi` a hard dependency (Firefox installs would
  pay ~30 MB for a feature they do not use).

### Deep-review follow-ups closed before the tag

- Dir-scan `DevToolsActivePort` ports join the exclusion set used by BiDi port
  probes, so a Chromium-only machine cannot surface a 403 `/session` candidate.
- Mapper teardown re-attaches a no-op `error` listener after
  `removeAllListeners()`; an async handshake-abort cannot crash the process.
- `extractUserDataDir` handles the space-separated argv form (`--user-data-dir
  "C:/…"`) and rejects a flag-shaped value (`--user-data-dir --flag`).
- Unit coverage added for `normalizeChromiumCapabilities`, `isModuleNotFound`,
  `MapperSocket` startup buffering/close, and dir-scan port exclusion.
- `verify:release` also checks the pin appears in README and the mapper doc.

### Deferred to 0.2.0 (review leftovers, non-blocking — assigned in §6)

- **Startup buffer overflow signal.** `MapperSocket` caps pending mapper
  messages at 500 and silently drops the newest past that. Surface a bounded
  warning (or count) instead of staying silent; the cap stays.
- **Process-name matching.** Discovery matches known browser names as
  substrings, so `frozen.exe`/`citizen.exe` can match `zen`. Tighten to
  basename equality on Windows and argv[0] basename matching on POSIX.
- **Stale `DevToolsActivePort` suppression.** A dead Chromium profile's port is
  excluded from BiDi probing even if a Firefox actually listens there. Harden
  by cheaply confirming CDP (version endpoint/WS handshake) before excluding.
- **Unused `MapperSocket` export.** Exported for unit tests; it is not reachable
  through the package exports map. Keep it internal or document it as test-only.

## 0.2.0 decisions — locked before Wave 0 code (2026-10-27)

Closed the pre-implementation review. Where a bullet contradicts wave text
below, this section wins.

### 1. Error taxonomy

- Extend `ActionableErrorCode` (`src/types.ts`) with `FRAME_NOT_FOUND`,
  `ELEMENT_NOT_FOUND`, `NOT_INTERACTABLE`, `STALE_UID`. Codes are additive for
  0.1.x clients; note it in the 0.2.0 CHANGELOG entry.
- Distinguishable semantics:
  - `UID_NOT_FOUND` — uid not in the server's snapshot cache (tool level).
  - `STALE_UID` — the browser dropped the internal reference
    (`no such element` / `no such node` / `detached shadow root`), or the
    element at the recorded location no longer matches its identity.
  - `ELEMENT_NOT_FOUND` — the page resolved to zero elements (selector miss in
    verify/hit-test). Never produced from a browser error.
  - `NOT_INTERACTABLE` — covered element, disabled control, or
    `move target out of bounds`; fix text says scroll into view and retry.
- Supersedes the Wave 0 sketch below: browser `no such element/node` maps to
  `STALE_UID`, not `ELEMENT_NOT_FOUND`.
- Mapping happens at receive time in `bidi-client.ts`. Every failure path —
  timeouts and `#failPending` included — stamps `details.method` (the method
  string) and `details.biDiCode` (raw BiDi error string) when one exists.
  Unambiguous mappings only: `no such frame`; `no such element|node`;
  `detached shadow root`; `unknown command`/`unsupported operation` →
  `UNSUPPORTED`; `no such request` → `NETWORK_ERROR` (code kept; the domain
  lands in Wave 2 — documented as "network request/intercept error", never
  connectivity); `move target out of bounds`/`element not interactable` →
  `NOT_INTERACTABLE`; `invalid argument`/`invalid selector` →
  `INVALID_ARGUMENT` (raw preserved); `unknown error` and anything unlisted →
  `SESSION_FAILED` with the raw code in details.
- `toContextError` checks `details.biDiCode` first, then existing messages.

### 2. Script gate

- `BIDI_ALLOW_SCRIPT_EVAL=1` (confirmed). The `script.evaluate` tool stays
  registered and visible; with the flag unset, dispatch returns `UNSUPPORTED`
  whose fix names the flag. Wave 1 ships the unit test.
- Tool-internal script calls (value setting in `interact`, `select`, hit-test,
  uid verification, `script.waitFor` polling) are exempt; the gate guards
  free-form eval executed on the agent's behalf.
- Not the `devtools` toolset (Wave 3 collision).

### 3. UID verification

- Snapshot bounds become document-space coordinates in 0.2.0
  (`getBoundingClientRect + window.scrollX/scrollY` at traverse time). Bounds
  are informational in 0.1.9; changelog notes the semantic change.
- Verify = one `script.callFunction` in the element's own document (recorded
  frame chain + shadow host) returning `{found, tag, rect}`. Compare:
  selector uniqueness inside the anchor context (its document or shadow root;
  never cross-document), `localName` equality, document-space rect size match
  (±4px per axis). Scrolling never invalidates — both sides are document-space.
- Precedence: 0 matches → `ELEMENT_NOT_FOUND`; ambiguous (>1 in anchor
  context) → `STALE_UID`; resolved but mismatched → `STALE_UID`; uid unknown
  to the snapshot → `UID_NOT_FOUND`. No auto-refresh; fix text always says
  "take a fresh page snapshot and retry".

### 4. Iframe/shadow dispatch + hit-test

- `input.performActions` dispatches into the element's own browsing context
  (frame chain), coordinates computed in that context at dispatch time.
- The coverer name comes from `elementFromPoint` run in the element's owner
  document. If the coverer is an iframe crossing or a `<slot>`/shadow
  boundary, the fix text says so instead of naming an inner element.
- Research-gate additions (both families): click inside a same-origin iframe;
  scroll a shadow host; covered click through the Chromium mapper; `setFiles`
  on visible vs hidden inputs; flat error shapes for stale elements from the
  mapper (may differ from Firefox — verified per family).

### 5. Per-action contracts (Wave 1 acceptance)

- click: covered → `NOT_INTERACTABLE` naming the coverer; pointer/key sources
  released in `finally` — no leaked input state after a failure.
- type: per-character key actions appended to a single `performActions` call
  (real key events, controlled components stay correct); result echoes the
  final value read back from the element.
- clear: click + select-all + Backspace (keyboard only, controlled-safe).
- press: one named key down/up; unknown key → `INVALID_ARGUMENT` naming keys.
- select: option resolved by exact value, then label, then index; set via
  script + input/change events (tool-internal, gate-exempt); echoes selection.
- check: checkbox/radio only (`UNSUPPORTED` otherwise); toggles via click;
  `checked` is read fresh — cache invalidated, never trusted.
- upload: `input.setFiles` on an `<input type=file>` only; result reports the
  file count; the visibility constraint follows the research matrix.
- scroll: element → `scrollIntoView({block:'nearest'})`; page → wheel dy on a
  wheel source; shadow hosts allowed; result reports the new position.
- page.navigate: `wait: none | domContentLoaded | load` binds to the matching
  `browsingContext` events; navigation failure → `NAVIGATION_FAILED`; every
  snapshot-cache entry for the context is invalidated.
- network: `BIDI_ENABLE_NETWORK=1` (confirmed); one additive second
  subscription; bounded per-method ring buffer (200 events, surfaced in
  stats); wait actions (`until: request|response`, `method`, `urlPattern`,
  timeout) return metadata only — no bodies, no intercepts.
- script.waitFor: server-side poll of short `callFunction` calls (per-call
  timeout ≤ client timeout, 250ms interval, 120s overall cap).
- Snapshot cache invalidates after any action that dispatched
  `performActions` (success or failure) and after `navigate`.

### 6. Deferred leftovers — assigned

- Startup-buffer overflow signal → Wave 1 (mapper files; warn, cap stays).
- Process-name substring matching → Wave 0 (discovery files).
- Stale `DevToolsActivePort` suppression (cheap CDP liveness confirm) →
  Wave 1 research matrix plus fix.
- `MapperSocket` export stays; a jsdoc note marks it test-only (Wave 0).

### 7. Release gates (0.2.0)

The 0.1.9 gates, plus: research matrix committed; README tool listing and
annotations for every new tool (mutating actions declare
`readOnlyHint: false`); CHANGELOG entries including the "new error codes are
additive" note; MCP smoke covers interact's happy path and a
`NOT_INTERACTABLE` failure path on both families.

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
   (Pre-review sketch — superseded by decisions §1: `no such element/node`
   maps to `STALE_UID`, `NOT_INTERACTABLE` also covers out-of-bounds, and
   every failure path stamps `details.method`/`details.biDiCode`.)
2. **UID verification** before dispatch: re-query the snapshot selector,
   compare tag/role/name/bounds, require selector uniqueness; otherwise
   `STALE_UID`/`ELEMENT_NOT_FOUND`. No auto-refresh, no silent retry.
   (Full mechanics locked in decisions §3 — document-space bounds, ±4px
   tolerance, anchor-context uniqueness, precedence table.)
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
  bodies, no intercepts. (Locked in decisions §5: `BIDI_ENABLE_NETWORK=1`,
  one additive subscription, 200/method ring, metadata-only waits.)
- gated `script.evaluate`: `script.evaluate` makes every other tool optional
  and can read credentials, so it ships behind an explicit flag (name decided
  in implementation: `BIDI_ALLOW_SCRIPT_EVAL` or the `devtools` toolset).
  `script.waitFor` is the safe default helper.
  (Locked in decisions §2: `BIDI_ALLOW_SCRIPT_EVAL=1`, tool visible, gated
  dispatch returns `UNSUPPORTED` naming the flag; tool-internal scripts exempt.)

Research gates before code freeze: live-run every action on Firefox 158 and
Chromium 153 (mapper); confirm `input.setFiles` needs a visible file input;
confirm scroll semantics on shadow hosts. Extended by decisions §4: iframe
click, shadow-host scroll, covered click through the mapper, and mapper flat
error shapes — recorded as a committed per-action × family matrix with the
observed error codes.

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
