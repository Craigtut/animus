/**
 * Type definitions for the Codex App Server Protocol.
 *
 * Minimal subset of the JSON-RPC 2.0 protocol types used by
 * `codex app-server`. Covers thread/turn lifecycle, item notifications,
 * approval requests, and token usage.
 *
 * These types were manually extracted from the protocol schema.
 * To regenerate the full set: `codex app-server generate-ts`
 *
 * @see https://github.com/openai/codex/tree/main/codex-rs/app-server-protocol
 */

// ============================================================================
// JSON-RPC 2.0 Envelope Types
// ============================================================================

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ============================================================================
// Initialize Handshake
// ============================================================================

export interface InitializeParams {
  protocolVersion: string;
  capabilities?: Record<string, unknown>;
  clientInfo?: {
    name: string;
    version: string;
  };
}

export interface InitializeResult {
  /** Server returns `userAgent` string, not structured serverInfo */
  userAgent?: string;
  protocolVersion?: string;
  capabilities?: Record<string, unknown>;
  serverInfo?: {
    name: string;
    version: string;
  };
}

// ============================================================================
// Thread Types
// ============================================================================

export interface ThreadStartParams {
  model?: string;
  instructions?: string;
  cwd?: string;
  approvalPolicy?: AppServerApprovalPolicy;
  sandbox?: string;
  /**
   * Config overrides merged into the Codex config resolution pipeline.
   * Uses dotted-key format (e.g. "mcp_servers.tools.command" = "node").
   * MCP servers MUST be passed here, not as a top-level field.
   */
  config?: Record<string, unknown>;
}

export interface ThreadResumeParams {
  threadId: string;
}

export interface ThreadForkParams {
  threadId: string;
}

/**
 * Normalized thread result used by the adapter.
 * The raw protocol returns `{ thread: { id, ... }, model, ... }`;
 * the client normalizes this to `{ threadId }`.
 */
export interface Thread {
  threadId: string;
}

/** Raw thread object as returned by the Codex app-server */
export interface RawThreadObject {
  id: string;
  preview?: string;
  modelProvider?: string;
  createdAt?: number;
  updatedAt?: number;
  path?: string;
  cwd?: string;
  cliVersion?: string;
  source?: string;
  gitInfo?: unknown;
  turns?: unknown[];
}

/** Raw response from thread/start */
export interface RawThreadStartResult {
  thread: RawThreadObject;
  model?: string;
  modelProvider?: string;
  cwd?: string;
  approvalPolicy?: string;
  sandbox?: unknown;
  reasoningEffort?: string;
}

export type AppServerApprovalPolicy = 'never' | 'on-request' | 'on-failure' | 'untrusted';

// ============================================================================
// Turn Types
// ============================================================================

export interface TurnStartParams {
  threadId: string;
  input: TurnInput[];
}

export interface TurnSteerParams {
  threadId: string;
  input: TurnInput[];
  expectedTurnId?: string;
}

export interface TurnInterruptParams {
  threadId: string;
  turnId: string;
}

export type TurnInput =
  | { type: 'text'; text: string }
  | { type: 'local_image'; path: string };

/**
 * Normalized turn result used by the adapter.
 * The raw protocol returns `{ turn: { id, status, ... } }`;
 * the client normalizes this to `{ turnId }`.
 */
export interface Turn {
  turnId: string;
}

/** Raw turn object as returned by the Codex app-server */
export interface RawTurnObject {
  id: string;
  items?: unknown[];
  status?: string;
  error?: TurnError | null;
}

/** Raw response from turn/start */
export interface RawTurnStartResult {
  turn: RawTurnObject;
}

export type TurnStatus = 'completed' | 'interrupted' | 'failed';

// ============================================================================
// Item Types (Notifications)
// ============================================================================

