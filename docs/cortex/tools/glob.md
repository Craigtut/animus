# Glob Tool

Find files by name pattern matching.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `pattern` | string | Yes | Glob pattern to match (e.g., `**/*.ts`, `src/**/*.test.js`) |
| `path` | string | No | Directory to search in. Default: current working directory. |

## Returns

**`content`** (sent to the LLM):
- Array of matching file paths, sorted by modification time (most recent first)
- Truncated to 100 files maximum
- `truncated` flag indicating if more matches exist beyond the limit

**`details`** (sent to UI/logs only):
- Full match list (if different from content)
- Total match count (including beyond truncation)
- Search duration in milliseconds

## Implementation Notes

### Core Behavior
- Standard glob syntax: `*`, `**`, `?`, `[abc]`, `{a,b}`
- Results sorted by modification time (newest first). Recently modified files are more likely to be relevant to the current task.
- Hard limit of 100 files in `content`. If more matches exist, the `truncated` flag is true and the model should narrow the search with a more specific pattern.
- Respects `.gitignore` rules by default (skips `node_modules`, `.git`, build output, etc.)
- Returns absolute paths

### Cross-Platform
- Case sensitivity follows the filesystem: macOS and Windows are case-insensitive, Linux is case-sensitive. The same pattern may return different results on different platforms.
- Path separators are normalized in output (always forward slash regardless of platform).

### .gitignore Behavior
- If a `.gitignore` exists in the search path (or any parent), its rules are respected.
- If there is no `.gitignore` (not a git repo), common defaults are still applied: skip `node_modules`, `.git`, `dist`, `build`, `__pycache__`, `.DS_Store`, `.next`, `.nuxt`, `coverage`, `.cache`, `.parcel-cache`, `.vite`.
- Configurable via a flag to disable gitignore filtering if the consumer needs to search everything.

### Error Handling

| Condition | Behavior |
|-----------|----------|
| Invalid pattern | Return error in `content`: "Invalid glob pattern: {pattern}" |
| Search path doesn't exist | Return error in `content`: "Directory does not exist: {path}" |
| Permission denied on directory | Skip the directory silently (partial results are still useful). Note in `details`. |
| Zero matches | Return empty array in `content`. Not an error. |

### System Prompt Guidance
The system prompt should instruct: "Use Glob to find files by name pattern. Do not use `find` or `ls` via Bash for file discovery."
