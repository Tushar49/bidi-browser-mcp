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
});
