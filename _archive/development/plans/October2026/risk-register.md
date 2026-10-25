# Risk Register — BiDi Browser MCP

**Status:** proposed (2026-10-21). Reviewed at each release boundary.

Scale: likelihood/impact Low/Medium/High/Critical.

| # | Risk | L | I | Trigger | Mitigation |
|---|---|---|---|---|---|
| R1 | Another BiDi client owns the session | High | High | `session.new` returns "Maximum number active sessions" | `BIDI_SESSION_BUSY` with port/profile and fix; document exclusive attach; no retry loop |
| R2 | User expects stealth; `navigator.webdriver` is true | High | Medium | Bot challenges, user surprise | State it in README, `ping`, and error docs; no spoofing; explain dedicated profiles |
| R3 | Firefox version drift breaks commands | High | High | Two-week releases; vendor API changes | Feature detection; FF153/FF158 integration matrix; graceful `UNSUPPORTED_FEATURE` |
| R4 | Discovery fails on portable/custom profiles | Medium | High | Profile file not in known roots | `BIDI_PROFILE_DIR`/`BIDI_WS_URL` escape hatches; parse `profiles.ini`; exact start command in error |
| R5 | Stale `WebDriverBiDiServer.json` points at a dead port | Medium | Medium | Firefox crash/restart | Probe endpoint; ignore closed ports; never trust the file alone |
| R6 | Snapshot misses shadow DOM/iframes/complex ARIA | High | High | Modern apps; agent cannot find element | Shadow traversal, same-origin iframe traversal, accessibility locator fallback, clear truncation metadata |
| R7 | UID stale after navigation/DOM churn | High | Medium | Action fails with invalid `sharedId` | Invalidate on navigation; `STALE_UID` + "take a new snapshot"; no silent retarget |
| R8 | Actionability false positives (covered element, animation) | High | High | Click hits overlay or fails | Two-frame stability, `elementsFromPoint`, scroll/recheck, `ELEMENT_COVERED` with covering element |
| R9 | Framework-controlled inputs ignore direct value set | Medium | High | React/Vue value tracker resets | Native setter + `input`/`change`; key events for short text; verify value |
| R10 | Double-click/click-count BiDi gap | Medium | Medium | `dblclick` handler does not fire | Test on FF158; fallback DOM `dblclick` with warning if needed |
| R11 | Network header/body serialization wrong | Medium | Medium | `setExtraHeaders`/`getData` fails | BytesValue helper + tests; response body size cap; `disownData` |
| R12 | Event buffers grow unbounded | Medium | Low | Noisy page/long session | Ring buffers, drop-oldest warning, configurable caps |
| R13 | Snapshot token bloat | High | Medium | Large app; context overflow | Interactive default, 60K budget, truncation, file overflow, diff mode |
| R14 | Debugger leaves page paused | Medium | High | Cancelled/failed debug action | `devtools` opt-in; resume on cancel/shutdown; `debugState`; no auto-enable |
| R15 | Profiler profile contains secrets | Medium | High | Profile JSON has URLs/tokens | Return path only; opt-in; document sensitivity; optional discard |
| R16 | Extension install is code execution | Low | Critical | User installs arbitrary path | `BIDI_ALLOW_EXTENSION_INSTALL=1` + path under `BIDI_EXTENSION_ROOT`; explicit warning |
| R17 | `browser.close` kills user session | Low | Critical | Agent calls close | Gate behind `BIDI_ALLOW_BROWSER_CLOSE=1`; default not exposed; confirmation text |
| R18 | Remote WebSocket exposed | Low | Critical | `BIDI_WS_URL` non-loopback | Loopback default; `BIDI_ALLOW_REMOTE=1`; warn; no credentials in URL |
| R19 | Prompt injection from page content | High | Medium | Snapshot/console text contains instructions | Treat all page text as untrusted; no automatic tool execution; document |
| R20 | MCP spec/SDK churn | Medium | Medium | New spec revision | Pin SDK 1.32.x; stdio-first; `outputSchema` optional; contract tests |
| R21 | CI has no Firefox | High | Medium | Integration tests skipped | Hermetic MockBiDiServer; recorded fixtures; local integration checklist |
| R22 | Release from wrong branch | Low | High | Tag on `dev` | Existing release workflow guard; release only from `main` |
| R23 | Package ships non-runtime files | Low | Medium | `files` regression | `verify:package` in CI and release |
| R24 | Tool schema/annotation mismatch | Medium | Medium | Action-based tools have mixed semantics | Conservative annotations; per-action docs; contract tests |
| R25 | Screencast files fill disk | Low | Medium | Long recording | Bounded duration, destination folder, cleanup, opt-in |
| R26 | User profile modified unexpectedly | Low | High | Server writes prefs/files | Attach-only; our server writes no prefs/profiles; temp outputs only; no browser launch; document that Firefox Remote Agent applies recommended prefs on the default branch for the session |
| R27 | Firefox not started with remote flag | High | Medium | No discovery file | Exact command in error; no attempt to relaunch |
| R28 | Cross-origin iframe actions | Medium | Medium | Frame not reachable from parent | Per-context snapshot/action; document limitation; `getTree` frame IDs |
| R29 | Download behavior overwrites files | Low | Medium | Destination collision | Timestamped filenames; never delete existing; report path |
| R30 | User context IDs mistaken for containers | Medium | Low | UI shows opaque IDs | Document opaque IDs; list tabs/counts; no name claims |
| R31 | Remote Agent applies automation prefs to the real profile | Medium | Medium | User enables `--remote-debugging-port` and observes changed behavior | Document `remote.prefs.recommended` (true by default, default-branch, not persisted); recommend a dedicated profile for heavy automation; never edit `prefs.js` |
| R32 | Process discovery is platform-dependent and can expose command-line details | Medium | Low | Process scan on Windows/macOS/Linux | Read-only scan; expose only parsed endpoint/profile; unit-test command-line parsing; never kill or relaunch a browser |

## Top five

1. **R1 session conflict** — the product must fail well, not fight.
2. **R6 snapshot quality** — without it, the agent guesses.
3. **R8 actionability** — the main source of "it didn't work".
4. **R3 Firefox drift** — two-week cadence; feature detection and matrix tests.
5. **R16/R17 destructive actions** — gate them; no surprise browser/extension
   changes.

## Review triggers

- Any Firefox stable release that changes BiDi/vendor modules.
- Any change to `session.new` or discovery file format.
- Any new destructive tool/action.
- Any reported actionability failure on a major framework.
- Any MCP spec/SDK minor version bump.
