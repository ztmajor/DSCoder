mod error;
mod paths;
mod proxy;
mod sidecar;
mod state;
mod ui;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Manager, RunEvent};

use state::{DshStatus, SharedState};

/// setup：数据目录、共享状态与 sidecar 监督器。
/// 凭证/模型等配置完全交给官方 UI（写入 $DSH_HOME/.credentials.yaml 与 settings.yaml）。
fn init_state(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = paths::app_data_root();
    std::fs::create_dir_all(&data_dir)?;
    let dsh_home = data_dir.join("dsh-home");
    std::fs::create_dir_all(&dsh_home)?;
    let launch = paths::resolve_launch(&data_dir.join("runtime"));

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
    sidecar::spawn_supervisor(app.handle().clone(), shared);
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(init_state)
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                shutdown(app_handle);
            }
        });
}
