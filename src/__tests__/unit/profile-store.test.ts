import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  decodeMozLz4,
  joinContainerNames,
  lz4BlockDecode,
  MAX_CONTAINERS_BYTES,
  MAX_DECODED_BYTES,
  MAX_SESSION_STORE_BYTES,
  parseContainersJson,
  parseSpaces,
  readContainers,
  readProfileStore,
  readSpaces,
} from '../../profile/profile-store.js';

/** Build a mozLz4 container holding one full literal run (payload <= 269). */
function mozLz4(text: string): Buffer {
  const data = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(12);
  header.write('mozLz40\0', 0, 'latin1');
  header.writeUInt32LE(data.length, 8);
  const token = Buffer.from([0xf0, data.length - 15]); // 15 + extension
  return Buffer.concat([header, token, data]);
}

describe('lz4 decoding', () => {
  it('round-trips literals-only mozLz4 payloads', () => {
    const payload = '{"hello":"zen"}';
    const decoded = decodeMozLz4(mozLz4(payload));
    expect(decoded).toBe(payload);
  });

  it('decodes LZ4 matches (token with match reference)', () => {
    // Token: 3 literals 'abc' then a match: offset 3, low nibble 2 => length 2+4 = 6.
    const block = Buffer.from([
      (3 << 4) | 2, // 3 literals, match length 6
      0x61, 0x62, 0x63, // 'abc'
      0x03, 0x00, // offset = 3
    ]);
    const decoded = lz4BlockDecode(block).toString('utf8');
    expect(decoded).toBe('abcabcabc');
  });

  it('rejects wrong magic', () => {
    const bad = Buffer.from('NOPEmozLz40\0xxxx', 'latin1');
    expect(() => decodeMozLz4(bad)).toThrowError(/Not a mozLz4/);
  });
});

describe('parseContainersJson', () => {
  it('parses identities and drops non-public metadata cleanly', () => {
    const containers = parseContainersJson(
      JSON.stringify({
        version: 8,
        lastUserContextId: 8,
        identities: [
          { icon: 'fingerprint', color: 'blue', public: true, userContextId: 1 },
          { icon: 'briefcase', color: 'orange', public: true, userContextId: 2, name: 'Job-Ops' },
          {
            public: false,
            icon: '',
            color: '',
            name: 'userContextIdInternal.thumbnail',
            userContextId: 5,
          },
        ],
      })
    );

    expect(containers).toHaveLength(3);
    expect(containers[0]).toEqual({
      userContextId: 1,
      icon: 'fingerprint',
      color: 'blue',
      isPublic: true,
    });
    expect(containers[1]).toMatchObject({ name: 'Job-Ops', isPublic: true });
    expect(containers[2]).toMatchObject({ isPublic: false });
  });

  it('returns empty on malformed input', () => {
    expect(parseContainersJson('not json')).toEqual([]);
    expect(parseContainersJson('{"nope":1}')).toEqual([]);
  });
});

describe('parseSpaces', () => {
  it('extracts space definitions with nested themes and container links', () => {
    const sessions = JSON.stringify({
      windows: [
        {
          zenWorkspace: '{04845174-7c5a-4488-82c0-c7cd3df74a50}',
          workspaces: [
            {
              uuid: '{a8c408cb-72ef-4d71-a60a-6418614f80e0}',
              name: 'BirmaTea',
              theme: { type: 'gradient', gradientColors: [{ c: [238, 211, 6], nested: { deep: true } }] },
              containerTabId: 8,
            },
            {
              uuid: '{11111111-2222-4333-8444-555555555555}',
              name: 'Job-Ops',
              theme: { type: 'solid' },
            },
          ],
        },
      ],
    });

    const spaces = parseSpaces(sessions);
    expect(spaces).toHaveLength(2);
    expect(spaces[0]).toMatchObject({
      uuid: '{a8c408cb-72ef-4d71-a60a-6418614f80e0}',
      name: 'BirmaTea',
      themeType: 'gradient',
      containerId: 8,
    });
    expect(spaces[1]).toMatchObject({ name: 'Job-Ops', themeType: 'solid' });
    expect('containerId' in spaces[1]).toBe(false);
  });

  it('returns empty when no spaces exist', () => {
    expect(parseSpaces('{"windows":[]}')).toEqual([]);
  });

  it('finds the space object when a nested object precedes the uuid', () => {
    // The nearest brace before the anchor belongs to the theme, not to the
    // space: scanning has to walk back to the enclosing object.
    const spaces = parseSpaces(
      '{"theme":{"type":"dark"},"uuid":"{abc-def}","name":"Work","containerTabId":4}'
    );
    expect(spaces).toHaveLength(1);
    expect(spaces[0]).toMatchObject({ uuid: '{abc-def}', name: 'Work', containerId: 4 });
  });
});

