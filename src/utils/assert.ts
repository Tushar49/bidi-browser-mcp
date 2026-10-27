import { ActionableError } from './errors.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function assertRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ActionableError('INVALID_ARGUMENT', `${name} must be an object.`, {
      fix: `Pass ${name} as a JSON object.`,
    });
  }
  return value;
}

export function assertString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ActionableError('INVALID_ARGUMENT', `${name} must be a non-empty string.`, {
      fix: `Pass ${name} as a string.`,
    });
  }
  return value;
}

export function assertEnum<T extends string>(
  value: unknown,
  name: string,
  allowed: readonly T[]
): T {
  const text = assertString(value, name);
  if (!allowed.includes(text as T)) {
    throw new ActionableError('INVALID_ARGUMENT', `${name} has an unknown value "${text}".`, {
      fix: `Use one of: ${allowed.join(', ')}.`,
    });
  }
  return text as T;
}

export function assertBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ActionableError('INVALID_ARGUMENT', `${name} must be a boolean.`, {
      fix: `Pass ${name} as true or false.`,
    });
  }
  return value;
}

export function assertPositiveInt(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new ActionableError('INVALID_ARGUMENT', `${name} must be a positive integer.`, {
      fix: `Pass ${name} as a whole number greater than zero.`,
    });
  }
  return value as number;
}

/** Schemes a tool may open. Local and inline schemes are read paths. */
const NAVIGABLE_PROTOCOLS = ['http:', 'https:'];

/**
 * Guard a URL a tool is asked to open. `file:`, `data:`, `javascript:`, and
 * `blob:` turn the browser into a local-file or script reader, so only
 * http(s) and about:blank are allowed.
 */
export function assertNavigableUrl(value: unknown, name: string): string {
  const text = assertString(value, name);
  if (text === 'about:blank') {
    return text;
  }

  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new ActionableError('INVALID_ARGUMENT', `${name} must be an absolute URL.`, {
      fix: 'Pass a full URL such as https://example.com.',
    });
  }

  if (!NAVIGABLE_PROTOCOLS.includes(parsed.protocol)) {
    throw new ActionableError(
      'INVALID_ARGUMENT',
      `${name} uses the blocked scheme "${parsed.protocol}".`,
      {
        fix: 'Only http:, https:, and about:blank can be opened. file:, data:, javascript:, and blob: can read local data.',
      }
    );
  }

  return text;
}
