import { describe, expect, it } from 'vitest';
import { ContextManager } from '../../session/context-manager.js';
import type { BiDiClientLike, BiDiEvent } from '../../types.js';

function event(method: string, params: Record<string, unknown>): BiDiEvent {
  return { type: 'event', method, params };
}

function fakeClient(): BiDiClientLike & { tree: unknown[] } {
  const fake = {
    tree: [{ context: 'tab-1', url: 'https://a.test/', children: [] }] as unknown[],
    async request(method: string) {
      if (method === 'browsingContext.getTree') {
        return { contexts: fake.tree };
      }
      return {};
    },
    onEvent() {
      return () => {};
    },
  };
  return fake;
}

describe('ContextManager', () => {
  it('syncs and lists tabs from the tree', async () => {
    const client = fakeClient();
    const manager = new ContextManager(client);
    await manager.sync();

    const tabs = await manager.list();
    expect(tabs).toEqual([
      { context: 'tab-1', url: 'https://a.test/', selected: true },
    ]);
  });

  it('tracks created, destroyed, and navigation events', async () => {
    const client = fakeClient();
    const manager = new ContextManager(client);
    await manager.sync();

    client.tree.push({ context: 'tab-2', url: 'https://b.test/', children: [] });
    manager.handleEvent(event('browsingContext.contextCreated', { context: 'tab-2' }));
    manager.handleEvent(
      event('browsingContext.domContentLoaded', { context: 'tab-2', url: 'https://b.test/' })
    );
    let tabs = await manager.list();
    expect(tabs.map((tab) => tab.context)).toEqual(['tab-1', 'tab-2']);
    expect(tabs[1].url).toBe('https://b.test/');

    client.tree = client.tree.filter(
      (node) => (node as { context: string }).context !== 'tab-1'
    );
    manager.handleEvent(event('browsingContext.contextDestroyed', { context: 'tab-1' }));
    tabs = await manager.list();
    expect(tabs.map((tab) => tab.context)).toEqual(['tab-2']);
    expect(tabs[0].selected).toBe(true);
  });

  it('updates the tab URL on SPA navigation (urlChanged)', async () => {
    const client = fakeClient();
    const manager = new ContextManager(client);
    await manager.sync();

    manager.handleEvent(
      event('browsingContext.urlChanged', { context: 'tab-1', url: 'https://a.test/app/next' })
    );

    const tabs = await manager.list();
    expect(tabs[0].url).toBe('https://a.test/app/next');
  });

  it('keeps the event URL when the tree has not caught up yet', async () => {
    const client = fakeClient();
    client.tree = [];
    const manager = new ContextManager(client);
    await manager.sync();

    // A tab opened by the user: the tree may still report the previous URL
    // when the first read happens after the SPA navigation event.
    client.tree.push({ context: 'tab-9', url: 'https://old.test/', children: [] });
    manager.handleEvent(event('browsingContext.contextCreated', { context: 'tab-9' }));
    manager.handleEvent(
      event('browsingContext.urlChanged', { context: 'tab-9', url: 'https://new.test/' })
    );

    const tabs = await manager.list();
    expect(tabs[0].url).toBe('https://new.test/');
  });

  it('lets the tree win once it moves past the event URL', async () => {
    const client = fakeClient();
    client.tree = [];
    const manager = new ContextManager(client);
    await manager.sync();

    client.tree.push({ context: 'tab-9', url: 'https://old.test/', children: [] });
    manager.handleEvent(event('browsingContext.contextCreated', { context: 'tab-9' }));
    manager.handleEvent(
      event('browsingContext.urlChanged', { context: 'tab-9', url: 'https://new.test/' })
    );
    await manager.list();

    client.tree = [{ context: 'tab-9', url: 'https://newer.test/', children: [] }];
    const tabs = await manager.list();
    expect(tabs[0].url).toBe('https://newer.test/');
  });

  it('prunes tabs that vanished from the tree', async () => {
    const client = fakeClient();
    const manager = new ContextManager(client);
    await manager.sync();

    client.tree = [];
    const tabs = await manager.list();
    expect(tabs).toEqual([]);
  });

  it('select sets the default tab and rejects unknown contexts', async () => {
    const client = fakeClient();
    client.tree.push({ context: 'tab-2', url: 'https://b.test/', children: [] });
    const manager = new ContextManager(client);
    await manager.sync();

    const tab = await manager.select('tab-2');
    expect(tab).toMatchObject({ context: 'tab-2', selected: true });
    expect((await manager.list())[1].selected).toBe(true);
    expect(await manager.ensureContext()).toBe('tab-2');

    await expect(manager.select('nope')).rejects.toMatchObject({ code: 'TAB_NOT_FOUND' });
  });

  it('ensureContext errors when no tabs exist', async () => {
    const client = fakeClient();
    client.tree = [];
    const manager = new ContextManager(client);

    await expect(manager.ensureContext()).rejects.toMatchObject({ code: 'CONTEXT_NOT_FOUND' });
    await expect(manager.ensureContext('explicit')).resolves.toBe('explicit');
  });
});
