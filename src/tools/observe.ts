import type { JsonSchema } from '../types.js';
import { COMMON_PARAMS, defineTool, requireAction } from './base-tool.js';
import { ActionableError } from '../utils/errors.js';
import { assertPositiveInt } from '../utils/assert.js';
import { ok } from '../utils/result.js';

const ACTIONS = ['status', 'events'] as const;

const INPUT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: [...ACTIONS],
      description:
        'status: subscription + buffer stats; events: buffered raw events with optional filters',
    },
    methods: {
      type: 'array',
      items: { type: 'string' },
      description: 'Only these BiDi event methods (e.g. log.entryAdded).',
    },
    context: COMMON_PARAMS.context,
    limit: {
      type: 'number',
      description: 'Max events to return.',
    },
    drain: {
      type: 'boolean',
      description: 'Remove returned events from the buffer. Default false.',
    },
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

export const observeTool = defineTool({
  name: 'observe',
  title: 'Observe',
  description:
    'Inspect the live event stream: what is subscribed, buffer health, and raw buffered events.',
  toolset: 'core',
  actions: ACTIONS,
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: async (args, ctx) => {
    const action = requireAction(args, 'observe', ACTIONS);
    const runtime = ctx.session?.runtime;
    if (runtime === undefined) {
      throw new ActionableError('CONNECTION_FAILED', 'No live browser session.', {
        fix: 'Call browser.connect first.',
      });
    }

    switch (action) {
      case 'status':
        return ok(action, runtime.events.stats());

      case 'events': {
        const methods = Array.isArray(args.methods)
          ? args.methods.filter((method): method is string => typeof method === 'string')
          : undefined;
        const context = typeof args.context === 'string' ? args.context : undefined;
        const limit =
          typeof args.limit === 'number' ? assertPositiveInt(args.limit, 'limit') : undefined;
        const drain = args.drain === true;
        return ok(action, { events: runtime.events.events({ methods, context, limit, drain }) });
      }

      default:
        throw new ActionableError('INVALID_ACTION', `Unknown observe action: ${action}.`);
    }
  },
});
