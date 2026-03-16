# Bash Tool

Execute shell commands in the host environment. Cross-platform: bash/zsh on macOS and Linux, PowerShell on Windows.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `command` | string | Yes | The shell command to execute |
| `timeout` | number | No | Timeout in milliseconds. Default: 120000 (2 min). Max: 600000 (10 min). |
| `description` | string | No | Human-readable explanation of the command. Shown in permission UI and used for auto-approval pattern matching. |
| `background` | boolean | No | Run the command in the background immediately. Default: false. |

## Returns

**`content`** (sent to the LLM):
- Truncated stdout (max ~30,000 characters). For larger outputs, a truncation notice tells the model it can use Read or Grep to inspect specific parts.
- stderr if non-empty
- Exit code and timeout/interrupt status
- For backgrounded commands: a task ID for polling via the TaskOutput tool

**`details`** (sent to UI/logs only):
- Full stdout and stderr (untruncated)
- Exit code
- Duration
- Whether the command was interrupted/timed out/backgrounded
- Final working directory

## Shell Selection

### Platform-Native Shells

Each platform uses its native shell. No external dependencies required.

**macOS:**
1. Read `$SHELL` from environment
2. Validate against `/etc/shells` (reject untrusted shells)
3. If `$SHELL` is `fish`, prefer `bash` or `sh` from PATH (fish rejects common bashisms)
4. Fallback: `/bin/bash`, then `/bin/sh`
5. Args: `["-c"]`

**Linux:**
1. Same as macOS: `$SHELL` -> validate against `/etc/shells` -> fallback chain
2. Fallback: `/bin/bash`, then `/bin/sh`
3. Args: `["-c"]`

**Windows:**
1. Discover PowerShell 7 (`pwsh.exe`): check `Program Files\PowerShell\7\pwsh.exe`, then `ProgramW6432`, then `pwsh` on PATH
2. Fallback to Windows PowerShell 5.1: `System32\WindowsPowerShell\v1.0\powershell.exe`
3. PowerShell 7 is preferred because PS 5.1 lacks `&&` operator support
4. Args: `["-NoProfile", "-NonInteractive", "-Command"]`

**User override:** A `shellPath` setting allows users to specify a custom shell binary for edge cases (Git Bash, WSL, specific zsh version, etc.).

### Shell Trust Validation (Unix)

