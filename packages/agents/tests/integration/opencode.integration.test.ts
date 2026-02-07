/**
 * Integration tests for OpenCode adapter.
 *
 * These tests require at least one provider API key
 * (ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY).
 * They are skipped in CI unless credentials are provided.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createAgentManager,
  AgentManager,
  createSilentLogger,
  type AgentEvent,
} from '../../src/index.js';

const hasApiKey = !!(
  process.env.ANTHROPIC_API_KEY ||
  process.env.OPENAI_API_KEY ||
  process.env.GOOGLE_API_KEY
);

describe.skipIf(!hasApiKey)('OpenCodeAdapter integration', () => {
  let manager: AgentManager;

  beforeAll(() => {
    manager = createAgentManager({
      logger: createSilentLogger(),
    });
  });

  afterAll(async () => {
    await manager.cleanup();
  });

  it('reports as configured when provider API key is present', () => {
    expect(manager.isConfigured('opencode')).toBe(true);
  });

  it('creates session and gets response', async () => {
    // Use a model based on available API key
    const model = process.env.ANTHROPIC_API_KEY
      ? 'anthropic/claude-sonnet-4-5'
      : process.env.OPENAI_API_KEY
        ? 'openai/gpt-4o'
        : 'google/gemini-2.0-flash';

    const session = await manager.createSession({
      provider: 'opencode',
      model,
    });

    expect(session).toBeDefined();
    expect(session.id).toMatch(/^opencode:/);
    expect(session.isActive).toBe(true);

    const response = await session.prompt('What is 1 + 1?');

    expect(response.content).toBeTruthy();
    expect(response.finishReason).toBe('complete');

    await session.end();
    expect(session.isActive).toBe(false);
  }, 120000);

  it('emits events during prompt', async () => {
    const model = process.env.ANTHROPIC_API_KEY
      ? 'anthropic/claude-sonnet-4-5'
      : process.env.OPENAI_API_KEY
        ? 'openai/gpt-4o'
        : 'google/gemini-2.0-flash';

    const session = await manager.createSession({
      provider: 'opencode',
      model,
    });

    const events: AgentEvent[] = [];
    session.onEvent((event) => {
      events.push(event);
    });

    await session.prompt('Hello');

    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain('session_start');

    await session.end();
  }, 120000);

  it('can cancel a session', async () => {
    const model = process.env.ANTHROPIC_API_KEY
      ? 'anthropic/claude-sonnet-4-5'
      : process.env.OPENAI_API_KEY
        ? 'openai/gpt-4o'
        : 'google/gemini-2.0-flash';

    const session = await manager.createSession({
      provider: 'opencode',
      model,
    });

    // Cancel should not throw
    await expect(session.cancel()).resolves.toBeUndefined();

    await session.end();
  }, 60000);

  it('tracks usage', async () => {
    const model = process.env.ANTHROPIC_API_KEY
      ? 'anthropic/claude-sonnet-4-5'
      : process.env.OPENAI_API_KEY
        ? 'openai/gpt-4o'
        : 'google/gemini-2.0-flash';

    const session = await manager.createSession({
      provider: 'opencode',
      model,
    });

    await session.prompt('Hi');
    const usage = session.getUsage();

    expect(usage.totalTokens).toBeGreaterThanOrEqual(0);

    await session.end();
  }, 120000);
});
