import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SkillRegistry, parseFrontmatter } from '../../src/skill-registry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-registry-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeSkillFile(name: string, content: string): string {
  const skillDir = path.join(tmpDir, name);
  fs.mkdirSync(skillDir, { recursive: true });
  const filePath = path.join(skillDir, 'SKILL.md');
  fs.writeFileSync(filePath, content);
  return filePath;
}

// ---------------------------------------------------------------------------
// parseFrontmatter tests
// ---------------------------------------------------------------------------

describe('parseFrontmatter', () => {
  it('parses simple key-value pairs', () => {
    const { frontmatter, body } = parseFrontmatter(`---
name: test-skill
description: A test skill
---

Body content here.`);

    expect(frontmatter['name']).toBe('test-skill');
    expect(frontmatter['description']).toBe('A test skill');
    expect(body).toContain('Body content here.');
  });

  it('parses multi-line folded description', () => {
    const { frontmatter } = parseFrontmatter(`---
name: multi-line
description: >
  This is a long description
  that spans multiple lines
  and gets folded into one.
---

Body.`);

    expect(frontmatter['description']).toBe('This is a long description that spans multiple lines and gets folded into one.');
  });

  it('parses boolean values', () => {
    const { frontmatter } = parseFrontmatter(`---
name: bools
disable-model-invocation: true
user-invocable: false
---
Body.`);

    expect(frontmatter['disable-model-invocation']).toBe(true);
    expect(frontmatter['user-invocable']).toBe(false);
  });

  it('parses metadata map', () => {
    const { frontmatter } = parseFrontmatter(`---
name: with-metadata
description: Has metadata
metadata:
  author: test-author
  version: 1.0.0
---
Body.`);

    const metadata = frontmatter['metadata'] as Record<string, string>;
    expect(metadata['author']).toBe('test-author');
    expect(metadata['version']).toBe('1.0.0');
  });

  it('returns empty frontmatter when no delimiters', () => {
    const { frontmatter, body } = parseFrontmatter('Just markdown content.');
    expect(Object.keys(frontmatter)).toHaveLength(0);
    expect(body).toBe('Just markdown content.');
  });

  it('handles allowed-tools as string', () => {
    const { frontmatter } = parseFrontmatter(`---
name: tools-test
allowed-tools: send_message search_memories
---
Body.`);

    expect(frontmatter['allowed-tools']).toBe('send_message search_memories');
  });
});

// ---------------------------------------------------------------------------
// SkillRegistry tests
// ---------------------------------------------------------------------------

