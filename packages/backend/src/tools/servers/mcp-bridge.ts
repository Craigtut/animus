/**
 * MCP HTTP Bridge — exposes built-in Animus tools and cognitive tools
 * to stdio MCP subprocesses via a localhost-only HTTP server.
 *
 * Architecture:
 *   Agent SDK (any provider)
 *       ↕ stdio (MCP protocol)
 *   MCP Subprocess (animus-mcp-server.ts)
 *       ↕ HTTP (localhost)
 *   This Bridge (same process as Fastify)
 *       ↓
 *   executeTool() / cognitive handlers (in-process)
 *
 * The bridge is a singleton — started lazily on the first cold session,
 * shared by the mind session and all sub-agents.
 *
 * See docs/architecture/mcp-tools.md
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { getMindTools, getAllowedTools, ANIMUS_TOOL_DEFS, type AnimusToolName, type PermissionTier } from '@animus-labs/shared';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';
import { executeTool } from '../registry.js';
import type { ToolHandlerContext, ToolResult } from '../types.js';
import {
  handleRecordThought,
  handleRecordCognitiveState,
  recordThoughtSchema,
  recordCognitiveStateSchema,
} from '../../heartbeat/cognitive-tools.js';
import { createLogger } from '../../lib/logger.js';
import { logProcessSpawn } from '../../lib/process-diagnostics.js';

const log = createLogger('McpBridge', 'heartbeat');

// ============================================================================
// Types
// ============================================================================

/**
 * Lookup of tool_name → mode from the tool_permissions table.
 * Callers pass this in so the MCP server builders stay decoupled from DB access.
 */
export type ToolPermissionLookup = Map<string, import('@animus-labs/shared').ToolPermissionMode>;

/**
 * Mutable reference to the current tick's tool context.
 * Updated before each mind prompt; handlers read at call time.
 */
export interface MutableToolContext {
  current: ToolHandlerContext | null;
}

/** Tool set identifiers for the bridge */
export type ToolSet = 'mind' | 'cognitive' | 'subagent';

/** JSON Schema tool definition returned by the bridge */
export interface BridgeToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ============================================================================
// Context Registry
// ============================================================================

const contextRegistry = new Map<string, MutableToolContext>();

/**
 * Register a tool context for a given task ID.
 * Mind session registers as taskId='mind'.
 * Sub-agents register with their UUID task IDs.
 */
export function registerContext(taskId: string, ctx: MutableToolContext): void {
  contextRegistry.set(taskId, ctx);
  log.debug(`Registered context for taskId=${taskId}`);
}

/**
 * Unregister a tool context when a session ends.
 */
export function unregisterContext(taskId: string): void {
  contextRegistry.delete(taskId);
  log.debug(`Unregistered context for taskId=${taskId}`);
}

// ============================================================================
// Permission State
// ============================================================================

let currentPermissions: ToolPermissionLookup | null = null;
let currentSubagentTier: PermissionTier = 'primary';

/**
 * Update the permission lookup used for tool filtering.
 * Call this when tool permissions change or on session creation.
 */
export function updatePermissions(permissions: ToolPermissionLookup): void {
  currentPermissions = permissions;
}

/**
 * Update the sub-agent permission tier.
 */
export function updateSubagentTier(tier: PermissionTier): void {
  currentSubagentTier = tier;
}

// ============================================================================
// Tool List Generation
// ============================================================================

function convertZodToJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  return zodToJsonSchema(schema, { target: 'openApi3' }) as Record<string, unknown>;
}

/**
 * Get tool definitions for a given tool set, with permission filtering applied.
 */
export function getToolDefs(toolSet: ToolSet): BridgeToolDef[] {
  if (toolSet === 'cognitive') {
    return [
      {
        name: 'record_thought',
        description:
          'Your first action every time you respond. Call this once before writing any reply ' +
          'or calling any other tool. It is critical that this is the very first thing you do.',
        inputSchema: convertZodToJsonSchema(recordThoughtSchema),
      },
      {
        name: 'record_cognitive_state',
        description:
          'MANDATORY — call this exactly once after your reply. Your response is not complete ' +
          'until you call this tool. record_thought bookends the start of your turn; this ' +
          'bookends the end. Without it, your thoughts, emotions, and experiences are lost. ' +
          'Call it after your final reply text, then you are done.',
        inputSchema: convertZodToJsonSchema(recordCognitiveStateSchema),
      },
    ];
  }

  if (toolSet === 'mind') {
    const mindTools = getMindTools();
    const defs: BridgeToolDef[] = [];

    for (const def of mindTools) {
      const toolName = def.name as AnimusToolName;
      // Filter out tools disabled via tool_permissions (mode = 'off')
      if (currentPermissions) {
        const mode = currentPermissions.get(toolName);
        if (mode === 'off') continue;
      }
      defs.push({
        name: toolName,
        description: def.description,
        inputSchema: convertZodToJsonSchema(def.inputSchema),
      });
    }
    return defs;
  }

  // subagent
  const toolNames = getAllowedTools(currentSubagentTier);
  const defs: BridgeToolDef[] = [];
  for (const toolName of toolNames) {
    const def = ANIMUS_TOOL_DEFS[toolName];
    // Sub-agents only get always_allow tools — exclude off and ask
    if (currentPermissions) {
      const mode = currentPermissions.get(toolName);
      if (mode === 'off' || mode === 'ask') continue;
    }
    defs.push({
      name: toolName,
      description: def.description,
      inputSchema: convertZodToJsonSchema(def.inputSchema),
    });
  }
  return defs;
}

