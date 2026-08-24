use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use regex::Regex;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::time::sleep;

use crate::error::DshError;
use crate::proxy;
use crate::state::{BaseInfo, DshStatus, SharedState};

/// URL 行即官方 readiness 信号（`bundle/web-app/src/index.ts` 注释明确）。
fn port_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"dsh web: http://127\.0\.0\.1:(\d+)").unwrap())
}

/// 连续失败退避：500ms 起步、封顶 30s。
fn backoff(attempt: u32) -> Duration {
    let exp = attempt.saturating_sub(1).min(6);
    Duration::from_millis(500u64.saturating_mul(1u64 << exp))
}

/// 写状态并广播 `dsh://status` 事件。
pub(crate) async fn set_status(app: &AppHandle, state: &Arc<SharedState>, status: DshStatus) {
    *state.status.write().await = status.clone();
    let _ = app.emit("dsh://status", &status);
}

/// 终止 sidecar 子进程（`dsh_restart` 与退出路径共用）。
pub async fn kill_child(state: &Arc<SharedState>) {
    if let Some(mut child) = state.child.lock().await.take() {
        let _ = child.kill().await;
    }
}

/// `web` 之后的参数：默认面向 fork 版（0.1.1-rc.2，支持 `--no-open`）；
/// 可用 `DSH_WEB_ARGS`（空格分隔）覆盖，兼容旧版（如 0.1.0-rc.6 无此参数）。
fn web_args() -> Vec<String> {
    match std::env::var("DSH_WEB_ARGS") {
        Ok(v) => v.split_whitespace().map(String::from).collect(),
        Err(_) => vec!["--port".into(), "0".into(), "--no-open".into()],
    }
}

/// 子进程继承环境中允许保留的 DSH_/CORDIS_ 变量（其余全部剔除，
/// 防止用户终端的 vibe coding 环境变量泄漏进 sidecar 改变 dsh 行为）。
const ALLOWED_INHERITED: &[&str] = &[];

/// 构造子进程：环境仅注入 DSH_HOME 与遥测开关；
/// 凭证/模型由官方 UI 写入 $DSH_HOME（.credentials.yaml / settings.yaml）。
async fn spawn_child(state: &Arc<SharedState>) -> Result<Child, DshError> {
    let mut cmd = Command::new(&state.launch.program);
    cmd.args(&state.launch.prefix)
        .arg("web")
        .args(web_args())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // 先剔除可能干扰的继承变量，再写入我们自己的值。
    for (key, _value) in std::env::vars() {
        let prefix = key.starts_with("DSH_") || key.starts_with("CORDIS_");
        if prefix && !ALLOWED_INHERITED.contains(&key.as_str()) {
            cmd.env_remove(&key);
        }
    }
    cmd.env("DSH_HOME", &state.dsh_home)
        .env("DSH_TELEMETRY_DISABLED", "1")
        .env("NO_COLOR", "1")
        // 插件记账数据收进 DSCoder 数据目录（默认落在 ~/.dsh）
        .env(
            "DSH_USAGE_QUOTA_DATA_DIR",
            state.dsh_home.join("usage-quota"),
        );
    cmd.spawn()
        .map_err(|e| DshError::Invalid {
            message: format!(
                "无法启动 dsh（{} {}）：{e}；可用 DSH_NODE/DSH_JS 显式指定运行时",
                state.launch.program,
                state.launch.prefix.join(" ")
            ),
        })
}

/// URL 行出现后的探活：host.describe 成功即确认为 ready。
async fn probe_health(app: AppHandle, state: Arc<SharedState>) {
    for _ in 0..40 {
        if state.shutting_down() {
            return;
        }
        match proxy::rpc_raw(&state, "host.describe", &serde_json::json!({})).await {
            Ok(_) => {
                let status = DshStatus {
                    state: "ready".into(),
                    port: state.base.read().await.as_ref().map(|b| b.port),
                    pid: None,
                    attempt: 0,
                    message: None,
                };
                set_status(&app, &state, status).await;
                crate::ui::navigate_to_dsh(app.clone(), state.clone()).await;
                return;
            }
            Err(_) => sleep(Duration::from_millis(500)).await,
        }
    }
}

/// 读日志文件末尾 n 行，用于状态消息。
fn log_tail(path: &std::path::Path, n: usize) -> String {
    let Ok(text) = std::fs::read_to_string(path) else {
        return "无 stderr 日志".into();
    };
    let lines: Vec<&str> = text.lines().rev().take(n).collect();
    if lines.is_empty() {
        return "无 stderr 日志".into();
    }
    format!("stderr 末行：{}", lines.iter().rev().copied().collect::<Vec<_>>().join(" | "))
}

/// 监督循环：spawn → 等待退出 → 退避重启；连续 5 次失败进入 fatal。
pub fn spawn_supervisor(app: AppHandle, state: Arc<SharedState>) {
    tauri::async_runtime::spawn(async move {
        supervise(app, state).await;
    });
}

