/**
 * Public entry point for bidi-browser-mcp.
 *
 * Importing this module must not start anything. The CLI entry is
 * `src/bin.ts`, which calls `createServer()` and connects stdio.
 */

import { readFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from './config.js';
import { browserTool } from './tools/browser.js';
import { cleanupTool } from './tools/cleanup.js';
import { consoleTool } from './tools/console.js';
import { contextTool } from './tools/context.js';
import { observeTool } from './tools/observe.js';
import { pageTool } from './tools/page.js';
import { spacesTool } from './tools/spaces.js';
import { pingTool } from './tools/ping.js';
import { tabsTool } from './tools/tabs.js';
import { ToolRegistry } from './tools/registry.js';
import { SessionManager } from './session/session-manager.js';
import type { Config, ServerContext } from './types.js';
import { ActionableError } from './utils/errors.js';
import { toToolResult } from './utils/result.js';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { version: string };

export const VERSION = pkg.version;

export interface CreateServerOptions {
  /** Override config in tests. Production reads env through loadConfig(). */
  config?: Config;
}

/** Build the MCP server without attaching a transport. */
export function createServer(options: CreateServerOptions = {}): {
  server: Server;
  session: SessionManager;
} {
  const config = options.config ?? loadConfig();
  if (config.outputMode === 'file') {
    throw new ActionableError(
      'INVALID_CONFIG',
      'BIDI_OUTPUT_MODE=file is not implemented yet.',
      { fix: 'Use BIDI_OUTPUT_MODE=full or BIDI_OUTPUT_MODE=inline.' }
    );
  }
  const session = new SessionManager({ config, serverVersion: VERSION });
  const ctx: ServerContext = {
    version: VERSION,
    config,
    startedAt: Date.now(),
    session,
  };

  const registry = new ToolRegistry();
  registry.register(pingTool);
  registry.register(browserTool);
  registry.register(tabsTool);
  registry.register(consoleTool);
  registry.register(observeTool);
  registry.register(cleanupTool);
  registry.register(pageTool);
  registry.register(contextTool);
  registry.register(spacesTool);

  const server = new Server(
    { name: 'bidi-browser-mcp', version: VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registry.toolsFor(config.toolset).map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
      ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await registry.dispatch(
      request.params.name,
      request.params.arguments ?? {},
      ctx
    );
    return toToolResult(result, config.maxInlineLen, config.outputMode);
  });

  return { server, session };
}
