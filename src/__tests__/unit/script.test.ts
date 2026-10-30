import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../config.js';
import { SessionManager } from '../../session/session-manager.js';
import { scriptTool } from '../../tools/script.js';
import type { ServerContext } from '../../types.js';
import { MockBiDiServer } from '../mocks/bidi-server.js';

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

async function makeContext(server: MockBiDiServer, config: Record<string, string> = {}) {
  const url = await server.start();
  const loaded = loadConfig({ BIDI_WS_URL: url, ...config });
  const session = new SessionManager({ config: loaded, serverVersion: '0.1.6' });
  await session.connect();
  const ctx: ServerContext = { version: '0.1.6', config: loaded, startedAt: Date.now(), session };
  return ctx;
}

describe('script tool (live session via mock)', () => {
  let server: MockBiDiServer | undefined;
  let ctx: ServerContext | undefined;

  afterEach(async () => {
    await ctx?.session?.disconnect();
    await server?.stop();
    server = undefined;
    ctx = undefined;
  });

  it('evaluate is gated and the error names the flag (decisions §2)', async () => {
    server = new MockBiDiServer();
    ctx = await makeContext(server);

    await expect(
      scriptTool.handler({ action: 'evaluate', expression: '1 + 1' }, ctx)
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED',
      message: expect.stringContaining('BIDI_ALLOW_SCRIPT_EVAL'),
      fix: expect.stringContaining('BIDI_ALLOW_SCRIPT_EVAL'),
    });
    expect(server.requests.filter((r) => r.method === 'script.evaluate')).toHaveLength(0);
  });

  it('evaluate runs when BIDI_ALLOW_SCRIPT_EVAL is set', async () => {
    server = new MockBiDiServer();
    server.on('script.evaluate', () => ({
      type: 'success',
      result: serialized(42),
    }));
    ctx = await makeContext(server, { BIDI_ALLOW_SCRIPT_EVAL: '1' });

    const result = await scriptTool.handler({ action: 'evaluate', expression: '6 * 7' }, ctx);
    expect(result.data).toMatchObject({ value: 42, context: 'mock-context' });
    const call = server.requests.find((r) => r.method === 'script.evaluate');
    expect(call?.params).toMatchObject({ expression: '6 * 7', awaitPromise: true });
  });

  it('waitFor needs no gate and polls until the condition is truthy', async () => {
    server = new MockBiDiServer();
    let calls = 0;
    server.on('script.callFunction', () => {
      calls += 1;
      return { type: 'success', result: serialized(calls >= 3) };
    });
    ctx = await makeContext(server);

    const result = await scriptTool.handler(
      { action: 'waitFor', expression: 'window.ready', timeout: 5000 },
      ctx
    );
    expect(result.data).toMatchObject({ value: true, context: 'mock-context' });
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('waitFor surfaces a throwing condition as SCRIPT_ERROR', async () => {
    server = new MockBiDiServer();
    server.on('script.callFunction', () => ({
      type: 'success',
      result: serialized({ __error: 'boom' }),
    }));
    ctx = await makeContext(server);

    await expect(
      scriptTool.handler({ action: 'waitFor', expression: 'oops(' }, ctx)
    ).rejects.toMatchObject({ code: 'SCRIPT_ERROR', message: expect.stringContaining('boom') });
  });

  it('waitFor times out with TIMEOUT and reports the last value', async () => {
    server = new MockBiDiServer();
    server.on('script.callFunction', () => ({ type: 'success', result: serialized(false) }));
    ctx = await makeContext(server);

    await expect(
      scriptTool.handler({ action: 'waitFor', expression: 'false', timeout: 400 }, ctx)
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('rejects an empty expression', async () => {
    server = new MockBiDiServer();
    ctx = await makeContext(server);

    await expect(
      scriptTool.handler({ action: 'evaluate', expression: '   ' }, ctx)
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
