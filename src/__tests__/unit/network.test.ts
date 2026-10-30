import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../config.js';
import { NETWORK_SUBSCRIBED_EVENTS } from '../../connection/event-pipeline.js';
import { SessionManager } from '../../session/session-manager.js';
import { networkTool } from '../../tools/network.js';
import type { ServerContext } from '../../types.js';
import { MockBiDiServer } from '../mocks/bidi-server.js';

async function makeContext(server: MockBiDiServer, config: Record<string, string> = {}) {
  const url = await server.start();
  const loaded = loadConfig({ BIDI_WS_URL: url, ...config });
  const session = new SessionManager({ config: loaded, serverVersion: '0.1.6' });
  await session.connect();
  const ctx: ServerContext = { version: '0.1.6', config: loaded, startedAt: Date.now(), session };
  return ctx;
}

describe('network tool (live session via mock)', () => {
  let server: MockBiDiServer | undefined;
  let ctx: ServerContext | undefined;

  afterEach(async () => {
    await ctx?.session?.disconnect();
    await server?.stop();
    server = undefined;
    ctx = undefined;
  });

  it('is gated and the error names the flag (decisions §5)', async () => {
    server = new MockBiDiServer();
    ctx = await makeContext(server);

    await expect(networkTool.handler({ action: 'wait' }, ctx)).rejects.toMatchObject({
      code: 'UNSUPPORTED',
      message: expect.stringContaining('BIDI_ENABLE_NETWORK'),
      fix: expect.stringContaining('BIDI_ENABLE_NETWORK'),
    });
    expect(server.requests.every(
      (r) => r.method !== 'session.subscribe' ||
        !(r.params?.events as string[] | undefined)?.some((e) => e.startsWith('network.'))
    )).toBe(true);
  });

  it('subscribes additively once and matches a buffered response', async () => {
    server = new MockBiDiServer();
    ctx = await makeContext(server, { BIDI_ENABLE_NETWORK: '1' });

    // Traffic that completed before the wait call (the common
    // trigger-then-wait flow) is matched from the buffer.
    server.sendEvent('network.responseCompleted', {
      context: 'mock-context',
      request: { method: 'POST', url: 'https://api.test/submit' },
      response: { url: 'https://api.test/submit', status: 200 },
    });

    const result = await networkTool.handler(
      { action: 'wait', until: 'response', method: 'POST', urlPattern: 'api.test' },
      ctx
    );
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      event: 'response',
      method: 'POST',
      url: 'https://api.test/submit',
      status: 200,
      source: 'network.responseCompleted',
    });

    const subscribes = server.requests.filter(
      (r) => r.method === 'session.subscribe' &&
        (r.params?.events as string[] | undefined)?.some((e) => e.startsWith('network.'))
    );
    expect(subscribes).toHaveLength(1);
    const events = subscribes[0]?.params?.events as string[];
    for (const method of NETWORK_SUBSCRIBED_EVENTS) {
      expect(events).toContain(method);
    }
  });

  it('honors method/url/context filters', async () => {
    server = new MockBiDiServer();
    ctx = await makeContext(server, { BIDI_ENABLE_NETWORK: '1' });

    server.sendEvent('network.responseCompleted', {
      context: 'other-context',
      request: { method: 'POST', url: 'https://api.test/submit' },
      response: { url: 'https://api.test/submit', status: 200 },
    });

    await expect(
      networkTool.handler({ action: 'wait', method: 'POST', timeout: 300 }, ctx)
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('times out with TIMEOUT when nothing matches', async () => {
    server = new MockBiDiServer();
    ctx = await makeContext(server, { BIDI_ENABLE_NETWORK: '1' });

    await expect(
      networkTool.handler({ action: 'wait', urlPattern: 'never.test', timeout: 300 }, ctx)
    ).rejects.toMatchObject({
      code: 'TIMEOUT',
      message: expect.stringContaining('no matching response'),
    });
  });

  it('matches requests with until: request', async () => {
    server = new MockBiDiServer();
    ctx = await makeContext(server, { BIDI_ENABLE_NETWORK: '1' });

    server.sendEvent('network.beforeRequestSent', {
      context: 'mock-context',
      request: { method: 'GET', url: 'https://api.test/poll' },
    });

    const result = await networkTool.handler({ action: 'wait', until: 'request' }, ctx);
    expect(result.data).toMatchObject({ event: 'request', url: 'https://api.test/poll' });
  });

  it('treats fetchError as a response-class match', async () => {
    server = new MockBiDiServer();
    ctx = await makeContext(server, { BIDI_ENABLE_NETWORK: '1' });

    server.sendEvent('network.fetchError', {
      context: 'mock-context',
      request: { method: 'GET', url: 'https://api.test/dead' },
      errorText: 'connection refused',
    });

    const result = await networkTool.handler({ action: 'wait', until: 'response' }, ctx);
    expect(result.data).toMatchObject({ event: 'error', url: 'https://api.test/dead' });
  });
});