export type ItemType =
  | 'agentMessage'
  | 'commandExecution'
  | 'mcpToolCall'
  | 'fileChange'
  | 'reasoning'
  | 'userMessage'
  | 'webSearch'
  | 'plan'
  | 'collabAgentToolCall'
  | 'imageView'
  | 'enteredReviewMode'
  | 'exitedReviewMode'
  | 'contextCompaction';

/**
 * Normalized item started params.
 * Raw protocol sends `{ item: { type, id, ... }, threadId, turnId }`;
 * the client normalizes to flat fields.
 */
export interface ItemStartedParams {
  turnId: string;
  itemId: string;
  itemType: ItemType;
  data?: ItemData;
}

/**
 * Normalized item completed params.
 */
export interface ItemCompletedParams {
  turnId: string;
  itemId: string;
  itemType: ItemType;
  data?: ItemData;
}

/** Raw item object as sent by app-server in notifications */
export interface RawItemObject {
  type: string;
  id: string;
  content?: unknown[];
  command?: string;
  cwd?: string;
  exitCode?: number;
  output?: string;
  durationMs?: number;
  server?: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: string;
  path?: string;
  changeType?: string;
  diff?: string;
  summary?: string;
  [key: string]: unknown;
}

/** Raw item/started notification params from app-server */
export interface RawItemStartedParams {
  item: RawItemObject;
  threadId: string;
  turnId: string;
}

/** Raw item/completed notification params from app-server */
export interface RawItemCompletedParams {
  item: RawItemObject;
  threadId: string;
  turnId: string;
}

export interface AgentMessageDeltaParams {
  turnId: string;
  itemId: string;
  delta: { text: string };
}

export interface ReasoningTextDeltaParams {
  turnId: string;
  itemId: string;
  delta: { text: string };
}

// ============================================================================
// Item Data
// ============================================================================

export interface CommandExecutionData {
  command: string;
  cwd?: string;
  exitCode?: number;
  /** Output may be in `output` or `aggregatedOutput` depending on protocol version */
  output?: string;
  aggregatedOutput?: string;
  durationMs?: number;
  processId?: number;
  status?: string;
  commandActions?: unknown[];
}

export interface McpToolCallData {
  server: string;
  tool: string;
  args?: Record<string, unknown>;
  result?: string;
  durationMs?: number;
}

export interface FileChangeData {
  path: string;
  changeType: 'create' | 'modify' | 'delete';
  diff?: string;
}

export interface ReasoningData {
  content?: string;
  summary?: string;
}

export interface WebSearchData {
  query: string;
  queries?: string[];
  action?: {
    type: string;
    query?: string;
    queries?: string[];
  };
}

export type ItemData =
  | CommandExecutionData
  | McpToolCallData
  | FileChangeData
  | ReasoningData
  | WebSearchData
  | Record<string, unknown>;

// ============================================================================
// Turn Lifecycle Notifications
// ============================================================================

/**
 * Normalized turn/started notification params.
 * Raw protocol sends `{ threadId, turn: { id, ... } }`;
 * the client normalizes to `{ threadId, turnId }`.
 */
export interface TurnStartedParams_Notification {
  threadId: string;
  turnId: string;
}

/** Raw turn/started notification from app-server */
export interface RawTurnStartedParams {
  threadId: string;
  turn: RawTurnObject;
}

/**
 * Normalized turn/completed notification params.
 * Raw protocol sends `{ threadId, turn: { id, status, error, items } }`;
 * the client normalizes to flat fields with extracted finalResponse.
 */
export interface TurnCompletedParams {
  threadId: string;
  turnId: string;
  status: TurnStatus;
  finalResponse?: string;
  error?: TurnError;
}

/** Raw turn/completed notification from app-server */
export interface RawTurnCompletedParams {
  threadId: string;
  turn: RawTurnObject & {
    items?: Array<{
      type: string;
      id: string;
      content?: Array<{ type: string; text?: string }>;
      [key: string]: unknown;
    }>;
  };
}

