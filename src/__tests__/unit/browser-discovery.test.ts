import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../config.js';
import {
  discoverBrowsers,
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
