/**
 * Agent Sandbox TUI — Entry Point
 *
 * Standalone Ink-based terminal UI for testing agent SDKs directly.
 * Boots only: databases, encryption, credentials, plugins, AgentManager.
 * Skips: Fastify, channels, heartbeat, memory manager, context builder.
 *
 * Usage:
 *   npm run sandbox
 *   npm run sandbox -- --provider codex --model codex-mini-latest
 *   npm run sandbox -- --no-plugins --verbose
 */

import React from 'react';
import type { AgentProvider } from '@animus-labs/shared';
import type { SandboxCliArgs, SandboxState } from './types.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('Sandbox', 'agents');

// ============================================================================
// CLI Arg Parsing (simple argv loop, no dependency)
// ============================================================================

function parseArgs(): SandboxCliArgs {
  const args = process.argv.slice(2);
  const result: SandboxCliArgs = {
    provider: 'claude',
    systemPrompt: 'You are a helpful assistant running in the Animus agent sandbox.',
    noPlugins: false,
    verbose: false,
    cognitive: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    switch (arg) {
      case '--provider':
        result.provider = (args[++i] ?? 'claude') as AgentProvider;
        break;
      case '--model':
        result.model = args[++i];
        break;
      case '--system':
        result.systemPrompt = args[++i] ?? result.systemPrompt;
        break;
      case '--no-plugins':
        result.noPlugins = true;
        break;
      case '--verbose':
        result.verbose = true;
        break;
      case '--cognitive':
        result.cognitive = true;
        break;
      case '--help':
        console.log(`Agent Sandbox TUI

Usage: npm run sandbox [options]

Options:
  --provider claude|codex|opencode  Agent provider (default: claude)
  --model <id>                      Model identifier
  --system <prompt>                 System prompt
  --no-plugins                      Skip loading plugins
  --verbose                         Show all agent events
  --cognitive                       Enable cognitive MCP tools (experimental)
  --help                            Show this help`);
        process.exit(0);
    }
  }

  return result;
}

// ============================================================================
// Boot Sequence
// ============================================================================

async function boot(args: SandboxCliArgs) {
  console.log('Booting sandbox...');

  // 1. Initialize databases
  const { initializeDatabases, getSystemDb, closeDatabases } = await import('../db/index.js');
  await initializeDatabases();
  log.info('Databases initialized');

  // 2. Verify encryption key
  const { verifyEncryptionKey } = await import('../lib/encryption-service.js');
  verifyEncryptionKey(getSystemDb());
  log.info('Encryption key verified');

  // 3. Load credentials into env
  const { loadCredentialsIntoEnv } = await import('../services/credential-service.js');
  loadCredentialsIntoEnv(getSystemDb());
  log.info('Credentials loaded');

  // 4. Load plugins (unless --no-plugins)
  let pluginCount = 0;
  if (!args.noPlugins) {
    const { getPluginManager } = await import('../plugins/index.js');
    const pm = getPluginManager();
    await pm.loadAll();
    pluginCount = pm.getAllPlugins().filter((p) => p.enabled).length;
    log.info(`Plugins loaded: ${pluginCount}`);
  }

  // 5. Create agent manager (with silent logger to avoid console noise in TUI)
  const { createAgentManager, createSilentLogger } = await import('@animus-labs/agents');
  const manager = createAgentManager({ logger: createSilentLogger() });

  // Validate at least one provider is configured
  const configured = manager.getConfiguredProviders();
  if (configured.length === 0) {
    console.error(
      'No agent providers configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env',
    );
    closeDatabases();
    process.exit(1);
  }

  // Validate requested provider is configured
  if (!manager.isConfigured(args.provider)) {
    const fallback = configured[0]!;
    console.warn(
      `Provider "${args.provider}" is not configured. Falling back to "${fallback}".`,
    );
    args.provider = fallback;
  }

  log.info('Boot complete', {
    provider: args.provider,
    model: args.model ?? 'default',
    plugins: pluginCount,
    configured: configured.join(', '),
  });

  // Suppress all console logging — TUI takes over stdout.
  // File logging (data/logs/animus.log) continues unaffected.
  const { suppressConsole } = await import('../lib/logger.js');
  suppressConsole();

  return { manager, pluginCount, closeDatabases };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = parseArgs();
  const { manager, pluginCount, closeDatabases } = await boot(args);

  // Dynamic import for Ink (ESM)
  const { render } = await import('ink');
  const { SandboxSession } = await import('./session.js');
  const { App } = await import('./components/App.js');

  const session = new SandboxSession(manager, args.noPlugins, args.cognitive);

  // In cognitive mode, override system prompt with the cognitive prompt
  let systemPrompt = args.systemPrompt;
  if (args.cognitive) {
    const { COGNITIVE_SYSTEM_PROMPT } = await import('./cognitive-prompt.js');
    systemPrompt = COGNITIVE_SYSTEM_PROMPT;
  }

  const initialState: SandboxState = {
    provider: args.provider,
    model: args.model,
    systemPrompt,
    showVerboseEvents: args.verbose,
    isStreaming: false,
    pluginsLoaded: pluginCount,
    cognitiveMode: args.cognitive,
  };

  console.clear();

  const { waitUntilExit } = render(
    <App session={session} initialState={initialState} />,
  );

  await waitUntilExit();

  // Cleanup
  await session.end();
  await manager.cleanup();
  closeDatabases();
  log.info('Sandbox shutdown complete');
}

main().catch((err) => {
  console.error('Sandbox fatal error:', err);
  process.exit(1);
});
