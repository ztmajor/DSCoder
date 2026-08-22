use std::path::PathBuf;
use std::sync::atomic::AtomicBool;

use serde::Serialize;
use tokio::process::Child;
use tokio::sync::{Mutex, RwLock};

/// sidecar 的监听地址（端口发现后填充）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseInfo {
    pub port: u16,
    pub base_url: String,
}

/// sidecar 生命周期状态（仅用于日志/诊断；官方 UI 直接同源访问，无需 IPC 轮询）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DshStatus {
    /// starting | ready | restarting | stopped | fatal
    pub state: String,
    pub port: Option<u16>,
    pub pid: Option<u32>,
    pub attempt: u32,
    pub message: Option<String>,
}

/// dsh 启动命令（program + 前置参数，尾部固定追加 `web --port 0 --no-open`）。
#[derive(Debug, Clone)]
pub struct Launch {
    pub program: String,
    pub prefix: Vec<String>,
}

/// 进程内共享状态；以 `Arc<SharedState>` 形式 manage 进 Tauri。
pub struct SharedState {
    pub status: RwLock<DshStatus>,
    pub base: RwLock<Option<BaseInfo>>,
    pub shutdown: AtomicBool,
    pub child: Mutex<Option<Child>>,
    pub http: reqwest::Client,
    pub dsh_home: PathBuf,
    /// sidecar stderr 落盘位置（诊断用）。
    pub stderr_log: PathBuf,
    /// 已导航到官方 UI 的端口（端口变化时才重新导航，避免重复 reload）。
    pub navigated_port: RwLock<Option<u16>>,
    pub launch: Launch,
    /// 后台任务句柄（退出时统一 abort）。
    pub tasks: Mutex<Vec<tauri::async_runtime::JoinHandle<()>>>,
}

impl SharedState {
    pub fn shutting_down(&self) -> bool {
        self.shutdown.load(std::sync::atomic::Ordering::Relaxed)
    }
}
