fn main() {
    // 为应用命令 open_external_url 生成 ACL 权限（allow-open_external_url），
    // 供 lib.rs 里 add_capability 放行远程 DSH 页面（http://127.0.0.1:*）调用。
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["open_external_url"])),
    )
    .expect("failed to run tauri-build")
}
