/**
 * Unwrap one BiDi serialized value into plain JS.
 *
 * BiDi encodes objects as `{type: 'object', value: [[key, serialized], …]}`,
 * arrays as `{type: 'array', value: [...]}`, primitives as `{type, value}`,
 * null as `{type: 'null'}`, and element references as
 * `{type: 'element', value: {sharedId, handle?}}`. Tools consume plain values,
 * so the unwrap lives here once and every consumer keeps the same semantics.
 */
export function unwrapBiDiValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.type !== 'string') {
    return record;
  }

  switch (record.type) {
    case 'null':
      return null;
    case 'undefined':
      return undefined;
    case 'object': {
      const inner = record.value;
      if (!Array.isArray(inner)) {
        return unwrapBiDiValue(inner);
      }
      const result: Record<string, unknown> = {};
      for (const entry of inner) {
        if (Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string') {
          result[entry[0]] = unwrapBiDiValue(entry[1]);
        }
      }
      return result;
    }
    case 'array': {
      const inner = record.value;
      return Array.isArray(inner) ? inner.map((item) => unwrapBiDiValue(item)) : [];
    }
    case 'node':
      // Firefox serializes DOM nodes as `{type:'node', sharedId, handle?}`;
      // keep the reference (input.setFiles consumes it) instead of the value.
      // Chromium dedupes repeat nodes to `internalId` only.
      return {
        ...(typeof record.sharedId === 'string' ? { sharedId: record.sharedId } : {}),
        ...(typeof record.internalId === 'string' ? { internalId: record.internalId } : {}),
        ...(record.handle === undefined ? {} : { handle: record.handle }),
      };
    default:
      return 'value' in record ? unwrapBiDiValue(record.value) : record;
  }
}
