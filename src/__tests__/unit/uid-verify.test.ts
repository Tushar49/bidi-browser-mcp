import { afterEach, describe, expect, it } from 'vitest';
import { BiDiClient } from '../../connection/bidi-client.js';
import { MockBiDiServer } from '../mocks/bidi-server.js';
import type { PageSnapshot } from '../../types.js';
import {
  compareElement,
  parseVerifyProbe,
  verifyFunctionSource,
  verifySnapshotElement,
} from '../../snapshot/uid-verify.js';

const ELEMENT = {
  uid: 'e1',
  role: 'button' as const,
  name: 'Go',
  tag: 'button',
  bounds: [0, 0, 10, 10] as const,
  selector: '#go',
};

const SNAPSHOT: PageSnapshot = {
  context: 'c1',
  url: 'https://example.test/',
  title: 'Example',
  text: 'Go',
  builtAt: 0,
  elements: [ELEMENT],
};

function serializedObject(fields: Record<string, unknown>): Record<string, unknown> {
  const wrap = (value: unknown): unknown => {
    if (value === null) return { type: 'null' };
    if (typeof value === 'boolean') return { type: 'boolean', value };
    if (typeof value === 'number') return { type: 'number', value };
    if (typeof value === 'string') return { type: 'string', value };
    if (Array.isArray(value)) {
      return { type: 'array', value: value.map((item) => wrap(item)) };
    }
    const record = value as Record<string, unknown>;
    return {
      type: 'object',
      value: Object.entries(record).map(([key, item]) => [key, wrap(item)]),
    };
  };
  return wrap(fields) as Record<string, unknown>;
}

const probeShape = (overrides: Record<string, unknown> = {}) =>
  serializedObject({
    found: true,
    tag: 'button',
    rect: [0, 0, 10, 10],
    matches: 1,
    reason: null,
    ...overrides,
  });

describe('compareElement', () => {
  it('resolves silently for the untouched element', () => {
    expect(
      compareElement(
        { found: true, tag: 'button', rect: [12, 340, 10, 10], matches: 1, reason: null },
        ELEMENT
      )
    ).toBe('ok');
  });

  it('classifies the failure modes with plan §3 precedence', () => {
    expect(
      compareElement({ found: false, tag: null, rect: null, matches: 0, reason: null }, ELEMENT)
    ).toBe('missing');
    expect(
      compareElement(
        { found: true, tag: 'button', rect: [0, 0, 10, 10], matches: 3, reason: null },
        ELEMENT
      )
    ).toBe('ambiguous');
    expect(
      compareElement({ found: true, tag: 'a', rect: [0, 0, 10, 10], matches: 1, reason: null }, ELEMENT)
    ).toBe('stale');
    expect(
      compareElement(
        { found: true, tag: 'button', rect: [0, 0, 40, 40], matches: 1, reason: null },
        ELEMENT
      )
    ).toBe('stale');
  });

  it('allows the ±4px tolerance on size but not beyond it', () => {
    expect(
      compareElement(
        { found: true, tag: 'button', rect: [0, 0, 14, 6], matches: 1, reason: null },
        ELEMENT
      )
    ).toBe('ok');
    expect(
      compareElement(
        { found: true, tag: 'button', rect: [0, 0, 15, 6], matches: 1, reason: null },
        ELEMENT
      )
    ).toBe('stale');
  });
});

describe('parseVerifyProbe', () => {
  it('unwraps BiDi serialization', () => {
    expect(parseVerifyProbe(probeShape())).toEqual({
      found: true,
      tag: 'button',
      rect: [0, 0, 10, 10],
      matches: 1,
      reason: null,
    });
  });

  it('tolerates plain payloads and reports unparsable ones', () => {
    expect(
      parseVerifyProbe({ found: true, tag: 'div', rect: [1, 2, 3, 4], matches: 1, reason: null })
    ).toEqual({ found: true, tag: 'div', rect: [1, 2, 3, 4], matches: 1, reason: null });
    expect(parseVerifyProbe('nonsense').found).toBe(false);
    expect(parseVerifyProbe({ rect: 'short' })).toMatchObject({ found: false, rect: null });
  });
});

describe('verifyFunctionSource', () => {
  it('embeds the plan and probes within the anchor scope', () => {
    const source = verifyFunctionSource({
      frame: ['iframe#a', 'iframe#b'],
      shadowHost: 'div#host',
      selector: 'button.go',
    });
    expect(source).toContain('button.go');
    expect(source).toContain('div#host');
    expect(source).toContain('querySelectorAll');
    // A selector with a quote cannot break the JSON-embedded source.
    const quoted = verifyFunctionSource({ selector: 'a[href="#quote"]' });
    expect(quoted).toContain('a[href=\\"#quote\\"]');
    expect(quoted).not.toContain('a[href=\\"#quote\\"]\';');
  });
});

describe('verifySnapshotElement', () => {
  let server: MockBiDiServer | undefined;

  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  const runVerify = async (
    handler: () => Record<string, unknown>,
    snapshot: PageSnapshot = SNAPSHOT,
    uid = 'e1'
  ): Promise<string> => {
    server = new MockBiDiServer();
    const url = await server.start();
    server.on('script.callFunction', handler);
    const client = new BiDiClient({ url, timeoutMs: 5_000 });
    await client.connect();
    const mock = server;
    try {
      await verifySnapshotElement(
        (method, params) => client.request(method, params),
        snapshot,
        uid
      );
      return 'resolved';
    } catch (error) {
      return JSON.stringify({
        code: (error as { code?: string }).code,
        message: (error as { message?: string }).message,
      });
    } finally {
      await client.close();
      void mock;
    }
  };

  it('sends the embedded plan in the element\'s own context', async () => {
    let seen: Record<string, unknown> = {};
    let params: Record<string, unknown> = {};
    let response: Record<string, unknown> = {};
    const outcome = await runVerify(() => {
      seen = (server?.requests.at(-1) ?? {}) as Record<string, unknown>;
      params = (seen.params ?? {}) as Record<string, unknown>;
      response = { result: probeShape() };
      return response;
    });
    expect(outcome).toBe('resolved');
    expect(seen.method).toBe('script.callFunction');
    expect(String(params.functionDeclaration)).toContain('#go');
    expect(params.target).toEqual({ context: 'c1' });
  });

  it('rejects unknown uids with UID_NOT_FOUND', async () => {
    const outcome = await runVerify(() => ({ result: probeShape() }), SNAPSHOT, 'nope');
    expect(outcome).toContain('UID_NOT_FOUND');
  });

  it('maps a vanished selector to ELEMENT_NOT_FOUND', async () => {
    const outcome = await runVerify(() => ({
      result: serializedObject({ found: false, tag: null, rect: null, matches: 0, reason: null }),
    }));
    expect(outcome).toContain('ELEMENT_NOT_FOUND');
  });

  it('maps an ambiguous selector to STALE_UID with the match count', async () => {
    const outcome = await runVerify(() => ({ result: probeShape({ matches: 3 }) }));
    expect(outcome).toContain('STALE_UID');
    expect(outcome).toContain('3 elements');
  });

  it('maps identity drift to STALE_UID', async () => {
    const outcome = await runVerify(() => ({ result: probeShape({ tag: 'a' }) }));
    expect(outcome).toContain('STALE_UID');
  });

  it('passes mapped command failures through untouched', async () => {
    // The mock answers a throwing handler with an `invalid argument` error
    // frame; the client maps it, and verification must not mask that code.
    const outcome = await runVerify(() => {
      throw new Error('command exploded');
    });
    expect(outcome).toContain('INVALID_ARGUMENT');
  });
});
