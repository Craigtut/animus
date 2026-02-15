import { describe, it, expect } from 'vitest';
import {
  PluginManifestSchema,
  AgentFrontmatterSchema,
  ContextSourceSchema,
  HookDefinitionSchema,
  DecisionTypeSchema,
  TriggerDefinitionSchema,
  PluginMcpServerSchema,
  pluginSourceSchema,
  PluginRecordSchema,
} from '../plugin.js';
import {
  triggerTypeSchema,
  decisionTypeSchema,
  builtInDecisionTypeSchema,
} from '../heartbeat.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    name: 'my-plugin',
    displayName: 'My Plugin',
    version: '1.0.0',
    description: 'A test plugin',
    author: { name: 'Test Author' },
    components: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PluginManifestSchema
// ---------------------------------------------------------------------------

describe('PluginManifestSchema', () => {
  it('parses a minimal valid manifest', () => {
    const result = PluginManifestSchema.parse(validManifest());
    expect(result.name).toBe('my-plugin');
    expect(result.version).toBe('1.0.0');
    expect(result.dependencies).toEqual({ plugins: [], system: {} });
    expect(result.permissions).toEqual({
      tools: [],
      network: false,
      filesystem: 'none',
      contacts: false,
      memory: 'none',
    });
  });

  it('parses a full manifest with all optional fields', () => {
    const result = PluginManifestSchema.parse(validManifest({
      license: 'MIT',
      engine: '>=1.0.0',
      author: { name: 'Test Author', url: 'https://example.com' },
      components: {
        skills: './skills',
        tools: './tools.json',
        context: './context.json',
        hooks: './hooks.json',
        decisions: './decisions.json',
        triggers: './triggers.json',
        agents: './agents',
      },
      dependencies: {
        plugins: ['other-plugin'],
        system: { node: '>=20' },
      },
      permissions: {
        tools: ['filesystem'],
        network: true,
        filesystem: 'read-write',
        contacts: true,
        memory: 'read-write',
      },
      configSchema: './config.schema.json',
      setup: './setup.js',
      store: {
        categories: ['productivity'],
        tags: ['tool'],
        pricing: 'free',
        screenshots: ['./screenshot.png'],
        featured: true,
      },
    }));

    expect(result.license).toBe('MIT');
    expect(result.components.skills).toBe('./skills');
    expect(result.dependencies.plugins).toEqual(['other-plugin']);
    expect(result.permissions.network).toBe(true);
    expect(result.permissions.filesystem).toBe('read-write');
    expect(result.store?.featured).toBe(true);
  });

  it('rejects invalid plugin name (uppercase)', () => {
    expect(() => PluginManifestSchema.parse(validManifest({ name: 'MyPlugin' }))).toThrow();
  });

  it('rejects invalid plugin name (spaces)', () => {
    expect(() => PluginManifestSchema.parse(validManifest({ name: 'my plugin' }))).toThrow();
  });

  it('rejects invalid version format', () => {
    expect(() => PluginManifestSchema.parse(validManifest({ version: 'latest' }))).toThrow();
  });

  it('rejects description over 200 characters', () => {
    expect(() => PluginManifestSchema.parse(validManifest({ description: 'x'.repeat(201) }))).toThrow();
  });

  it('rejects missing required fields', () => {
    expect(() => PluginManifestSchema.parse({})).toThrow();
    expect(() => PluginManifestSchema.parse({ name: 'test' })).toThrow();
  });

  it('rejects invalid filesystem permission value', () => {
    expect(() => PluginManifestSchema.parse(validManifest({
      permissions: { filesystem: 'execute' },
    }))).toThrow();
  });

  it('rejects invalid memory permission value', () => {
    expect(() => PluginManifestSchema.parse(validManifest({
      permissions: { memory: 'admin' },
    }))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// AgentFrontmatterSchema
// ---------------------------------------------------------------------------

describe('AgentFrontmatterSchema', () => {
  it('parses valid agent frontmatter', () => {
    const result = AgentFrontmatterSchema.parse({
      name: 'researcher',
      description: 'A research agent',
    });
    expect(result.name).toBe('researcher');
    expect(result.tools).toEqual([]);
    expect(result.maxTurns).toBeUndefined();
  });

  it('parses with optional fields', () => {
    const result = AgentFrontmatterSchema.parse({
      name: 'coder',
      description: 'A coding agent',
      tools: ['file_read', 'file_write'],
      maxTurns: 10,
    });
    expect(result.tools).toEqual(['file_read', 'file_write']);
    expect(result.maxTurns).toBe(10);
  });

  it('rejects description over 200 characters', () => {
    expect(() => AgentFrontmatterSchema.parse({
      name: 'agent',
      description: 'x'.repeat(201),
    })).toThrow();
  });

  it('rejects non-positive maxTurns', () => {
    expect(() => AgentFrontmatterSchema.parse({
      name: 'agent',
      description: 'desc',
      maxTurns: 0,
    })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ContextSourceSchema
// ---------------------------------------------------------------------------

describe('ContextSourceSchema', () => {
  it('parses a static context source', () => {
    const result = ContextSourceSchema.parse({
      name: 'readme',
      description: 'Project readme',
      type: 'static',
      maxTokens: 500,
      content: '# Hello',
    });
    expect(result.type).toBe('static');
    expect(result.priority).toBe(5);
  });

  it('parses a retrieval context source', () => {
    const result = ContextSourceSchema.parse({
      name: 'search',
      description: 'Semantic search',
      type: 'retrieval',
      maxTokens: 1000,
      priority: 8,
      provider: { command: 'node', args: ['search.js'] },
    });
    expect(result.type).toBe('retrieval');
    expect(result.provider?.command).toBe('node');
  });

  it('rejects invalid type', () => {
    expect(() => ContextSourceSchema.parse({
      name: 'test',
      description: 'test',
      type: 'dynamic',
      maxTokens: 100,
    })).toThrow();
  });

  it('rejects non-positive maxTokens', () => {
    expect(() => ContextSourceSchema.parse({
      name: 'test',
      description: 'test',
      type: 'static',
      maxTokens: 0,
    })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// HookDefinitionSchema
// ---------------------------------------------------------------------------

describe('HookDefinitionSchema', () => {
  it('parses a valid hook definition', () => {
    const result = HookDefinitionSchema.parse({
      event: 'preTick',
      handler: { type: 'command', command: 'node hook.js' },
    });
    expect(result.event).toBe('preTick');
    expect(result.matcher).toBeUndefined();
  });

  it('parses with matcher', () => {
    const result = HookDefinitionSchema.parse({
      event: 'postDecision',
      matcher: { type: 'spawn_agent' },
      handler: { type: 'command', command: 'node hook.js' },
    });
    expect(result.matcher).toEqual({ type: 'spawn_agent' });
  });

  it('rejects invalid event name', () => {
    expect(() => HookDefinitionSchema.parse({
      event: 'invalidEvent',
      handler: { type: 'command', command: 'node hook.js' },
    })).toThrow();
  });

  it('accepts all valid hook events', () => {
    const events = [
      'preTick', 'postTick',
      'preDecision', 'postDecision',
      'preSubAgent', 'postSubAgent',
      'preMessage', 'postMessage',
      'onPluginInstall', 'onPluginRemove',
    ];
    for (const event of events) {
      expect(() => HookDefinitionSchema.parse({
        event,
        handler: { type: 'command', command: 'test' },
      })).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// DecisionTypeSchema (plugin custom decision)
// ---------------------------------------------------------------------------

describe('DecisionTypeSchema', () => {
  it('parses a valid custom decision type', () => {
    const result = DecisionTypeSchema.parse({
      name: 'deploy_code',
      description: 'Deploy code to production',
      payloadSchema: { repo: 'string', branch: 'string' },
      handler: { type: 'command', command: 'node deploy.js' },
    });
    expect(result.name).toBe('deploy_code');
    expect(result.contactTier).toBe('primary');
  });

  it('rejects invalid name (uppercase)', () => {
    expect(() => DecisionTypeSchema.parse({
      name: 'DeployCode',
      description: 'Deploy',
      payloadSchema: {},
      handler: { type: 'command', command: 'test' },
    })).toThrow();
  });

  it('rejects description over 500 characters', () => {
    expect(() => DecisionTypeSchema.parse({
      name: 'test',
      description: 'x'.repeat(501),
      payloadSchema: {},
      handler: { type: 'command', command: 'test' },
    })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// TriggerDefinitionSchema
// ---------------------------------------------------------------------------

describe('TriggerDefinitionSchema', () => {
  it('parses an HTTP trigger', () => {
    const result = TriggerDefinitionSchema.parse({
      name: 'webhook',
      description: 'Receive webhooks',
      type: 'http',
      config: { path: '/hooks/deploy', methods: ['POST', 'PUT'] },
    });
    expect(result.type).toBe('http');
    expect(result.config.methods).toEqual(['POST', 'PUT']);
  });

  it('parses a watcher trigger', () => {
    const result = TriggerDefinitionSchema.parse({
      name: 'file-watcher',
      description: 'Watch for file changes',
      type: 'watcher',
      config: { command: 'node watch.js', interval: 5000 },
    });
    expect(result.type).toBe('watcher');
  });

  it('defaults methods to POST', () => {
    const result = TriggerDefinitionSchema.parse({
      name: 'trigger',
      description: 'A trigger',
      type: 'http',
      config: {},
    });
    expect(result.config.methods).toEqual(['POST']);
  });

  it('rejects invalid name characters', () => {
    expect(() => TriggerDefinitionSchema.parse({
      name: 'My Trigger!',
      description: 'Bad name',
      type: 'http',
      config: {},
    })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// PluginMcpServerSchema
// ---------------------------------------------------------------------------

describe('PluginMcpServerSchema', () => {
  it('parses a valid MCP server config', () => {
    const result = PluginMcpServerSchema.parse({
      command: 'node',
      args: ['server.js'],
      env: { PORT: '3001' },
      description: 'A tool server',
    });
    expect(result.command).toBe('node');
    expect(result.args).toEqual(['server.js']);
  });

  it('applies defaults for args and env', () => {
    const result = PluginMcpServerSchema.parse({ command: 'python' });
    expect(result.args).toEqual([]);
    expect(result.env).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// pluginSourceSchema & PluginRecordSchema
// ---------------------------------------------------------------------------

describe('pluginSourceSchema', () => {
  it('accepts all valid source types', () => {
    for (const source of ['built-in', 'local', 'git', 'npm', 'store']) {
      expect(pluginSourceSchema.parse(source)).toBe(source);
    }
  });

  it('rejects invalid source', () => {
    expect(() => pluginSourceSchema.parse('docker')).toThrow();
  });
});

describe('PluginRecordSchema', () => {
  it('parses a valid plugin record', () => {
    const result = PluginRecordSchema.parse({
      name: 'my-plugin',
      version: '1.0.0',
      path: '/plugins/my-plugin',
      enabled: true,
      installedAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      source: 'local',
      storeId: null,
      configEncrypted: null,
    });
    expect(result.name).toBe('my-plugin');
    expect(result.enabled).toBe(true);
  });

  it('accepts store source with storeId', () => {
    const result = PluginRecordSchema.parse({
      name: 'store-plugin',
      version: '2.0.0',
      path: '/plugins/store-plugin',
      enabled: false,
      installedAt: '2024-06-01T00:00:00Z',
      updatedAt: '2024-06-15T00:00:00Z',
      source: 'store',
      storeId: 'abc-123',
      configEncrypted: 'encrypted-data',
    });
    expect(result.source).toBe('store');
    expect(result.storeId).toBe('abc-123');
  });
});

// ---------------------------------------------------------------------------
// Heartbeat schema updates (triggerType + decisionType)
// ---------------------------------------------------------------------------

describe('triggerTypeSchema (plugin_trigger)', () => {
  it('accepts plugin_trigger', () => {
    expect(triggerTypeSchema.parse('plugin_trigger')).toBe('plugin_trigger');
  });

  it('still accepts all original trigger types', () => {
    for (const t of ['interval', 'message', 'scheduled_task', 'agent_complete']) {
      expect(triggerTypeSchema.parse(t)).toBe(t);
    }
  });
});

describe('decisionTypeSchema (extended for plugins)', () => {
  it('accepts built-in decision types', () => {
    for (const t of ['spawn_agent', 'send_message', 'no_action', 'schedule_task']) {
      expect(decisionTypeSchema.parse(t)).toBe(t);
    }
  });

  it('accepts arbitrary string decision types (plugin-defined)', () => {
    expect(decisionTypeSchema.parse('deploy_code')).toBe('deploy_code');
    expect(decisionTypeSchema.parse('send_email')).toBe('send_email');
    expect(decisionTypeSchema.parse('custom_plugin_action')).toBe('custom_plugin_action');
  });

  it('builtInDecisionTypeSchema rejects arbitrary strings', () => {
    expect(() => builtInDecisionTypeSchema.parse('deploy_code')).toThrow();
  });

  it('builtInDecisionTypeSchema accepts built-in types', () => {
    expect(builtInDecisionTypeSchema.parse('spawn_agent')).toBe('spawn_agent');
    expect(builtInDecisionTypeSchema.parse('no_action')).toBe('no_action');
  });
});
