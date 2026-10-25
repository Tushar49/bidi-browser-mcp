import { closeSync, existsSync, fstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Read-only Firefox/Zen profile data: container identities and Zen spaces.
 * Nothing here writes to the profile; the browser owns its files.
 */

export interface ContainerIdentity {
  readonly userContextId: number;
  readonly name?: string;
  readonly icon?: string;
  readonly color?: string;
  readonly isPublic: boolean;
}

export interface SpaceInfo {
  readonly uuid: string;
  readonly name: string;
  readonly themeType?: string;
  /** Zen binds spaces to container ids (containers.json int id). */
  readonly containerId?: number;
}

export interface ProfileStore {
  readonly containers: readonly ContainerIdentity[];
  readonly spaces: readonly SpaceInfo[];
  /** Non-fatal read problems, surfaced to the caller. */
  readonly warnings: readonly string[];
}

export interface ContainerNameJoin {
  readonly names: ReadonlyMap<string, ContainerIdentity>;
  /**
   * True when the number of BiDi ids matches the number of public identities.
   * Firefox exposes no id bridge, so the join is positional and only
   * trustworthy while the counts line up.
   */
  readonly aligned: boolean;
}

const CONTAINERS_FILE = 'containers.json';
const ZEN_SESSIONS_FILE = 'zen-sessions.jsonlz4';

/** Refuse to decode an unbounded session store into the MCP process. */
export const MAX_SESSION_STORE_BYTES = 16 * 1024 * 1024;

/** containers.json holds a handful of identities; anything larger is corrupt. */
export const MAX_CONTAINERS_BYTES = 1024 * 1024;

/** How many opening braces to try before giving up on one uuid anchor. */
const MAX_BRACE_CANDIDATES = 24;

/** A space object is small; a larger candidate is not a space object. */
const MAX_SPACE_OBJECT_CHARS = 256 * 1024;

/**
 * Read a file with a hard size cap.
 *
 * The size comes from the open file descriptor, so a file that grows after
 * the check cannot push the read past the cap: at most `maxBytes` are read,
 * and a truncated stream fails the decode instead of being buffered.
 */
function readBoundedFile(
  path: string,
  maxBytes: number
): { readonly ok: true; readonly data: Buffer } | { readonly ok: false; readonly tooLarge: boolean } {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    if (size > maxBytes) {
      return { ok: false, tooLarge: true };
    }
    const buffer = Buffer.alloc(size);
    let offset = 0;
    while (offset < buffer.length) {
      const read = readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (read <= 0) {
        break;
      }
      offset += read;
    }
    return { ok: true, data: buffer.subarray(0, offset) };
  } catch {
    return { ok: false, tooLarge: false };
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Ignore close errors — the data is already read.
      }
    }
  }
}

/**
 * Hard ceiling for decoded output. The input cap does not bound expansion:
 * LZ4 overlapping matches can inflate a small file enormously.
 */
export const MAX_DECODED_BYTES = 64 * 1024 * 1024;

/**
 * Decode an LZ4 block (Firefox's mozLz4 payload). Minimal, dev-stable.
 * `expectedSize` preallocates the output buffer — the byte-per-number array
 * this replaced cost ~8 bytes per decoded byte.
 *
 * Safety: buffers are zero-filled (never `allocUnsafe`), a short literal read
 * is an error instead of a gap, and the decoded size is capped.
 */
