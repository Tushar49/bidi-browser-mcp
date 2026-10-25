import type { JsonSchema } from '../types.js';
import { COMMON_PARAMS, defineTool, requireAction } from './base-tool.js';
import { ActionableError, toContextError } from '../utils/errors.js';
import { assertNavigableUrl } from '../utils/assert.js';
import { ok } from '../utils/result.js';

const ACTIONS = ['list', 'new', 'activate', 'close', 'info', 'select'] as const;

const INPUT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: [...ACTIONS],
      description:
        'list: open tabs; new: open a tab; activate: focus a tab; close: close a tab; info: one tab; select: choose the default tab',
    },
    context: COMMON_PARAMS.context,
    url: {
      type: 'string',
      description:
        'URL for tabs.new. Only http:, https:, and about:blank are allowed. Default about:blank.',
    },
    userContext: {
      type: 'string',
      description: "Container id for tabs.new ('default' or uuid from context.list).",
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

export const tabsTool = defineTool({
  name: 'tabs',
  title: 'Tabs',
  description:
    'List, open, focus, close, and pick tabs. Closing is per-tab; this tool never closes the browser.',
  toolset: 'core',
  actions: ACTIONS,
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: async (args, ctx) => {
    const action = requireAction(args, 'tabs', ACTIONS);
    const session = ctx.session;
    const runtime = session?.runtime;
    if (session === undefined || runtime === undefined) {
      throw new ActionableError('CONNECTION_FAILED', 'No live browser session.', {
        fix: 'Call browser.connect first.',
      });
    }
    const { contexts } = runtime;

    switch (action) {
      case 'list':
        return ok(action, { tabs: await contexts.list() });

      case 'new': {
        const url =
          args.url === undefined
            ? 'about:blank'
            : assertNavigableUrl(args.url, 'tabs.new url');
        const params: Record<string, unknown> = { type: 'tab', url };
        if (typeof args.userContext === 'string' && args.userContext !== '') {
          params.userContext = args.userContext;
        }
        const created = (await session.request('browsingContext.create', params)) as {
          context?: unknown;
          url?: unknown;
          userContext?: unknown;
        };
        if (typeof created.context !== 'string') {
          throw new ActionableError('SESSION_FAILED', 'The browser did not return a new tab.');
        }
        const tab = await contexts.select(created.context);
        return ok(action, {
          tab,
          url: created.url ?? url,
          ...(typeof created.userContext === 'string' ? { userContext: created.userContext } : {}),
        });
      }

      case 'activate': {
        const context = typeof args.context === 'string' ? args.context : undefined;
        if (context === undefined) {
          throw new ActionableError('INVALID_ARGUMENT', 'tabs.activate requires context.', {
            fix: 'Pass the tab ID from tabs.list.',
          });
        }
        try {
          await session.request('browsingContext.activate', { context });
        } catch (error) {
          throw toContextError(error);
        }
        return ok(action, { tab: await contexts.select(context) });
      }

      case 'close': {
        const context = typeof args.context === 'string' ? args.context : undefined;
        if (context === undefined) {
          throw new ActionableError('INVALID_ARGUMENT', 'tabs.close requires context.', {
            fix: 'Pass the tab ID from tabs.list.',
          });
        }
        try {
          await session.request('browsingContext.close', { context });
        } catch (error) {
          throw toContextError(error);
        }
        contexts.forget(context);
        return ok(action, { closed: context });
      }

      case 'info': {
        const context = typeof args.context === 'string' ? args.context : undefined;
        if (context === undefined) {
          throw new ActionableError('INVALID_ARGUMENT', 'tabs.info requires context.', {
            fix: 'Pass the tab ID from tabs.list.',
          });
        }
        const tabs = await contexts.list();
        const tab = tabs.find((candidate) => candidate.context === context);
        if (tab === undefined) {
          throw new ActionableError('TAB_NOT_FOUND', `Unknown context: ${context}.`, {
            fix: 'Call tabs.list to see open contexts.',
          });
        }
        return ok(action, { tab });
      }

      case 'select': {
        const context = typeof args.context === 'string' ? args.context : undefined;
        if (context === undefined) {
          throw new ActionableError('INVALID_ARGUMENT', 'tabs.select requires context.', {
            fix: 'Pass the tab ID from tabs.list.',
          });
        }
        return ok(action, { tab: await contexts.select(context) });
      }

      default:
        throw new ActionableError('INVALID_ACTION', `Unknown tabs action: ${action}.`);
    }
  },
});
