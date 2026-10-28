import { describe, expect, it } from 'vitest';
import { matchesKnownProcess } from '../../connection/browser-discovery.js';

describe('matchesKnownProcess', () => {
  it('matches exact basenames, .exe and all', () => {
    expect(matchesKnownProcess('brave.exe')).toBe('brave');
    expect(matchesKnownProcess('Brave.exe')).toBe('brave');
    expect(matchesKnownProcess('firefox.exe')).toBe('firefox');
    expect(matchesKnownProcess('zen.exe')).toBe('zen');
    expect(matchesKnownProcess('chrome')).toBe('chrome');
  });

  it('rejects unrelated processes that merely contain a browser name', () => {
    // frozen.exe contains "zen" only if you do substring matching; citizen.exe
    // contains "zen" only via the -ma- in a PowerShell filter.
    expect(matchesKnownProcess('frozen.exe')).toBeUndefined();
    expect(matchesKnownProcess('citizen.exe')).toBeUndefined();
    expect(matchesKnownProcess('zen portal.exe')).toBeUndefined();
  });

  it('matches the macOS bundle executable prefix', () => {
    expect(matchesKnownProcess('brave browser')).toBe('brave');
    expect(matchesKnownProcess('zen browser')).toBe('zen');
  });

  it('rejects siblings that only share the first word', () => {
    // "zen portal" is a Zen helper, not the browser process itself.
    expect(matchesKnownProcess('zen portal.exe')).toBeUndefined();
    expect(matchesKnownProcess('brave browser headless.exe')).toBeUndefined();
  });
});
