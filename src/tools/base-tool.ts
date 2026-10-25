import type {
  JsonSchema,
  ToolAnnotations,
  ToolDefinition,
  ToolHandler,
  Toolset,
} from '../types.js';
import { assertString } from '../utils/assert.js';
import { ActionableError } from '../utils/errors.js';

export interface DefineToolOptions {
  name: string;
  title: string;
  description: string;
  toolset: Toolset;
  actions: readonly string[];
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: ToolAnnotations;
  handler: ToolHandler;
}

/**
 * The single way to define a tool. It validates the cheap invariants once at
 * registration time so handlers can stay focused on browser work.
 */
export function defineTool(options: DefineToolOptions): ToolDefinition {
  const name = options.name.trim();
  if (name === '') {
    throw new ActionableError('INTERNAL_ERROR', 'Tool name must not be empty.');
  }
  if (options.actions.length === 0) {
    throw new ActionableError('INTERNAL_ERROR', `Tool "${name}" must declare at least one action.`);
  }

  return Object.freeze({
    ...options,
    name,
    actions: Object.freeze([...options.actions]),
  });
}

/** Parameters every tool may accept later. Kept small on purpose. */
export const COMMON_PARAMS = {
  context: {
    type: 'string',
    description: 'Optional browsing context (tab) ID. Defaults to the active tab.',
  },
  timeout: {
    type: 'number',
    description: 'Optional timeout in milliseconds. Defaults to BIDI_TIMEOUT.',
  },
} as const;

export function requireAction(
  args: Record<string, unknown>,
  toolName: string,
  actions: readonly string[]
): string {
  const action = assertString(args.action, `${toolName}.action`);
  if (!actions.includes(action)) {
    throw new ActionableError('INVALID_ACTION', `Unknown action "${action}" for ${toolName}.`, {
      fix: `Use one of: ${actions.join(', ')}.`,
    });
  }
  return action;
}

const FIREFOX_FAMILY_NAMES = ['firefox', 'zen', 'librewolf', 'waterfox', 'floorp'];

/**
 * Gate Firefox-family-only features (containers, Zen spaces). Unknown
 * browser names pass — only a confidently-Chromium name is refused.
 */
export function assertFirefoxFamily(browserName: unknown, feature: string): void {
  const name = String(browserName ?? '').toLowerCase();
  if (name === '' || FIREFOX_FAMILY_NAMES.includes(name)) {
    return;
  }
  throw new ActionableError(
    'UNSUPPORTED',
    `${feature} is a Firefox-family feature; this session reports browser "${name}".`,
    {
      fix: 'Connect to a Firefox-family browser (Firefox, Zen, LibreWolf, Waterfox, Floorp).',
    }
  );
}
