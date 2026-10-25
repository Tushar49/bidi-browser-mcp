import { describe, expect, it } from 'vitest';
import { parseSnapshotResult } from '../../snapshot/dom-snapshot.js';

const FIXTURE = JSON.stringify({
  title: 'Test page',
  url: 'https://example.test/',
  text: 'Hello world',
  elements: [
    {
      role: 'button',
      name: 'Submit',
      tag: 'button',
      bounds: [10, 20, 100, 30],
      selector: '#main > button',
      states: { focused: true },
    },
    {
      role: 'textbox',
      name: 'Email',
      tag: 'input',
      bounds: [10, 60, 200, 24],
      selector: '#main > form > input:nth-of-type(1)',
      frame: ['body > iframe:nth-of-type(1)'],
      shadowHost: 'app-drawer',
      states: { required: true },
    },
    { broken: true },
  ],
});

describe('parseSnapshotResult', () => {
  it('assigns uids and preserves metadata', () => {
    const snapshot = parseSnapshotResult('ctx-1', FIXTURE);

    expect(snapshot.context).toBe('ctx-1');
    expect(snapshot.title).toBe('Test page');
    expect(snapshot.url).toBe('https://example.test/');
    expect(snapshot.text).toBe('Hello world');
    expect(snapshot.elements).toHaveLength(2);

    const [button, input] = snapshot.elements;
    expect(button.uid).toBe('e1');
    expect(button).toMatchObject({
      role: 'button',
      name: 'Submit',
      tag: 'button',
      bounds: [10, 20, 100, 30],
      selector: '#main > button',
      states: { focused: true },
    });
    expect(input.uid).toBe('e2');
    expect(input.frame).toEqual(['body > iframe:nth-of-type(1)']);
    expect(input.shadowHost).toBe('app-drawer');
    expect(input.states).toEqual({ required: true });
  });

  it('rejects non-string and malformed payloads', () => {
    expect(() => parseSnapshotResult('ctx', undefined)).toThrowError(
      /returned no data/
    );
    expect(() => parseSnapshotResult('ctx', 'not json')).toThrowError(
      /malformed JSON/
    );
    expect(() => parseSnapshotResult('ctx', JSON.stringify({}))).toThrowError(
      /no element list/
    );
  });

  it('coerces missing fields defensively', () => {
    const snapshot = parseSnapshotResult(
      'ctx',
      JSON.stringify({ elements: [{ role: 'link', selector: 'a', bounds: [1, 2] }] })
    );
    expect(snapshot.elements[0]).toMatchObject({
      uid: 'e1',
      role: 'link',
      name: '',
      tag: 'unknown',
      bounds: [1, 2, 0, 0],
    });
  });
});
