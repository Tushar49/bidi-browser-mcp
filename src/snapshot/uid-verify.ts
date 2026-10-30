import type { ElementInfo, PageSnapshot } from '../types.js';
import { ActionableError } from '../utils/errors.js';
import { unwrapBiDiValue } from '../utils/bidi-value.js';
import { resolveElement, resolvePlan } from './element-resolver.js';

/** Same request shape the snapshot builders use. */
type BiDiRequest = (
  method: string,
  params?: Record<string, unknown>
) => Promise<Record<string, unknown>>;

export interface VerifyProbe {
  readonly found: boolean;
  readonly tag: string | null;
  readonly rect: readonly [number, number, number, number] | null;
  readonly matches: number;
  readonly reason: string | null;
}

export type VerifyVerdict = 'ok' | 'missing' | 'ambiguous' | 'stale';

/**
 * Document-space rects may drift before an action runs; the size keeps its
 * meaning across scrolls, DOM shifts, and reflow (plan decisions §3).
 */
const SIZE_TOLERANCE = 4;

/**
 * Compare a probe result with the snapshot entry.
 * Precedence (§3): nothing resolved → missing; selector ambiguous → ambiguous;
 * resolved but no longer the same element → stale.
 */
export function compareElement(
  probe: VerifyProbe,
  element: ElementInfo
): VerifyVerdict {
  if (!probe.found) {
    return 'missing';
  }
  if (probe.matches !== 1) {
    return 'ambiguous';
  }
  if (probe.tag === null || probe.tag !== element.tag) {
    return 'stale';
  }
  if (probe.rect === null) {
    return 'stale';
  }
  return (
    Math.abs(probe.rect[2] - (element.bounds[2] ?? 0)) <= SIZE_TOLERANCE &&
    Math.abs(probe.rect[3] - (element.bounds[3] ?? 0)) <= SIZE_TOLERANCE
      ? 'ok'
      : 'stale'
  );
}

/**
 * The verify function: resolve the recorded plan (iframe chain → shadow root →
 * selector) and report what is there now, in document-space coordinates.
 * The plan is embedded as JSON, so page strings cannot break the source.
 */
export function verifyFunctionSource(
  plan: { readonly frame?: readonly string[]; readonly shadowHost?: string; readonly selector: string }
): string {
  const planJson = JSON.stringify({
    frame: plan.frame ?? null,
    shadowHost: plan.shadowHost ?? null,
    selector: plan.selector,
  });
  return `(function verifyUid () {
  var plan = ${planJson};
  var out = { found: false, tag: null, rect: null, matches: 0, reason: null };
  try {
    var doc = document;
    var frames = plan.frame || [];
    for (var i = 0; i < frames.length; i++) {
      var frame = doc.querySelector(frames[i]);
      var inner = frame ? frame.contentDocument : null;
      if (!inner || !inner.documentElement) { out.reason = 'frame unavailable'; return out; }
      doc = inner;
    }
    var scope = doc;
    if (plan.shadowHost !== null) {
      var host = doc.querySelector(plan.shadowHost);
      var root = host ? host.shadowRoot : null;
      if (!root) { out.reason = 'shadow root unavailable'; return out; }
      scope = root;
    }
    var matches = scope.querySelectorAll(plan.selector);
    out.matches = matches.length;
    var el = matches[0];
    if (!el) return out;
    var rect = el.getBoundingClientRect();
    var view = doc.defaultView;
    out.found = true;
    out.tag = el.tagName.toLowerCase();
    out.rect = [
      rect.x + (view ? view.pageXOffset || 0 : 0),
      rect.y + (view ? view.pageYOffset || 0 : 0),
      rect.width,
      rect.height
    ];
  } catch (e) {
    out.reason = String(e && e.message ? e.message : e);
  }
  return out;
})`;
}

/** Parse a `script.callFunction` result into a probe; bad shapes probe absent. */
export function parseVerifyProbe(raw: unknown): VerifyProbe {
  const value = unwrapBiDiValue(raw);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { found: false, tag: null, rect: null, matches: 0, reason: 'unparsable result' };
  }
  const record = value as Record<string, unknown>;
  const rect = record.rect;
  return {
    found: record.found === true,
    tag: typeof record.tag === 'string' ? record.tag : null,
    rect:
      Array.isArray(rect) &&
      rect.length === 4 &&
      rect.every((entry) => typeof entry === 'number')
        ? ([rect[0], rect[1], rect[2], rect[3]] as const)
        : null,
    matches: typeof record.matches === 'number' ? record.matches : 0,
    reason: typeof record.reason === 'string' ? record.reason : null,
  };
}

function verdictError(
  verdict: Exclude<VerifyVerdict, 'ok'>,
  element: ElementInfo,
  probe: VerifyProbe,
  probeReason: string | null
): ActionableError {
  const fix = 'Take a fresh page.snapshot and retry with the new uid.';
  const details = {
    uid: element.uid,
    selector: element.selector,
    ...(probeReason === null ? {} : { probeReason }),
  };
  switch (verdict) {
    case 'missing':
      return new ActionableError(
        'ELEMENT_NOT_FOUND',
        `Element ${element.uid} no longer exists: its selector resolves to nothing.`,
        { fix, details }
      );
    case 'ambiguous':
      return new ActionableError(
        'STALE_UID',
        `Element ${element.uid} is stale: its selector now matches ${probe.matches} elements.`,
        { fix, details }
      );
    default:
      return new ActionableError(
        'STALE_UID',
        `Element ${element.uid} no longer matches its snapshot identity (tag or size changed).`,
        { fix, details }
      );
  }
}

/**
 * Re-resolve one snapshot uid in the live page. Resolves silently when the
 * element still matches; otherwise throws ELEMENT_NOT_FOUND / STALE_UID
 * with the precedence from plan decisions §3. Wave 1 actions call this
 * before dispatching BiDi input commands.
 */
export async function verifySnapshotElement(
  request: BiDiRequest,
  snapshot: PageSnapshot,
  uid: string
): Promise<void> {
  await verifyElementRef(request, resolveElement(snapshot, uid), snapshot.context, uid);
}

/**
 * Verify one known element reference (the plan cache path) against the live
 * page. Same verdicts and precedence as verifySnapshotElement (§3): the plan
 * is only a resolution hint, verification is the safety.
 */
export async function verifyElementRef(
  request: BiDiRequest,
  element: ElementInfo,
  context: string,
  uid: string
): Promise<void> {
  const plan = resolvePlan(element);
  let result: Record<string, unknown>;
  try {
    result = await request('script.callFunction', {
      functionDeclaration: verifyFunctionSource(plan),
      target: { context },
      awaitPromise: false,
    });
  } catch (error) {
    if (error instanceof ActionableError) {
      throw error;
    }
    throw new ActionableError(
      'SCRIPT_ERROR',
      'Failed to run the uid verification script.',
      { cause: error, details: { context, uid } }
    );
  }

  const probe = parseVerifyProbe(
    result.result !== undefined ? result.result : result
  );
  const verdict = compareElement(probe, element);
  if (verdict !== 'ok') {
    throw verdictError(verdict, element, probe, probe.reason);
  }
}
