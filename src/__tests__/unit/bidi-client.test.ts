import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BiDiClient,
  translateBiDiError,
} from '../../connection/bidi-client.js';
import { MockBiDiServer } from '../mocks/bidi-server.js';

describe('BiDiClient malformed-frame handling', () => {
  let server: MockBiDiServer | undefined;

  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  it('rejects cleanly when an error frame lacks its error payload', async () => {
    server = new MockBiDiServer();
    const url = await server.start();

    // Gate the success response so the pending request is still open when the
    // malformed frame arrives.
    let release: (() => void) | undefined;
    server.on('session.status', () => {
      return new Promise<Record<string, unknown>>((resolve) => {
        release = () => resolve({ ready: true, message: '' });
      });
    });

    const client = new BiDiClient({ url, timeoutMs: 5_000 });
    await client.connect();
    const mock = server;
    try {
      const pending = client.request('session.status', {});

      // Only inject once the mock has actually seen the command.
      await vi.waitFor(() => {
        expect(mock?.requests.length ?? 0).toBeGreaterThanOrEqual(1);
      });

      // Regression: {"type":"error","id":1} with no error object must not
      // throw a TypeError inside the message listener.
      server.sendRawFrame(JSON.stringify({ type: 'error', id: 1 }));

      await expect(pending).rejects.toMatchObject({
        code: 'SESSION_FAILED',
      });
    } finally {
      release?.();
      await client.close();
    }
  });

  it('maps a real error payload to the documented code', async () => {
    server = new MockBiDiServer();
    const url = await server.start();

    let release: (() => void) | undefined;
    server.on('session.status', () => {
      return new Promise<Record<string, unknown>>((resolve) => {
        release = () => resolve({ ready: true, message: '' });
      });
    });

    const client = new BiDiClient({ url, timeoutMs: 5_000 });
    await client.connect();
    const mock = server;
    try {
      const pending = client.request('session.status', {});
      await vi.waitFor(() => {
        expect(mock?.requests.length ?? 0).toBeGreaterThanOrEqual(1);
      });

      server.sendRawFrame(
        JSON.stringify({
          type: 'error',
          id: 1,
          // Exact frame shape observed from real Zen (Firefox 158).
          error: 'session not created',
          message: 'Maximum number of active sessions',
        })
      );

      await expect(pending).rejects.toMatchObject({ code: 'SESSION_BUSY' });
    } finally {
      release?.();
      await client.close();
    }
  });
});

describe('translateBiDiError (plan decisions §1)', () => {
  it('maps only the unambiguous flat codes', () => {
    expect(translateBiDiError('no such frame', undefined)).toBe('FRAME_NOT_FOUND');
    // Firefox reports an unknown browsing context as `no such frame`; the
    // method decides the taxonomy (decisions §1, verified live).
    expect(translateBiDiError('no such frame', undefined, 'browsingContext.close')).toBe(
      'CONTEXT_NOT_FOUND'
    );
    expect(translateBiDiError('no such frame', undefined, 'script.callFunction')).toBe(
      'FRAME_NOT_FOUND'
    );
    expect(translateBiDiError('no such element', undefined)).toBe('STALE_UID');
    expect(translateBiDiError('no such node', undefined)).toBe('STALE_UID');
    expect(translateBiDiError('detached shadow root', undefined)).toBe('STALE_UID');
    expect(translateBiDiError('unknown command', undefined)).toBe('UNSUPPORTED');
    expect(translateBiDiError('unsupported operation', undefined)).toBe('UNSUPPORTED');
    expect(translateBiDiError('no such request', undefined)).toBe('NETWORK_ERROR');
    expect(translateBiDiError('move target out of bounds', undefined)).toBe('NOT_INTERACTABLE');
    expect(translateBiDiError('element not interactable', undefined)).toBe('NOT_INTERACTABLE');
    expect(translateBiDiError('invalid argument', undefined)).toBe('INVALID_ARGUMENT');
    expect(translateBiDiError('invalid selector', undefined)).toBe('INVALID_ARGUMENT');
  });

  it('keeps unknown errors session-level and busy detection prose-aware', () => {
    expect(translateBiDiError('unknown error', undefined)).toBe('SESSION_FAILED');
    expect(translateBiDiError(undefined, 'no such frame happened')).toBe(
      'SESSION_FAILED'
    );
    expect(translateBiDiError('session not created', undefined)).toBe('SESSION_BUSY');
    expect(translateBiDiError(undefined, 'Maximum number of active sessions')).toBe(
      'SESSION_BUSY'
    );
  });
});

