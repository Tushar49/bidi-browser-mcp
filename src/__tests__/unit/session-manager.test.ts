import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../config.js';
import { SessionManager } from '../../session/session-manager.js';
import { MockBiDiServer } from '../mocks/bidi-server.js';
import { ActionableError } from '../../utils/errors.js';

describe('SessionManager', () => {
  let server: MockBiDiServer | undefined;

  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  it('connects once, reports status, and disconnects cleanly', async () => {
    server = new MockBiDiServer();
    const url = await server.start();
    const config = loadConfig({ BIDI_WS_URL: url });
    const manager = new SessionManager({ config, serverVersion: '0.1.4' });

    const status = await manager.connect();
    expect(status.connected).toBe(true);
    expect(status.sessionId).toContain('mock-session-');

    const statusAgain = await manager.connect();
    expect(statusAgain.connected).toBe(true);

    await manager.disconnect();
    const disconnected = await manager.status();
    expect(disconnected).toEqual({ connected: false });
  });

  it('reports discovery candidates from BIDI_WS_URL', async () => {
    server = new MockBiDiServer();
    const url = await server.start();
    const config = loadConfig({ BIDI_WS_URL: url });
    const manager = new SessionManager({ config, serverVersion: '0.1.4' });

    const profiles = await manager.profiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ endpoint: url, source: 'env' });
  });

  it('escalates a session conflict to DISCOVERY_FAILED when recovery is impossible', async () => {
    server = new MockBiDiServer();
    const url = await server.start();
    server.on('session.new', () => {
      throw new Error('Maximum number of active sessions');
    });

    const config = loadConfig({
      BIDI_WS_URL: url,
      BIDI_TEMP_DIR: '.temp/test-conflict',
    });
    const manager = new SessionManager({ config, serverVersion: '0.1.7' });

    // No persisted record exists, so recovery cannot run and the conflict
    // escalates to the final discovery error.
    await expect(manager.connect()).rejects.toMatchObject({
      code: 'DISCOVERY_FAILED',
    });
  });

  it('awaits an in-flight connect before tearing down', async () => {
    server = new MockBiDiServer();
    const url = await server.start();
    const config = loadConfig({ BIDI_WS_URL: url });
    const manager = new SessionManager({ config, serverVersion: '0.1.4' });

    const connecting = manager.connect();
    await manager.disconnect();

    await expect(connecting).resolves.toMatchObject({ connected: true });
    expect(await manager.status()).toEqual({ connected: false });
    expect(server.requests.some((r) => r.method === 'session.end')).toBe(true);
  });

  it('recovers a session left behind by a dead process', async () => {
    server = new MockBiDiServer();
    const url = await server.start();
    const config = loadConfig({ BIDI_WS_URL: url, BIDI_TEMP_DIR: '.temp/test-recovery' });

    // Process A connects (creates + persists the session record), then dies
    // without a clean shutdown: the mock's session slot stays occupied.
    const dead = new SessionManager({ config, serverVersion: '0.1.7' });
    await dead.connect();

    // Process B reads the persisted record, reattaches via the dedicated
    // /session/<id> path, ends the orphan, and takes a fresh session.
    const heir = new SessionManager({ config, serverVersion: '0.1.7' });
    const status = await heir.connect();
    expect(status.connected).toBe(true);
    expect(status.sessionId).toContain('mock-session-');

    await heir.disconnect();
  });

  it('fails with DISCOVERY_FAILED when no endpoint is reachable', async () => {
    server = new MockBiDiServer();
    const config = loadConfig({ BIDI_WS_URL: 'ws://127.0.0.1:1/session' });
    const manager = new SessionManager({ config, serverVersion: '0.1.4' });

    await expect(manager.connect()).rejects.toBeInstanceOf(ActionableError);
  });
});
