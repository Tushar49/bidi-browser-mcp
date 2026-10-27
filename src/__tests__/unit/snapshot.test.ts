import { describe, expect, it } from 'vitest';
import { resolveElement, resolvePlan } from '../../snapshot/element-resolver.js';
import { SnapshotCache } from '../../snapshot/cache.js';
import type { PageSnapshot } from '../../types.js';

const SNAPSHOT: PageSnapshot = {
  context: 'ctx',
  url: 'https://example.test/',
  title: 'Example',
  text: 'text',
  builtAt: 1,
  elements: [
    {
      uid: 'e1',
      role: 'button',
      name: 'Ok',
      tag: 'button',
      bounds: [0, 0, 1, 1],
      selector: '#ok',
    },
    {
      uid: 'e2',
      role: 'textbox',
      name: 'Search',
      tag: 'input',
      bounds: [0, 0, 1, 1],
      selector: 'input[type=search]',
      frame: ['body > iframe:nth-of-type(1)'],
      shadowHost: 'app-bar',
    },
  ],
};

describe('resolveElement', () => {
  it('finds elements by uid', () => {
    expect(resolveElement(SNAPSHOT, 'e1').selector).toBe('#ok');
  });

  it('fails with UID_NOT_FOUND for unknown uids', () => {
    expect(() => resolveElement(SNAPSHOT, 'e99')).toThrowError(/Unknown element uid/);
  });
});

describe('resolvePlan', () => {
  it('describes frame/shadow traversal for nested elements', () => {
    const plan = resolvePlan(resolveElement(SNAPSHOT, 'e2'));
    expect(plan).toEqual({
      frame: ['body > iframe:nth-of-type(1)'],
      shadowHost: 'app-bar',
      selector: 'input[type=search]',
    });

    const simple = resolvePlan(resolveElement(SNAPSHOT, 'e1'));
    expect(simple).toEqual({ selector: '#ok' });
  });
});

describe('SnapshotCache', () => {
  it('stores, reads, and invalidates per context', () => {
    const cache = new SnapshotCache();
    cache.set(SNAPSHOT);
    expect(cache.get('ctx')).toBe(SNAPSHOT);
    expect(cache.size).toBe(1);

    cache.invalidate('ctx');
    expect(cache.get('ctx')).toBeUndefined();
  });

  it('invalidates on navigation and close events, ignores others', () => {
    const cache = new SnapshotCache();
    cache.set(SNAPSHOT);

    cache.handleEvent({ type: 'event', method: 'browsingContext.domContentLoaded', params: { context: 'ctx' } });
    expect(cache.get('ctx')).toBeUndefined();

    cache.set(SNAPSHOT);
    cache.handleEvent({ type: 'event', method: 'log.entryAdded', params: { context: 'ctx' } });
    expect(cache.get('ctx')).toBe(SNAPSHOT);

    cache.handleEvent({ type: 'event', method: 'browsingContext.contextDestroyed', params: { context: 'ctx' } });
    expect(cache.get('ctx')).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});
