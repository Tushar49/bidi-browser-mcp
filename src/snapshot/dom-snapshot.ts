import type { ElementInfo, PageSnapshot } from '../types.js';
import { ActionableError } from '../utils/errors.js';

/**
 * Firefox has no accessibility tree in BiDi, so the snapshot is built by a
 * DOM traversal script: interactive/form nodes with computed role, name,
 * bounds, states, and a CSS resolution path (selector-first; the sharedId
 * route stays open for the interaction wave).
 *
 * The script returns ONE JSON string to avoid per-node RemoteValue
 * serialization overhead. Frames: same-origin iframes and open shadow roots
 * are traversed; each element records its frame chain / shadow host.
 */
const SNAPSHOT_SCRIPT = String.raw`
(() => {
  const MAX_NAME = 120;
  const MAX_TEXT = 30000;
  const MAX_ELEMENTS = 5000;
  let dropped = 0;

  function esc(value) {
    return String(value == null ? '' : value);
  }

  function collapse(text) {
    return text.replace(/\s+/g, ' ').trim();
  }

  function roleOf(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'option') return 'option';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'label') return 'label';
    if (tag === 'img') return 'img';
    if (tag === 'progress') return 'progressbar';
    if (tag === 'meter') return 'meter';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      if (type === 'file') return 'fileinput';
      if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
      if (type === 'image') return 'button';
      return 'textbox';
    }
    if (el.isContentEditable) return 'textbox';
    return tag;
  }

  function nameOf(el, role) {
    const label = el.getAttribute('aria-label');
    if (label && collapse(label)) return collapse(label).slice(0, MAX_NAME);
    const tag = el.tagName.toLowerCase();
    if (role === 'textbox' || role === 'combobox' || role === 'fileinput' || role === 'slider') {
      // Never read a live field value: it can hold a password, a session token,
      // or PII, and the snapshot travels into agent context and client logs.
      // Only static attributes are exposed.
      return collapse(
        el.getAttribute('placeholder') || el.getAttribute('name') || el.getAttribute('title') || ''
      ).slice(0, MAX_NAME);
    }
    if (role === 'img') return collapse(el.getAttribute('alt') || el.getAttribute('title') || '').slice(0, MAX_NAME);
    if (role === 'heading') return collapse(el.textContent || '').slice(0, MAX_NAME);
    const text = collapse(el.textContent || '');
    if (text) return text.slice(0, MAX_NAME);
    return collapse(el.getAttribute('title') || el.getAttribute('name') || '').slice(0, MAX_NAME);
  }

  function cssPath(el, doc) {
    if (el.id) {
      try { if (doc.getElementById(el.id) === el) return '#' + CSS.escape(el.id); } catch (e) {}
    }
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1) {
      let segment = node.tagName.toLowerCase();
      if (node.id) {
        try {
          if (doc.getElementById(node.id) === node) {
            parts.unshift('#' + CSS.escape(node.id));
            break;
          }
        } catch (e) {}
      }
      const parent = node.parentElement;
      if (parent) {
        const sameTag = Array.prototype.filter.call(parent.children, (c) => c.tagName === node.tagName);
        if (sameTag.length > 1) segment += ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')';
        parts.unshift(segment);
        node = parent;
      } else {
        parts.unshift(segment);
        break;
      }
    }
    return parts.join(' > ');
  }

  function interesting(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template' || tag === 'head' || tag === 'meta' || tag === 'link') return false;
    if (tag === 'a' || tag === 'button' || tag === 'select' || tag === 'textarea' || tag === 'label' || tag === 'img' || tag === 'summary' || tag === 'option' || tag === 'input' || tag === 'progress' || tag === 'meter') return true;
    if (/^h[1-6]$/.test(tag)) return true;
    if (el.hasAttribute('role') || el.hasAttribute('onclick') || el.hasAttribute('tabindex')) return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function statesOf(el, doc) {
    const states = {};
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') states.disabled = true;
    if (doc.activeElement === el) states.focused = true;
    if (el.tagName.toLowerCase() === 'input') {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'checkbox' || type === 'radio') states.checked = el.checked;
      if (type === 'password') states.masked = true;
    }
    const expanded = el.getAttribute('aria-expanded');
    if (expanded === 'true' || expanded === 'false') states.expanded = expanded === 'true';
    if (el.required || el.getAttribute('aria-required') === 'true') states.required = true;
    if (el.readOnly) states.readonly = true;
    if (/^h[1-6]$/.test(el.tagName.toLowerCase())) states.level = Number(el.tagName.slice(1));
    return states;
  }

  function visible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    return true;
  }

  function collectFrom(root, doc, out, frameChain, shadowHost) {
    const all = root.querySelectorAll('*');
    for (const el of all) {
      // Shadow hosts may be plain divs, so recurse before the filter.
      if (el.shadowRoot) {
        collectFrom(el.shadowRoot, doc, out, frameChain, cssPath(el, doc));
      }
      if (!interesting(el) || !visible(el)) continue;
      if (out.length >= MAX_ELEMENTS) {
        dropped += 1;
        continue;
      }
      const role = roleOf(el);
      const rect = el.getBoundingClientRect();
      const states = statesOf(el, doc);
      const info = {
        role: role,
        name: nameOf(el, role),
        tag: el.tagName.toLowerCase(),
        bounds: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
        selector: cssPath(el, doc),
      };
      if (frameChain.length > 0) info.frame = frameChain;
      if (shadowHost !== null) info.shadowHost = shadowHost;
      if (Object.keys(states).length > 0) info.states = states;
      out.push(info);
    }
  }

  function walkFrames(doc, out, texts, frameChain) {
    collectFrom(doc.body || doc.documentElement, doc, out, frameChain, null);
    const frames = doc.querySelectorAll('iframe');
    for (const frame of frames) {
      try {
        const inner = frame.contentDocument;
        if (inner && inner.body) {
          texts.push(inner.body.innerText);
          collectFrom(inner.body, inner, out, frameChain.concat(cssPath(frame, doc)), null);
        }
      } catch (e) {}
    }
  }

  const doc = document;
  const elements = [];
  const texts = [];
  if (doc.body) texts.push(doc.body.innerText);
  walkFrames(doc, elements, texts, []);

  return JSON.stringify({
    title: doc.title || '',
    url: String(doc.location ? doc.location.href : ''),
    text: texts.join('\n\n--- frame ---\n\n').slice(0, MAX_TEXT),
    elements: elements,
    droppedElements: dropped,
  });
})()`;