export interface TurnError {
  code?: string;
  message: string;
  codexErrorInfo?: string;
  additionalDetails?: unknown;
  details?: unknown;
}

// ============================================================================
// Token Usage
// ============================================================================

/**
 * Normalized token usage params used by the adapter.
 * Raw protocol sends `tokenUsage.total.{inputTokens, outputTokens, ...}`;
 * the client normalizes to flat `usage.{inputTokens, outputTokens}`.
 */
export interface TokenUsageUpdatedParams {
  threadId: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens?: number;
  };
}

/** Raw token usage notification from app-server */
export interface RawTokenUsageUpdatedParams {
  threadId: string;
  turnId?: string;
  tokenUsage: {
    total: {
      totalTokens: number;
      inputTokens: number;
      cachedInputTokens?: number;
      outputTokens: number;
      reasoningOutputTokens?: number;
    };
    last?: {
      totalTokens: number;
      inputTokens: number;
      cachedInputTokens?: number;
      outputTokens: number;
      reasoningOutputTokens?: number;
    };
    modelContextWindow?: number;
  };
}

// ============================================================================
// Error Notification (Server → Client)
// ============================================================================

/** Raw error notification from app-server */
export interface RawErrorNotificationParams {
  error: {
    message: string;
    codexErrorInfo?: string;
    additionalDetails?: unknown;
  };
  willRetry: boolean;
  threadId?: string;
  turnId?: string;
}

// ============================================================================
// Approval Requests (Server → Client)
// ============================================================================

export interface ApprovalRequestParams {
  requestId: string;
  turnId: string;
  itemId: string;
  itemType: 'commandExecution' | 'fileChange' | 'mcpToolCall' | 'webSearch' | 'collabAgentToolCall';
  data: CommandExecutionData | FileChangeData | McpToolCallData;
}

export interface ApprovalResponseParams {
  requestId: string;
  decision: 'approve' | 'decline';
  reason?: string;
}

// ============================================================================
// Notification Method Constants
// ============================================================================

export const NOTIFICATION_METHODS = {
  TURN_STARTED: 'turn/started',
  TURN_COMPLETED: 'turn/completed',
  ITEM_STARTED: 'item/started',
  ITEM_COMPLETED: 'item/completed',
  AGENT_MESSAGE_DELTA: 'item/agentMessage/delta',
  REASONING_TEXT_DELTA: 'item/reasoning/textDelta',
  REASONING_SUMMARY_DELTA: 'item/reasoning/summaryTextDelta',
  TOKEN_USAGE_UPDATED: 'thread/tokenUsage/updated',
  APPROVAL_REQUEST: 'item/requestApproval',
  ERROR: 'error',
} as const;

export const REQUEST_METHODS = {
  INITIALIZE: 'initialize',
  THREAD_START: 'thread/start',
  THREAD_RESUME: 'thread/resume',
  THREAD_FORK: 'thread/fork',
  TURN_START: 'turn/start',
  TURN_STEER: 'turn/steer',
  TURN_INTERRUPT: 'turn/interrupt',
  APPROVAL_RESPONSE: 'item/approvalResponse',
  MODEL_LIST: 'model/list',
  SKILLS_LIST: 'skills/list',
  SKILLS_CONFIG_WRITE: 'skills/config/write',
} as const;

// ============================================================================
// Skills Types
// ============================================================================

export interface SkillsListParams {
  /** Optional filter: only return skills matching this enabled state */
  enabled?: boolean;
}

/**
 * A single skill entry as returned by `skills/list`.
 */
export interface SkillEntry {
  /** Absolute path to the skill directory */
  path: string;
  /** Skill name (directory name) */
  name: string;
  /** Whether the skill is currently enabled */
  enabled: boolean;
}

export interface SkillsListResult {
  skills: SkillEntry[];
}

export interface SkillsConfigWriteParams {
  /** Absolute path to the skill directory */
  path: string;
  /** Whether to enable or disable the skill */
  enabled: boolean;
}
