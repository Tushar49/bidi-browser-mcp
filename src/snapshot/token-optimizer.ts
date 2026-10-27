import type { ElementInfo, PageSnapshot, TruncationMeta } from '../types.js';

export interface FittedSnapshot {
  readonly url: string;
  readonly title: string;
  readonly elements: readonly ElementInfo[];
  readonly text?: string;
  readonly meta: TruncationMeta;
}

/**
 * Fit a snapshot into a character budget. Order of sacrifice: text body
 * first (it is the bulkiest), then tail elements. Interactive heads of the
 * page are worth more than the tail.
 */
export function fitToBudget(
  snapshot: PageSnapshot,
  budget: number,
  options: { includeText?: boolean } = {}
): FittedSnapshot {
  const includeText = options.includeText === true;
  // Elements the DOM traversal dropped before serialization (hard cap).
  const droppedByCap = snapshot.droppedElements ?? 0;
  const meta = (): TruncationMeta => ({
    truncated: droppedByCap > 0,
    originalChars: 0,
    omittedElements: droppedByCap,
    omittedTextChars: 0,
  });

  const chars = (value: unknown): number => JSON.stringify(value ?? '').length;

  // Budget the whole payload, not just the element list — url and title cost
  // characters too.
  const payloadChars = (
    elements: readonly ElementInfo[],
    text?: string
  ): number =>
    chars({
      url: snapshot.url,
      title: snapshot.title,
      elements,
      ...(text === undefined ? {} : { text }),
    });

  if (!includeText) {
    const original = payloadChars(snapshot.elements);
    if (original <= budget) {
      return {
        url: snapshot.url,
        title: snapshot.title,
        elements: snapshot.elements,
        meta: { ...meta(), originalChars: original },
      };
    }

    // Binary-search the largest element prefix that fits (plus overhead).
    let low = 0;
    let high = snapshot.elements.length;
    let best = 0;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (payloadChars(snapshot.elements.slice(0, mid)) <= budget) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return {
      url: snapshot.url,
      title: snapshot.title,
      elements: snapshot.elements.slice(0, best),
      meta: {
        truncated: true,
        originalChars: original,
        omittedElements: snapshot.elements.length - best + droppedByCap,
        omittedTextChars: 0,
      },
    };
  }

  const original = chars(snapshot.text) + chars(snapshot.elements);
  if (payloadChars(snapshot.elements, snapshot.text) <= budget) {
    return {
      url: snapshot.url,
      title: snapshot.title,
      elements: snapshot.elements,
      text: snapshot.text,
      meta: { ...meta(), originalChars: original },
    };
  }

  // Drop text first; keep as much as fits alongside a reduced element list.
  const elementsBudgetShare = Math.floor(budget * 0.6);
  let fittedElements = snapshot.elements;
  let truncatedElements = false;
  if (payloadChars(fittedElements) > elementsBudgetShare) {
    const fit = fitToBudget(
      snapshot,
      elementsBudgetShare,
      { includeText: false }
    );
    fittedElements = fit.elements;
    truncatedElements = fit.meta.truncated;
  }

  // Whatever is left after url, title, and elements belongs to the text.
  const remaining = budget - payloadChars(fittedElements);
  let text = snapshot.text;
  let omittedTextChars = 0;
  if (chars(text) > remaining) {
    // Two characters for the JSON quotes around the string.
    const largest = Math.max(0, remaining - 2);
    text = text.slice(0, largest);
    omittedTextChars = snapshot.text.length - text.length;
  }

  return {
    url: snapshot.url,
    title: snapshot.title,
    elements: fittedElements,
    ...(text.length > 0 ? { text } : {}),
    meta: {
      truncated: truncatedElements || omittedTextChars > 0 || droppedByCap > 0,
      originalChars: original,
      omittedElements: snapshot.elements.length - fittedElements.length + droppedByCap,
      omittedTextChars,
    },
  };
}
