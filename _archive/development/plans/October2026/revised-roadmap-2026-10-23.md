# Revised Roadmap - 2026-10-23

> **Historical.** Superseded by [`post-0.1.9-roadmap.md`](./post-0.1.9-roadmap.md).
> 0.1.9 shipped Chromium plus 9 tools, not the full matrix; the remaining tool
> surface moved to 0.2.0 and later.

Supersedes the release mapping in `implementation-plan.md` from v0.1.7 onward.
Waves 1–3 are done (connect, contexts/events, snapshot). The focus shifts to
Firefox-specific depth, then cross-browser reach, then release.

## Version mapping

| Version | Name | Scope |
|---|---|---|
| 0.1.6 | Snapshot | **Done.** Interactive DOM snapshot, cache, optimizer, `page` tool |
| **0.1.7** | Firefox-specific | Containers (user contexts), Zen spaces, tab folders |
| **0.1.8** | Chromium + optimization | Feature optimization pass + Chrome/Brave/Edge support via Chromium BiDi |
| **0.1.9** | Complete + proven | Full tool matrix on all supported browsers; extreme local cross-browser testing; docs ready → **first public npm release (0.1.9)** |
| **0.2.0** | Polished | De-slop pass: remove dead code, trim excess comments, sober human style, AGENTS.md rules updated to enforce it; fix issues found → release 0.2.0 |

## 0.1.7 — Firefox-specific (containers, spaces, folders)

Firefox-first features no Chromium browser has. All read-only by default;
creation/deletion only behind explicit tool actions.

- **Containers (user contexts)**
  - `browsingContext.create` accepts `userContext` on Firefox 137+.
  - Probe `userContexts.get` / module availability at connect; degrade with an
    `ActionableError` fix when the module is missing.
  - `context` tool: `list` (with friendly names from `containers.json`,
    read-only), `new`, `remove` (gated), `tabs-in`.
- **Zen spaces**
  - No BiDi surface. Research Zen's profile storage (extension storage,
    workspace files) — read-only discovery first, never mutate.
  - Expose `spaces.list` with the tab↔space mapping; switching a space happens
    by activating its tabs, not by writing Zen's storage.
- **Tab folders**
  - Same approach as spaces: profile-file discovery, read-only mapping,
    activate-by-tab. No storage writes.
- Exit criteria: containers provably isolated (storage separation test), Zen
  spaces/folders visible and mapped to tabs, unit + live tests.

## 0.1.8 — Chromium support + optimization

- Chromium BiDi wrapper (per MDN: Chromium needs the BiDi wrapper package;
  Firefox connects natively — keep Firefox the zero-dep path).
- Discovery: Brave/Chrome/Edge DevTools endpoints; `--remote-debugging-port`
  on the Chromium wrapper path. Chrome/Brave CDP is not BiDi; document the
  distinction.
- Optimization pass on 0.1.3–0.1.7 features: buffer sizing, snapshot script
  performance on heavy pages, token budget tuning.
- Exit criteria: same `browser`/`tabs`/`page` surface works on Firefox and one
  Chromium browser with the wrapper.

## 0.1.9 — Complete matrix, extreme testing, docs → RELEASE

- Full planned tool surface across all supported browsers.
- Extreme local testing: Firefox stable/Beta/Nightly/ESR, Zen, LibreWolf,
  Waterfox, Floorp + Chromium matrix; hostile pages (shadow DOM, cross-origin
  iframes, CSP, large DOMs).
- README/CHANGELOG/CONTRIBUTING/TESTING final pass; examples; MCP Registry
  metadata check.
- **Cut the first public npm release: 0.1.9.**

## 0.2.0 — Polish pass → RELEASE

- Remove AI slop: dead code, speculative abstraction, redundant comments.
  Write sober human code; comments only where they earn their place.
- Update `AGENTS.md` with the style rules so the standard is enforced, not
  aspirational.
- Fix any issues found during the polish pass.
- **Release 0.2.0.**
