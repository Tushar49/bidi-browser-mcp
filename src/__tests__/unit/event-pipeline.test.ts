import { describe, expect, it } from 'vitest';
import { EventPipeline, SUBSCRIBED_EVENTS } from '../../connection/event-pipeline.js';
import type { BiDiEvent } from '../../types.js';

function event(method: string, params: Record<string, unknown> = {}): BiDiEvent {
  return { type: 'event', method, params };
}

describe('EventPipeline', () => {
  it('buffers events per method and reports stats', () => {
    const pipeline = new EventPipeline();
    pipeline.record(event('log.entryAdded', { level: 'info', text: 'a' }));
    pipeline.record(event('log.entryAdded', { level: 'error', text: 'b' }));
    pipeline.record(event('browsingContext.domContentLoaded', { context: 'c1', url: 'about:blank' }));

    const stats = pipeline.stats();
    expect(stats.subscribed).toEqual([...SUBSCRIBED_EVENTS]);
    expect(stats.buffered['log.entryAdded']).toBe(2);
    expect(stats.buffered['browsingContext.domContentLoaded']).toBe(1);
    expect(stats.dropped).toEqual({});
  });

  it('evicts oldest per method and counts drops', () => {
    const pipeline = new EventPipeline({ bufferLimitPerMethod: 2 });
    for (let i = 0; i < 4; i += 1) {
      pipeline.record(event('log.entryAdded', { text: `m${i}` }));
    }

    expect(pipeline.stats().buffered['log.entryAdded']).toBe(2);
    expect(pipeline.stats().dropped['log.entryAdded']).toBe(2);
    const texts = pipeline
      .consoleEntries()
      .map((entry) => entry.text);
    expect(texts).toEqual(['m2', 'm3']);
  });

  it('filters by method, context, and limit; drains on demand', () => {
    const pipeline = new EventPipeline();
    pipeline.record(event('log.entryAdded', { level: 'info', text: 'a', context: 'c1' }));
    pipeline.record(event('log.entryAdded', { level: 'warn', text: 'b', context: 'c2' }));
    pipeline.record(event('browsingContext.domContentLoaded', { context: 'c1', url: 'u' }));

    const onlyC1 = pipeline.events({ context: 'c1' });
    expect(onlyC1).toHaveLength(2);

    const limited = pipeline.events({ methods: ['log.entryAdded'], limit: 1 });
    expect(limited).toHaveLength(1);

    const drained = pipeline.events({ methods: ['log.entryAdded'], drain: true });
    expect(drained).toHaveLength(2);
    expect(pipeline.events({ methods: ['log.entryAdded'] })).toHaveLength(0);
    expect(pipeline.events({ methods: ['browsingContext.domContentLoaded'] })).toHaveLength(1);
  });

  it('drains only the records it returned', () => {
    const pipeline = new EventPipeline();
    pipeline.record(event('log.entryAdded', { level: 'info', text: 'a', context: 'c1' }));
    pipeline.record(event('log.entryAdded', { level: 'warn', text: 'b', context: 'c2' }));
    pipeline.record(event('log.entryAdded', { level: 'error', text: 'c', context: 'c3' }));

    const drained = pipeline.events({ methods: ['log.entryAdded'], limit: 1, drain: true });
    expect(drained).toHaveLength(1);

    // The two records that were never returned stay in the buffer.
    const rest = pipeline.events({ methods: ['log.entryAdded'] });
    expect(rest).toHaveLength(2);
    expect(rest.map((record) => record.params.text)).toEqual(['b', 'c']);
  });

  it('rejects a non-positive limit', () => {
    const pipeline = new EventPipeline();
    expect(() => pipeline.events({ limit: 0 })).toThrowError(/positive integer/);
    expect(() => pipeline.consoleEntries({ limit: 1.5 })).toThrowError(/positive integer/);
  });

  it('keeps routing when a sink throws', () => {
    const pipeline = new EventPipeline();
    const seen: string[] = [];
    pipeline.registerSink(() => {
      throw new Error('sink exploded');
    });
    pipeline.registerSink((e) => seen.push(e.method));

    expect(() =>
      pipeline.record(event('log.entryAdded', { text: 'a' }))
    ).not.toThrow();
    expect(seen).toEqual(['log.entryAdded']);
    expect(pipeline.events({ methods: ['log.entryAdded'] })).toHaveLength(1);
  });

  it('maps log.entryAdded frames to console entries with args fallback', () => {
    const pipeline = new EventPipeline();
    pipeline.record(
      event('log.entryAdded', { channel: 'console', level: 'error', text: 'boom', context: 'c1' })
    );
    pipeline.record(
      event('log.entryAdded', {
        channel: 'console',
        level: 'info',
        args: [
          { type: 'string', value: 'hello' },
          { type: 'number', value: 42 },
        ],
        context: 'c1',
      })
    );

    const entries = pipeline.consoleEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ level: 'error', text: 'boom', context: 'c1' });
    expect(entries[1].text).toBe('hello 42');

    const errors = pipeline.consoleEntries({ level: 'error' });
    expect(errors).toHaveLength(1);
    expect(errors[0].text).toBe('boom');
  });

  it('clearConsole drops only console entries', () => {
    const pipeline = new EventPipeline();
    pipeline.record(event('log.entryAdded', { text: 'a' }));
    pipeline.record(event('browsingContext.domContentLoaded', { context: 'c1', url: 'u' }));

    pipeline.clearConsole();
    expect(pipeline.events({ methods: ['log.entryAdded'] })).toHaveLength(0);
    expect(pipeline.events({ methods: ['browsingContext.domContentLoaded'] })).toHaveLength(1);
  });
});
