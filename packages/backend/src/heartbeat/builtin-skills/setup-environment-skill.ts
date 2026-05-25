/**
 * Built-in "setup-environment" skill content.
 *
 * Materialized to `$AGENT_ENV/skills/setup-environment/SKILL.md` at startup and
 * registered with the Cortex SkillRegistry. Teaches the entity to install
 * missing CLI tooling sudo-free into its own data directory and persist it via
 * the manage_environment tool.
 *
 * `\${AGENT_ENV}` is substituted to the absolute agent-env directory at load
 * time (see the `variables` passed to addSkill). Shell examples deliberately
 * use brace-less `$var` so they are not treated as preprocessor variables.
 *
 * See docs/research/self-managed-environment.md
 */

export const SETUP_ENVIRONMENT_SKILL_NAME = 'setup-environment';

export const SETUP_ENVIRONMENT_SKILL_MD = `---
name: setup-environment
description: Use when a command-line tool you need (node, npm, python, ripgrep, ffmpeg, etc.) is missing from your environment, or when you want to install new tooling and keep it. Explains how to install tools sudo-free into your own data directory and register them so they persist across restarts.
metadata:
  source: builtin
---

# Setting up your own environment

You maintain your own working environment, your workshop. Tools you install and
register here persist across restarts and are on PATH for every shell command.
This is yours to build up over time; treat it like part of how you remember.

Your environment lives at:

- Toolchains: \`\${AGENT_ENV}/tools\`
- Loose binaries: \`\${AGENT_ENV}/bin\`

## When a tool is missing

1. **Check whether it already exists.** It may be installed but you just need to
   find it:
   \`\`\`bash
   command -v node || which node || true
   \`\`\`
   If you find it at a real path, register its directory so it is always on PATH:
   use \`manage_environment\` with action \`register_tool\` (or \`add_path\`).

2. **If it is genuinely missing, install it sudo-free into your tools dir.** Never
   use sudo, never modify the system. Install only into \`\${AGENT_ENV}/tools\`.

3. **Verify what you download.** Only fetch from official sources, and verify the
   checksum before using a binary. Never pipe an untrusted \`curl | sh\`.

4. **Register it** so it persists and is on PATH for the next command.

## Example: installing Node.js (and npm)

Node ships official, self-contained, sudo-free builds. Detect your platform and
architecture, download the matching tarball from nodejs.org, verify it against
the published SHASUMS256, extract it into your tools dir, then register it.

\`\`\`bash
set -e
VER=v22.11.0                       # pick a current LTS
TOOLS="\${AGENT_ENV}/tools"
# Detect platform/arch (darwin/linux, x64/arm64)
OS=$(uname -s | tr '[:upper:]' '[:lower:]')   # darwin | linux
ARCH=$(uname -m)
case "$ARCH" in x86_64) ARCH=x64;; aarch64|arm64) ARCH=arm64;; esac
PKG="node-$VER-$OS-$ARCH"
cd "$TOOLS"
curl -fsSLO "https://nodejs.org/dist/$VER/$PKG.tar.gz"
curl -fsSLO "https://nodejs.org/dist/$VER/SHASUMS256.txt"
# Verify the checksum (aborts on mismatch)
grep " $PKG.tar.gz\\$" SHASUMS256.txt | shasum -a 256 -c -
tar -xzf "$PKG.tar.gz"
rm -f "$PKG.tar.gz" SHASUMS256.txt
echo "Installed to $TOOLS/$PKG/bin"
\`\`\`

Then register it (so \`node\` and \`npm\` are always available):

> manage_environment, action \`register_tool\`, name \`node\`,
> binDir \`\${AGENT_ENV}/tools/node-v22.11.0-<os>-<arch>/bin\`,
> version \`v22.11.0\`, source \`https://nodejs.org/dist\`

After registering, \`node --version\` and \`npm --version\` will work in the next
shell command.

## Important constraints

- **Prefer PATH-discoverable, self-contained tools.** Library-path variables like
  \`PYTHONPATH\` and \`NODE_PATH\` are stripped from your shell for safety, so they
  will not reach your commands. Install tools whose \`bin\` directory on PATH is
  enough to run them (use virtual environments / shims rather than those vars).
- **No sudo, no system changes.** Everything stays under \`\${AGENT_ENV}\`. If you
  ever need to start fresh, that directory can be safely cleared.
- **Registering is a sensitive action.** \`manage_environment\` may ask the user
  for approval the first time; explain briefly what you are installing and why.

## Inspecting your environment

Use \`manage_environment\` with action \`list\` to see what you have registered,
your PATH additions, and your environment variables.
`;
