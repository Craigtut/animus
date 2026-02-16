# Sidecar Binaries

Place the Node.js binary here for Tauri desktop builds.

Tauri requires sidecar binaries to be named with the target triple suffix.

## Setup

Download the Node.js binary for your target platform and rename it:

| Platform | Binary Name |
|----------|-------------|
| macOS (Apple Silicon) | `node-aarch64-apple-darwin` |
| macOS (Intel) | `node-x86_64-apple-darwin` |
| Linux (x86_64) | `node-x86_64-unknown-linux-gnu` |
| Linux (ARM64) | `node-aarch64-unknown-linux-gnu` |
| Windows (x86_64) | `node-x86_64-pc-windows-msvc.exe` |

### Example (macOS Apple Silicon)

```bash
# Download Node.js
curl -O https://nodejs.org/dist/v24.0.0/node-v24.0.0-darwin-arm64.tar.gz
tar xzf node-v24.0.0-darwin-arm64.tar.gz

# Copy and rename the binary
cp node-v24.0.0-darwin-arm64/bin/node ./node-aarch64-apple-darwin
chmod +x ./node-aarch64-apple-darwin
```

## Notes

- The binary must be executable (`chmod +x`)
- Only the `node` binary is needed, not the full Node.js distribution
- The backend JS files are copied to `resources/backend/` during the build
