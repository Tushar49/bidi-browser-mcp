import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../config.js';
import { defineTool } from '../../tools/base-tool.js';
import { ToolRegistry } from '../../tools/registry.js';
import type { ServerContext, Toolset } from '../../types.js';
import { ActionableError } from '../../utils/errors.js';
import { ok } from '../../utils/result.js';

const ctx: ServerContext = {
  version: '0.1.3',
  config: loadConfig({}),
  startedAt: Date.now(),
};

function demo(name: string, toolset: Toolset) {
  return defineTool({
    name,
    title: name,
    description: `${name} fixture`,
    toolset,
    actions: ['run'],
    inputSchema: { type: 'object' },
    handler: async () => ok('run', { name }),
  });
}

describe('ToolRegistry', () => {
  it('registers, lists, and filters by toolset', () => {
    const registry = new ToolRegistry();
    registry.register(demo('core-tool', 'core'));
    registry.register(demo('network-tool', 'network'));
    registry.register(demo('devtools-tool', 'devtools'));

    expect(registry.toolsFor('core').map((tool) => tool.name)).toEqual(['core-tool']);
    expect(registry.toolsFor('network').map((tool) => tool.name)).toEqual([
      'core-tool',
      'network-tool',
    ]);
    expect(registry.toolsFor('devtools').map((tool) => tool.name)).toEqual([
      'core-tool',
      'network-tool',
      'devtools-tool',
    ]);
  });

  it('rejects duplicate tool names', () => {
    const registry = new ToolRegistry();
    registry.register(demo('duplicate', 'core'));
    expect(() => registry.register(demo('duplicate', 'core'))).toThrowError(ActionableError);
  });

  it('dispatches known tools and converts unknown or thrown errors', async () => {
    const registry = new ToolRegistry();
    registry.register(demo('demo', 'core'));

    const success = await registry.dispatch('demo', { action: 'run' }, ctx);
    expect(success).toEqual({ ok: true, action: 'run', data: { name: 'demo' } });

    const missing = await registry.dispatch('missing', {}, ctx);
    expect(missing.ok).toBe(false);
    expect(missing.error?.code).toBe('TOOL_NOT_FOUND');

    registry.register(
      defineTool({
        name: 'boom',
        title: 'Boom',
        description: 'throws',
        toolset: 'core',
        actions: ['run'],
        inputSchema: { type: 'object' },
        handler: async () => {
          throw new ActionableError('SCRIPT_ERROR', 'boom');
        },
      })
    );
    const thrown = await registry.dispatch('boom', {}, ctx);
    expect(thrown.ok).toBe(false);
    expect(thrown.error?.code).toBe('SCRIPT_ERROR');
  });

  it('does not dispatch a tool hidden by the selected toolset', async () => {
    const registry = new ToolRegistry();
    registry.register(demo('network-tool', 'network'));

    const result = await registry.dispatch('network-tool', { action: 'run' }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('TOOL_NOT_FOUND');
  });
});
