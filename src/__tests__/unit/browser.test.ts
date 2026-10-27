import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../config.js';
import { SessionManager } from '../../session/session-manager.js';
import { browserTool } from '../../tools/browser.js';
import type { Config, ServerContext } from '../../types.js';
import { MockBiDiServer } from '../mocks/bidi-server.js';

async function makeContext(url: string): Promise<{ ctx: ServerContext; manager: SessionManager }> {
  const config: Config = loadConfig({ BIDI_WS_URL: url });
  const manager = new SessionManager({ config, serverVersion: '0.1.4' });
  const ctx: ServerContext = {
    version: '0.1.4',
    config,
    startedAt: Date.now(),
    session: manager,
  };
  return { ctx, manager };
}

describe('browser tool', () => {
  let server: MockBiDiServer | undefined;

  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  it('reports status and profiles', async () => {
    server = new MockBiDiServer();
    const url = await server.start();
    const { ctx, manager } = await makeContext(url);

    const status = await browserTool.handler({ action: 'status' }, ctx);
    expect(status.ok).toBe(true);
    expect(status.data).toMatchObject({ connected: false });

    const profiles = await browserTool.handler({ action: 'profiles' }, ctx);
    expect(profiles.ok).toBe(true);
    expect(profiles.data).toMatchObject({
      candidates: [{ endpoint: url, source: 'env' }],
    });

    await manager.disconnect();
  });

  it('connects and disconnects explicitly', async () => {
    server = new MockBiDiServer();
    const url = await server.start();
    const { ctx, manager } = await makeContext(url);

    const connected = await browserTool.handler({ action: 'connect' }, ctx);
    expect(connected.ok).toBe(true);
    expect(connected.data).toMatchObject({ connected: true });

    const disconnected = await browserTool.handler({ action: 'disconnect' }, ctx);
    expect(disconnected.ok).toBe(true);
    expect(disconnected.data).toMatchObject({ connected: false });

    await manager.disconnect();
  });

  it('reports version', async () => {
    server = new MockBiDiServer();
    const url = await server.start();
    const { ctx, manager } = await makeContext(url);

    const version = await browserTool.handler({ action: 'version' }, ctx);
    expect(version.ok).toBe(true);
    expect(version.data).toMatchObject({ serverVersion: '0.1.4' });

    await manager.disconnect();
  });
});
