import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { ActionableError } from '../utils/errors.js';

/**
 * Chromium support without chromedriver: host the `chromium-bidi` mapper in
 * this process and hand it a CDP connection to the browser. Our BiDi client
 * speaks BiDi to the mapper over an in-process facade; the mapper translates
 * to CDP. The mapper is an optional dependency - when absent we fail with an
 * actionable install hint instead of crashing.
 */

/** Subset of the `ws` WebSocket surface BiDiClient relies on. */
export interface BiDiSocket {
  readonly readyState: number;
  readonly CLOSED: number;
  send(data: string): void;
  close(): void;
  terminate(): void;
  removeAllListeners(): void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  once(event: string, listener: (...args: unknown[]) => void): unknown;
}

interface MapperTransport {
  setOnMessage(handler: (message: unknown) => Promise<void> | void): void;
  sendMessage(message: unknown): Promise<void> | void;
  close(): void;
}

interface MapperBidiServer {
  close(): void;
}

/**
 * Minimal structural types for the two mapper classes we reach into. The
 * chromium-bidi package ships real .d.ts files, but only `BidiServer` is
 * exported from its index - `MapperCdpConnection` needs a deep import, and
 * asserting the shape here keeps that fragility in one place. The import
 * specifier is resolved at runtime, hence the cast rather than a typed
 * module declaration.
 */
interface MapperModules {
  readonly BidiServer: {
    createAndStart(
      bidiTransport: MapperTransport,
      cdpConnection: unknown,
      browserCdpClient: unknown,
      selfTargetId: string
    ): Promise<MapperBidiServer>;
  };
  readonly MapperCdpConnection: new (
    transport: MapperTransport
  ) => {
    createBrowserSession(): Promise<unknown>;
    close(): void;
  };
}

// Version-pinned in package.json: this path is a build artifact of the
// mapper's own build and may move between versions.
const MAPPER_CDP_MODULE =
  'chromium-bidi/out/Default/gen/src/cdp/CdpConnection.js';

// The deep import above is a build artifact: a different chromium-bidi
// version can move or rename it, so the dependency is pinned exactly.
const MAPPER_VERSION = '158.0.8123-0';

// chromium-bidi's own engines range. The server itself runs on wider Node
// versions (Firefox needs no mapper); only Chromium needs this range.
const MAPPER_NODE_RANGE = '>=20.19.0 <22.0.0 || >=22.12.0';

/** True when this Node version satisfies chromium-bidi's engines range. */
export function nodeSupportsMapper(version = process.versions.node): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  if (major === 20) return minor >= 19;
  if (major === 21) return true;
  if (major === 22) return minor >= 12;
  return major > 22;
}

function mapperInstallFix(): string {
  const parts = [
    'Install the optional mapper with the package manager that installed this' +
      ' server, without omitting optional dependencies.' +
      ` npm: npm install -g chromium-bidi@${MAPPER_VERSION} (global server)` +
      ` or npm install chromium-bidi@${MAPPER_VERSION} (project server).` +
      ' pnpm: reinstall the server itself (pnpm add -g bidi-browser-mcp) or run' +
      ' it through pnpm dlx - pnpm isolates global packages, so a separate' +
      ' global chromium-bidi is not visible to the server.' +
      ' If an install used --omit=optional, reinstall without it.',
  ];
  if (!nodeSupportsMapper()) {
    parts.push(
      `chromium-bidi requires Node ${MAPPER_NODE_RANGE}; this process is` +
        ` Node ${process.versions.node}.`
    );
  }
  return parts.join(' ');
}

function isModuleNotFound(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /Cannot find (module|package)/i.test(message);
}

