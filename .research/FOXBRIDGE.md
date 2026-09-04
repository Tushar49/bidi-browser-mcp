# Foxbridge — CDP-to-Firefox Protocol Proxy

- **Repo**: [github.com/VulpineOS/foxbridge](https://github.com/VulpineOS/foxbridge)
- **Language**: Go
- **License**: MIT
- **Status**: Active (379 passing Go tests, 74/74 Puppeteer Juggler tests, 62/62 Puppeteer BiDi tests)

## What It Does

Foxbridge translates Chrome DevTools Protocol (CDP) commands into Firefox's native protocols — either **Juggler** (Playwright's pipe-based protocol) or **WebDriver BiDi** (W3C standard). Any CDP-native tool (Puppeteer, Playwright CDP mode, browser-use, OpenClaw) can control Firefox-based browsers through Foxbridge without modification.

`	ext
CDP Client (Puppeteer, OpenClaw, etc.)
  │
  ▼ WebSocket (ws://localhost:9222)
┌────────────────────────────────────┐
│ foxbridge                          │
│  CDP Server + HTTP Discovery       │
│  Bridge Layer (method translation) │
│  ├── Juggler Backend (pipe FD 3/4) │
│  └── BiDi Backend (WebSocket)      │
└────────────────────────────────────┘
  │
  ▼
Firefox / Camoufox
`

## Why It Exists

- Anti-detect browsers like **Camoufox** are Firefox-based (better fingerprint randomization)
- Most AI agent tools only speak CDP
- No existing tool bridged CDP to Firefox's protocols
- Firefox removed native CDP in FF 141

## Architecture (Go source code)

`
cmd/foxbridge/
├── main.go          # CLI entry point, flag parsing, server startup
├── doctor.go        # Protocol coverage report (foxbridge doctor)
├── replay.go        # CDP session replay from JSONL record
├── doctor_test.go   # Doctor tests
└── replay_test.go   # Replay tests

pkg/
├── backend/
│   ├── backend.go   # Backend interface { Call, Subscribe, Close }
│   ├── juggler/     # Juggler backend (pipe FD 3/4, null-byte JSON framing)
│   └── bidi/        # WebDriver BiDi backend (WebSocket)
├── bridge/
│   ├── bridge.go    # Core bridge: CDP method routing + response mapping
│   ├── dom.go       # DOM query/querySelector/querySelectorAll translation
│   ├── page.go      # Page navigation, lifecycle, screenshot translation
│   ├── runtime.go   # Runtime.evaluate, callFunctionOn, console handling
│   ├── network.go   # Network request interception, response handling
│   ├── fetch.go     # Fetch domain (request interception)
│   ├── input.go     # Input.dispatchMouseEvent, dispatchKeyEvent
│   ├── target.go    # Target.getTargets, attachToTarget, detachFromTarget
│   ├── events.go    # Event translation table (Firefox -> CDP events)
│   ├── css.go       # CSS style computation translation
│   ├── emulation.go # Device metrics, geolocation, user agent override
│   ├── storage.go   # Cookie management translation
│   ├── console.go   # Console.log -> Runtime.consoleAPICalled
│   ├── performance.go # Performance metrics translation
│   ├── accessibility.go # Accessibility tree translation
│   ├── io.go        # IO domain (file reading)
│   ├── deterministic.go # Deterministic Date.now/Math.random injection
│   ├── stub.go      # Stub methods (return empty response for unimplemented)
│   └── testutil_test.go # Test utilities
├── cdp/
│   ├── server.go    # CDP HTTP + WebSocket server (Discovery + WS upgrade)
│   ├── session.go   # CDP session management (attach, detach, message routing)
│   ├── types.go     # CDP protocol type definitions
│   └── *test.go     # Comprehensive tests with race detector
├── firefox/
│   └── process.go   # Firefox/Camoufox process management (start, stop, detect)
├── recording/
│   └── ...          # CDP session recording to JSONL + replay
└── doctor/
    └── ...          # Coverage report generation (foxbridge doctor)
`