export function lz4BlockDecode(input: Buffer, expectedSize?: number): Buffer {
  const declared =
    expectedSize !== undefined && expectedSize > 0 ? expectedSize : 0;
  if (declared > MAX_DECODED_BYTES) {
    throw new Error(`Declared size ${declared} exceeds the decode limit.`);
  }

  let out = Buffer.alloc(
    declared > 0
      ? declared
      : Math.min(Math.max(input.length * 4, 1024), 1024 * 1024)
  );
  let length = 0;

  const ensure = (extra: number): void => {
    if (length + extra > MAX_DECODED_BYTES) {
      throw new Error(`Decoded size exceeds ${MAX_DECODED_BYTES} bytes.`);
    }
    if (length + extra <= out.length) {
      return;
    }
    let size = Math.max(out.length * 2, 1024);
    while (size < length + extra) {
      size *= 2;
    }
    size = Math.min(size, MAX_DECODED_BYTES);
    const grown = Buffer.alloc(size);
    out.copy(grown, 0, 0, length);
    out = grown;
  };

  let pos = 0;

  while (pos < input.length) {
    const token = input[pos++];
    let literalLength = token >> 4;
    if (literalLength === 15) {
      let extension: number;
      do {
        if (pos >= input.length) {
          throw new Error('Truncated LZ4 literal length.');
        }
        extension = input[pos++];
        literalLength += extension;
      } while (extension === 255);
    }
    ensure(literalLength);
    // A short read must not advance `length`: the gap would stay
    // uninitialized and leak into the decoded text.
    const copied = input.copy(out, length, pos, pos + literalLength);
    if (copied !== literalLength) {
      throw new Error('Truncated LZ4 literal run.');
    }
    pos += copied;
    length += copied;
    if (pos >= input.length) {
      break;
    }

    if (pos + 1 >= input.length) {
      throw new Error('Truncated LZ4 match offset.');
    }
    const offset = input[pos] | (input[pos + 1] << 8);
    pos += 2;
    let matchLength = token & 0x0f;
    if (matchLength === 15) {
      let extension: number;
      do {
        if (pos >= input.length) {
          throw new Error('Truncated LZ4 match length.');
        }
        extension = input[pos++];
        matchLength += extension;
      } while (extension === 255);
    }
    matchLength += 4;

    const matchPos = length - offset;
    if (matchPos < 0 || offset === 0) {
      throw new Error('Invalid LZ4 match offset.');
    }
    ensure(matchLength);
    for (let i = 0; i < matchLength; i++) {
      out[length++] = out[matchPos + i];
    }
  }

  return out.subarray(0, length);
}

/** Decode a Firefox mozLz4 container (8-byte magic + size + LZ4 block). */
export function decodeMozLz4(raw: Buffer): string {
  if (raw.subarray(0, 8).toString('latin1') !== 'mozLz40\0') {
    throw new Error('Not a mozLz4 file.');
  }
  const size = raw.readUInt32LE(8);
  return lz4BlockDecode(raw.subarray(12), size).toString('utf8');
}

export function parseContainersJson(text: string): readonly ContainerIdentity[] {
  let parsed: { identities?: unknown[] };
  try {
    parsed = JSON.parse(text) as { identities?: unknown[] };
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.identities)) {
    return [];
  }

  const identities: ContainerIdentity[] = [];
  for (const entry of parsed.identities) {
    // One malformed entry must not throw away every valid identity.
    if (entry === null || typeof entry !== 'object') {
      continue;
    }
    const identity = entry as {
      userContextId?: unknown;
      name?: unknown;
      icon?: unknown;
      color?: unknown;
      public?: unknown;
    };
    if (!Number.isSafeInteger(identity.userContextId)) {
      continue;
    }
    identities.push({
      userContextId: identity.userContextId as number,
      ...(typeof identity.name === 'string' && identity.name !== '' ? { name: identity.name } : {}),
      ...(typeof identity.icon === 'string' && identity.icon !== '' ? { icon: identity.icon } : {}),
      ...(typeof identity.color === 'string' && identity.color !== '' ? { color: identity.color } : {}),
      isPublic: identity.public === true,
    });
  }
  return identities;
}

/**
 * Extract space definitions from the session store. Objects look like
 * `{"uuid":"{...}","name":"...","theme":{...},"containerTabId":N,...}`;
 * the anchor regex hits inside the object, so scanning resumes from the
 * nearest preceding `{` and parses a balanced object. The anchor tolerates
 * whitespace and any key order, so a Zen format change does not silently
 * empty the list.
 */
export function parseSpaces(text: string): readonly SpaceInfo[] {
  const spaces: SpaceInfo[] = [];
  const anchor = /"uuid"\s*:\s*"\{[0-9a-fA-F-]+\}"/g;
  let match: RegExpExecArray | null;

  while ((match = anchor.exec(text)) !== null) {
    // The anchor can sit inside a nested object (a theme before the uuid, for
    // example), so walk back over opening braces until one object parses as a
    // space. The nearest enclosing brace is tried first.
    let searchFrom = match.index;
    for (let attempt = 0; attempt < MAX_BRACE_CANDIDATES; attempt++) {
      const objStart = text.lastIndexOf('{', searchFrom - 1);
      if (objStart < 0) {
        break;
      }
      const obj = readBalancedObject(text, objStart);
      if (obj === null || obj.length > MAX_SPACE_OBJECT_CHARS) {
        break;
      }
      const space = parseSpaceObject(obj);
      if (space !== undefined) {
        spaces.push(space);
        anchor.lastIndex = objStart + obj.length;
        break;
      }
      searchFrom = objStart;
    }
  }
  return spaces;
}

