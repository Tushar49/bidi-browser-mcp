#!/usr/bin/env node
/**
 * CLI entry point: boot the MCP server over stdio.
 * The shebang must stay on line 1 and use LF line endings.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, VERSION } from './index.js';

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`bidi-browser-mcp v${VERSION} ready (stdio)`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`bidi-browser-mcp failed to start: ${message}`);
  process.exit(1);
});
