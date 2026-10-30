import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../config.js';
import { SessionManager } from '../../session/session-manager.js';
import { interactTool } from '../../tools/interact.js';
import type { ElementInfo, PageSnapshot, ServerContext } from '../../types.js';
import { MockBiDiServer } from '../mocks/bidi-server.js';

const ELEMENT: ElementInfo = {
  uid: 'e1',
  role: 'button',
  name: 'Go',
  tag: 'button',
  bounds: [10, 20, 100, 40],
  selector: '#go',
};

const SNAPSHOT: PageSnapshot = {
  context: 'mock-context',
  url: 'https://example.test/',
  title: 'Example',
  text: 'Go',
  elements: [ELEMENT],
  builtAt: 0,
};

/** Serialize a plain value the way a BiDi peer would. */
function serialized(value: unknown): Record<string, unknown> {
  const wrap = (item: unknown): unknown => {
    if (item === null) return { type: 'null' };
    if (typeof item === 'boolean') return { type: 'boolean', value: item };
    if (typeof item === 'number') return { type: 'number', value: item };
    if (typeof item === 'string') return { type: 'string', value: item };
    if (Array.isArray(item)) return { type: 'array', value: item.map(wrap) };
    const record = item as Record<string, unknown>;
    return { type: 'object', value: Object.entries(record).map(([key, item2]) => [key, wrap(item2)]) };
  };
  return wrap(value) as Record<string, unknown>;
}

const VERIFY_OK = {
  type: 'success',
  result: serialized({ found: true, tag: 'button', rect: [10, 20, 100, 40], matches: 1, reason: null }),
};

interface ProbeConfig {
  /** CLICK_PROBE result (bodies containing elementFromPoint). */
  clickProbe?: Record<string, unknown>;
  /** READ_VALUE result (bodies containing textContent). */
  readValue?: unknown;
  /** READ_CHECKED result (bodies containing checked). */
  checked?: unknown;
  /** SELECT_BODY result (bodies containing options). */
  select?: unknown;
  /** Generic bodies (focus, select-all, return-element). */
  value?: unknown;
  /** Serialized replacement for the element reference (upload). */
  element?: Record<string, unknown>;
  /** Wrapper-level resolution error. */
  error?: string;
}

async function makeContext(server: MockBiDiServer, config: Record<string, string> = {}) {
  const url = await server.start();
  const loaded = loadConfig({ BIDI_WS_URL: url, ...config });
  const session = new SessionManager({ config: loaded, serverVersion: '0.1.6' });
  await session.connect();
  const ctx: ServerContext = { version: '0.1.6', config: loaded, startedAt: Date.now(), session };
  session.runtime?.snapshots.set(SNAPSHOT);
  return ctx;
}

/** Route mock callFunction: uid verification passes; bodies return by shape. */
function routeCallFunction(server: MockBiDiServer, probe: ProbeConfig = {}): void {
  server.on('script.callFunction', (params) => {
    const source = String(params.functionDeclaration ?? '');
    if (source.includes('verifyUid')) {
      return VERIFY_OK;
    }
    let value: unknown;
    if (source.includes('elementFromPoint')) {
      value = probe.clickProbe ?? null;
    } else if (source.includes('textContent')) {
      value = probe.readValue ?? null;
    } else if (source.includes('checked')) {
      value = probe.checked ?? null;
    } else if (source.includes('options')) {
      value = probe.select ?? null;
    } else {
      value = probe.value ?? null;
    }
    return {
      type: 'success',
      result: serialized({
        value,
        rect: [10, 20, 100, 40],
        element: probe.element ?? null,
        error: probe.error ?? null,
      }),
    };
  });
  server.on('input.performActions', () => ({}));
  server.on('input.releaseActions', () => ({}));
}

