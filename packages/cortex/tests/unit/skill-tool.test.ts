import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SkillRegistry } from '../../src/skill-registry.js';
import { createLoadSkillTool, buildLoadSkillDescription } from '../../src/skill-tool.js';
import type { LoadedSkill } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-tool-test-'));
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

function createToolConfig(registry: SkillRegistry): {
  tool: ReturnType<typeof createLoadSkillTool>;
  skillBuffer: LoadedSkill[];
} {
  const skillBuffer: LoadedSkill[] = [];

  const tool = createLoadSkillTool({
    registry,
    getSkillBuffer: () => skillBuffer,
    pushToSkillBuffer: (skill: LoadedSkill) => {
      const existingIdx = skillBuffer.findIndex(s => s.name === skill.name);
      if (existingIdx >= 0) {
        skillBuffer[existingIdx] = skill;
      } else {
        skillBuffer.push(skill);
      }
    },
  });

  return { tool, skillBuffer };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createLoadSkillTool', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  describe('tool metadata', () => {
    it('has the correct name', () => {
      const { tool } = createToolConfig(registry);
      expect(tool.name).toBe('load_skill');
    });

    it('includes available skills summary in description', () => {
      const fp = writeSkillFile('test-skill', `---
name: test-skill
description: A test skill.
---
Body.`);
      registry.addSkill({ path: fp, source: 'builtin' });

      const { tool } = createToolConfig(registry);
      expect(tool.description).toContain('test-skill');
      expect(tool.description).toContain('A test skill.');
    });
  });

  describe('execute', () => {
    it('loads a skill and pushes to the buffer', async () => {
      const fp = writeSkillFile('loadable', `---
name: loadable
description: Can be loaded.
---

## Instructions
Do the thing.`);

      registry.addSkill({ path: fp, source: 'builtin' });
      const { tool, skillBuffer } = createToolConfig(registry);

      const result = await tool.execute({ name: 'loadable' });

      expect(result).toContain('Skill "loadable" loaded');
      expect(skillBuffer).toHaveLength(1);
      expect(skillBuffer[0]!.name).toBe('loadable');
      expect(skillBuffer[0]!.content).toContain('Do the thing.');
    });

    it('returns error for unknown skill', async () => {
      const { tool } = createToolConfig(registry);

      const result = await tool.execute({ name: 'nonexistent' });
      expect(result).toContain('Unknown skill: "nonexistent"');
    });

    it('returns error for non-model-invocable skill', async () => {
      const fp = writeSkillFile('hidden', `---
name: hidden
description: Not for agents.
disable-model-invocation: true
---
Body.`);

      registry.addSkill({ path: fp, source: 'builtin' });
      const { tool } = createToolConfig(registry);

      const result = await tool.execute({ name: 'hidden' });
      expect(result).toContain('not available for direct loading');
    });

    it('deduplicates skills in the buffer (replaces on reload)', async () => {
      const fp = writeSkillFile('reloadable', `---
name: reloadable
description: Can be reloaded.
---
Version 1.`);

      registry.addSkill({ path: fp, source: 'builtin' });
      const { tool, skillBuffer } = createToolConfig(registry);

      await tool.execute({ name: 'reloadable' });
      expect(skillBuffer).toHaveLength(1);

      // Reload the same skill
      await tool.execute({ name: 'reloadable' });
      expect(skillBuffer).toHaveLength(1); // Still 1 (replaced, not duplicated)
    });

    it('passes arguments to the preprocessor', async () => {
      const fp = writeSkillFile('args-skill', `---
name: args-skill
description: Takes arguments.
---
Topic: $ARGUMENTS
First: $1`);

      registry.addSkill({ path: fp, source: 'builtin' });
      const { tool, skillBuffer } = createToolConfig(registry);

      await tool.execute({ name: 'args-skill', arguments: 'typescript generics' });

      expect(skillBuffer[0]!.content).toContain('Topic: typescript generics');
      expect(skillBuffer[0]!.content).toContain('First: typescript');
    });
  });
});

describe('buildLoadSkillDescription', () => {
  it('produces description with available skills summary', () => {
    const registry = new SkillRegistry();
    const fp = writeSkillFile('desc-skill', `---
name: desc-skill
description: For description testing.
---
Body.`);
    registry.addSkill({ path: fp, source: 'builtin' });

    const description = buildLoadSkillDescription(registry);
    expect(description).toContain('desc-skill');
    expect(description).toContain('For description testing.');
    expect(description).toContain('available-skills');
  });
});
