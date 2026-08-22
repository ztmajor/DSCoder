use std::path::{Path, PathBuf};

use crate::state::Launch;

/// 应用数据根：Windows `%APPDATA%\DSCoder`，Linux `$XDG_DATA_HOME/DSCoder`
/// （回落 `~/.local/share/DSCoder`）。与 Tauri 按标识符生成的目录解耦，
/// 保证与设计文档/运行时安装位置一致。
pub fn app_data_root() -> PathBuf {
    if cfg!(windows) {
        if let Ok(appdata) = std::env::var("APPDATA") {
            if !appdata.is_empty() {
                return PathBuf::from(appdata).join("DSCoder");
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
pub fn resolve_launch(runtime_dir: &Path) -> Launch {
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

    // node：`where node` 优先；退而求其次 npm shim 同目录 node(.exe)。
    let node = std::env::var("DSH_NODE")
        .ok()
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            find("node").or_else(|| {
                find("dsh").and_then(|shim| {
                    shim
                        .parent()
                        .map(|prefix| prefix.join(if cfg!(windows) { "node.exe" } else { "node" }))
                })
            })
        });

    // JS 入口：专用安装 → 全局 shim 反推。
    let js = if dedicated.exists() {
        Some(dedicated)
    } else {
        find("dsh").and_then(|shim| {
            shim.parent().map(|prefix| {
                prefix
                    .join("node_modules")
                    .join("@deepseek-ai")
                    .join("dsh")
                    .join("lib")
                    .join("bin.js")
            })
        })
    }
    .filter(|p| p.exists());

    if let (Some(node), Some(js)) = (node, js) {
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
