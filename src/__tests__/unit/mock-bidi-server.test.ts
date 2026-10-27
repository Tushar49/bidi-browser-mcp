import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { RawData } from 'ws';
import { MockBiDiServer } from '../mocks/bidi-server.js';

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: RawData): void => {
      cleanup();
      resolve(JSON.parse(data.toString()));
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      socket.off('message', onMessage);
      socket.off('error', onError);
    };
    socket.once('message', onMessage);
    socket.once('error', onError);
  });
}

describe('MockBiDiServer', () => {
  let server: MockBiDiServer | undefined;
  let socket: WebSocket | undefined;

  afterEach(async () => {
    socket?.close();
    socket = undefined;
    await server?.stop();
    server = undefined;
  });

  it('answers session.status and records the request', async () => {
    server = new MockBiDiServer();
    const url = await server.start();
    socket = await open(url);

    socket.send(JSON.stringify({ id: 1, method: 'session.status' }));
    await expect(nextMessage(socket)).resolves.toMatchObject({
      type: 'success',
      id: 1,
      result: { ready: true, message: '' },
    });
    expect(server.requests).toEqual([{ id: 1, method: 'session.status' }]);
  });

  it('answers session.new and browsingContext.getTree', async () => {
    server = new MockBiDiServer();
    const url = await server.start();
    socket = await open(url);

    socket.send(JSON.stringify({ id: 2, method: 'session.new', params: {} }));
    await expect(nextMessage(socket)).resolves.toMatchObject({
      type: 'success',
      id: 2,
      result: { sessionId: 'mock-session-1' },
    });

    socket.send(JSON.stringify({ id: 3, method: 'browsingContext.getTree', params: {} }));
    await expect(nextMessage(socket)).resolves.toMatchObject({
      type: 'success',
      id: 3,
      result: { contexts: [{ context: 'mock-context' }] },
    });
  });

  it('returns a BiDi error for unknown methods', async () => {
    server = new MockBiDiServer();
    const url = await server.start();
    socket = await open(url);

    socket.send(JSON.stringify({ id: 4, method: 'nope.command' }));
    await expect(nextMessage(socket)).resolves.toMatchObject({
      type: 'error',
      id: 4,
      error: 'unknown command',
    });
  });

  it('delivers events to connected clients', async () => {
    server = new MockBiDiServer();
    const url = await server.start();
    socket = await open(url);

    const message = nextMessage(socket);
    server.sendEvent('log.entryAdded', { level: 'info', text: 'hello' });
    await expect(message).resolves.toMatchObject({
      type: 'event',
      method: 'log.entryAdded',
      params: { level: 'info', text: 'hello' },
    });
  });

  it('stops cleanly and rejects a second start', async () => {
    server = new MockBiDiServer();
    const url = await server.start();
    expect(url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/session$/);
    await expect(server.start()).rejects.toThrow('already started');
    await server.stop();
    server = undefined;
  });
});
