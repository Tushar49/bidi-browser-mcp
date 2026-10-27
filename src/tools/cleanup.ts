import type { JsonSchema } from '../types.js';
import { defineTool, requireAction } from './base-tool.js';
import { ActionableError } from '../utils/errors.js';
import { ok } from '../utils/result.js';

const ACTIONS = ['disconnect'] as const;

const INPUT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: [...ACTIONS],
      description: 'disconnect: end the BiDi session without closing the browser',
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

export const cleanupTool = defineTool({
  name: 'cleanup',
  title: 'Cleanup',
  description:
    'End the BiDi session cleanly. The browser and its tabs stay open; no session is left behind.',
  toolset: 'core',
  actions: ACTIONS,
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: async (args, ctx) => {
    const action = requireAction(args, 'cleanup', ACTIONS);
    const session = ctx.session;
    if (session === undefined) {
      throw new ActionableError('INTERNAL_ERROR', 'No session manager is attached.', {
        fix: 'Rebuild the server, then restart the MCP client.',
      });
    }

    await session.disconnect();
    return ok(action, { connected: false });
  },
});
