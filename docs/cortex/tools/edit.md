# Edit Tool

Make precise string replacements in existing files.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `file_path` | string | Yes | Absolute path to the file to edit |
| `old_string` | string | Yes | The exact text to find and replace |
| `new_string` | string | Yes | The replacement text (must differ from old_string) |
| `replace_all` | boolean | No | Replace all occurrences. Default: false (replace first unique match). |

## Returns

**`content`** (sent to the LLM):
- Confirmation: number of replacements made
- File path

**`details`** (sent to UI/logs only):
- Full file path
- The old and new strings
- Structured diff (array of hunks for UI rendering)
- Original file content before edit
- Whether `replace_all` was used

## Implementation Notes

### Uniqueness Constraint
When `replace_all` is false, `old_string` must appear exactly once in the file. If it matches multiple locations, the tool returns an error asking the model to provide more surrounding context to make the match unique. This is a deliberate safety mechanism that forces the model to be precise about where it's editing.

### Read-Before-Edit Contract
The file must have been Read in the current session before it can be edited. The tool fails if the file hasn't been Read first. This ensures the model has seen the current state of the file.

### Matching
- Exact string matching, NOT regex
- Whitespace-sensitive: indentation must match exactly
- Multi-line replacements supported (both `old_string` and `new_string` can span multiple lines)
- The model should use the line number prefixes from Read output to understand indentation but never include the line number prefix itself in `old_string` or `new_string`
- **Line ending normalization**: The tool should normalize `\r\n` to `\n` before matching to prevent Windows line endings from causing mysterious match failures. Output preserves the file's original line ending style.

### Error Handling

| Condition | Behavior |
|-----------|----------|
| File not found | Return error in `content`: "File does not exist: {path}" |
| Permission denied | Return error in `content`: "Permission denied: {path}" |
| `old_string` not found | Return error in `content`: "The specified text was not found in the file." |
| `old_string` matches multiple locations | Return error in `content`: "Found {N} matches. Provide more surrounding context to uniquely identify the edit location." |
| `old_string` equals `new_string` | Return error in `content`: "old_string and new_string are identical. No change needed." |
| Read-before-edit violation | Return error in `content`: "You must Read this file before editing it." |

### System Prompt Guidance
The system prompt should instruct:
- Always prefer Edit over Write for modifying existing files
- When an edit fails due to non-unique match, provide more surrounding context lines to disambiguate
- Do not use `sed` or `awk` via Bash for file editing
- Preserve exact indentation (tabs/spaces) as shown in Read output
