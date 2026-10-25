import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { OutputMode, ToolResult } from '../types.js';
import { toActionableError } from './errors.js';

export function ok(action: string, data?: unknown, warnings?: readonly string[]): ToolResult {
  return {
    ok: true,
    action,
    ...(data === undefined ? {} : { data }),
    ...(warnings === undefined || warnings.length === 0 ? {} : { warnings: [...warnings] }),
  };
}

export function fail(action: string, error: unknown): ToolResult {
  return {
    ok: false,
    action,
    error: toActionableError(error).toJSON(),
  };
}

/**
 * Convert the internal result into an MCP tool result.
 * Text is the compatibility path; structuredContent is the typed path.
 * `full` output mode keeps the text whole; `inline` truncates it.
 *
 * `outputMode` is required on purpose: the server-wide default lives in
 * `config.ts`, and a silent fallback here would truncate differently from
 * production.
 */
export function toToolResult(
  result: ToolResult,
  maxInlineLen: number,
  outputMode: OutputMode
): CallToolResult {
  const json = JSON.stringify(result);
  const text =
    outputMode === 'full' || json.length <= maxInlineLen
      ? json
      : `${json.slice(0, maxInlineLen)}\n... [truncated ${json.length - maxInlineLen} chars]`;

  return {
    content: [{ type: 'text', text }],
    structuredContent: result as unknown as Record<string, unknown>,
    isError: !result.ok,
  };
}
