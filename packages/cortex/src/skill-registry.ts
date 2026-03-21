/**
 * SkillRegistry: manages all known skills for the Cortex agent.
 *
 * Config-driven: the consumer provides paths to SKILL.md files from any
 * source (plugins, user directories, built-ins). The registry does not
 * scan directories.
 *
 * Skills are parsed at registration time (frontmatter extracted, body
 * deferred to load time). The registry produces a compact summary for
 * the load_skill tool description.
 *
 * References:
 *   - docs/cortex/skill-system.md
 *   - docs/cortex/plans/phase-4-sub-agents-and-skills.md
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SkillConfig, SkillEntry } from './types.js';
import { preprocessSkillBody } from './skill-preprocessor.js';

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Expects --- delimited frontmatter at the start of the file.
 *
 * This is a lightweight parser that handles the common SKILL.md patterns
 * without requiring a full YAML library. It handles:
 * - Simple key: value pairs
 * - Multi-line strings (using > or |)
 * - Nested metadata maps
 * - Space-delimited lists (for allowed-tools)
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: content };
  }

  const endIdx = trimmed.indexOf('\n---', 3);
  if (endIdx < 0) {
    return { frontmatter: {}, body: content };
  }

  const yamlBlock = trimmed.substring(3, endIdx).trim();
  const body = trimmed.substring(endIdx + 4).trimStart();

  const frontmatter: Record<string, unknown> = {};
  const lines = yamlBlock.split('\n');
  let currentKey = '';
  let multilineValue = '';
  let inMultiline = false;
  let multilineType: '>' | '|' | '' = '';
  let inMetadata = false;
  const metadataMap: Record<string, string> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Handle metadata block (indented key-value pairs)
    if (inMetadata) {
      const metaMatch = line.match(/^  (\w[\w-]*)\s*:\s*(.*)$/);
      if (metaMatch) {
        metadataMap[metaMatch[1]!] = metaMatch[2]!.trim();
        continue;
      }
      // End of metadata block
      frontmatter['metadata'] = { ...metadataMap };
      inMetadata = false;
    }

    // Handle multi-line folded/literal values
    if (inMultiline) {
      if (line.startsWith('  ') || line.trim() === '') {
        if (multilineType === '>') {
          multilineValue += (multilineValue ? ' ' : '') + line.trim();
        } else {
          multilineValue += (multilineValue ? '\n' : '') + line.trimStart();
        }
        continue;
      }
      // End of multi-line
      frontmatter[currentKey] = multilineValue.trim();
      inMultiline = false;
      multilineValue = '';
    }

    // Parse key: value
    const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1]!;
      const rawValue = kvMatch[2]!.trim();

      if (rawValue === '>' || rawValue === '|') {
        currentKey = key;
        multilineType = rawValue as '>' | '|';
        multilineValue = '';
        inMultiline = true;
        continue;
      }

      if (key === 'metadata' && rawValue === '') {
        inMetadata = true;
        continue;
      }

      // Parse boolean values
      if (rawValue === 'true') {
        frontmatter[key] = true;
      } else if (rawValue === 'false') {
        frontmatter[key] = false;
      } else {
        frontmatter[key] = rawValue;
      }
    }
  }

  // Flush any remaining multi-line or metadata
  if (inMultiline && currentKey) {
    frontmatter[currentKey] = multilineValue.trim();
  }
  if (inMetadata && Object.keys(metadataMap).length > 0) {
    frontmatter['metadata'] = { ...metadataMap };
  }

  return { frontmatter, body };
}

// ---------------------------------------------------------------------------
// SkillRegistry
// ---------------------------------------------------------------------------

export class SkillRegistry {
  private readonly entries = new Map<string, SkillEntry>();

  /** Consumer-provided variables for ${VAR} substitution. */
  private preprocessorVariables: Record<string, string> = {};

  /** Consumer-provided context for !{script:} executions. */
  private scriptContext: Record<string, unknown> = {};

  /**
   * Callback fired when skills are added or removed.
   * CortexAgent sets this to rebuild the load_skill tool description.
   */
  onChange: (() => void) | null = null;

  constructor(configs?: SkillConfig[]) {
    if (configs) {
      for (const config of configs) {
        this.addSkill(config);
      }
    }
  }

  /**
   * Add a skill from a SKILL.md file path.
   * Reads and parses the frontmatter synchronously at registration time.
   *
   * If a skill with the same name already exists, the new one replaces it
   * (last-registered wins).
   */
  addSkill(config: SkillConfig): void {
    let content: string;
    try {
      content = fs.readFileSync(config.path, 'utf8');
    } catch (err) {
      // Skill file not readable; skip silently
      return;
    }

    const { frontmatter } = parseFrontmatter(content);

    const name = typeof frontmatter['name'] === 'string'
      ? frontmatter['name']
      : path.basename(path.dirname(config.path));

    const description = typeof frontmatter['description'] === 'string'
      ? frontmatter['description']
      : '';

    const disableModelInvocation = frontmatter['disable-model-invocation'] === true;

    const entry: SkillEntry = {
      name,
      description,
      path: config.path,
      dir: path.dirname(config.path),
      source: config.source,
      frontmatter,
      modelInvocable: !disableModelInvocation,
    };
    if (config.variables) {
      entry.variables = config.variables;
    }

    this.entries.set(name, entry);
    this.onChange?.();
  }

  /**
   * Remove a skill by name.
   */
  removeSkill(name: string): void {
    const existed = this.entries.delete(name);
    if (existed) {
      this.onChange?.();
    }
  }

  /**
   * Get a skill entry by name.
   */
  getEntry(name: string): SkillEntry | null {
    return this.entries.get(name) ?? null;
  }

  /**
   * Get all registered skill entries.
   */
  getAll(): SkillEntry[] {
    return [...this.entries.values()];
  }

  /**
   * Get the number of registered skills.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Generate the available skills summary for the load_skill tool description.
   *
   * Skills with disable-model-invocation: true (modelInvocable: false) are
   * excluded from the summary. The agent cannot see or auto-load them.
   *
   * Format: XML listing with name, source, and description per skill.
   * Each skill consumes approximately 100 tokens.
   */
  getAvailableSkillsSummary(maxTokens = Number.POSITIVE_INFINITY): string {
    const invocableSkills = [...this.entries.values()]
      .filter(e => e.modelInvocable)
      .sort((a, b) => {
        // Priority: builtin > user > plugin
        const priority = (s: string): number => {
          if (s === 'builtin') return 0;
          if (s === 'user') return 1;
          return 2; // plugin:*
        };
        const pa = priority(a.source);
        const pb = priority(b.source);
        if (pa !== pb) return pa - pb;
        return a.name.localeCompare(b.name);
      });

    if (invocableSkills.length === 0) {
      return '<available-skills>\n(No skills available)\n</available-skills>';
    }

    let usedTokens = 0;
    const visibleSkills: SkillEntry[] = [];

    for (const entry of invocableSkills) {
      const approxTokens = Math.max(
        32,
        Math.ceil((entry.name.length + entry.description.trim().length) / 4),
      );

      if (visibleSkills.length > 0 && usedTokens + approxTokens > maxTokens) {
        continue;
      }

      visibleSkills.push(entry);
      usedTokens += approxTokens;
    }

    const skillXml = visibleSkills.map(e => {
      const desc = e.description.trim();
      return `<skill name="${e.name}" source="${e.source}">\n${desc}\n</skill>`;
    }).join('\n');

    return `<available-skills>\n${skillXml}\n</available-skills>`;
  }

  /**
   * Read and preprocess a skill's full body content.
   * Runs variable substitution, shell commands, and scripts.
   *
   * @param name - The skill name
   * @param callArgs - Arguments from the load_skill tool call
   * @returns The preprocessed skill body
   * @throws Error if the skill is not found
   */
  async getSkillBody(
    name: string,
    callArgs: { args: string[]; rawArgs: string },
  ): Promise<string> {
    const entry = this.entries.get(name);
    if (!entry) {
      throw new Error(`Skill not found: "${name}"`);
    }

    // Read the file and extract the body (below frontmatter)
    let content: string;
    try {
      content = fs.readFileSync(entry.path, 'utf8');
    } catch (err) {
      throw new Error(`Cannot read skill file: ${entry.path}`);
    }

    const { body } = parseFrontmatter(content);

    // Build merged variables (consumer + built-ins, consumer wins on collision)
    const variables: Record<string, string> = {
      SKILL_DIR: entry.dir,
      ARGUMENTS: callArgs.rawArgs,
    };
    // Add positional args
    for (let i = 0; i < 9; i++) {
      variables[String(i + 1)] = callArgs.args[i] ?? '';
    }
    // Merge per-skill variables (e.g., PLUGIN_ROOT for plugin skills)
    if (entry.variables) {
      Object.assign(variables, entry.variables);
    }
    // Merge consumer variables (consumer wins on collision)
    Object.assign(variables, this.preprocessorVariables);

    // Build merged script context (consumer first, Cortex built-ins last so
    // they cannot be overridden — skillDir, args, rawArgs are Cortex-owned)
    const mergedScriptContext: Record<string, unknown> = {
      ...this.scriptContext,
      skillDir: entry.dir,
      args: callArgs.args,
      rawArgs: callArgs.rawArgs,
      scriptArgs: {},
    };

    // Run preprocessor
    return preprocessSkillBody(body, {
      variables,
      scriptContext: mergedScriptContext,
      skillDir: entry.dir,
    });
  }

  /**
   * Set consumer-provided variables for ${VAR} substitution.
   * Called each tick during GATHER to update runtime values.
   */
  setPreprocessorVariables(variables: Record<string, string>): void {
    this.preprocessorVariables = variables;
  }

  /**
   * Set consumer-provided context for !{script:} executions.
   * Called each tick during GATHER to update runtime values.
   */
  setScriptContext(context: Record<string, unknown>): void {
    this.scriptContext = context;
  }

  /**
   * Clear all entries. Called during destroy.
   */
  clear(): void {
    this.entries.clear();
    this.preprocessorVariables = {};
    this.scriptContext = {};
  }
}

// Export parseFrontmatter for testing
export { parseFrontmatter };
