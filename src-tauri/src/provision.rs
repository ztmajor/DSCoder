use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};

use crate::paths;
use crate::sidecar;
use crate::state::{DshStatus, SharedState};

/// 目标运行时版本（fork 锁定）。
const DSH_VERSION: &str = "0.1.1-rc.2";
/// 底部信息栏插件的包名。
const PLUGIN_NAME: &str = "dsh-bottom-info-bar";

/// 运行时入口：`<data>/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js`。
fn runtime_bin() -> PathBuf {
    paths::app_data_root()
        .join("runtime")
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh")
        .join("lib")
        .join("bin.js")
}

fn runtime_package() -> PathBuf {
    paths::app_data_root()
        .join("runtime")
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh")
        .join("package.json")
}

fn dsh_home() -> PathBuf {
    paths::app_data_root().join("dsh-home")
}

fn plugin_install_dir() -> PathBuf {
    paths::app_data_root().join("plugins").join(PLUGIN_NAME)
}

fn profile_package() -> PathBuf {
    dsh_home().join("profiles").join("web").join("package.json")
}

async fn set_status(app: &AppHandle, state: &Arc<SharedState>, status: DshStatus) {
    *state.status.write().await = status.clone();
    let _ = app.emit("dsh://status", &status);
}

async fn fatal(app: &AppHandle, state: &Arc<SharedState>, message: String) {
    set_status(
        app,
        state,
        DshStatus {
            state: "fatal".into(),
            port: None,
            pid: None,
            attempt: 0,
            message: Some(message),
        },
    )
    .await;
}

/// 直接 spawn 一个程序（不带 shell），返回 stdout；失败时带 stderr 尾行。
/// 不用 `cmd /C`：Windows 的 cmd 引号规则会把带空格的路径（如 `gentle zhou`）拆断，
/// 导致 node 报 `MODULE_NOT_FOUND`。argv 逐项传参无此问题。
async fn run_program(
    program: &str,
    args: &[String],
    envs: &[(&str, &str)],
    label: &str,
) -> Result<String, String> {
    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args);
    for (k, v) in envs {
        cmd.env(k, v);
    }
    let out = cmd
        .output()
        .await
        .map_err(|e| format!("{label} 启动失败：{e}"))?;
    if !out.status.success() {
        let tail = String::from_utf8_lossy(&out.stderr)
            .lines()
            .rev()
            .take(10)
            .collect::<Vec<_>>()
            .join(" | ");
        return Err(format!("{label} 失败：{tail}"));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// 检测 node 与 pnpm 是否可用（缺失时给出中文提示）。
async fn check_tools() -> Result<(), String> {
    run_program("node", &["--version".into()], &[], "检测 node").await?;
    run_program("pnpm", &["--version".into()], &[], "检测 pnpm").await?;
    Ok(())
}

/// 确保 dsh 运行时已安装；缺失/损坏时用 pnpm 安装（首次约 245MB）。
async fn ensure_runtime(state: &Arc<SharedState>, app: &AppHandle) -> Result<(), String> {
    eprintln!("[dscoder] ensure_runtime: enter");
    let bin = runtime_bin();
    let valid = bin.exists() && runtime_package().exists();
    eprintln!("[dscoder] ensure_runtime: bin={} valid={}", bin.display(), valid);
    if valid {
        return Ok(());
    }

    set_status(
        app,
        state,
        DshStatus {
            state: "provisioning".into(),
            port: None,
            pid: None,
            attempt: 0,
            message: Some("正在下载 dsh 运行时（约 245MB，首次较慢）…".into()),
        },
    )
    .await;

    check_tools().await?;
    let runtime_dir = paths::app_data_root().join("runtime");
    std::fs::create_dir_all(&runtime_dir).map_err(|e| format!("创建运行时目录失败：{e}"))?;
    let args = vec![
        "--dir".to_string(),
        runtime_dir.display().to_string(),
        "add".to_string(),
        format!("@deepseek-ai/dsh@{}", DSH_VERSION),
    ];
    run_program("pnpm", &args, &[], "运行时安装").await?;

    if !runtime_bin().exists() {
        return Err("运行时安装完成但未找到 bin.js".into());
    }
    Ok(())
}

/// profile 的 `dsh.profile.bundles` 是否已登记插件。
fn plugin_registered() -> bool {
    let Ok(text) = std::fs::read_to_string(profile_package()) else {
        return false;
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
        return false;
    };
    json.get("dsh")
        .and_then(|d| d.get("profile"))
        .and_then(|p| p.get("bundles"))
        .and_then(|b| b.as_array())
        .map(|arr| arr.iter().any(|v| v.as_str() == Some(PLUGIN_NAME)))
        .unwrap_or(false)
}

/// 定位内置插件目录：优先应用资源，其次 dev 源码资源，最后已安装副本。
fn locate_plugin_dir(app: &AppHandle) -> Option<PathBuf> {
    let probe = |dir: &Path| -> bool {
        dir.join("package.json").exists() && dir.join("lib").join("index.js").exists()
    };

    if let Ok(res) = app.path().resource_dir() {
        let p = res.join(PLUGIN_NAME);
        if probe(&p) {
            return Some(p);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(PLUGIN_NAME);
    if probe(&dev) {
        return Some(dev);
    }
    let installed = plugin_install_dir();
    if probe(&installed) {
        return Some(installed);
    }
    None
}

fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir(&entry.path(), &to)?;
        } else {
            std::fs::copy(entry.path(), &to)?;
        }
    }
    Ok(())
}

