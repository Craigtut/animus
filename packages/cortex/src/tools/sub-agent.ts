/**
 * SubAgent tool: spawn independent cortex-based sub-agents for delegated work.
 *
 * Supports foreground (blocking) and background (async) execution modes.
 * Each sub-agent is an independent CortexAgent with its own message array
 * and empty context slots.
 *
 * The SubAgent tool is ALWAYS excluded from child agents to prevent
 * recursive spawning.
 *
 * References:
 *   - docs/cortex/tools/sub-agent.md
 *   - docs/cortex/plans/phase-4-sub-agents-and-skills.md
 */

import { Type, type Static } from '@sinclair/typebox';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const SubAgentParams = Type.Object({
  instructions: Type.String({
    description: 'What the sub-agent should do. This becomes the sub-agent\'s initial prompt.',
  }),
  tools: Type.Optional(Type.Array(Type.String(), {
    description: 'Tool names to make available. Default: inherits parent\'s registered tools.',
  })),
  systemPrompt: Type.Optional(Type.String({
    description: 'Custom system prompt. Default: inherits parent\'s full system prompt.',
  })),
  maxTurns: Type.Optional(Type.Number({
    description: 'Maximum LLM turns. Default: inherits parent\'s budget guard config.',
  })),
  maxCost: Type.Optional(Type.Number({
    description: 'Maximum cost in USD. Default: inherits parent\'s budget guard config.',
  })),
  background: Type.Optional(Type.Boolean({
    description: 'Run asynchronously. Default: false (blocks until complete).',
  })),
});

export type SubAgentParamsType = Static<typeof SubAgentParams>;

// ---------------------------------------------------------------------------
// Details type (for UI/logs)
// ---------------------------------------------------------------------------

export interface SubAgentDetails {
  taskId: string;
  background: boolean;
  status: string;
  durationMs: number | null;
  turns: number | null;
  cost: number | null;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Configuration passed to the SubAgent tool factory.
 * The CortexAgent provides all of these at tool registration time.
 */
export interface SubAgentToolConfig {
  /**
   * Spawn a sub-agent and run it. Returns the result when complete.
   * The factory function handles CortexAgent creation, budget guard
   * inheritance, tool filtering, and lifecycle management.
   */
  spawnSubAgent: (params: SubAgentParamsType) => Promise<{
    taskId: string;
    output: string;
    status: string;
    usage: { turns: number; cost: number; durationMs: number };
  }>;

  /**
   * Spawn a background sub-agent. Returns the task ID immediately.
   */
  spawnBackgroundSubAgent: (params: SubAgentParamsType) => Promise<{
    taskId: string;
  }>;

  /**
   * Check if another sub-agent can be spawned.
   */
  canSpawn: () => boolean;

  /**
   * Get concurrency info for error messages.
   */
  getConcurrencyInfo: () => { active: number; limit: number };
}

// ---------------------------------------------------------------------------
// Tool name constant
// ---------------------------------------------------------------------------

export const SUB_AGENT_TOOL_NAME = 'SubAgent';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the SubAgent tool.
 *
 * Returns an AgentTool object for registration with pi-agent-core.
 */
export function createSubAgentTool(config: SubAgentToolConfig): {
  name: string;
  description: string;
  parameters: typeof SubAgentParams;
  execute: (args: unknown) => Promise<unknown>;
} {
  return {
    name: SUB_AGENT_TOOL_NAME,
    description: `Spawn a sub-agent to handle a delegated task independently. Use for tasks that are complex, long-running, or can proceed in parallel with your main work.

Foreground mode (default): Blocks until the sub-agent completes and returns its result directly. Use for quick, focused tasks where you need the result to continue.

Background mode (background: true): Returns a task ID immediately. The sub-agent runs independently. You will be notified when it completes. Use for long-running research, analysis, or multi-step work.

Sub-agents are independent: they have their own conversation, do not share your context, and cannot spawn further sub-agents. Give them clear, self-contained instructions.`,

    parameters: SubAgentParams,

    execute: async (args: unknown): Promise<unknown> => {
      const params = args as SubAgentParamsType;

      // Check concurrency limit
      if (!config.canSpawn()) {
        const info = config.getConcurrencyInfo();
        return `Cannot spawn sub-agent: concurrency limit reached (${info.active}/${info.limit} active). Wait for a running sub-agent to complete or cancel one to free a slot.`;
      }

      // Background mode: spawn and return immediately
      if (params.background) {
        const { taskId } = await config.spawnBackgroundSubAgent(params);
        return `Sub-agent spawned in background. Task ID: ${taskId}\nYou will be notified when it completes. Continue with other work.`;
      }

      // Foreground mode: block until complete
      const result = await config.spawnSubAgent(params);

      // Format result for the parent agent
      const statusLine = result.status === 'completed'
        ? 'Sub-agent completed successfully.'
        : `Sub-agent finished with status: ${result.status}`;

      const usageLine = `(${result.usage.turns} turns, $${result.usage.cost.toFixed(4)}, ${(result.usage.durationMs / 1000).toFixed(1)}s)`;

      if (result.output) {
        return `${statusLine} ${usageLine}\n\n${result.output}`;
      }

      return `${statusLine} ${usageLine}\n\nNo output was produced.`;
    },
  };
}