// ============================================================================
// HTTP Bridge Server
// ============================================================================

let server: Server | null = null;
let bridgePort: number | null = null;

/**
 * Read a JSON body from an HTTP request.
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

/**
 * Send a JSON response.
 */
function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

/**
 * Handle incoming HTTP requests.
 */
async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost`);
  const path = url.pathname;

  try {
    // GET /tools — returns tool definitions
    if (req.method === 'GET' && path === '/tools') {
      const toolSet = url.searchParams.get('set') as ToolSet | null;
      if (!toolSet || !['mind', 'cognitive', 'subagent'].includes(toolSet)) {
        jsonResponse(res, 400, { error: 'Missing or invalid "set" parameter' });
        return;
      }
      const defs = getToolDefs(toolSet);
      log.info(`Bridge GET /tools: set=${toolSet}, returning ${defs.length} tools: ${defs.map(d => d.name).join(', ')}`);
      jsonResponse(res, 200, { tools: defs });
      return;
    }

    // POST /execute — executes an Animus tool
    if (req.method === 'POST' && path === '/execute') {
      const body = JSON.parse(await readBody(req));
      const { taskId, toolName, args } = body as {
        taskId: string;
        toolName: string;
        args: Record<string, unknown>;
      };

      const ctxRef = contextRegistry.get(taskId);
      if (!ctxRef || !ctxRef.current) {
        jsonResponse(res, 200, {
          content: [{ type: 'text', text: 'Tool unavailable: no active tick context.' }],
          isError: true,
        });
        return;
      }

      log.info(`Bridge tool call: ${toolName} (taskId=${taskId})`);
      const result: ToolResult = await executeTool(toolName as AnimusToolName, args, ctxRef.current);
      jsonResponse(res, 200, result);
      return;
    }

    // POST /cognitive/thought — records a thought
    if (req.method === 'POST' && path === '/cognitive/thought') {
      const body = JSON.parse(await readBody(req));
      const parsed = recordThoughtSchema.safeParse(body);
      if (!parsed.success) {
        log.warn('Invalid record_thought input:', parsed.error.message);
        jsonResponse(res, 200, { content: [{ type: 'text', text: `Invalid input: ${parsed.error.message}` }], isError: true });
        return;
      }
      const result = handleRecordThought(parsed.data);
      jsonResponse(res, 200, result);
      return;
    }

    // POST /cognitive/state — records cognitive state
    if (req.method === 'POST' && path === '/cognitive/state') {
      const body = JSON.parse(await readBody(req));
      const parsed = recordCognitiveStateSchema.safeParse(body);
      if (!parsed.success) {
        log.warn('Invalid record_cognitive_state input:', parsed.error.message);
        jsonResponse(res, 200, { content: [{ type: 'text', text: `Invalid input: ${parsed.error.message}` }], isError: true });
        return;
      }
      const result = handleRecordCognitiveState(parsed.data);
      jsonResponse(res, 200, result);
      return;
    }

    // GET /health — simple health check
    if (req.method === 'GET' && path === '/health') {
      jsonResponse(res, 200, { ok: true });
      return;
    }

    jsonResponse(res, 404, { error: 'Not found' });
  } catch (err) {
    log.error('Bridge request error:', err);
    jsonResponse(res, 500, {
      content: [{ type: 'text', text: `Bridge error: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    });
  }
}

/**
 * Start the bridge HTTP server. Returns the ephemeral port.
 * Idempotent — calling when already running returns the existing port.
 */
