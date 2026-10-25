# To Be Implemented — Future Work

**Status:** parking lot (2026-10-21). Not committed to a release. Each item
needs research, a design note, and an explicit go/no-go before code.

## A. Cross-browser backends

| Item | Why | Notes |
|---|---|---|
| `BrowserBackend` interface | Avoid Firefox assumptions leaking into tools | Define now; implement only Firefox in v1 |
| Chromium backend (Chrome) | User asked for Chrome/Brave control | ChromeDriver BiDi, `debuggerAddress` attach, version-matched driver |
| Edge backend | Chromium family | msedgedriver; likely same code path as Chrome |
| Brave backend | Chromium family | ChromeDriver + Brave binary/debug address; experimental |
| Opera/Vivaldi | Chromium family | Best-effort; unverified |
| Safari backend | User asked | Deferred; WebKit BiDi is experimental/partial, safaridriver only |
| Driver manager | Chrome/Edge need drivers | Optional, no new hard dependency in core; detect user-installed driver first |
| Capability registry | Commands differ per browser/version | Tools ask capabilities, not browser names |
| Cross-browser test matrix | Prevent assumptions | Firefox 153/158; Chrome/Edge current; Brave best-effort; Safari future |

See [`../../../research/October2026/06-cross-browser-bidi.md`](../../../research/October2026/06-cross-browser-bidi.md).

## B. Session broker / multi-client

| Item | Why | Notes |
|---|---|---|
| Local broker daemon | One BiDi session shared by multiple MCP clients | Unix socket/named pipe + token; no TCP by default |
| MCP server `--attach` mode | Several stdio servers connect to one broker | Broker owns session; clients send commands |
| Client identity + permissions | Prevent one agent from closing another's tabs | Per-client tab ownership, read-only mode |
| Broker lifecycle | Avoid orphan processes | Idle timeout, PID file, clean shutdown |
| Broker auth | Local security | Random token in user-only file; reject remote |
| Multi-Firefox routing | Several profiles/ports | Named instances; explicit selection |

Current behavior is one server process, exclusive session. Do not advertise
"shared by all AIs" until this ships.

## C. Launch and browser lifecycle

| Item | Why | Notes |
|---|---|---|
| Launch Firefox with a chosen profile | Zero-setup onboarding | `--remote-debugging-port=0`, `-no-remote`, dedicated profile |
| Launch Firefox private window | User request | Separate process/profile; not a container |
| Launch Chromium incognito | User request | ChromeDriver `--incognito` or BiDi user context |
| Firefox-family attach (Zen, LibreWolf, Waterfox, Floorp) | Firefox-based browsers likely share the same Remote Agent | Verify BiDi endpoint/profile discovery per browser; treat as Firefox-like backend, not a new protocol |
| Launcher helper with `remote.prefs.recommended=false` | Reduce automation pref changes | Optional helper only; never silently edit `prefs.js` |
| Profile mutation guard | Protect the real profile | Warn/refuse default profile unless `BIDI_ALLOW_PROFILE_MUTATION=1`; document Remote Agent behavior |
| Process discovery | Find a running Firefox reliably | v0.1.4: command line + profile file + common ports; read-only scan |
| Graceful browser close | Cleanup | Gated; never default |
| Update/channel detection | Version matrix | Stable/Beta/Nightly/ESR; show version |
| Portable Firefox support | Windows users | Profile under install dir; custom paths |

## D. Firefox-specific depth

