use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};

use crate::paths;
use crate::sidecar;
use crate::state::{DshStatus, SharedState};

/// 目标运行时版本（fork 锁定）。
const DSH_VERSION: &str = "0.1.1-rc.2";
/// 底部信息栏插件的包名。
const DEFAULT_PLUGINS: &[&str] = &["dsh-bottom-info-bar", "dsh-ui-tweaks", "dsh-tabs-terminal"];

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

/// profile 的 `dsh.profile.bundles` 是否已登记插件。
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

/// FNV-1a 64 位哈希步进：把一段字节折叠进当前哈希（确定性，跨进程稳定，无外部 crate）。
fn fnv1a_mix(mut h: u64, bytes: &[u8]) -> u64 {
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;

/// 递归收集目录下所有文件路径。
fn collect_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in rd.flatten() {
        let p = entry.path();
        if p.is_dir() {
            collect_files(&p, out);
        } else if p.is_file() {
            out.push(p);
        }
    }
}

/// 源目录内容摘要：文件相对路径 + 文件内容共同参与，路径排序保证跨次稳定。
fn source_digest(dir: &Path) -> u64 {
    let mut files = Vec::new();
    collect_files(dir, &mut files);
    files.sort();
    let mut h = FNV_OFFSET;
    for f in files {
        let rel = f.strip_prefix(dir).unwrap_or(f.as_path());
        h = fnv1a_mix(h, rel.to_string_lossy().as_bytes());
        h = fnv1a_mix(h, &[0u8]);
        if let Ok(data) = std::fs::read(&f) {
            h = fnv1a_mix(h, &data);
        }
        h = fnv1a_mix(h, &[0u8]);
    }
    h
}

const DIGEST_MARKER: &str = ".dsh-source-digest";

/// 读取安装目录里已记录的源摘要（无记录返回 None）。
fn stored_digest(dir: &Path) -> Option<u64> {
    std::fs::read_to_string(dir.join(DIGEST_MARKER))
        .ok()
        .and_then(|s| s.trim().parse::<u64>().ok())
}

/// 把源摘要写回安装目录（失败静默：最坏情况是下次重拷一次，无副作用）。
fn store_digest(dir: &Path, digest: u64) {
    let _ = std::fs::write(dir.join(DIGEST_MARKER), digest.to_string());
}

/// 确保插件已安装进 web profile；缺失时复制内置产物并 `dsh plugin add`（幂等）。
async fn ensure_one_plugin(app: &AppHandle, state: &Arc<SharedState>, name: &str) -> Result<(), String> {
    eprintln!("[dscoder] ensure_one_plugin: enter name={}, registered={}", name, plugin_registered(name));
    
    // 1. 统一获取源目录。如果找不到，根据是否已登记决定是静默跳过还是报错。
    let Some(src) = locate_plugin_dir(app, name) else {
        if plugin_registered(name) {
            return Ok(()); // 无内置源但已登记，静默跳过
        }
        return Err(format!("找不到内置插件 {name}（资源缺失）"));
    };
    
    // 2. 确定目标安装目录
    let installed = plugin_install_dir(name);

    // 3. 源即安装目录（无独立内置源）→ 无需同步
    if src == installed {
        return Ok(());
    }

    if plugin_registered(name) {
        // --- 已注册：检查是否需要修复 (needs_heal) ---
        let mut needs_heal = false;

        // 3.1 检查产物是否缺失
        if !installed.join("lib").join("index.js").exists() 
            || !installed.join("lib").join("client.js").exists() 
        {
            needs_heal = true;
        }

        // 3.2 检查版本是否落后
        if !needs_heal && plugin_version(&installed) != plugin_version(&src) {
            needs_heal = true;
        }

        // 3.3 检查内容摘要是否变化 (作为版本检查的补充或兜底)
        if !needs_heal {
            let digest = source_digest(&src);
            if stored_digest(&installed) != Some(digest) {
                needs_heal = true;
            }
        }

        // 3.4 执行修复
        if needs_heal {
            eprintln!("[dscoder] ensure_plugin({name}): 产物缺失/版本落后/源内容变化，正在重拷至 {}", installed.display());
            copy_dir(&src, &installed).map_err(|e| format!("同步插件失败：{e}"))?;
            store_digest(&installed, source_digest(&src));
        }

        return Ok(());
    }

    // --- 4. 首次安装：复制 + plugin add ---
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
    eprintln!("[dscoder] ensure_plugin({name}): status=provisioning, src={}", src.display());

    // 复用外层已经获取的 src，无需再次调用 locate_plugin_dir
    copy_dir(&src, &installed).map_err(|e| format!("复制插件失败：{e}"))?;
    store_digest(&installed, source_digest(&src));
    eprintln!("[dscoder] ensure_plugin({name}): copied to {}", installed.display());

    // 准备并执行 plugin add 命令
    let bin = runtime_bin();
    let home = dsh_home();
    let args = vec![
        bin.display().to_string(),
        "plugin".to_string(),
        "--profile".to_string(),
        "web".to_string(),
        "add".to_string(),
        installed.display().to_string(),
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

    // 5. 校验安装结果
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
