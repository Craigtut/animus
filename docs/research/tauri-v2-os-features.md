# Tauri v2 OS-Level Features Research

Research into system tray, autostart, global shortcuts, and background audio for Animus desktop.

**TL;DR: Everything we want is possible.** Tauri v2 has first-party plugins for system tray, autostart, and global shortcuts. Push-to-talk with background audio requires Rust-side `cpal`/`rodio` (not webview `getUserMedia`) but is fully achievable.

---

## 1. System Tray / Menu Bar

### What's Available

Tauri v2 has built-in tray icon support (already enabled in our `Cargo.toml` via `tray-icon` feature). Two approaches:

**A. Native Context Menu** - Simple text menu items, checkboxes, submenus, separators. Right-click or left-click opens the menu. Good for basic actions (Show/Hide/Quit).

**B. Custom Popup Panel** - A separate borderless WebviewWindow positioned near the tray icon using `tauri-plugin-positioner`. This gives us a full React-rendered mini dashboard. Dismisses on blur.

### Recommended: Both

- **Right-click** = native context menu (Show Animus, Start on Login, Quit)
- **Left-click** = custom popup panel with mini dashboard (mood indicator, active tasks, quick actions, recent thoughts)

### Key Code Pattern (Rust)

```rust
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tauri_plugin_positioner::{Position, WindowExt};

TrayIconBuilder::new()
    .icon(app.default_window_icon().unwrap().clone())
    .tooltip("Animus")
    .menu(&right_click_menu)
    .menu_on_left_click(false)  // Left click = custom popup
    .on_tray_icon_event(|tray, event| {
        tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
            // Show/toggle popup window positioned at TrayCenter
            // WebviewWindowBuilder with decorations(false), always_on_top(true), skip_taskbar(true)
        }
    })
    .build(app)?;
```

### Keep Running When Window Closed (Minimize to Tray)

```rust
// Intercept close -> hide instead
.on_window_event(|window, event| {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == "main" {
            let _ = window.hide();
            api.prevent_close();
        }
    }
})

// Prevent app exit when all windows hidden
app.run(|_handle, event| {
    if let tauri::RunEvent::ExitRequested { api, .. } = event {
        api.prevent_exit();
    }
});
```

### macOS-Specific

- `iconAsTemplate: true` - icon adapts to light/dark menu bar automatically
- `tray.setTitle("3 tasks")` - shows text next to icon in menu bar (macOS only)
- `app.set_activation_policy(ActivationPolicy::Accessory)` - hides from Dock when tray-only

### Platform Differences

| Feature | macOS | Windows | Linux |
|---------|-------|---------|-------|
| Tray location | Top-right menu bar | Bottom-right system tray | Top panel |
| Icon template (dark/light) | Yes | No | No |
| Title text next to icon | Yes | No | Partial |
| Tooltip | Yes | Yes | No |
| menuOnLeftClick control | Yes | Yes | No (always shows menu) |
| Blur event for popup | Works | Buggy (may not fire on 2nd show) | Unreliable |

### Dependencies Needed

```toml
# Already have: tauri with "tray-icon" feature
# Add:
tauri-plugin-positioner = { version = "2", features = ["tray-icon"] }
```

---

## 2. Launch on Startup (Autostart)

### Plugin: `@tauri-apps/plugin-autostart`

First-party plugin, current version 2.5.1. Registers the app to launch when the OS starts.

### Setup

```toml
# Cargo.toml
tauri-plugin-autostart = "2"
```

```rust
// main.rs
use tauri_plugin_autostart::MacosLauncher;

app.handle().plugin(tauri_plugin_autostart::init(
    MacosLauncher::LaunchAgent,
    Some(vec!["--minimized"]),  // Start hidden in tray
));
```

### Frontend Toggle (Settings Page)

```typescript
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';

// Toggle in settings
const enabled = await isEnabled();
if (enabled) await disable();
else await enable();
```

### Starting Hidden on Boot

The autostart plugin only registers the app to launch. To start hidden:

1. Pass `--minimized` flag via autostart args
2. Check `std::env::args()` in Rust setup
3. If `--minimized`, don't show the main window (tray icon still appears)

```rust
let args: Vec<String> = std::env::args().collect();
let start_minimized = args.contains(&"--minimized".to_string());

if !start_minimized {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}
```

### Platform Mechanisms

