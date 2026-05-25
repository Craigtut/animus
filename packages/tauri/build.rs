fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "export_animus_save",
                "desktop_power_status",
                "set_desktop_power_settings",
            ]),
        ),
    )
    .unwrap()
}
