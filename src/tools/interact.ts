import type { ElementInfo, JsonSchema, ServerContext } from '../types.js';
import { COMMON_PARAMS, defineTool, requireAction } from './base-tool.js';
import { ActionableError } from '../utils/errors.js';
import { unwrapBiDiValue } from '../utils/bidi-value.js';
import { elementScriptSource } from '../snapshot/element-script.js';
import { resolveElement, resolvePlan } from '../snapshot/element-resolver.js';
import { ok } from '../utils/result.js';

type Session = NonNullable<ServerContext['session']>;
type ElementPlan = ReturnType<typeof resolvePlan>;

const ACTIONS = [
  'click',
  'type',
  'clear',
  'press',
  'check',
  'select',
  'scroll',
  'upload',
] as const;

const INPUT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: [...ACTIONS],
      description:
        'click: click; type: type text; clear: clear a field; press: one key; check: toggle checkbox/radio; select: pick an option; scroll: scroll element/page; upload: set files on a file input',
    },
    uid: {
      type: 'string',
      description:
        'Element uid from page.snapshot (never a raw CSS selector). Optional only for scroll without an element and for press into the focused element.',
    },
    value: {
      type: 'string',
      description: 'Text for type, key name for press (e.g. Enter), or comma-separated file paths for upload.',
    },
    option: {
      type: 'string',
      description: 'Option value, label, or index for select.',
    },
    checked: {
      type: 'boolean',
      description: 'Desired state for check (omitted means toggle).',
    },
    direction: {
      type: 'string',
      enum: ['up', 'down'],
      description: 'Scroll direction when scrolling the page instead of an element.',
    },
    context: COMMON_PARAMS.context,
    timeout: COMMON_PARAMS.timeout,
  },
  required: ['action'],
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

/**
 * Probe for a click (decisions §4/§5): scroll in, measure, hit-test the
 * element center, and describe whatever covers it. The coverer name drives
 * NOT_INTERACTABLE; iframe/shadow crossings get boundary-specific fix text.
 */
const CLICK_PROBE_BODY = `(el, args, doc) => {
  el.scrollIntoView({ block: 'nearest' });
  const r = el.getBoundingClientRect();
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  let hit = null;
  try { hit = doc.elementFromPoint(cx, cy); } catch (e) { hit = null; }
  const chainHas = (target) => {
    for (let n = el; n; n = n.parentNode || n.host || null) { if (n === target) return true; }
    return false;
  };
  const inside = hit !== null && (chainHas(hit) || (el.contains ? el.contains(hit) : false));
  let crossing = null;
  if (hit !== null && !inside) {
    const tag = String(hit.tagName || '').toLowerCase();
    if (tag === 'iframe' || tag === 'frame' || tag === 'embed' || tag === 'object') {
      crossing = 'iframe';
    } else {
      const rootOf = (node) => (node && node.getRootNode ? node.getRootNode() : doc);
      crossing = rootOf(hit) === rootOf(el) ? null : 'shadow';
    }
  }
  let coverer = null;
  if (hit !== null && !inside) {
    const id = hit.id ? '#' + hit.id : '';
    const classes = String(hit.className || '').trim().split(/\\s+/).filter(Boolean).map((c) => '.' + c).join('');
    coverer = String(hit.tagName || '?').toLowerCase() + id + classes;
  }
  return { rect: [r.x, r.y, r.width, r.height], coverer: coverer, crossing: crossing, hasHit: hit !== null };
}`;

const FOCUS_BODY = `(el) => {
  el.focus();
  // Typing appends at the caret; focus alone may land at position 0, so move
  // the caret to the end for predictable appends.
  if (el.setSelectionRange) { const n = (el.value ?? '').length; el.setSelectionRange(n, n); }
}`;

/** clear: the click comes first; this only re-anchors the selection. */
const SELECT_ALL_BODY = '(el) => { el.focus(); if (el.select) el.select(); }';

const READ_VALUE_BODY = `(el) => ({ value: 'value' in el && el.value !== undefined ? String(el.value) : String(el.textContent || '') })`;

