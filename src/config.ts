import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { Config, OutputMode, Toolset } from './types.js';
import { ActionableError } from './utils/errors.js';

const TOOLSETS: readonly Toolset[] = ['core', 'network', 'devtools'];
const OUTPUT_MODES: readonly OutputMode[] = ['full', 'inline', 'file'];

/**
 * The only module allowed to read environment variables.
 * Pass an env object in tests; never read process.env elsewhere.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const host = readString(env, 'BIDI_HOST') ?? '127.0.0.1';
  const port = readInt(env, 'BIDI_PORT', 9222, 1, 65535);
  const timeoutMs = readInt(env, 'BIDI_TIMEOUT', 30_000, 1);
  const maxInlineLen = readInt(env, 'BIDI_MAX_INLINE_LEN', 60_000, 1);
  const toolset = readEnum(env, 'BIDI_TOOLSET', 'core', TOOLSETS);
  const outputMode = readEnum(env, 'BIDI_OUTPUT_MODE', 'full', OUTPUT_MODES);
  const wsUrl = readString(env, 'BIDI_WS_URL');
  const profileDir = readString(env, 'BIDI_PROFILE_DIR');
  const tempDir = resolve(readString(env, 'BIDI_TEMP_DIR') ?? '.temp');
  // Absolute app-data root, used by discovery on Windows so that no other
  // module ever reads process.env directly.
  const appDataRoot = resolve(
    readString(env, 'BIDI_APP_DATA_ROOT') ??
      readString(env, 'APPDATA') ??
      join(homedir(), 'AppData', 'Roaming')
  );
  const allowRemote = readBoolean(env, 'BIDI_ALLOW_REMOTE', false);
  const localAppDataRoot = resolve(
    readString(env, 'BIDI_LOCAL_APP_DATA_ROOT') ??
      readString(env, 'LOCALAPPDATA') ??
      join(homedir(), 'AppData', 'Local')
  );
  const discoveryRoots = readStringList(env, 'BIDI_DISCOVERY_ROOTS');
  const chromiumDataDirs = readStringList(env, 'BIDI_CHROMIUM_DATA_DIR');

  if (wsUrl !== undefined) {
    validateWebSocketUrl(wsUrl);
  }

  return Object.freeze({
    host,
    port,
    ...(wsUrl === undefined ? {} : { wsUrl }),
    ...(profileDir === undefined ? {} : { profileDir }),
    timeoutMs,
    toolset,
    outputMode,
    maxInlineLen,
    tempDir,
    appDataRoot,
    localAppDataRoot,
    allowExtensionInstall: readBoolean(env, 'BIDI_ALLOW_EXTENSION_INSTALL', false),
    allowBrowserClose: readBoolean(env, 'BIDI_ALLOW_BROWSER_CLOSE', false),
    allowRemote,
    discoveryRoots: Object.freeze(discoveryRoots),
    chromiumDataDirs: Object.freeze(chromiumDataDirs),
  });
}

function readString(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

function readInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
  max = Number.MAX_SAFE_INTEGER
): number {
  const raw = readString(env, key);
  if (raw === undefined) {
    return fallback;
  }

  if (!/^\d+$/.test(raw)) {
    throw invalidConfig(key, `must be an integer between ${min} and ${max}`, `got "${raw}"`);
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw invalidConfig(key, `must be an integer between ${min} and ${max}`, `got ${value}`);
  }

  return value;
}

function readStringList(env: NodeJS.ProcessEnv, key: string): string[] {
  const raw = readString(env, key);
  if (raw === undefined) {
    return [];
  }

  const values = raw
    .split(/[;,\n]/)
    .map((value) => value.trim())
    .filter((value) => value !== '');

  return values;
}

function readBoolean(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = readString(env, key)?.toLowerCase();
  if (raw === undefined) {
    return fallback;
  }

  if (['1', 'true', 'yes', 'on'].includes(raw)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(raw)) {
    return false;
  }

  throw invalidConfig(key, 'must be a boolean (1/0, true/false, yes/no, on/off)', `got "${raw}"`);
}

function readEnum<T extends string>(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: T,
  allowed: readonly T[]
): T {
  const raw = readString(env, key);
  if (raw === undefined) {
    return fallback;
  }

  if (!allowed.includes(raw as T)) {
    throw invalidConfig(key, `must be one of: ${allowed.join(', ')}`, `got "${raw}"`);
  }

  return raw as T;
}

function validateWebSocketUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw invalidConfig('BIDI_WS_URL', 'must be a valid WebSocket URL', `got "${value}"`);
  }

  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    throw invalidConfig('BIDI_WS_URL', 'must use ws:// or wss://', `got "${parsed.protocol}"`);
  }
}

function invalidConfig(key: string, expectation: string, detail: string): ActionableError {
  return new ActionableError('INVALID_CONFIG', `${key} ${expectation}; ${detail}.`, {
    fix: `Set ${key} to a valid value, or remove it to use the default.`,
  });
}
