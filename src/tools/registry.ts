import type { ServerContext, ToolDefinition, ToolResult, Toolset } from '../types.js';
import { ActionableError } from '../utils/errors.js';
import { fail } from '../utils/result.js';

/**
 * Per-server tool registry. No global singleton: a registry belongs to one
 * MCP server instance and is injected into handlers through ServerContext.
 */
export class ToolRegistry {
  readonly #tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): this {
    if (this.#tools.has(tool.name)) {
      throw new ActionableError(
        'INTERNAL_ERROR',
        `Duplicate tool registration: ${tool.name}.`,
        { fix: 'Give each tool a unique name.' }
      );
    }
    this.#tools.set(tool.name, tool);
    return this;
  }

  get(name: string): ToolDefinition | undefined {
    return this.#tools.get(name);
  }

  /** core is always visible; network adds network; devtools adds everything. */
  toolsFor(toolset: Toolset): ToolDefinition[] {
    return [...this.#tools.values()].filter((tool) => isVisible(tool.toolset, toolset));
  }

  async dispatch(
    name: string,
    args: Record<string, unknown>,
    ctx: ServerContext
  ): Promise<ToolResult> {
    const tool = this.get(name);
    if (tool === undefined || !isVisible(tool.toolset, ctx.config.toolset)) {
      return fail(
        name,
        new ActionableError('TOOL_NOT_FOUND', `Unknown tool: ${name}.`, {
          fix: 'Call tools/list to see the available tools for this server.',
        })
      );
    }

    try {
      return await tool.handler(args, ctx);
    } catch (error) {
      return fail(name, error);
    }
  }
}

function isVisible(toolToolset: Toolset, selected: Toolset): boolean {
  if (selected === 'devtools') {
    return true;
  }
  if (selected === 'network') {
    return toolToolset === 'core' || toolToolset === 'network';
  }
  return toolToolset === 'core';
}
