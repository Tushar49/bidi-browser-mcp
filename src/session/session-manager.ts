import { BiDiClient } from '../connection/bidi-client.js';
import { discoverBrowsers } from '../connection/browser-discovery.js';
import { EventPipeline } from '../connection/event-pipeline.js';
import { ContextManager } from './context-manager.js';
import { SnapshotCache } from '../snapshot/cache.js';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Config,
  ConnectionRuntimeLike,
  DiscoveryCandidate,
  SessionManagerLike,
  SessionStatus,
} from '../types.js';
import { ActionableError, formatError } from '../utils/errors.js';

interface PersistedSession {
  sessionId: string;
  endpoint: string;
}

/** Disk record so a later process can end a session this one left behind. */
const LAST_SESSION_FILE = 'last-bidi-session.json';

export interface SessionManagerOptions {
  readonly config: Config;
  readonly serverVersion: string;
}

/**
 * Owns the single BiDi session for this MCP server process.
 * It never relaunches, mutates, or closes the user's browser.
 */
export class SessionManager implements SessionManagerLike {
  readonly #config: Config;
  readonly #serverVersion: string;
  #client?: BiDiClient;
  #sessionId?: string;
  #capabilities?: Record<string, unknown>;
  #profile?: string;
  #connecting?: Promise<SessionStatus>;
  #runtime?: ConnectionRuntimeLike;

  /** Live-session services (events, contexts); undefined when disconnected. */
  get runtime(): ConnectionRuntimeLike | undefined {
    return this.#runtime;
  }

  constructor(options: SessionManagerOptions) {
    this.#config = options.config;
    this.#serverVersion = options.serverVersion;
  }

  async connect(): Promise<SessionStatus> {
    const existing = this.#status();
    if (existing.connected) {
      return existing;
    }

    if (this.#connecting !== undefined) {
      return this.#connecting;
    }

    this.#connecting = this.#connectOnce();
    try {
      return await this.#connecting;
    } finally {
      this.#connecting = undefined;
    }
  }

  async disconnect(): Promise<void> {
    // A concurrent client may still be connecting; wait for it so the session
    // is guaranteed to be torn down rather than silently left open.
    if (this.#connecting !== undefined) {
      try {
        await this.#connecting;
      } catch {
        // Connect failed; nothing to tear down.
      }
    }

    const client = this.#client;
    try {
      if (client !== undefined && this.#sessionId !== undefined) {
        // Best effort: the socket may already be dead. Recovery must not
        // depend on session.end succeeding.
        try {
          await client.request('session.end', {});
        } catch {
          // Session already gone — proceed with teardown below.
        }
      }
    } finally {
      this.#sessionId = undefined;
      this.#capabilities = undefined;
      this.#profile = undefined;
      this.#clearLastSession();
      this.#runtime?.events.detach();
      this.#runtime = undefined;

      if (client !== undefined) {
        await client.close();
      }
      this.#client = undefined;
    }
  }

  async status(): Promise<SessionStatus> {
    return this.#status();
  }

  /** Send a BiDi command on the live session. */
  async request(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<Record<string, unknown>> {
    const client = this.#client;
    if (client === undefined || this.#sessionId === undefined) {
      throw new ActionableError('CONNECTION_FAILED', 'No live browser session.', {
        fix: 'Call browser.connect first.',
      });
    }
    return client.request(method, params);
  }

  async profiles(): Promise<readonly DiscoveryCandidate[]> {
    const candidates = await discoverBrowsers(this.#config);
    const connectedEndpoint = this.#client?.url;

    return candidates.map((candidate) => ({
      ...candidate,
      ...(connectedEndpoint === candidate.endpoint ? { live: true } : {}),
    }));
  }

  async version(): Promise<{ serverVersion: string; browserVersion?: string }> {
    const status = this.#status();
    const browserVersion = status.browser?.browserVersion;
    return {
      serverVersion: this.#serverVersion,
      ...(browserVersion === undefined ? {} : { browserVersion }),
    };
  }

  async #connectOnce(): Promise<SessionStatus> {
    const candidates = await discoverBrowsers(this.#config);
    if (candidates.length === 0) {
      throw new ActionableError(
        'DISCOVERY_FAILED',
        'No reachable Firefox-family BiDi endpoint was found.',
        {
          fix: 'Start Firefox or Zen with --remote-debugging-port, or set BIDI_WS_URL.',
        }
      );
    }

    let lastError: unknown;

    // SESSION_BUSY means a previous process left a session behind. If we know
    // its id we can reattach via its dedicated path and end it, then retry.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt === 1) {
        const recovered = await this.#attemptRecovery();
        if (!recovered) {
          break;
        }
      }

      const result = await this.#tryCandidates(candidates);
      if (result.ok) {
        return result.status;
      }
      lastError = result.error;
      if (!(result.busy && attempt === 0)) {
        break;
      }
    }

    throw new ActionableError(
      'DISCOVERY_FAILED',
      'No reachable Firefox-family BiDi endpoint accepted a session.',
      {
        fix:
          'Start Firefox or Zen with --remote-debugging-port, or set BIDI_WS_URL.' +
          ' If a previous client died holding the session, Firefox frees it only on browser restart.',
        ...(lastError === undefined
          ? {}
          : { details: { lastError: formatError(lastError) } }),
      }
    );
  }