describe('BiDiClient failure details (plan decisions §1)', () => {
  let server: MockBiDiServer | undefined;

  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  it('stamps details.method and biDiCode on mapped error frames', async () => {
    server = new MockBiDiServer();
    const url = await server.start();

    let release: (() => void) | undefined;
    server.on('script.callFunction', () => {
      return new Promise<Record<string, unknown>>((resolve) => {
        release = () => resolve({});
      });
    });

    const client = new BiDiClient({ url, timeoutMs: 5_000 });
    await client.connect();
    const mock = server;
    try {
      const pending = client.request('script.callFunction', {});
      await vi.waitFor(() => {
        expect(mock?.requests.length ?? 0).toBeGreaterThanOrEqual(1);
      });

      server.sendRawFrame(
        JSON.stringify({ type: 'error', id: 1, error: 'no such frame', message: 'No such frame' })
      );

      await expect(pending).rejects.toMatchObject({
        // Not a browsingContext.* method, so the frame code stays.
        code: 'FRAME_NOT_FOUND',
        details: {
          method: 'script.callFunction',
          biDiCode: 'no such frame',
        },
      });
    } finally {
      release?.();
      await client.close();
    }
  });

  it('maps no such frame from browsingContext methods to CONTEXT_NOT_FOUND', async () => {
    server = new MockBiDiServer();
    const url = await server.start();

    let release: (() => void) | undefined;
    server.on('browsingContext.getTree', () => {
      return new Promise<Record<string, unknown>>((resolve) => {
        release = () => resolve({ contexts: [] });
      });
    });

    const client = new BiDiClient({ url, timeoutMs: 5_000 });
    await client.connect();
    const mock = server;
    try {
      const pending = client.request('browsingContext.getTree', {});
      await vi.waitFor(() => {
        expect(mock?.requests.length ?? 0).toBeGreaterThanOrEqual(1);
      });

      server.sendRawFrame(
        JSON.stringify({ type: 'error', id: 1, error: 'no such frame', message: 'Browsing Context with id deadbeef not found' })
      );

      await expect(pending).rejects.toMatchObject({
        code: 'CONTEXT_NOT_FOUND',
        details: {
          method: 'browsingContext.getTree',
          biDiCode: 'no such frame',
        },
      });
    } finally {
      release?.();
      await client.close();
    }
  });

  it('stamps details.method on timeouts', async () => {
    server = new MockBiDiServer();
    const url = await server.start();

    let release: (() => void) | undefined;
    server.on('session.status', () => {
      return new Promise<Record<string, unknown>>((resolve) => {
        release = () => resolve({ ready: true, message: '' });
      });
    });

    const client = new BiDiClient({ url, timeoutMs: 40 });
    await client.connect();
    try {
      await expect(client.request('session.status', {})).rejects.toMatchObject({
        code: 'TIMEOUT',
        details: { method: 'session.status' },
      });
    } finally {
      release?.();
      await client.close();
    }
  });

  it('stamps details.method when the socket closes under pending requests', async () => {
    server = new MockBiDiServer();
    const url = await server.start();

    let release: (() => void) | undefined;
    server.on('session.status', () => {
      return new Promise<Record<string, unknown>>((resolve) => {
        release = () => resolve({ ready: true, message: '' });
      });
    });

    const client = new BiDiClient({ url, timeoutMs: 5_000 });
    await client.connect();
    try {
      const pending = client.request('session.status', {});
      // Attach the expectation before closing: #failPending rejects while
      // close() is still awaiting the socket event, and an unobserved
      // rejection would surface as an unhandled error.
      const assertion = expect(pending).rejects.toMatchObject({
        code: 'CONNECTION_CLOSED',
        details: { method: 'session.status' },
      });
      await client.close();
      await assertion;
    } finally {
      release?.();
      await client.close();
    }
  });
});
