/**
 * Shared contracts. Keep this file free of runtime side effects.
 */

export type Toolset = 'core' | 'network' | 'devtools';
export type OutputMode = 'full' | 'inline' | 'file';

export interface Config {
  readonly host: string;
  readonly port: number;
  readonly wsUrl?: string;
  readonly profileDir?: string;
  readonly timeoutMs: number;
  readonly toolset: Toolset;
  readonly outputMode: OutputMode;
  readonly maxInlineLen: number;
  readonly tempDir: string;
  readonly appDataRoot: string;
  /** Local app-data root (Chromium data dirs live here on Windows). */
  readonly localAppDataRoot: string;
  readonly allowExtensionInstall: boolean;
  readonly allowBrowserClose: boolean;
  readonly allowRemote: boolean;
  readonly discoveryRoots: readonly string[];
  /** Chromium user-data dirs to look for a `DevToolsActivePort` file in. */
  readonly chromiumDataDirs: readonly string[];
}

export interface ServerContext {
  readonly version: string;
  readonly config: Config;
  readonly startedAt: number;
  readonly session?: SessionManagerLike;
}

export interface JsonSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ServerContext
) => Promise<ToolResult>;

export interface ToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly toolset: Toolset;
  readonly actions: readonly string[];
  readonly inputSchema: JsonSchema;
  readonly outputSchema?: JsonSchema;
  readonly annotations?: ToolAnnotations;
  readonly handler: ToolHandler;
}

export type ActionableErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_ARGUMENT'
  | 'INVALID_ACTION'
  | 'TOOL_NOT_FOUND'
  | 'DISCOVERY_FAILED'
  | 'SESSION_BUSY'
  | 'SESSION_FAILED'
  | 'CONNECTION_FAILED'
  | 'CONNECTION_CLOSED'
  | 'TIMEOUT'
  | 'CONTEXT_NOT_FOUND'
  | 'TAB_NOT_FOUND'
  | 'UID_NOT_FOUND'
  | 'FRAME_NOT_FOUND'
  | 'ELEMENT_NOT_FOUND'
  | 'NOT_INTERACTABLE'
  | 'STALE_UID'
  | 'NAVIGATION_FAILED'
  | 'SCRIPT_ERROR'
  | 'UNSUPPORTED'
  | 'MISSING_DEPENDENCY'
  | 'NETWORK_ERROR'
  | 'EXTENSION_ERROR'
  | 'INTERNAL_ERROR';

export interface ActionableErrorShape {
  code: ActionableErrorCode;
  message: string;
  fix?: string;
  details?: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  action: string;
  data?: unknown;
  error?: ActionableErrorShape;
  warnings?: string[];
}

