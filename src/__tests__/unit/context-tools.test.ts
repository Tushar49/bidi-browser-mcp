import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../config.js';
import { SessionManager } from '../../session/session-manager.js';
import { cleanupTool } from '../../tools/cleanup.js';
import { consoleTool } from '../../tools/console.js';
import { observeTool } from '../../tools/observe.js';
import { tabsTool } from '../../tools/tabs.js';
import type { ServerContext } from '../../types.js';
import { MockBiDiServer } from '../mocks/bidi-server.js';

async function makeContext(server: MockBiDiServer): Promise<ServerContext> {
  const url = await server.start();
  const config = loadConfig({ BIDI_WS_URL: url });
  const session = new SessionManager({ config, serverVersion: '0.1.5' });
  await session.connect();
  return {
    version: '0.1.5',
    config,
    startedAt: Date.now(),
    session,
  };
}

describe('tabs tool (live session via mock)', () => {
  let server: MockBiDiServer | undefined;
  let ctx: ServerContext | undefined;

  afterEach(async () => {
    await ctx?.session?.disconnect();
    await server?.stop();
    server = undefined;
    ctx = undefined;
  });

  it('lists tabs with the selected marker', async () => {
    server = new MockBiDiServer();
    ctx = await makeContext(server);

    const result = await tabsTool.handler({ action: 'list' }, ctx);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      tabs: [{ context: 'mock-context', url: 'about:blank', selected: true }],
    });
  });

  it('new, select, info, and close round-trip', async () => {
    server = new MockBiDiServer();
    ctx = await makeContext(server);

    const created = await tabsTool.handler(
      { action: 'new', url: 'https://example.test/' },
      ctx
    );
    expect(created.ok).toBe(true);
    const context = (created.data as { tab: { context: string } }).tab.context;
    expect(context).toBe('mock-tab-1');

    const info = await tabsTool.handler({ action: 'info', context }, ctx);
    expect(info.data).toMatchObject({ tab: { url: 'https://example.test/' } });

    const selected = await tabsTool.handler({ action: 'select', context }, ctx);
    expect(selected.data).toMatchObject({ tab: { context, selected: true } });

    const listed = await tabsTool.handler({ action: 'list' }, ctx);
    expect((listed.data as { tabs: unknown[] }).tabs).toHaveLength(2);

    const closed = await tabsTool.handler({ action: 'close', context }, ctx);
    expect(closed.data).toMatchObject({ closed: context });

    const after = await tabsTool.handler({ action: 'list' }, ctx);
    expect((after.data as { tabs: unknown[] }).tabs).toHaveLength(1);
  });

  it('activate focuses a tab and updates selection', async () => {
    server = new MockBiDiServer();
    ctx = await makeContext(server);

    const created = await tabsTool.handler({ action: 'new' }, ctx);
    const context = (created.data as { tab: { context: string } }).tab.context;
    const activated = await tabsTool.handler({ action: 'activate', context }, ctx);
    expect(activated.data).toMatchObject({ tab: { context, selected: true } });
  });

  it('rejects actions without context where required', async () => {
    server = new MockBiDiServer();
    ctx = await makeContext(server);

    await expect(tabsTool.handler({ action: 'close' }, ctx)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(tabsTool.handler({ action: 'info', context: 'ghost' }, ctx)).rejects.toMatchObject({
      code: 'TAB_NOT_FOUND',
    });
  });

  it('blocks local-file and script URL schemes in tabs.new', async () => {
    server = new MockBiDiServer();
    ctx = await makeContext(server);

    // file:, data:, and javascript: turn the browser into a local-file or
    // script reader — only http(s) and about:blank may be opened.
    for (const url of [
      'file:///C:/Users/test/secret.txt',
      'data:text/html,<script>alert(1)</script>',
      'javascript:alert(1)',
    ]) {
      await expect(tabsTool.handler({ action: 'new', url }, ctx)).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
    }

    const allowed = await tabsTool.handler({ action: 'new', url: 'https://example.test/' }, ctx);
    expect(allowed.ok).toBe(true);
  });

  it('rejects a non-positive event limit', async () => {
    server = new MockBiDiServer();
    ctx = await makeContext(server);

    await expect(observeTool.handler({ action: 'events', limit: 0 }, ctx)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(observeTool.handler({ action: 'events', limit: 1.5 }, ctx)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(consoleTool.handler({ action: 'list', limit: -1 }, ctx)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });
});

describe('console tool (live session via mock)', () => {
  let server: MockBiDiServer | undefined;
  let ctx: ServerContext | undefined;

  afterEach(async () => {
    await ctx?.session?.disconnect();
    await server?.stop();
    server = undefined;
    ctx = undefined;
  });

  it('lists buffered console entries and clears them', async () => {
    server = new MockBiDiServer();
    ctx = await makeContext(server);
    const runtime = ctx.session?.runtime;
    runtime?.events.record({
      type: 'event',
      method: 'log.entryAdded',
      params: { channel: 'console', level: 'error', text: 'boom', context: 'mock-context' },
    });

    const listed = await consoleTool.handler(
      { action: 'list', level: 'error' },
      ctx
    );
    expect(listed.data).toMatchObject({
      entries: [{ level: 'error', text: 'boom', context: 'mock-context' }],
    });

    const cleared = await consoleTool.handler({ action: 'clear' }, ctx);
    expect(cleared.data).toEqual({ cleared: true });

    const after = await consoleTool.handler({ action: 'list' }, ctx);
    expect((after.data as { entries: unknown[] }).entries).toHaveLength(0);
  });
});

describe('observe tool (live session via mock)', () => {
  let server: MockBiDiServer | undefined;
  let ctx: ServerContext | undefined;

  afterEach(async () => {
    await ctx?.session?.disconnect();
    await server?.stop();
    server = undefined;
    ctx = undefined;
  });

  it('reports stats and drains buffered events', async () => {
    server = new MockBiDiServer();
    ctx = await makeContext(server);
    const runtime = ctx.session?.runtime;
    runtime?.events.record({
      type: 'event',
      method: 'browsingContext.domContentLoaded',
      params: { context: 'mock-context', url: 'https://example.test/' },
    });

    const status = await observeTool.handler({ action: 'status' }, ctx);
    expect(status.data).toMatchObject({
      buffered: { 'browsingContext.domContentLoaded': 1 },
      dropped: {},
    });
    expect((status.data as { subscribed: string[] }).subscribed.length).toBeGreaterThan(0);

    const drained = await observeTool.handler(
      { action: 'events', methods: ['browsingContext.domContentLoaded'], drain: true },
      ctx
    );
    expect((drained.data as { events: unknown[] }).events).toHaveLength(1);
    const after = await observeTool.handler({ action: 'status' }, ctx);
    expect((after.data as { buffered: Record<string, number> }).buffered).toEqual({});
  });
});

describe('cleanup tool', () => {
  let server: MockBiDiServer | undefined;
  let ctx: ServerContext | undefined;

  afterEach(async () => {
    server = undefined;
    ctx = undefined;
  });

  it('ends the session without closing the browser', async () => {
    server = new MockBiDiServer();
    ctx = await makeContext(server);

    const result = await cleanupTool.handler({ action: 'disconnect' }, ctx);
    expect(result.data).toEqual({ connected: false });
    expect(ctx?.session?.runtime).toBeUndefined();
    expect(server.requests.some((request) => request.method === 'session.end')).toBe(true);
  });

  it('rejects unknown actions', async () => {
    server = new MockBiDiServer();
    ctx = await makeContext(server);

    await expect(cleanupTool.handler({ action: 'purge' }, ctx)).rejects.toMatchObject({
      code: 'INVALID_ACTION',
    });
  });
});