export async function startBridge(): Promise<number> {
  if (server && bridgePort) {
    return bridgePort;
  }

  return new Promise((resolve, reject) => {
    const srv = createServer((req, res) => {
      handleRequest(req, res).catch((err) => {
        log.error('Unhandled bridge error:', err);
        try {
          jsonResponse(res, 500, { error: 'Internal bridge error' });
        } catch {
          // Response may already be sent
        }
      });
    });

    // Bind to loopback only for security
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to get bridge address'));
        return;
      }
      server = srv;
      bridgePort = addr.port;
      log.info(`MCP bridge started on 127.0.0.1:${bridgePort}`);
      resolve(bridgePort);
    });

    srv.on('error', (err) => {
      log.error('Bridge server error:', err);
      reject(err);
    });
  });
}

/**
 * Stop the bridge HTTP server.
 */
export async function stopBridge(): Promise<void> {
  if (!server) return;
  return new Promise((resolve) => {
    server!.close(() => {
      log.info('MCP bridge stopped');
      server = null;
      bridgePort = null;
      resolve();
    });
  });
}

/**
 * Get the current bridge port (null if not started).
 */
export function getBridgePort(): number | null {
  return bridgePort;
}

// ============================================================================
// Stdio MCP Server Config Builder
// ============================================================================

// Cache the resolved tsx binary path to avoid repeated lookups.
let resolvedTsxPath: string | null = null;

/**
 * Resolve the tsx binary path. In dev mode, we need tsx to run .ts files.
 * Resolving once and using the absolute path avoids npx overhead (~500ms)
 * and eliminates potential conflicts from concurrent npx invocations.
 */
function resolveTsxBinary(): string {
  if (resolvedTsxPath) return resolvedTsxPath;

  const thisDir = dirname(fileURLToPath(import.meta.url));

  // Walk up to find node_modules/.bin/tsx relative to the project root
  // From packages/backend/src/tools/servers/ -> ../../../../node_modules/.bin/tsx
  const candidates = [
    resolve(thisDir, '../../../../..', 'node_modules/.bin/tsx'),  // monorepo root
    resolve(thisDir, '../../../..', 'node_modules/.bin/tsx'),     // package root
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      resolvedTsxPath = candidate;
      log.info(`Resolved tsx binary: ${resolvedTsxPath}`);
      return resolvedTsxPath;
    }
  }

  // Fallback: use npx (slower but works)
  log.warn('Could not resolve tsx binary path, falling back to npx');
  resolvedTsxPath = 'npx';
  return resolvedTsxPath;
}

/**
 * Build a stdio MCP server config for use with any agent SDK.
 *
 * Returns a standard `{ command, args, env }` config that SDKs use
 * to spawn an MCP subprocess.
 *
 * @param port     Bridge port to connect to
 * @param toolSet  Which tools to expose: 'mind', 'cognitive', 'subagent'
 * @param taskId   Task ID for context lookup in the bridge
 */
export function buildMcpServerConfig(
  port: number,
  toolSet: ToolSet,
  taskId: string,
): { command: string; args: string[]; env: Record<string, string> } {
  // Resolve the animus-mcp-server.ts/.js path relative to this file
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const isDev = import.meta.url.endsWith('.ts');

  let command: string;
  let args: string[];

  if (isDev) {
    // Dev mode: run .ts file with tsx (resolved binary, not npx)
    const scriptPath = join(thisDir, 'animus-mcp-server.ts');
    const tsxBin = resolveTsxBinary();
    if (tsxBin === 'npx') {
      command = 'npx';
      args = ['tsx', scriptPath];
    } else {
      command = tsxBin;
      args = [scriptPath];
    }
  } else {
    // Production: run compiled .js
    const scriptPath = join(thisDir, 'animus-mcp-server.js');
    command = 'node';
    args = [scriptPath];
  }

  // The Claude SDK's CLI spawns MCP servers by merging a default env allowlist
  // (HOME, PATH, USER, etc.) with our config env. We include vars that aren't
  // on the allowlist but are needed for correct behavior.
  const env: Record<string, string> = {
    BRIDGE_PORT: String(port),
    TOOL_SET: toolSet,
    TASK_ID: taskId,
  };

  // macOS dock icon suppression for MCP server processes.
  if (process.platform === 'darwin') {
    const dockAddon = process.env['ANIMUS_DOCK_SUPPRESS_ADDON'];
    if (dockAddon) {
      env['DYLD_INSERT_LIBRARIES'] = dockAddon;
    }
    // Pass data dir so the addon diagnostic log works in MCP servers
    const dataDir = process.env['ANIMUS_DATA_DIR'];
    if (dataDir) {
      env['ANIMUS_DATA_DIR'] = dataDir;
    }
  }

  logProcessSpawn(`mcp:${toolSet}:${taskId}`, command, args, env);

  return { command, args, env };
}
