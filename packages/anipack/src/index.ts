/**
 * anipack — CLI tool for building, validating, signing, and inspecting .anpk packages.
 */

import { Command } from 'commander';
import { validateCommand } from './commands/validate.js';
import { buildCommand } from './commands/build.js';
import { signCommand } from './commands/sign.js';
import { inspectCommand } from './commands/inspect.js';
import { keygenCommand } from './commands/keygen.js';

const program = new Command();

program
  .name('anipack')
  .description('Build, validate, sign, and inspect .anpk packages for Animus')
  .version(__ANIPACK_VERSION__);

program
  .command('validate <directory>')
  .description('Validate a plugin or channel source directory')
  .action(async (directory: string) => {
    await validateCommand(directory);
  });

program
  .command('build <directory>')
  .description('Build an .anpk package from a source directory')
  .option('-o, --output <path>', 'Output file path')
  .option('--sign', 'Sign the package with Ed25519 key')
  .option('--key <path>', 'Path to Ed25519 private key file')
  .option('--signer <identity>', 'Signer identity (required when using --sign)')
  .option('--no-vendor', 'Skip vendoring node_modules')
  .option('--no-compile', 'Skip TypeScript compilation')
  .option('-v, --verbose', 'Show detailed build output')
  .action(async (directory: string, options: Record<string, unknown>) => {
    await buildCommand(directory, {
      output: options['output'] as string | undefined,
      sign: options['sign'] as boolean | undefined,
      key: options['key'] as string | undefined,
      signer: options['signer'] as string | undefined,
      noVendor: options['vendor'] === false,
      noCompile: options['compile'] === false,
      verbose: options['verbose'] as boolean | undefined,
    });
  });

program
  .command('sign <package>')
  .description('Sign an .anpk package with Ed25519')
  .requiredOption('--key <path>', 'Path to Ed25519 private key file')
  .requiredOption('--signer <identity>', 'Signer identity (e.g. your name or org)')
  .action(async (packagePath: string, options: Record<string, unknown>) => {
    await signCommand(
      packagePath,
      options['key'] as string,
      options['signer'] as string | undefined,
    );
  });

program
  .command('inspect <package>')
  .description('Inspect an .anpk package')
  .option('--json', 'Output as JSON')
  .option('--files', 'Show full file listing with sizes')
  .option('--manifest', 'Print the full manifest.json')
  .option('--verify-only', 'Only verify signature and checksums')
  .action(async (packagePath: string, options: Record<string, unknown>) => {
    await inspectCommand(packagePath, {
      json: options['json'] as boolean | undefined,
      files: options['files'] as boolean | undefined,
      manifest: options['manifest'] as boolean | undefined,
      verifyOnly: options['verifyOnly'] as boolean | undefined,
    });
  });

program
  .command('keygen')
  .description('Generate an Ed25519 keypair for package signing')
  .option('-o, --output <directory>', 'Output directory for key files')
  .option('--stdout', 'Output keys to stdout')
  .action(async (options: Record<string, unknown>) => {
    await keygenCommand({
      output: options['output'] as string | undefined,
      stdout: options['stdout'] as boolean | undefined,
    });
  });

program.parse();
