# Browser Automation MCP Servers — All Known Repos

A comprehensive catalog of MCP servers that provide browser automation capabilities. Each entry covers architecture, approach, and code structure.

## 1. CDP Browser MCP Server (Tushar49)

- **Repo**: [github.com/Tushar49/cdp-browser-mcp-server](https://github.com/Tushar49/cdp-browser-mcp-server)
- **Local path**: `../../cdp-browser-mcp/MCP Server/`
- **Language**: TypeScript (38 modules)
- **Version**: 5.0.0-alpha.3
- **Status**: Active

### Architecture
`
src/
├── index.ts              # MCP server entry, tool registration
├── connection/
│   ├── cdp-client.ts     # WebSocket CDP client implementation
│   └── browser-discovery.ts  # Auto-detect Chrome/Edge/Brave instances
├── session/
│   ├── session-manager.ts # Tab session lifecycle management
│   ├── tab-manager.ts     # Tab attachment/detachment
│   └── element-resolver.ts # Stable element references across snapshots
├── snapshot/
│   ├── accessibility.ts   # Accessibility tree snapshot generation
│   └── cache.ts           # Per-tab snapshot caching
├── tools/
│   ├── browser.ts         # browser.profiles, browser.connect, browser.active
│   ├── tabs.ts            # tabs.list, tabs.find, tabs.new, tabs.close, tabs.activate, tabs.info
│   ├── page.ts            # page.goto, page.snapshot, page.screenshot, page.content, etc.
│   ├── interact.ts        # interact.click, interact.type, interact.select, etc.
│   ├── form.ts            # Smart form filling (handles combobox, checkbox, radio, select, date)
│   ├── execute.ts         # execute.eval, execute.script, execute.call
│   ├── observe.ts         # observe.console, observe.network, observe.performance, observe.har
│   ├── emulate.ts         # emulate.viewport, emulate.geolocation, emulate.networkCondition, etc.
│   ├── storage.ts         # Cookie CRUD, storage.clear, quota check
│   ├── intercept.ts       # HTTP request interception (mock, modify, block)
│   ├── debug.ts           # JS debugger (breakpoints, step, call stack, resource overrides)
│   └── cleanup.ts         # Session management, disconnect, temp files
└── utils/
    ├── logger.ts
    ├── timeout.ts
    └── errors.ts          # 17 actionable error types with fix suggestions
`

### Approach
- Connects to **already-running** Chrome/Edge/Brave via CDP WebSocket
- No browser launch, no binary download
- **2 dependencies**: ws + @modelcontextprotocol/sdk
- 14 tools, 90+ actions
- Auto-connect on first tool call
- Lazy CDP domain enablement (only enable domains when first used)
- Per-tab state isolation
- Stable element refs (UIDs persist across snapshots)
- Auto-reconnect with exponential backoff
- Snapshot caching (per-tab)
- Token-optimized snapshots (~15KB avg)
- Framework-aware input handling (React, Angular, MUI)

### Key Design Decisions
- Browser-level WebSocket multiplexes all tabs via Target.attachToTarget
- Tabs are only attached on interaction, not on startup
- CDP domains enabled on first use per tab
- Sessions auto-pin to Chrome profile
- Connection mutex prevents concurrent WebSocket opens
- No abstraction layer (direct CDP — no Puppeteer/Playwright)

## 2. mcp-browser-dev-tools (Hinaser)

- **Repo**: [github.com/Hinaser/mcp-browser-dev-tools](https://github.com/Hinaser/mcp-browser-dev-tools)
- **npm**: mcp-browser-dev-tools
- **Language**: JavaScript (Node.js, no build step)
- **Status**: Active

### Architecture
`
AI client -> MCP over stdio -> broker -> Chromium CDP or Firefox BiDi -> page
`

**Key components**:
- McpBrowserDevToolsServer — JSON-RPC framing, tool list, argument validation
- CdpSessionManager — Chromium-family browsers (Chrome, Edge)
- FirefoxBidiSessionManager — Firefox
- MultiBrowserAdapter — MCP_BROWSER_FAMILY=auto, multiplexes both

### Approach
- **Dual protocol** — single MCP server supporting CDP + BiDi
- Auto-mode (uto) probes ports 9222-9226, discovers available browsers
- In auto mode, namespaces IDs as chromium:<id> and irefox:<id>
- 34 tools: browser_status, ensure_browser, launch_browser, list_tabs, new_tab, close_tab, etc.
- Read-oriented by default, valuate_js behind opt-in flag
- Locator syntax: CSS, text=, role=, name=
- WSL relay for Windows browsers from Linux

### Why Not Playwright?
From the README:
> *\"Playwright is still the stronger choice for deterministic browser automation and E2E tests. This project solves a different problem: it is MCP-native, so AI clients call a bounded tool surface instead of generating Playwright scripts.\"*

### Protocol Mapping
**Chromium**: /json/version + /json/list, enables Page, Runtime, DOM, Log, Network
**Firefox**: BiDi WebSocket, rowsingContext.getTree for targets, session.subscribe for events

## 3. firefox-bidi-mcp (Enne2 / Matteo Benedetto)

- **Repo**: [github.com/Enne2/firefox-bidi-mcp](https://github.com/Enne2/firefox-bidi-mcp)
- **Language**: JavaScript (Node.js)
- **Status**: Active (minimal)

### Architecture
Single file: src/index.mjs — implements raw WebSocket client over Node's 
et module.

### Approach
- Firefox-only, BiDi-only
- Minimal: 7 tools — open_session, close_session, list_tabs, select_tab, navigate, evaluate, screenshot
- Explicit session lifecycle (open/close)
- Raw WebSocket implementation (no ws library — uses 
et module directly)

### Key Design Decisions
- Firefox allows only one active BiDi session at a time
- Context IDs are valid only within the active session
- Advanced actions (click, fill) intentionally left to script.evaluate

## 4. Mozilla firefox-devtools-mcp

- **Repo**: Part of [mozilla-releng/git-backing](https://github.com/mozilla-releng/git-backing/)
- **Language**: TypeScript
- **Status**: Active (Mozilla official)

### Approach
- Uses WebDriver BiDi via **Selenium WebDriver**
- Falls back to WebDriver Classic (Marionette) for features not yet ported to BiDi
- Can connect to local Firefox builds (development builds)
- Automatically configured when using Claude Code in Firefox repo (via .mcp.json)

### Features
- Page navigation, DOM access, network monitoring, console logs, user input simulation
- Firefox debug logs (MOZ_LOG) while controlling browser
- Dynamic Firefox config changes without restart
- Chrome context support via Marionette fallback

## 5. chromium-cdp-mcp (Undetectable.io)

- **Repo**: [github.com/undetectable-io/chromium-cdp-mcp](https://github.com/undetectable-io/chromium-cdp-mcp)
- **npm**: chromium-cdp-mcp (npx -y)
- **Language**: TypeScript
- **Status**: Active

### Approach
- Raw CDP, no Puppeteer/Playwright
- Browser-agnostic: takes port argument for any Chromium browser
- Cross-origin iframe support (click inside reCAPTCHA, Cloudflare Turnstile)
- 15+ tools: navigate, click, fill, select_option, evaluate, screenshot, raw CDP

### Key Features
- click_and_accept_dialog — click + auto-handle dialogs
- aw CDP command passthrough — send any CDP method
- Designed for antidetect browsers (Undetectable, AdsPower, GoLogin, Multilogin)

## 6. mcp-chrome-cdp (YosephFr)

- **Repo**: [github.com/YosephFr/mcp-chrome-cdp](https://github.com/YosephFr/mcp-chrome-cdp)
- **Language**: TypeScript
- **Status**: Active

### Approach
- 54 tools across 12 categories
- Direct CDP WebSocket (no Puppeteer/Playwright)
- Single persistent WS connection per tab
- Zero dependencies beyond MCP SDK + ws

## 7. browser-mcp (TioGlo)

- **Repo**: [github.com/TioGlo/browser-mcp](https://github.com/TioGlo/browser-mcp)
- **Language**: TypeScript
- **Status**: Active

### Approach
- Uses **Playwright internally** but connects via CDP endpoint
- Stable element refs (1, 2, ...) cached per tab
- Text-based element targeting
- Batch operations
- Auto-launch Chrome option (CHROME_AUTOLAUNCH)
- Per-agent isolation through separate profiles + ports

## 8. mcp-browser (wgarrido)

- **Repo**: [github.com/wgarrido/mcp-browser](https://github.com/wgarrido/mcp-browser)
- **npm**: @wgarrido/mcp-browser
- **Status**: Active

### Approach
- Auto-launches headless Chrome
- Uses real Chrome with user's fingerprint
- Auto-detects Cloudflare/CAPTCHA challenges
- Dismisses cookie consent banners (40+ patterns)
- 15 tools: fetch_page, fetch_readable, web_search, screenshot, execute_javascript, etc.

## 9. browser-harness-bidi (AndrewDzzz)

- **Repo**: [github.com/AndrewDzzz/browser-harness-bidi](https://github.com/AndrewDzzz/browser-harness-bidi)
- **Language**: Python
- **Status**: Active

### Approach
- WebDriver BiDi-first browser harness for AI agents
- Inspired by rowser-use/browser-harness
- Direct WebSocket to WebDriver-capable browser
- Managed Firefox via geckodriver or direct BiDi WebSocket
- Agent-edit helpers (agents can write their own helpers)

## Comparison Summary

| Server | Protocol | Browsers | Deps | Tools | Special |
|--------|----------|----------|------|-------|---------|
| **CDP Browser MCP** (Tushar49) | CDP | Chrome, Edge, Brave | 2 | 14 | Connects to real browser, profiles, 90+ actions |
| **mcp-browser-dev-tools** | CDP + BiDi | Chrome, Edge, Firefox | many | 34 | **Dual protocol**, auto-detect, WSL relay |
| **firefox-bidi-mcp** | BiDi | Firefox only | 0 (net) | 7 | Minimal, raw WebSocket |
| **mozilla firefox-devtools-mcp** | BiDi + Classic | Firefox | Selenium | many | Official Mozilla, Chrome context |
| **chromium-cdp-mcp** | CDP | Any Chromium | minimal | 15+ | Cross-origin iframes, raw CDP passthrough |
| **mcp-chrome-cdp** | CDP | Chrome | 2 | 54 | Max tool count |
| **browser-mcp** | CDP (via Playwright) | Chrome | Playwright | ~10 | Stable element refs, auto-launch |
| **mcp-browser** | CDP (headless) | Chrome | many | 15 | CAPTCHA handling, cookie dismissal |
