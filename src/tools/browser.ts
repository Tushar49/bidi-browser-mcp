import type { JsonSchema } from '../types.js';
import { defineTool, requireAction } from './base-tool.js';
import { ActionableError } from '../utils/errors.js';
import { ok } from '../utils/result.js';

const ACTIONS = ['status', 'profiles', 'version', 'connect', 'disconnect'] as const;

const INPUT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: [...ACTIONS],
      description:
        'status: connection state; profiles: discovery candidates; version: server + browser; connect: attach; disconnect: end session',
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

export const browserTool = defineTool({
  name: 'browser',
  title: 'Browser session',
  description:
    'Inspect and control the single BiDi session. This never launches, closes, or mutates the user’s browser.',
  toolset: 'core',
  actions: ACTIONS,
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: async (args, ctx) => {
    const action = requireAction(args, 'browser', ACTIONS);
    const session = ctx.session;

    if (session === undefined) {
      throw new ActionableError(
        'INTERNAL_ERROR',
        'No session manager is attached to this server context.',
        { fix: 'Rebuild the server, then restart the MCP client.' }
      );
    }

    switch (action) {
      case 'status':
        return ok(action, await session.status());
      case 'profiles':
        return ok(action, { candidates: await session.profiles() });
      case 'version':
        return ok(action, await session.version());
      case 'connect':
        return ok(action, await session.connect());
      case 'disconnect':
        await session.disconnect();
        return ok(action, { connected: false });
      default:
        throw new ActionableError('INVALID_ACTION', `Unknown browser action: ${action}.`);
    }
  },
});