async fn supervise(app: AppHandle, state: Arc<SharedState>) {
    let mut attempt: u32 = 0;
    let reached_ready = Arc::new(AtomicBool::new(false));

    loop {
        if state.shutting_down() {
            break;
        }
        set_status(
            &app,
            &state,
            DshStatus {
                state: "starting".into(),
                port: None,
                pid: None,
                attempt,
                message: None,
            },
        )
        .await;

        let mut child = match spawn_child(&state).await {
            Ok(c) => c,
            Err(e) => {
                attempt += 1;
                if attempt >= 5 {
                    set_status(
                        &app,
                        &state,
                        DshStatus {
                            state: "fatal".into(),
                            port: None,
                            pid: None,
                            attempt,
                            message: Some(e.to_string()),
                        },
                    )
                    .await;
                    return;
                }
                set_status(
                    &app,
                    &state,
                    DshStatus {
                        state: "restarting".into(),
                        port: None,
                        pid: None,
                        attempt,
                        message: Some(e.to_string()),
                    },
                )
                .await;
                sleep(backoff(attempt)).await;
                continue;
            }
        };

        let pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        *state.child.lock().await = Some(child);

        // stderr → 落盘日志（含尝试序号标记），诊断用；同时防止管道写满阻塞 dsh。
        if let Some(stderr) = stderr {
            let log_path = state.stderr_log.clone();
            tauri::async_runtime::spawn(async move {
                use tokio::io::AsyncWriteExt;
                let mut file = match tokio::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&log_path)
                    .await
                {
                    Ok(f) => f,
                    Err(_) => return,
                };
                let _ = file
                    .write_all(format!("\n===== dsh 启动尝试 #{attempt} =====\n").as_bytes())
                    .await;
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let _ = file.write_all(line.as_bytes()).await;
                    let _ = file.write_all(b"\n").await;
                }
                let _ = file.flush().await;
            });
        }

        // stdout 扫描：URL 行 → 记录 base + ready + 探活。
        if let Some(stdout) = stdout {
            let st = state.clone();
            let ap = app.clone();
            let rr = reached_ready.clone();
            tauri::async_runtime::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if let Some(caps) = port_re().captures(&line) {
                        if let Ok(port) = caps[1].parse::<u16>() {
                            *st.base.write().await = Some(BaseInfo {
                                port,
                                base_url: format!("http://127.0.0.1:{port}"),
                            });
                            rr.store(true, Ordering::Relaxed);
                            set_status(
                                &ap,
                                &st,
                                DshStatus {
                                    state: "ready".into(),
                                    port: Some(port),
                                    pid,
                                    attempt: 0,
                                    message: None,
                                },
                            )
                            .await;
                            crate::ui::navigate_to_dsh(ap.clone(), st.clone()).await;
                            tauri::async_runtime::spawn(probe_health(ap.clone(), st.clone()));
                        }
                    }
                }
            });
        }

        // 轮询等待退出：子进程始终留在 state.child 中，
        // 这样 kill_child（重启/设置变更）在等待期间也能取到并终止它。
        let exit = loop {
            if state.shutting_down() {
                break None;
            }
            let mut guard = state.child.lock().await;
            let Some(child) = guard.as_mut() else {
                break None; // 已被 kill_child 取走
            };
            match child.try_wait() {
                Ok(Some(status)) => {
                    guard.take();
                    break Some(status);
                }
                Ok(None) => {
                    drop(guard);
                    sleep(Duration::from_millis(250)).await;
                }
                Err(_) => {
                    guard.take();
                    break None;
                }
            }
        };
        if state.shutting_down() {
            break;
        }
        *state.base.write().await = None;

        if reached_ready.swap(false, Ordering::Relaxed) {
            attempt = 0;
        } else {
            attempt += 1;
        }
        if attempt >= 5 {
            set_status(
                &app,
                &state,
                DshStatus {
                    state: "fatal".into(),
                    port: None,
                    pid: None,
                    attempt,
                    message: Some("连续 5 次启动失败".into()),
                },
            )
            .await;
            return;
        }

        let code = exit
            .map(|s| s.to_string())
            .unwrap_or_else(|| "被信号终止".into());
        set_status(
            &app,
            &state,
            DshStatus {
                state: "restarting".into(),
                port: None,
                pid: None,
                attempt,
                message: Some(format!(
                    "dsh 进程退出：{code}；{}",
                    log_tail(&state.stderr_log, 3)
                )),
            },
        )
        .await;
        sleep(backoff(attempt.max(1))).await;
    }

    set_status(
        &app,
        &state,
        DshStatus {
            state: "stopped".into(),
            port: None,
            pid: None,
            attempt,
            message: None,
        },
    )
    .await;
}
