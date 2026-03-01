/**
 * Preload script for macOS dock icon suppression.
 *
 * Loaded via NODE_OPTIONS="--require=/path/to/preload-bg-policy.js" so that
 * every Node.js child process (Claude Agent SDK, MCP stdio servers, etc.)
 * inherits the policy. The native addon sets
 * NSApp.setActivationPolicy(.prohibited) via a constructor attribute that fires
 * during dlopen(), before any JS runs.
 *
 * Non-critical: if the addon fails to load the process still works normally,
 * the user just sees a dock icon.
 */
if (process.platform === 'darwin') {
  try {
    const path = require('path');
    require(path.join(__dirname, 'macos_bg_policy.node'));
  } catch {
    // Non-critical: dock icon may appear but app still works
  }
}
