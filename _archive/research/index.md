# Browser Automation Research — Index

This directory contains comprehensive research on browser automation protocols, tools, and browser comparisons. Every file uses **relative links** — clone this repo anywhere and links between files will work.

## File Overview

| File | Covers |
|------|--------|
| [BROWSERS.md](./BROWSERS.md) | Full browser comparison — Chrome, Firefox, Brave, Edge, Opera, Vivaldi — RAM, privacy, features, MV2 support, security, open-source status |
| [BROWSER_PROTOCOLS.md](./BROWSER_PROTOCOLS.md) | Deep dive: CDP vs WebDriver BiDi vs Juggler vs WebDriver Classic — transport, governance, browser support, detection surface |
| [BIDI_API_REFERENCE.md](./BIDI_API_REFERENCE.md) | Complete WebDriver BiDi module/command/event reference compared to CDP and Playwright APIs |
| [MCP_SERVERS.md](./MCP_SERVERS.md) | All known browser automation MCP servers — architecture, approaches, code structure, how they work |
| [FOXBRIDGE.md](./FOXBRIDGE.md) | Foxbridge deep dive — CDP-to-Firefox proxy via Juggler and BiDi, architecture, CDP domain coverage, event translation |
| [MIGRATION_TOOLS.md](./MIGRATION_TOOLS.md) | Chrome-to-Firefox migration tools — tab groups, bookmarks, passwords, extensions |
| [BUILDING_BIDI_MCP.md](./BUILDING_BIDI_MCP.md) | Practical guide to building a BiDi-native MCP server with code snippets, requirements, comparison to CDP approach |

## Key Findings Summary

### Browser Choice
- **Firefox**: Only non-Chromium engine. Native BiDi. Best RAM at scale (30-50 tabs). Fully open source. Non-profit. MV2/uBO support.
- **Brave**: Lowest idle RAM. Built-in Shields adblocking. Hosts MV2 extensions (uBO, NoScript, AdGuard, uMatrix). CDP-native.
- **Chrome**: Native CDP. Best DevTools. But Google spyware + 5.8 GB RAM on your machine.

### Protocol State (July 2026)
- **CDP**: Chromium-only. Native in Chrome/Edge/Brave. Mature, 60+ domains, battle-tested. Removed from Firefox (FF 141+).
- **WebDriver BiDi**: W3C standard. Native in Firefox 129+. Experimental in Chrome. Cross-browser future. 10 modules.
- **Juggler**: Playwright's custom Firefox protocol. Pipe transport, null-byte JSON. Still works.

### Build Your Own
- **MCP server for CDP**: Node.js 18+, ws + @modelcontextprotocol/sdk. 2 deps. Already done at `../../cdp-browser-mcp/`.
- **MCP server for BiDi**: Same deps. Different WebSocket endpoint (ws://localhost:9222/session). Different command set.
- **Dual MCP server**: mcp-browser-dev-tools has reference architecture for CDP+BiDi in one broker.

## Browser Automation Protocol Ecosystem

`
CDP (Chromium native)                    Juggler (Playwright/Firefox)
        │                                        │
        │  Firefox removed CDP in FF141           │  Pipe FD 3/4, null-byte JSON
        ▼                                        ▼
  Chrome / Edge / Brave              Camoufox / Firefox (Playwright)
        │                                        │
        │  WebDriver BiDi (W3C)                   │  WebDriver BiDi (native)
        └──────────────┬──────────────────────────┘
                       │
                       ▼
          Cross-browser standard
          Firefox: native since FF129
          Chrome: experimental
          Safari: not yet shipped
`

## External References
- [CDP Browser MCP Server (your existing project)](../../cdp-browser-mcp/) — already cloned and configured
- [WebDriver BiDi W3C Spec](https://www.w3.org/TR/webdriver-bidi/) — latest version
- [CDP Protocol Browser](https://chromedevtools.github.io/devtools-protocol/) — Chrome DevTools Protocol docs
- [Playwright](https://playwright.dev/) — cross-browser automation framework
- [Puppeteer](https://pptr.dev/) — CDP-native automation by Google
