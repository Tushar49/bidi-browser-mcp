import { describe, expect, it } from 'vitest';
import { fitToBudget } from '../../snapshot/token-optimizer.js';
import type { ElementInfo, PageSnapshot } from '../../types.js';

function element(uid: string): ElementInfo {
  return {
    uid,
    role: 'button',
    name: `button ${uid}`,
    tag: 'button',
    bounds: [0, 0, 10, 10],
    selector: `#${uid}`,
  };
}

function snapshot(count: number, text: string): PageSnapshot {
  return {
    context: 'ctx',
    url: 'https://example.test/',
    title: 'Example',
    text,
    elements: Array.from({ length: count }, (_, i) => element(`e${i + 1}`)),
    builtAt: 1,
  };
}

describe('fitToBudget', () => {
  it('returns everything when under budget', () => {
    const fitted = fitToBudget(snapshot(3, 'some text'), 10_000);

    expect(fitted.elements).toHaveLength(3);
    expect(fitted.meta).toMatchObject({ truncated: false, omittedElements: 0 });
  });

  it('truncates the element tail first in interactive mode', () => {
    const fitted = fitToBudget(snapshot(50, 'unused'), 400);

    expect(fitted.elements.length).toBeLessThan(50);
    expect(fitted.elements.length).toBeGreaterThan(0);
    expect(fitted.meta.truncated).toBe(true);
    expect(fitted.meta.omittedElements).toBe(50 - fitted.elements.length);
    expect(fitted.meta.originalChars).toBeGreaterThan(400);
  });

  it('drops text first and keeps elements in text mode', () => {
    const big = 'x'.repeat(2000);
    // 5 elements ≈ 650 chars fits the 60% element share of a 1200 budget.
    const fitted = fitToBudget(snapshot(5, big), 1200, { includeText: true });

    expect(fitted.elements).toHaveLength(5);
    expect(fitted.text?.length ?? 0).toBeLessThan(big.length);
    expect(fitted.meta.truncated).toBe(true);
    expect(fitted.meta.omittedTextChars).toBeGreaterThan(0);
  });

  it('shrinks elements when they alone exceed the text-mode share', () => {
    const fitted = fitToBudget(snapshot(200, 'short'), 300, { includeText: true });

    expect(fitted.elements.length).toBeLessThan(200);
    expect(fitted.meta.truncated).toBe(true);
  });
});

describe('fitToBudget with DOM-capped elements', () => {
  it('surfaces elements dropped before serialization', () => {
    const capped: PageSnapshot = {
      ...snapshot(2, 'text'),
      droppedElements: 500,
    };
    const fitted = fitToBudget(capped, 100_000, { includeText: true });
    expect(fitted.meta.truncated).toBe(true);
    expect(fitted.meta.omittedElements).toBe(500);
  });
});