  async #tryCandidates(
    candidates: readonly DiscoveryCandidate[]
  ): Promise<
    { ok: true; status: SessionStatus } | { ok: false; busy: boolean; error: unknown }
  > {
    let lastError: unknown;
    let sawBusy = false;

    for (const candidate of candidates) {
      const client = new BiDiClient({ url: candidate.endpoint, timeoutMs: this.#config.timeoutMs });
      try {
        await client.connect();

        // Confirm the endpoint before taking a session.
        await client.request('session.status', {});

        // Firefox/Zen assert that `capabilities` is present.
        const result = await client.request('session.new', { capabilities: {} });
        const sessionId =
          typeof result.sessionId === 'string' ? result.sessionId : undefined;
        const capabilities = (result.capabilities ?? {}) as Record<string, unknown>;

        const pipeline = new EventPipeline();
        const contexts = new ContextManager(client);
        const snapshots = new SnapshotCache();
        pipeline.registerSink((event) => {
          contexts.handleEvent(event);
          snapshots.handleEvent(event);
        });
        try {
          await pipeline.attach(client);
          await contexts.sync();
        } catch (error) {
          // The session exists but the session services failed: end it so it
          // does not leak in the browser (a dead WebSocket cannot end it later).
          await client.request('session.end', {}).catch(() => {});
          throw error;
        }

        // Commit the adopted session only when everything is in place.
        this.#client = client;
        this.#sessionId = sessionId;
        this.#capabilities = capabilities;
        this.#profile = candidate.profilePath;
        this.#runtime = { events: pipeline, contexts, snapshots };
        if (sessionId !== undefined) {
          this.#persistLastSession(sessionId, candidate.endpoint);
        }

        return { ok: true, status: this.#status() };
      } catch (error) {
        // Firefox allows one BiDi session per process - never leave a socket
        // behind for a candidate we are not keeping, and roll back any
        // partially adopted state so status() cannot report a ghost session.
        if (this.#client === client) {
          this.#client = undefined;
          this.#sessionId = undefined;
          this.#capabilities = undefined;
          this.#profile = undefined;
          this.#runtime = undefined;
        }
        await client.close().catch(() => {});
        if (error instanceof ActionableError && error.code === 'SESSION_BUSY') {
          // The busy error is the meaningful one; a later candidate's
          // handshake failure must not mask it.
          lastError = error;
          sawBusy = true;
        } else {
          lastError = error;
        }
      }
    }

    return { ok: false, busy: sawBusy, error: lastError };
  }

  /** Remember the live session so a later process can end it if we die. */
  #persistLastSession(sessionId: string, endpoint: string): void {
    try {
      const file = join(this.#config.tempDir, LAST_SESSION_FILE);
      mkdirSync(this.#config.tempDir, { recursive: true });
      const record: PersistedSession = { sessionId, endpoint };
      writeFileSync(file, JSON.stringify(record), 'utf8');
    } catch {
      // Persistence is best-effort; recovery simply stays unavailable.
    }
  }

  #clearLastSession(): void {
    try {
      rmSync(join(this.#config.tempDir, LAST_SESSION_FILE), { force: true });
    } catch {
      // Best-effort.
    }
  }

  #readLastSession(): PersistedSession | undefined {
    try {
      const file = join(this.#config.tempDir, LAST_SESSION_FILE);
      if (!existsSync(file)) {
        return undefined;
      }
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<PersistedSession>;
      if (typeof parsed.sessionId !== 'string' || typeof parsed.endpoint !== 'string') {
        return undefined;
      }
      return { sessionId: parsed.sessionId, endpoint: parsed.endpoint };
    } catch {
      return undefined;
    }
  }

  /**
   * End a session left behind by a dead process: reattach through its
   * dedicated WebSocket path (`/session/<id>`) and send `session.end`.
   * Firefox registers that path only for sessions that expose `webSocketUrl`;
   * when it does not exist the orphan can only be freed by a browser restart.
   */
  async #attemptRecovery(): Promise<boolean> {
    const persisted = this.#readLastSession();
    if (persisted === undefined) {
      return false;
    }

    let origin: URL;
    try {
      origin = new URL(persisted.endpoint);
    } catch {
      return false;
    }
    const recoveryUrl = `${origin.protocol}//${origin.host}/session/${persisted.sessionId}`;

    const client = new BiDiClient({
      url: recoveryUrl,
      timeoutMs: Math.min(this.#config.timeoutMs, 5000),
    });
    try {
      await client.connect();
      await client.request('session.end', {});
      this.#clearLastSession();
      return true;
    } catch {
      return false;
    } finally {
      await client.close().catch(() => {});
    }
  }

  #status(): SessionStatus {
    if (this.#client === undefined || this.#sessionId === undefined) {
      return { connected: false };
    }

    return {
      connected: true,
      sessionId: this.#sessionId,
      browser: this.#capabilities,
      ...(this.#profile === undefined ? {} : { profile: this.#profile }),
    };
  }
}
