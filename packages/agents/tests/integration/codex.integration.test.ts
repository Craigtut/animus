/**
 * Integration tests for Codex adapter.
 *
 * These tests require a valid OPENAI_API_KEY environment variable.
 * They are skipped in CI unless credentials are provided.
 *
 * The adapter now uses the App Server Protocol (codex app-server),
 * which provides turn/interrupt (cancel) and turn/steer (inject).
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
    expect(eventTypes.length).toBeGreaterThan(0);
    expect(eventTypes).toContain('session_start');

    await session.end();
  }, 120000);

  it('cancel interrupts an active turn', async () => {
    const session = await manager.createSession({
      provider: 'codex',
    });

    // Start a long-running prompt and cancel it
    const promptPromise = session.promptStreaming(
      'Write a very long essay about the history of computing, at least 5000 words.',
      () => {},
    );

    // Give it a moment to start, then cancel
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await session.cancel();

    // The prompt should resolve (not throw)
    const response = await promptPromise;
    expect(response).toBeDefined();

    await session.end();
  }, 120000);

  it('injectMessage sends turn/steer during streaming', async () => {
    const session = await manager.createSession({
      provider: 'codex',
    });

    const chunks: string[] = [];
    const promptPromise = session.promptStreaming(
      'Start counting from 1. Count slowly.',
      (chunk) => { chunks.push(chunk); },
    );

    // Give it a moment, then inject
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (session.injectMessage) {
      session.injectMessage('Actually, stop counting and just say "DONE".');
    }

    const response = await promptPromise;
    expect(response).toBeDefined();
    expect(chunks.length).toBeGreaterThan(0);

    await session.end();
  }, 120000);

  it('tracks usage', async () => {
    const session = await manager.createSession({
      provider: 'codex',
    });

    await session.prompt('Hello');
    const usage = session.getUsage();

    expect(usage.totalTokens).toBeGreaterThanOrEqual(0);

    await session.end();
  }, 120000);
});