describe('SkillRegistry', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  describe('addSkill', () => {
    it('registers a skill from a SKILL.md file', () => {
      const filePath = writeSkillFile('test-skill', `---
name: test-skill
description: A test skill for unit testing.
---

## Instructions
Do the thing.`);

      registry.addSkill({ path: filePath, source: 'builtin' });

      expect(registry.size).toBe(1);
      const entry = registry.getEntry('test-skill');
      expect(entry).not.toBeNull();
      expect(entry!.name).toBe('test-skill');
      expect(entry!.description).toBe('A test skill for unit testing.');
      expect(entry!.source).toBe('builtin');
      expect(entry!.modelInvocable).toBe(true);
    });

    it('derives name from directory when not in frontmatter', () => {
      const filePath = writeSkillFile('my-skill', `---
description: No name field.
---
Body.`);

      registry.addSkill({ path: filePath, source: 'user' });

      const entry = registry.getEntry('my-skill');
      expect(entry).not.toBeNull();
      expect(entry!.name).toBe('my-skill');
    });

    it('respects disable-model-invocation flag', () => {
      const filePath = writeSkillFile('hidden-skill', `---
name: hidden-skill
description: Should be hidden from agent.
disable-model-invocation: true
---
Secret instructions.`);

      registry.addSkill({ path: filePath, source: 'plugin:secret' });

      const entry = registry.getEntry('hidden-skill');
      expect(entry!.modelInvocable).toBe(false);
    });

    it('replaces existing skill with same name', () => {
      const filePath1 = writeSkillFile('dupe-v1', `---
name: dupe
description: Version 1
---
V1 body.`);

      const filePath2 = writeSkillFile('dupe-v2', `---
name: dupe
description: Version 2
---
V2 body.`);

      registry.addSkill({ path: filePath1, source: 'plugin:a' });
      registry.addSkill({ path: filePath2, source: 'plugin:b' });

      expect(registry.size).toBe(1);
      const entry = registry.getEntry('dupe');
      expect(entry!.description).toBe('Version 2');
      expect(entry!.source).toBe('plugin:b');
    });

    it('silently skips unreadable files', () => {
      registry.addSkill({ path: '/nonexistent/SKILL.md', source: 'user' });
      expect(registry.size).toBe(0);
    });
  });

  describe('removeSkill', () => {
    it('removes a registered skill', () => {
      const filePath = writeSkillFile('removable', `---
name: removable
description: Can be removed.
---
Body.`);

      registry.addSkill({ path: filePath, source: 'plugin:test' });
      expect(registry.size).toBe(1);

      registry.removeSkill('removable');
      expect(registry.size).toBe(0);
      expect(registry.getEntry('removable')).toBeNull();
    });

    it('no-ops for unknown skill names', () => {
      registry.removeSkill('nonexistent');
      expect(registry.size).toBe(0);
    });
  });

  describe('getAvailableSkillsSummary', () => {
    it('generates XML listing for available skills', () => {
      const fp1 = writeSkillFile('alpha', `---
name: alpha
description: Alpha skill description.
---
Body.`);
      const fp2 = writeSkillFile('beta', `---
name: beta
description: Beta skill description.
---
Body.`);

      registry.addSkill({ path: fp1, source: 'builtin' });
      registry.addSkill({ path: fp2, source: 'plugin:test' });

      const summary = registry.getAvailableSkillsSummary();

      expect(summary).toContain('<available-skills>');
      expect(summary).toContain('</available-skills>');
      expect(summary).toContain('name="alpha"');
      expect(summary).toContain('name="beta"');
      expect(summary).toContain('Alpha skill description.');
      expect(summary).toContain('Beta skill description.');
    });

    it('excludes skills with disable-model-invocation', () => {
      const fp1 = writeSkillFile('visible', `---
name: visible
description: Visible skill.
---
Body.`);
      const fp2 = writeSkillFile('hidden', `---
name: hidden
description: Hidden skill.
disable-model-invocation: true
---
Body.`);

      registry.addSkill({ path: fp1, source: 'builtin' });
      registry.addSkill({ path: fp2, source: 'builtin' });

      const summary = registry.getAvailableSkillsSummary();
      expect(summary).toContain('name="visible"');
      expect(summary).not.toContain('name="hidden"');
    });

    it('sorts by source priority: builtin > user > plugin', () => {
      const fp1 = writeSkillFile('plugin-skill', `---
name: plugin-skill
description: From plugin.
---
Body.`);
      const fp2 = writeSkillFile('builtin-skill', `---
name: builtin-skill
description: Built-in.
---
Body.`);
      const fp3 = writeSkillFile('user-skill', `---
name: user-skill
description: User defined.
---
Body.`);

      registry.addSkill({ path: fp1, source: 'plugin:x' });
      registry.addSkill({ path: fp2, source: 'builtin' });
      registry.addSkill({ path: fp3, source: 'user' });

      const summary = registry.getAvailableSkillsSummary();
      const builtinIdx = summary.indexOf('builtin-skill');
      const userIdx = summary.indexOf('user-skill');
      const pluginIdx = summary.indexOf('plugin-skill');

      expect(builtinIdx).toBeLessThan(userIdx);
      expect(userIdx).toBeLessThan(pluginIdx);
    });

    it('returns empty message when no skills available', () => {
      const summary = registry.getAvailableSkillsSummary();
      expect(summary).toContain('No skills available');
    });
  });

  describe('getSkillBody', () => {
    it('returns the preprocessed body content', async () => {
      const filePath = writeSkillFile('body-test', `---
name: body-test
description: Test body retrieval.
---

## Instructions

This is the skill body content.
Use $ARGUMENTS as input.`);

      registry.addSkill({ path: filePath, source: 'builtin' });

      const body = await registry.getSkillBody('body-test', {
        args: ['hello'],
        rawArgs: 'hello',
      });

      expect(body).toContain('This is the skill body content.');
      expect(body).toContain('Use hello as input.');
    });

    it('throws for unknown skill names', async () => {
      await expect(
        registry.getSkillBody('nonexistent', { args: [], rawArgs: '' }),
      ).rejects.toThrow('Skill not found');
    });

    it('applies consumer-provided variables', async () => {
      const filePath = writeSkillFile('var-test', `---
name: var-test
description: Variable test.
---
Agent name: \${AGENT_NAME}
User: \${USER_NAME}`);

      registry.addSkill({ path: filePath, source: 'builtin' });
      registry.setPreprocessorVariables({
        AGENT_NAME: 'Animus',
        USER_NAME: 'Craig',
      });

      const body = await registry.getSkillBody('var-test', {
        args: [],
        rawArgs: '',
      });

      expect(body).toContain('Agent name: Animus');
      expect(body).toContain('User: Craig');
    });
  });

  describe('constructor with initial configs', () => {
    it('accepts initial skill configs', () => {
      const fp = writeSkillFile('initial', `---
name: initial
description: Loaded at construction.
---
Body.`);

      const reg = new SkillRegistry([{ path: fp, source: 'builtin' }]);
      expect(reg.size).toBe(1);
    });
  });

  describe('clear', () => {
    it('removes all entries and resets state', () => {
      const fp = writeSkillFile('clearable', `---
name: clearable
description: Will be cleared.
---
Body.`);

      registry.addSkill({ path: fp, source: 'builtin' });
      registry.setPreprocessorVariables({ FOO: 'bar' });
      registry.setScriptContext({ key: 'value' });

      expect(registry.size).toBe(1);
      registry.clear();
      expect(registry.size).toBe(0);
    });
  });

  describe('getAll', () => {
    it('returns all registered entries', () => {
      const fp1 = writeSkillFile('skill-a', `---
name: skill-a
description: A
---
Body.`);
      const fp2 = writeSkillFile('skill-b', `---
name: skill-b
description: B
---
Body.`);

      registry.addSkill({ path: fp1, source: 'builtin' });
      registry.addSkill({ path: fp2, source: 'user' });

      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all.map(e => e.name).sort()).toEqual(['skill-a', 'skill-b']);
    });
  });
});
