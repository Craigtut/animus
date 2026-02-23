/**
 * Validate Command — Validates a plugin or channel source directory.
 *
 * Checks manifest schema, component paths, icon, configSchema.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as logger from '../utils/logger.js';
import { loadSourceManifest, fileExists } from '../utils/manifest.js';

export interface ValidateResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export async function validateCommand(sourceDir: string): Promise<void> {
  const absoluteDir = path.resolve(sourceDir);
  logger.heading(`Validating ${sourceDir}...`);
  logger.blank();

  const result = await validate(absoluteDir);

  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      logger.warn(w);
    }
    logger.blank();
  }

  if (result.valid) {
    logger.success('Validation passed.');
  } else {
    for (const e of result.errors) {
      logger.error(e);
    }
    logger.blank();
    logger.error('Validation failed.');
    process.exit(1);
  }
}

export async function validate(absoluteDir: string): Promise<ValidateResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check directory exists
  try {
    const stat = await fs.stat(absoluteDir);
    if (!stat.isDirectory()) {
      return { valid: false, errors: [`Not a directory: ${absoluteDir}`], warnings };
    }
  } catch {
    return { valid: false, errors: [`Directory not found: ${absoluteDir}`], warnings };
  }

  // Load and parse manifest
  let loaded;
  try {
    loaded = await loadSourceManifest(absoluteDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { valid: false, errors: [msg], warnings };
  }

  const { type, parsed, raw } = loaded;
  logger.detail('Manifest:', `${type}.json found`);
  logger.detail('Package type:', type);
  logger.detail('Name:', parsed.name);
  logger.detail('Version:', parsed.version);

  // Check icon — icon is required on channels and optional on plugins
  const iconField = parsed.icon;
  if (iconField) {
    const iconPath = path.join(absoluteDir, iconField);
    if (await fileExists(iconPath)) {
      const ext = path.extname(iconField).toLowerCase();
      if (ext !== '.svg' && ext !== '.png') {
        errors.push(`Icon must be SVG or PNG, got: ${ext}`);
      } else {
        logger.detail('Icon:', `${iconField} (${ext.slice(1).toUpperCase()}, valid)`);
      }
    } else {
      errors.push(`Icon file not found: ${iconField}`);
    }
  }

  // Check configSchema — access from raw since it's not on all schema types
  const configSchemaField = raw['configSchema'] as string | undefined;
  if (configSchemaField) {
    const configPath = path.join(absoluteDir, configSchemaField);
    if (await fileExists(configPath)) {
      try {
        const content = await fs.readFile(configPath, 'utf-8');
        JSON.parse(content);
        logger.detail('Config:', configSchemaField);
      } catch {
        errors.push(`Config schema is not valid JSON: ${configSchemaField}`);
      }
    } else {
      errors.push(`Config schema file not found: ${configSchemaField}`);
    }
  } else {
    logger.detail('Config:', 'no config schema');
  }

  // Plugin-specific checks
  if (type === 'plugin' && 'components' in parsed) {
    const components = parsed.components;
    logger.detail('Components:', '');
    const componentTypes = ['skills', 'tools', 'context', 'hooks', 'decisions', 'triggers', 'agents'] as const;

    for (const compType of componentTypes) {
      const compPath = components[compType];
      if (compPath) {
        const fullPath = path.join(absoluteDir, compPath);
        if (!(await fileExists(fullPath))) {
          errors.push(`Component path not found: ${compType} -> ${compPath}`);
        } else {
          logger.detail(`  ${compType}:`, compPath);
        }
      } else {
        logger.detail(`  ${compType}:`, 'none');
      }
    }
  }

  // Channel-specific checks
  if (type === 'channel' && 'adapter' in parsed) {
    const adapterPath = path.join(absoluteDir, parsed.adapter);
    if (!(await fileExists(adapterPath))) {
      // Check for .ts variant
      const tsPath = adapterPath.replace(/\.js$/, '.ts');
      if (!(await fileExists(tsPath))) {
        errors.push(`Adapter file not found: ${parsed.adapter}`);
      }
    } else {
      logger.detail('Adapter:', parsed.adapter);
    }
  }

  // Permissions summary
  if (parsed.permissions) {
    const perms = parsed.permissions;
    const parts: string[] = [];
    if ('tools' in perms && Array.isArray(perms.tools) && perms.tools.length > 0) {
      parts.push(`tools: [${perms.tools.join(', ')}]`);
    }
    const network = 'network' in perms ? perms.network : undefined;
    if (network === true) {
      parts.push('network: unrestricted');
    } else if (Array.isArray(network) && network.length > 0) {
      parts.push(`network: [${network.join(', ')}]`);
    } else {
      parts.push('network: none');
    }
    const filesystem = 'filesystem' in perms ? perms.filesystem : 'none';
    parts.push(`fs: ${String(filesystem)}`);
    logger.detail('Permissions:', parts.join(', '));
  }

  logger.blank();

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
