import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Mutable temp dirs, set per test before the (reset) module graph loads.
let dataDir = '';
let agentEnvDir = '';

vi.mock('../../src/utils/env.js', () => ({
  get DATA_DIR() { return dataDir; },
  get AGENT_ENV_DIR() { return agentEnvDir; },
  env: { LOG_LEVEL: 'error' },
  APP_VERSION: '0.0.0-test',
}));

type EnvService = ReturnType<
  typeof import('../../src/services/environment-service.js')['getEnvironmentService']
>;

async function freshService(): Promise<EnvService> {
  vi.resetModules();
  const mod = await import('../../src/services/environment-service.js');
  return mod.getEnvironmentService();
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'animus-env-test-'));
  agentEnvDir = path.join(dataDir, 'agent-env');
  process.env['PATH'] = ['/usr/bin', '/bin'].join(path.delimiter);
});

afterEach(() => {
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('EnvironmentService', () => {
  it('creates the agent-env directory structure on apply', async () => {
    const svc = await freshService();
    svc.applyToProcessEnv();
    expect(fs.existsSync(path.join(agentEnvDir, 'tools'))).toBe(true);
    expect(fs.existsSync(path.join(agentEnvDir, 'bin'))).toBe(true);
    expect(fs.existsSync(path.join(agentEnvDir, 'skills'))).toBe(true);
    // Base PATH preserved
    expect(process.env['PATH']!.split(path.delimiter)).toContain('/usr/bin');
  });

  it('adds a directory to PATH and persists it', async () => {
    const svc = await freshService();
    svc.applyToProcessEnv();
    svc.addPath('/custom/tool/bin');
    expect(process.env['PATH']!.split(path.delimiter)).toContain('/custom/tool/bin');

    // Persisted to manifest and survives a fresh service instance
    const svc2 = await freshService();
    expect(svc2.readManifest().pathAdditions).toContain('/custom/tool/bin');
  });

  it('removes a previously added PATH directory from process.env', async () => {
    const svc = await freshService();
    svc.applyToProcessEnv();
    svc.addPath('/temp/bin');
    expect(process.env['PATH']!.split(path.delimiter)).toContain('/temp/bin');
    svc.removePath('/temp/bin');
    expect(process.env['PATH']!.split(path.delimiter)).not.toContain('/temp/bin');
  });

  it('resolves ${AGENT_ENV} in path additions', async () => {
    const svc = await freshService();
    svc.applyToProcessEnv();
    svc.addPath('${AGENT_ENV}/tools/foo/bin');
    expect(process.env['PATH']!.split(path.delimiter)).toContain(`${agentEnvDir}/tools/foo/bin`);
    // The raw (unresolved) placeholder is what gets persisted.
    expect(svc.readManifest().pathAdditions).toContain('${AGENT_ENV}/tools/foo/bin');
  });

  it('registers a tool, adds its bin to PATH, and surfaces it in the summary', async () => {
    const svc = await freshService();
    svc.applyToProcessEnv();
    svc.registerTool({ name: 'node', binDir: '/opt/node/bin', version: 'v22.11.0' });
    expect(process.env['PATH']!.split(path.delimiter)).toContain('/opt/node/bin');
    expect(svc.getToolSummary()).toContain('node v22.11.0');

    svc.unregisterTool('node');
    expect(svc.getToolSummary()).toBeNull();
    expect(process.env['PATH']!.split(path.delimiter)).not.toContain('/opt/node/bin');
  });

  it('sets allowlisted env vars and rejects denylisted/sensitive ones', async () => {
    const svc = await freshService();
    svc.setVar('FOO_HOME', '/foo');
    expect(process.env['FOO_HOME']).toBe('/foo');
    svc.unsetVar('FOO_HOME');
    expect(process.env['FOO_HOME']).toBeUndefined();

    expect(() => svc.setVar('PATH', '/evil')).toThrow();
    expect(() => svc.setVar('NODE_OPTIONS', '--x')).toThrow();
    expect(() => svc.setVar('LD_PRELOAD', '/x.so')).toThrow();
    expect(() => svc.setVar('DYLD_INSERT_LIBRARIES', '/x.dylib')).toThrow();
  });

  it('returns an empty manifest when the file is absent', async () => {
    const svc = await freshService();
    const manifest = svc.readManifest();
    expect(manifest.pathAdditions).toEqual([]);
    expect(manifest.tools).toEqual({});
    expect(manifest.version).toBe(1);
  });
});
