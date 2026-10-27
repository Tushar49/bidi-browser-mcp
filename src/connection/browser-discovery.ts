import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Config, DiscoveryCandidate, DiscoverySource } from '../types.js';
import { ActionableError } from '../utils/errors.js';

const execFileAsync = promisify(execFile);
const DISCOVERY_FILE = 'WebDriverBiDiServer.json';

const FIREFOX_FAMILY_PROCESSES = [
  'firefox',
  'zen',
  'librewolf',
  'waterfox',
  'floorp',
] as const;

/** Chromium-family binaries. They expose CDP, never a BiDi `/session` path. */
const CHROMIUM_FAMILY_PROCESSES = [
  'chrome',
  'chromium',
  'brave',
  'msedge',
  'vivaldi',
  'thorium',
  'yandex',
  'opera',
] as const;

const KNOWN_PROCESSES = [
  ...FIREFOX_FAMILY_PROCESSES,
  ...CHROMIUM_FAMILY_PROCESSES,
] as const;

/**
 * Parse `--remote-debugging-port` from a process command line.
 * Supports `--remote-debugging-port`, `--remote-debugging-port 9223`, and
 * `--remote-debugging-port=9223`.
 */
export function extractRemoteDebuggingPort(commandLine: string): number | undefined {
  const withValue = /--remote-debugging-port(?:=|\s+)(\d+)/.exec(commandLine);
  if (withValue !== null) {
    const port = Number(withValue[1]);
    return Number.isSafeInteger(port) && port > 0 ? port : undefined;
  }

  return /--remote-debugging-port(?:\s|$)/.test(commandLine) ? 9222 : undefined;
}

/**
 * Parse `--user-data-dir` from a Chromium command line. Portable installs (and
 * custom profiles) only expose their CDP URL through the DevToolsActivePort
 * file in that directory, so this is how Chromium is found without config.
 */
export function extractUserDataDir(commandLine: string): string | undefined {
  // Accepts --user-data-dir="…", --user-data-dir=…, and --user-data-dir "…".
  // An unquoted path with spaces is not recoverable; \S+ keeps the first token.
  const match = /--user-data-dir(?:=|\s+)("([^"]+)"|((?!--)\S+))/.exec(
    commandLine
  );
  return match?.[2] ?? match?.[3];
}

function isChromiumProcess(name: string): boolean {
  const base = name.toLowerCase().replace(/\.exe$/, '');
  return CHROMIUM_FAMILY_PROCESSES.some(
    (candidate) => base === candidate || base.includes(candidate)
  );
}

function profileRoots(config: Config): string[] {
  const home = homedir();
  const roots: string[] = [...config.discoveryRoots];

  if (platform() === 'win32') {
    const appData = config.appDataRoot;
    roots.push(join(appData, 'Mozilla', 'Firefox'));
    roots.push(join(appData, 'Zen Browser'));
    roots.push(join(appData, 'zen'));
  } else if (platform() === 'darwin') {
    const base = join(home, 'Library', 'Application Support');
    roots.push(join(base, 'Firefox'));
    roots.push(join(base, 'Zen Browser'));
    roots.push(join(base, 'zen'));
  } else {
    roots.push(join(home, '.mozilla', 'firefox'));
    roots.push(join(home, '.zen'));
  }

  return [...new Set(roots.map((root) => resolve(root)))].filter((root) =>
    existsSync(root)
  );
}

function parseProfilesIni(text: string): Record<string, string>[] {
  const sections: Record<string, string>[] = [];
  let section: Record<string, string> | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith(';') || line.startsWith('#')) {
      continue;
    }

    if (line.startsWith('[') && line.endsWith(']')) {
      section = {};
      sections.push(section);
      continue;
    }

    if (section !== undefined) {
      const separatorIndex = line.indexOf('=');
      if (separatorIndex > 0) {
        section[line.slice(0, separatorIndex).trim()] = line.slice(separatorIndex + 1).trim();
      }
    }
  }

  return sections;
}

