// This lib.rs is required by Tauri's build system.
// The main application logic is in main.rs.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Desktop entry point is in main.rs
    // This function exists for mobile target compatibility (future)
}