const READ_CHECKED_BODY = `(el) => ({ checked: 'checked' in el ? Boolean(el.checked) : null })`;

const SCROLL_ELEMENT_BODY = `(el, args, doc) => {
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const view = doc.defaultView;
  return { x: view ? view.scrollX : 0, y: view ? view.scrollY : 0 };
}`;

/** select: exact value, then label, then numeric index (decisions §5). */
const SELECT_BODY = `(el, args) => {
  if (!el.options) return null;
  const list = [...el.options];
  let found = list.find((o) => o.value === args.option);
  if (!found) found = list.find((o) => o.text === args.option);
  if (!found && /^[0-9]+$/.test(args.option)) found = list[Number(args.option)];
  if (!found) return { missing: list.length };
  el.value = found.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { selected: found.value, label: found.text };
}`;

const RETURN_ELEMENT_BODY = '(el) => el';

/**
 * BiDi key actions take a single code point — Firefox rejects named keys —
 * so names map to the WebDriver private-use code points here (§5). The
 * Chromium mapper normalizes names itself; Firefox is the reference family.
 */
const KEY_CODEPOINTS: Record<string, string> = {
  Unidentified: '\uE000',
  Cancel: '\uE001',
  Help: '\uE002',
  Backspace: '\uE003',
  Tab: '\uE004',
  Clear: '\uE005',
  Return: '\uE006',
  Enter: '\uE007',
  Shift: '\uE008',
  Control: '\uE009',
  Alt: '\uE00A',
  Pause: '\uE00B',
  Escape: '\uE00C',
  Space: ' ',
  PageUp: '\uE00E',
  PageDown: '\uE00F',
  End: '\uE010',
  Home: '\uE011',
  ArrowLeft: '\uE012',
  ArrowUp: '\uE013',
  ArrowRight: '\uE014',
  ArrowDown: '\uE015',
  Insert: '\uE016',
  Delete: '\uE017',
  Meta: '\uE03D',
  ZenkakuHankaku: '\uE040',
  ...Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, String.fromCharCode(0xe031 + i)])
  ),
};

/** Names are validated client-side so the error can list what IS valid. */
function keyValueOf(name: string): string {
  if (name.length === 1) {
    return name;
  }
  const mapped = KEY_CODEPOINTS[name];
  if (mapped === undefined) {
    throw new ActionableError('INVALID_ARGUMENT', `interact.press does not know the key "${name}".`, {
      fix: `Use a single character or one of: ${Object.keys(KEY_CODEPOINTS).join(', ')}.`,
    });
  }
  return mapped;
}

const SCROLL_DELTA = 600;

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function requirePlan(element: ElementInfo | undefined, uid: string): ElementPlan {
  if (element === undefined) {
    throw new ActionableError('INTERNAL_ERROR', `No element plan for uid ${uid}.`);
  }
  return resolvePlan(element);
}

interface ClickProbe {
  readonly rect: unknown;
  readonly coverer: string | null;
  readonly crossing: string | null;
  readonly hasHit: boolean;
}

/**
 * Click with the full §4/§5 contract: probe (rect + hit-test), refuse when
 * covered (NOT_INTERACTABLE, boundary-aware fix), then dispatch one
 * pointerMove/Down/Up at the element center in the element's own context.
 */
