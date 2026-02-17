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

fn generate_hex_secret(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::getrandom(&mut buf).expect("Failed to generate random bytes");
    buf.iter().map(|b| format!("{:02x}", b)).collect()
}

fn ensure_secret(data_dir: &std::path::Path, filename: &str) -> String {
    let path = data_dir.join(filename);
    if path.exists() {
        return std::fs::read_to_string(&path)
            .unwrap_or_else(|_| panic!("Failed to read {}", filename))
            .trim()
            .to_string();
    }
    let secret = generate_hex_secret(32);
    std::fs::write(&path, &secret).unwrap_or_else(|_| panic!("Failed to write {}", filename));
    secret
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

        // Open log file for sidecar stdout/stderr
        let sidecar_log_path = data_dir.join("sidecar.log");
        let sidecar_stdout = File::create(&sidecar_log_path)
            .expect("Failed to create sidecar log file");
        let sidecar_stderr = sidecar_stdout.try_clone()
            .expect("Failed to clone sidecar log file handle");

        log!(log_file, "Sidecar log: {:?}", sidecar_log_path);

        // Spawn the Node.js sidecar
        let child = Command::new(&node_bin)
            .arg(&entry_point)
            .env("PORT", port.to_string())
            .env("HOST", "127.0.0.1")
            .env("NODE_ENV", "production")
            .env("DB_SYSTEM_PATH", format!("{}/system.db", data_dir_str))
            .env("DB_HEARTBEAT_PATH", format!("{}/heartbeat.db", data_dir_str))
            .env("DB_MEMORY_PATH", format!("{}/memory.db", data_dir_str))
            .env("DB_MESSAGES_PATH", format!("{}/messages.db", data_dir_str))
            .env("DB_AGENT_LOGS_PATH", format!("{}/agent_logs.db", data_dir_str))
            .env("DB_PERSONA_PATH", format!("{}/persona.db", data_dir_str))
            .env("LANCEDB_PATH", format!("{}/lancedb", data_dir_str))
            .env("ANIMUS_ENCRYPTION_KEY", ensure_secret(&data_dir, ".encryption_key"))
            .env("JWT_SECRET", ensure_secret(&data_dir, ".jwt_secret"))
            .stdout(Stdio::from(sidecar_stdout))
            .stderr(Stdio::from(sidecar_stderr))
            .spawn()
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
                // Graceful shutdown: SIGTERM → wait 5s → SIGKILL
                let state = app_handle.state::<Sidecar>();
                let child_opt = state.0.lock().ok().and_then(|mut g| g.take());
                if let Some(mut child) = child_opt {
                    #[cfg(unix)]
                    {
                        // Send SIGTERM for graceful shutdown
                        unsafe {
                            libc::kill(child.id() as i32, libc::SIGTERM);
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

                    // Force kill if still running
                    let _ = child.kill();
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
