import type { SessionStatus } from '../types.js';

/**
 * Home-directory prefixes worth hiding in tool output: the OS username is
 * embedded in the path, and every tool answer is sent to the agent provider.
 */
const HOME_PREFIXES = [/^[A-Za-z]:\\Users\\[^\\/]+/, /^\/(?:home|Users)\/[^/]+/];

/**
 * Replace the user-specific prefix of a profile path with `~` while keeping
 * everything above it: `C:\Users\me\AppData\…\Zen\Profiles\xxx` becomes
 * `~\AppData\…\Zen\Profiles\xxx`, which still identifies the profile file
 * but carries no username. Paths without a home prefix are returned as they
 * are (portable installs use their own drive or a flat config).
 */
export function redactProfilePath(path: string): string {
  for (const pattern of HOME_PREFIXES) {
    if (pattern.test(path)) {
      return path.replace(pattern, '~');
    }
  }
  return path;
}

/**
 * Redact every path a status payload can carry: the resolved `profile` of the
 * live session and the `moz:profile` capability the browser reports. Raw paths
 * stay available to internal callers (profile reads in the container and
 * spaces tools) — this copy is for tool output.
 */
export function redactStatusProfile(status: SessionStatus): SessionStatus {
  const profile =
    status.profile === undefined
      ? undefined
      : redactProfilePath(status.profile);
  const browser =
    status.browser === undefined
      ? status.browser
      : ((): Record<string, unknown> => {
          const normalized: Record<string, unknown> = { ...status.browser };
          const mozProfile = normalized['moz:profile'];
          if (typeof mozProfile === 'string') {
            normalized['moz:profile'] = redactProfilePath(mozProfile);
          }
          return normalized;
        })();
  return {
    ...status,
    ...(profile === undefined ? {} : { profile }),
    ...(browser === undefined ? {} : { browser }),
  };
}
