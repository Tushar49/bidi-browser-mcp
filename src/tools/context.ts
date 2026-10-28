import type { ContainerInfo, JsonSchema } from '../types.js';
import { assertFirefoxFamily, defineTool, requireAction } from './base-tool.js';
import { ActionableError } from '../utils/errors.js';
import { ok } from '../utils/result.js';
import { joinContainerNames, readContainers } from '../profile/profile-store.js';

const ACTIONS = ['list', 'new', 'remove', 'tabs-in'] as const;

const INPUT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: [...ACTIONS],
      description:
        'list: containers with tab counts; new: create a container; remove: delete a container; tabs-in: tabs inside a container',
    },
    userContext: {
      type: 'string',
      description: "BiDi user context id ('default' or uuid) from context.list.",
    },
    confirm: {
      type: 'boolean',
      description:
        'Required true for context.remove. Removing a container deletes its tabs, cookies, and storage.',
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

export const contextTool = defineTool({
  name: 'context',
  title: 'Containers',
  description:
    'Firefox containers (user contexts): list with names and tab counts, create, remove, and list tabs per container. Storage isolation is enforced by the browser.',
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
    const action = requireAction(args, 'context', ACTIONS);
    const session = ctx.session;
    const runtime = session?.runtime;
    if (session === undefined || runtime === undefined) {
      throw new ActionableError('CONNECTION_FAILED', 'No live browser session.', {
        fix: 'Call browser.connect first.',
      });
    }
    assertFirefoxFamily((await session.status()).browser?.browserName, 'Containers');

    switch (action) {
      case 'list': {
        const listing = (await session.request('browser.getUserContexts', {})) as {
          userContexts?: { userContext?: unknown }[];
        };
        const ids =
          listing.userContexts
            ?.map((entry) => entry.userContext)
            .filter((id): id is string => typeof id === 'string') ?? [];

        const tree = await session.request('browsingContext.getTree', { maxDepth: 1 });
        const counts = new Map<string, number>();
        for (const entry of ((tree.contexts as { userContext?: unknown }[] | undefined) ?? [])) {
          const id = typeof entry.userContext === 'string' ? entry.userContext : 'default';
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }

        const status = await session.status();
        const profilePath = status.browser?.['moz:profile'];
        const containers =
          typeof profilePath === 'string' ? readContainers(profilePath) : [];

        const { names, aligned } = joinContainerNames(ids, containers);
        const containersOut: ContainerInfo[] = ids.map((id) => {
          const identity = names.get(id);
          const tabCount = counts.get(id) ?? 0;
          return {
            userContext: id,
            ...(identity === undefined
              ? {}
              : {
                  name: identity.name ?? `Container ${identity.userContextId}`,
                  nameSource: 'positional',
                  profileUserContextId: identity.userContextId,
                  ...(identity.icon === undefined ? {} : { icon: identity.icon }),
                  ...(identity.color === undefined ? {} : { color: identity.color }),
                }),
            tabCount,
          };
        });
        return ok(
          action,
          { containers: containersOut },
          aligned
            ? undefined
            : [
                'Container names were omitted: Firefox exposes no id bridge, and the number of profile containers did not match the number of live user contexts.',
              ]
        );
      }

      case 'new': {
        const created = (await session.request('browser.createUserContext', {})) as {
          userContext?: unknown;
        };
        if (typeof created.userContext !== 'string') {
          throw new ActionableError('SESSION_FAILED', 'The browser did not return a container id.');
        }
        return ok(action, { userContext: created.userContext });
      }

      case 'remove': {
        const userContext = typeof args.userContext === 'string' ? args.userContext : undefined;
        if (userContext === undefined || userContext === '') {
          throw new ActionableError('INVALID_ARGUMENT', 'context.remove requires userContext.', {
            fix: 'Pass the id from context.list.',
          });
        }
        if (userContext === 'default') {
          throw new ActionableError('INVALID_ARGUMENT', 'The default container cannot be removed.');
        }
        if (args.confirm !== true) {
          throw new ActionableError(
            'INVALID_ARGUMENT',
            'context.remove needs confirm: true — it deletes the container with its tabs, cookies, and storage.',
            {
              fix: 'Call context.remove again with { userContext, confirm: true }.',
            }
          );
        }
        await session.request('browser.removeUserContext', { userContext });
        return ok(action, { removed: userContext });
      }

      case 'tabs-in': {
        // Tab-in-container queries usually mean the default container, so a
        // missing id defaults there instead of failing (Wave 0 small fix).
        const raw = typeof args.userContext === 'string' ? args.userContext.trim() : '';
        const userContext = raw === '' ? 'default' : raw;
        const tree = await session.request('browsingContext.getTree', { maxDepth: 1 });
        const tabs = ((tree.contexts as { context?: unknown; url?: unknown; userContext?: unknown }[] | undefined) ?? [])
          .filter((entry) => entry.userContext === userContext)
          .map((entry) => ({
            context: entry.context,
            url: entry.url,
          }));
        return ok(action, { userContext, tabs });
      }

      default:
        throw new ActionableError('INVALID_ACTION', `Unknown context action: ${action}.`);
    }
  },
});
