#!/usr/bin/env node
/**
 * Show Firefox-family and Chromium-family processes and whether a Remote
 * Agent / DevTools port is on. Read-only diagnostics; never mutates a
 * browser. Chromium CDP ports are not BiDi endpoints — connecting to them
 * requires the chromium-bidi mapper (see README).
 */

import { platform } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extractRemoteDebuggingPort } from '../dist/connection/browser-discovery.js';

const execFileAsync = promisify(execFile);

const firefoxFamily = ['firefox', 'zen', 'librewolf', 'waterfox', 'floorp'];
const chromiumFamily = ['chrome', 'brave', 'msedge', 'chromium', 'vivaldi', 'opera'];

async function windowsProcesses(pattern) {
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.Name -match '${pattern}' } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress`;
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-Command', script],
    { timeout: 5_000, maxBuffer: 10 * 1024 * 1024 }
  );

  const parsed = JSON.parse(stdout);
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items
    .filter((item) => typeof item.CommandLine === 'string')
    .map((item) => ({
      processId: item.ProcessId,
      name: item.Name,
      commandLine: item.CommandLine,
    }));
}

async function unixProcesses(pattern) {
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,command='], {
    timeout: 5_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  const items = [];

  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line.trim());
    if (match === null) {
      continue;
    }
    const commandLine = match[2];
    if (!pattern.split('|').some((name) => commandLine.includes(name))) {
      continue;
    }

    items.push({
      processId: Number(match[1]),
      name: undefined,
      commandLine,
    });
  }

  return items;
}

const pattern = [...firefoxFamily, ...chromiumFamily].join('|');
const items =
  platform() === 'win32' ? await windowsProcesses(pattern) : await unixProcesses(pattern);

if (items.length === 0) {
  console.log('no Firefox-family or Chromium-family processes found');
  process.exit(0);
}

for (const item of items) {
  const port = extractRemoteDebuggingPort(item.commandLine);
  const haystack = `${item.name ?? ''} ${item.commandLine}`.toLowerCase();
  if (haystack.includes('webview')) {
    continue; // Embedded webviews are not browsers.
  }
  const isChromium = chromiumFamily.some((name) => haystack.includes(name));
  const kind = isChromium ? 'cdp-only' : 'bidi';
  console.log(
    `${item.name ?? 'unknown'} pid=${item.processId} remoteDebuggingPort=${port ?? 'off'} [${kind}]`
  );
}
console.log('');
console.log('bidi = Firefox-family: attach directly. cdp-only = Chromium: needs');
console.log('the chromium-bidi mapper; see README "Chromium browsers".');
