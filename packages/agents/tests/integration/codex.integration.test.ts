/**
 * Integration tests for Codex adapter.
 *
 * These tests require a valid OPENAI_API_KEY environment variable.
 * They are skipped in CI unless credentials are provided.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createAgentManager,
  AgentManager,
  createSilentLogger,
  type AgentEvent,
} from '../../src/index.js';

const hasApiKey = !!process.env.OPENAI_API_KEY;

describe.skipIf(!hasApiKey)('CodexAdapter integration', () => {
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
    expect(manager.isConfigured('codex')).toBe(true);
  });

  it('creates session and gets response', async () => {
    const session = await manager.createSession({
      provider: 'codex',
    });

    expect(session).toBeDefined();
    expect(session.id).toMatch(/^codex:/);
    expect(session.isActive).toBe(true);

    const response = await session.prompt('What is 2 + 2?');

    expect(response.content).toBeTruthy();
    expect(response.finishReason).toBe('complete');

    await session.end();
    expect(session.isActive).toBe(false);
  }, 120000);

  it('emits events during prompt', async () => {
    const session = await manager.createSession({
      provider: 'codex',
    });

    const events: AgentEvent[] = [];
    session.onEvent((event) => {
      events.push(event);
    });

    await session.prompt('Say hello');

    const eventTypes = events.map((e) => e.type);
    // Codex emits 'input_received' for prompt start and 'session_start' for session init
    expect(eventTypes.length).toBeGreaterThan(0);
    expect(eventTypes).toContain('session_start');

    await session.end();
  }, 120000);

  it('cancel is a no-op (logs warning)', async () => {
    const session = await manager.createSession({
      provider: 'codex',
    });

    // Cancel should not throw
    await expect(session.cancel()).resolves.toBeUndefined();

    await session.end();
  }, 60000);

  it('tracks usage', async () => {
    const session = await manager.createSession({
      provider: 'codex',
    });

    await session.prompt('Hello');
    const usage = session.getUsage();

    // Codex should track some usage
    expect(usage.totalTokens).toBeGreaterThanOrEqual(0);

    await session.end();
  }, 120000);
});
