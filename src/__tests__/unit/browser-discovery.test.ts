import { afterAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../config.js';
import {
  chromiumEndpointFromDataDir,
  discoverBrowsers,
  extractUserDataDir,
  extractRemoteDebuggingPort,
} from '../../connection/browser-discovery.js';

describe('extractRemoteDebuggingPort', () => {
  it('parses supported command-line shapes', () => {
    expect(extractRemoteDebuggingPort('firefox --remote-debugging-port=9223')).toBe(9223);
    expect(extractRemoteDebuggingPort('firefox --remote-debugging-port 9223')).toBe(9223);
    expect(extractRemoteDebuggingPort('firefox --remote-debugging-port')).toBe(9222);
    expect(extractRemoteDebuggingPort('firefox')).toBeUndefined();
    expect(extractRemoteDebuggingPort('firefox --remote-debugging-port=0')).toBeUndefined();
  });
});

describe('discoverBrowsers', () => {
  it('uses an explicit BIDI_WS_URL as the highest-priority candidate', async () => {
    const config = loadConfig({ BIDI_WS_URL: 'ws://127.0.0.1:9223/session' });
    const candidates = await discoverBrowsers(config);
    expect(candidates[0]).toMatchObject({
      endpoint: 'ws://127.0.0.1:9223/session',
      source: 'env',
    });
  });

  it('rejects non-loopback URLs unless BIDI_ALLOW_REMOTE=1', async () => {
    const config = loadConfig({ BIDI_WS_URL: 'ws://example.com/session' });
    await expect(discoverBrowsers(config)).rejects.toMatchObject({
      code: 'INVALID_CONFIG',
    });
  });
});

describe('discoverBrowsers profile-file gating', () => {
  let root: string | undefined;

  afterAll(() => {
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function profileWithDiscovery(
    name: string,
    discovery: Record<string, unknown>
  ): string {
    if (root === undefined) {
      root = mkdtempSync(join(tmpdir(), 'bidi-discovery-'));
    }
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'WebDriverBiDiServer.json'),
      JSON.stringify(discovery)
    );
    return dir;
  }

  it('blocks a non-loopback profile endpoint unless BIDI_ALLOW_REMOTE=1', async () => {
    // Profile files are user-writable data: a tampered discovery file must
    // never point the server at a remote host (regression for the
    // BIDI_ALLOW_REMOTE=off bypass).
    const profileDir = profileWithDiscovery('remote', {
      ws_host: '10.0.0.5',
      ws_port: 44193,
    });

    const blocked = await discoverBrowsers(loadConfig({ BIDI_PROFILE_DIR: profileDir }));
    expect(blocked.some((c) => c.endpoint.includes('10.0.0.5'))).toBe(false);

    const allowed = await discoverBrowsers(
      loadConfig({ BIDI_PROFILE_DIR: profileDir, BIDI_ALLOW_REMOTE: '1' })
    );
    expect(
      allowed.some((c) => c.endpoint === 'ws://10.0.0.5:44193/session')
    ).toBe(true);
  });

  it('drops profile files with a malformed ws_port', async () => {
    const floatDir = profileWithDiscovery('float', { ws_host: '127.0.0.1', ws_port: 1.5 });
    const hugeDir = profileWithDiscovery('huge', { ws_host: '127.0.0.1', ws_port: 99999 });

    const blocked = await discoverBrowsers(loadConfig({ BIDI_PROFILE_DIR: floatDir }));
    const huge = await discoverBrowsers(loadConfig({ BIDI_PROFILE_DIR: hugeDir }));

    expect(
      blocked.some((c) => c.endpoint.endsWith(':1.5/session'))
    ).toBe(false);
    expect(
      huge.some((c) => c.endpoint.endsWith(':99999/session'))
    ).toBe(false);
  });
});

describe('chromiumEndpointFromDataDir', () => {
  let root: string | undefined;

  afterAll(() => {
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function dataDirWith(contents: string | undefined): string {
    if (root === undefined) {
      root = mkdtempSync(join(tmpdir(), 'bidi-chromium-'));
    }
    const dir = mkdtempSync(join(root, 'data-'));
    if (contents !== undefined) {
      writeFileSync(join(dir, 'DevToolsActivePort'), contents);
    }
    return dir;
  }

  it('reads the port and browser WebSocket path', () => {
    const dir = dataDirWith('9222\r\n/devtools/browser/abc-123\r\n');
    expect(chromiumEndpointFromDataDir(dir)).toBe(
      'ws://127.0.0.1:9222/devtools/browser/abc-123'
    );
  });

  it('rejects missing, malformed, and non-browser files', () => {
    expect(chromiumEndpointFromDataDir(dataDirWith(undefined))).toBeUndefined();
    expect(chromiumEndpointFromDataDir(dataDirWith('nope\n/devtools/browser/x'))).toBeUndefined();
    expect(chromiumEndpointFromDataDir(dataDirWith('9222\n'))).toBeUndefined();
    expect(chromiumEndpointFromDataDir(dataDirWith('9222\n/devtools/page/x'))).toBeUndefined();
  });

  it('discovers a chromium candidate from BIDI_CHROMIUM_DATA_DIR', async () => {
    const dir = dataDirWith('9333\n/devtools/browser/xyz\n');
    const candidates = await discoverBrowsers(
      loadConfig({ BIDI_CHROMIUM_DATA_DIR: dir })
    );
    expect(candidates).toContainEqual(
      expect.objectContaining({
        endpoint: 'ws://127.0.0.1:9333/devtools/browser/xyz',
        source: 'chromium-devtools-port',
        browserFamily: 'chromium',
      })
    );
  });

  it('excludes a live dir-scanned Chromium port from BiDi port probes', async () => {
    // Exclusion now requires CDP liveness (§6): serve the version endpoint.
    const cdp = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"Browser":"Chrome/153.0.0.0"}');
    });
    await new Promise<void>((resolve, reject) => {
      cdp.once('error', reject);
      cdp.listen(0, '127.0.0.1', resolve);
    });
    // Ask the OS which port we got, then record it in the fake data dir.
    const address = cdp.address() as AddressInfo;
    const dir = dataDirWith(`${address.port}\n/devtools/browser/abc\n`);
    try {
      const candidates = await discoverBrowsers(
        loadConfig({ BIDI_CHROMIUM_DATA_DIR: dir, BIDI_PORT: String(address.port) })
      );
      expect(candidates.map((candidate) => candidate.endpoint)).not.toContain(
        `ws://127.0.0.1:${address.port}/session`
      );
    } finally {
      cdp.closeAllConnections();
      await new Promise<void>((resolve) => cdp.close(() => resolve()));
    }
  }, 20000);

  it('probes a dead dir-scanned Chromium port so a Firefox there is not shadowed', async () => {
    // No CDP server on this port: the recorded port must stay probeable (§6).
    const dir = dataDirWith('9444\n/devtools/browser/abc\n');
    const candidates = await discoverBrowsers(
      loadConfig({ BIDI_CHROMIUM_DATA_DIR: dir, BIDI_PORT: '9444' })
    );
    expect(candidates.map((candidate) => candidate.endpoint)).toContain(
      'ws://127.0.0.1:9444/session'
    );
  }, 20000);

  it('marks BIDI_WS_URL DevTools endpoints as chromium', async () => {
    const candidates = await discoverBrowsers(
      loadConfig({ BIDI_WS_URL: 'ws://127.0.0.1:9222/devtools/browser/xyz' })
    );
    expect(candidates[0]).toMatchObject({
      source: 'env',
      browserFamily: 'chromium',
    });
  });
});

describe('extractUserDataDir', () => {
  it('parses quoted and plain --user-data-dir values', () => {
    expect(
      extractUserDataDir('brave.exe --remote-debugging-port=9222 --user-data-dir="A:/Browsers/brave-portable/data"')
    ).toBe('A:/Browsers/brave-portable/data');
    expect(extractUserDataDir('chrome --user-data-dir=/tmp/chrome-profile')).toBe(
      '/tmp/chrome-profile'
    );
    expect(extractUserDataDir('chrome --remote-debugging-port=9222')).toBeUndefined();
  });

  it('parses the space-separated form used by launchers', () => {
    expect(
      extractUserDataDir('brave.exe --user-data-dir "C:/Users/me/App Data/brave"')
    ).toBe('C:/Users/me/App Data/brave');
    expect(
      extractUserDataDir('brave.exe --user-data-dir C:/Users/me/brave')
    ).toBe('C:/Users/me/brave');
    expect(
      extractUserDataDir('chrome --user-data-dir --remote-debugging-port=9222')
    ).toBeUndefined();
    expect(extractUserDataDir('chrome --user-data-dir=')).toBeUndefined();
  });
});