describe('joinContainerNames', () => {
  const containers = [
    { userContextId: 2, name: 'Job-Ops', isPublic: true },
    { userContextId: 1, isPublic: true },
    { userContextId: 5, name: 'internal', isPublic: false },
  ];

  it('tolerates key order and whitespace in space objects', () => {
    const spaces = parseSpaces(
      '{"uuid":"{aaaa-bbbb}","theme":{"type":"toolbar"},"name":"Work","containerTabId":4}'
    );
    expect(spaces).toHaveLength(1);
    expect(spaces[0]).toMatchObject({ name: 'Work', containerId: 4 });
  });

  it('reads containers without touching the session store', () => {
    // context.list only needs containers.json — decoding the (potentially
    // multi-MB) Zen session store would cost memory for nothing.
    const dir = mkdtempSync(join(tmpdir(), 'bidi-profile-'));
    try {
      writeFileSync(
        join(dir, 'containers.json'),
        JSON.stringify({
          version: 1,
          identities: [{ userContextId: 1, public: true, name: 'Work', icon: '', color: 'blue' }],
        })
      );
      const containers = readContainers(dir);
      expect(containers).toHaveLength(1);
      expect(containers[0]).toMatchObject({ userContextId: 1, name: 'Work' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps valid identities when one entry is malformed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bidi-profile-'));
    try {
      writeFileSync(
        join(dir, 'containers.json'),
        JSON.stringify({
          version: 1,
          identities: [null, { userContextId: 1, public: true, name: 'Work' }],
        })
      );
      const containers = readContainers(dir);
      expect(containers).toHaveLength(1);
      expect(containers[0]).toMatchObject({ userContextId: 1, name: 'Work' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores an oversized containers file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bidi-profile-'));
    try {
      writeFileSync(join(dir, 'containers.json'), Buffer.alloc(MAX_CONTAINERS_BYTES + 1));
      expect(readContainers(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips an oversized session store with a warning', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bidi-profile-'));
    try {
      writeFileSync(join(dir, 'zen-sessions.jsonlz4'), Buffer.alloc(MAX_SESSION_STORE_BYTES + 1));
      const { spaces, warnings } = readSpaces(dir);
      expect(spaces).toHaveLength(0);
      expect(warnings.join(' ')).toMatch(/over the .* limit/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a truncated literal run instead of returning uninitialized bytes', () => {
    // Token 0xF0 declares a 15-byte literal, but only 2 bytes follow. The
    // decoder must fail — a short read must never leave a gap of stale heap
    // bytes in the decoded text.
    const input = Buffer.from([0xf0, 0x41, 0x42]);
    expect(() => lz4BlockDecode(input)).toThrowError(/Truncated LZ4 literal run/);
  });

  it('rejects a declared size above the decode ceiling', () => {
    const input = Buffer.alloc(16);
    expect(() => lz4BlockDecode(input, MAX_DECODED_BYTES + 1)).toThrowError(
      /exceeds the decode limit/
    );
  });

  it('refuses to expand a small input beyond the decode ceiling', () => {
    // 1 literal byte, offset 1, then match-length extensions: a tiny input
    // that would expand past 64 MiB.
    const extensions = Buffer.alloc(264_000, 0xff);
    const input = Buffer.concat([
      Buffer.from([0x1f, 0x41, 0x01, 0x00]),
      extensions,
      Buffer.from([0x00]),
    ]);
    expect(() => lz4BlockDecode(input)).toThrowError(/Decoded size exceeds/);
  });

  it('reads containers and spaces through the combined reader', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bidi-profile-'));
    try {
      writeFileSync(
        join(dir, 'containers.json'),
        JSON.stringify({
          version: 1,
          identities: [{ userContextId: 1, public: true, name: 'Work' }],
        })
      );
      const store = readProfileStore(dir);
      expect(store.containers).toHaveLength(1);
      expect(store.spaces).toHaveLength(0);
      expect(store.warnings).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('joins positionally over sorted public identities', () => {
    const { names, aligned } = joinContainerNames(
      ['default', 'uuid-one', 'uuid-two'],
      containers
    );
    expect(aligned).toBe(true);
    expect(names.get('uuid-one')?.userContextId).toBe(1);
    expect(names.get('uuid-two')?.userContextId).toBe(2);
    expect(names.get('uuid-two')?.name).toBe('Job-Ops');
    expect(names.has('default')).toBe(false);
  });

  it('drops every name when the counts do not line up', () => {
    // Firefox exposes no id bridge: a count mismatch means a name could land
    // on the wrong container, so no name is attached.
    const { names, aligned } = joinContainerNames(
      ['default', 'a', 'b', 'c', 'd'],
      containers
    );
    expect(aligned).toBe(false);
    expect(names.size).toBe(0);
  });
});