function profileDirsFromIni(root: string): string[] {
  const iniPath = join(root, 'profiles.ini');
  if (!existsSync(iniPath)) {
    return [];
  }

  try {
    const sections = parseProfilesIni(readFileSync(iniPath, 'utf8'));
    const dirs: string[] = [];

    for (const section of sections) {
      const path = section.Path ?? section.path;
      if (path === undefined) {
        continue;
      }
      const isRelative = section.IsRelative === '1' || section.isRelative === '1';
      dirs.push(isRelative ? join(root, path) : resolve(path));
    }

    return dirs;
  } catch {
    return [];
  }
}

function profileDirsFromRoot(root: string): string[] {
  const profilesDir = join(root, 'Profiles');
  if (!existsSync(profilesDir)) {
    return [];
  }

  try {
    return readdirSync(profilesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(profilesDir, entry.name));
  } catch {
    return [];
  }
}

function discoveryUrlFor(profileDir: string): string | undefined {
  const path = join(profileDir, DISCOVERY_FILE);
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    const discovery = JSON.parse(readFileSync(path, 'utf8')) as {
      ws_host?: string;
      ws_port?: unknown;
    };
    if (
      typeof discovery.ws_host === 'string' &&
      typeof discovery.ws_port === 'number' &&
      Number.isInteger(discovery.ws_port) &&
      discovery.ws_port >= 1 &&
      discovery.ws_port <= 65535
    ) {
      return `ws://${discovery.ws_host}:${discovery.ws_port}/session`;
    }
  } catch {
    // Ignore malformed discovery files.
  }

  return undefined;
}

/**
 * Chromium-family user-data directories that write a `DevToolsActivePort`
 * file (port + browser WebSocket path) when started with
 * `--remote-debugging-port`. Extra dirs come from BIDI_CHROMIUM_DATA_DIR.
 */
function chromiumDataDirs(config: Config): string[] {
  const home = homedir();
  const dirs: string[] = [...config.chromiumDataDirs];

  if (platform() === 'win32') {
    const local = config.localAppDataRoot;
    dirs.push(
      join(local, 'Google', 'Chrome', 'User Data'),
      join(local, 'BraveSoftware', 'Brave-Browser', 'User Data'),
      join(local, 'Microsoft', 'Edge', 'User Data'),
      join(local, 'Chromium', 'User Data'),
      join(local, 'Vivaldi', 'User Data')
    );
  } else if (platform() === 'darwin') {
    const base = join(home, 'Library', 'Application Support');
    dirs.push(
      join(base, 'Google', 'Chrome'),
      join(base, 'BraveSoftware', 'Brave-Browser'),
      join(base, 'Microsoft Edge'),
      join(base, 'Chromium'),
      join(base, 'Vivaldi')
    );
  } else {
    const base = join(home, '.config');
    dirs.push(
      join(base, 'google-chrome'),
      join(base, 'BraveSoftware', 'Brave-Browser'),
      join(base, 'microsoft-edge'),
      join(base, 'chromium'),
      join(base, 'vivaldi')
    );
  }

  return [...new Set(dirs.map((dir) => resolve(dir)))].filter((dir) =>
    existsSync(dir)
  );
}

/**
 * Read `DevToolsActivePort`: first line is the port, second is the browser
 * WebSocket path (`/devtools/browser/<id>`). Returns a CDP endpoint the mapper
 * can attach to; the browser must already be running.
 */
export function chromiumEndpointFromDataDir(
  dataDir: string
): string | undefined {
  const file = join(dataDir, 'DevToolsActivePort');
  if (!existsSync(file)) {
    return undefined;
  }

  try {
    const [portLine, pathLine] = readFileSync(file, 'utf8').split(/\r?\n/);
    const port = Number((portLine ?? '').trim());
    const wsPath = (pathLine ?? '').trim();
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return undefined;
    }
    if (!wsPath.startsWith('/devtools/browser/')) {
      return undefined;
    }
    return `ws://127.0.0.1:${port}${wsPath}`;
  } catch {
    return undefined;
  }
}

