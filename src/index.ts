#!/usr/bin/env node
/**
 * Entry point for bidi-browser-mcp.
 *
 * Wave 1 scaffold: boots a stdio MCP server with an empty tool surface.
 * Connection, session, snapshot, and tool modules land in Waves 2-6.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

export const VERSION = '0.1.0';

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

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`bidi-browser-mcp v${VERSION} ready (stdio)`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`bidi-browser-mcp failed to start: ${message}`);
  process.exit(1);
});
