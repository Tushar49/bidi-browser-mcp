import type {
  BiDiClientLike,
  BiDiEvent,
  ContextManagerLike,
  TabInfo,
} from '../types.js';
import { ActionableError } from '../utils/errors.js';

interface CachedTab {
  readonly context: string;
  url: string;
  children: number;
  userContext?: string;
}

/**
 * Tracks top-level tabs for the live session. The browser stays the source of
 * truth (list() re-reads the tree); events only keep the cache and selection
 * consistent between calls.
 */
export class ContextManager implements ContextManagerLike {
  readonly #client: BiDiClientLike;
  readonly #tabs = new Map<string, CachedTab>();
  /** Last URL seen in the tree per context, to spot a stale tree after SPA navigation. */
  readonly #lastTreeUrl = new Map<string, string>();
  /** URL reported by a browsingContext event, which can be newer than the tree. */
  readonly #eventUrl = new Map<string, string>();
  #selected?: string;

  constructor(client: BiDiClientLike) {
    this.#client = client;
  }

  /** Seed the cache from the current tree. Called right after connect. */
  async sync(): Promise<void> {
    const tree = await this.#client.request('browsingContext.getTree', { maxDepth: 1 });
    this.#mergeTree(tree);
  }

  async list(): Promise<readonly TabInfo[]> {
    const tree = await this.#client.request('browsingContext.getTree', { maxDepth: 1 });
    this.#mergeTree(tree);

    const tabs = [...this.#tabs.values()];
    const selected = this.#resolveSelectedId(tabs);
    return tabs.map((tab) => ({
      context: tab.context,
      url: tab.url,
      ...(tab.children > 0 ? { children: tab.children } : {}),
      ...(tab.userContext === undefined ? {} : { userContext: tab.userContext }),
      ...(tab.context === selected ? { selected: true } : {}),
    }));
  }

  async ensureContext(context?: string): Promise<string> {
    if (context !== undefined && context !== '') {
      // The id may be a frame context, which the top-level tree does not
      // list — existence is checked by the browser when the id is used.
      return context;
    }

    const tabs = [...this.#tabs.values()];
    const selected = this.#resolveSelectedId(tabs);
    const fallback = tabs.find((tab) => tab.context === selected) ?? tabs[0];
    if (fallback === undefined) {
      throw new ActionableError('CONTEXT_NOT_FOUND', 'No browsing contexts are open.', {
        fix: 'Open a tab, or use tabs.new to create one.',
      });
    }
    return fallback.context;
  }

  async select(context: string): Promise<TabInfo> {
    const tabs = await this.list();
    const tab = tabs.find((candidate) => candidate.context === context);
    if (tab === undefined) {
      throw new ActionableError('TAB_NOT_FOUND', `Unknown context: ${context}.`, {
        fix: 'Call tabs.list to see open contexts.',
        details: { open: tabs.map((candidate) => candidate.context) },
      });
    }

    this.#selected = context;
    return { ...tab, selected: true };
  }

  handleEvent(event: BiDiEvent): void {
    const params = event.params as { context?: unknown; url?: unknown };
    const context = typeof params.context === 'string' ? params.context : undefined;
    if (context === undefined) {
      return;
    }

    switch (event.method) {
      case 'browsingContext.contextCreated':
        this.#tabs.set(context, { context, url: '', children: 0 });
        break;
      case 'browsingContext.contextDestroyed':
        this.#tabs.delete(context);
        this.#lastTreeUrl.delete(context);
        this.#eventUrl.delete(context);
        if (this.#selected === context) {
          this.#selected = undefined;
        }
        break;
      case 'browsingContext.domContentLoaded':
      case 'browsingContext.urlChanged':
        // urlChanged fires on SPA navigation, where no domContentLoaded
        // arrives — without it, tabs.list keeps a stale URL.
        if (typeof params.url === 'string') {
          const tab = this.#tabs.get(context);
          if (tab !== undefined) {
            tab.url = params.url;
          } else {
            this.#tabs.set(context, { context, url: params.url, children: 0 });
          }
          // Remember that this URL came from an event: the tree may still
          // report the previous one.
          this.#eventUrl.set(context, params.url);
        }
        break;
      default:
        break;
    }
  }

  forget(context: string): void {
    this.#tabs.delete(context);
    this.#lastTreeUrl.delete(context);
    this.#eventUrl.delete(context);
    if (this.#selected === context) {
      this.#selected = undefined;
    }
  }

  #mergeTree(tree: Record<string, unknown>): void {
    const contexts = tree.contexts;
    if (!Array.isArray(contexts)) {
      return;
    }

    const seen = new Set<string>();
    for (const entry of contexts) {
      if (entry === null || typeof entry !== 'object') {
        continue;
      }
      const node = entry as {
        context?: unknown;
        url?: unknown;
        children?: unknown;
        userContext?: unknown;
      };
      if (typeof node.context !== 'string') {
        continue;
      }
      seen.add(node.context);
      const children = Array.isArray(node.children) ? node.children.length : 0;
      const existing = this.#tabs.get(node.context);
      const treeUrl = typeof node.url === 'string' && node.url !== '' ? node.url : undefined;
      const previousTreeUrl = this.#lastTreeUrl.get(node.context);

      // A urlChanged event (SPA navigation) can be newer than the tree
      // snapshot. Keep the event URL while the tree still reports the old
      // one; once the tree moves, the tree wins.
      const treeMoved =
        previousTreeUrl !== undefined &&
        treeUrl !== undefined &&
        treeUrl !== previousTreeUrl;
      if (treeMoved) {
        // The tree reports a newer navigation — the event URL is superseded.
        this.#eventUrl.delete(node.context);
      }
      const eventUrl = this.#eventUrl.get(node.context);
      if (eventUrl !== undefined && treeUrl === eventUrl) {
        // The tree caught up with the event.
        this.#eventUrl.delete(node.context);
      }

      this.#tabs.set(node.context, {
        context: node.context,
        url:
          eventUrl !== undefined && treeUrl !== undefined && treeUrl !== eventUrl
            ? eventUrl
            : (treeUrl ?? existing?.url ?? eventUrl ?? ''),
        children,
        ...(typeof node.userContext === 'string'
          ? { userContext: node.userContext }
          : existing?.userContext === undefined
            ? {}
            : { userContext: existing.userContext }),
      });

      if (treeUrl !== undefined) {
        this.#lastTreeUrl.set(node.context, treeUrl);
      }
    }

    for (const context of [...this.#tabs.keys()]) {
      if (!seen.has(context)) {
        this.#tabs.delete(context);
        this.#lastTreeUrl.delete(context);
        this.#eventUrl.delete(context);
        if (this.#selected === context) {
          this.#selected = undefined;
        }
      }
    }
  }

  #resolveSelectedId(tabs: readonly CachedTab[]): string | undefined {
    if (this.#selected !== undefined && tabs.some((tab) => tab.context === this.#selected)) {
      return this.#selected;
    }
    return tabs[0]?.context;
  }
}
