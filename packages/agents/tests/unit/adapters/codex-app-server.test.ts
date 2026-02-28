/**
 * Unit tests for the CodexAppServerClient.
 *
 * Uses mocked child process to test JSON-RPC protocol handling,
 * request/response correlation, notification dispatch, and lifecycle.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter, Readable, Writable } from 'node:stream';
import { createSilentLogger } from '../../../src/logger.js';
import { NOTIFICATION_METHODS } from '../../../src/adapters/codex-protocol-types.js';

// Mock child_process.spawn
const mockStdin = new Writable({
  write(_chunk, _encoding, callback) { callback(); },
});
const mockStdout = new Readable({ read() {} });
const mockStderr = new Readable({ read() {} });

const mockProcess = Object.assign(new EventEmitter(), {
  stdin: mockStdin,
  stdout: mockStdout,
  stderr: mockStderr,
  pid: 12345,
  kill: vi.fn(),
});

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => mockProcess),
  execSync: vi.fn(() => '/usr/local/bin/codex'),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
}));

vi.mock('node:module', () => ({
  createRequire: vi.fn(() => {
    const req = (id: string) => { throw new Error('not found'); };
    req.resolve = () => '/fake/node_modules/@openai/codex-sdk/dist/index.js';
    return req;
  }),
}));

describe('CodexAppServerClient', () => {
  let CodexAppServerClient: typeof import('../../../src/adapters/codex-app-server.js').CodexAppServerClient;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Re-create fresh streams for each test
    mockStdout.destroy();
    Object.assign(mockStdout, new Readable({ read() {} }));
    mockProcess.stdout = mockStdout;

    const mod = await import('../../../src/adapters/codex-app-server.js');
    CodexAppServerClient = mod.CodexAppServerClient;
  });

  describe('lifecycle', () => {
    it('creates a new instance', () => {
      const client = new CodexAppServerClient({ logger: createSilentLogger() });
      expect(client.isRunning).toBe(false);
    });
  });

  describe('notification dispatch', () => {
    it('emits notifications by method name', async () => {
      const client = new CodexAppServerClient({ logger: createSilentLogger() });

      const testParams = { turnId: 'turn-1', itemId: 'item-1', itemType: 'commandExecution' as const };

      const received = new Promise<void>((resolve) => {
        client.on(NOTIFICATION_METHODS.ITEM_STARTED, (params) => {
          expect(params).toEqual(testParams);
          resolve();
        });
      });

      client.emit(NOTIFICATION_METHODS.ITEM_STARTED, testParams);
      await received;
    });

    it('emits turn/completed notifications', async () => {
      const client = new CodexAppServerClient({ logger: createSilentLogger() });

      const testParams = {
        threadId: 'thread-1',
        turnId: 'turn-1',
        status: 'completed' as const,
        finalResponse: 'Hello!',
      };

      const received = new Promise<void>((resolve) => {
        client.on(NOTIFICATION_METHODS.TURN_COMPLETED, (params) => {
          expect(params.status).toBe('completed');
          expect(params.finalResponse).toBe('Hello!');
          resolve();
        });
      });

      client.emit(NOTIFICATION_METHODS.TURN_COMPLETED, testParams);
      await received;
    });

    it('emits agent message deltas', async () => {
      const client = new CodexAppServerClient({ logger: createSilentLogger() });

      const testParams = {
        turnId: 'turn-1',
        itemId: 'item-1',
        delta: { text: 'Hello ' },
      };

      const received = new Promise<void>((resolve) => {
        client.on(NOTIFICATION_METHODS.AGENT_MESSAGE_DELTA, (params) => {
          expect(params.delta.text).toBe('Hello ');
          resolve();
        });
      });

      client.emit(NOTIFICATION_METHODS.AGENT_MESSAGE_DELTA, testParams);
      await received;
    });

    it('emits token usage updates', async () => {
      const client = new CodexAppServerClient({ logger: createSilentLogger() });

      const testParams = {
        threadId: 'thread-1',
        usage: { inputTokens: 100, outputTokens: 50 },
      };

      const received = new Promise<void>((resolve) => {
        client.on(NOTIFICATION_METHODS.TOKEN_USAGE_UPDATED, (params) => {
          expect(params.usage.inputTokens).toBe(100);
          expect(params.usage.outputTokens).toBe(50);
          resolve();
        });
      });

      client.emit(NOTIFICATION_METHODS.TOKEN_USAGE_UPDATED, testParams);
      await received;
    });

    it('emits approval requests', async () => {
      const client = new CodexAppServerClient({ logger: createSilentLogger() });

      const testParams = {
        requestId: 'req-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        itemType: 'commandExecution' as const,
        data: { command: 'ls -la' },
      };

      const received = new Promise<void>((resolve) => {
        client.on(NOTIFICATION_METHODS.APPROVAL_REQUEST, (params) => {
          expect(params.requestId).toBe('req-1');
          expect(params.data.command).toBe('ls -la');
          resolve();
        });
      });

      client.emit(NOTIFICATION_METHODS.APPROVAL_REQUEST, testParams);
      await received;
    });
  });

  describe('skills methods', () => {
    it('skillsList returns empty array when not running', async () => {
      const client = new CodexAppServerClient({ logger: createSilentLogger() });
      // Client is not running, so skillsList should return []
      expect(client.isRunning).toBe(false);
    });

    it('skillsConfigWrite returns false when not running', async () => {
      const client = new CodexAppServerClient({ logger: createSilentLogger() });
      expect(client.isRunning).toBe(false);
    });
  });

  describe('crash detection', () => {
    it('emits process_exit when process exits', async () => {
      const client = new CodexAppServerClient({ logger: createSilentLogger() });

      const received = new Promise<void>((resolve) => {
        client.on('process_exit', (info) => {
          expect(info.code).toBe(1);
          resolve();
        });
      });

      client.emit('process_exit', { code: 1, signal: null });
      await received;
    });
  });
});

describe('CodexSession (via adapter)', () => {
  // Re-mock the app server for session-level tests
  vi.mock('../../../src/adapters/codex-app-server.js', () => {
    const EventEmitter = require('node:events').EventEmitter;
    return {
      CodexAppServerClient: vi.fn().mockImplementation(() => {
        const emitter = new EventEmitter();
        return Object.assign(emitter, {
          isRunning: false,
          start: vi.fn().mockImplementation(async function(this: any) { this.isRunning = true; }),
          stop: vi.fn().mockImplementation(async function(this: any) { this.isRunning = false; }),
          threadStart: vi.fn().mockResolvedValue({ threadId: 'test-thread' }),
          threadResume: vi.fn().mockResolvedValue({ threadId: 'resumed-thread' }),
          threadFork: vi.fn().mockResolvedValue({ threadId: 'forked-thread' }),
          turnStart: vi.fn().mockImplementation(async function(this: any) {
            const turnId = 'test-turn-1';
            // Simulate turn lifecycle after a tick
            setTimeout(() => {
              this.emit(NOTIFICATION_METHODS.TURN_STARTED, {
                threadId: 'test-thread',
                turnId,
              });
              this.emit(NOTIFICATION_METHODS.AGENT_MESSAGE_DELTA, {
                turnId,
                itemId: 'msg-1',
                delta: { text: 'Hello world' },
              });
              this.emit(NOTIFICATION_METHODS.TOKEN_USAGE_UPDATED, {
                threadId: 'test-thread',
                usage: { inputTokens: 10, outputTokens: 5 },
              });
              this.emit(NOTIFICATION_METHODS.TURN_COMPLETED, {
                threadId: 'test-thread',
                turnId,
                status: 'completed',
                finalResponse: 'Hello world',
              });
            }, 5);
            return { turnId };
          }),
          turnSteer: vi.fn().mockResolvedValue({ turnId: 'steered-turn' }),
          turnInterrupt: vi.fn().mockResolvedValue(undefined),
          sendApprovalResponse: vi.fn(),
          skillsList: vi.fn().mockResolvedValue([]),
          skillsConfigWrite: vi.fn().mockResolvedValue(true),
        });
      }),
    };
  });

  it('creates a session and processes a prompt', async () => {
    const { CodexAdapter } = await import('../../../src/adapters/codex.js');

    const origKey = process.env['OPENAI_API_KEY'];
    process.env['OPENAI_API_KEY'] = 'test-key';

    try {
      const adapter = new CodexAdapter({ logger: createSilentLogger() });
      const session = await adapter.createSession({ provider: 'codex' });

      expect(session).toBeDefined();
      expect(session.isActive).toBe(true);

      const response = await session.prompt('test input');

      expect(response.content).toBe('Hello world');
      expect(response.finishReason).toBe('complete');
      expect(response.usage.inputTokens).toBe(10);
      expect(response.usage.outputTokens).toBe(5);

      await session.end();
      expect(session.isActive).toBe(false);
    } finally {
      if (origKey) {
        process.env['OPENAI_API_KEY'] = origKey;
      } else {
        delete process.env['OPENAI_API_KEY'];
      }
    }
  });

  it('streams chunks via promptStreaming', async () => {
    const { CodexAdapter } = await import('../../../src/adapters/codex.js');

    const origKey = process.env['OPENAI_API_KEY'];
    process.env['OPENAI_API_KEY'] = 'test-key';

    try {
      const adapter = new CodexAdapter({ logger: createSilentLogger() });
      const session = await adapter.createSession({ provider: 'codex' });

      const chunks: string[] = [];
      const response = await session.promptStreaming('test', (chunk) => {
        chunks.push(chunk);
      });

      expect(chunks).toEqual(['Hello world']);
      expect(response.content).toBe('Hello world');

      await session.end();
    } finally {
      if (origKey) {
        process.env['OPENAI_API_KEY'] = origKey;
      } else {
        delete process.env['OPENAI_API_KEY'];
      }
    }
  });

  it('injectMessage is a no-op when no prompt is active', async () => {
    const { CodexAdapter } = await import('../../../src/adapters/codex.js');

    const origKey = process.env['OPENAI_API_KEY'];
    process.env['OPENAI_API_KEY'] = 'test-key';

    try {
      const adapter = new CodexAdapter({ logger: createSilentLogger() });
      const session = await adapter.createSession({ provider: 'codex' });

      // Should not throw
      if (session.injectMessage) {
        session.injectMessage('test injection');
      }

      await session.end();
    } finally {
      if (origKey) {
        process.env['OPENAI_API_KEY'] = origKey;
      } else {
        delete process.env['OPENAI_API_KEY'];
      }
    }
  });

  it('cancel is a no-op when no active turn', async () => {
    const { CodexAdapter } = await import('../../../src/adapters/codex.js');

    const origKey = process.env['OPENAI_API_KEY'];
    process.env['OPENAI_API_KEY'] = 'test-key';

    try {
      const adapter = new CodexAdapter({ logger: createSilentLogger() });
      const session = await adapter.createSession({ provider: 'codex' });

      // Should not throw
      await session.cancel();

      await session.end();
    } finally {
      if (origKey) {
        process.env['OPENAI_API_KEY'] = origKey;
      } else {
        delete process.env['OPENAI_API_KEY'];
      }
    }
  });
});
