/** @jsxImportSource @emotion/react */
import { CodeBlock, DetailField, shortenPath, truncate } from './shared';

// ============================================================================
// Tool call summaries -- smart previews per tool type
// ============================================================================

export function getToolCallSummary(toolName: string, input: Record<string, unknown> | undefined): string {
  if (!input) return '';

  const s = (key: string) => typeof input[key] === 'string' ? input[key] as string : '';
  const name = toolName.toLowerCase().replace(/^mcp__\w+__/, '');

  switch (name) {
    case 'bash': {
      const cmd = s('command');
      return cmd ? truncate(cmd, 80) : '';
    }
    case 'read': {
      const fp = s('file_path');
      const offset = input['offset'] as number | undefined;
      const limit = input['limit'] as number | undefined;
      const range = offset != null || limit != null
        ? ` [${offset ?? 1}:${limit ? `+${limit}` : ''}]`
        : '';
      return fp ? `${shortenPath(fp)}${range}` : '';
    }
    case 'write': {
      const fp = s('file_path');
      const content = s('content');
      const lines = content ? content.split('\n').length : 0;
      return fp ? `${shortenPath(fp)}${lines > 0 ? ` (${lines} lines)` : ''}` : '';
    }
    case 'edit': {
      const fp = s('file_path');
      const old = s('old_string');
      const replaceAll = input['replace_all'];
      const parts = [shortenPath(fp)];
      if (replaceAll) parts.push('(all)');
      if (old) parts.push(`"${truncate(old.split('\n')[0]!, 40)}"`);
      return fp ? parts.join(' ') : '';
    }
    case 'glob': {
      const pattern = s('pattern');
      const path = s('path');
      return pattern
        ? `${pattern}${path ? ` in ${shortenPath(path)}` : ''}`
        : '';
    }
    case 'grep': {
      const pattern = s('pattern');
      const path = s('path');
      const glob = s('glob');
      const parts = [pattern ? `/${pattern}/` : ''];
      if (glob) parts.push(`(${glob})`);
      if (path) parts.push(`in ${shortenPath(path)}`);
      return parts.filter(Boolean).join(' ');
    }
    case 'webfetch': {
      const url = s('url');
      try {
        const u = new URL(url);
        return `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`;
      } catch {
        return url ? truncate(url, 60) : '';
      }
    }
    case 'websearch': {
      return s('query') ? `"${truncate(s('query'), 60)}"` : '';
    }
    case 'task': {
      const desc = s('description');
      const agent = s('subagent_type');
      return [agent, desc].filter(Boolean).join(': ') || '';
    }
    default: {
      const keys = Object.keys(input);
      for (const key of keys) {
        const val = input[key];
        if (typeof val === 'string' && val.length > 0) {
          return `${key}: ${truncate(val, 50)}`;
        }
      }
      return keys.length > 0 ? `${keys.length} param${keys.length > 1 ? 's' : ''}` : '';
    }
  }
}

export function getToolOutputSummary(toolName: string, output: unknown): string {
  if (output == null) return '';
  const name = toolName.toLowerCase().replace(/^mcp__\w+__/, '');
  const outputStr = typeof output === 'string' ? output : '';

  switch (name) {
    case 'bash': {
      if (!outputStr) return '';
      const firstLine = outputStr.split('\n')[0]!;
      return truncate(firstLine, 60);
    }
    case 'grep': {
      if (!outputStr) return '';
      const lines = outputStr.trim().split('\n').filter(Boolean);
      return `${lines.length} match${lines.length !== 1 ? 'es' : ''}`;
    }
    case 'glob': {
      if (!outputStr) return 'no matches';
      const lines = outputStr.trim().split('\n').filter(Boolean);
      return `${lines.length} file${lines.length !== 1 ? 's' : ''}`;
    }
    default:
      return '';
  }
}

// ============================================================================
// Tool Input Detail -- structured display per tool type
// ============================================================================