/**
 * Gate every discovered candidate against BIDI_ALLOW_REMOTE, not just the
 * explicit BIDI_WS_URL case. Profile files are user-writable data — a tampered
 * or rogue WebDriverBiDiServer.json must not point the server at a remote host.
 */
export function endpointAllowed(config: Config, endpoint: string): boolean {
  return config.allowRemote || isLoopback(endpoint);
}

function isLoopback(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function addCandidate(
  candidates: DiscoveryCandidate[],
  candidate: DiscoveryCandidate
): void {
  if (!candidates.some((existing) => existing.endpoint === candidate.endpoint)) {
    candidates.push(candidate);
  }
}

interface ProcessInfo {
  readonly processId: number;
  readonly name: string;
  readonly commandLine: string;
}

async function processCommandLines(): Promise<readonly ProcessInfo[]> {
  try {
    if (platform() === 'win32') {
      const script = `Get-CimInstance Win32_Process | Where-Object { $_.Name -match '${KNOWN_PROCESSES.join('|')}' } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress`;
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-Command', script],
        { timeout: 5_000, maxBuffer: 10 * 1024 * 1024 }
      );

      const parsed = JSON.parse(stdout) as
        | { ProcessId?: number; Name?: string; CommandLine?: string }
        | Array<{ ProcessId?: number; Name?: string; CommandLine?: string }>;
      const normalized = Array.isArray(parsed) ? parsed : [parsed];

      return normalized
        .filter(
          (item) =>
            typeof item.CommandLine === 'string' && typeof item.Name === 'string'
        )
        .map((item) => ({
          processId: typeof item.ProcessId === 'number' ? item.ProcessId : 0,
          name: item.Name as string,
          commandLine: item.CommandLine as string,
        }));
    }

    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,command='], {
      timeout: 5_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    return stdout
      .split(/\r?\n/)
      .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line.trim()))
      .filter((match): match is RegExpExecArray => match !== null)
      .flatMap((match) => {
        const commandLine = match[2];
        const name = KNOWN_PROCESSES.find((candidate) =>
          commandLine.toLowerCase().includes(candidate)
        );
        return name === undefined
          ? []
          : [{ processId: Number(match[1]), name, commandLine }];
      });
  } catch {
    return [];
  }
}

function addChromiumPort(ports: Set<number>, endpoint: string): void {
  const port = Number(new URL(endpoint).port);
  if (Number.isInteger(port) && port > 0) {
    ports.add(port);
  }
}

async function processCandidates(): Promise<{
  readonly candidates: readonly DiscoveryCandidate[];
  readonly chromiumPorts: ReadonlySet<number>;
}> {
  const processes = await processCommandLines();
  const candidates: DiscoveryCandidate[] = [];
  const chromiumPorts = new Set<number>();
  const seenDataDirs = new Set<string>();

  for (const item of processes) {
    if (isChromiumProcess(item.name)) {
      // Chromium answers `/session` with 403; the usable attach point is the
      // CDP browser WebSocket recorded in its DevToolsActivePort file. Portable
      // launchers often hide the port flag, so key on --user-data-dir instead.
      const dataDir = extractUserDataDir(item.commandLine);
      if (dataDir === undefined || seenDataDirs.has(dataDir)) {
        continue;
      }
      seenDataDirs.add(dataDir);
      const endpoint = chromiumEndpointFromDataDir(dataDir);
      if (endpoint === undefined) {
        continue;
      }
      addChromiumPort(chromiumPorts, endpoint);
      addCandidate(candidates, {
        endpoint,
        source: 'chromium-devtools-port',
        processId: item.processId,
        profilePath: dataDir,
        browserFamily: 'chromium',
      });
      continue;
    }

    const port = extractRemoteDebuggingPort(item.commandLine);
    if (port === undefined) {
      continue;
    }

    addCandidate(candidates, {
      endpoint: `ws://127.0.0.1:${port}/session`,
      source: 'process-cmdline',
      processId: item.processId,
    });
  }

  return { candidates, chromiumPorts };
}