| Platform | How It Works | User Management |
|----------|-------------|-----------------|
| macOS | LaunchAgent plist in `~/Library/LaunchAgents/` | System Settings > Login Items |
| Windows | Registry key at `HKCU\...\Run` | Task Manager > Startup tab |
| Linux | .desktop file in `~/.config/autostart/` | DE settings |

### Known Issues

- **macOS**: System notification "App can run in the background" appears (cosmetic, expected)
- **Windows**: Bug [#771](https://github.com/tauri-apps/plugins-workspace/issues/771) - registry entry removed after one boot. Test with latest version (may be fixed in 2.5.1)
- Don't call `enable()` on every startup - only when user toggles the setting

### Capabilities Needed

```json
"autostart:allow-enable",
"autostart:allow-disable",
"autostart:allow-is-enabled"
```

---

## 3. Global Keyboard Shortcuts

### Plugin: `@tauri-apps/plugin-global-shortcut`

System-wide hotkeys that work even when the Tauri window is NOT focused. Uses native APIs (Cocoa on macOS, Win32 RegisterHotKey on Windows, X11 on Linux).

### Press AND Release Detection - YES

The `ShortcutEvent` includes a `state` field: `'Pressed' | 'Released'`. This is exactly what push-to-talk needs.

```typescript
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';

let isPttActive = false;

await register('CommandOrControl+Shift+Space', (event) => {
    if (event.state === 'Pressed' && !isPttActive) {
        isPttActive = true;
        startRecording();
    } else if (event.state === 'Released') {
        isPttActive = false;
        stopRecording();
    }
});
```

Note: Need the `isPttActive` guard because OS key repeat generates multiple `Pressed` events while held.

### Rust-Side Registration (Better for Push-to-Talk)

```rust
use tauri_plugin_global_shortcut::{Builder, Code, Modifiers, ShortcutState};

app.handle().plugin(
    Builder::new()
        .with_handler(|app, shortcut, event| {
            match event.state() {
                ShortcutState::Pressed => app.emit("ptt-start", ()).unwrap(),
                ShortcutState::Released => app.emit("ptt-stop", ()).unwrap(),
            }
        })
        .build(),
)?;
```

### Dynamic Registration at Runtime

All functions (`register`, `unregister`, `isRegistered`) work at any time. User can change their PTT key in settings.

### Supported Keys

- All letters (KeyA-KeyZ), digits (Digit0-9), F1-F24, arrows, Space, Enter, media keys, numpad, etc.
- Modifiers: `Ctrl`/`Control`, `Alt`, `Shift`, `Super`, `CommandOrControl`/`CmdOrCtrl`
- Single keys without modifiers ARE supported (e.g., just `F13`)

### Recommended PTT Key Defaults

| Key | Pros | Cons |
|-----|------|------|
| `CmdOrCtrl+Shift+Space` | Easy to press, intuitive | May conflict with some apps |
| `F13`-`F24` | No conflicts at all | No physical key (needs remapping) |
| `ScrollLock` | Rarely used physical key | Not on all keyboards |

Best approach: let user choose in settings, default to `CmdOrCtrl+Shift+Space`.

### Limitations

- **Silent failure on conflict**: If another app has the same shortcut, handler never fires (no error)
- **Reserved shortcuts can't be overridden**: Cmd+Space (Spotlight), Ctrl+Alt+Delete, etc.
- **Linux**: X11 only, no Wayland support
- **macOS**: May need Input Monitoring permission for some shortcuts

### Capabilities Needed

```json
"global-shortcut:allow-register",
"global-shortcut:allow-unregister",
"global-shortcut:allow-is-registered"
```

---

## 4. Background Audio (Push-to-Talk / Walkie-Talkie)

### The Problem

When the Tauri window is hidden/minimized to tray, the webview is throttled/suspended. `getUserMedia` and Web Audio API streams **stop working**. The `backgroundThrottling: "disabled"` config only works on macOS 14+ and is unsupported on Windows/Linux.

### The Solution: Rust-Side Audio

Use `cpal` for mic capture and `rodio` for playback on the Rust/native side. These operate on OS audio threads, completely independent of the webview lifecycle.

### Architecture

```
User holds hotkey
    |
    v
[Tauri Rust Process]
    |-- Global Shortcut Plugin detects Pressed/Released
    |-- cpal captures mic audio at 16kHz mono
    |-- On release: encode PCM -> WAV via hound
    |-- POST WAV to Node.js sidecar (/api/voice/push-to-talk)
    |
    v
[Node.js Sidecar]
    |-- STT via sherpa-onnx (Parakeet TDT v3)
    |-- Process through heartbeat pipeline
    |-- TTS via sherpa-onnx (Kokoro)
    |-- Return WAV audio response
    |
    v
[Tauri Rust Process]
    |-- Receive WAV response
    |-- Play via rodio
    |-- Emit events to webview for UI feedback (if window visible)
```

### Key Points

- **cpal** runs on OS audio threads - works when window hidden, minimized, or unfocused
- **rodio** plays through native output - same guarantees
- Both coexist with the webview voice mode: `getUserMedia` for in-window mic button, `cpal` for background PTT
- Rust emits events to frontend for visual feedback when window IS visible

### macOS Permissions

For **signed/notarized** builds, BOTH are required:

**Info.plist:**
```xml
<key>NSMicrophoneUsageDescription</key>
<string>Animus uses the microphone for voice interaction and push-to-talk</string>
```

**Entitlements.plist:**
```xml
<key>com.apple.security.device.audio-input</key>
<true/>
<key>com.apple.security.device.microphone</key>
<true/>
```

Missing entitlements = **silent failure** (no prompt, no audio, no error). Critical gotcha for production.

### Windows Permissions

No manifest entries needed. Windows prompts automatically on first use. User manages in Settings > Privacy > Microphone.

### Dependencies Needed

```toml
cpal = "0.15"
rodio = { version = "0.20", default-features = false, features = ["wav"] }
hound = "3.5"
reqwest = { version = "0.12", features = ["blocking"] }  # Already have this
```

---

## 5. Combined Implementation Plan

### New Rust Dependencies

```toml
# Cargo.toml additions
tauri-plugin-autostart = "2"
tauri-plugin-global-shortcut = "2"
tauri-plugin-positioner = { version = "2", features = ["tray-icon"] }
cpal = "0.15"
rodio = { version = "0.20", default-features = false, features = ["wav"] }
hound = "3.5"
```

### New JS Dependencies

```bash
npm install @tauri-apps/plugin-autostart @tauri-apps/plugin-global-shortcut @tauri-apps/plugin-positioner
```

### Updated Capabilities

```json
{
  "permissions": [
    "core:default",
    "shell:allow-spawn",
    "shell:allow-execute",
    "autostart:allow-enable",
    "autostart:allow-disable",
    "autostart:allow-is-enabled",
    "global-shortcut:allow-register",
    "global-shortcut:allow-unregister",
    "global-shortcut:allow-is-registered"
  ]
}
```

### New Files Needed

- `src-tauri/Info.plist` - macOS microphone permission description
- `src-tauri/Entitlements.plist` - macOS audio input entitlement
- `src-tauri/src/audio.rs` - cpal/rodio audio module
- `src-tauri/src/tray.rs` - tray icon + popup setup
- Frontend: `/tray-popup` route for mini dashboard panel
- Frontend: Settings toggles for autostart + PTT key configuration

### Implementation Priority

1. **System Tray + Minimize to Tray** - Foundation for everything else
2. **Autostart** - Simple plugin, adds to Settings page
3. **Global Shortcuts + Push-to-Talk** - Depends on having tray (app runs in background)
4. **Background Audio** - Depends on global shortcuts being wired up

---

## Sources

- [Tauri v2 System Tray Docs](https://v2.tauri.app/learn/system-tray/)
- [Tauri v2 Autostart Plugin](https://v2.tauri.app/plugin/autostart/)
- [Tauri v2 Global Shortcut Plugin](https://v2.tauri.app/plugin/global-shortcut/)
- [Tauri v2 Positioner Plugin](https://v2.tauri.app/plugin/positioner/)
- [cpal - Rust cross-platform audio I/O](https://github.com/RustAudio/cpal)
- [rodio - Rust audio playback](https://github.com/RustAudio/rodio)
- [tauri-plugin-mic-recorder (community, validates cpal approach)](https://github.com/ayangweb/tauri-plugin-mic-recorder)
- [Tauri Issue #9928 - macOS mic permissions with cpal](https://github.com/tauri-apps/tauri/issues/9928)
- [Autostart Issue #771 - Windows registry bug](https://github.com/tauri-apps/plugins-workspace/issues/771)
- [global-hotkey Rust crate (underlying lib)](https://github.com/tauri-apps/global-hotkey)