On macOS/Linux, the `$SHELL` value is validated against `/etc/shells`. If the shell is not in that file (or the file doesn't exist), fall back to `/bin/sh`. This prevents a compromised `$SHELL` env var from redirecting execution to a malicious binary.

## Execution Model

### Working Directory Tracking

The tool tracks the working directory across calls within a single agentic loop.

**Mechanism:** After each command, the tool appends a directory capture suffix:
- Unix: `; echo "___CWD___"; pwd`
- PowerShell: `; Write-Host "___CWD___"; Get-Location`

The tool parses the marker from stdout, extracts the final working directory, and stores it. The next bash call uses this as the `cwd` option for `child_process.spawn`. The marker and directory output are stripped from the content returned to the model.

**Default directory:** The configured workspace directory (in Animus: `data/workspace/`). This is where the agent starts on first use.

**Session boundary:** Working directory resets to the default when a new agentic loop starts (new tick). It persists across multiple bash calls within the same loop.

**Shell state:** Each call spawns a new shell process. Shell state (env vars, aliases, functions) does NOT persist between calls. Only the working directory persists via the tracking mechanism.

### Background Execution

Long-running commands should not block the agent. Pi-agent-core executes tools sequentially, so a stuck command blocks all subsequent tool calls.

**Explicit background:** The model sets `background: true`. The command runs asynchronously. The tool returns immediately with a task ID.

**Auto-yield:** If a command runs longer than a configurable threshold (default: 10 seconds), it auto-backgrounds. The agent receives the output accumulated so far plus a task ID. The threshold is configurable via the cortex agent config.

**Polling backgrounded processes:** The agent uses the **TaskOutput** tool (a separate companion tool, automatically registered alongside Bash) to interact with backgrounded processes:
- `poll`: Get the latest output and status (running/completed/failed)
- `send`: Send input to the process stdin (e.g., answering a prompt)
- `kill`: Send a signal to the process (SIGINT for Ctrl+C, SIGTERM, SIGKILL)

**Completion notification:** When a backgrounded process completes, the agent is notified via pi-agent-core's follow-up message mechanism. The agent does not need to poll repeatedly.

### Process Tree Cleanup

When a command is killed (timeout, abort, explicit kill), all child processes must be cleaned up:

- **Unix:** Spawn with `detached: true` so the command runs in its own process group. On kill, send `SIGKILL` to the process group via `kill(-pid, SIGKILL)`.
- **Windows:** Use `taskkill /F /T /PID <pid>` to force-kill the entire process tree.

On agent abort (the entire agentic loop is cancelled), all running bash processes (foreground and background) are killed.

### Output Handling

- Output truncated at ~30,000 characters in `content` (what the model sees)
- Full output preserved in `details` (what the UI shows)
- Uses pi-agent-core's native `AgentToolResult<T>` split
- **Truncation strategy:** Keep the first ~15,000 and last ~15,000 characters, elide the middle with: `\n[... truncated ${elided} characters. Use Read or Grep to inspect specific parts. ...]\n`
- Binary output is sanitized: control characters (except tab/newline/CR), surrogate pairs, and format characters are stripped

### Output Encoding

- **Unix:** Force UTF-8 encoding on stdout/stderr streams via `spawn` options or `.setEncoding('utf8')`. Unix systems almost universally use UTF-8.
- **Windows PowerShell:** Prefix each command with `$OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;` to force UTF-8 output regardless of the system's default code page.
- Non-UTF-8 bytes that cannot be decoded are replaced with the Unicode replacement character (U+FFFD) rather than throwing.

### Error Handling

| Condition | Behavior |
|-----------|----------|
| Shell binary not found | Return error in `content`: "Shell not found: {path}. Configure a custom shell in settings." |
| Command not found (exit 127) | Return stdout/stderr as normal. The exit code tells the model the command wasn't found. |
| Permission denied (exit 126) | Return stdout/stderr as normal. The model can adjust (e.g., suggest `chmod` or try a different approach). |
| Timeout exceeded | Kill the process tree. Return output accumulated so far plus: "Command timed out after {timeout}ms." |
| Blocked by safety layer | Return error in `content` with the specific block reason (e.g., "This command would modify a critical system directory."). Do NOT execute the command. |
| Blocked by permission gate | Return the permission gate's denial message. The consumer's `beforeToolCall` hook handled this. |
| Spawn failure (ENOMEM, etc.) | Return error in `content`: "Failed to execute command: {error.message}" |

## Safety Architecture

Safety is implemented in seven layers. All layers ship in the foundation phase except kernel-level sandboxing.

### Layer 1: Environment Variable Security

Before spawning any command, build the child process environment by inheriting `process.env` and stripping dangerous variables. The child gets everything the parent has, minus known-dangerous keys.

**Blocked variables (stripped entirely):**

| Category | Variables |
|----------|----------|
| Runtime loaders | `NODE_OPTIONS`, `NODE_PATH`, `PYTHONPATH`, `PYTHONHOME`, `PERL5LIB`, `PERL5OPT`, `RUBYLIB`, `RUBYOPT` |
| Shell startup injection | `BASH_ENV`, `ENV`, `SHELLOPTS`, `PS4`, `IFS`, `PROMPT_COMMAND`, `ZDOTDIR` |
| Library injection | `LD_PRELOAD`, `LD_LIBRARY_PATH`, `DYLD_INSERT_LIBRARIES`, `DYLD_LIBRARY_PATH`, all `LD_*` and `DYLD_*` prefixes, `BASH_FUNC_*` prefixes |
| Git execution | `GIT_EXTERNAL_DIFF`, `GIT_EXEC_PATH`, `GIT_SSH_COMMAND` |
| Security-sensitive | `SSLKEYLOGFILE`, `GCONV_PATH`, `OPENSSL_CONF`, `CURL_HOME`, `WGETRC` |

**Always rejected overrides:** `PATH` and `HOME` overrides from tool parameters are rejected to prevent binary hijacking and profile redirection. The child inherits the parent's `PATH` and `HOME` as-is.

**Context marker:** `CORTEX_SHELL=exec` is set in the child environment so shell profiles can detect they are running inside the cortex bash tool.

### Layer 2: Critical Path Protection

Unconditionally block commands whose target paths resolve to critical system directories.

**macOS / Linux:**
- `/`, `/usr`, `/etc`, `/boot`, `/sbin`, `/var`, `/System`
- `~/Library` (macOS)
- `/proc`, `/sys` (Linux)

**Windows:**
- `C:\Windows`, `C:\Windows\System32`
- `C:\Program Files`, `C:\Program Files (x86)`
- `C:\ProgramData`
- `C:\Users\<user>\AppData`

Block message: "This command would modify a critical system directory. This cannot be auto-allowed."

### Layer 3: Command Classification

Classify commands by their impact to inform the permission gate.

**Unix (bash/zsh):**

| Classification | Commands |
|---------------|----------|
| `read` | `cd`, `ls`, `find`, `cat`, `head`, `tail`, `sort`, `wc`, `diff`, `grep`, `git status/log/diff`, `echo`, `pwd`, `env`, `which`, `file`, `stat`, `strings`, `hexdump` |
| `write` | `rm`, `rmdir`, `mv`, `cp`, `sed` (with `-i`), `chmod`, `chown` |
| `create` | `mkdir`, `touch`, `tee` |
| `network` | `curl`, `wget`, `ssh`, `scp`, `rsync`, `nc`, `nmap` |
| `safe-stdin` | `jq`, `cut`, `uniq`, `head`, `tail`, `tr`, `wc` (stdin only, no file args, no denied flags) |
| `unknown` | Everything else |

**Windows (PowerShell):**

| Classification | Commands |
|---------------|----------|
| `read` | `Get-Content`, `Get-ChildItem`, `Get-Item`, `Get-Location`, `Select-String`, `Compare-Object`, `Test-Path`, `Get-Process`, `dir`, `type`, `where` |
| `write` | `Remove-Item`, `Move-Item`, `Copy-Item`, `Set-Content`, `Rename-Item`, `Set-ItemProperty` |
| `create` | `New-Item`, `Out-File`, `Add-Content` |
| `network` | `Invoke-WebRequest`, `Invoke-RestMethod`, `curl` (alias), `wget` (alias), `Test-NetConnection`, `ssh` |
| `unknown` | Everything else |

**Safe-stdin denied flags** (per binary):

| Binary | Denied Flags |
|--------|-------------|
| `grep` | `-r`, `-R`, `-d`, `-f`, `--recursive`, `--dereference-recursive`, `--directories`, `--file`, `--exclude-from` |
| `jq` | `-f`, `-L`, `--from-file`, `--library-path`, `--argfile`, `--rawfile`, `--slurpfile` |
| `sort` | `-o`, `-T`, `--output`, `--temporary-directory`, `--compress-program`, `--files0-from`, `--random-source` |
| `wc` | `--files0-from` |
| `cut`, `uniq`, `head`, `tail`, `tr` | No specific denied flags; rely on core stdin-only restriction (reject positional file arguments and path-like tokens) |

### Layer 4: Path Validation

For write/create commands, extract target file paths and validate:
- Target must be within the configured working directory or an explicitly allowed path
- Compound commands with `cd` followed by write operations require extra scrutiny (path resolution bypass)
- Commands with flags that change target directories (e.g., `--target-directory=PATH`) require manual approval
- On Windows, handle both forward slash and backslash path formats
- Resolve symlinks before validation to prevent symlink-based path escapes

### Layer 5: Obfuscation and Injection Detection

Detect obfuscation and injection patterns before execution. Commands matching these patterns are blocked or require explicit approval.

**Unix patterns:**

| Category | Patterns |
|----------|----------|
| Encoded execution | Base64 decode piped to shell (`base64 -d \| bash`), hex decode (`xxd -r \| sh`), printf with escape sequences piped to shell |
| Eval injection | `eval` with encoded/obfuscated input |
| Download-and-execute | `curl`/`wget` piped to shell. Blocked unless URL matches safe allowlist (see below). |
| Heredoc execution | Shell heredoc used to construct and execute commands |
| Escape sequences | Bash octal/hex escape sequences constructing commands |
| Polyglot injection | Python/Perl/Ruby with base64/eval patterns |
| Variable obfuscation | Variable assignment chains that construct commands |
| Process substitution | Remote content via process substitution |
| Shell metacharacters | Backslash-escaped operators/whitespace, Unicode whitespace, control characters, mid-word hash, obfuscated flags |
| Structural | Comment/quote desync, malformed tokens, incomplete commands, embedded newlines |
| Length | Commands exceeding 10,000 characters |
| IFS | `IFS` variable manipulation |
| Proc access | Access to `/proc/*/environ` |

**PowerShell patterns:**

| Category | Patterns |
|----------|----------|
| Encoded execution | `-EncodedCommand` parameter, `[Convert]::FromBase64String` piped to `iex` |
| Invoke-Expression | `Invoke-Expression` (iex) with constructed strings |
| Download cradles | `(New-Object Net.WebClient).DownloadString() \| iex`, `Invoke-WebRequest` piped to `iex` |
| Hidden execution | `Start-Process` with `-WindowStyle Hidden` |
| Reflection | `[Reflection.Assembly]::Load` from remote content |
| Bypass flags | `-ExecutionPolicy Bypass` combined with encoded input |

**Invisible character stripping:** Before analysis, strip all invisible Unicode code points (zero-width joiners/non-joiners, bidirectional markers, variation selectors, tag characters).

**Safe URL allowlist for download-and-execute:** The `curl | bash` pattern is blocked by default, but the following well-known installer URLs are exempted. The command must contain exactly one URL with no embedded credentials.

| Host | Path Prefix | Purpose |
|------|-------------|---------|
| `brew.sh` | any | Homebrew installer |
| `get.pnpm.io` | any | pnpm installer |
| `bun.sh` | `/install` | Bun installer |
| `sh.rustup.rs` | any | Rust installer |
| `get.docker.com` | any | Docker installer |
| `install.python-poetry.org` | any | Poetry installer |
| `raw.githubusercontent.com` | `/Homebrew/` | Homebrew raw GitHub scripts |
| `raw.githubusercontent.com` | `/nvm-sh/nvm/` | nvm install scripts |

### Layer 6: Script Preflight

Before executing scripts (Python, Node, etc.) via the shell, scan the script file for common agent mistakes:
- **Shell variable injection**: Bare `$VARS` in Python/JS files (the agent generated shell syntax in the wrong language)
- **Shell syntax bleed**: JS/Python files starting with shell commands (the agent mixed up file contexts)

### Layer 7: Auto-Mode Classifier

Uses the cortex **utility model** (see `model-tiers.md`) to classify whether a command should be blocked. Used when the agent is running in autonomous/auto-approve mode. Platform-agnostic since it operates on semantic intent.

**System prompt role:** "You are a security monitor for autonomous AI coding agents."

**Default rule:** Actions are ALLOWED by default. Only block if a BLOCK condition matches AND no ALLOW exception applies.

**Two-stage classification:**
1. **Fast check** (256 max tokens): Quick classification. If `shouldBlock: false`, proceed.
2. **Full analysis** (4096 max tokens): Detailed review when the fast check blocks or is uncertain.

**Tool schema:**
```typescript
classify_result: {
  thinking: string,     // reasoning about the decision
  shouldBlock: boolean,  // the verdict
  reason: string         // human-readable explanation
}
```

**BLOCK conditions** (22 categories): git force push, push to default branch, code from external sources executed without review, cloud storage mass delete, production deploy, remote shell writes, blind apply (skipping dry-run), logging/audit tampering, permission grants, TLS/auth weakening, creating unsafe agents, interfering with others, modifying shared resources, irreversible local destruction beyond project scope, creating RCE surfaces, exposing local services, credential leakage/exploration, data exfiltration, self-modification, external system writes, content impersonation, real-world transactions.

**ALLOW exceptions** (6 categories): test artifacts, local operations within project scope, read-only operations, declared dependencies (package install), toolchain bootstrap (language/runtime installers), git push to working branch (not default).

**Fail-safe:** If the classifier errors, times out, or returns unparseable output, it blocks by default.

## System Prompt Guidance

The system prompt should be platform-aware. On macOS/Linux, command examples use bash syntax. On Windows, command examples use PowerShell syntax.

### Universal Guidance
Steer the model away from using Bash for operations that have dedicated tools:
- File reading: use Read, not `cat`/`head`/`tail` (Unix) or `Get-Content`/`type` (Windows)
- File editing: use Edit, not `sed`/`awk` (Unix) or `Set-Content` (Windows)
- File searching: use Grep, not `grep`/`rg` (Unix) or `Select-String` (Windows)
- File finding: use Glob, not `find`/`ls` (Unix) or `Get-ChildItem`/`dir` (Windows)
- File writing: use Write, not `echo` redirection

### Platform Detection

The cortex default system prompt includes platform and shell information (see `system-prompt.md`, Section 7: Environment). The model uses this to determine which shell syntax to use.
