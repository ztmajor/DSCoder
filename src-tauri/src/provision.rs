use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};

use crate::paths;
use crate::sidecar;
use crate::state::{DshStatus, SharedState};

/// 目标运行时版本（fork 锁定）。
const DSH_VERSION: &str = "0.1.1-rc.2";
/// 默认内置插件清单（随应用打包、启动时幂等安装）。
const DEFAULT_PLUGINS: &[&str] = &["dsh-bottom-info-bar", "dsh-tabs-terminal"];

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

fn plugin_install_dir(name: &str) -> PathBuf {
    paths::app_data_root().join("plugins").join(name)
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

/// profile 的 `dsh.profile.bundles` 是否已登记某插件。
fn plugin_registered(name: &str) -> bool {
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
        .map(|arr| arr.iter().any(|v| v.as_str() == Some(name)))
        .unwrap_or(false)
}

/// 定位内置插件目录：优先应用资源，其次 dev 源码资源，最后已安装副本。
fn locate_plugin_dir(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let probe = |dir: &Path| -> bool {
        dir.join("package.json").exists() && dir.join("lib").join("index.js").exists()
    };

    if let Ok(res) = app.path().resource_dir() {
        let p = res.join(name);
        if probe(&p) {
            return Some(p);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(name);
    if probe(&dev) {
        return Some(dev);
    }
    let installed = plugin_install_dir(name);
    if probe(&installed) {
        return Some(installed);
    }
    None
}

/// 读取插件目录 package.json 的 version 字段（缺失/损坏返回 None）。
fn plugin_version(dir: &Path) -> Option<String> {
    let text = std::fs::read_to_string(dir.join("package.json")).ok()?;
    let json = serde_json::from_str::<serde_json::Value>(&text).ok()?;
    json.get("version").and_then(|v| v.as_str()).map(str::to_string)
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

/// 确保单个插件已安装进 web profile；缺失时复制内置产物并 `dsh plugin add`（幂等）。
async fn ensure_one_plugin(app: &AppHandle, state: &Arc<SharedState>, name: &str) -> Result<(), String> {
    eprintln!("[dscoder] ensure_plugin({name}): registered={}", plugin_registered(name));
    if plugin_registered(name) {
        // 已登记：产物缺失或版本落后时，用内置源覆盖安装副本（link 指向该目录，覆盖即生效）。
        let installed = plugin_install_dir(name);
        let mut needs_heal = !installed.join("lib").join("index.js").exists();
        if !needs_heal {
            if let Some(src) = locate_plugin_dir(app, name) {
                if plugin_version(&installed) != plugin_version(&src) {
                    needs_heal = true;
                }
            }
        }
        if needs_heal {
            if let Some(src) = locate_plugin_dir(app, name) {
                let _ = copy_dir(&src, &installed);
            }
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
            message: Some(format!("正在安装插件 {name}…")),
        },
    )
    .await;
    eprintln!("[dscoder] ensure_plugin({name}): status=provisioning");

    let src = locate_plugin_dir(app, name)
        .ok_or_else(|| format!("找不到内置插件 {name}（资源缺失）"))?;
    eprintln!("[dscoder] ensure_plugin({name}): src={}", src.display());
    copy_dir(&src, &plugin_install_dir(name)).map_err(|e| format!("复制插件失败：{e}"))?;
    eprintln!("[dscoder] ensure_plugin({name}): copied to {}", plugin_install_dir(name).display());

    let bin = runtime_bin();
    let home = dsh_home();
    let args = vec![
        bin.display().to_string(),
        "plugin".to_string(),
        "--profile".to_string(),
        "web".to_string(),
        "add".to_string(),
        plugin_install_dir(name).display().to_string(),
    ];
    eprintln!("[dscoder] ensure_plugin({name}): running plugin add: node {:?}", args);
    run_program(
        "node",
        &args,
        &[("DSH_HOME", home.to_str().unwrap_or_default())],
        "插件安装",
    )
    .await?;
    eprintln!("[dscoder] ensure_plugin({name}): plugin add done, registered={}", plugin_registered(name));

    if !plugin_registered(name) {
        return Err(format!("插件 {name} 安装后未在 web profile 生效"));
    }
    Ok(())
}

/// 确保全部默认插件已安装（逐个幂等）。
async fn ensure_plugins(app: &AppHandle, state: &Arc<SharedState>) -> Result<(), String> {
    for name in DEFAULT_PLUGINS {
        ensure_one_plugin(app, state, name).await?;
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
    eprintln!("[dscoder] ensure_and_start: ensure_plugins...");
    if let Err(e) = ensure_plugins(&app, &state).await {
        eprintln!("[dscoder] ensure_and_start: ensure_plugins ERROR: {e}");
        fatal(&app, &state, e).await;
        return;
    }
    eprintln!("[dscoder] ensure_and_start: spawning supervisor");
    sidecar::spawn_supervisor(app, state);
}
