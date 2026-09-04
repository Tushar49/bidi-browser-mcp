# Building a WebDriver BiDi MCP Server — Practical Guide

## Overview

Building a BiDi MCP server is remarkably similar to building a CDP MCP server. Same dependencies (`ws` + `@modelcontextprotocol/sdk`), same pattern, different WebSocket endpoint and command set.

## Requirements

- Node.js 18+ (22+ for native WebSocket)
- Firefox 129+ (BiDi is built-in, no downloads needed)
- npm packages: `@modelcontextprotocol/sdk` + `ws`

**Firefox startup** — same as Chrome CDP:
```
firefox --remote-debugging-port=9222
# BiDi endpoint: ws://127.0.0.1:9222/session
```

No extra downloads. No drivers. BiDi is built into Firefox, same as CDP is built into Chrome.

## Minimal MCP Server Skeleton

```javascript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import WebSocket from "ws";

// ============================================================
// 1. Connect to Firefox BiDi
// ============================================================
const FIREFOX_WS_URL = process.env.FIREFOX_BIDI_WS_URL || "ws://127.0.0.1:9222/session";
let bidiSocket = null;
let bidiSessionId = null;
let messageId = 0;
const pending = new Map();

function connectBiDi() {
  return new Promise((resolve, reject) => {
    bidiSocket = new WebSocket(FIREFOX_WS_URL);
    bidiSocket.on("open", () => {
      console.error("Connected to Firefox BiDi");
      resolve();
    });
    bidiSocket.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      const { id, result, error, method, params } = msg;
      if (id && pending.has(id)) {
        const { resolve, reject } = pending.get(id);
        pending.delete(id);
        if (error) reject(new Error(error.message));
        else resolve(result);
      }
      if (method) {
        console.error("[Event] " + method);
      }
    });
    bidiSocket.on("error", reject);
  });
}

function bidiCall(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    pending.set(id, { resolve, reject });
    bidiSocket.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("BiDi call timed out: " + method));
      }
    }, 30000);
  });
}

// ============================================================
// 2. Initialize Session
// ============================================================
async function initSession() {
  const result = await bidiCall("session.new", { capabilities: {} });
  bidiSessionId = result.sessionId;
  console.error("BiDi session created: " + bidiSessionId);

  await bidiCall("session.subscribe", {
    events: [
      "browsingContext.contextCreated",
      "browsingContext.contextDestroyed",
      "browsingContext.load",
      "browsingContext.navigationStarted",
      "log.entryAdded",
    ]
  });
  console.error("Subscribed to browsingContext + log events");
}

// ============================================================
// 3. Helper
// ============================================================
async function getDefaultContext() {
  const tree = await bidiCall("browsingContext.getTree", {});
  const topContext = tree.contexts.find(c => !c.parent);
  return topContext ? topContext.context : null;
}
```

## MCP Tools to Implement

| Tool | BiDi Method | Description |
|------|-------------|-------------|
| `bidi_navigate` | `browsingContext.navigate` | Navigate to URL |
| `bidi_evaluate` | `script.evaluate` | Run JS in page |
| `bidi_screenshot` | `browsingContext.captureScreenshot` | Take screenshot |
| `bidi_click` | `input.performActions` (pointer) | Click element by CSS |
| `bidi_type` | `input.performActions` (key) | Type into input |
| `bidi_list_tabs` | `browsingContext.getTree` | List all tabs |
| `bidi_new_tab` | `browsingContext.create` | Open new tab |
| `bidi_close_tab` | `browsingContext.close` | Close a tab |
| `bidi_set_viewport` | `browsingContext.setViewport` | Resize viewport |
| `bidi_get_cookies` | `storage.getCookies` | Get cookies |
| `bidi_set_cookie` | `storage.setCookie` | Set a cookie |
| `bidi_delete_cookies` | `storage.deleteCookies` | Delete cookies |
| `bidi_console` | (listen to log.entryAdded) | Get console messages |

## Click Implementation Pattern

BiDi does not have a direct "click element" command. Use input.performActions with a pointer action sequence:

