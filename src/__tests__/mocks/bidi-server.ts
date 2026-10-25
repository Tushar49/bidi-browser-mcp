import { WebSocketServer, WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import type { RawData } from 'ws';
import type { BiDiCommand, BiDiEvent } from '../../types.js';

type Handler = (params: Record<string, unknown>) => unknown | Promise<unknown>;

/**
 * Hermetic BiDi peer for unit tests. No Firefox, no driver, ephemeral port.
 * Defaults cover the commands the first waves need; add fixtures with on().
 */
export class MockBiDiServer {
  readonly requests: BiDiCommand[] = [];
  readonly #handlers = new Map<string, Handler>();
  readonly #sockets = new Set<WebSocket>();
  readonly #tabs: { context: string; url: string; userContext?: string }[] = [
    { context: 'mock-context', url: 'about:blank', userContext: 'default' },
  ];
  readonly #userContexts: string[] = ['default', 'aaaaaaaa-1111-4222-8333-444444444444'];
  #activeSession = false;
  #wss?: WebSocketServer;
  #sessionCounter = 0;
  #tabCounter = 0;
  #userContextCounter = 0;

  constructor() {
    this.on('session.status', () => ({ ready: true, message: '' }));
    this.on('session.new', () => {
      if (this.#activeSession) {
        throw new Error('Maximum number of active sessions');
      }
      this.#activeSession = true;
      this.#sessionCounter += 1;
      const sessionId = `mock-session-${this.#sessionCounter}`;
      return {
        sessionId,
        capabilities: {
          acceptInsecureCerts: false,
          browserName: 'firefox',
          browserVersion: '158.0',
          platformName: process.platform,
          setWindowRect: true,
          userAgent: 'mock-bidi',
          proxy: {},
        },
      };
    });
    this.on('browsingContext.getTree', () => ({
      contexts: this.#tabs.map((tab) => ({
        context: tab.context,
        url: tab.url,
        children: [],
        clientWindow: 'mock-window',
        ...(tab.userContext === undefined ? {} : { userContext: tab.userContext }),
      })),
    }));
    this.on('browsingContext.create', (params) => {
      this.#tabCounter += 1;
      const context = `mock-tab-${this.#tabCounter}`;
      const url = typeof params.url === 'string' ? params.url : 'about:blank';
      const userContext = typeof params.userContext === 'string' ? params.userContext : 'default';
      if (!this.#userContexts.includes(userContext)) {
        throw new Error(`User Context with id ${userContext} was not found`);
      }
      this.#tabs.push({ context, url, userContext });
      return { context, url, children: [], userContext };
    });
    this.on('browsingContext.close', (params) => {
      const index = this.#tabs.findIndex((tab) => tab.context === params.context);
      if (index >= 0) {
        this.#tabs.splice(index, 1);
      }
      return {};
    });
    this.on('browsingContext.activate', () => ({}));
    this.on('session.subscribe', () => ({}));
    this.on('browser.getUserContexts', () => ({
      userContexts: this.#userContexts.map((userContext) => ({ userContext })),
    }));
    this.on('browser.createUserContext', () => {
      this.#userContextCounter += 1;
      const userContext = `bbbbbbbb-5555-4666-8777-8${this.#userContextCounter.toString().padStart(15, '0')}`;
      this.#userContexts.push(userContext);
      return { userContext };
    });
    this.on('browser.removeUserContext', (params) => {
      const index = this.#userContexts.indexOf(String(params.userContext));
      if (index < 0) {
        throw new Error('No such user context');
      }
      if (this.#userContexts[index] === 'default') {
        throw new Error('Cannot remove the default user context');
      }
      this.#userContexts.splice(index, 1);
      return {};
    });
    this.on('session.end', () => {
      this.#activeSession = false;
      return {};
    });
    this.on('script.evaluate', () => ({
      type: 'success',
      result: { type: 'string', value: 'ok' },
      realm: 'mock-realm',
    }));
  }

  on(method: string, handler: Handler): this {
    this.#handlers.set(method, handler);
    return this;
  }

  async start(): Promise<string> {
    if (this.#wss !== undefined) {
      throw new Error('MockBiDiServer is already started.');
    }

    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    this.#wss = wss;

    await new Promise<void>((resolve, reject) => {
      wss.once('listening', resolve);
      wss.once('error', reject);
    });

    wss.on('connection', (socket) => {
      this.#sockets.add(socket);
      socket.on('message', (data) => {
        void this.#handleMessage(socket, data);
      });
      socket.on('close', () => {
        this.#sockets.delete(socket);
      });
    });

    const address = wss.address();
    if (address === null || typeof address === 'string') {
      throw new Error('MockBiDiServer did not get a TCP address.');
    }
    return `ws://127.0.0.1:${(address as AddressInfo).port}/session`;
  }

  async stop(): Promise<void> {
    for (const socket of this.#sockets) {
      socket.close();
    }
    this.#sockets.clear();

    const wss = this.#wss;
    this.#wss = undefined;
    if (wss === undefined) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      wss.close((error) => {
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      });
    });
  }

  sendEvent(method: string, params: Record<string, unknown> = {}): void {
    const event: BiDiEvent = { type: 'event', method, params };
    const serialized = JSON.stringify(event);
    for (const socket of this.#sockets) {
      socket.send(serialized);
    }
  }

  /**
   * Inject a raw frame exactly as a broken (or hostile) peer would send it.
   * Fixture for malformed-message handling — no validation on purpose.
   */
  sendRawFrame(frame: string): void {
    for (const socket of this.#sockets) {
      socket.send(frame);
    }
  }

  /** Terminate every open socket without a close frame (simulates a crash). */
  dropConnections(): void {
    for (const socket of this.#sockets) {
      socket.terminate();
    }
  }

  async #handleMessage(socket: WebSocket, data: RawData): Promise<void> {
    let command: BiDiCommand;
    try {
      command = JSON.parse(data.toString()) as BiDiCommand;
    } catch {
      return;
    }

    this.requests.push(command);

    const handler = this.#handlers.get(command.method);
    if (handler === undefined) {
      socket.send(
        JSON.stringify({
          type: 'error',
          id: command.id,
          error: 'unknown command',
          message: `Unknown method: ${command.method}`,
        })
      );
      return;
    }

    try {
      const result = await handler(command.params ?? {});
      socket.send(JSON.stringify({ type: 'success', id: command.id, result }));
    } catch (error) {
      socket.send(
        JSON.stringify({
          type: 'error',
          id: command.id,
          error: 'invalid argument',
          message: error instanceof Error ? error.message : String(error),
        })
      );
    }
  }
}
