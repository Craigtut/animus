/**
 * Tool barrel export and factory registration.
 *
 * All built-in tools are registered here. The CortexAgent maps tool names
 * to factory functions, creates each tool with the appropriate config,
 * and registers them on the pi-agent-core Agent.
 */

// Shared infrastructure
export { ReadRegistry } from './shared/read-registry.js';
export type { ReadState } from './shared/read-registry.js';
export { CwdTracker } from './shared/cwd-tracker.js';

// Tool factories
export { createReadTool } from './read.js';
export type { ReadToolConfig, ReadDetails, ReadParamsType } from './read.js';
export { ReadParams } from './read.js';

export { createWriteTool } from './write.js';
export type { WriteToolConfig, WriteDetails, WriteParamsType, DiffHunk } from './write.js';
export { WriteParams } from './write.js';

export { createEditTool } from './edit.js';
export type { EditToolConfig, EditDetails, EditParamsType } from './edit.js';
export { EditParams } from './edit.js';

export { createGlobTool } from './glob.js';
export type { GlobToolConfig, GlobDetails, GlobParamsType } from './glob.js';
export { GlobParams } from './glob.js';

export { createGrepTool } from './grep.js';
export type { GrepToolConfig, GrepDetails, GrepParamsType } from './grep.js';
export { GrepParams } from './grep.js';

export { createBashTool, getBackgroundTask, getAllBackgroundTasks } from './bash/index.js';
export type { BashToolConfig, BashDetails, BashParamsType, BackgroundTask } from './bash/index.js';
export { BashParams } from './bash/index.js';

export { createTaskOutputTool } from './task-output.js';
export type { TaskOutputDetails, TaskOutputParamsType } from './task-output.js';
export { TaskOutputParams } from './task-output.js';

export { createWebFetchTool, isPrivateIp } from './web-fetch/index.js';
export type { WebFetchToolConfig, WebFetchDetails, WebFetchParamsType } from './web-fetch/index.js';
export { WebFetchParams } from './web-fetch/index.js';

export { WebFetchCache } from './web-fetch/cache.js';
export type { CacheEntry } from './web-fetch/cache.js';

export { createSubAgentTool, SUB_AGENT_TOOL_NAME } from './sub-agent.js';
export type { SubAgentToolConfig, SubAgentDetails, SubAgentParamsType } from './sub-agent.js';
export { SubAgentParams } from './sub-agent.js';

// Safety layers
export {
  buildSafeEnv,
  isCriticalPath,
  classifyCommand,
  splitOnShellOperators,
  checkObfuscation,
  stripInvisibleChars,
  checkScriptPreflight,
  checkAutoModeClassifier,
  runSafetyChecks,
  validateWritePaths,
  extractWritePaths,
} from './bash/safety.js';
export type { CommandClassification, SafetyCheckResult } from './bash/safety.js';

// ---------------------------------------------------------------------------
// Tool name constants
// ---------------------------------------------------------------------------

export const TOOL_NAMES = {
  Read: 'Read',
  Write: 'Write',
  Edit: 'Edit',
  Glob: 'Glob',
  Grep: 'Grep',
  Bash: 'Bash',
  TaskOutput: 'TaskOutput',
  WebFetch: 'WebFetch',
  SubAgent: 'SubAgent',
} as const;

export type BuiltInToolName = keyof typeof TOOL_NAMES;