export function ToolInputDetail({ toolName, input }: { toolName: string; input: Record<string, unknown> }) {
  const name = toolName.toLowerCase().replace(/^mcp__\w+__/, '');
  const s = (key: string) => typeof input[key] === 'string' ? input[key] as string : '';

  switch (name) {
    case 'bash': {
      const cmd = s('command');
      const desc = s('description');
      return (
        <div>
          {desc && <DetailField label="DESCRIPTION">{desc}</DetailField>}
          {cmd && (
            <DetailField label="COMMAND">
              <CodeBlock content={cmd} maxHeight={200} />
            </DetailField>
          )}
        </div>
      );
    }
    case 'read': {
      const fp = s('file_path');
      const offset = input['offset'] as number | undefined;
      const limit = input['limit'] as number | undefined;
      return (
        <div>
          <DetailField label="FILE" mono>{fp}</DetailField>
          {(offset != null || limit != null) && (
            <DetailField label="RANGE" mono>
              {offset != null ? `offset: ${offset}` : ''}
              {offset != null && limit != null ? ', ' : ''}
              {limit != null ? `limit: ${limit}` : ''}
            </DetailField>
          )}
        </div>
      );
    }
    case 'write': {
      const fp = s('file_path');
      const content = s('content');
      return (
        <div>
          <DetailField label="FILE" mono>{fp}</DetailField>
          {content && (
            <DetailField label="CONTENT">
              <CodeBlock content={content} maxHeight={300} />
            </DetailField>
          )}
        </div>
      );
    }
    case 'edit': {
      const fp = s('file_path');
      const old = s('old_string');
      const newStr = s('new_string');
      const replaceAll = Boolean(input['replace_all']);
      return (
        <div>
          <DetailField label="FILE" mono>{fp}</DetailField>
          {replaceAll && <DetailField label="MODE">Replace all occurrences</DetailField>}
          {old && (
            <DetailField label="FIND">
              <CodeBlock content={old} maxHeight={150} />
            </DetailField>
          )}
          {newStr && (
            <DetailField label="REPLACE">
              <CodeBlock content={newStr} maxHeight={150} />
            </DetailField>
          )}
        </div>
      );
    }
    case 'grep': {
      const pattern = s('pattern');
      const path = s('path');
      const glob = s('glob');
      const type = s('type');
      const mode = s('output_mode');
      return (
        <div>
          <DetailField label="PATTERN" mono>{pattern}</DetailField>
          {path && <DetailField label="PATH" mono>{path}</DetailField>}
          {glob && <DetailField label="GLOB" mono>{glob}</DetailField>}
          {type && <DetailField label="TYPE">{type}</DetailField>}
          {mode && <DetailField label="MODE">{mode}</DetailField>}
        </div>
      );
    }
    case 'glob': {
      const pattern = s('pattern');
      const path = s('path');
      return (
        <div>
          <DetailField label="PATTERN" mono>{pattern}</DetailField>
          {path && <DetailField label="PATH" mono>{path}</DetailField>}
        </div>
      );
    }
    case 'webfetch': {
      const url = s('url');
      const prompt = s('prompt');
      return (
        <div>
          <DetailField label="URL" mono>{url}</DetailField>
          {prompt && <DetailField label="PROMPT">{prompt}</DetailField>}
        </div>
      );
    }
    case 'websearch': {
      const query = s('query');
      return (
        <div>
          <DetailField label="QUERY">{query}</DetailField>
        </div>
      );
    }
    case 'task': {
      const desc = s('description');
      const prompt = s('prompt');
      const agent = s('subagent_type');
      return (
        <div>
          {agent && <DetailField label="AGENT TYPE">{agent}</DetailField>}
          {desc && <DetailField label="DESCRIPTION">{desc}</DetailField>}
          {prompt && (
            <DetailField label="PROMPT">
              <CodeBlock content={prompt} maxHeight={300} />
            </DetailField>
          )}
        </div>
      );
    }
    default:
      return (
        <DetailField label="INPUT">
          <CodeBlock content={JSON.stringify(input, null, 2)} maxHeight={300} />
        </DetailField>
      );
  }
}