async function clickElement(
  session: Session,
  scriptContext: string,
  dispatchContext: string,
  plan: ElementPlan
): Promise<void> {
  const outcome = await callOnElement(session, scriptContext, plan, CLICK_PROBE_BODY);
  const probe = outcome.value as ClickProbe | null;
  if (probe === null || typeof probe !== 'object' || !Array.isArray(probe.rect)) {
    throw new ActionableError('STALE_UID', 'The element changed while the click was prepared.', {
      fix: 'Take a fresh page.snapshot and retry.',
      details: { reason: outcome.value === null ? 'unparsable probe' : 'unexpected probe' },
    });
  }
  const [x, y, width, height] = probe.rect as number[];
  if (width <= 0 || height <= 0) {
    throw new ActionableError(
      'NOT_INTERACTABLE',
      `Element has no size (${width}×${height}) and cannot be clicked.`,
      { fix: 'The element is hidden or collapsed; take a fresh page.snapshot and pick a visible target.' }
    );
  }
  if (probe.coverer !== null) {
    const fix =
      probe.crossing === 'iframe'
        ? 'The click point crosses an iframe boundary; the target is only reachable through its own frame. Take a fresh page.snapshot and act on the element inside the frame.'
        : probe.crossing === 'shadow'
          ? 'The click point crosses a shadow/slot boundary; the covering element is not the one you see in the snapshot. Take a fresh page.snapshot and retry.'
          : 'Dismiss or scroll the covering element away, then retry.';
    throw new ActionableError('NOT_INTERACTABLE', `Element is covered by ${probe.coverer}.`, {
      fix,
      details: { coverer: probe.coverer, ...(probe.crossing === null ? {} : { crossing: probe.crossing }) },
    });
  }
  if (!probe.hasHit) {
    throw new ActionableError('NOT_INTERACTABLE', 'No element is hit at the target center.', {
      fix: 'The element may be outside the visible viewport; scroll it into view and retry.',
      details: { rect: probe.rect },
    });
  }
  await performInput(session, dispatchContext, [
    {
      type: 'pointer',
      id: 'interact-pointer',
      parameters: { pointerType: 'mouse' },
      actions: [
        { type: 'pointerMove', x: x + width / 2, y: y + height / 2, duration: 0 },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerUp', button: 0 },
      ],
    },
  ]);
}

/**
 * Dispatch input actions and always release afterwards: a failed dispatch
 * must never leak a held pointer button or key (decisions §5).
 */
async function performInput(
  session: Session,
  context: string,
  actions: readonly Record<string, unknown>[]
): Promise<void> {
  try {
    await session.request('input.performActions', { context, actions });
  } finally {
    // releaseActions is a no-op when nothing is held; a failure here must not
    // mask the original error, so it is deliberately contained.
    await session.request('input.releaseActions', { context }).catch(() => undefined);
  }
}

/**
 * The element's own browsing context, resolved through the frame chain
 * (decisions §4): each iframe selector is matched against candidate child
 * contexts via window.frameElement. Frameless plans dispatch in the top
 * context. Cross-origin frames cannot resolve — but they cannot verify
 * either, so dispatch is never reached for them.
 */
async function resolveDispatchContext(
  session: Session,
  topContext: string,
  frame: readonly string[] | undefined
): Promise<string> {
  if (frame === undefined || frame.length === 0) {
    return topContext;
  }
  let current = topContext;
  for (const selector of frame) {
    const tree = await session.request('browsingContext.getTree', { root: current });
    const children = directChildContexts(tree, current);
    let next: string | undefined;
    for (const child of children) {
      const probe = await session.request('script.evaluate', {
        expression: `(() => { try { return window.frameElement ? window.frameElement.matches(${JSON.stringify(selector)}) : false; } catch (e) { return false; } })()`,
        awaitPromise: true,
        target: { context: child },
      });
      if (unwrapBiDiValue(probe.result) === true) {
        next = child;
        break;
      }
    }
    if (next === undefined) {
      throw new ActionableError(
        'ELEMENT_NOT_FOUND',
        `Could not resolve the iframe (${selector}) that holds the element.`,
        {
          fix: 'The frame may have navigated away; take a fresh page.snapshot and retry.',
          details: { selector },
        }
      );
    }
    current = next;
  }
  return current;
}

function directChildContexts(tree: Record<string, unknown>, parent: string): string[] {
  const contexts = Array.isArray(tree.contexts) ? tree.contexts : [];
  const root = contexts.find(
    (node) => node !== null && typeof node === 'object' && (node as Record<string, unknown>).context === parent
  );
  const source = root ?? contexts[0];
  if (source === null || typeof source !== 'object') {
    return [];
  }
  const children = (source as Record<string, unknown>).children;
  if (!Array.isArray(children)) {
    return [];
  }
  return children
    .map((child) => (child !== null && typeof child === 'object' ? (child as Record<string, unknown>).context : undefined))
    .filter((context): context is string => typeof context === 'string');
}

