/**
 * Core types for the @animus-labs/cortex package.
 *
 * These types define the public API surface for CortexAgent configuration,
 * context management, error classification, working tags, budget guards,
 * compaction, events, and model tiers.
 *
 * References:
 *   - cortex-architecture.md
 *   - context-manager.md
 *   - model-tiers.md
 *   - error-recovery.md
 *   - working-tags.md
 */

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * The lifecycle state of a CortexAgent instance.
 *
 * CREATED -> ACTIVE -> DESTROYED
 *
 * abort() returns the agent to ACTIVE (still usable).
 * destroy() transitions to DESTROYED (all resources released).
 */
export type CortexLifecycleState = 'created' | 'active' | 'destroyed';

// ---------------------------------------------------------------------------
// Agent Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for creating a CortexAgent instance.
 *
 * The `model` field accepts any pi-ai Model object. It is typed as `unknown`
 * here to avoid a hard runtime dependency on pi-ai; the actual type is
 * `Model` from `@mariozechner/pi-ai`. Consumers pass a real Model object
 * at construction time.
 */
export interface CortexAgentConfig {
  /** Primary model for the agentic loop, THOUGHT, REFLECT, and all consumer-facing work. */
  model: unknown;

  /**
   * Utility model for internal operations (WebFetch summarization, safety classifier).
   * - `'default'`: Cortex selects from a built-in mapping based on the primary model's provider.
   * - A Model object: explicit utility model (must be same provider as primary).
   * - `undefined`: same as `'default'`.
   */
  utilityModel?: unknown | 'default';

  /** Working directory for file operations (Bash, Read, Write, Edit, Glob, Grep). */
  workingDirectory: string;

  /**
   * Callback to resolve API keys by provider name.
   * Throws on failure (classified as authentication error).
   * Returns the API key string on success. Must never return empty string.
   */
  getApiKey?: (provider: string) => Promise<string>;

  /** Ordered list of context slot names. Order defines position in the message array. */
  slots?: string[];

  /** Working tags configuration. */
  workingTags?: {
    /** Whether to enable working tags. Default: true. */
    enabled?: boolean;
  };

  /** Budget guard configuration. */
  budgetGuard?: {
    /** Maximum number of LLM turns before force-stopping the loop. Default: Infinity. */
    maxTurns?: number;
    /** Maximum cost in USD before force-stopping the loop. Default: Infinity. */
    maxCost?: number;
  };

  /** Maximum number of concurrent sub-agents. */
  maxConcurrentSubAgents?: number;

  /** WebFetch tool configuration. */
  webFetch?: {
    /** Maximum number of web fetches per agentic loop. */
    maxPerLoop?: number;
  };

  /** Bash tool configuration. */
  bash?: {
    /** Token threshold at which Bash auto-yields control back to the agent. */
    autoYieldThreshold?: number;
    /** Path to the shell executable. */
    shellPath?: string;
  };

  /**
   * Tool permission resolver callback.
   * Called before each tool execution. Return true to allow, false to block.
   * Throw to block with an error message.
   * If not provided, all tools are allowed.
   */
  resolvePermission?: (toolName: string, toolArgs: unknown) => Promise<boolean>;

  /** Compaction configuration. All layers are always active. */
  compaction?: Partial<CortexCompactionConfig>;
}

// ---------------------------------------------------------------------------
// Context Manager
// ---------------------------------------------------------------------------

/**
 * Configuration for the ContextManager.
 *
 * Slots define the ordered list of persistent content blocks at the start
 * of the message array. Order determines position (first = most stable,
 * best prefix cache hit rate).
 */
export interface ContextManagerConfig {
  /** Ordered list of slot names. */
  slots: string[];
}

// ---------------------------------------------------------------------------
// Error Classification
// ---------------------------------------------------------------------------

/**
 * Error categories for classifying LLM and network errors.
 * Checked in priority order (first match wins).
 */
export type ErrorCategory =
  | 'authentication'
  | 'rate_limit'
  | 'context_overflow'
  | 'server_error'
  | 'network'
  | 'cancelled'
  | 'unknown';

/**
 * Error severity levels.
 * - fatal: unrecoverable, stop processing (e.g., invalid API key)
 * - retry: transient, can be retried (e.g., rate limit, server error, network)
 * - recoverable: can be handled without retry (e.g., context overflow triggers compaction)
 */
