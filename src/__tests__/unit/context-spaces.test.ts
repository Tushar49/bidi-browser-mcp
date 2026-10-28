import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../config.js';
import { SessionManager } from '../../session/session-manager.js';
import { contextTool } from '../../tools/context.js';
import { spacesTool } from '../../tools/spaces.js';
import { tabsTool } from '../../tools/tabs.js';
import type { ServerContext } from '../../types.js';
import { MockBiDiServer } from '../mocks/bidi-server.js';

async function makeContext(server: MockBiDiServer): Promise<ServerContext> {
  const url = await server.start();
  const config = loadConfig({ BIDI_WS_URL: url });
  const session = new SessionManager({ config, serverVersion: '0.1.7' });
  await session.connect();
  return { version: '0.1.7', config, startedAt: Date.now(), session };
}

describe('context tool (live session via mock)', () => {
  let server: MockBiDiServer | undefined;
  let ctx: ServerContext | undefined;

  afterEach(async () => {
    await ctx?.session?.disconnect();
    await server?.stop();
    server = undefined;
    ctx = undefined;
  });

  it('lists containers with tab counts', async () => {
    server = new MockBiDiServer();
    ctx = await makeContext(server);

    const result = await contextTool.handler({ action: 'list' }, ctx);
    const containers = (result.data as { containers: { userContext: string; tabCount: number }[] }).containers;
    expect(containers).toHaveLength(2);
    expect(containers[0]).toMatchObject({ userContext: 'default', tabCount: 1 });
    expect(containers[1]).toMatchObject({ userContext: 'aaaaaaaa-1111-4222-8333-444444444444', tabCount: 0 });
  });

  it('creates and removes containers', async () => {
    server = new MockBiDiServer();
    ctx = await makeContext(server);

    const created = await contextTool.handler({ action: 'new' }, ctx);
    const userContext = (created.data as { userContext: string }).userContext;
    expect(userContext).toMatch(/^bbbbbbbb-/);

    const afterCreate = await contextTool.handler({ action: 'list' }, ctx);
    expect(
      (afterCreate.data as { containers: { userContext: string }[] }).containers.map((c) => c.userContext)
    ).toContain(userContext);

    const removed = await contextTool.handler({ action: 'remove', userContext, confirm: true }, ctx);
    expect(removed.data).toEqual({ removed: userContext });

    const afterRemove = await contextTool.handler({ action: 'list' }, ctx);
    expect(
      (afterRemove.data as { containers: { userContext: string }[] }).containers.map((c) => c.userContext)
    ).not.toContain(userContext);
  });

  it('opens tabs inside a container and lists them', async () => {
    server = new MockBiDiServer();
    ctx = await makeContext(server);

    const created = (await contextTool.handler({ action: 'new' }, ctx)).data as { userContext: string };
    const container = created.userContext;
    const tab = await tabsTool.handler(
      { action: 'new', userContext: container, url: 'https://container.test/' },
      ctx
    );
    expect(tab.data).toMatchObject({ userContext: container, url: 'https://container.test/' });

    const tabsIn = await contextTool.handler({ action: 'tabs-in', userContext: container }, ctx);
    expect(tabsIn.data).toMatchObject({
      userContext: container,
      tabs: [{ url: 'https://container.test/' }],
    });
  });

  it('rejects removing the default container and missing args', async () => {
    server = new MockBiDiServer();
    ctx = await makeContext(server);

    await expect(contextTool.handler({ action: 'remove', userContext: 'default' }, ctx)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(contextTool.handler({ action: 'remove', userContext: 'ghost' }, ctx)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });

  it('defaults tabs-in to the default container', async () => {
    server = new MockBiDiServer();
    ctx = await makeContext(server);

    const tabsIn = await contextTool.handler({ action: 'tabs-in' }, ctx);
    expect(tabsIn.data).toMatchObject({ userContext: 'default' });
  });

  it('requires confirm before removing a container', async () => {
    server = new MockBiDiServer();
    ctx = await makeContext(server);

    const created = await contextTool.handler({ action: 'new' }, ctx);
    const userContext = (created.data as { userContext: string }).userContext;

    // Without confirm the container and its data stay untouched.
    await expect(
      contextTool.handler({ action: 'remove', userContext }, ctx)
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const afterAttempt = await contextTool.handler({ action: 'list' }, ctx);
    expect(
      (afterAttempt.data as { containers: { userContext: string }[] }).containers.map((c) => c.userContext)
    ).toContain(userContext);
  });
});

describe('spaces tool (live session via mock)', () => {
  let server: MockBiDiServer | undefined;
  let ctx: ServerContext | undefined;

  afterEach(async () => {
    await ctx?.session?.disconnect();
    await server?.stop();
    server = undefined;
    ctx = undefined;
  });

  it('errors when the browser has no profile path', async () => {
    server = new MockBiDiServer();
    ctx = await makeContext(server);

    await expect(spacesTool.handler({ action: 'list' }, ctx)).rejects.toMatchObject({
      code: 'UNSUPPORTED',
    });
  });
});