## Translation Approach

### Core Interface
`go
type Backend interface {
    Call(sessionID, method string, params json.RawMessage) (json.RawMessage, error)
    Subscribe(event string, handler func(sessionID string, params json.RawMessage))
    Close() error
}
`

The bridge layer routes incoming CDP commands to the matching backend call. Events from the backend are translated back to CDP event format.

### CDP Domain Coverage (from oxbridge doctor)

| Metric | Count |
|--------|-------|
| Upstream CDP methods in protocol snapshot | 662 |
| **Implemented** methods | **89** |
| Stubbed compatibility methods | 203 |
| Missing methods | 370 |
| Foxbridge-only extensions | 8 |

**Best-covered domains**: DOM, Page, Target, Network, Fetch, Runtime, Input, Emulation, IO, Performance

### Event Translation

| Firefox Event | CDP Event |
|---------------|-----------|
| Browser.attachedToTarget | Target.attachedToTarget |
| Browser.detachedFromTarget | Target.targetDestroyed |
| Page.navigationCommitted | Page.frameNavigated + lifecycle events |
| Page.eventFired(load) | Page.loadEventFired + Page.frameStoppedLoading |
| Page.eventFired(DOMContentLoaded) | Page.domContentEventFired |
| Runtime.executionContextCreated | Runtime.executionContextCreated |
| Runtime.console | Runtime.consoleAPICalled |
| Page.dialogOpened | Page.javascriptDialogOpening |
| Network.requestWillBeSent | Network.requestWillBeSent |
| Network.responseReceived | Network.responseReceived |
| Browser.requestIntercepted | Fetch.requestPaused |

### HTTP Discovery Endpoints

Foxbridge serves these standard CDP endpoints:
`ash
curl http://localhost:9222/json/version  # Browser info
curl http://localhost:9222/json/list      # Active page targets
`

## CLI Usage

`ash
# Juggler backend (default) — for Camoufox/Playwright Firefox builds
foxbridge --backend juggler --binary /path/to/camoufox --port 9222

# BiDi backend — for standard Firefox 129+
foxbridge --backend bidi --binary /path/to/firefox --port 9222

# Connect to existing BiDi endpoint (don't launch Firefox)
foxbridge --backend bidi --bidi-url ws://localhost:9223/session

# Unix domain socket
foxbridge --binary /path/to/camoufox --socket /tmp/foxbridge.sock

# Deterministic runtime (for reproducible tests)
foxbridge --deterministic-time 1700000000000 --deterministic-seed 42

# Record/replay CDP sessions
foxbridge --binary /path/to/camoufox --record ./trace.jsonl
foxbridge replay --recording ./trace.jsonl

# Coverage report
foxbridge doctor
foxbridge doctor --format json
`

## Embedded Mode (VulpineOS)

No separate process needed — VulpineOS imports Foxbridge as a Go library:
`go
import "github.com/VulpineOS/foxbridge/pkg/cdp"
server, _ := cdp.NewServer(cdp.Config{Port: 9222, Backend: jugglerBackend})
server.Start()
`

## Foxbridge vs Native BiDi

| | Foxbridge (CDP→Firefox) | Native BiDi |
|---|---|---|
| Existing Puppeteer code | Works **unchanged** | Requires rewrite |
| OpenClaw/browser-use | Works | Not supported |
| Request interception | Full (Fetch domain) | Limited |
| Performance metrics | Full | Not available |
| Production ready | Yes (379 tests, 2 backends) | Emerging |

## Foxbridge vs Playwright

| | Foxbridge | Playwright |
|---|---|---|
| Protocol | CDP (client) → Juggler/BiDi (Firefox) | Juggler (Firefox directly) |
| Client tools | Any CDP tool (Puppeteer, browser-use, custom) | Playwright API only |
| Browser | Camoufox, Firefox, any Firefox fork | Firefox (custom build) |
| Anti-detect | ✅ Camoufox support | ⚠️ Limited |
| Test coverage | 379 unit + Puppeteer suite | Playwright's own suite |