```javascript
// Step 1: Find element position via script.evaluate
const evalResult = await bidiCall("script.evaluate", {
  expression: "(() => { const el = document.querySelector('" + selector + "'); if (!el) throw new Error('not found'); const r = el.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()",
  target: { context },
  awaitPromise: true
});

// Step 2: Perform click at coordinates
const { x, y } = evalResult.result.value;
await bidiCall("input.performActions", {
  context,
  actions: [{
    type: "pointer",
    id: "mouse",
    parameters: { pointerType: "mouse" },
    actions: [
      { type: "pointerMove", x: Math.round(x), y: Math.round(y) },
      { type: "pointerDown", button: 0 },
      { type: "pointerUp", button: 0 }
    ]
  }]
});
```

## Key Differences from CDP MCP

| Aspect | CDP MCP | BiDi MCP |
|--------|---------|----------|
| WebSocket URL | `ws://127.0.0.1:9222/devtools/browser/XXXX` | `ws://127.0.0.1:9222/session` |
| Session creation | Auto on connect | Must call `session.new` |
| Event subscription | `Domain.enable` | `session.subscribe` |
| Tab listing | HTTP /json/list | `browsingContext.getTree` |
| Navigation | `Page.navigate` | `browsingContext.navigate` |
| JS evaluation | `Runtime.evaluate` | `script.evaluate` |
| Screenshot | `Page.captureScreenshot` | `browsingContext.captureScreenshot` |
| Click/type | `Input.dispatchMouseEvent` etc. | `input.performActions` (sequences) |
| Cookie management | `Network.getCookies` etc. | `storage.getCookies` etc. |
| Session model | Multi (each tab = separate WS) | Single WS, context IDs |
| Debugger | Full (breakpoints, step) | Not available |

## What BiDi Cannot Do (vs CDP)

- No JavaScript debugger (no breakpoints, no stepping, no call stack)
- No performance profiling (no Performance.enable, no HeapProfiler)
- No accessibility tree (no Accessibility.getFullAXTree)
- No network throttling emulation
- No user agent override
- No CPU throttling
- No touch emulation
- No CSS manipulation (no CSS.getComputedStyleForNode)

For these, fall back to `script.evaluate` + JS, or use the CDP MCP server (for Chrome/Brave/Edge) when you need these features.

## Dual-Mode Architecture

The best approach is a dual-mode MCP server like `mcp-browser-dev-tools`:

```
MCP Server
├── Browser Discovery (port scanning 9222-9226)
├── CdpSessionManager
│   - Chrome/Edge/Brave via CDP
│   - Full tool surface (debugger, performance)
└── FirefoxBidiSessionManager
    - Firefox via BiDi
    - Core tool surface (navigate, evaluate, click, screenshot)
```

## Project Structure

```
bidi-browser-mcp/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts           # MCP server entry
│   ├── connection.ts      # BiDi WebSocket management
│   ├── session.ts         # Session lifecycle
│   ├── bidi-client.ts     # BiDi command/event handler
│   ├── tools/
│   │   ├── navigation.ts  # browsingContext.* commands
│   │   ├── script.ts      # script.* commands
│   │   ├── input.ts       # input.* commands
│   │   ├── screenshot.ts  # captureScreenshot
│   │   ├── tabs.ts        # Tab management
│   │   ├── network.ts     # network.* commands
│   │   └── storage.ts     # storage.* commands
│   └── utils/
│       ├── logger.ts
│       └── errors.ts
├── dist/
└── README.md
```

## package.json

```json
{
  "name": "bidi-browser-mcp",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "ws": "^8.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/ws": "^8.0.0",
    "typescript": "^5.0.0"
  }
}
```

## Starting Firefox

```bash
# MacOS / Linux
firefox --remote-debugging-port=9222

# Windows
& "C:\Program Files\Mozilla Firefox\firefox.exe" --remote-debugging-port=9222

# Verify BiDi endpoint is listening:
# Firefox exposes: ws://127.0.0.1:9222/session
```