async function loadMapperModules(): Promise<MapperModules> {
  try {
    const index = (await import('chromium-bidi')) as unknown as {
      BidiMapper: { BidiServer: MapperModules['BidiServer'] };
    };
    // Runtime-resolved deep import into the optional dependency; the cast
    // asserts the documented shape instead of leaking `any`.
    const cdp = (await import(
      MAPPER_CDP_MODULE
    )) as unknown as {
      MapperCdpConnection: MapperModules['MapperCdpConnection'];
    };
    return {
      BidiServer: index.BidiMapper.BidiServer,
      MapperCdpConnection: cdp.MapperCdpConnection,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (isModuleNotFound(error)) {
      throw new ActionableError(
        'MISSING_DEPENDENCY',
        'Chromium support needs the optional "chromium-bidi" mapper package.',
        {
          fix: mapperInstallFix(),
          details: {
            reason,
            node: process.versions.node,
            requiredNode: MAPPER_NODE_RANGE,
          },
        }
      );
    }
    throw new ActionableError(
      'CONNECTION_FAILED',
      'The installed chromium-bidi mapper failed to load.',
      {
        fix:
          `chromium-bidi is pinned at ${MAPPER_VERSION} because the mapper` +
          ' deep-import path moves between versions. Reinstall exactly that' +
          ' version with the package manager that installed this server' +
          (nodeSupportsMapper()
            ? '.'
            : `; this process is Node ${process.versions.node} and the mapper` +
              ` requires Node ${MAPPER_NODE_RANGE}.`),
        details: {
          reason,
          pinnedVersion: MAPPER_VERSION,
          node: process.versions.node,
          requiredNode: MAPPER_NODE_RANGE,
        },
      }
    );
  }
}

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

/**
 * ws-compatible facade. BiDiClient drives it exactly like a real WebSocket:
 * every `send()` is a BiDi command routed into the mapper, every mapper
 * reply is re-emitted as a 'message' event, and the CDP side dropping is
 * surfaced as a socket close.
 */
class MapperSocket extends EventEmitter implements BiDiSocket {
  readonly CLOSED = CLOSED;
  readyState = CONNECTING;

  #commandHandler?: (command: unknown) => Promise<void> | void;
  #teardown?: () => void;
  /**
   * Messages the mapper emits while it is still starting. Dropping them would
   * lose contextCreated events for tabs that already exist (the mapper replays
   * them at startup), so they are buffered and flushed right after 'open'.
   */
  #pendingMessages: unknown[] = [];
  static readonly #MAX_PENDING_MESSAGES = 500;

  /** Registered by the BidiServer transport wrapper. */
  setCommandHandler(handler: (command: unknown) => Promise<void> | void): void {
    this.#commandHandler = handler;
  }

  /** Mapper outgoing message -> BiDiClient 'message' event. */
  pushMessage(message: unknown): void {
    if (this.readyState === OPEN) {
      this.emit('message', JSON.stringify(message));
      return;
    }
    if (
      this.readyState === CONNECTING &&
      this.#pendingMessages.length < MapperSocket.#MAX_PENDING_MESSAGES
    ) {
      this.#pendingMessages.push(message);
    }
  }

  /** Schedule 'open' and register the teardown for close paths. */
  attach(teardown: () => void): void {
    this.#teardown = teardown;
    // Emit 'open' on a macrotask so BiDiClient attaches its listeners (same
    // tick as the await that produced this socket) before the event fires.
    setTimeout(() => {
      if (this.readyState === CONNECTING) {
        this.readyState = OPEN;
        this.emit('open');
        const pending = this.#pendingMessages;
        this.#pendingMessages = [];
        for (const message of pending) {
          this.emit('message', JSON.stringify(message));
        }
      }
    }, 0);
  }

  /** BiDi JSON from BiDiClient; forward into the mapper. */
  send(data: string): void {
    if (this.readyState !== OPEN) {
      throw new Error('Mapper socket is not open.');
    }
    let command: unknown;
    try {
      command = JSON.parse(data);
    } catch {
      return;
    }
    void this.#commandHandler?.(command);
  }

  close(): void {
    this.terminate();
  }

  terminate(): void {
    if (this.readyState === CLOSED) {
      return;
    }
    this.readyState = CLOSED;
    this.#runTeardown();
    // Async, mirroring ws, so a listener registered right after close()
    // still receives the event.
    queueMicrotask(() => this.emit('close', 1000, Buffer.alloc(0)));
  }

  /** The CDP side dropped: surface as a socket close so sessions reset. */
  notifyCdpDrop(): void {
    this.#emitClosed();
  }

  #emitClosed(): void {
    if (this.readyState === CLOSED) {
      return;
    }
    this.readyState = CLOSED;
    this.#runTeardown();
    queueMicrotask(() => this.emit('close', 1006, Buffer.alloc(0)));
  }

  #runTeardown(): void {
    this.#pendingMessages = [];
    const teardown = this.#teardown;
    this.#teardown = undefined;
    try {
      teardown?.();
    } catch {
      // Teardown is best effort; the socket is closing regardless.
    }
  }
}