function portCandidates(
  config: Config,
  chromiumPorts: ReadonlySet<number>
): readonly DiscoveryCandidate[] {
  const ports = [...new Set([config.port, 9222, 9223])].filter(
    (port) => !chromiumPorts.has(port)
  );
  return ports.map((port) => ({
    endpoint: `ws://127.0.0.1:${port}/session`,
    source: 'port-probe' as DiscoverySource,
  }));
}

/**
 * Return discovery candidates without probing them. Callers must verify the
 * endpoint themselves before using it.
 */
export async function discoverBrowsers(config: Config): Promise<
  readonly DiscoveryCandidate[]
> {
  const candidates: DiscoveryCandidate[] = [];
  let blockedNonLoopback = 0;

  const addEndpoint = (
    endpoint: string,
    source: DiscoverySource,
    extra?: Partial<DiscoveryCandidate>
  ): boolean => {
    if (!endpointAllowed(config, endpoint)) {
      blockedNonLoopback += 1;
      return false;
    }
    addCandidate(candidates, { endpoint, source, ...extra });
    return true;
  };

  if (config.wsUrl !== undefined) {
    if (!config.allowRemote && !isLoopback(config.wsUrl)) {
      throw new ActionableError(
        'INVALID_CONFIG',
        'Non-loopback BIDI_WS_URL requires BIDI_ALLOW_REMOTE=1.',
        {
          fix: 'Set BIDI_ALLOW_REMOTE=1 or use ws://127.0.0.1:<port>/session.',
        }
      );
    }
    addCandidate(candidates, {
      endpoint: config.wsUrl,
      source: 'env',
      // A DevTools browser WebSocket URL means Chromium: it speaks CDP, so
      // the session layer must start the in-process mapper.
      ...(/\/devtools\/browser\//.test(config.wsUrl)
        ? { browserFamily: 'chromium' as const }
        : {}),
    });
    return candidates;
  }

  if (config.profileDir !== undefined && existsSync(config.profileDir)) {
    const url = discoveryUrlFor(resolve(config.profileDir));
    if (url !== undefined) {
      addEndpoint(url, 'profile-file', {
        profilePath: resolve(config.profileDir),
      });
    }
  }

  for (const root of profileRoots(config)) {
    for (const dir of [...profileDirsFromIni(root), ...profileDirsFromRoot(root), root]) {
      const url = discoveryUrlFor(dir);
      if (url !== undefined) {
        addEndpoint(url, 'profiles-ini', { profilePath: dir });
      }
    }
  }

  const chromiumPorts = new Set<number>();

  for (const dir of chromiumDataDirs(config)) {
    const endpoint = chromiumEndpointFromDataDir(dir);
    if (endpoint !== undefined) {
      addChromiumPort(chromiumPorts, endpoint);
      addEndpoint(endpoint, 'chromium-devtools-port', {
        profilePath: dir,
        browserFamily: 'chromium',
      });
    }
  }

  const { candidates: processFound, chromiumPorts: processPorts } =
    await processCandidates();
  for (const candidate of processFound) {
    addEndpoint(candidate.endpoint, candidate.source, candidate);
  }
  for (const port of processPorts) {
    chromiumPorts.add(port);
  }

  for (const candidate of portCandidates(config, chromiumPorts)) {
    addEndpoint(candidate.endpoint, candidate.source, candidate);
  }

  if (blockedNonLoopback > 0 && candidates.length === 0) {
    throw new ActionableError(
      'INVALID_CONFIG',
      `${blockedNonLoopback} discovered BiDi endpoint(s) are non-loopback and BIDI_ALLOW_REMOTE is off.`,
      {
        fix: 'Use a loopback endpoint, or set BIDI_ALLOW_REMOTE=1 to allow remote hosts.',
      }
    );
  }

  return candidates;
}
