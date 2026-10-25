import type { ElementInfo, PageSnapshot } from '../types.js';
import { ActionableError } from '../utils/errors.js';

/** Look up an element by uid inside a snapshot. */
export function resolveElement(snapshot: PageSnapshot, uid: string): ElementInfo {
  const element = snapshot.elements.find((candidate) => candidate.uid === uid);
  if (element === undefined) {
    throw new ActionableError('UID_NOT_FOUND', `Unknown element uid: ${uid}.`, {
      fix: 'Take a fresh page.snapshot to get current uids.',
      details: { context: snapshot.context, url: snapshot.url },
    });
  }
  return element;
}

/**
 * Resolution plan for an element: query the frame chain (if any), pierce the
 * shadow host (if any), then match the selector. Pure — the interaction wave
 * executes this against the page.
 */
export function resolvePlan(element: ElementInfo): {
  frame?: readonly string[];
  shadowHost?: string;
  selector: string;
} {
  return {
    ...(element.frame === undefined ? {} : { frame: element.frame }),
    ...(element.shadowHost === undefined ? {} : { shadowHost: element.shadowHost }),
    selector: element.selector,
  };
}