interface CallOutcome {
  value: unknown;
  rect: readonly number[] | null;
  element?: Record<string, unknown>;
}

/**
 * Run a body against the element the plan resolves to, in the script
 * context (the plan walks frames internally). Returns the body value, the
 * viewport rect, and the element reference when the body handed the node back.
 */
async function callOnElement(
  session: Session,
  context: string,
  plan: ElementPlan,
  body: string,
  extraArgs?: Record<string, unknown>
): Promise<CallOutcome> {
  const declaration = elementScriptSource(plan, body, extraArgs);
  const result = await session.request('script.callFunction', {
    functionDeclaration: declaration,
    awaitPromise: true,
    // Root ownership: upload needs the element reference usable by
    // input.setFiles; plain values are unaffected.
    resultOwnership: 'root',
    target: { context },
  });
  const record = unwrapBiDiValue(result.result) as Record<string, unknown> | null;
  if (record === null || typeof record !== 'object') {
    throw new ActionableError('STALE_UID', 'The element could not be re-resolved for the action.', {
      fix: 'Take a fresh page.snapshot and retry.',
    });
  }
  if (typeof record.error === 'string' && record.error !== '') {
    throw new ActionableError('STALE_UID', `The element moved on: ${record.error}.`, {
      fix: 'Take a fresh page.snapshot and retry.',
      details: { reason: record.error },
    });
  }
  const rect = Array.isArray(record.rect) && record.rect.length === 4 ? record.rect : null;
  return {
    value: record.value ?? null,
    rect,
    ...(record.element === undefined || record.element === null
      ? {}
      : { element: record.element as Record<string, unknown> }),
  };
}

function checkedOf(outcome: CallOutcome): boolean | null {
  const value = outcome.value;
  return value !== null && typeof value === 'object' && 'checked' in value
    ? ((value as Record<string, unknown>).checked as boolean | null)
    : null;
}

function valueOf(outcome: CallOutcome): string | null {
  const value = outcome.value;
  return value !== null && typeof value === 'object' && 'value' in value
    ? ((value as Record<string, unknown>).value as string | null)
    : null;
}

