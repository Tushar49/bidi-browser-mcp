import { afterEach, describe, expect, it, vi } from 'vitest';
import { BiDiClient } from '../../connection/bidi-client.js';
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
