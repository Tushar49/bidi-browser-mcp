import { WebSocket } from 'ws';
import type { ActionableErrorCode, BiDiEvent, BiDiMessage } from '../types.js';
import type { BiDiSocket } from './chromium-mapper.js';
import { ActionableError } from '../utils/errors.js';

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
  /** The BiDi method behind this request; stamped into every failure. */
  method: string;
}

/** Firefox 403s the first upgrade while finishing initialization; retry. */
const HANDSHAKE_RETRIES = 3;
const HANDSHAKE_RETRY_DELAY_MS = 500;
const HANDSHAKE_RETRY_STATUSES = ['403', '429', '503'] as const;

export type BiDiClientState = 'disconnected' | 'connecting' | 'connected';

export interface BiDiClientOptions {
  readonly url: string;
  readonly timeoutMs: number;
  /**
   * Custom socket opener for transports that are not a plain WebSocket —
   * the Chromium mapper facade. Must satisfy the `ws`-like BiDiSocket
   * surface; the returned socket is treated as a WebSocket internally.
   */
  readonly openSocket?: () => Promise<BiDiSocket>;
}

/**
 * Translate a BiDi error frame into our taxonomy (decisions §1 of the 0.2.0
 * plan). Only unambiguous flat codes map; everything unknown stays
 * SESSION_FAILED with the raw code preserved in details.biDiCode. Codes are
 * additive for 0.1.x clients.
 */
export function translateBiDiError(
  biDiCode: string | undefined,
  errorMessage: string | undefined
): ActionableErrorCode {
  if (
    biDiCode === 'session not created' ||
    (errorMessage !== undefined &&
      /maximum number (of )?active sessions/i.test(errorMessage))
  ) {
    return 'SESSION_BUSY';
  }
  switch (biDiCode) {
    case 'no such frame':
      return 'FRAME_NOT_FOUND';
    case 'no such element':
    case 'no such node':
    case 'detached shadow root':
      return 'STALE_UID';
    case 'unknown command':
    case 'unsupported operation':
      return 'UNSUPPORTED';
    case 'no such request':
      return 'NETWORK_ERROR';
    case 'move target out of bounds':
    case 'element not interactable':
      return 'NOT_INTERACTABLE';
    case 'invalid argument':
    case 'invalid selector':
      return 'INVALID_ARGUMENT';
    default:
      return 'SESSION_FAILED';
  }
}

/** The raw BiDi code plus the request's method, for agent diagnostics. */
function failureDetails(
  method: string,
  biDiCode: string | undefined
): Record<string, unknown> {
  const details: Record<string, unknown> = { method };
  if (biDiCode !== undefined) {
    details.biDiCode = biDiCode;
  }
  return details;
}

/**
 * Minimal BiDi WebSocket client. One command at a time is not required, but
 * request IDs are unique and pending commands are always settled.
 */
export class BiDiClient {
  readonly url: string;
  readonly #timeoutMs: number;
  readonly #openSocketFn?: () => Promise<BiDiSocket>;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #eventHandlers = new Set<(event: BiDiEvent) => void>();
  readonly #closeHandlers = new Set<() => void>();
  #closeHandlersFired = false;
  #socket?: WebSocket;
  #state: BiDiClientState = 'disconnected';
  #nextId = 1;
  #generation = 0;

  constructor(options: BiDiClientOptions) {
    this.url = options.url;
    this.#timeoutMs = options.timeoutMs;
    this.#openSocketFn = options.openSocket;
  }

  get state(): BiDiClientState {
    return this.#state;
  }

  onEvent(handler: (event: BiDiEvent) => void): () => void {
    this.#eventHandlers.add(handler);
    return () => {
      this.#eventHandlers.delete(handler);
    };
  }

  /** Fires when the socket drops for any reason. One-shot semantics. */
  onClose(handler: () => void): () => void {
    this.#closeHandlers.add(handler);
    return () => {
      this.#closeHandlers.delete(handler);
    };
  }

