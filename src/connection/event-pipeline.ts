import type {
  BiDiClientLike,
  BiDiEvent,
  ConsoleEntry,
  EventFilter,
  EventPipelineLike,
  EventRecord,
  RuntimeStats,
} from '../types.js';
import { assertPositiveInt } from '../utils/assert.js';

/**
 * v0.1.5 subscribes only to events its tools consume. Network, userPrompt,
 * and download events join when their tools land, keeping buffers small.
 */
export const SUBSCRIBED_EVENTS = [
  'browsingContext.contextCreated',
  'browsingContext.contextDestroyed',
  'browsingContext.domContentLoaded',
  'log.entryAdded',
] as const;

const DEFAULT_BUFFER_LIMIT = 200;

export interface EventPipelineOptions {
  /** Max buffered events per method; oldest are dropped and counted. */
  readonly bufferLimitPerMethod?: number;
}

type Sink = (event: BiDiEvent) => void;

/**
 * Routes BiDi events to sinks and keeps bounded per-method buffers.
 * One `session.subscribe` for the lifetime of the session.
 */
export class EventPipeline implements EventPipelineLike {
  readonly #bufferLimit: number;
  readonly #buffers = new Map<string, EventRecord[]>();
  readonly #dropped = new Map<string, number>();
  readonly #sinks = new Set<Sink>();
  #offClient?: () => void;

  constructor(options: EventPipelineOptions = {}) {
    this.#bufferLimit = options.bufferLimitPerMethod ?? DEFAULT_BUFFER_LIMIT;
  }

  /**
   * Subscribe once and start routing. Must be called after the client is
   * connected; `session.subscribe` is a plain command here.
   */
  async attach(client: BiDiClientLike): Promise<void> {
    if (this.#offClient !== undefined) {
      return;
    }

    await client.request('session.subscribe', { events: [...SUBSCRIBED_EVENTS] });
    this.#offClient = client.onEvent((event) => {
      this.#route(event);
    });
  }

  registerSink(sink: Sink): () => void {
    this.#sinks.add(sink);
    return () => {
      this.#sinks.delete(sink);
    };
  }

  /** Called directly by sinks that were registered before the router. */
  record(event: BiDiEvent): void {
    this.#route(event);
  }

  #route(event: BiDiEvent): void {
    for (const sink of this.#sinks) {
      try {
        sink(event);
      } catch {
        // A failing sink must never take down the router — and with it the
        // MCP process.
      }
    }
    this.#buffer(event);
  }

  #buffer(event: BiDiEvent): void {
    const buffer = this.#buffers.get(event.method) ?? [];
    if (buffer.length >= this.#bufferLimit) {
      buffer.shift();
      this.#dropped.set(event.method, (this.#dropped.get(event.method) ?? 0) + 1);
    }
    buffer.push({ method: event.method, params: event.params, receivedAt: Date.now() });
    this.#buffers.set(event.method, buffer);
  }

  events(filter: EventFilter = {}): readonly EventRecord[] {
    const limit =
      filter.limit === undefined ? undefined : assertPositiveInt(filter.limit, 'limit');
    const wanted =
      filter.methods === undefined
        ? [...this.#buffers.keys()]
        : filter.methods.filter((method) => this.#buffers.has(method));

    const collected: EventRecord[] = [];
    const returned: { method: string; record: EventRecord }[] = [];
    for (const method of wanted) {
      const buffer = this.#buffers.get(method) ?? [];
      for (const record of buffer) {
        if (filter.context !== undefined && record.params.context !== filter.context) {
          continue;
        }
        collected.push(record);
        returned.push({ method, record });
        if (limit !== undefined && collected.length >= limit) {
          break;
        }
      }
      if (limit !== undefined && collected.length >= limit) {
        break;
      }
    }

    if (filter.drain === true) {
      // Remove only what was returned — the rest of the buffer stays for a
      // later call.
      for (const method of wanted) {
        const buffer = this.#buffers.get(method) ?? [];
        const removed = new Set(
          returned.filter((entry) => entry.method === method).map((entry) => entry.record)
        );
        this.#buffers.set(
          method,
          buffer.filter((record) => !removed.has(record))
        );
      }
    }

    return collected;
  }

  consoleEntries(
    filter: { level?: string; context?: string; limit?: number } = {}
  ): readonly ConsoleEntry[] {
    const records = this.events({
      methods: ['log.entryAdded'],
      context: filter.context,
    });

    const limit =
      filter.limit === undefined ? undefined : assertPositiveInt(filter.limit, 'limit');

    const entries: ConsoleEntry[] = [];
    for (const record of records) {
      const params = record.params as {
        channel?: unknown;
        level?: unknown;
        text?: unknown;
        args?: unknown;
      };
      const level = typeof params.level === 'string' ? params.level : 'info';
      if (filter.level !== undefined && filter.level !== '' && level !== filter.level) {
        continue;
      }
      entries.push({
        channel: typeof params.channel === 'string' ? params.channel : 'console',
        level,
        text: describeLogText(params),
        ...(typeof record.params.context === 'string' ? { context: record.params.context } : {}),
        receivedAt: record.receivedAt,
      });
      if (limit !== undefined && entries.length >= limit) {
        break;
      }
    }
    return entries;
  }

  clearConsole(): void {
    this.#buffers.delete('log.entryAdded');
  }

  stats(): RuntimeStats {
    const buffered: Record<string, number> = {};
    for (const [method, buffer] of this.#buffers) {
      if (buffer.length > 0) {
        buffered[method] = buffer.length;
      }
    }
    const dropped: Record<string, number> = {};
    for (const [method, count] of this.#dropped) {
      dropped[method] = count;
    }
    return { subscribed: [...SUBSCRIBED_EVENTS], buffered, dropped };
  }

  detach(): void {
    this.#offClient?.();
    this.#offClient = undefined;
  }
}

function describeLogText(params: {
  text?: unknown;
  args?: unknown;
}): string {
  if (typeof params.text === 'string' && params.text !== '') {
    return params.text;
  }
  if (Array.isArray(params.args)) {
    const parts = params.args.map((arg) => {
      if (arg !== null && typeof arg === 'object' && 'value' in arg) {
        const value = (arg as { value?: unknown }).value;
        return typeof value === 'string' ? value : JSON.stringify(value ?? null);
      }
      return JSON.stringify(arg);
    });
    return parts.join(' ');
  }
  return '(no text)';
}
