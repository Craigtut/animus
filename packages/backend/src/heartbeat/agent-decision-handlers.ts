/**
 * Agent Decision Handlers
 *
 * Registers handlers for agent-steering decisions: update_agent, cancel_agent.
 *
 * Spawning is no longer a decision: the mind delegates in-loop via Cortex's
 * SubAgent tool (tracked through onBeforeSubAgentSpawn in cortex-mind.ts).
 *
 * Extracted from decision-executor.ts executeAgentDecisions().
 */

import { registerDecisionHandler } from './decision-registry.js';

registerDecisionHandler('update_agent', async (params, _decision, ctx) => {
  if (!ctx.agentOrchestrator) return;
  await ctx.agentOrchestrator.updateAgent({
    agentId: String(params['agentId'] ?? ''),
    context: String(params['context'] ?? _decision.description),
  });
});

registerDecisionHandler('cancel_agent', async (params, _decision, ctx) => {
  if (!ctx.agentOrchestrator) return;
  await ctx.agentOrchestrator.cancelAgent({
    agentId: String(params['agentId'] ?? ''),
    reason: String(params['reason'] ?? _decision.description),
  });
});
