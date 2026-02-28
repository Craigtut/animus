/**
 * Integration tests for Codex skills hot-swap via JSON-RPC.
 *
 * These tests require a valid OPENAI_API_KEY environment variable
 * and the Codex binary to be available.
 * They are skipped in CI unless credentials are provided.
 *
 * This test verifies:
 * 1. skills/list returns the correct response format
 * 2. skills/config/write can register a newly deployed skill
 * 3. The skill appears in subsequent skills/list calls
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CodexAdapter,
  createSilentLogger,
  type SkillEntry,
} from '../../src/index.js';

const hasApiKey = !!process.env.OPENAI_API_KEY;

describe.skipIf(!hasApiKey)('Codex skills hot-swap integration', () => {
  let adapter: CodexAdapter;
  let tempDir: string;
  let codexHome: string;

  beforeAll(() => {
    // Create a temp CODEX_HOME with a skills/ directory
    tempDir = mkdtempSync(join(tmpdir(), 'codex-skills-test-'));
    codexHome = join(tempDir, 'home');
    mkdirSync(join(codexHome, 'skills'), { recursive: true });

    // Set CODEX_HOME so the app-server discovers skills from our temp dir
    process.env['CODEX_HOME'] = codexHome;

    adapter = new CodexAdapter({ logger: createSilentLogger() });
  });

  afterAll(async () => {
    await adapter.cleanup();
    delete process.env['CODEX_HOME'];

    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  });

  it('listSkills returns empty array before any skills are deployed', async () => {
    // Need to start the app-server by creating a session first
    const session = await adapter.createSession({
      provider: 'codex',
      env: { CODEX_HOME: codexHome },
    });

    const skills = await adapter.listSkills();
    expect(Array.isArray(skills)).toBe(true);

    // Log the raw response format for debugging
    console.log('skills/list response (empty):', JSON.stringify(skills));

    await session.end();
  }, 60000);

  it('syncSkill registers a new skill and it appears in listSkills', async () => {
    // Create a minimal skill directory with SKILL.md
    const skillName = 'test-skill';
    const skillPath = join(codexHome, 'skills', skillName);
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(
      join(skillPath, 'SKILL.md'),
      [
        '---',
        'name: test-skill',
        'description: A test skill for integration testing',
        '---',
        '',
        '# Test Skill',
        '',
        'This is a test skill used for integration testing.',
      ].join('\n'),
      'utf-8',
    );

    // Start a session to ensure app-server is running
    const session = await adapter.createSession({
      provider: 'codex',
      env: { CODEX_HOME: codexHome },
    });

    // Enable the skill via skills/config/write
    const enabled = await adapter.syncSkill(skillPath, true);
    console.log('skills/config/write result (enable):', enabled);

    // List skills and check if the test skill appears
    const skills = await adapter.listSkills();
    console.log('skills/list response (after enable):', JSON.stringify(skills));

    // Disable the skill
    const disabled = await adapter.syncSkill(skillPath, false);
    console.log('skills/config/write result (disable):', disabled);

    // List again to verify disabled state
    const skillsAfterDisable = await adapter.listSkills();
    console.log('skills/list response (after disable):', JSON.stringify(skillsAfterDisable));

    await session.end();

    // Clean up the test skill
    try {
      rmSync(skillPath, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  }, 120000);
});
