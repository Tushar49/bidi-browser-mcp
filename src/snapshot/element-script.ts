/**
 * Build the script source that runs a body against the element a resolution
 * plan describes (interact dispatch, 0.2.0 decisions §4/§5).
 *
 * The plan is embedded as JSON, so page strings can never break the source.
 * The body is called as `body(element, args, document)` inside the element's
 * own document and the wrapper always returns:
 *  - `rect`: viewport-space `[x, y, width, height]` of that document — the
 *    same space `elementFromPoint` and `input.performActions` use;
 *  - `value`: the body's return value;
 *  - `element`: the element reference when the body returned the node itself
 *    (upload needs it for `input.setFiles`);
 *  - `error`: a resolution failure (frame/shadow/selector), else null.
 *
 * `value` is the only field that can carry page data, and callers treat it as
 * untrusted content.
 */

export interface ElementPlan {
  readonly frame?: readonly string[];
  readonly shadowHost?: string;
  readonly selector: string;
}

export function elementScriptSource(
  plan: ElementPlan,
  body: string,
  extraArgs?: Record<string, unknown>
): string {
  const planJson = JSON.stringify({
    frame: plan.frame ?? null,
    shadowHost: plan.shadowHost ?? null,
    selector: plan.selector,
  });
  // Arguments travel as one plain object; bodies read named fields instead of
  // relying on positional bookkeeping or string interpolation.
  const argsJson = JSON.stringify(extraArgs ?? {});
  return `(function runOnElement (args) {
  args = ${argsJson};
  var plan = ${planJson};
  var out = { value: null, rect: null, element: null, error: null };
  try {
    var doc = document;
    var frames = plan.frame || [];
    for (var i = 0; i < frames.length; i++) {
      var frame = doc.querySelector(frames[i]);
      var inner = frame ? frame.contentDocument : null;
      if (!inner || !inner.documentElement) { out.error = 'frame unavailable'; return out; }
      doc = inner;
    }
    var scope = doc;
    if (plan.shadowHost !== null) {
      var host = doc.querySelector(plan.shadowHost);
      var root = host ? host.shadowRoot : null;
      if (!root) { out.error = 'shadow root unavailable'; return out; }
      scope = root;
    }
    var matches = scope.querySelectorAll(plan.selector);
    if (matches.length !== 1) {
      out.error = matches.length === 0 ? 'no such element' : 'ambiguous selector';
      return out;
    }
    var el = matches[0];
    var r = el.getBoundingClientRect();
    out.rect = [r.x, r.y, r.width, r.height];
    var result = (${body})(el, args, doc);
    if (result && result.nodeType === 1) {
      // The node goes to 'element' alone: serializing it twice makes the
      // second occurrence a by-reference stub (Chromium dedupes), which
      // input.setFiles cannot use.
      out.element = result;
    } else {
      out.value = result === undefined ? null : result;
    }
  } catch (e) {
    out.error = String(e && e.message ? e.message : e);
  }
  return out;
})`;
}
