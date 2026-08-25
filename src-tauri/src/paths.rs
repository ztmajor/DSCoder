use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::state::Launch;

/// Windows 短路径（8.3 短名），消除路径中的空格。
/// dsh 0.1.1-rc.2 的 `plugin add` 会把含空格路径（如 `C:\Users\gentle zhou\...`）
/// 在空格处拆断，写坏 profile 的 `link:` 依赖。用短路径（`C:\Users\GENTLE~1\...`）
/// 规避。非 Windows 或获取失败时原样返回。
#[cfg(windows)]
fn short_path(p: &Path) -> PathBuf {
    use std::ffi::OsString;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    let wide: Vec<u16> = p.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut buf = vec![0u16; wide.len() + 64];
    unsafe {
        let len = GetShortPathNameW(wide.as_ptr(), buf.as_mut_ptr(), buf.len() as u32);
        if len > 0 && (len as usize) < buf.len() {
            return PathBuf::from(OsString::from_wide(&buf[..len as usize]));
        }
    }
    p.to_path_buf()
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GetShortPathNameW(lpszLongPath: *const u16, lpszShortPath: *mut u16, cchBuffer: u32) -> u32;
}

#[cfg(not(windows))]
fn short_path(p: &Path) -> PathBuf {
    p.to_path_buf()
}

/// 应用数据根：Windows `%APPDATA%\DSCoder`，Linux `$XDG_DATA_HOME/DSCoder`
/// （回落 `~/.local/share/DSCoder`）。与 Tauri 按标识符生成的目录解耦，
/// 保证与设计文档/运行时安装位置一致。
/// Windows 下返回短路径，规避 dsh 对含空格路径的处理缺陷。
pub fn app_data_root() -> PathBuf {
    if cfg!(windows) {
        if let Ok(appdata) = std::env::var("APPDATA") {
            if !appdata.is_empty() {
                return short_path(&PathBuf::from(appdata).join("DSCoder"));
            }
        }
    } else {
        if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
            if !xdg.is_empty() {
                return PathBuf::from(xdg).join("DSCoder");
            }
        }
        if let Ok(home) = std::env::var("HOME") {
            if !home.is_empty() {
                return PathBuf::from(home).join(".local").join("share").join("DSCoder");
            }
        }
    }
    // 最后兜底：当前目录下的隐藏数据目录（保证有确定位置可写）。
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".dscoder-data")
}

/// 解析 dsh 启动命令。JS 入口候选顺序：
/// 1. `DSH_JS`（+ 可选 `DSH_NODE`）——显式覆盖；
/// 2. `<runtime_dir>/node_modules/@deepseek-ai/dsh/lib/bin.js`——数据目录下的
///    专用安装（自动优先，与 vibe coding 的全局 dsh 互不干扰）；
/// 3. `where/which dsh` 的 npm shim 反推（全局安装，兜底）。
/// node 可执行文件：`DSH_NODE` → `where/which node` 第一条存在路径 → shim 同目录
/// node(.exe)。均失败时兜底裸 `dsh`（仅 Unix 下 npm 的 sh 脚本可直接 exec）。
/// 内嵌资源路径：dev 源码 `resources/` 优先，打包后 `resource_dir` 兜底。
/// `rel` 为相对 `resources/` 的路径（如 `node/node.exe`）。
pub fn embedded_resource(app: &AppHandle, rel: &str) -> Option<PathBuf> {
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(rel);
    if dev.exists() {
        return Some(dev);
    }
    if let Ok(res) = app.path().resource_dir() {
        // Windows 上 resource_dir() 返回 exe 所在目录，资源实际位于其 `resources/` 子目录。
        let in_sub = res.join("resources").join(rel);
        if in_sub.exists() {
            return Some(in_sub);
        }
        let direct = res.join(rel);
        if direct.exists() {
            return Some(direct);
        }
    }
    None
}

pub fn resolve_launch(app: &AppHandle, runtime_dir: &Path) -> Launch {
    let dedicated = runtime_dir
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh")
        .join("lib")
        .join("bin.js");

    if let Ok(js) = std::env::var("DSH_JS") {
        let node = std::env::var("DSH_NODE").unwrap_or_else(|_| "node".into());
        return Launch {
            program: node,
            prefix: vec![js],
        };
    }

    let find = |name: &str| -> Option<PathBuf> {
        let which = if cfg!(windows) { "where" } else { "which" };
        let output = std::process::Command::new(which).arg(name).output().ok()?;
        if !output.status.success() {
            return None;
        }
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(PathBuf::from)
            .find(|p| p.exists())
    };

    // node 优先级：DSH_NODE → 内嵌 node.exe → where node → npm shim 同目录 node(.exe)。
    // 内嵌 node.exe 保证目标机无需安装 Node。
    let embedded_node = embedded_resource(app, "node/node.exe");
    let node = std::env::var("DSH_NODE")
        .ok()
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| embedded_node.clone())
        .or_else(|| {
            find("node").or_else(|| {
                find("dsh").and_then(|shim| {
                    shim
                        .parent()
                        .map(|prefix| prefix.join(if cfg!(windows) { "node.exe" } else { "node" }))
                })
            })
        });

    // JS 入口：始终用专用安装的 bin.js；ensure_runtime 会在 spawn 前把它创建好（解压或 pnpm 安装）。
    // 不再回退全局 dsh——否则"全新机器首次启动时专用运行时尚未解压、全局 dsh 又不存在"会导致启动失败。
    let js = dedicated;

    if let Some(node) = node {
        if node.exists() {
            return Launch {
                program: node.to_string_lossy().into_owned(),
                prefix: vec![js.to_string_lossy().into_owned()],
            };
        }
    }

    Launch {
        program: "dsh".into(),
        prefix: Vec::new(),
    }
}
