/**
 * Tools — exports
 */

export {
  ANIMUS_TOOL_DEFS,
  MIND_TOOL_NAMES,
  sendMessageDef,
  updateProgressDef,
  readMemoryDef,
  lookupContactsDef,
  sendProactiveMessageDef,
  sendMediaDef,
  runWithCredentialsDef,
  listVaultEntriesDef,
  manageVaultEntryDef,
  transcribeAudioDef,
  generateSpeechDef,
  sendVoiceReplyDef,
} from './definitions.js';
export type { AnimusToolDef, AnimusToolName } from './definitions.js';

export {
  TOOL_PERMISSIONS,
  isToolAllowed,
  getAllowedTools,
  getMindTools,
} from './permissions.js';

export {
  TOOL_UI_CONFIG,
  TOOL_CATEGORY_META,
  getToolUIConfig,
} from './ui-config.js';
export type { ToolVisibility, ToolUICategory, ToolUIConfig, ToolCategoryMeta } from './ui-config.js';

export {
  riskTierToDefaultMode,
  computeMcpToolPreview,
} from './mcp-tool-preview.js';
export type { McpToolPreview } from './mcp-tool-preview.js';