describe('interact tool (live session via mock)', () => {
  let server: MockBiDiServer | undefined;
  let ctx: ServerContext | undefined;

  afterEach(async () => {
    await ctx?.session?.disconnect();
    await server?.stop();
    server = undefined;
    ctx = undefined;
  });

  it('clicks the element center after verification and drops the cache', async () => {
    server = new MockBiDiServer();
    routeCallFunction(server, {
      clickProbe: { rect: [10, 20, 100, 40], coverer: null, crossing: null, hasHit: true },
    });
    ctx = await makeContext(server);

    const result = await interactTool.handler({ action: 'click', uid: 'e1' }, ctx);
    expect(result.ok).toBe(true);

    const perform = server.requests.find((r) => r.method === 'input.performActions');
    expect(perform).toBeDefined();
    const pointer = (perform?.params?.actions as { type: string; actions: { type: string; x?: number; y?: number }[] }[])[0];
    expect(pointer.type).toBe('pointer');
    const move = pointer.actions.find((a) => a.type === 'pointerMove');
    expect(move).toMatchObject({ x: 60, y: 40 });
    // Verification ran before dispatch.
    const callIndex = server.requests.findIndex((r) => r.method === 'script.callFunction');
    const performIndex = server.requests.findIndex((r) => r.method === 'input.performActions');
    expect(callIndex).toBeLessThan(performIndex);

    // Any dispatched action invalidates the snapshot cache (§5).
    expect(ctx.session?.runtime?.snapshots.get('mock-context')).toBeUndefined();

    // Input state is released after dispatch (§5).
    expect(server.requests.some((r) => r.method === 'input.releaseActions')).toBe(true);
  });

  it('refuses a covered click with NOT_INTERACTABLE naming the coverer', async () => {
    server = new MockBiDiServer();
    routeCallFunction(server, {
      clickProbe: { rect: [0, 0, 100, 40], coverer: 'div.overlay', crossing: null, hasHit: true },
    });
    ctx = await makeContext(server);

    await expect(interactTool.handler({ action: 'click', uid: 'e1' }, ctx)).rejects.toMatchObject({
      code: 'NOT_INTERACTABLE',
      message: expect.stringContaining('div.overlay'),
    });
    expect(server.requests.some((r) => r.method === 'input.performActions')).toBe(false);
  });

  it('maps a zero-size target to NOT_INTERACTABLE', async () => {
    server = new MockBiDiServer();
    routeCallFunction(server, {
      clickProbe: { rect: [10, 20, 0, 0], coverer: null, crossing: null, hasHit: false },
    });
    ctx = await makeContext(server);

    await expect(interactTool.handler({ action: 'click', uid: 'e1' }, ctx)).rejects.toMatchObject({
      code: 'NOT_INTERACTABLE',
    });
  });

  it('propagates verification failures as STALE_UID before dispatch', async () => {
    server = new MockBiDiServer();
    server.on('script.callFunction', () => ({
      type: 'success',
      result: serialized({ found: true, tag: 'div', rect: [1, 2, 3, 4], matches: 1, reason: null }),
    }));
    ctx = await makeContext(server);

    await expect(interactTool.handler({ action: 'click', uid: 'e1' }, ctx)).rejects.toMatchObject({
      code: 'STALE_UID',
    });
    expect(server.requests.some((r) => r.method === 'input.performActions')).toBe(false);
  });

  it('rejects an unknown uid before any browser traffic', async () => {
    server = new MockBiDiServer();
    routeCallFunction(server);
    ctx = await makeContext(server);

    await expect(interactTool.handler({ action: 'click', uid: 'nope' }, ctx)).rejects.toMatchObject({
      code: 'UID_NOT_FOUND',
    });
    expect(server.requests.filter((r) => r.method === 'script.callFunction')).toHaveLength(0);
  });

  it('types per character and echoes the value read back from the element', async () => {
    server = new MockBiDiServer();
    routeCallFunction(server, { readValue: { value: 'typed!' } });
    ctx = await makeContext(server);

    const result = await interactTool.handler({ action: 'type', uid: 'e1', value: 'hi' }, ctx);
    expect(result.data).toMatchObject({ uid: 'e1', value: 'typed!' });

    const perform = server.requests.find((r) => r.method === 'input.performActions');
    const keyActions = (perform?.params?.actions as { type: string; actions: { type: string; value: string }[] }[])[0];
    expect(keyActions.actions.map((a) => `${a.type}:${a.value}`)).toEqual([
      'keyDown:h', 'keyUp:h', 'keyDown:i', 'keyUp:i',
    ]);
  });

  it('clears via click + select-all + one Backspace', async () => {
    server = new MockBiDiServer();
    routeCallFunction(server, {
      clickProbe: { rect: [10, 20, 100, 40], coverer: null, crossing: null, hasHit: true },
      readValue: { value: '' },
    });
    ctx = await makeContext(server);

    const result = await interactTool.handler({ action: 'clear', uid: 'e1' }, ctx);
    expect(result.data).toMatchObject({ uid: 'e1', value: '', cleared: true });

    const performs = server.requests.filter((r) => r.method === 'input.performActions');
    // One pointer click + one Backspace key dispatch.
    expect(performs).toHaveLength(2);
    const keys = (performs[1]?.params?.actions as { actions: { type: string; value: string }[] }[])[0];
    expect(keys.actions).toEqual([
      { type: 'keyDown', value: '\uE003' },
      { type: 'keyUp', value: '\uE003' },
    ]);
  });

  it('presses a named key and refuses unknown key names with the valid set', async () => {
    server = new MockBiDiServer();
    routeCallFunction(server);
    ctx = await makeContext(server);

    const result = await interactTool.handler({ action: 'press', value: 'Enter' }, ctx);
    expect(result.data).toMatchObject({ key: 'Enter' });
    const perform = server.requests.find((r) => r.method === 'input.performActions');
    const keys = (perform?.params?.actions as { actions: { type: string; value: string }[] }[])[0];
    expect(keys.actions).toEqual([
      { type: 'keyDown', value: '\uE007' },
      { type: 'keyUp', value: '\uE007' },
    ]);

    await expect(
      interactTool.handler({ action: 'press', value: 'Ctrl+Alt+Del' }, ctx)
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', fix: expect.stringContaining('ArrowDown') });
  });

  it('checks through a real click and reads the state fresh', async () => {
    server = new MockBiDiServer();
    let checked = true;
    server.on('script.callFunction', (params) => {
      const source = String(params.functionDeclaration ?? '');
      const wrapper = (value: unknown): { type: string; result: Record<string, unknown> } => ({
        type: 'success',
        result: serialized({ value, rect: [0, 0, 10, 10], element: null, error: null }),
      });
      if (source.includes('verifyUid')) return VERIFY_OK;
      if (source.includes('checked')) {
        // Read fresh each time; the click flips it between reads.
        return wrapper({ checked: (checked = !checked) });
      }
      return wrapper({ rect: [0, 0, 10, 10], coverer: null, crossing: null, hasHit: true });
    });
    server.on('input.performActions', () => ({}));
    server.on('input.releaseActions', () => ({}));
    ctx = await makeContext(server);

    const result = await interactTool.handler({ action: 'check', uid: 'e1' }, ctx);
    expect(result.data).toMatchObject({ uid: 'e1', checked: true });
    expect(server.requests.some((r) => r.method === 'input.performActions')).toBe(true);
  });

  it('refuses check on non-checkbox elements with UNSUPPORTED', async () => {
    server = new MockBiDiServer();
    routeCallFunction(server, { checked: { checked: null } });
    ctx = await makeContext(server);

    await expect(interactTool.handler({ action: 'check', uid: 'e1' }, ctx)).rejects.toMatchObject({
      code: 'UNSUPPORTED',
    });
  });

  it('resolves select by value then label then index and echoes the pick', async () => {
    server = new MockBiDiServer();
    routeCallFunction(server, { select: { selected: 'opt-2', label: 'Second' } });
    ctx = await makeContext(server);

    const result = await interactTool.handler({ action: 'select', uid: 'e1', option: 'Second' }, ctx);
    expect(result.data).toMatchObject({ uid: 'e1', option: 'opt-2', label: 'Second' });
  });

  it('reports a missing option as INVALID_ARGUMENT with the option count', async () => {
    server = new MockBiDiServer();
    routeCallFunction(server, { select: { missing: 3 } });
    ctx = await makeContext(server);

    await expect(
      interactTool.handler({ action: 'select', uid: 'e1', option: 'nope' }, ctx)
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: expect.stringContaining('3 options'),
    });
  });

  it('selects nothing on a non-select element with UNSUPPORTED', async () => {
    server = new MockBiDiServer();
    routeCallFunction(server, { value: null });
    ctx = await makeContext(server);

    await expect(
      interactTool.handler({ action: 'select', uid: 'e1', option: 'x' }, ctx)
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });

  it('scrolls the page on a wheel source and reports the new position', async () => {
    server = new MockBiDiServer();
    routeCallFunction(server);
    server.on('script.evaluate', () => ({
      type: 'success',
      result: serialized({ x: 0, y: 600 }),
    }));
    ctx = await makeContext(server);

    const result = await interactTool.handler({ action: 'scroll', direction: 'down' }, ctx);
    expect(result.data).toMatchObject({ direction: 'down', x: 0, y: 600 });

    const perform = server.requests.find((r) => r.method === 'input.performActions');
    const wheel = (perform?.params?.actions as { type: string; actions: { type: string; deltaY?: number }[] }[])[0];
    expect(wheel.type).toBe('wheel');
    expect(wheel.actions[0]).toMatchObject({ type: 'scroll', deltaY: 600 });

    // Scrolling keeps document-space bounds valid: the cache survives (§3).
    expect(ctx.session?.runtime?.snapshots.get('mock-context')).toBeDefined();
  });

  it('uploads through input.setFiles and reports the file count', async () => {
    server = new MockBiDiServer();
    routeCallFunction(server, { element: { sharedId: 'shared-1', handle: 'h-1' } });
    server.on('input.setFiles', () => ({}));
    ctx = await makeContext(server);

    const result = await interactTool.handler(
      { action: 'upload', uid: 'e1', value: 'C:/pics/a.png, C:/pics/b.png' },
      ctx
    );
    expect(result.data).toMatchObject({ uid: 'e1', files: 2 });

    const setFiles = server.requests.find((r) => r.method === 'input.setFiles');
    expect(setFiles?.params).toMatchObject({
      element: { sharedId: 'shared-1' },
      files: ['C:/pics/a.png', 'C:/pics/b.png'],
    });
  });
});
