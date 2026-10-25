import type { JsonSchema } from '../types.js';
import { defineTool, requireAction } from './base-tool.js';
import { ok } from '../utils/result.js';

const ACTIONS = ['status'] as const;

const INPUT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: [...ACTIONS],
      description: 'status: report server version and connection state.',
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
    data: {
      type: 'object',
      properties: {
        serverVersion: { type: 'string' },
        connected: { type: 'boolean' },
        browser: { type: ['object', 'null'] },
        uptimeMs: { type: 'number' },
      },
      required: ['serverVersion', 'connected', 'browser', 'uptimeMs'],
    },
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

export const pingTool = defineTool({
  name: 'ping',
  title: 'Ping server',
  description:
    'Report the MCP server version and whether a browser session is connected. Read-only; does not touch Firefox.',
  toolset: 'core',
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
    const action = requireAction(args, 'ping', ACTIONS);
    const status = ctx.session === undefined ? { connected: false } : await ctx.session.status();

    return ok(action, {
      serverVersion: ctx.version,
      connected: status.connected,
      browser: status.browser ?? null,
      uptimeMs: Math.max(0, Date.now() - ctx.startedAt),
    });
  },
});
