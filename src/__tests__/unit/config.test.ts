import { describe, expect, it } from 'vitest';
import { basename } from 'node:path';
import { loadConfig } from '../../config.js';
import { createServer } from '../../index.js';
import { ActionableError } from '../../utils/errors.js';

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error('Expected ActionableError, but no error was thrown.');
  } catch (error) {
    expect(error).toBeInstanceOf(ActionableError);
    expect((error as ActionableError).code).toBe(code);
  }
}

describe('loadConfig', () => {
  it('applies safe defaults', () => {
    const config = loadConfig({});
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(9222);
    expect(config.timeoutMs).toBe(30_000);
    expect(config.toolset).toBe('core');
    expect(config.outputMode).toBe('full');
    expect(config.maxInlineLen).toBe(60_000);
    expect(basename(config.tempDir)).toBe('.temp');
    expect(config.allowExtensionInstall).toBe(false);
    expect(config.allowBrowserClose).toBe(false);
    expect(config.wsUrl).toBeUndefined();
  });

  it('reads overrides', () => {
    const config = loadConfig({
      BIDI_HOST: 'localhost',
      BIDI_PORT: '9333',
      BIDI_TIMEOUT: '5000',
      BIDI_TOOLSET: 'network',
      BIDI_OUTPUT_MODE: 'file',
      BIDI_MAX_INLINE_LEN: '1200',
      BIDI_PROFILE_DIR: 'C:/profiles/dev',
      BIDI_WS_URL: 'ws://127.0.0.1:9333/session',
      BIDI_ALLOW_EXTENSION_INSTALL: 'yes',
      BIDI_ALLOW_BROWSER_CLOSE: '1',
    });
    expect(config.host).toBe('localhost');
    expect(config.port).toBe(9333);
    expect(config.timeoutMs).toBe(5000);
    expect(config.toolset).toBe('network');
    expect(config.outputMode).toBe('file');
    expect(config.maxInlineLen).toBe(1200);
    expect(config.profileDir).toBe('C:/profiles/dev');
    expect(config.wsUrl).toBe('ws://127.0.0.1:9333/session');
    expect(config.allowExtensionInstall).toBe(true);
    expect(config.allowBrowserClose).toBe(true);
  });

  it('rejects the unimplemented file output mode at startup', () => {
    // BIDI_OUTPUT_MODE=file is parsed but not implemented — fail loudly at
    // startup instead of silently behaving like another mode.
    const config = loadConfig({ BIDI_OUTPUT_MODE: 'file' });
    expectCode(() => createServer({ config }), 'INVALID_CONFIG');
  });

  it('rejects invalid integers, enums, booleans, and URLs', () => {
    expectCode(() => loadConfig({ BIDI_PORT: '0' }), 'INVALID_CONFIG');
    expectCode(() => loadConfig({ BIDI_PORT: 'abc' }), 'INVALID_CONFIG');
    expectCode(() => loadConfig({ BIDI_TIMEOUT: '-1' }), 'INVALID_CONFIG');
    expectCode(() => loadConfig({ BIDI_TOOLSET: 'all' }), 'INVALID_CONFIG');
    expectCode(() => loadConfig({ BIDI_OUTPUT_MODE: 'json' }), 'INVALID_CONFIG');
    expectCode(() => loadConfig({ BIDI_ALLOW_BROWSER_CLOSE: 'maybe' }), 'INVALID_CONFIG');
    expectCode(() => loadConfig({ BIDI_WS_URL: 'http://127.0.0.1:9222' }), 'INVALID_CONFIG');
    expectCode(() => loadConfig({ BIDI_WS_URL: 'not a url' }), 'INVALID_CONFIG');
  });
});
