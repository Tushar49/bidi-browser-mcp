import type { ActionableErrorCode, ActionableErrorShape } from '../types.js';

export interface ActionableErrorOptions {
  fix?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}

/**
 * An error with a stable code and a concrete fix. Every user-facing failure
 * should be one of these; raw errors are converted at the boundary.
 */
export class ActionableError extends Error {
  readonly code: ActionableErrorCode;
  readonly fix?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ActionableErrorCode,
    message: string,
    options: ActionableErrorOptions = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ActionableError';
    this.code = code;
    this.fix = options.fix;
    this.details = options.details;
  }

  toJSON(): ActionableErrorShape {
    return {
      code: this.code,
      message: this.message,
      ...(this.fix === undefined ? {} : { fix: this.fix }),
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

export function toActionableError(error: unknown): ActionableError {
  if (error instanceof ActionableError) {
    return error;
  }

  if (error instanceof Error) {
    return new ActionableError('INTERNAL_ERROR', error.message, {
      fix: 'Check the server log, then retry. If it persists, report the error with the action and input.',
      cause: error,
    });
  }

  return new ActionableError('INTERNAL_ERROR', String(error), {
    fix: 'Check the server log, then retry. If it persists, report the error with the action and input.',
  });
}

export function formatError(error: unknown): string {
  const actionable = toActionableError(error);
  return actionable.fix === undefined
    ? `${actionable.code}: ${actionable.message}`
    : `${actionable.code}: ${actionable.message}\nFix: ${actionable.fix}`;
}

const CONTEXT_NOT_FOUND_PATTERN = /no such context|unknown context|invalid context/i;

/**
 * Turn the browser's "no such context" rejection into CONTEXT_NOT_FOUND, so
 * callers get the documented code instead of a raw BiDi message.
 */
export function toContextError(error: unknown): ActionableError {
  if (
    error instanceof ActionableError &&
    CONTEXT_NOT_FOUND_PATTERN.test(error.message)
  ) {
    return new ActionableError('CONTEXT_NOT_FOUND', error.message, {
      fix: 'Call tabs.list to see open contexts.',
      cause: error,
    });
  }
  return toActionableError(error);
}
