import { describe, expect, it } from 'vitest';
import { ActionableError } from '../../utils/errors.js';
import { fail, ok, toToolResult } from '../../utils/result.js';

describe('result helpers', () => {
  it('builds a success result and an MCP payload', () => {
    const result = ok('status', { connected: false });
    expect(result).toEqual({ ok: true, action: 'status', data: { connected: false } });

    const mcp = toToolResult(result, 10_000, 'full');
    expect(mcp.isError).toBe(false);
    expect(mcp.structuredContent).toEqual(result);
    const block = mcp.content[0];
    expect(block).toMatchObject({ type: 'text' });
    expect(JSON.parse(block.type === 'text' ? block.text : '')).toEqual(result);
  });

  it('converts errors into an actionable failure', () => {
    const result = fail(
      'status',
      new ActionableError('SESSION_BUSY', 'Session already active.', {
        fix: 'Close the other client.',
      })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: 'SESSION_BUSY',
      message: 'Session already active.',
      fix: 'Close the other client.',
    });

    const mcp = toToolResult(result, 10_000, 'full');
    expect(mcp.isError).toBe(true);
  });

  it('truncates oversized text without changing structured data', () => {
    const result = ok('status', { text: 'x'.repeat(100) });
    const mcp = toToolResult(result, 50, 'inline');
    const block = mcp.content[0];
    const text = block.type === 'text' ? block.text : '';
    expect(text.length).toBeLessThan(120);
    expect(text).toContain('[truncated');
    expect(mcp.structuredContent).toEqual(result);
  });
});
