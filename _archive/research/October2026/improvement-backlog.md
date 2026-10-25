# Improvement Backlog — October 2026

**Status:** proposed. **Date:** 2026-10-21. Ordered by product risk, not by
implementation convenience.

Effort: S ≤ 1 day, M ≤ 3 days, L ≤ 1 week, XL > 1 week.

## P0 — required for a usable v0.2

| # | Item | Why | Effort | Acceptance |
|---|---|---|---|---|
| 1 | Profile-file discovery | CDP discovery does not work; Firefox uses `WebDriverBiDiServer.json` | S | Finds a running Firefox from `BIDI_PROFILE_DIR` and from known profile roots; stale files rejected |
| 2 | `BIDI_WS_URL` validation | Users need an escape hatch; remote must be explicit | S | Loopback default; non-loopback requires `BIDI_ALLOW_REMOTE=1`; `/session` normalized |
| 3 | WebSocket client | Foundation for everything | M | Request IDs, timeouts, events, close/error propagation, no leaked pending promises |
| 4 | Single-session manager | Firefox allows one session | M | Reuses one session; `BIDI_SESSION_BUSY` with actionable fix on conflict |
| 5 | Context manager | Tabs/iframes/user contexts | M | Tree refresh, active tab, navigation invalidation, context-close cleanup |
| 6 | Event pipeline | Console/network/dialogs/downloads | M | Bounded buffers; subscribe once; typed events; drop-oldest warning |
| 7 | Snapshot v1 | Core agent value | L | Interactive mode, UIDs, role/name, bounds/states, shadow DOM, same-origin iframes, 60K budget |
| 8 | UID resolver | Actions need stable refs | M | UID→sharedId, CSS/accessibility fallback, stale UID errors, invalidate on navigation |
| 9 | Click/type/press | Minimum interaction | L | Actionability checks, pointer/key actions, framework-compatible typing, actionable failures |
| 10 | Error taxonomy | Agents need to self-correct | S | Codes + fix text for discovery/session/context/UID/action/dialog/unsupported |
| 11 | MockBiDiServer | Hermetic tests | M | Routes commands, emits events, records requests; tests run in CI |
| 12 | `ping` / `browser` / `tabs` / `page` / `console` / `script` tools | First useful surface | L | All actions call the right BiDi methods; structured results |

## P1 — v0.3/v0.4 product value

| # | Item | Why | Effort | Acceptance |
|---|---|---|---|---|
| 13 | Snapshot diff + text mode | Token savings, change detection | M | Diff ≤ 200 changes; stable hashes; text mode no bounds |
| 14 | Interact v2: select, upload, check/uncheck, drag, hover, tap | Form coverage | L | Each action verifies post-state; upload uses `setFiles`; native chooser cancelled |
| 15 | Form inspect/fill/validate | High-value agent workflow | L | Labels/types/options; fill by label or UID; validation errors surfaced |
| 16 | Network buffer + intercepts | Debugging/mocking | L | Request list/detail, mock/fail/continue, auth, redaction, body cap |
| 17 | Cookies/storage | Session workflows | M | Cookie CRUD; localStorage/sessionStorage via JS; scoped clear |
| 18 | User contexts (containers) | Firefox differentiator | M | Create/list/remove; tabs in context; isolation verified |
| 19 | Emulation + permissions | Testing workflows | M | Geo/locale/timezone/UA/orientation/screen/offline; camera/mic/geo permissions |
| 20 | Screenshot/PDF output mode | Large payloads | S | File + resource link + preview; no base64 inline by default over threshold |
| 21 | Downloads | Real browsing | M | Events, list, set behavior; no user-file deletion |
| 22 | Dialog handling | Prevent stuck sessions | S | `DIALOG_OPEN`; accept/dismiss; beforeunload warning |
| 23 | Actionable reconnect | Long sessions | M | Reconnect on next call; invalidate UIDs; no auto-kill |
| 24 | Output budgets | Context economics | M | 60K default; file overflow; truncation metadata |
| 25 | Integration test suite | Confidence | L | Opt-in real Firefox; local fixture pages; shadow/iframe/context/network |

## P2 — v0.5/v1.0 differentiators

| # | Item | Why | Effort | Acceptance |
|---|---|---|---|---|
| 26 | Debugger (`moz:debugging`) | Firefox-only power feature | L | Enable, scripts, source, breakpoints, step/resume, paused state; opt-in |
| 27 | Profiler (`moz:profiler`) | Performance workflows | M | Start/stop/status; profile path; discard option; no inline blob |
| 28 | Screencast | Evidence/debugging | M | Start/stop; file path; bounded duration; cleanup |
| 29 | Extension install/uninstall/list | Real-profile testing | M | Path allowlist + opt-in; permanent/private flags; list |
| 30 | `input.fileDialogOpened` policy | Native file chooser | S | Cancel + instruct `upload`; no hang |
| 31 | Smart forms | Parity with CDP form tool | L | Country codes, autocomplete, per-type strategies |
| 32 | `script.message` channel | Page→server streaming | M | Subscribe, buffer, cancel; not needed for v1 |
| 33 | Snapshot ARIA improvements | Better names/roles | M | `aria-labelledby`, `aria-owns`, slots, AccName edge cases |
| 34 | Cross-origin iframe snapshots | Modern apps | M | Per-context snapshots; UID prefix; click inside frame |
| 35 | Toolset gating | Safety/context | S | `BIDI_TOOLSET`; extension/browser-close opt-ins |
| 36 | `outputSchema` coverage | MCP compliance | M | Strict for stable tools; loose for mixed; contract tests |
| 37 | Benchmark suite | Performance regressions | M | Snapshot latency/size, 100 actions, event memory |
| 38 | Firefox version matrix CI | Drift detection | L | FF153 ESR + FF158 stable integration jobs, nightly optional |
| 39 | Docs/demo fixture | Adoption | M | README quick start, tool reference, local demo page |
| 40 | MCP Registry publication | Discovery | S | `mcp-publisher` after npm release |

## Do not build

| Item | Reason |
|---|---|
| Chrome/CDP support | Separate `cdp-browser-mcp` product |
| Firefox launcher/bundled browser | Breaks attach-only identity; adds download/update burden |
| Juggler backend | Playwright-specific, patched build, not the user's Firefox |
| Stealth/anti-detect | `navigator.webdriver` is true; dishonest and fragile |
| Full test runner/trace viewer | Playwright owns that |
| MCP Apps UI | No user-facing UI need for v1 |
| Tasks-based background jobs | Short-lived tool calls; screencast can use progress/cancel |
| Full AX tree clone | Firefox does not expose it; DOM snapshot is the design |
| CSS/performance parity with CDP | Out of scope; use `getComputedStyle` selectively |

## Suggested order

```text
v0.2  items 1–12
v0.3  items 13–15, 20, 22, 24
v0.4  items 16–19, 21, 23, 25
v0.5  items 26–30, 34, 35
v1.0  items 31–33, 36–40
```

## Risk-adjusted notes

- Items 1–5 are the difference between "demo" and "works on a real machine".
- Item 7 is the highest-variance work; budget for iteration on real apps.
- Item 9 is the second-highest variance; actionability failures are the main
  source of agent frustration.
- Items 26–29 are impressive but should not delay a reliable core.
- Item 38 is cheap insurance against Firefox's two-week cadence.
