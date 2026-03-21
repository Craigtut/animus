/**
 * load_skill AgentTool: loads a skill's full instructions into the agent's
 * active context.
 *
 * The skill body is read from the SkillRegistry, preprocessed (variable
 * substitution, shell commands, scripts), and pushed to the skill buffer.
 * The skill buffer is injected into ephemeral context via transformContext
 * on every subsequent LLM call within the current agentic loop.
 *
 * References:
 *   - docs/cortex/skill-system.md
 *   - docs/cortex/plans/phase-4-sub-agents-and-skills.md
 */

import { Type, type Static } from '@sinclair/typebox';
import type { SkillRegistry } from './skill-registry.js';
import type { LoadedSkill } from './types.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const LoadSkillParams = Type.Object({
  name: Type.String({
    description: 'The skill name to load.',
  }),
  arguments: Type.Optional(Type.String({
    description: 'Optional arguments to pass to the skill.',
  })),
});

export type LoadSkillParamsType = Static<typeof LoadSkillParams>;

// ---------------------------------------------------------------------------
// Tool name constant
// ---------------------------------------------------------------------------

export const LOAD_SKILL_TOOL_NAME = 'load_skill';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface LoadSkillToolConfig {
  /** The skill registry to load skills from. */
  registry: SkillRegistry;
  /** Build the visible skills summary for the tool description. */
  getAvailableSkillsSummary?: () => string;
  /** The skill buffer to push loaded skills into. */
  getSkillBuffer: () => LoadedSkill[];
  /** Push a loaded skill to the buffer (handles deduplication). */
  pushToSkillBuffer: (skill: LoadedSkill) => void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the load_skill tool.
 *
 * Returns an AgentTool object for registration with pi-agent-core.
 * The tool description includes the available skills summary, which
 * updates when skills are added or removed from the registry.
 */
export function createLoadSkillTool(config: LoadSkillToolConfig): {
  name: string;
  description: string;
  parameters: typeof LoadSkillParams;
  execute: (args: unknown) => Promise<unknown>;
} {
  return {
    name: LOAD_SKILL_TOOL_NAME,

    description: `Load a skill's full instructions into your active context. Call this tool when you need detailed guidance for a specific task. The skill's instructions will be available in your context for the remainder of this loop.

${config.getAvailableSkillsSummary ? config.getAvailableSkillsSummary() : config.registry.getAvailableSkillsSummary()}`,

    parameters: LoadSkillParams,

    execute: async (args: unknown): Promise<unknown> => {
      const params = args as LoadSkillParamsType;

      // Check if skill exists
      const entry = config.registry.getEntry(params.name);
      if (!entry) {
        return `Unknown skill: "${params.name}". Check available skills in the tool description.`;
      }

      // Check if the skill is model-invocable
      if (!entry.modelInvocable) {
        return `Skill "${params.name}" is not available for direct loading.`;
      }

      // Load and preprocess the skill body
      try {
        const callArgs = {
          args: params.arguments ? params.arguments.split(/\s+/) : [],
          rawArgs: params.arguments ?? '',
        };

        const body = await config.registry.getSkillBody(params.name, callArgs);

        // Push to skill buffer (deduplication handled by pushToSkillBuffer)
        config.pushToSkillBuffer({ name: params.name, content: body });

        return `Skill "${params.name}" loaded. Full instructions are now active in your context (see the skill instructions section below the conversation history). Review them before proceeding.`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Failed to load skill "${params.name}": ${message}`;
      }
    },
  };
}

/**
 * Rebuild the load_skill tool's description with the current available
 * skills summary. Called when skills are added or removed.
 *
 * Returns a function that produces the updated description string.
 */
export function buildLoadSkillDescription(
  registry: SkillRegistry,
  availableSkillsSummary?: string,
): string {
  return `Load a skill's full instructions into your active context. Call this tool when you need detailed guidance for a specific task. The skill's instructions will be available in your context for the remainder of this loop.

${availableSkillsSummary ?? registry.getAvailableSkillsSummary()}`;
}
