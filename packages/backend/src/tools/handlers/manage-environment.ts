/**
 * manage_environment handler — inspect and extend the entity's self-owned
 * working environment (PATH additions, env vars, registered tools).
 *
 * Delegates to EnvironmentService, which persists the overlay manifest and
 * applies changes to process.env so they take effect for the next shell
 * command and survive restarts.
 *
 * See docs/research/self-managed-environment.md
 */

import type { ToolHandler, ToolResult } from '../types.js';
import { getEnvironmentService } from '../../services/environment-service.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('ManageEnvironment', 'heartbeat');

interface ManageEnvironmentInput {
  action: 'list' | 'add_path' | 'remove_path' | 'set_var' | 'unset_var' | 'register_tool' | 'unregister_tool';
  path?: string;
  name?: string;
  value?: string;
  binDir?: string;
  version?: string;
  source?: string;
  sha256?: string;
}

function ok(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

function err(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

export const manageEnvironmentHandler: ToolHandler = async (rawInput): Promise<ToolResult> => {
  const input = rawInput as ManageEnvironmentInput;
  const service = getEnvironmentService();

  try {
    switch (input.action) {
      case 'list': {
        const manifest = service.readManifest();
        const tools = Object.values(manifest.tools);
        const lines: string[] = [];
        lines.push('Registered tools:');
        if (tools.length === 0) {
          lines.push('  (none yet)');
        } else {
          for (const t of tools) {
            lines.push(`  - ${t.name}${t.version ? ` ${t.version}` : ''} → ${t.binDir}`);
          }
        }
        lines.push('');
        lines.push('PATH additions:');
        lines.push(manifest.pathAdditions.length ? manifest.pathAdditions.map((p) => `  - ${p}`).join('\n') : '  (none)');
        lines.push('');
        lines.push('Environment variables:');
        const varNames = Object.keys(manifest.envVars);
        lines.push(varNames.length ? varNames.map((n) => `  - ${n}`).join('\n') : '  (none)');
        lines.push('');
        lines.push(`Install self-contained toolchains under: ${service.toolsDir}`);
        return ok(lines.join('\n'));
      }

      case 'add_path': {
        if (!input.path) return err('add_path requires a "path".');
        service.addPath(input.path);
        log.info(`Added PATH directory: ${input.path}`);
        return ok(`Added "${input.path}" to PATH. Effective for the next shell command.`);
      }

      case 'remove_path': {
        if (!input.path) return err('remove_path requires a "path".');
        service.removePath(input.path);
        log.info(`Removed PATH directory: ${input.path}`);
        return ok(`Removed "${input.path}" from PATH.`);
      }

      case 'set_var': {
        if (!input.name || input.value === undefined) {
          return err('set_var requires "name" and "value".');
        }
        service.setVar(input.name, input.value);
        log.info(`Set environment variable: ${input.name}`);
        return ok(`Set environment variable "${input.name}". Effective for the next shell command.`);
      }

      case 'unset_var': {
        if (!input.name) return err('unset_var requires a "name".');
        service.unsetVar(input.name);
        log.info(`Unset environment variable: ${input.name}`);
        return ok(`Unset environment variable "${input.name}".`);
      }

      case 'register_tool': {
        if (!input.name || !input.binDir) {
          return err('register_tool requires "name" and "binDir".');
        }
        service.registerTool({
          name: input.name,
          binDir: input.binDir,
          ...(input.version !== undefined ? { version: input.version } : {}),
          ...(input.source !== undefined ? { source: input.source } : {}),
          ...(input.sha256 !== undefined ? { sha256: input.sha256 } : {}),
        });
        return ok(
          `Registered "${input.name}"${input.version ? ` (${input.version})` : ''} and added ${input.binDir} to PATH. ` +
          `It will persist across restarts.`
        );
      }

      case 'unregister_tool': {
        if (!input.name) return err('unregister_tool requires a "name".');
        service.unregisterTool(input.name);
        log.info(`Unregistered tool: ${input.name}`);
        return ok(`Unregistered "${input.name}".`);
      }

      default:
        return err(`Unknown action: ${String((input as { action?: string }).action)}`);
    }
  } catch (e) {
    log.error('manage_environment failed:', e);
    return err(`manage_environment failed: ${e instanceof Error ? e.message : String(e)}`);
  }
};