/** Parse one candidate object as a Zen space. Pure. */
function parseSpaceObject(obj: string): SpaceInfo | undefined {
  let parsed: {
    uuid?: unknown;
    name?: unknown;
    theme?: { type?: unknown };
    containerTabId?: unknown;
  };
  try {
    parsed = JSON.parse(obj) as typeof parsed;
  } catch {
    return undefined;
  }
  if (typeof parsed.uuid !== 'string' || typeof parsed.name !== 'string') {
    return undefined;
  }
  return {
    uuid: parsed.uuid,
    name: parsed.name,
    ...(typeof parsed.theme?.type === 'string' ? { themeType: parsed.theme.type } : {}),
    ...(typeof parsed.containerTabId === 'number' ? { containerId: parsed.containerTabId } : {}),
  };
}

/** Read the `{...}` JSON object starting at `start`. Pure text scan. */
function readBalancedObject(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

/**
 * Join BiDi user context ids (uuids, 'default' first in id order) with
 * containers.json identities. Verified on Firefox 158/Zen 1.23: BiDi lists
 * public containers in internal-id order; names join positionally. The
 * "default" context has no containers.json identity.
 *
 * The join is positional because Firefox exposes no id bridge, so it is only
 * trustworthy while the counts line up. A mismatch means a name could land on
 * the wrong container — names are dropped instead.
 */
export function joinContainerNames(
  bidiIds: readonly string[],
  containers: readonly ContainerIdentity[]
): ContainerNameJoin {
  const byId = [...containers]
    .filter((identity) => identity.isPublic)
    .sort((a, b) => a.userContextId - b.userContextId);

  const names = new Map<string, ContainerIdentity>();
  const nonDefault = bidiIds.filter((id) => id !== 'default');

  if (nonDefault.length !== byId.length) {
    return { names, aligned: false };
  }

  nonDefault.forEach((id, index) => {
    const identity = byId[index];
    if (identity !== undefined) {
      names.set(id, identity);
    }
  });
  return { names, aligned: true };
}

/** Read container identities only. Never touches the session store. */
export function readContainers(profilePath: string): readonly ContainerIdentity[] {
  const read = readBoundedFile(join(profilePath, CONTAINERS_FILE), MAX_CONTAINERS_BYTES);
  if (!read.ok) {
    return [];
  }
  try {
    return parseContainersJson(read.data.toString('utf8'));
  } catch {
    return [];
  }
}

export interface SpacesReadResult {
  readonly spaces: readonly SpaceInfo[];
  readonly warnings: readonly string[];
}

/**
 * Read Zen spaces from the session store. The file can hold open-tab URLs and
 * form state — only derived metadata (uuid, name, theme, container id) leaves
 * this function.
 */
export function readSpaces(profilePath: string): SpacesReadResult {
  const warnings: string[] = [];
  const spaces: SpaceInfo[] = [];
  const sessionsPath = join(profilePath, ZEN_SESSIONS_FILE);
  if (!existsSync(sessionsPath)) {
    return { spaces, warnings };
  }
  const read = readBoundedFile(sessionsPath, MAX_SESSION_STORE_BYTES);
  if (!read.ok) {
    return {
      spaces,
      warnings: read.tooLarge
        ? [
            `Session store is over the ${MAX_SESSION_STORE_BYTES}-byte limit; Zen spaces were skipped.`,
          ]
        : ['Session store could not be read; Zen spaces were skipped.'],
    };
  }

  try {
    spaces.push(...parseSpaces(decodeMozLz4(read.data)));
  } catch (error) {
    warnings.push(
      `Could not decode the session store: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return { spaces, warnings };
}

/** Read profile data; missing files degrade to empty lists. */
export function readProfileStore(profilePath: string): ProfileStore {
  const { spaces, warnings } = readSpaces(profilePath);
  return { containers: readContainers(profilePath), spaces, warnings };
}
