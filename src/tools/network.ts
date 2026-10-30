import type { JsonSchema } from '../types.js';
import { COMMON_PARAMS, defineTool, requireAction } from './base-tool.js';
import { ActionableError } from '../utils/errors.js';
import { NETWORK_SUBSCRIBED_EVENTS } from '../connection/event-pipeline.js';
import { ok } from '../utils/result.js';

const ACTIONS = ['wait'] as const;

const INPUT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: [...ACTIONS],
      description: 'wait: wait for a request or response matching filters',
    },
    until: {
      type: 'string',
      enum: ['request', 'response'],
      description: 'Which network event to wait for. Default response.',
    },
    method: {
      type: 'string',
      description: 'HTTP method filter, e.g. POST.',
    },
    urlPattern: {
      type: 'string',
      description: 'Substring match on the request URL (case-insensitive).',
    },
    timeout: {
      type: 'number',
      description: 'Deadline in milliseconds. Default 10000, capped at 30000.',
    },
    context: COMMON_PARAMS.context,
  },
  required: ['action'],
  additionalProperties: false,
};

const OUTPUT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    action: { type: 'string' },
    data: { type: ['object', 'null'] },
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        fix: { type: 'string' },
        details: { type: 'object' },
      },
      required: ['code', 'message'],
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'action'],
  additionalProperties: false,
};

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 100;

interface NetworkSummary {
  readonly event: 'request' | 'response' | 'error';
  readonly method: string | null;
  readonly url: string | null;
  readonly status: number | null;
}

/**
 * Extract metadata (never bodies) from a network event record.
 * Kinds:
 *  - network.beforeRequestSent   → request
 *  - network.responseStarted /
 *    network.responseCompleted   → response (status)
 *  - network.fetchError          → error
 */
function summarize(params: Record<string, unknown>): NetworkSummary | null {
  const request = asObject(params.request);
  const method = typeof request?.method === 'string' ? request.method : null;
  const url =
    typeof request?.url === 'string'
      ? request.url
      : typeof params.url === 'string'
        ? params.url
        : null;
  const response = asObject(params.response);
  const status = typeof response?.status === 'number' ? response.status : null;
  const errorText = typeof params.errorText === 'string' ? params.errorText : null;
  if (status !== null) {
    return { event: 'response', method, url: typeof response?.url === 'string' ? response.url : url, status };
  }
  if (errorText !== null) {
    return { event: 'error', method, url, status: null };
  }
  if (request !== undefined) {
    return { event: 'request', method, url, status: null };
  }
  return null;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export const networkTool = defineTool({
  name: 'network',
  title: 'Network',
  description:
    'Read-only network waits: wait for a request or response matching method/URL filters. Metadata only — no bodies, no interception. Requires BIDI_ENABLE_NETWORK.',
  toolset: 'network',
  actions: ACTIONS,
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: async (args, ctx) => {
    requireAction(args, 'network', ACTIONS);
    const session = ctx.session;
    const runtime = session?.runtime;
    if (session === undefined || runtime === undefined) {
      throw new ActionableError('CONNECTION_FAILED', 'No live browser session.', {
        fix: 'Call browser.connect first.',
      });
    }
    if (!ctx.config.enableNetwork) {
      // Visible tool, actionable failure (same shape as the script gate).
      throw new ActionableError(
        'UNSUPPORTED',
        'network waits are opt-in: set BIDI_ENABLE_NETWORK=1.',
        {
          fix: 'Add BIDI_ENABLE_NETWORK=1 to the server environment and reconnect.',
        }
      );
    }

    const until = args.until === 'request' ? 'request' : 'response';
    const methodFilter = typeof args.method === 'string' ? args.method.toLowerCase() : undefined;
    const urlFilter = typeof args.urlPattern === 'string' ? args.urlPattern.toLowerCase() : undefined;
    const timeout =
      typeof args.timeout === 'number' && args.timeout > 0
        ? Math.min(args.timeout, MAX_TIMEOUT_MS)
        : DEFAULT_TIMEOUT_MS;

    const context = await runtime.contexts.ensureContext(
      typeof args.context === 'string' ? args.context : undefined
    );

    // One additive subscription (decisions §5). First-ever call subscribes;
    // waits match everything buffered since that point, so the common
    // "trigger, then wait" flow still finds the completed exchange.
    await runtime.events.addSubscription(NETWORK_SUBSCRIBED_EVENTS);

    const started = Date.now();
    for (;;) {
      const records = runtime.events.events({ methods: [...NETWORK_SUBSCRIBED_EVENTS] });
      for (const record of records) {
        const summary = summarize(record.params);
        if (summary === null) continue;
        if (summary.event !== until && !(until === 'response' && summary.event === 'error')) continue;
        if (methodFilter !== undefined && (summary.method ?? '').toLowerCase() !== methodFilter) continue;
        if (urlFilter !== undefined && !(summary.url ?? '').toLowerCase().includes(urlFilter)) continue;
        if (context !== undefined && record.params.context !== context) continue;

        return ok('wait', {
          waitedMs: Date.now() - started,
          ...summary,
          source: record.method,
        });
      }

      if (Date.now() - started >= timeout) {
        throw new ActionableError('TIMEOUT', `network.wait found no matching ${until} within ${timeout}ms.`, {
          fix: 'Widen method/urlPattern. The first ever wait subscribes to network events — traffic from before that point is invisible.',
          details: { until, waitedMs: Date.now() - started, buffered: records.length },
        });
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  },
});