  async connect(): Promise<void> {
    if (this.#state === 'connected') {
      return;
    }

    if (this.#state === 'connecting') {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new ActionableError('CONNECTION_FAILED', 'Timed out waiting for BiDi connect.'));
        }, this.#timeoutMs);

        const check = (): void => {
          if (this.#state === 'connected') {
            clearTimeout(timer);
            resolve();
          } else if (this.#state === 'disconnected') {
            clearTimeout(timer);
            reject(new ActionableError('CONNECTION_FAILED', 'BiDi connection closed during connect.'));
          } else {
            setTimeout(check, 25);
          }
        };

        check();
      });
    }

    this.#state = 'connecting';

    // Firefox's Remote Agent occasionally 403s the first WebSocket upgrade
    // while the browser is still initializing (verified on Zen/Firefox 158).
    // A failed upgrade never creates a session, so a bounded retry is safe.
    let lastError: unknown;
    for (let attempt = 0; attempt < HANDSHAKE_RETRIES + 1; attempt++) {
      try {
        await this.#openSocket();
        // The socket can drop between 'open' and this line (e.g. the mapper
        // dies immediately): never report a connection that owns a dead socket.
        if (this.#state !== 'connecting') {
          throw new ActionableError(
            'CONNECTION_FAILED',
            'BiDi connection closed during connect.'
          );
        }
        this.#state = 'connected';
        return;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        const retryable =
          HANDSHAKE_RETRY_STATUSES.some((status) =>
            message.includes(`Unexpected server response: ${status}`)
          ) && attempt < HANDSHAKE_RETRIES;
        if (!retryable) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, HANDSHAKE_RETRY_DELAY_MS));
      }
    }

    this.#state = 'disconnected';
    throw lastError;
  }

  /** One full socket-open attempt (WebSocket or mapper facade). */
  #openSocket(): Promise<void> {
    this.#closeHandlersFired = false;
    return new Promise<void>((resolve, reject) => {
      let socket: WebSocket | undefined;
      // Invalidates async socket creation if this attempt is abandoned.
      const generation = ++this.#generation;

      const settle = (
        state: BiDiClientState,
        code: 'CONNECTION_FAILED' | 'CONNECTION_CLOSED',
        message: string,
        cause?: unknown
      ): void => {
        clearTimeout(timer);
        this.#generation += 1;
        if (socket !== undefined) {
          if (this.#socket === socket) {
            this.#socket = undefined;
          }
          socket.removeAllListeners();
          // ws emits the handshake-abort error asynchronously; without a
          // listener the 'error' event crashes the process.
          socket.on('error', () => {});
          try {
            socket.terminate();
          } catch {
            // Ignore terminate errors.
          }
        }
        this.#state = state;
        this.#failPending(code, message);
        reject(
          new ActionableError(
            code,
            message,
            cause === undefined ? undefined : { cause }
          )
        );
      };

      const timer = setTimeout(() => {
        settle('disconnected', 'CONNECTION_FAILED', `Timed out connecting to ${this.url}.`);
      }, this.#timeoutMs);

      void this.#createSocket().then(
        (created) => {
          // The attempt may have timed out or been superseded while the
          // custom opener was still working.
          if (generation !== this.#generation || this.#state !== 'connecting') {
            try {
              created.terminate();
            } catch {
              // Ignore terminate errors.
            }
            return;
          }
          socket = created;
          // Identity guard: after a timeout (or a retry) abandons this socket, a
          // late 'open' must never flip the client back to 'connected'. Without
          // this, a low BIDI_TIMEOUT could report a connection that owns nothing.
          const abandoned = (): boolean => this.#socket !== socket;
          this.#socket = socket;

          socket.on('error', (error) => {
            if (abandoned()) {
              return;
            }
            settle('disconnected', 'CONNECTION_FAILED', error.message, error);
          });

          socket.on('open', () => {
            if (abandoned()) {
              return;
            }
            clearTimeout(timer);
            resolve();
          });

          socket.on('message', (data) => {
            this.#handleMessage(String(data));
          });

          socket.on('close', () => {
            clearTimeout(timer);
            this.#state = 'disconnected';
            this.#failPending('CONNECTION_CLOSED', 'BiDi connection closed.');
            this.#fireClose();
          });
        },
        (error) => {
          clearTimeout(timer);
          settle(
            'disconnected',
            'CONNECTION_FAILED',
            error instanceof Error ? error.message : String(error),
            error
          );
        }
      );
    });
  }

  /**
   * Create the raw socket: a plain WebSocket for Firefox-family BiDi
   * endpoints, or the mapper facade for Chromium.
   */
  #createSocket(): Promise<WebSocket> {
    if (this.#openSocketFn === undefined) {
      return Promise.resolve(new WebSocket(this.url));
    }
    // The facade satisfies the ws surface this client uses; the cast keeps
    // the single socket field untyped-union free.
    return this.#openSocketFn().then(
      (facade) => facade as unknown as WebSocket
    );
  }

  async request(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<Record<string, unknown>> {
    const socket = this.#socket;
    if (socket === undefined || this.#state !== 'connected') {
      throw new ActionableError('CONNECTION_FAILED', 'Not connected to a BiDi endpoint.');
    }

    const id = this.#nextId++;
    const message = { id, method, params };
    const timer = setTimeout(() => {
      const pending = this.#pending.get(id);
      if (pending !== undefined) {
        this.#pending.delete(id);
        pending.reject(
          new ActionableError('TIMEOUT', `Timed out waiting for ${method}.`, {
            details: failureDetails(method, undefined),
          })
        );
      }
    }, this.#timeoutMs);

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, timer, method });
      socket.send(JSON.stringify(message));
    });
  }

  async close(): Promise<void> {
    const socket = this.#socket;
    this.#socket = undefined;
    this.#state = 'disconnected';
    this.#failPending('CONNECTION_CLOSED', 'BiDi connection closed.');

    if (socket === undefined) {
      return;
    }

    await new Promise<void>((resolve) => {
      if (socket.readyState === socket.CLOSED) {
        resolve();
        return;
      }
      socket.once('close', () => resolve());
      // `close()` throws synchronously on a CONNECTING socket; the 'error'
      // and 'close' events still arrive and resolve the promise. The
      // listener goes first so a synchronous emit cannot be missed.
      try {
        socket.close();
      } catch {
        // Socket is still handshaking; the close events will follow.
      }
    });
  }

  #handleMessage(raw: string): void {
    let message: BiDiMessage;
    try {
      message = JSON.parse(raw) as BiDiMessage;
    } catch {
      return;
    }

    if (message.type === 'event') {
      for (const handler of this.#eventHandlers) {
        handler(message);
      }
      return;
    }

    const pending = this.#pending.get(message.id);
    if (pending === undefined) {
      return;
    }

    this.#pending.delete(message.id);
    clearTimeout(pending.timer);

    if (message.type === 'success') {
      pending.resolve(message.result);
      return;
    }

    // Per the BiDi spec, error frames carry `error` as a flat string code and
    // `message` as a sibling string. Some endpoints nest them instead; accept
    // both shapes and never dereference a field that may not exist.
    const rawError: unknown = message.error;
    const nested = rawError as { message?: unknown; code?: unknown } | undefined;
    const errorMessage =
      typeof message.message === 'string' && message.message !== ''
        ? message.message
        : typeof nested?.message === 'string'
          ? nested.message
          : undefined;
    const biDiCode =
      typeof rawError === 'string'
        ? rawError
        : typeof nested?.code === 'string'
          ? nested.code
          : undefined;
    // Real Firefox/Zen reports the one-session conflict as
    // `session not created` / "Maximum number of active sessions".
    const code = translateBiDiError(biDiCode, errorMessage);

    pending.reject(
      new ActionableError(
        code,
        errorMessage ??
          `Malformed BiDi error frame for request ${String(message.id)}.`,
        { details: failureDetails(pending.method, biDiCode) }
      )
    );
  }

  #failPending(
    code: 'CONNECTION_CLOSED' | 'CONNECTION_FAILED',
    message: string
  ): void {
    this.#fireClose();
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(
        new ActionableError(code, message, {
          details: failureDetails(pending.method, undefined),
        })
      );
    }
    this.#pending.clear();
  }

  #fireClose(): void {
    if (this.#closeHandlersFired) {
      return;
    }
    this.#closeHandlersFired = true;
    for (const handler of this.#closeHandlers) {
      handler();
    }
  }
}
