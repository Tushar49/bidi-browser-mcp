import { describe, expect, it } from 'vitest';
import { redactProfilePath, redactStatusProfile } from '../../utils/redact.js';

describe('redactProfilePath', () => {
  it('replaces the windows home prefix with ~', () => {
    expect(redactProfilePath('C:\\Users\\me\\AppData\\Roaming\\Mozilla\\Zen')).toBe(
      '~\\AppData\\Roaming\\Mozilla\\Zen'
    );
    // Lowercase drive letters and other user dirs keep working.
    expect(redactProfilePath('d:\\Users\\Somebody\\.zen')).toBe('~\\.zen');
  });

  it('replaces the posix home prefix with ~', () => {
    expect(redactProfilePath('/home/me/.config/zen')).toBe('~/.config/zen');
    expect(redactProfilePath('/Users/me/Library/Application Support/Zen')).toBe(
      '~/Library/Application Support/Zen'
    );
  });

  it('leaves paths without a home prefix alone', () => {
    expect(redactProfilePath('A:\\Browsers\\brave-portable\\data')).toBe(
      'A:\\Browsers\\brave-portable\\data'
    );
    expect(redactProfilePath('/opt/zen/zen-profile')).toBe('/opt/zen/zen-profile');
  });

  it('keeps the profile directory name identifiable', () => {
    const redacted = redactProfilePath('C:\\Users\\me\\AppData\\Roaming\\Mozilla\\Zen\\Profiles\\abc123.default');
    expect(redacted).toContain('Profiles');
    expect(redacted).not.toContain('me');
    expect(redacted).toMatch(/^~/);
  });
});

describe('redactStatusProfile', () => {
  it('redacts profile and moz:profile in the output copy', () => {
    const redacted = redactStatusProfile({
      connected: true,
      profile: 'C:\\Users\\me\\zen',
      browser: {
        browserName: 'firefox',
        'moz:profile': 'C:\\Users\\me\\zen',
        browserVersion: '142.0',
      },
    });
    expect(redacted.profile).toBe('~\\zen');
    expect(redacted.browser?.['moz:profile']).toBe('~\\zen');
    expect(redacted.browser?.browserVersion).toBe('142.0');
  });

  it('passes disconnected payloads through untouched', () => {
    const redacted = redactStatusProfile({ connected: false });
    expect(redacted).toEqual({ connected: false });
  });
});
