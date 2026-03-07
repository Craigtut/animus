// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;

struct Sidecar(Mutex<Option<Child>>);

/// Simple file logger for the Rust side (sidecar output goes to same file)
fn open_log_file(data_dir: &std::path::Path) -> File {
    let log_path = data_dir.join("animus-desktop.log");
    OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true) // Fresh log each launch
        .open(&log_path)
        .unwrap_or_else(|e| panic!("Failed to open log file {:?}: {}", log_path, e))
}

macro_rules! log {
    ($file:expr, $($arg:tt)*) => {{
        let msg = format!($($arg)*);
        eprintln!("[animus] {}", msg);
        if let Some(f) = $file.as_mut() {
            let _ = writeln!(f, "[{}] {}", chrono_now(), msg);
            let _ = f.flush();
        }
    }};
}

fn chrono_now() -> String {
    // Simple timestamp without chrono crate
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("t+{}s", secs % 100000)
}

fn find_free_port() -> u16 {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .expect("Failed to bind to a free port");
    listener.local_addr().unwrap().port()
}

fn wait_for_server(port: u16, max_retries: u32) -> bool {
    let url = format!("http://127.0.0.1:{}/api/health", port);
    for i in 0..max_retries {
        if i > 0 {
            thread::sleep(Duration::from_millis(500));
        }
        match reqwest::blocking::get(&url) {
            Ok(resp) if resp.status().is_success() => return true,
            _ => continue,
        }
    }
    false
}

/// Show the main window and bring it to focus
fn show_main_window(app_handle: &tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    // On macOS, show app in the Dock when window is visible
    #[cfg(target_os = "macos")]
    {
        let _ = app_handle.set_activation_policy(tauri::ActivationPolicy::Regular);
    }
}

/// Hide the main window (minimize to tray)
fn hide_main_window(app_handle: &tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.hide();
    }
    // On macOS, hide from Dock when window is hidden
    #[cfg(target_os = "macos")]
    {
        let _ = app_handle.set_activation_policy(tauri::ActivationPolicy::Accessory);
    }
}

/// Set up the system tray icon with menu
fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItemBuilder::with_id("show", "Show Animus").build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&show_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))?;

    let mut builder = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .on_menu_event(|app_handle, event| {
            match event.id().as_ref() {
                "show" => show_main_window(app_handle),
                "quit" => app_handle.exit(0),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
                show_main_window(tray.app_handle());
            }
        });

    // On macOS, use template icon for automatic light/dark adaptation
    #[cfg(target_os = "macos")]
    {
        builder = builder.icon_as_template(true);
    }

    builder.build(app)?;
    Ok(())
}

/// Check if --minimized was passed (autostart launches with this flag)
fn should_start_minimized() -> bool {
    std::env::args().any(|a| a == "--minimized")
}

