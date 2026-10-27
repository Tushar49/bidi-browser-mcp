import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BiDiClient } from '../../connection/bidi-client.js';
import { nodeSupportsMapper } from '../../connection/chromium-mapper.js';
import type { BiDiSocket } from '../../connection/chromium-mapper.js';

/**
 * Stand-in for the mapper facade: same shape the Chromium path returns,
 * without needing a browser. Verifies BiDiClient's custom-opener wiring.
 */
class FakeFacadeSocket extends EventEmitter implements BiDiSocket {
  readonly CLOSED = 3;
  readyState = 0;
  readonly sent: string[] = [];

  /** Emit 'open' asynchronously, like the real facade. */
  scheduleOpen(): void {
    setTimeout(() => {
      if (this.readyState === 0) {
        this.readyState = 1;
        this.emit('open');
      }
    }, 0);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.terminate();
  }

  terminate(): void {
    if (this.readyState === this.CLOSED) {
      return;
    }
    this.readyState = this.CLOSED;
    queueMicrotask(() => this.emit('close', 1000, Buffer.alloc(0)));
  }

  reply(message: unknown): void {
    this.emit('message', JSON.stringify(message));
  }
}

describe('BiDiClient custom socket opener (Chromium mapper path)', () => {
  let client: BiDiClient | undefined;

  afterEach(async () => {
    await client?.close().catch(() => {});
    client = undefined;
  });

  it('connects through a non-WebSocket facade and round-trips a command', async () => {
    const socket = new FakeFacadeSocket();
    client = new BiDiClient({
      url: 'chromium-mapper://test',
      timeoutMs: 2_000,
      openSocket: async () => {
        socket.scheduleOpen();
        return socket;
      },
    });

    await client.connect();
    expect(client.state).toBe('connected');

    const pending = client.request('session.status', {});
    await vi.waitFor(() => {
      expect(socket.sent).toHaveLength(1);
    });
    expect(JSON.parse(socket.sent[0] ?? '{}')).toMatchObject({
      method: 'session.status',
    });

    socket.reply({ type: 'success', id: 1, result: { ready: true } });
    await expect(pending).resolves.toEqual({ ready: true });

    await client.close();
    expect(socket.readyState).toBe(socket.CLOSED);
    expect(client.state).toBe('disconnected');
  });

  it('surfaces a facade open failure as CONNECTION_FAILED', async () => {
    client = new BiDiClient({
      url: 'chromium-mapper://test',
      timeoutMs: 2_000,
      openSocket: async () => {
        throw new Error('CDP refused the connection');
      },
    });

    await expect(client.connect()).rejects.toMatchObject({
      code: 'CONNECTION_FAILED',
      message: 'CDP refused the connection',
    });
    expect(client.state).toBe('disconnected');
  });

  it('ignores a late open after the attempt timed out', async () => {
    const socket = new FakeFacadeSocket();
    client = new BiDiClient({
      url: 'chromium-mapper://test',
      timeoutMs: 40,
      openSocket: async () => socket,
    });

    await expect(client.connect()).rejects.toMatchObject({
      code: 'CONNECTION_FAILED',
    });
    expect(client.state).toBe('disconnected');

    // The facade opens after we gave up: state must not flip to connected.
    socket.readyState = 1;
    socket.emit('open');
    expect(client.state).toBe('disconnected');
  });

  it('closes the facade when the socket drops', async () => {
    const socket = new FakeFacadeSocket();
    client = new BiDiClient({
      url: 'chromium-mapper://test',
      timeoutMs: 2_000,
      openSocket: async () => {
        socket.scheduleOpen();
        return socket;
      },
    });
    await client.connect();

    const onClose = vi.fn();
    client.onClose(onClose);
    socket.terminate();
    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(client.state).toBe('disconnected');
  });
});

describe('nodeSupportsMapper', () => {
  it('accepts the ranges chromium-bidi declares', () => {
    expect(nodeSupportsMapper('20.19.0')).toBe(true);
    expect(nodeSupportsMapper('20.18.9')).toBe(false);
    expect(nodeSupportsMapper('21.7.3')).toBe(true);
    expect(nodeSupportsMapper('22.5.0')).toBe(false);
    expect(nodeSupportsMapper('22.12.0')).toBe(true);
    expect(nodeSupportsMapper('24.1.0')).toBe(true);
  });
});
