#!/usr/bin/env node
/**
 * CLI entry point: boot the MCP server over stdio.
 * The shebang must stay on line 1 and use LF line endings.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, VERSION } from './index.js';

async function main(): Promise<void> {
  const { server, session } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`bidi-browser-mcp v${VERSION} ready (stdio)`);

  // The browser's BiDi session must never outlive this process: end it when
  // the client closes stdio or sends a termination signal. (SIGKILL cannot be
  // handled anywhere.)
  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    void session
      .disconnect()
      .catch(() => {})
      .finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.once('SIGHUP', shutdown);
  process.stdin.once('close', shutdown);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`bidi-browser-mcp failed to start: ${message}`);
  process.exit(1);
});