export type ErrorSeverity = 'fatal' | 'retry' | 'recoverable';

/**
 * A classified error with category, severity, original message, and suggested action.
 */
export interface ClassifiedError {
  /** The error category determined by pattern matching. */
  category: ErrorCategory;
  /** The severity level for the category. */
  severity: ErrorSeverity;
  /** The original error message string. */
  originalMessage: string;
  /** Human-readable suggested action, or undefined if no action is needed. */
  suggestedAction?: string;
}

// ---------------------------------------------------------------------------
// Working Tags
// ---------------------------------------------------------------------------

/**
 * Structured output from parsing working tags in agent text.
 *
 * Working tags separate internal reasoning (<working>...</working>) from
 * user-facing communication. Both remain in conversation history; the
 * difference is only in delivery.
 */
export interface AgentTextOutput {
  /** Text intended for the user (working tag content stripped, whitespace normalized). */
  userFacing: string;
  /** Content from inside <working> tags, concatenated. Null if no working tags present. */
  working: string | null;
  /** The original unparsed text exactly as the agent produced it. */
  raw: string;
}

// ---------------------------------------------------------------------------
// Tool Results
// ---------------------------------------------------------------------------

/**
 * Structured tool result with content array and typed details.
 */
export interface ToolContentDetails<T> {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
  >;
  details: T;
}

// ---------------------------------------------------------------------------
// Budget Guard
// ---------------------------------------------------------------------------

/**
 * Budget guard configuration with explicit limits.
 * Both default to Infinity (no enforcement).
 */
export interface BudgetGuardConfig {
  /** Maximum number of LLM turns. Default: Infinity. */
  maxTurns: number;
  /** Maximum cost in USD. Default: Infinity. */
  maxCost: number;
}

// ---------------------------------------------------------------------------
// Compaction
// ---------------------------------------------------------------------------

/**
 * Tool category for microcompaction retention decisions.
 * - rereadable: agent can re-read the source (files, directories)
 * - non-reproducible: output may change or cost to re-fetch (web, APIs)
 * - ephemeral: stale quickly, trivially re-runnable (ls, git status)
 * - computational: small results from computations, non-reproducible without re-running
 */
export type ToolCategory = 'rereadable' | 'non-reproducible' | 'ephemeral' | 'computational';

/**
 * Microcompaction configuration: progressive tool result trimming.
 */
export interface MicrocompactionConfig {
  /** Maximum tokens for a single tool result at insertion time. Default: 50000. */
  maxResultTokens: number;
  /** Context usage ratio that triggers soft trim (bookending). Default: 0.40. */
  softTrimThreshold: number;
  /** Context usage ratio that triggers hard clear. Default: 0.60. */
  hardClearThreshold: number;
  /** Characters kept at each end in bookend format. Default: 2000. */
  bookendSize: number;
  /** Number of recent assistant turns protected from trimming. Default: 5. */
  preserveRecentTurns: number;
  /** Retention multiplier for non-reproducible tools. Default: 2. */
  extendedRetentionMultiplier: number;
  /** Tool name to category mapping. Unregistered tools default to standard retention. */
  toolCategories?: Record<string, ToolCategory>;
}

/**
 * Conversation summarization (Layer 2) configuration.
 */
export interface CompactionConfig {
  /** Context usage ratio that triggers summarization. Default: 0.70. */
  threshold: number;
  /** Number of recent turns preserved verbatim. Default: 6. */
  preserveRecentTurns: number;
  /** Custom summarization prompt. If provided, replaces the default prompt. */
  customPrompt?: string;
}

/**
 * Emergency truncation (Layer 3) configuration.
 */
export interface FailsafeConfig {
  /** Context usage ratio that triggers emergency truncation. Default: 0.90. */
  threshold: number;
}

/**
 * Full compaction configuration for CortexAgent.
 * All three layers are always active; there are no enabled toggles.
 */
export interface CortexCompactionConfig {
  microcompaction: MicrocompactionConfig;
  compaction: CompactionConfig;
  failsafe: FailsafeConfig;
}

/**
 * Information about the compaction target passed to onBeforeCompaction.
 */
