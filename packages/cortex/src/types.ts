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
// Usage
// ---------------------------------------------------------------------------

/**
 * Token usage and cost data from a single LLM call.
 * Mirrors the pi-ai AssistantMessage.usage structure but is decoupled
 * from pi-ai's types to avoid hard runtime dependencies.
 */
export interface CortexUsage {
  /** Input (prompt) tokens. */
  input: number;
  /** Output (completion) tokens. */
  output: number;
  /** Cache-read tokens (tokens served from cache). */
  cacheRead: number;
  /** Cache-write tokens (tokens written to cache). */
  cacheWrite: number;
  /** Total tokens (input + output). */
  totalTokens: number;
  /** Cost breakdown in USD. */
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  /** Model identifier string (if available from the response). */
  model?: string;
}

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
   * Initial application/base prompt.
   * Cortex composes its operational sections around this prompt.
   */
  initialBasePrompt?: string;

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

  /**
   * Limit the effective context window for compaction calculations.
   * Clamped to min(limit, model.contextWindow) with a floor of MINIMUM_CONTEXT_WINDOW (16K).
   * null or undefined = use the default limit of min(100K, model.contextWindow).
   * To use the model's full context window, pass the model's contextWindow value explicitly.
   */
  contextWindowLimit?: number | null;

  /** Compaction configuration. All layers are always active. */
  compaction?: Partial<CortexCompactionConfig>;

  /**
   * Consumer-set environment variables that propagate to ALL subprocesses
   * (Bash tool, MCP stdio servers), bypassing the security blocklist.
   *
   * Use case: macOS dock icon suppression requires DYLD_INSERT_LIBRARIES
   * and ANIMUS_DOCK_SUPPRESS_ADDON to propagate to child processes, but
   * the safe-env blocklist strips DYLD_ prefixed variables by default.
   * envOverrides are merged ON TOP of the sanitized environment, restoring
   * these specific variables.
   */
  envOverrides?: Record<string, string>;
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
/**
 * Callback invoked when microcompaction persists a cleared tool result to disk.
 * The consumer implements the actual I/O and returns the file path.
 *
 * @param content - The full original tool result content
 * @param metadata - Information about the result being persisted
 * @returns The file path where the content was saved
 */
export type PersistResultFn = (
  content: string,
  metadata: { toolName: string; messageIndex: number; category: ToolCategory },
) => Promise<string>;

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
  /**
   * Callback to persist cleared non-reproducible tool results to disk.
   * When set, cleared results include a file path reference the agent can Read.
   * If not set, standard placeholder/clear text is used (no persistence).
   */
  persistResult?: PersistResultFn;
  /** Maximum aggregate tokens for all tool results in a single turn. Default: 150000. */
  maxAggregateTurnTokens?: number;
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
  /** Maximum Layer 2 retry attempts before falling through to Layer 3. Default: 3. */
  maxRetries?: number;
  /** Delay in ms between Layer 2 retry attempts. Default: 2000. */
  retryDelayMs?: number;
}

/**
 * Emergency truncation (Layer 3) configuration.
 */
export interface FailsafeConfig {
  /** Context usage ratio that triggers emergency truncation. Default: 0.90. */
  threshold: number;
}

/**
 * Adaptive threshold configuration for Layer 2 compaction.
 *
 * Adjusts the compaction trigger point based on how recently the user last
 * interacted. When the user is idle (no messages for a while), the threshold
 * is lowered so compaction fires earlier, reducing token costs during interval
 * ticks where the agent is thinking to itself.
 *
 * Three windows:
 * - Recent (< recentWindowMs): no threshold reduction
 * - Moderate (recentWindowMs .. idleWindowMs): moderateReduction applied
 * - Idle (> idleWindowMs): idleReduction applied
 *
 * The effective threshold is: config.compaction.threshold - reduction
 */
export interface AdaptiveThresholdConfig {
  /** Whether adaptive thresholds are enabled. Default: true. */
  enabled: boolean;
  /** Milliseconds within which interaction is considered "recent". Default: 300000 (5 min). */
  recentWindowMs: number;
  /** Milliseconds beyond which interaction is considered "idle". Default: 1800000 (30 min). */
  idleWindowMs: number;
  /** Threshold reduction when interaction is recent. Default: 0.0. */
  recentReduction: number;
  /** Threshold reduction when interaction is moderate. Default: 0.10. */
  moderateReduction: number;
  /** Threshold reduction when interaction is idle. Default: 0.20. */
  idleReduction: number;
}

/**
 * Full compaction configuration for CortexAgent.
 * All three layers are always active; there are no enabled toggles.
 */
export interface CortexCompactionConfig {
  microcompaction: MicrocompactionConfig;
  compaction: CompactionConfig;
  failsafe: FailsafeConfig;
  /** Adaptive threshold configuration. Adjusts Layer 2 trigger based on interaction recency. */
  adaptive: AdaptiveThresholdConfig;
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
  /**
   * ISO timestamp of the oldest preserved turn, or null if no timestamp
   * could be determined. The consumer (backend) should use
   * `oldestPreservedIndex` to map back to a database timestamp when
   * this is null.
   */
  oldestPreservedTimestamp: string | null;
  /**
   * Index of the oldest preserved turn in the original (pre-compaction)
   * conversation history. The consumer can map this index back to a
   * database timestamp via messages.db. Always present and accurate.
   */
  oldestPreservedIndex: number;
  /** The generated summary text. */
  summary: string;
}

