# Chrome-to-Firefox Migration Tools

## Tab Group Migration

### 1. Chromium Tab Migrator (Best for tab groups)

- **Repo**: [github.com/rennerdo30/chromium-tab-migrator](https://github.com/rennerdo30/chromium-tab-migrator)
- **Type**: Browser extension (cross-browser)
- **Language**: JavaScript
- **Status**: Active

**Features**:
- Universal export → browser-agnostic JSON format
- Universal import → automatic browser-specific mapping
- **Tab Groups support**: Groups→Groups (Chrome, Edge, Brave, Firefox 139+)
- Workspace mapping: Groups→Workspaces (Opera), Workspaces→Groups
- Granular: select exactly what to export (tabs, groups, bookmarks)
- Export filters: by domain, regex, scope (all windows / current window)
- Safe import: lazy loading + tab discarding to prevent memory issues

**Browser support**:

| Browser | Export | Import | Group System |
|---------|--------|--------|-------------|
| Chrome | ✅ | ✅ | Tab Groups |
| Edge | ✅ | ✅ | Tab Groups |
| Brave | ✅ | ✅ | Tab Groups |
| Opera | ✅ | ✅ | Workspaces |
| **Firefox** | ✅ | ✅ | **Tab Groups (139+)** |
| Safari | ✅ | ✅ | Tab Groups |
| Vivaldi | ✅ | Limited | Tab Stacks |

**How to use**:
1. Load extension in Chrome (dev mode) → Export tabs as JSON
2. Load extension in Firefox (temporary add-on) → Import JSON
3. Choose group mapping strategy

### 2. FoxPort (Best for full migration — passwords, bookmarks, extensions, open tabs)

- **Repo**: [github.com/SysAdminDoc/FoxPort](https://github.com/SysAdminDoc/FoxPort)
- **Type**: Desktop application (PyQt6 GUI + CLI)
- **Language**: Python
- **Status**: Active

**What it migrates**:

| Item | Source | Destination |
|------|--------|-------------|
| Passwords | Login Data SQLite + DPAPI | Firefox CSV → about:logins import |
| Bookmarks | Bookmarks JSON | Netscape HTML → Library import |
| Extensions | Chrome extensions manifest.json | HTML page of AMO install links |
| **Open tabs** | Sessions/Session_* SNSS binary | **ecovery.jsonlz4** (Firefox session format) |
| Cookies | Network/Cookies SQLite | cookies.sqlite (direct write) |
| Form autofill | Web Data SQLite | ormhistory.sqlite |

**CLI mode**:
`ash
python -m foxport.cli list
python -m foxport.cli migrate --source \"Brave/Default\" --target \"Firefox/default-release\" --all --dry-run
`

**Supported sources**: Chrome, Brave, Edge, Vivaldi, Opera, Opera GX, Arc, Thorium, Yandex
**Supported targets**: Firefox, LibreWolf, Waterfox, Floorp, Mullvad Browser, Tor Browser, Zen Browser

### 3. Firefox Built-in Import (about:import)

- Migrates bookmarks, history, passwords, settings from Chrome
- Does **NOT** migrate tab groups
- Access via about:import in Firefox URL bar

## Tab Group Sync Tools

### 4. Tab Group Syncer (Firefox add-on)

- **AMO**: [Tab Group Syncer](https://addons.mozilla.org/en-US/firefox/addon/tab-group-syncer/)
- **What**: Syncs Firefox tab groups across devices using Firefox Sync
- **Useful for**: Keeping tab groups consistent across multiple Firefox installs

### 5. PinTab Group Exporter Syncer (Firefox add-on)

- **AMO**: [PinTab Group Exporter Syncer](https://addons.mozilla.org/en-US/firefox/addon/pintab-group-exporter-syncer/)
- Exports/syncs pinned tab groups between devices/browsers

## Auto Tab Group Management

### 6. Auto Tab Groups (Cross-browser extension)

- **GitHub**: [github.com/nitzanpap/auto-tab-groups](https://github.com/nitzanpap/auto-tab-groups)
- **AMO**: [Auto Tab Groups](https://addons.mozilla.org/en-US/firefox/addon/auto-tab-groups/)
- **What**: Automatically groups tabs by domain/subdomain with custom rules
- **Supports**: Chrome + Firefox (Manifest V3, single codebase via WXT)
- **Features**: Export/import rules, color management, collapse controls, Focus Mode

## Summary

| Need | Best Tool |
|------|-----------|
| Migrate **tab groups** Chrome → Firefox | **Chromium Tab Migrator** |
| Migrate **everything** (passwords, bookmarks, extensions, open tabs) | **FoxPort** |
| Quick bookmarks/passwords import | **Firefox about:import** |
| Sync tab groups across Firefox devices | **Tab Group Syncer** |
| Auto-group tabs by domain | **Auto Tab Groups** |
