/**
 * TaskOutput tool: companion tool for polling backgrounded processes.
 *
 * Auto-registered alongside the Bash tool. Provides three actions:
 * - poll: get latest output and status
 * - send: send input to process stdin
 * - kill: send a signal to the process
 *
 * Reference: docs/cortex/tools/bash.md (Background Execution)
 */

import { Type, type Static } from '@sinclair/typebox';
import type { ToolContentDetails } from '../types.js';
import { getBackgroundTask } from './bash/index.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const TaskOutputParams = Type.Object({
  task_id: Type.String({ description: 'The task ID returned by a backgrounded Bash command' }),
  action: Type.Union([
    Type.Literal('poll'),
    Type.Literal('send'),
    Type.Literal('kill'),
  ], { description: 'Action to perform: poll (get output), send (send input), or kill (terminate)' }),
  input: Type.Optional(
    Type.String({ description: 'Input to send to the process stdin (only for "send" action)' }),
  ),
  signal: Type.Optional(
    Type.String({ description: 'Signal to send (only for "kill" action). Default: SIGTERM. Options: SIGINT, SIGTERM, SIGKILL' }),
  ),
});

export type TaskOutputParamsType = Static<typeof TaskOutputParams>;

// ---------------------------------------------------------------------------
// Details type
// ---------------------------------------------------------------------------

export interface TaskOutputDetails {
  taskId: string;
  action: string;
  status: 'running' | 'completed' | 'failed' | 'not_found';
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createTaskOutputTool(): {
  name: string;
  description: string;
  parameters: typeof TaskOutputParams;
  execute: (params: TaskOutputParamsType) => Promise<ToolContentDetails<TaskOutputDetails>>;
} {
  return {
    name: 'TaskOutput',
    description: 'Poll, send input to, or kill a backgrounded process.',
    parameters: TaskOutputParams,

    async execute(params: TaskOutputParamsType): Promise<ToolContentDetails<TaskOutputDetails>> {
      const { task_id: taskId, action } = params;

      const task = getBackgroundTask(taskId);
      if (!task) {
        return {
          content: [{ type: 'text', text: `Task not found: ${taskId}` }],
          details: {
            taskId,
            action,
            status: 'not_found',
            exitCode: null,
            stdout: '',
            stderr: '',
          },
        };
      }

      switch (action) {
        case 'poll': {
          const status = task.completed
            ? (task.exitCode === 0 ? 'completed' : 'failed')
            : 'running';

          let text = `Status: ${status}`;
          if (task.completed && task.exitCode !== null) {
            text += ` (exit code: ${task.exitCode})`;
          }
          if (task.stdout) {
            const output = task.stdout.length > 30000
              ? task.stdout.slice(-30000)
              : task.stdout;
            text += `\n\nOutput:\n${output}`;
          }
          if (task.stderr) {
            text += `\n\nStderr:\n${task.stderr}`;
          }

          return {
            content: [{ type: 'text', text }],
            details: {
              taskId,
              action,
              status: status as 'running' | 'completed' | 'failed',
              exitCode: task.exitCode,
              stdout: task.stdout,
              stderr: task.stderr,
            },
          };
        }

        case 'send': {
          if (task.completed) {
            return {
              content: [{ type: 'text', text: `Task ${taskId} has already completed. Cannot send input.` }],
              details: {
                taskId,
                action,
                status: task.exitCode === 0 ? 'completed' : 'failed',
                exitCode: task.exitCode,
                stdout: task.stdout,
                stderr: task.stderr,
              },
            };
          }

          const input = params.input ?? '';
          try {
            task.process.stdin?.write(input + '\n');
            return {
              content: [{ type: 'text', text: `Sent input to task ${taskId}.` }],
              details: {
                taskId,
                action,
                status: 'running',
                exitCode: null,
                stdout: task.stdout,
                stderr: task.stderr,
              },
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: 'text', text: `Failed to send input to task ${taskId}: ${msg}` }],
              details: {
                taskId,
                action,
                status: 'running',
                exitCode: null,
                stdout: task.stdout,
                stderr: task.stderr,
              },
            };
          }
        }

        case 'kill': {
          if (task.completed) {
            return {
              content: [{ type: 'text', text: `Task ${taskId} has already completed.` }],
              details: {
                taskId,
                action,
                status: task.exitCode === 0 ? 'completed' : 'failed',
                exitCode: task.exitCode,
                stdout: task.stdout,
                stderr: task.stderr,
              },
            };
          }

          const signal = (params.signal ?? 'SIGTERM') as NodeJS.Signals;
          try {
            task.process.kill(signal);
            return {
              content: [{ type: 'text', text: `Sent ${signal} to task ${taskId}.` }],
              details: {
                taskId,
                action,
                status: 'running',
                exitCode: null,
                stdout: task.stdout,
                stderr: task.stderr,
              },
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: 'text', text: `Failed to kill task ${taskId}: ${msg}` }],
              details: {
                taskId,
                action,
                status: 'running',
                exitCode: null,
                stdout: task.stdout,
                stderr: task.stderr,
              },
            };
          }
        }

        default:
          return {
            content: [{ type: 'text', text: `Unknown action: ${action}` }],
            details: {
              taskId,
              action,
              status: 'not_found',
              exitCode: null,
              stdout: '',
              stderr: '',
            },
          };
      }
    },
  };
}