export interface CompactionTarget {
  /** Number of turns that will be summarized. */
  turnsToCompact: number;
  /** Estimated tokens in the compaction target. */
  estimatedTokens: number;
}

/**
 * Result of a compaction operation.
 */
export interface CompactionResult {
  /** Total tokens before compaction. */
  tokensBefore: number;
  /** Total tokens after compaction. */
  tokensAfter: number;
  /** Number of conversation turns that were compacted (summarized/removed). */
  turnsCompacted: number;
  /** Number of conversation turns preserved after compaction. */
  turnsPreserved: number;
  /** Token count of the generated summary. */
  summaryTokens: number;
  /** ISO timestamp of the oldest preserved turn. */
  oldestPreservedTimestamp: string;
  /** The generated summary text. */
  summary: string;
}

/**
 * Pipeline phase flag. Prevents Layer 2 from firing mid-tick.
 * - idle: between ticks, compaction allowed
 * - thought: THOUGHT phase in progress
 * - agentic_loop: agentic loop in progress
 * - reflect: REFLECT phase in progress
 * - execute: EXECUTE phase in progress
 */
export type PipelinePhase = 'idle' | 'thought' | 'agentic_loop' | 'reflect' | 'execute';

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * Event handlers emitted by CortexAgent during the agentic loop lifecycle.
 */
export interface CortexEvents {
  /** Fired when the full agentic loop finishes (agent_end, not turn_end). */
  onLoopComplete: () => void;
  /** Fired before compaction starts. Awaited. Consumer should flush state. */
  onBeforeCompaction: (target: CompactionTarget) => Promise<void>;
  /** Fired when context compaction completes successfully. */
  onCompaction: (result: CompactionResult) => void;
  /** Fired when context compaction fails. */
  onCompactionError: (error: Error) => void;
  /** Fired when an error is classified during the agentic loop. */
  onError: (error: ClassifiedError) => void;
  /** Fired at the end of each turn with parsed working tag output. */
  onTurnComplete: (output: AgentTextOutput) => void;
  /** Fired when a sub-agent is spawned for delegated work. */
  onSubAgentSpawned: (taskId: string, instructions: string) => void;
  /** Fired when a sub-agent completes successfully. */
  onSubAgentCompleted: (taskId: string, result: string, status: string, usage: unknown) => void;
  /** Fired when a sub-agent fails. */
  onSubAgentFailed: (taskId: string, error: string) => void;
}

// ---------------------------------------------------------------------------
// MCP Client
// ---------------------------------------------------------------------------

/**
 * Transport configuration for connecting to an MCP server.
 * Either stdio (spawn subprocess) or HTTP (connect to running server).
 */
export type McpTransportConfig = McpStdioConfig | McpHttpConfig;

/**
 * Stdio transport: spawn a subprocess and communicate via stdin/stdout.
 */
export interface McpStdioConfig {
  transport: 'stdio';
  /** The executable to run (e.g., 'node', '/path/to/tsx'). */
  command: string;
  /** Command line arguments. */
  args?: string[];
  /** Environment variables for the subprocess. */
  env?: Record<string, string>;
  /** Working directory for the subprocess. */
  cwd?: string;
}

/**
 * HTTP transport: connect to an already-running MCP server via Streamable HTTP.
 */
export interface McpHttpConfig {
  transport: 'http';
  /** The URL of the MCP server endpoint. */
  url: string;
  /** Optional HTTP headers (e.g., for authentication). */
  headers?: Record<string, string>;
}

/**
 * State of a single MCP server connection.
 */
export interface McpConnectionState {
  /** The server name used for namespacing tools. */
  serverName: string;
  /** Transport configuration used for this connection. */
  config: McpTransportConfig;
  /** Whether the connection is currently active. */
  connected: boolean;
  /** Number of reconnect attempts since last successful connection. */
  reconnectAttempts: number;
  /** Names of tools discovered from this server (namespaced). */
  toolNames: string[];
}

// ---------------------------------------------------------------------------
// Model Tiers
// ---------------------------------------------------------------------------

/**
 * Default utility model mapping per provider.
 * Keys are provider names, values are model IDs.
 */
export interface UtilityModelDefaults {
  [provider: string]: string;
}
