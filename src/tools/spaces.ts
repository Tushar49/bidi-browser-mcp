import type { JsonSchema, SpaceListing } from '../types.js';
import { assertFirefoxFamily, defineTool, requireAction } from './base-tool.js';
import { ActionableError } from '../utils/errors.js';
import { ok } from '../utils/result.js';
import { joinContainerNames, readContainers, readSpaces } from '../profile/profile-store.js';

const ACTIONS = ['list'] as const;

const INPUT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: [...ACTIONS],
      description: 'list: Zen spaces with their bound containers',
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

export const spacesTool = defineTool({
  name: 'spaces',
  title: 'Zen spaces',
  description:
    "List Zen spaces (workspaces) from the profile session store, including each space's bound container. Read-only; space data is read from disk, never written. The store can contain open-tab URLs and form state — only derived metadata (uuid, name, theme, container) is returned.",
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
    const action = requireAction(args, 'spaces', ACTIONS);
    const session = ctx.session;
    const runtime = session?.runtime;
    if (session === undefined || runtime === undefined) {
      throw new ActionableError('CONNECTION_FAILED', 'No live browser session.', {
        fix: 'Call browser.connect first.',
      });
    }
    assertFirefoxFamily((await session.status()).browser?.browserName, 'Zen spaces');

    const status = await session.status();
    const profilePath = status.browser?.['moz:profile'];
    if (typeof profilePath !== 'string' || profilePath === '') {
      throw new ActionableError(
        'UNSUPPORTED',
        'The browser did not report its profile path; Zen spaces cannot be read.',
        { fix: 'Use a Firefox-family browser launched with --remote-debugging-port.' }
      );
    }

    const { spaces: spaceList, warnings } = readSpaces(profilePath);
    const containers = readContainers(profilePath);
    const ids = ((await session.request('browser.getUserContexts', {})) as {
      userContexts?: { userContext?: unknown }[];
    }).userContexts
      ?.map((entry) => entry.userContext)
      .filter((id): id is string => typeof id === 'string') ?? [];
    const { names, aligned } = joinContainerNames(ids, containers);

    const spaces: SpaceListing[] = spaceList.map((space) => {
      const identity = containers.find(
        (candidate) => candidate.userContextId === space.containerId
      );
      const bidi = [...names.entries()].find(
        ([, joined]) => joined?.userContextId === space.containerId
      )?.[0];
      return {
        uuid: space.uuid,
        name: space.name,
        ...(space.themeType === undefined ? {} : { themeType: space.themeType }),
        ...(space.containerId === undefined
          ? {}
          : {
              containerId: space.containerId,
              ...(identity?.name === undefined ? {} : { containerName: identity.name }),
              ...(bidi === undefined ? {} : { containerUserContext: bidi }),
            }),
      };
    });

    return ok(
      action,
      { spaces },
      aligned
        ? warnings
        : [
            ...warnings,
            'Container names were omitted: the number of profile containers did not match the number of live user contexts.',
          ]
    );
  },
});
