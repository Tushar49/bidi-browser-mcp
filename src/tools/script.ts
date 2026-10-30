import type { JsonSchema } from '../types.js';
import { COMMON_PARAMS, defineTool, requireAction } from './base-tool.js';
import { ActionableError, toContextError } from '../utils/errors.js';
import { unwrapBiDiValue } from '../utils/bidi-value.js';
import { ok } from '../utils/result.js';

const ACTIONS = ['evaluate', 'waitFor'] as const;

const INPUT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: [...ACTIONS],
      description:
        'evaluate: run a JS expression on the page (credential-unsafe, gated by BIDI_ALLOW_SCRIPT_EVAL); waitFor: poll an expression until it is truthy (safe default)',
    },
    expression: {
      type: 'string',
      description:
        'JavaScript source. evaluate: an expression; waitFor: a condition that returns a truthy value.',
    },
    context: COMMON_PARAMS.context,
    timeout: {
      type: 'number',
      description: 'waitFor deadline in milliseconds. Default 10000, capped at 120000.',
    },
  },
  required: ['action', 'expression'],
  additionalProperties: false,
};

const OUTPUT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    action: { type: 'string' },
    data: { type: ['object', 'null'] },
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        fix: { type: 'string' },
        details: { type: 'object' },
      },
      required: ['code', 'message'],
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'action'],
  additionalProperties: false,
};

/** waitFor polls with short per-call scripts (decisions §5). */
const WAIT_POLL_INTERVAL_MS = 250;
const WAIT_MAX_MS = 120_000;

function wrapCondition(expression: string): string {
  // A syntax error in the condition surfaces on the first call, not silently
  // as "never true".
  return `() => { try { return (${expression}); } catch (e) { return { __error: String(e && e.message) }; } }`;
}

export const scriptTool = defineTool({
  name: 'script',
  title: 'Script',
  description:
    'Run JavaScript in the page: evaluate (gated, credential-unsafe) or waitFor (safe polling wait). Tool-internal scripts used by other tools need no flag.',
  toolset: 'core',
  actions: ACTIONS,
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  annotations: {
    readOnlyHint: true,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: async (args, ctx) => {
    const action = requireAction(args, 'script', ACTIONS);
    const session = ctx.session;
    const runtime = session?.runtime;
    if (session === undefined || runtime === undefined) {
      throw new ActionableError('CONNECTION_FAILED', 'No live browser session.', {
        fix: 'Call browser.connect first.',
      });
    }

    const expression = typeof args.expression === 'string' ? args.expression : undefined;
    if (expression === undefined || expression.trim() === '') {
      throw new ActionableError('INVALID_ARGUMENT', `script.${action} requires expression.`, {
        fix: 'Pass the JavaScript source as expression.',
      });
    }

    if (action === 'evaluate' && !ctx.config.allowScriptEval) {
      // The tool stays visible (decisions §2): the agent can discover it and
      // the error names the exact flag to ask for.
      throw new ActionableError(
        'UNSUPPORTED',
        'script.evaluate is gated by BIDI_ALLOW_SCRIPT_EVAL: it can read credentials and needs explicit opt-in.',
        {
          fix: 'Set BIDI_ALLOW_SCRIPT_EVAL=1 in the server environment and reconnect. Use script.waitFor for condition waits.',
        }
      );
    }

    const context = await runtime.contexts.ensureContext(
      typeof args.context === 'string' ? args.context : undefined
    );

    if (action === 'evaluate') {
      const result = await session.request('script.evaluate', {
        expression,
        awaitPromise: true,
        target: { context },
      });
      const value = unwrapBiDiValue(result.result);
      return ok(action, { context, value });
    }

    // waitFor: poll the condition with short calls so no single command
    // outlives the client timeout (decisions §5).
    const deadline =
      typeof args.timeout === 'number' && args.timeout > 0
        ? Math.min(args.timeout, WAIT_MAX_MS)
        : 10_000;
    const started = Date.now();
    let last: unknown = null;
    for (;;) {
      let result: Record<string, unknown>;
      try {
        result = await session.request('script.callFunction', {
          functionDeclaration: wrapCondition(expression),
          awaitPromise: true,
          target: { context },
        });
      } catch (error) {
        // A condition that cannot even run (syntax error) is permanent —
        // surface it instead of polling a falsy deadline.
        const cause = toContextError(error);
        throw new ActionableError(
          'SCRIPT_ERROR',
          `script.waitFor condition failed to run: ${cause.message}`,
          {
            fix: 'Fix the expression; it must be valid JavaScript in the page context.',
            cause,
            details: { method: 'script.callFunction', ...(cause.details ?? {}) },
          }
        );
      }
      const raw = result.result;
      if (raw === undefined) {
        // A broken functionDeclaration (syntax error) resolves with no result
        // at all — permanent, so surface it instead of polling a deadline.
        throw new ActionableError(
          'SCRIPT_ERROR',
          'script.waitFor condition failed to run (the browser returned no result).',
          {
            fix: 'Fix the expression; it must be valid JavaScript in the page context.',
          }
        );
      }
      if (raw !== null && typeof raw === 'object' && (raw as Record<string, unknown>).type === 'exception') {
        const details = (raw as Record<string, unknown>).exceptionDetails as
          | Record<string, unknown>
          | undefined;
        const exception = details?.exception as Record<string, unknown> | undefined;
        const text = exception?.value ?? details?.text ?? 'condition threw';
        throw new ActionableError('SCRIPT_ERROR', `script.waitFor condition threw: ${String(text)}`, {
          fix: 'Fix the expression; it must be valid JavaScript in the page context.',
        });
      }
      const value = unwrapBiDiValue(raw);
      if (value !== null && typeof value === 'object' && '__error' in value) {
        throw new ActionableError('SCRIPT_ERROR', `script.waitFor condition threw: ${String(value.__error)}`, {
          fix: 'Fix the expression; it must be valid JavaScript in the page context.',
        });
      }
      if (value === undefined || value === null || value === false) {
        last = value;
      } else {
        return ok(action, { context, value, waitedMs: Date.now() - started });
      }
      if (Date.now() - started >= deadline) {
        throw new ActionableError('TIMEOUT', `script.waitFor condition stayed falsy for ${deadline}ms.`, {
          fix: 'Raise timeout, or check the expression against the page state.',
          details: { last, waitedMs: Date.now() - started },
        });
      }
      await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_INTERVAL_MS));
    }
  },
});

