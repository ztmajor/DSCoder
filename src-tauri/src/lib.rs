mod error;
mod paths;
mod provision;
mod proxy;
mod sidecar;
mod state;
mod ui;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

use state::{DshStatus, SharedState};

/// setup：数据目录、共享状态与 sidecar 监督器。
/// 凭证/模型等配置完全交给官方 UI（写入 $DSH_HOME/.credentials.yaml 与 settings.yaml）。
fn init_state(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = paths::app_data_root();
    std::fs::create_dir_all(&data_dir)?;
    let dsh_home = data_dir.join("dsh-home");
    std::fs::create_dir_all(&dsh_home)?;
    let launch = paths::resolve_launch(app.handle(), &data_dir.join("runtime"));

    let shared = Arc::new(SharedState {
        status: tokio::sync::RwLock::new(DshStatus {
            state: "starting".into(),
            port: None,
            pid: None,
            attempt: 0,
            message: None,
        }),
        base: tokio::sync::RwLock::new(None),
        shutdown: AtomicBool::new(false),
        child: tokio::sync::Mutex::new(None),
        http: reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()?,
        dsh_home,
        stderr_log: data_dir.join("dsh-stderr.log"),
        navigated_port: tokio::sync::RwLock::new(None),
        launch,
        tasks: tokio::sync::Mutex::new(Vec::new()),
    });
    app.manage(shared.clone());
    // 放行远程 DSH 页面（http://127.0.0.1:*，sidecar 动态端口）调用 open_external_url，
    // 使价格面板点击能用系统默认浏览器打开充值页（Tauri 默认拒绝远程 origin 的 IPC）。
    if let Err(e) = app.add_capability(
        tauri::ipc::CapabilityBuilder::new("dscoder-open-external-url")
            .window("main")
            .remote("http://127.0.0.1:*".to_string())
            .remote("http://localhost:*".to_string())
            .permission("allow-open-external-url"),
    ) {
        eprintln!("[dscoder] add_capability(open_external_url) failed: {e}");
    }
    // 先供给（运行时 + 插件），完成后再拉起 sidecar 监督器。
    let handle = app.handle().clone();
    let st = shared.clone();
    tauri::async_runtime::spawn(async move {
        provision::ensure_and_start(handle, st).await;
    });
    spawn_update_check(app.handle().clone());
    Ok(())
}

/// 退出路径：置 shutdown、abort 后台任务、终止子进程。
fn shutdown(app: &AppHandle) {
    let Some(state) = app.try_state::<Arc<SharedState>>() else {
        return;
    };
    state.shutdown.store(true, Ordering::Relaxed);
    let st = state.inner().clone();
    tauri::async_runtime::block_on(async move {
        let mut tasks = st.tasks.lock().await;
        for task in tasks.drain(..) {
            task.abort();
        }
        sidecar::kill_child(&st).await;
    });
}

/// 用系统默认浏览器打开外部链接（价格面板点击跳转充值页等）。
/// 仅放行 http/https，避免被随意调用；WebView2 里 window.open/_blank
/// 不可靠，外部链接统一交给本命令走系统浏览器。
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("only http/https URLs are allowed".to_string());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new("cmd");
        cmd.args(["/C", "start", "", &url])
            .creation_flags(0x0800_0000); // CREATE_NO_WINDOW：不让 cmd 闪出控制台窗口
        return cmd.spawn().map(|_| ()).map_err(|e| e.to_string());
    }
    #[cfg(not(windows))]
    {
        let result = if cfg!(target_os = "macos") {
            std::process::Command::new("open").arg(&url).spawn()
        } else {
            std::process::Command::new("xdg-open").arg(&url).spawn()
        };
        result.map(|_| ()).map_err(|e| e.to_string())
    }
}

/// 后台检查更新：发现新版弹原生对话框，确认后下载安装并重启。
/// 更新检查全部在 Rust 侧（窗口会导航到官方 dsh UI，无自建前端）。
fn spawn_update_check(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // 延迟几秒，避免与运行时供给/页面导航争抢资源。
        tokio::time::sleep(Duration::from_secs(8)).await;

        let Ok(updater) = app.updater() else {
            return;
        };
        let update = match updater.check().await {
            Ok(Some(u)) => u,
            Ok(None) => return,
            Err(e) => {
                eprintln!("[dscoder] 检查更新失败：{e}");
                return;
            }
        };

        let version = update.version.clone();
        let current = app.package_info().version.to_string();
        let confirmed = app
            .dialog()
            .message(format!("发现新版本 v{version}（当前 v{current}），是否立即更新？"))
            .title("DSCoder 更新")
            .kind(MessageDialogKind::Info)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "立即更新".into(),
                "稍后".into(),
            ))
            .blocking_show();

        if !confirmed {
            return;
        }

        match update.download_and_install(|_len, _total| {}, || {}).await {
            Ok(()) => {
                app.request_restart();
            }
            Err(e) => {
                eprintln!("[dscoder] 更新失败：{e}");
                let _ = app
                    .dialog()
                    .message(format!("更新失败：{e}"))
                    .title("DSCoder")
                    .kind(MessageDialogKind::Error)
                    .buttons(MessageDialogButtons::Ok)
                    .blocking_show();
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![open_external_url])
        .setup(init_state)
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                shutdown(app_handle);
            }
        });
}