/**
 * Info passed to onCompactionDegraded when Layer 2 failed and Layer 3 was used.
 */
export interface CompactionDegradedInfo {
  /** Number of consecutive Layer 2 failures (including this episode). */
  layer2Failures: number;
  /** Number of turns dropped by emergency truncation. */
  turnsDropped: number;
}

/**
 * Info passed to onCompactionExhausted when all compaction layers have failed.
 */
export interface CompactionExhaustedInfo {
  /** The error from the last Layer 2 attempt. */
  error: Error;
  /** Number of consecutive Layer 2 failures. */
  layer2Failures: number;
}

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
  /** Fired after compaction completes. Consumer can re-seed messages, update state. */
  onPostCompaction: (result: CompactionResult) => void;
  /** Fired when context compaction fails. */
  onCompactionError: (error: Error) => void;
  /** Fired when Layer 2 compaction failed and Layer 3 (emergency truncation) was used as fallback. */
  onCompactionDegraded: (info: CompactionDegradedInfo) => void;
  /** Fired when all compaction layers have failed. Consumer should take recovery action. */
  onCompactionExhausted: (info: CompactionExhaustedInfo) => void;
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

// ---------------------------------------------------------------------------
// Skill System
// ---------------------------------------------------------------------------

/**
 * Configuration for registering a skill with the SkillRegistry.
 * The consumer provides these at startup and dynamically as plugins install/uninstall.
 */
export interface SkillConfig {
  /** Absolute path to the SKILL.md file. */
  path: string;
  /** Where this skill came from. Used for display and debugging. */
  source: string;  // e.g., 'plugin:weather', 'plugin:discord', 'user', 'builtin'
  /**
   * Per-skill variables for ${VAR} substitution in the SKILL.md body.
   * Merged into the preprocessor variables when getSkillBody() runs.
   * Useful for plugin skills that reference ${PLUGIN_ROOT}.
   */
  variables?: Record<string, string>;
}

/**
 * Internal skill index entry built from parsing a SKILL.md file.
 */
export interface SkillEntry {
  /** Skill name from frontmatter (kebab-case). */
  name: string;
  /** Skill description from frontmatter (for agent activation). */
  description: string;
  /** Absolute path to the SKILL.md file. */
  path: string;
  /** Absolute path to the skill directory (parent of SKILL.md). */
  dir: string;
  /** Source identifier from SkillConfig. */
  source: string;
  /** Full parsed YAML frontmatter (preserved for forward compatibility). */
  frontmatter: Record<string, unknown>;
  /** Whether the agent can auto-load this skill. Derived from disable-model-invocation. */
  modelInvocable: boolean;
  /** Per-skill variables for ${VAR} substitution. */
  variables?: Record<string, string>;
}

/**
 * A loaded skill in the skill buffer (preprocessed body ready for injection).
 */
export interface LoadedSkill {
  /** The skill name. */
  name: string;
  /** The preprocessed SKILL.md body content. */
  content: string;
}

/**
 * Context object passed to skill preprocessor scripts (!{script: path}).
 * Cortex owns the built-in fields; the consumer provides everything else.
 */
export interface CortexScriptContext {
  /** Absolute path to the skill's directory. */
  skillDir: string;
  /** Arguments passed to the skill (split by whitespace). */
  args: string[];
  /** Raw arguments string. */
  rawArgs: string;
  /** Additional key-value pairs from !{script: path, key: value} syntax. */
  scriptArgs: Record<string, string>;
  /** Consumer-provided context fields (Cortex does not inspect these). */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Sub-Agent
// ---------------------------------------------------------------------------

/**
 * Configuration for spawning a sub-agent via the SubAgent tool.
 */
export interface SubAgentSpawnConfig {
  /** What the sub-agent should do. Becomes the initial prompt. */
  instructions: string;
  /** Tool names to make available. Default: inherits parent's tools. */
  tools?: string[];
  /** Custom system prompt. Default: inherits parent's system prompt. */
  systemPrompt?: string;
  /** Maximum LLM turns. Default: inherits parent's budget guard config. */
  maxTurns?: number;
  /** Maximum cost in USD. Default: inherits parent's budget guard config. */
  maxCost?: number;
  /** Run asynchronously. Default: false (blocks until complete). */
  background?: boolean;
}

/**
 * Result returned by a completed sub-agent.
 */
export interface SubAgentResult {
  /** The sub-agent's final text output. */
  output: string;
  /** Completion status. */
  status: 'completed' | 'failed' | 'timed_out' | 'cancelled';
  /** Usage summary. */
  usage: {
    turns: number;
    cost: number;
    durationMs: number;
  };
}

/**
 * Tracked sub-agent record managed by SubAgentManager.
 */
export interface TrackedSubAgent {
  /** Unique task identifier. */
  taskId: string;
  /** The sub-agent CortexAgent instance. */
  agent: unknown; // CortexAgent (avoid circular import)
  /** The instructions the sub-agent was spawned with. */
  instructions: string;
  /** Whether this is a background sub-agent. */
  background: boolean;
  /** Spawn timestamp. */
  spawnedAt: number;
  /** Promise that resolves when the sub-agent completes. */
  completion: Promise<SubAgentResult>;
  /** Resolve function for the completion promise. */
  resolve: (result: SubAgentResult) => void;
}
