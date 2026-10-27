import type { JsonSchema } from '../types.js';
import { COMMON_PARAMS, defineTool, requireAction } from './base-tool.js';
import { ActionableError } from '../utils/errors.js';
import { assertPositiveInt } from '../utils/assert.js';
import { ok } from '../utils/result.js';

const ACTIONS = ['list', 'clear'] as const;

const INPUT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: [...ACTIONS],
      description: 'list: buffered console entries; clear: drop the console buffer',
    },
    level: {
      type: 'string',
      description: 'Filter by level (e.g. error, warn, info).',
    },
    context: COMMON_PARAMS.context,
    limit: {
      type: 'number',
      description: 'Max entries to return. Newest last.',
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

export const consoleTool = defineTool({
  name: 'console',
  title: 'Console',
  description:
    'Read buffered console messages from the live session. Buffers start at connect and are bounded.',
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
    const action = requireAction(args, 'console', ACTIONS);
    const runtime = ctx.session?.runtime;
    if (runtime === undefined) {
      throw new ActionableError('CONNECTION_FAILED', 'No live browser session.', {
        fix: 'Call browser.connect first.',
      });
    }

    switch (action) {
      case 'list': {
        const level = typeof args.level === 'string' ? args.level : undefined;
        const context = typeof args.context === 'string' ? args.context : undefined;
        const limit =
          typeof args.limit === 'number' ? assertPositiveInt(args.limit, 'limit') : undefined;
        return ok(action, {
          entries: runtime.events.consoleEntries({ level, context, limit }),
        });
      }

      case 'clear':
        runtime.events.clearConsole();
        return ok(action, { cleared: true });

      default:
        throw new ActionableError('INVALID_ACTION', `Unknown console action: ${action}.`);
    }
  },
});
