# Grep Tool

Search file contents using regex. Built on ripgrep for performance.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `pattern` | string | Yes | Regex pattern to search for |
| `path` | string | No | File or directory to search in. Default: current working directory. |
| `glob` | string | No | Glob pattern to filter files (e.g., `*.ts`, `**/*.{js,jsx}`). Maps to `rg --glob`. |
| `type` | string | No | File type filter (e.g., `js`, `py`, `rust`). Maps to `rg --type`. More efficient than glob for standard file types. |
| `output_mode` | string | No | `files_with_matches` (default), `content`, or `count` |
| `context` | number | No | Lines of context before/after each match. Only in `content` mode. |
| `-i` | boolean | No | Case insensitive search. Default: false. Note: follows ripgrep's flag naming convention where `-i: true` means case INsensitive. |
| `head_limit` | number | No | Limit number of results. Default: 0 (unlimited). |
| `offset` | number | No | Skip first N results before applying head_limit. Enables pagination. |
| `multiline` | boolean | No | Enable multiline mode where `.` matches newlines. Default: false. |

## Returns

**`content`** (sent to the LLM):

Depends on `output_mode`:
- `files_with_matches` (default): Array of file paths containing matches. Most token-efficient.
- `content`: Matching lines with optional context. Includes file path, line number, and match content.
- `count`: Array of `{ file, count }` entries.

All modes respect `offset` and `head_limit` for pagination.

**`details`** (sent to UI/logs only):
- Total number of files with matches
- Total match count across all files
- Search duration in milliseconds
- Whether results were truncated by head_limit

## Implementation Notes

### Ripgrep Integration
- **Bundled dependency**: Ripgrep must be bundled with the cortex package, not relied upon being on the user's PATH. Platform-specific binaries should be vendored (arm64-darwin, x64-darwin, x64-linux, arm64-linux, x64-win32, arm64-win32), or a native Node addon can be used for in-process execution.
- Uses ripgrep regex syntax (similar to Rust regex). Literal braces need escaping as `\{` `\}`.
- Falls back to a Node.js-based regex search if ripgrep is unavailable (degraded performance on large codebases).
- Respects `.gitignore` by default.

### Token Economy
- Default output mode is `files_with_matches` (paths only). This is deliberately the most token-efficient option. The model should switch to `content` mode only when it needs the actual matching lines.
- The `offset` + `head_limit` pattern enables pagination through large result sets without loading everything into context.

### Ripgrep Distribution
The 6 platform-specific binaries (arm64-darwin, x64-darwin, x64-linux, arm64-linux, x64-win32, arm64-win32) are bundled as optional dependencies in the cortex npm package, one per platform. At install time, npm installs only the binary matching the current platform. At runtime, cortex resolves the binary path from the package's install location. This follows the same pattern Claude Code uses.

### Error Handling

| Condition | Behavior |
|-----------|----------|
| Invalid regex pattern | Return error in `content`: "Invalid regex: {pattern}. {ripgrep error message}" |
| Search path doesn't exist | Return error in `content`: "Path does not exist: {path}" |
| Permission denied on files | Skip those files silently (partial results). Note count in `details`. |
| Zero matches | Return empty array in `content`. Not an error. |
| Ripgrep binary not found | Fall back to Node.js regex search. Log a warning in `details`. |

### System Prompt Guidance
The system prompt should instruct:
- "Use Grep to search file contents. Do not use `grep` or `rg` via Bash."
- "Default to `files_with_matches` mode. Only use `content` mode when you need to see the matching lines."
- "Use the `type` parameter for standard file types (more efficient than glob patterns)."