export const interactTool = defineTool({
  name: 'interact',
  title: 'Interact',
  description:
    'Act on page elements by snapshot uid: click, type, clear, press, check, select, scroll, upload. The uid is re-verified in the live page before anything is dispatched.',
  toolset: 'core',
  actions: ACTIONS,
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: async (args, ctx) => {
    const action = requireAction(args, 'interact', ACTIONS);
    const session = ctx.session;
    const runtime = session?.runtime;
    if (session === undefined || runtime === undefined) {
      throw new ActionableError('CONNECTION_FAILED', 'No live browser session.', {
        fix: 'Call browser.connect first.',
      });
    }

    // scroll and press work without an element; everything else needs a uid.
    const uid = stringArg(args, 'uid');
    if (uid === undefined && action !== 'scroll' && action !== 'press') {
      throw new ActionableError('INVALID_ARGUMENT', `interact.${action} requires uid.`, {
        fix: 'Take a page.snapshot first, then pass the element uid.',
      });
    }

    const context = await runtime.contexts.ensureContext(
      typeof args.context === 'string' ? args.context : undefined
    );

    let element: ElementInfo | undefined;
    if (uid !== undefined) {
      const snapshot = runtime.snapshots.get(context);
      if (snapshot !== undefined) {
        element = resolveElement(snapshot, uid);
      } else {
        // The snapshot cache was invalidated by an earlier dispatch (§5), but
        // the recorded plan still resolves the element and verification (§3)
        // guards the dispatch — chained actions need no re-snapshot.
        element = session.planFor(context, uid);
        if (element === undefined) {
          throw new ActionableError('UID_NOT_FOUND', `No snapshot for this context; uid ${uid} is not known to this session.`, {
            fix: 'Call page.snapshot first to get current uids.',
          });
        }
      }
      // STALE_UID / ELEMENT_NOT_FOUND when the page moved on (decisions §3).
      if (snapshot !== undefined) {
        await session.verifyElement(snapshot, uid);
      } else {
        await session.verifyElementPlan(element, context, uid);
      }
    }

    try {
      switch (action) {
        case 'click': {
          const plan = requirePlan(element, uid as string);
          const dispatchContext = await resolveDispatchContext(session, context, plan.frame);
          await clickElement(session, context, dispatchContext, plan);
          return ok(action, { uid });
        }

        case 'type': {
          const text = stringArg(args, 'value');
          if (text === undefined) {
            throw new ActionableError('INVALID_ARGUMENT', 'interact.type requires value.', {
              fix: 'Pass the text to type.',
            });
          }
          const plan = requirePlan(element, uid as string);
          const dispatchContext = await resolveDispatchContext(session, context, plan.frame);
          await callOnElement(session, context, plan, FOCUS_BODY);
          // Per-character key events in one performActions call: controlled
          // components see real key input, and it is a single round trip (§5).
          await performInput(session, dispatchContext, [
            {
              type: 'key',
              id: 'interact-keyboard',
              actions: [...text].flatMap((character) => [
                { type: 'keyDown', value: character },
                { type: 'keyUp', value: character },
              ]),
            },
          ]);
          const read = await callOnElement(session, context, plan, READ_VALUE_BODY);
          return ok(action, { uid, value: valueOf(read) });
        }

        case 'clear': {
          const plan = requirePlan(element, uid as string);
          const dispatchContext = await resolveDispatchContext(session, context, plan.frame);
          // Click, then select-all, then one Backspace: keyboard-only, so
          // controlled components observe a real deletion event (§5).
          await clickElement(session, context, dispatchContext, plan);
          await callOnElement(session, context, plan, SELECT_ALL_BODY);
          await performInput(session, dispatchContext, [
            {
              type: 'key',
              id: 'interact-keyboard',
              actions: [
                { type: 'keyDown', value: keyValueOf('Backspace') },
                { type: 'keyUp', value: keyValueOf('Backspace') },
              ],
            },
          ]);
          const read = await callOnElement(session, context, plan, READ_VALUE_BODY);
          const finalValue = valueOf(read) ?? '';
          return ok(action, { uid, value: finalValue, cleared: finalValue === '' });
        }

        case 'press': {
          const key = stringArg(args, 'value');
          if (key === undefined) {
            throw new ActionableError('INVALID_ARGUMENT', 'interact.press requires value.', {
              fix: `Pass a key name (${Object.keys(KEY_CODEPOINTS).slice(0, 8).join(', ')} …) or a single character, e.g. Enter.`,
            });
          }
          // Press into whatever currently has focus; a uid (when given) was
          // verified above but press does not move focus by itself (§5).
          const keyValue = keyValueOf(key);
          await performInput(session, context, [
            {
              type: 'key',
              id: 'interact-keyboard',
              actions: [
                { type: 'keyDown', value: keyValue },
                { type: 'keyUp', value: keyValue },
              ],
            },
          ]);
          return ok(action, { key, ...(uid === undefined ? {} : { uid }) });
        }

        case 'check': {
          const plan = requirePlan(element, uid as string);
          const before = checkedOf(await callOnElement(session, context, plan, READ_CHECKED_BODY));
          if (before === null) {
            throw new ActionableError(
              'UNSUPPORTED',
              `interact.check needs a checkbox or radio; element ${uid} is not one.`,
              { fix: 'Pick a uid whose snapshot entry has the checkbox or radio role.' }
            );
          }
          const desired = typeof args.checked === 'boolean' ? args.checked : undefined;
          if (desired === undefined || before !== desired) {
            // Toggle via a real click; the state is read fresh afterwards and
            // never trusted from the cache (§5).
            const dispatchContext = await resolveDispatchContext(session, context, plan.frame);
            await clickElement(session, context, dispatchContext, plan);
          }
          const after = checkedOf(await callOnElement(session, context, plan, READ_CHECKED_BODY));
          return ok(action, { uid, checked: after });
        }

        case 'select': {
          const option = stringArg(args, 'option');
          if (option === undefined) {
            throw new ActionableError('INVALID_ARGUMENT', 'interact.select requires option.', {
              fix: 'Pass the option value, label, or index.',
            });
          }
          const plan = requirePlan(element, uid as string);
          const outcome = await callOnElement(session, context, plan, SELECT_BODY, { option });
          if (outcome.value === null) {
            throw new ActionableError(
              'UNSUPPORTED',
              `interact.select needs a <select>; element ${uid} is not one.`,
              { fix: 'Pick a uid whose snapshot entry has the combobox role.' }
            );
          }
          const picked = outcome.value as { selected?: string; label?: string; missing?: number };
          if (typeof picked.missing === 'number') {
            throw new ActionableError(
              'INVALID_ARGUMENT',
              `interact.select found no option matching "${option}" (${picked.missing} options available).`,
              { fix: 'Pass an exact option value, label, or index.' }
            );
          }
          return ok(action, {
            uid,
            option: picked.selected ?? null,
            ...(picked.label === undefined ? {} : { label: picked.label }),
          });
        }

        case 'scroll': {
          if (uid !== undefined) {
            const plan = requirePlan(element, uid);
            const outcome = await callOnElement(session, context, plan, SCROLL_ELEMENT_BODY);
            const position = (outcome.value ?? {}) as { x?: number; y?: number };
            return ok(action, { uid, x: position.x ?? null, y: position.y ?? null });
          }
          const direction = args.direction === 'up' ? 'up' : 'down';
          const delta = direction === 'up' ? -SCROLL_DELTA : SCROLL_DELTA;
          // Page scroll rides a wheel source (§5), like a user's wheel.
          await performInput(session, context, [
            {
              type: 'wheel',
              id: 'interact-wheel',
              actions: [{ type: 'scroll', x: 0, y: 0, deltaX: 0, deltaY: delta }],
            },
          ]);
          const position = await session.request('script.evaluate', {
            expression: '({ x: window.scrollX, y: window.scrollY })',
            awaitPromise: true,
            target: { context },
          });
          const at = (unwrapBiDiValue(position.result) ?? {}) as { x?: number; y?: number };
          return ok(action, { direction, x: at.x ?? null, y: at.y ?? null });
        }

        case 'upload': {
          const raw = stringArg(args, 'value');
          if (raw === undefined) {
            throw new ActionableError('INVALID_ARGUMENT', 'interact.upload requires value.', {
              fix: 'Pass one or more absolute file paths, comma-separated.',
            });
          }
          const files = raw.split(',').map((file) => file.trim()).filter((file) => file !== '');
          if (files.length === 0) {
            throw new ActionableError('INVALID_ARGUMENT', 'interact.upload needs at least one file.', {
              fix: 'Pass at least one absolute file path.',
            });
          }
          const plan = requirePlan(element, uid as string);
          const dispatchContext = await resolveDispatchContext(session, context, plan.frame);
          const outcome = await callOnElement(session, context, plan, RETURN_ELEMENT_BODY);
          const sharedId = outcome.element?.sharedId;
          if (typeof sharedId !== 'string' || sharedId === '') {
            throw new ActionableError(
              'SESSION_FAILED',
              'The browser did not hand back an element reference for input.setFiles.',
              { fix: 'Retry once; if it persists, take a fresh page.snapshot and retry.' }
            );
          }
          await session.request('input.setFiles', {
            context: dispatchContext,
            element: { sharedId },
            files,
          });
          return ok(action, { uid, files: files.length });
        }

        default:
          throw new ActionableError('INVALID_ACTION', `Unknown interact action: ${action}.`);
      }
    } finally {
      // Any dispatched action (or failed attempt) may have changed the page:
      // drop the cache entry so the next page.snapshot reflects post-action
      // state. Scrolling keeps document-space bounds valid, so it is exempt.
      if (action !== 'scroll') {
        runtime.snapshots.invalidate(context);
      }
    }
  },
});
