import { WebSocket } from 'ws';
import type { BiDiEvent, BiDiMessage } from '../types.js';
import { ActionableError } from '../utils/errors.js';

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
}

/** Firefox 403s the first upgrade while finishing initialization; retry. */
const HANDSHAKE_RETRIES = 3;
const HANDSHAKE_RETRY_DELAY_MS = 500;
const HANDSHAKE_RETRY_STATUSES = ['403', '429', '503'] as const;

export type BiDiClientState = 'disconnected' | 'connecting' | 'connected';

export interface BiDiClientOptions {
  readonly url: string;
  readonly timeoutMs: number;
}

/**
 * Minimal BiDi WebSocket client. One command at a time is not required, but
 * request IDs are unique and pending commands are always settled.
 */
export class BiDiClient {
  readonly url: string;
  readonly #timeoutMs: number;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #eventHandlers = new Set<(event: BiDiEvent) => void>();
  readonly #closeHandlers = new Set<() => void>();
  #closeHandlersFired = false;
  #socket?: WebSocket;
  #state: BiDiClientState = 'disconnected';
  #nextId = 1;

  constructor(options: BiDiClientOptions) {
    this.url = options.url;
    this.#timeoutMs = options.timeoutMs;
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

  /** One full WebSocket handshake attempt. Resolves on 'open'. */
  #openSocket(): Promise<void> {
    this.#closeHandlersFired = false;
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.url);
      // Identity guard: after a timeout (or a retry) abandons this socket, a
      // late 'open' must never flip the client back to 'connected'. Without
      // this, a low BIDI_TIMEOUT could report a connection that owns nothing.
      const abandoned = (): boolean => this.#socket !== socket;

      const settle = (
        state: BiDiClientState,
        code: 'CONNECTION_FAILED' | 'CONNECTION_CLOSED',
        message: string,
        cause?: unknown
      ): void => {
        if (this.#socket === socket) {
          this.#socket = undefined;
        }
        this.#state = state;
        socket.removeAllListeners();
        // ws emits the handshake-abort error asynchronously; without a
        // listener the 'error' event crashes the process.
        socket.on('error', () => {});
        try {
          socket.terminate();
        } catch {
          // Ignore terminate errors.
        }
        this.#failPending(code, message);
        reject(
          new ActionableError(
            code,
            message,
            cause === undefined ? undefined : { cause }
          )
        );
      };

      this.#socket = socket;

      const timer = setTimeout(() => {
        settle('disconnected', 'CONNECTION_FAILED', `Timed out connecting to ${this.url}.`);
      }, this.#timeoutMs);

      socket.on('error', (error) => {
        clearTimeout(timer);
        if (abandoned()) {
          return;
        }
        settle('disconnected', 'CONNECTION_FAILED', error.message, error);
      });

      socket.on('open', () => {
        clearTimeout(timer);
        if (abandoned()) {
          return;
        }
        resolve();
      });

      socket.on('message', (data) => {
        this.#handleMessage(data.toString());
      });

      socket.on('close', () => {
        clearTimeout(timer);
        this.#state = 'disconnected';
        this.#failPending('CONNECTION_CLOSED', 'BiDi connection closed.');
        this.#fireClose();
      });
    });
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
          new ActionableError('TIMEOUT', `Timed out waiting for ${method}.`)
        );
      }
    }, this.#timeoutMs);

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, timer });
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
      // `close()` throws synchronously on a CONNECTING socket; the 'error'
      // and 'close' events still arrive and resolve the promise.
      try {
        socket.close();
      } catch {
        // Socket is still handshaking; the close events will follow.
      }
      socket.once('close', () => resolve());
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
    const isBusy =
      biDiCode === 'session not created' ||
      (errorMessage !== undefined &&
        /maximum number (of )?active sessions/i.test(errorMessage));
    const code = isBusy ? 'SESSION_BUSY' : 'SESSION_FAILED';

    pending.reject(
      new ActionableError(
        code,
        errorMessage ??
          `Malformed BiDi error frame for request ${String(message.id)}.`,
        { details: biDiCode === undefined ? undefined : { biDiCode } }
      )
    );
  }

  #failPending(code: 'CONNECTION_CLOSED' | 'CONNECTION_FAILED', message: string): void {
    this.#fireClose();
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new ActionableError(code, message));
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
