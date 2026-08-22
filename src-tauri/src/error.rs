use serde::Serialize;
use thiserror::Error;

/// 跨 IPC 的统一错误类型：tauri 命令的 `Err` 必须可序列化，
/// 前端按 `kind` 分支处理（与 docs/dsh-p0-design.md §2 一致）。
#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum DshError {
    /// dsh web 尚未就绪（sidecar 未启动或端口未发现）。
    #[error("dsh 尚未就绪：{message}")]
    NotReady { message: String },

    /// 网络层错误（连接拒绝、超时、响应体损坏等）。
    #[error("网络错误：{message}")]
    Transport { message: String },

    /// HTTP 载体错误（415/400/404/500 等；业务错误永远是 200 + 信封）。
    #[error("HTTP {status}：{message}")]
    Http { status: u16, message: String },

    /// dsh 业务错误，`code/message/details` 原样透传（RpcError 字面量全集见
    /// packages/host/apiproxy/src/api/rpc.schema.ts）。
    #[error("[{code}] {message}")]
    Business {
        code: String,
        message: String,
        details: serde_json::Value,
    },

    /// 参数或本地文件错误。
    #[error("参数错误：{message}")]
    Invalid { message: String },
}

impl DshError {
    pub fn not_ready() -> Self {
        Self::NotReady {
            message: "dsh web 尚未就绪".into(),
        }
    }
}
