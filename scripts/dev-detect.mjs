#!/usr/bin/env node
/**
 * Show Firefox-family processes that may have the Remote Agent enabled.
 *
 * This is a diagnostic helper only. It never mutates the browser.
 */

import { platform } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extractRemoteDebuggingPort } from '../dist/connection/browser-discovery.js';

const execFileAsync = promisify(execFile);

const names = ['firefox', 'zen', 'librewolf', 'waterfox', 'floorp'];

async function windowsProcesses() {
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.Name -match '${names.join('|')}' } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress`;
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-Command', script],
    { timeout: 5_000, maxBuffer: 10 * 1024 * 1024 }
  );

  // No matches: PowerShell prints nothing at all — never JSON.
  if (stdout.trim() === '') {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items
    .filter((item) => typeof item.CommandLine === 'string')
    .map((item) => ({
      processId: item.ProcessId,
      name: item.Name,
      commandLine: item.CommandLine,
    }));
}

async function unixProcesses() {
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
    if (!names.some((name) => commandLine.includes(name))) {
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

const items = platform() === 'win32' ? await windowsProcesses() : await unixProcesses();

if (items.length === 0) {
  console.log('no Firefox-family processes found');
  process.exit(0);
}

for (const item of items) {
  const port = extractRemoteDebuggingPort(item.commandLine);
  console.log(
    `${item.name ?? 'unknown'} pid=${item.processId} remoteDebuggingPort=${port ?? 'off'}`
  );
}
