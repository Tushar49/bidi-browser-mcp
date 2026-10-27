import type { BiDiEvent, PageSnapshot, SnapshotCacheLike } from '../types.js';

/**
 * Per-context snapshot cache. Entries live until the page navigates
 * (domContentLoaded), the context closes, or the session ends — the browser
 * tree and page events are the source of truth, so there is no TTL.
 */
export class SnapshotCache implements SnapshotCacheLike {
  readonly #entries = new Map<string, PageSnapshot>();

  get(context: string): PageSnapshot | undefined {
    return this.#entries.get(context);
  }

  set(snapshot: PageSnapshot): void {
    this.#entries.set(snapshot.context, snapshot);
  }

  invalidate(context: string): void {
    this.#entries.delete(context);
  }

  handleEvent(event: BiDiEvent): void {
    const context = event.params.context;
    if (typeof context !== 'string') {
      return;
    }
    if (
      event.method === 'browsingContext.domContentLoaded' ||
      // A SPA navigation changes the URL without a domContentLoaded event, so
      // the cached snapshot would describe a page that no longer exists.
      event.method === 'browsingContext.urlChanged' ||
      event.method === 'browsingContext.contextDestroyed'
    ) {
      this.#entries.delete(context);
    }
  }

  clear(): void {
    this.#entries.clear();
  }

  get size(): number {
    return this.#entries.size;
  }
}
