/**
 * Integration tests for Claude adapter.
 *
 * These tests require a valid ANTHROPIC_API_KEY environment variable.
 * They are skipped in CI unless credentials are provided.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createAgentManager,
  AgentManager,
  createSilentLogger,
  type IAgentSession,
  type AgentEvent,
} from '../../src/index.js';

const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

describe.skipIf(!hasApiKey)('ClaudeAdapter integration', () => {
  let manager: AgentManager;

  beforeAll(() => {
    manager = createAgentManager({
      logger: createSilentLogger(),
    });
  });

  afterAll(async () => {
    await manager.cleanup();
  });

  it('reports as configured when API key is present', () => {
    expect(manager.isConfigured('claude')).toBe(true);
  });

  it('creates session and gets response', async () => {
    const session = await manager.createSession({
      provider: 'claude',
      systemPrompt: 'You are a helpful assistant. Respond with exactly one word.',
    });

    expect(session).toBeDefined();
    expect(session.id).toMatch(/^claude:/);
    expect(session.isActive).toBe(true);

    const response = await session.prompt('Say hello');

    expect(response.content).toBeTruthy();
    expect(response.finishReason).toBe('complete');
    expect(response.usage.totalTokens).toBeGreaterThan(0);

    await session.end();
    expect(session.isActive).toBe(false);
  }, 60000);

  it('emits events during prompt', async () => {
    const session = await manager.createSession({
      provider: 'claude',
      systemPrompt: 'Respond briefly.',
    });

    const events: AgentEvent[] = [];
    session.onEvent((event) => {
      events.push(event);
    });

    await session.prompt('Hi');

    // Should have at least session events
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain('prompt_start');

    await session.end();
  }, 60000);

  it('can cancel an in-progress prompt', async () => {
    const session = await manager.createSession({
      provider: 'claude',
      systemPrompt: 'Write a very long story about dragons.',
    });

    // Start prompt but don't await
    const promptPromise = session.prompt('Begin your story');

    // Cancel after a brief delay
    await new Promise((resolve) => setTimeout(resolve, 500));
    await session.cancel();

    // Should complete (possibly with cancelled status)
    const response = await promptPromise;
    expect(['complete', 'cancelled']).toContain(response.finishReason);

    await session.end();
  }, 60000);

  it('tracks usage correctly', async () => {
    const session = await manager.createSession({
      provider: 'claude',
    });

    await session.prompt('Say one word');
    const usage = session.getUsage();

    expect(usage.inputTokens).toBeGreaterThan(0);
    expect(usage.outputTokens).toBeGreaterThan(0);
    expect(usage.totalTokens).toBe(usage.inputTokens + usage.outputTokens);

    await session.end();
  }, 60000);
});
