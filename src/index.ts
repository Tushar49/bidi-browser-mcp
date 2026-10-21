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

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { version: string };

export const VERSION = pkg.version;

/** Build the MCP server without attaching a transport. */
export function createServer(): Server {
  const server = new Server(
    { name: 'bidi-browser-mcp', version: VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => ({
    content: [
      {
        type: 'text' as const,
        text: `Unknown tool: ${request.params.name}. Tool registration lands with v1.`,
      },
    ],
    isError: true,
  }));

  return server;
}