| Item | Why | Notes |
|---|---|---|
| Cross-origin iframe snapshots/actions | Modern apps | Per-context snapshots + UID prefixes |
| Shadow DOM v2 (slots, nested roots) | Modern apps | Current traversal covers open roots; test slots |
| `script.message` channels | Page→server streaming | Useful for long-running instrumentation |
| `input.fileDialogOpened` auto-cancel | Prevent hangs | Cancel + instruct `upload` |
| Print/PDF tool | Save page as PDF | Mozilla added `print_page`; map to `browsingContext.print` |
| Raw `bidi.command` escape hatch | Unsupported gaps | `devtools` only; validate method allowlist; no raw CDP |
| Screencast polish | Evidence/debugging | Bounded duration, destination folder, cleanup |
| Profiler viewing | Make profiles useful | Return path + optional summary; never inline secrets |
| Debugger call frames/evaluate-on-frame | Full debugger UX | `moz:debugging.paused` payload; verify FF158 |
| Extension allowlist UI | Safer installs | Path root, signature/ID checks, warning |
| Container names | UX | Firefox returns opaque IDs; no name API found |
| `setBypassCSP` | Testing | Wait for Firefox support; do not fake it |
| `emulation.setMediaFeaturesOverride` | Dark/light/contrast testing | Firefox 159+; feature-detect |
| WebSocket frame inspection | Network depth | Not in BiDi network yet |
| Heap snapshots / CSS domain | DevTools parity | Not in BiDi; use `getComputedStyle` selectively |

## E. Agent UX and MCP

| Item | Why | Notes |
|---|---|---|
| MCP Apps dashboard | Visual session/tab control | Official extension; sandboxed UI |
| Tasks for screencast/profiler | Long-running work | `io.modelcontextprotocol/tasks`; needs cancellation/lifecycle |
| Progress notifications | Snapshot/navigation waits | SDK support; 500ms cadence |
| Tool annotations audit | Client trust/safety | Per-action risk docs; conservative hints |
| `outputSchema` coverage | Typed clients | Strict for stable tools; contract tests |
| Prompt-injection warnings | Page text is untrusted | Mark content, never auto-execute tool calls from page text |
| Confirmation gates | Competitors `gaze`/`firefox-mcp` gate writes | Ask before write actions; per-client opt-out for trusted agents |
| Domain allowlist | Limit blast radius | Optional allow/deny list for navigate/interact |
| Prompt-injection fencing | Competitor pattern | Wrap page text as untrusted; scan for instruction-like content |
| Read-only mode | Safe inspection | Disable interact/network/storage/cleanup |
| Permission profiles | Client-specific toolsets | `core`/`network`/`devtools` + custom allowlist |
| MCP registry categories | Discovery | Keep `server.json` current |

## F. Testing and operations

| Item | Why | Notes |
|---|---|---|
| Record/replay fixtures | Hermetic tests from real FF158 | Strip IDs/paths; store JSON |
| Mutation/fuzz tests | Snapshot/actionability resilience | Random DOM mutations, overlays, animations |
| Performance budgets | Snapshot latency/size | 100/500/1000 nodes; fail CI on regression |
| Crash/restart recovery | Real-world reliability | Detect session loss, re-discover, re-auth |
| Windows path tests | Primary platform | Spaces, portable installs, `%APPDATA%` |
| WSL/remote broker | Cross-environment | Localhost forwarding; no remote by default |
| Firefox Nightly matrix | Early warning | Optional, non-blocking |
| Error message catalog | Consistency | One code per failure; docs generated |

## G. Deliberately not planned

| Item | Reason |
|---|---|
| Stealth/anti-detect | `navigator.webdriver=true`; dishonest and fragile |
| Opt-in `navigator.webdriver` spoof | No BiDi command clears it; only a preload `Object.defineProperty` can mask it, and it is fragile/detectable. Not planned unless the user explicitly overrides this policy |
| Bundled patched Firefox | Breaks attach-only identity; Playwright already does it |
| Full cross-browser parity in v1 | Driver + feature matrix would delay the core |
| Test runner/trace viewer | Playwright owns that |
| Cloud browser hosting | Local profile attach is the product |
| Chrome extension relay | Chromium backend can use capabilities; not Firefox |

## Promotion rule

An item moves from this file into a release plan only when it has:

1. a concrete user story;
2. a protocol/source citation;
3. a capability/fallback decision;
4. a test that fails before implementation;
5. an explicit release target.

Otherwise it stays here.
