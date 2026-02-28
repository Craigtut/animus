/**
 * Agent Decision Handlers
 *
 * Registers handlers for agent-related decisions:
 * spawn_agent, update_agent, cancel_agent.
 *
 * Extracted from decision-executor.ts executeAgentDecisions().
 */

import { registerDecisionHandler } from './decision-registry.js';

registerDecisionHandler('spawn_agent', async (params, decision, ctx) => {
  if (!ctx.agentOrchestrator) return;
  await ctx.agentOrchestrator.spawnAgent({
    taskType: String(params['taskType'] ?? 'general'),
    description: decision.description,
    instructions: String(params['instructions'] ?? decision.description),
    contactId: params['contactId'] ? String(params['contactId']) : (ctx.contact?.id ?? ''),
    channel: String(params['channel'] ?? ctx.triggerChannel ?? 'web'),
    tickNumber: ctx.tickNumber,
    systemPrompt: ctx.compiledPersona
      ? ctx.buildSystemPrompt(ctx.compiledPersona)
      : '',
  });
});

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
