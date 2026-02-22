/**
 * Sandbox Session — wrapper around AgentManager for interactive sandbox use.
 *
 * Handles session creation, plugin integration, event forwarding, and cleanup.
 * Sessions are created lazily on first message so provider/model can be changed
 * via commands before any session exists.
 */

import type { AgentProvider } from '@animus/shared';
import type {
  AgentEvent,
  AgentResponse,
  AgentSessionConfig,
  IAgentSession,
  AgentManager,
} from '@animus/agents';
import { getPluginManager } from '../services/plugin-manager.js';
import { buildSandboxMcpServer } from './mcp-server.js';
import { buildCognitiveMcpServer, type CognitiveSnapshot } from './cognitive-tools.js';
import { PROJECT_ROOT } from '../utils/env.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('SandboxSession', 'agents');

export type EventCallback = (event: AgentEvent) => void;

export class SandboxSession {
  private manager: AgentManager;
  private session: IAgentSession | null = null;
  private onEventCb: EventCallback | null = null;
  private noPlugins: boolean;
  private cognitiveMode: boolean;
  private cognitiveGetSnapshot: (() => CognitiveSnapshot) | null = null;
  private cognitiveResetSnapshot: (() => void) | null = null;

  constructor(manager: AgentManager, noPlugins: boolean, cognitiveMode = false) {
    this.manager = manager;
    this.noPlugins = noPlugins;
    this.cognitiveMode = cognitiveMode;
  }

  /** Register event callback (set before first prompt). */
  onEvent(cb: EventCallback): void {
    this.onEventCb = cb;
  }

  /** Get the current session ID, if active. */
  get id(): string | undefined {
    return this.session?.id;
  }

  /** Whether a session is currently active. */
  get isActive(): boolean {
    return this.session?.isActive ?? false;
  }

  /** Whether cognitive mode is enabled. */
  get isCognitive(): boolean {
    return this.cognitiveMode;
  }

  /** Toggle cognitive mode. Ends existing session so it takes effect on next prompt. */
  async setCognitiveMode(enabled: boolean): Promise<void> {
    if (this.cognitiveMode !== enabled) {
      this.cognitiveMode = enabled;
      await this.end();
    }
  }

  /** Get the latest cognitive snapshot (only meaningful in cognitive mode). */
  getCognitiveSnapshot(): CognitiveSnapshot | null {
    return this.cognitiveGetSnapshot?.() ?? null;
  }

  /**
   * Create a new agent session with the given configuration.
   * Ends any existing session first.
   */
  async create(
    provider: AgentProvider,
    model?: string,
    systemPrompt?: string,
    verbose?: boolean,
  ): Promise<void> {
    // End existing session
    await this.end();

    const config: AgentSessionConfig = {
      provider,
      ...(model ? { model } : {}),
      cwd: PROJECT_ROOT,
      systemPrompt: systemPrompt ?? 'You are a helpful assistant.',
      permissions: { executionMode: 'build', approvalLevel: 'none' },
      ...(verbose != null ? { verbose } : {}),
    };

    // Cognitive mode: add cognitive MCP tools (Claude only for now)
    if (this.cognitiveMode && provider === 'claude') {
      const { serverConfig, allowedTools, getSnapshot, resetSnapshot } =
        await buildCognitiveMcpServer();

      this.cognitiveGetSnapshot = getSnapshot;
      this.cognitiveResetSnapshot = resetSnapshot;

      config.mcpServers = config.mcpServers ?? {};
      config.mcpServers['cognitive'] = serverConfig;
      config.allowedTools = config.allowedTools ?? [];
      config.allowedTools.push(...allowedTools);

      log.info('Cognitive MCP tools attached');
    }

    // Plugin MCP servers + skills
    if (!this.noPlugins) {
      const pm = getPluginManager();

      // Plugin MCP servers
      const { mcpServers: pluginMcp, allowedTools: pluginTools } =
        pm.getPluginMcpServersForSdk();

      config.mcpServers = { ...config.mcpServers, ...pluginMcp };
      config.allowedTools = [...(config.allowedTools ?? []), ...pluginTools];

      // Skill bridge (Claude SDK plugin for skill discovery)
      if (provider === 'claude') {
        const bridgePath = pm.getSkillBridgePath();
        config.plugins = [{ type: 'local', path: bridgePath }];
      } else if (provider === 'codex') {
        config.env = await pm.buildCodexRuntimeEnv(config.env);
      }

      // Sandbox MCP server for run_with_credentials (Claude only)
      if (provider === 'claude') {
        const { serverConfig, allowedTools: sandboxTools } =
          await buildSandboxMcpServer();
        config.mcpServers!['sandbox'] = serverConfig;
        config.allowedTools!.push(...sandboxTools);
      }

      // Always allow Skill tool for Claude skill invocation
      if (provider === 'claude') {
        config.allowedTools!.push('Skill');
      }
    }

    log.info('Creating sandbox session', { provider, model, cognitive: this.cognitiveMode });
    this.session = await this.manager.createSession(config);

    // Wire up event forwarding
    if (this.onEventCb) {
      const cb = this.onEventCb;
      this.session.onEvent(async (event) => {
        cb(event);
      });
    }

    log.info('Sandbox session created', { id: this.session.id });
  }

  /**
   * Send a message to the agent and get a response.
   * Creates a session lazily if none exists.
   */
  async prompt(
    message: string,
    provider: AgentProvider,
    model?: string,
    systemPrompt?: string,
    verbose?: boolean,
    onChunk?: (chunk: string, meta: import('@animus/agents').StreamChunkMeta) => void,
  ): Promise<AgentResponse> {
    if (!this.session || !this.session.isActive) {
      await this.create(provider, model, systemPrompt, verbose);
    }

    // Reset cognitive snapshot before each new prompt
    this.cognitiveResetSnapshot?.();

    return this.session!.promptStreaming(message, onChunk ?? (() => {}));
  }

  /**
   * Inject a user message into a running prompt stream.
   * Uses the adapter's injectMessage() which pushes into the
   * AsyncIterable message stream feeding the active query.
   * No-op if no session, no active stream, or adapter doesn't support it.
   */
  injectMessage(content: string): void {
    if (!this.session) {
      log.warn('Cannot inject message — no active session');
      return;
    }
    if (!this.session.injectMessage) {
      log.warn('Cannot inject message — adapter does not support injectMessage');
      return;
    }
    this.session.injectMessage(content);
  }

  /** End the current session. */
  async end(): Promise<void> {
    if (this.session) {
      try {
        await this.session.end();
      } catch (err) {
        log.warn('Session end error:', err);
      }
      this.session = null;
    }
  }
}