fn main() {
    let context = tauri::generate_context!();
    let start_minimized = should_start_minimized();

    if cfg!(debug_assertions) {
        // Dev mode: beforeDevCommand starts both frontend (5173) and backend (3000).
        // Rust just opens the webview pointing at the dev server — no sidecar needed.
        let app = tauri::Builder::default()
            .plugin(tauri_plugin_shell::init())
            .plugin(tauri_plugin_autostart::Builder::new()
                .args(["--minimized"])
                .build()
            )
            .setup(move |app| {
                setup_tray(app).expect("Failed to setup tray");

                // Intercept window close: hide instead of quit
                if let Some(window) = app.get_webview_window("main") {
                    let w = window.clone();
                    window.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            api.prevent_close();
                            hide_main_window(&w.app_handle());
                        }
                    });
                }

                // If launched with --minimized, hide window immediately
                if start_minimized {
                    hide_main_window(&app.handle());
                }

                Ok(())
            })
            .build(context)
            .expect("Error while building Animus");

        app.run(|_app_handle, _event| {});
    } else {
        // Production mode: spawn Node.js sidecar, wait for health, open webview.
        let port = find_free_port();

        let data_dir = resolve_data_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("./data"));
        std::fs::create_dir_all(&data_dir).expect("Failed to create data directory");
        let data_dir_str = data_dir.to_string_lossy().to_string();

        let mut log_file: Option<File> = Some(open_log_file(&data_dir));

        log!(log_file, "Animus Desktop starting...");
        log!(log_file, "Data dir: {}", data_dir_str);
        log!(log_file, "Port: {}", port);
        if start_minimized {
            log!(log_file, "Starting minimized (autostart)");
        }

        // Resolve the Node.js binary and backend entry point from the app bundle.
        // macOS .app layout:
        //   Contents/MacOS/animus-desktop   (exe)
        //   Contents/MacOS/node             (externalBin — Tauri places it next to exe)
        //   Contents/Resources/resources/   (our resources/ dir)
        // Linux/Windows: binaries and resources are next to the exe.
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_default();

        // externalBin: Tauri places the binary next to the exe (renamed without the target triple)
        let node_bin = exe_dir.join(if cfg!(windows) { "node.exe" } else { "node" });

        // Resources: on macOS, Tauri uses Contents/Resources/; on Linux/Windows, next to exe
        let resources_dir = if cfg!(target_os = "macos") {
            exe_dir.parent()
                .map(|contents| contents.join("Resources"))
                .unwrap_or_else(|| exe_dir.clone())
        } else {
            exe_dir.clone()
        };
        let entry_point = resources_dir.join("resources").join("backend").join("index.js");

        log!(log_file, "Node binary: {:?} (exists: {})", node_bin, node_bin.exists());
        log!(log_file, "Entry point: {:?} (exists: {})", entry_point, entry_point.exists());

        // On macOS, create a minimal "node-helper.app" bundle with
        // LSBackgroundOnly=true in its Info.plist. When macOS launches a binary
        // from inside an .app bundle, Launch Services reads the bundle's
        // Info.plist BEFORE the process starts — this is fundamentally different
        // from runtime API calls (setActivationPolicy, TransformProcessType)
        // which macOS 26 Tahoe accepts but silently ignores.
        //
        // This is the same pattern Electron uses for its helper processes.
        // The helper app lives in the data directory (writable) and hard-links
        // to the real node binary (no disk duplication on APFS).
        let mut effective_node_bin = node_bin.clone();
        #[cfg(target_os = "macos")]
        {
            let helper_app = data_dir.join("node-helper.app");
            let helper_contents = helper_app.join("Contents");
            let helper_macos = helper_contents.join("MacOS");
            let helper_node = helper_macos.join("node");
            let helper_plist = helper_contents.join("Info.plist");

            let plist_content = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key>
    <string>com.animus.node-helper</string>
    <key>CFBundleName</key>
    <string>Animus Helper</string>
    <key>CFBundleExecutable</key>
    <string>node</string>
    <key>LSBackgroundOnly</key>
    <true/>
    <key>LSUIElement</key>
    <true/>
</dict>
</plist>"#;

            match std::fs::create_dir_all(&helper_macos) {
                Ok(_) => {
                    // Always write the Info.plist (in case it changed)
                    let _ = std::fs::write(&helper_plist, plist_content);

                    // Remove stale hard link if the node binary was updated
                    // (e.g., after an app update, the inode changes)
                    if helper_node.exists() {
                        // Check if hard link still points to same inode
                        use std::os::unix::fs::MetadataExt;
                        let src_ino = std::fs::metadata(&node_bin).map(|m| m.ino()).unwrap_or(0);
                        let dst_ino = std::fs::metadata(&helper_node).map(|m| m.ino()).unwrap_or(1);
                        if src_ino != dst_ino {
                            let _ = std::fs::remove_file(&helper_node);
                        }
                    }

                    // Create hard link (same inode, no disk duplication)
                    if !helper_node.exists() {
                        match std::fs::hard_link(&node_bin, &helper_node) {
                            Ok(_) => {
                                log!(log_file, "Helper app: hard-linked node binary");
                            }
                            Err(e) => {
                                // Fall back to copy if hard link fails
                                // (e.g., cross-volume)
                                log!(log_file, "Helper app: hard link failed ({}), copying", e);
                                let _ = std::fs::copy(&node_bin, &helper_node);
                            }
                        }
                    }

                    // Ad-hoc sign the helper app so macOS trusts it
                    let _ = std::process::Command::new("codesign")
                        .args(["--sign", "-", "--force"])
                        .arg(helper_app.to_str().unwrap_or(""))
                        .output();

                    if helper_node.exists() {
                        log!(log_file, "Helper app: using {}", helper_node.display());
                        effective_node_bin = helper_node;
                    } else {
                        log!(log_file, "WARN: Helper app setup failed, using direct node binary");
                    }
                }
                Err(e) => {
                    log!(log_file, "WARN: Failed to create helper app dir: {}", e);
                }
            }
        }

        // Ensure node binary directories are on PATH so that child processes
        // (Claude Agent SDK, MCP stdio servers) can find `node`.
        // On macOS, the helper app's directory comes FIRST so `node` resolves
        // to the LSBackgroundOnly-protected binary. The original MacOS/ dir
        // is kept as fallback.
        let node_dir = effective_node_bin.parent().unwrap_or(&exe_dir);
        let orig_node_dir = node_bin.parent().unwrap_or(&exe_dir);
        let mut path_env = std::env::var("PATH").unwrap_or_default();
        let sep = if cfg!(windows) { ";" } else { ":" };
        // Add helper app dir first (highest priority)
        if !path_env.split(sep).any(|p| std::path::Path::new(p) == node_dir) {
            path_env = format!("{}{}{}", node_dir.display(), sep, path_env);
        }
        // Add original MacOS dir as fallback
        if node_dir != orig_node_dir {
            if !path_env.split(sep).any(|p| std::path::Path::new(p) == orig_node_dir) {
                path_env = format!("{}{}{}", path_env, sep, orig_node_dir.display());
            }
        }

        // On macOS, suppress dock icons for ALL child processes using a
        // four-layer strategy:
        //
        // Layer 0 (PRIMARY): node-helper.app bundle (above)
        //    The sidecar runs from inside a minimal .app bundle that has
        //    LSBackgroundOnly=true in its Info.plist. Launch Services reads
        //    this BEFORE the process starts, preventing dock registration
        //    entirely. This works on macOS 26 Tahoe where runtime APIs
        //    (setActivationPolicy, TransformProcessType) are silently ignored.
        //    Child processes inherit the helper app's node binary via
        //    process.execPath and PATH, so all Node.js processes get coverage.
        //
        // Layer 1: DYLD_INSERT_LIBRARIES=<addon path>
        //    Fallback for non-Node processes (ripgrep, ffmpeg) that don't
        //    launch from the helper app. The addon's constructor calls
        //    setActivationPolicy as a best-effort secondary measure.
        //
        // Layer 2: NODE_OPTIONS=--require=preload-bg-policy.js
        //    Redundant safety net: if DYLD_INSERT_LIBRARIES is stripped by a
        //    security policy, the preload script loads the same addon via require().
        //
        // Layer 3: ANIMUS_DOCK_SUPPRESS_ADDON=<path>
        //    The sidecar propagates DYLD_INSERT_LIBRARIES to grandchild processes
        //    (Claude Agent SDK, MCP servers) via process.env.
        let mut node_options = std::env::var("NODE_OPTIONS").unwrap_or_default();
        let mut dock_addon_path = String::new();
        #[cfg(target_os = "macos")]
        {
            let addon = resources_dir.join("resources").join("macos_bg_policy.node");
            let preload = resources_dir.join("resources").join("preload-bg-policy.js");

            if addon.exists() {
                dock_addon_path = addon.to_string_lossy().to_string();
                log!(log_file, "Dock suppress addon: {}", dock_addon_path);
            } else {
                log!(log_file, "WARN: macos_bg_policy.node not found at {:?}", addon);
            }

            if preload.exists() {
                let require_flag = format!("--require={}", preload.display());
                if node_options.is_empty() {
                    node_options = require_flag;
                } else {
                    node_options = format!("{} {}", require_flag, node_options);
                }
                log!(log_file, "Dock suppress preload: {}", preload.display());
            } else {
                log!(log_file, "WARN: preload-bg-policy.js not found at {:?}", preload);
            }
        }

        // Open log file for sidecar stdout/stderr
        let sidecar_log_path = data_dir.join("sidecar.log");
        let sidecar_stdout = File::create(&sidecar_log_path)
            .expect("Failed to create sidecar log file");
        let sidecar_stderr = sidecar_stdout.try_clone()
            .expect("Failed to clone sidecar log file handle");

        log!(log_file, "Sidecar log: {:?}", sidecar_log_path);

        // Resolve the bundled ffmpeg binary (placed next to exe by Tauri externalBin)
        let ffmpeg_bin = exe_dir.join(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" });
        let ffmpeg_bin_str = if ffmpeg_bin.exists() {
            log!(log_file, "FFmpeg binary: {:?}", ffmpeg_bin);
            Some(ffmpeg_bin.to_string_lossy().to_string())
        } else {
            log!(log_file, "WARN: Bundled ffmpeg not found at {:?}, falling back to system PATH", ffmpeg_bin);
            None
        };

        // Spawn the Node.js sidecar — secrets are auto-generated by the backend
        let mut cmd = Command::new(&effective_node_bin);
        let sidecar_resources_dir = resources_dir.join("resources");
        cmd.arg(&entry_point)
            .env("PORT", port.to_string())
            .env("HOST", "127.0.0.1")
            .env("NODE_ENV", "production")
            .env("ANIMUS_DATA_DIR", &data_dir_str)
            .env("ANIMUS_RESOURCES_DIR", &sidecar_resources_dir)
            .env("PATH", &path_env)
            .env("NODE_OPTIONS", &node_options)
            .stdout(Stdio::from(sidecar_stdout))
            .stderr(Stdio::from(sidecar_stderr));

        // Tell the backend where to find the bundled ffmpeg binary
        if let Some(ref ffmpeg_path) = ffmpeg_bin_str {
            cmd.env("ANIMUS_FFMPEG_BIN", ffmpeg_path);
        }

        // Pass the addon path for child process propagation, and set
        // DYLD_INSERT_LIBRARIES so the addon loads in the sidecar itself
        // (before Node.js initialization — the constructor fires during dlopen).
        if !dock_addon_path.is_empty() {
            cmd.env("ANIMUS_DOCK_SUPPRESS_ADDON", &dock_addon_path);
            cmd.env("DYLD_INSERT_LIBRARIES", &dock_addon_path);
        }

        // Put the sidecar in its own process group so we can kill ALL descendant
        // processes (Claude SDK, MCP servers, channels, FFmpeg) on exit, even if
        // the sidecar has already crashed.
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            unsafe {
                cmd.pre_exec(|| {
                    libc::setpgid(0, 0);
                    Ok(())
                });
            }
        }

        // On Windows, prevent the sidecar from spawning a visible console window
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let child = cmd.spawn()
            .expect("Failed to start Node.js sidecar");

        log!(log_file, "Sidecar spawned (pid: {})", child.id());

        // Wait for the server to be ready
        if !wait_for_server(port, 60) {
            log!(log_file, "ERROR: Backend server failed to start on port {}", port);
            log!(log_file, "Check sidecar.log for details");
            std::process::exit(1);
        }

        log!(log_file, "Sidecar healthy, starting UI...");

        let sidecar = Sidecar(Mutex::new(Some(child)));

        // Build the Tauri app, then run with event callback for graceful shutdown.
        // Using build() + app.run() instead of Builder::run() so we can handle RunEvent::Exit.
        let app = tauri::Builder::default()
            .plugin(tauri_plugin_shell::init())
            .plugin(tauri_plugin_autostart::Builder::new()
                .args(["--minimized"])
                .build()
            )
            .manage(sidecar)
            .setup(move |app| {
                setup_tray(app).expect("Failed to setup tray");

                // Navigate the main window to the sidecar URL (same-origin trick:
                // sidecar serves both API and static frontend, no __ANIMUS_API_URL__ needed)
                if let Some(window) = app.get_webview_window("main") {
                    let url = format!("http://127.0.0.1:{}", port);
                    let _ = window.navigate(url.parse().unwrap());

                    // Open devtools automatically in debug/development
                    #[cfg(debug_assertions)]
                    window.open_devtools();

                    // Intercept window close: hide instead of quit
                    let w = window.clone();
                    window.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            api.prevent_close();
                            hide_main_window(&w.app_handle());
                        }
                    });

                    // If launched with --minimized, hide window immediately
                    if start_minimized {
                        hide_main_window(&app.handle());
                    }
                }
                Ok(())
            })
            .build(context)
            .expect("Error while building Animus");

        app.run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                // Graceful shutdown: SIGTERM to process group → wait 5s → SIGKILL
                let state = app_handle.state::<Sidecar>();
                let child_opt = state.0.lock().ok().and_then(|mut g| g.take());
                if let Some(mut child) = child_opt {
                    let child_pid = child.id();
                    #[cfg(unix)]
                    {
                        // Send SIGTERM to the entire process group (negative PID).
                        // This ensures ALL descendant processes (Claude SDK,
                        // MCP servers, channels, FFmpeg) receive SIGTERM, even
                        // if the sidecar has already crashed.
                        unsafe {
                            libc::kill(-(child_pid as i32), libc::SIGTERM);
                        }
                    }
                    #[cfg(windows)]
                    {
                        let _ = child.kill();
                    }

                    // Wait up to 5 seconds for graceful shutdown
                    for _ in 0..50 {
                        match child.try_wait() {
                            Ok(Some(_)) => return,
                            _ => thread::sleep(Duration::from_millis(100)),
                        }
                    }

                    // Force kill the process group if still running
                    #[cfg(unix)]
                    unsafe {
                        libc::kill(-(child_pid as i32), libc::SIGKILL);
                    }
                    #[cfg(not(unix))]
                    {
                        let _ = child.kill();
                    }
                    let _ = child.wait();
                }
            }
        });
    }
}

/// Get the platform-specific app data directory
fn resolve_data_dir() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "macos")]
    {
        dirs::data_dir().map(|p| p.join("com.animus.desktop"))
    }
    #[cfg(target_os = "linux")]
    {
        dirs::data_dir().map(|p| p.join("animus"))
    }
    #[cfg(target_os = "windows")]
    {
        dirs::data_dir().map(|p| p.join("Animus"))
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        None
    }
}