export interface BiDiCommand {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface BiDiSuccess {
  type: 'success';
  id: number;
  result: Record<string, unknown>;
}

export interface BiDiError {
  type: 'error';
  id: number;
  /** BiDi error code, e.g. "invalid argument" (flat string, per spec). */
  error: string;
  /** Human-readable description. */
  message: string;
  stacktrace?: string;
}

export interface BiDiEvent {
  type: 'event';
  method: string;
  params: Record<string, unknown>;
}

export type BiDiResponse = BiDiSuccess | BiDiError;
export type BiDiMessage = BiDiResponse | BiDiEvent;

export type DiscoverySource =
  | 'env'
  | 'profile-file'
  | 'profiles-ini'
  | 'process-cmdline'
  | 'port-probe'
  | 'chromium-devtools-port';

/**
 * How the endpoint must be spoken to. Firefox-family browsers serve WebDriver
 * BiDi natively; Chromium serves CDP only, so the chromium-bidi mapper is
 * hosted in this process and translates.
 */
export type BrowserFamily = 'firefox' | 'chromium';

export interface DiscoveryCandidate {
  readonly endpoint: string;
  readonly source: DiscoverySource;
  readonly profilePath?: string;
  readonly processId?: number;
  readonly browserFamily?: BrowserFamily;
}

export interface BrowserCapabilities {
  readonly browserName?: string;
  readonly browserVersion?: string;
  readonly platformName?: string;
  readonly setWindowRect?: boolean;
  readonly userAgent?: string;
  readonly [key: string]: unknown;
}

export interface SessionStatus {
  readonly connected: boolean;
  readonly sessionId?: string;
  readonly browser?: BrowserCapabilities;
  readonly profile?: string;
  readonly contexts?: number;
}

export interface SessionManagerLike {
  status(): Promise<SessionStatus>;
  profiles(): Promise<readonly DiscoveryCandidate[]>;
  version(): Promise<{ serverVersion: string; browserVersion?: string }>;
  connect(): Promise<SessionStatus>;
  disconnect(): Promise<void>;
  /** Send a BiDi command on the live session. */
  request(
    method: string,
    params?: Record<string, unknown>
  ): Promise<Record<string, unknown>>;
  /**
   * Re-resolve a snapshot uid in the live page before dispatching input
   * commands (plan §3). Silent on a match; otherwise throws
   * UID_NOT_FOUND / ELEMENT_NOT_FOUND / STALE_UID.
   */
  verifyElement(snapshot: PageSnapshot, uid: string): Promise<void>;
  /** Present while a session is live; undefined after disconnect. */
  readonly runtime?: ConnectionRuntimeLike;
}

/** Minimal transport surface the connection/session layer needs. */
export interface BiDiClientLike {
  request(
    method: string,
    params?: Record<string, unknown>
  ): Promise<Record<string, unknown>>;
  onEvent(handler: (event: BiDiEvent) => void): () => void;
}

/** A top-level browsing context (tab) as seen by the context manager. */
export interface TabInfo {
  readonly context: string;
  readonly url: string;
  /** BiDi user context id ('default' or a uuid) when the browser reports it. */
  readonly userContext?: string;
  /** The tab tools default to; heuristic plus explicit `select`. */
  readonly selected?: boolean;
  readonly children?: number;
}

/** A browser container (user context): BiDi id joined with profile identity. */
export interface ContainerInfo {
  /** BiDi id: 'default' or a uuid. */
  readonly userContext: string;
  readonly name?: string;
  /** How the name was derived — Firefox exposes no id bridge, so it is positional. */
  readonly nameSource?: 'positional';
  readonly profileUserContextId?: number;
  readonly icon?: string;
  readonly color?: string;
  readonly tabCount?: number;
}

/** A Zen space joined with its bound container where possible. */
export interface SpaceListing {
  readonly uuid: string;
  readonly name: string;
  readonly themeType?: string;
  readonly containerId?: number;
  readonly containerName?: string;
  readonly containerUserContext?: string;
}

/** A buffered console (log.entryAdded) entry. */
export interface ConsoleEntry {
  readonly channel: string;
  readonly level: string;
  readonly text: string;
  readonly context?: string;
  readonly receivedAt: number;
}

/** A buffered raw BiDi event. */
export interface EventRecord {
  readonly method: string;
  readonly params: Record<string, unknown>;
  readonly receivedAt: number;
}

export interface EventFilter {
  readonly methods?: readonly string[];
  readonly context?: string;
  readonly limit?: number;
  /** Remove returned events from the buffer when true. */
  readonly drain?: boolean;
}

export interface RuntimeStats {
  readonly subscribed: readonly string[];
  readonly buffered: Readonly<Record<string, number>>;
  readonly dropped: Readonly<Record<string, number>>;
}

export interface EventPipelineLike {
  /** Buffer one incoming event. Called by the session wiring, not tools. */
  record(event: BiDiEvent): void;
  /** Return buffered events matching the filter; optionally drain them. */
  events(filter?: EventFilter): readonly EventRecord[];
  /** Buffered console entries mapped from log.eventAdded frames. */
  consoleEntries(filter?: {
    level?: string;
    context?: string;
    limit?: number;
  }): readonly ConsoleEntry[];
  /** Drop buffered console entries only. */
  clearConsole(): void;
  stats(): RuntimeStats;
  /** Unhook from the client. Safe to call more than once. */
  detach(): void;
}

export interface ContextManagerLike {
  /** Authoritative tab list (fresh getTree) merged with local selection. */
  list(): Promise<readonly TabInfo[]>;
  /** Resolve a tool's target context: explicit id, else the selected tab. */
  ensureContext(context?: string): Promise<string>;
  select(context: string): Promise<TabInfo>;
  /** Handle one incoming event. Called by the session wiring, not tools. */
  handleEvent(event: BiDiEvent): void;
  forget(context: string): void;
}

export interface ConnectionRuntimeLike {
  readonly events: EventPipelineLike;
  readonly contexts: ContextManagerLike;
  readonly snapshots: SnapshotCacheLike;
}

/** One interactive element in a page snapshot. */
export interface ElementInfo {
  readonly uid: string;
  readonly role: string;
  readonly name: string;
  readonly tag: string;
  /**
   * Size and position as [x, y, width, height] in document-space
   * coordinates (rect + the frame's scroll offsets at traverse time).
   */
  readonly bounds: readonly [number, number, number, number];
  /** CSS path within its document or shadow root. */
  readonly selector: string;
  /** Iframe chain (CSS paths), outermost frame first. */
  readonly frame?: readonly string[];
  /** CSS path of the shadow host, when the element lives in a shadow root. */
  readonly shadowHost?: string;
  /** Non-default states only (focused, disabled, checked, ...). */
  readonly states?: Readonly<Record<string, string | number | boolean>>;
}

/** A parsed page snapshot for one browsing context. */
export interface PageSnapshot {
  readonly context: string;
  readonly url: string;
  readonly title: string;
  readonly text: string;
  readonly elements: readonly ElementInfo[];
  /** Interactive elements the DOM cap dropped before serialization. */
  readonly droppedElements?: number;
  readonly builtAt: number;
}

/** Budget-fitting metadata for large snapshots. */
export interface TruncationMeta {
  readonly truncated: boolean;
  readonly originalChars: number;
  readonly omittedElements: number;
  readonly omittedTextChars: number;
}

export interface SnapshotCacheLike {
  get(context: string): PageSnapshot | undefined;
  set(snapshot: PageSnapshot): void;
  invalidate(context: string): void;
  /** Handle one incoming event (navigation/close invalidation). */
  handleEvent(event: BiDiEvent): void;
  clear(): void;
  readonly size: number;
}