export interface ChromiumMapperOptions {
  /** CDP browser WebSocket URL, e.g. from Chromium's DevToolsActivePort. */
  readonly cdpUrl: string;
  readonly timeoutMs: number;
}

/**
 * Connect to a Chromium CDP endpoint and start the in-process mapper.
 * Resolves with a ws-compatible socket that speaks WebDriver BiDi.
 */
export async function openChromiumMapperSocket(
  options: ChromiumMapperOptions
): Promise<BiDiSocket> {
  const modules = await loadMapperModules();

  const cdpSocket = new WebSocket(options.cdpUrl);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cdpSocket.removeAllListeners();
        // Same hazard as the raw BiDi path: ws emits the handshake-abort
        // 'error' asynchronously; keep a listener attached.
        cdpSocket.on('error', () => {});
        try {
          cdpSocket.terminate();
        } catch {
          // Ignore terminate errors.
        }
        reject(
          new ActionableError(
            'CONNECTION_FAILED',
            `Timed out connecting to the Chromium CDP endpoint at ${options.cdpUrl}.`,
            {
              fix: 'Approve the debugging permission dialog in the browser window, then retry.',
            }
          )
        );
      }, options.timeoutMs);

      cdpSocket.once('error', (error: Error) => {
        clearTimeout(timer);
        reject(
          new ActionableError(
            'CONNECTION_FAILED',
            `Chromium CDP endpoint refused the connection: ${error.message}`,
            { fix: 'Verify the browser runs with --remote-debugging-port.' }
          )
        );
      });
      cdpSocket.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  } catch (error) {
    cdpSocket.removeAllListeners();
    // ws emits the handshake-abort 'error' asynchronously; never leave the
    // socket without a listener or the process crashes.
    cdpSocket.on('error', () => {});
    throw error;
  }

  const cdpConnection = new modules.MapperCdpConnection({
    setOnMessage: (handler) => {
      cdpSocket.on('message', (data: unknown) => {
        const raw =
          typeof data === 'string'
            ? data
            : Array.isArray(data)
              ? Buffer.concat(data as Buffer[]).toString('utf8')
              : Buffer.from(data as Buffer).toString('utf8');
        void handler(raw);
      });
    },
    sendMessage: (message) => {
      cdpSocket.send(
        typeof message === 'string' ? message : JSON.stringify(message)
      );
    },
    close: () => {
      try {
        cdpSocket.close();
      } catch {
        // Already closing or still handshaking.
      }
    },
  });

  const socket = new MapperSocket();
  const browserClient = await cdpConnection.createBrowserSession();

  const bidiServer = await modules.BidiServer.createAndStart(
    {
      setOnMessage: (handler) => {
        socket.setCommandHandler(handler);
      },
      sendMessage: (message) => {
        socket.pushMessage(message);
      },
      close: () => {
        // Nothing extra: the mapper has no server-side socket to close.
      },
    },
    cdpConnection,
    browserClient,
    // The mapper excludes "its own" CDP target by id. This process hosts the
    // mapper, so there is no such target; a non-existent id is harmless.
    'bidi-browser-mcp-node-hosted-mapper'
  );

  // A CDP-level drop must reset our BiDi session state (SessionManager's
  // onClose recovery depends on the 'close' event).
  cdpSocket.once('close', () => socket.notifyCdpDrop());
  cdpSocket.once('error', () => socket.notifyCdpDrop());

  socket.attach(() => {
    bidiServer.close();
    cdpConnection.close();
    cdpSocket.removeAllListeners();
    try {
      cdpSocket.terminate();
    } catch {
      // Ignore terminate errors.
    }
  });

  return socket;
}
