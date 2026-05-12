import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { request as httpRequest } from 'node:http';
import {
  startBridge,
  stopBridge,
  getBridgePort,
  registerContext,
  unregisterContext,
  updatePermissions,
  updateSubagentTier,
  getToolDefs,
  buildMcpServerConfig,
  type MutableToolContext,
  type ToolPermissionLookup,
} from '../../src/tools/servers/mcp-bridge.js';

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpGet(port: number, path: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: '127.0.0.1', port, path, method: 'GET', headers: { Accept: 'application/json' } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString()) });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function httpPost(port: number, path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString()) });
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP Bridge', () => {
  let port: number;

  beforeEach(async () => {
    port = await startBridge();
    updatePermissions(new Map());
  });

  afterEach(async () => {
    await stopBridge();
  });

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  describe('lifecycle', () => {
    it('starts on an ephemeral port', () => {
      expect(port).toBeGreaterThan(0);
      expect(getBridgePort()).toBe(port);
    });

    it('is idempotent — calling startBridge again returns same port', async () => {
      const port2 = await startBridge();
      expect(port2).toBe(port);
    });

    it('stops and resets port', async () => {
      await stopBridge();
      expect(getBridgePort()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Health endpoint
  // -------------------------------------------------------------------------

  describe('GET /health', () => {
    it('returns ok', async () => {
      const res = await httpGet(port, '/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });
  });

  // -------------------------------------------------------------------------
  // Tool list endpoint
  // -------------------------------------------------------------------------

  describe('GET /tools', () => {
    it('returns 400 for missing set parameter', async () => {
      const res = await httpGet(port, '/tools');
      expect(res.status).toBe(400);
    });

    it('returns 400 for the removed legacy cognitive tool set', async () => {
      const res = await httpGet(port, '/tools?set=cognitive');
      expect(res.status).toBe(400);
    });

    it('returns mind tools', async () => {
      const res = await httpGet(port, '/tools?set=mind');
      expect(res.status).toBe(200);
      const body = res.body as { tools: Array<{ name: string }> };
      expect(body.tools.length).toBeGreaterThan(0);
      // All mind tools should have name, description, inputSchema
      for (const tool of body.tools) {
        expect(tool.name).toBeTruthy();
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
      }
    });

    it('filters out disabled tools from mind set', async () => {
      const perms: ToolPermissionLookup = new Map([['read_memory', 'off']]);
      updatePermissions(perms);
      const res = await httpGet(port, '/tools?set=mind');
      const body = res.body as { tools: Array<{ name: string }> };
      expect(body.tools.find((t) => t.name === 'read_memory')).toBeUndefined();
    });

    it('returns subagent tools', async () => {
      const res = await httpGet(port, '/tools?set=subagent');
      expect(res.status).toBe(200);
      const body = res.body as { tools: Array<{ name: string }> };
      expect(body.tools.length).toBeGreaterThan(0);
    });

    it('filters out ask and off tools from subagent set', async () => {
      const perms: ToolPermissionLookup = new Map([
        ['send_message', 'ask'],
        ['read_memory', 'off'],
      ]);
      updatePermissions(perms);
      const res = await httpGet(port, '/tools?set=subagent');
      const body = res.body as { tools: Array<{ name: string }> };
      expect(body.tools.find((t) => t.name === 'send_message')).toBeUndefined();
      expect(body.tools.find((t) => t.name === 'read_memory')).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Execute endpoint
  // -------------------------------------------------------------------------

  describe('POST /execute', () => {
    it('returns error when no context is registered', async () => {
      const res = await httpPost(port, '/execute', {
        taskId: 'nonexistent',
        toolName: 'read_memory',
        args: { query: 'test' },
      });
      expect(res.status).toBe(200);
      const body = res.body as { content: Array<{ text: string }>; isError: boolean };
      expect(body.isError).toBe(true);
      expect(body.content[0]!.text).toContain('no active tick context');
    });

    it('returns error when context.current is null', async () => {
      const ctx: MutableToolContext = { current: null };
      registerContext('test-task', ctx);

      const res = await httpPost(port, '/execute', {
        taskId: 'test-task',
        toolName: 'read_memory',
        args: { query: 'test' },
      });
      expect(res.status).toBe(200);
      const body = res.body as { isError: boolean };
      expect(body.isError).toBe(true);

      unregisterContext('test-task');
    });
  });

  // -------------------------------------------------------------------------
  // Context registry
  // -------------------------------------------------------------------------

  describe('context registry', () => {
    it('registers and unregisters contexts', () => {
      const ctx: MutableToolContext = { current: null };
      registerContext('task-1', ctx);
      // After unregistering, execute should fail
      unregisterContext('task-1');
      // Verify it's gone by trying execute
    });
  });

  // -------------------------------------------------------------------------
  // getToolDefs (unit, no HTTP)
  // -------------------------------------------------------------------------

  describe('getToolDefs', () => {
    it('returns mind tool defs with JSON Schema', () => {
      const defs = getToolDefs('mind');
      expect(defs.length).toBeGreaterThan(0);
      for (const def of defs) {
        expect(def.inputSchema).toBeDefined();
        expect(typeof def.inputSchema).toBe('object');
      }
    });
  });

  // -------------------------------------------------------------------------
  // buildMcpServerConfig
  // -------------------------------------------------------------------------

  describe('buildMcpServerConfig', () => {
    it('produces a valid config with command, args, env', () => {
      const config = buildMcpServerConfig(12345, 'mind', 'mind');
      expect(config.command).toBeTruthy();
      expect(config.args).toBeInstanceOf(Array);
      expect(config.args.length).toBeGreaterThan(0);
      expect(config.env).toMatchObject({
        BRIDGE_PORT: '12345',
        TOOL_SET: 'mind',
        TASK_ID: 'mind',
      });
    });

    it('sets correct env for subagent tools', () => {
      const config = buildMcpServerConfig(9999, 'subagent', 'task-uuid-123');
      expect(config.env.TOOL_SET).toBe('subagent');
      expect(config.env.TASK_ID).toBe('task-uuid-123');
    });
  });
});