/// 确保插件已安装进 web profile；缺失时复制内置产物并 `dsh plugin add`（幂等）。
async fn ensure_plugin(app: &AppHandle, state: &Arc<SharedState>) -> Result<(), String> {
    eprintln!("[dscoder] ensure_plugin: enter, registered={}", plugin_registered());
    if plugin_registered() {
        // 已登记但产物被删时补拷（不自愈 link，仅恢复文件）。
        if !plugin_install_dir().join("lib").join("index.js").exists() {
            let Some(src) = locate_plugin_dir(app) else {
                return Ok(()); // 登记在、无内置源 → 不做破坏性动作
            };
            let _ = copy_dir(&src, &plugin_install_dir());
        }
        return Ok(());
    }

    set_status(
        app,
        state,
        DshStatus {
            state: "provisioning".into(),
            port: None,
            pid: None,
            attempt: 0,
            message: Some("正在安装底部信息栏插件…".into()),
        },
    )
    .await;
    eprintln!("[dscoder] ensure_plugin: status=provisioning(插件)");

    let src = locate_plugin_dir(app).ok_or("找不到内置插件 dsh-bottom-info-bar（资源缺失）")?;
    eprintln!("[dscoder] ensure_plugin: src={}", src.display());
    copy_dir(&src, &plugin_install_dir()).map_err(|e| format!("复制插件失败：{e}"))?;
    eprintln!("[dscoder] ensure_plugin: copied to {}", plugin_install_dir().display());

    let bin = runtime_bin();
    let home = dsh_home();
    let args = vec![
        bin.display().to_string(),
        "plugin".to_string(),
        "--profile".to_string(),
        "web".to_string(),
        "add".to_string(),
        plugin_install_dir().display().to_string(),
    ];
    eprintln!("[dscoder] ensure_plugin: running plugin add: node {:?}", args);
    run_program(
        "node",
        &args,
        &[("DSH_HOME", home.to_str().unwrap_or_default())],
        "插件安装",
    )
    .await?;
    eprintln!("[dscoder] ensure_plugin: plugin add done, registered={}", plugin_registered());

    if !plugin_registered() {
        return Err("插件安装后未在 web profile 生效".into());
    }
    Ok(())
}

/// 应用启动的供给入口：先确保运行时与插件，再拉起 sidecar 监督器。
pub async fn ensure_and_start(app: AppHandle, state: Arc<SharedState>) {
    eprintln!("[dscoder] ensure_and_start: ensure_runtime...");
    if let Err(e) = ensure_runtime(&state, &app).await {
        eprintln!("[dscoder] ensure_and_start: ensure_runtime ERROR: {e}");
        fatal(&app, &state, e).await;
        return;
    }
    eprintln!("[dscoder] ensure_and_start: ensure_plugin...");
    if let Err(e) = ensure_plugin(&app, &state).await {
        eprintln!("[dscoder] ensure_and_start: ensure_plugin ERROR: {e}");
        fatal(&app, &state, e).await;
        return;
    }
    eprintln!("[dscoder] ensure_and_start: spawning supervisor");
    sidecar::spawn_supervisor(app, state);
}
