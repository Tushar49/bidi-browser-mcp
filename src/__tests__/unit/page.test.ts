import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../config.js';
import { SessionManager } from '../../session/session-manager.js';
import { pageTool } from '../../tools/page.js';
import type { ServerContext } from '../../types.js';
import { MockBiDiServer } from '../mocks/bidi-server.js';

const FIXTURE_JSON = JSON.stringify({
  title: 'Fixture',
  url: 'https://fixture.test/page',
  text: 'Hello fixture',
  elements: [
    { role: 'button', name: 'Go', tag: 'button', bounds: [0, 0, 10, 10], selector: '#go' },
    { role: 'textbox', name: 'Q', tag: 'input', bounds: [0, 20, 10, 10], selector: '#q' },
  ],
});

async function makeContext(server: MockBiDiServer): Promise<ServerContext> {
  const url = await server.start();
  const config = loadConfig({ BIDI_WS_URL: url });
  const session = new SessionManager({ config, serverVersion: '0.1.6' });
  await session.connect();
  return { version: '0.1.6', config, startedAt: Date.now(), session };
}

describe('page tool (live session via mock)', () => {
  let server: MockBiDiServer | undefined;
  let ctx: ServerContext | undefined;

  afterEach(async () => {
    await ctx?.session?.disconnect();
    await server?.stop();
    server = undefined;
    ctx = undefined;
  });

  it('snapshots interactive elements and caches the build', async () => {
    server = new MockBiDiServer();
    server.on('script.evaluate', () => ({ type: 'success', result: { type: 'string', value: FIXTURE_JSON } }));
    ctx = await makeContext(server);

    const first = await pageTool.handler({ action: 'snapshot' }, ctx);
    expect(first.data).toMatchObject({
      url: 'https://fixture.test/page',
      title: 'Fixture',
      context: 'mock-context',
    });
    expect((first.data as { elements: { uid: string }[] }).elements.map((el) => el.uid)).toEqual(['e1', 'e2']);
    expect(first.data).toHaveProperty('meta');

    // Second call is served from cache: no new script.evaluate request.
    await pageTool.handler({ action: 'snapshot' }, ctx);
    const evaluates = server.requests.filter((request) => request.method === 'script.evaluate');
    expect(evaluates).toHaveLength(1);

    // Refresh bypasses the cache.
    await pageTool.handler({ action: 'snapshot', refresh: true }, ctx);
    expect(server.requests.filter((request) => request.method === 'script.evaluate')).toHaveLength(2);
  });

  it('never reads live field values in the snapshot script', async () => {
    server = new MockBiDiServer();
    server.on('script.evaluate', () => ({ type: 'success', result: { type: 'string', value: FIXTURE_JSON } }));
    ctx = await makeContext(server);

    await pageTool.handler({ action: 'snapshot' }, ctx);
    const evaluate = server.requests.find((request) => request.method === 'script.evaluate');
    const script = JSON.stringify(evaluate?.params ?? '');

    // Regression: a password (or any live field value) must never reach the
    // snapshot, the agent context, or client logs.
    expect(script).not.toMatch(/\.value\b/);
    expect(script).toContain("type === 'password'");
  });

  it('serves text mode and content from the same build', async () => {
    server = new MockBiDiServer();
    server.on('script.evaluate', () => ({ type: 'success', result: { type: 'string', value: FIXTURE_JSON } }));
    ctx = await makeContext(server);

    const text = await pageTool.handler({ action: 'snapshot', mode: 'text' }, ctx);
    expect(text.data).toMatchObject({ title: 'Fixture', text: 'Hello fixture' });

    const content = await pageTool.handler({ action: 'content' }, ctx);
    expect(content.data).toMatchObject({ url: 'https://fixture.test/page', text: 'Hello fixture' });
  });

  it('invalidates the cache on navigation events', async () => {
    server = new MockBiDiServer();
    server.on('script.evaluate', () => ({ type: 'success', result: { type: 'string', value: FIXTURE_JSON } }));
    ctx = await makeContext(server);

    await pageTool.handler({ action: 'snapshot' }, ctx);
    ctx.session?.runtime?.snapshots.handleEvent({
      type: 'event',
      method: 'browsingContext.domContentLoaded',
      params: { context: 'mock-context' },
    });
    await pageTool.handler({ action: 'snapshot' }, ctx);

    expect(server.requests.filter((request) => request.method === 'script.evaluate')).toHaveLength(2);
  });

  it('navigates with the requested wait and drops the stale snapshot', async () => {
    server = new MockBiDiServer();
    server.on('script.evaluate', () => ({ type: 'success', result: { type: 'string', value: FIXTURE_JSON } }));
    server.on('browsingContext.navigate', (params) => {
      // The friendly wait name maps onto BiDi's enum (§5).
      expect(params.wait).toBe('complete');
      return { navigation: 'nav-1', url: params.url };
    });
    ctx = await makeContext(server);

    await pageTool.handler({ action: 'snapshot' }, ctx);
    const result = await pageTool.handler(
      { action: 'navigate', url: 'https://example.test/next', wait: 'load' },
      ctx
    );
    expect(result.data).toMatchObject({
      url: 'https://example.test/next',
      navigation: 'nav-1',
      wait: 'load',
    });

    const nav = server.requests.find((request) => request.method === 'browsingContext.navigate');
    expect(nav?.params).toMatchObject({ context: 'mock-context', wait: 'complete' });

    // The cached snapshot described the old document (§5).
    expect(ctx.session?.runtime?.snapshots.get('mock-context')).toBeUndefined();
  });

  it('defaults the wait milestone to domContentLoaded', async () => {
    server = new MockBiDiServer();
    server.on('browsingContext.navigate', (params) => {
      expect(params.wait).toBe('interactive');
      return { navigation: 'nav-2', url: params.url };
    });
    ctx = await makeContext(server);

    const result = await pageTool.handler({ action: 'navigate', url: 'https://example.test/' }, ctx);
    expect(result.data).toMatchObject({ wait: 'domContentLoaded' });
  });

  it('maps navigation failures to NAVIGATION_FAILED', async () => {
    server = new MockBiDiServer();
    server.on('browsingContext.navigate', () => {
      throw new Error('Address unavailable');
    });
    ctx = await makeContext(server);

    await expect(
      pageTool.handler({ action: 'navigate', url: 'https://unreachable.test/' }, ctx)
    ).rejects.toMatchObject({
      code: 'NAVIGATION_FAILED',
      message: expect.stringContaining('https://unreachable.test/'),
    });
  });

  it('refuses non-navigable URL schemes', async () => {
    server = new MockBiDiServer();
    ctx = await makeContext(server);

    await expect(
      pageTool.handler({ action: 'navigate', url: 'file:///C:/Windows/system.ini' }, ctx)
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(server.requests.some((request) => request.method === 'browsingContext.navigate')).toBe(false);
  });
});
