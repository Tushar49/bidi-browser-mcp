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

  it('profiles enrich candidates with id, reachability, and the live one', async () => {
    server = new MockBiDiServer();
    const url = await server.start();
    const config = loadConfig({ BIDI_WS_URL: url });
    const manager = new SessionManager({ config, serverVersion: '0.1.6' });

    const before = await manager.profiles();
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ endpoint: url, reachable: true });
    expect(before[0].id).toMatch(/^f-\d+$/);
    expect(before[0].live).toBeUndefined();

    await manager.connect();
    const after = await manager.profiles();
    expect(after[0]).toMatchObject({ live: true, reachable: true });
  });

  it('connectTo targets by endpoint and by port, and rejects unknown ids', async () => {
    server = new MockBiDiServer();
    const url = await server.start();
    const config = loadConfig({ BIDI_WS_URL: url });
    const manager = new SessionManager({ config, serverVersion: '0.1.6' });

    // By exact endpoint.
    const byEndpoint = await manager.connectTo(url);
    expect(byEndpoint.connected).toBe(true);

    // Already connected to that target: no reconnect, still fine.
    const again = await manager.connectTo(url);
    expect(again.connected).toBe(true);

    // By port.
    const port = /:(\d{2,5})\//.exec(url)?.[1];
    expect(port).toBeDefined();
    const byPort = await manager.connectTo(port as string);
    expect(byPort.connected).toBe(true);

    // Unknown id → INVALID_ARGUMENT whose fix lists the real candidates.
    await expect(manager.connectTo('f-99999')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      fix: expect.stringContaining(url),
    });

    await manager.disconnect();
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

  it('reports honest state and recovers after the socket drops', async () => {
    server = new MockBiDiServer();
    const url = await server.start();
    const config = loadConfig({
      BIDI_WS_URL: url,
      BIDI_TEMP_DIR: '.temp/test-drop',
    });
    const manager = new SessionManager({ config, serverVersion: '0.1.8' });

    await manager.connect();
    expect((await manager.status()).connected).toBe(true);
    expect(manager.runtime).toBeDefined();

    // The browser (or network) drops the socket without a close frame.
    server.dropConnections();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // State is honest immediately; the mock's session slot is still held.
    expect(await manager.status()).toEqual({ connected: false });
    expect(manager.runtime).toBeUndefined();

    // The next connect recovers the orphaned session and takes a fresh one.
    const status = await manager.connect();
    expect(status.connected).toBe(true);
    expect(status.sessionId).toContain('mock-session-');

    await manager.disconnect();
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
