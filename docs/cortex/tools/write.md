# Write Tool

Create a new file or overwrite an existing file.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `file_path` | string | Yes | Absolute path to the file to write (must be absolute, not relative) |
| `content` | string | Yes | The full content to write to the file |

## Returns

**`content`** (sent to the LLM):
- Confirmation message: whether the file was created or updated
- File path and byte count

**`details`** (sent to UI/logs only):
- Full file path
- Whether this was a create or update
- Bytes written
- Structured diff (array of hunks with `oldStart`, `oldLines`, `newStart`, `newLines`, `lines[]`) for updates
- Original file content before write (null for new files)

## Implementation Notes

### Core Behavior
- Complete file overwrite, no merge/append capability
- Creates parent directories if they don't exist
- Writes atomically (write to temp file, then rename) to prevent partial writes on crash

### Read-Before-Write Contract
If the file already exists, the model must have Read it in the current session before writing. The tool fails if an existing file hasn't been Read first. This prevents blind overwrites.

### Structured Diffs
For updates (not creates), the tool computes a structured patch internally. This is returned in `details` for the UI to render a rich diff view. The model does not need to see the diff in its context since it authored the content.

### Cross-Platform
- Accepts both forward slash and backslash paths. Normalizes internally.
- Line endings: Write outputs content as-is. If the consumer or model provides `\n`, that's what gets written. The model is responsible for matching the file's existing line ending convention (visible from Read output).
- Atomic write on Windows: `rename` over an existing file may fail if the target is open. Fall back to direct write if rename fails.

### Path Validation
Write does not enforce path restrictions itself. Path validation (restricting writes to the working directory) is handled by the permission gate's `beforeToolCall` hook. The consumer configures which paths are allowed.

### Error Handling

| Condition | Behavior |
|-----------|----------|
| Permission denied | Return error in `content`: "Permission denied: {path}" |
| Disk full | Return error in `content`: "Disk full. Cannot write to: {path}" |
| Path too long | Return error in `content`: "Path exceeds system limit: {path}" |
| Parent directory creation fails | Return error in `content`: "Cannot create directory: {parentPath}" |
| Read-before-write violation | Return error in `content`: "You must Read this file before overwriting it." |

### System Prompt Guidance
The system prompt should steer the model toward Edit for modifying existing files: "Prefer the Edit tool for modifying existing files. Only use Write for new files or complete rewrites." This prevents the model from doing full file rewrites when a targeted edit would be safer and more token-efficient.