interface RawElement {
  role?: unknown;
  name?: unknown;
  tag?: unknown;
  bounds?: unknown;
  selector?: unknown;
  frame?: unknown;
  shadowHost?: unknown;
  states?: unknown;
}

interface RawSnapshot {
  title?: unknown;
  url?: unknown;
  text?: unknown;
  elements?: unknown;
  droppedElements?: unknown;
}

/** Assign uids and validate the raw traversal output. Pure. */
export function parseSnapshotResult(
  context: string,
  raw: unknown
): Omit<PageSnapshot, 'builtAt'> {
  if (typeof raw !== 'string' || raw === '') {
    throw new ActionableError('SCRIPT_ERROR', 'The snapshot script returned no data.', {
      fix: 'Retry with a normal web page open in the tab.',
    });
  }

  let parsed: RawSnapshot;
  try {
    parsed = JSON.parse(raw) as RawSnapshot;
  } catch {
    throw new ActionableError('SCRIPT_ERROR', 'The snapshot script returned malformed JSON.');
  }

  if (!Array.isArray(parsed.elements)) {
    throw new ActionableError('SCRIPT_ERROR', 'The snapshot script returned no element list.');
  }

  const elements: ElementInfo[] = [];
  parsed.elements.forEach((entry, index) => {
    if (entry === null || typeof entry !== 'object') {
      return;
    }
    const el = entry as RawElement;
    if (typeof el.role !== 'string' || typeof el.selector !== 'string') {
      return;
    }
    const bounds = Array.isArray(el.bounds)
      ? (el.bounds.slice(0, 4) as number[])
      : [0, 0, 0, 0];
    elements.push({
      uid: `e${index + 1}`,
      role: el.role,
      name: typeof el.name === 'string' ? el.name : '',
      tag: typeof el.tag === 'string' ? el.tag : 'unknown',
      bounds: [bounds[0] ?? 0, bounds[1] ?? 0, bounds[2] ?? 0, bounds[3] ?? 0],
      selector: el.selector,
      ...(Array.isArray(el.frame) ? { frame: el.frame.filter((f): f is string => typeof f === 'string') } : {}),
      ...(typeof el.shadowHost === 'string' ? { shadowHost: el.shadowHost } : {}),
      ...(el.states !== null && typeof el.states === 'object'
        ? { states: el.states as ElementInfo['states'] }
        : {}),
    });
  });

  return {
    context,
    url: typeof parsed.url === 'string' ? parsed.url : '',
    title: typeof parsed.title === 'string' ? parsed.title : '',
    text: typeof parsed.text === 'string' ? parsed.text : '',
    elements,
    ...(typeof parsed.droppedElements === 'number' && parsed.droppedElements > 0
      ? { droppedElements: parsed.droppedElements }
      : {}),
  };
}

/** Build a fresh snapshot for one context via script.evaluate. */
export async function buildSnapshot(
  request: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>,
  context: string
): Promise<Omit<PageSnapshot, 'builtAt'>> {
  let result: Record<string, unknown>;
  try {
    // Firefox asserts that awaitPromise is present (verified on Zen/Firefox 158).
    result = await request('script.evaluate', {
      expression: SNAPSHOT_SCRIPT,
      target: { context },
      awaitPromise: false,
    });
  } catch (error) {
    if (error instanceof ActionableError) {
      throw error;
    }
    throw new ActionableError('SCRIPT_ERROR', 'Failed to run the snapshot script.', {
      cause: error,
    });
  }

  const value = result.result as { type?: unknown; value?: unknown } | undefined;
  return parseSnapshotResult(context, value?.value);
}
