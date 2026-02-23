/**
 * Logger — Chalk-based terminal output for anipack CLI.
 */

import chalk from 'chalk';

export function info(message: string): void {
  console.log(chalk.cyan('  ' + message));
}

export function success(message: string): void {
  console.log(chalk.green('  ' + message));
}

export function warn(message: string): void {
  console.log(chalk.yellow('  WARNING: ' + message));
}

export function error(message: string): void {
  console.error(chalk.red('  ERROR: ' + message));
}

export function heading(message: string): void {
  console.log(chalk.bold(message));
}

export function detail(label: string, value: string): void {
  console.log(chalk.gray('  ' + label.padEnd(16)) + value);
}

export function blank(): void {
  console.log();
}
