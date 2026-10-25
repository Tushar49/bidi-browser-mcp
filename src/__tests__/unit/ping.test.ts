import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../config.js';
import { pingTool } from '../../tools/ping.js';
import type { ServerContext } from '../../types.js';
import { ActionableError } from '../../utils/errors.js';

const ctx: ServerContext = {
  version: '0.1.3',
  config: loadConfig({}),
  startedAt: Date.now() - 25,
};

describe('ping tool', () => {
  it('reports the server version and disconnected state', async () => {
    const result = await pingTool.handler({ action: 'status' }, ctx);
    expect(result.ok).toBe(true);
    expect(result.action).toBe('status');
    expect(result.data).toMatchObject({
      serverVersion: '0.1.3',
      connected: false,
      browser: null,
    });
    expect((result.data as { uptimeMs: number }).uptimeMs).toBeGreaterThanOrEqual(0);
  });

  it('rejects an unknown action', async () => {
    await expect(pingTool.handler({ action: 'open' }, ctx)).rejects.toBeInstanceOf(
      ActionableError
    );
  });

  it('rejects a missing action', async () => {
    await expect(pingTool.handler({}, ctx)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });
});
