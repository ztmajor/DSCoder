use std::sync::Arc;

use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

use crate::state::SharedState;

/// sidecar 就绪后把主窗口导航到官方 dsh UI（同源、过信任栅栏）。
/// 以端口去重：sidecar 重启换端口时自动跳转到新地址。
pub async fn navigate_to_dsh(app: AppHandle, state: Arc<SharedState>) {
    let Some(base) = state.base.read().await.clone() else {
        return;
    };
    {
        let mut nav = state.navigated_port.write().await;
        if *nav == Some(base.port) {
            return;
        }
        *nav = Some(base.port);
    }
    let Ok(url) = Url::parse(&format!("{}/", base.base_url)) else {
        return;
    };

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.navigate(url);
        let _ = window.show();
    } else {
        let _ = WebviewWindowBuilder::new(&app, "main", WebviewUrl::External(url))
            .title("DSCoder")
            .inner_size(1280.0, 800.0)
            .build();
    }
}
