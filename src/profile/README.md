# Profile layer

Reads Firefox profile data. Never writes, never mutates the profile.

Modules:

- `profile-store.ts` — `containers.json` reader, Zen session-store reader
  (`zen-sessions.jsonlz4`, mozLz4), and the positional join between BiDi
  user-context ids and profile container identities.

Invariants:

- Read-only. No file in the profile is opened for writing.
- The session store can hold open-tab URLs and form state. Only derived
  metadata leaves this layer (uuid, name, theme, container id).
- The session store is size-capped (16 MiB) and decoded into a zero-filled
  buffer — never into a per-byte number array. The decoded output is capped at
  64 MiB, and a truncated or corrupt stream fails the decode instead of
  yielding uninitialized bytes.
- Both profile files are read with a bounded read: the size comes from the
  open file descriptor, so a file that grows after the check cannot push the
  read past the cap. `containers.json` is capped at 1 MiB.
- A malformed container identity is skipped instead of discarding every valid
  identity.
- The container-name join is positional: Firefox exposes no id bridge. When
  the live user-context count and the profile identity count disagree, no
  name is attached (a wrong label is worse than no label).
