use std::sync::Arc;

use serde_json::{json, Value};

use crate::error::DshError;
use crate::state::SharedState;

/// 发送一个 unary RPC：信封 `{type:'client-request', rpcId, method, payload}`，
/// 响应 `{type:'server-response', rpcId, result:{ok,value}|{ok:false,error}}`。
/// 业务错误永远是 HTTP 200 + 信封；4xx/5xx 只表示载体层错误。
pub async fn rpc_raw(state: &Arc<SharedState>, method: &str, payload: &Value) -> Result<Value, DshError> {
    let base = state
        .base
        .read()
        .await
        .clone()
        .ok_or_else(DshError::not_ready)?;

    let body = json!({
        "type": "client-request",
        "rpcId": uuid::Uuid::new_v4().to_string(),
        "method": method,
        "payload": payload,
    });
    let url = format!("{}/api/{}", base.base_url, method);
    let resp = state
        .http
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| DshError::Transport {
            message: format!("请求 {url} 失败：{e}"),
        })?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| DshError::Transport {
        message: format!("读取响应失败：{e}"),
    })?;

    if !status.is_success() {
        let snippet: String = text.chars().take(200).collect();
        return Err(DshError::Http {
            status: status.as_u16(),
            message: snippet,
        });
    }

    let v: Value = serde_json::from_str(&text).map_err(|e| DshError::Transport {
        message: format!("响应不是合法 JSON：{e}"),
    })?;
    let result = v.get("result").cloned().unwrap_or(Value::Null);
    if result.get("ok").and_then(Value::as_bool) == Some(true) {
        return Ok(result.get("value").cloned().unwrap_or(Value::Null));
    }
    let err = result.get("error").cloned().unwrap_or_else(|| {
        json!({ "code": "internal", "message": "响应缺少错误详情", "details": {} })
    });
    Err(DshError::Business {
        code: err
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or("internal")
            .to_string(),
        message: err
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("未知业务错误")
            .to_string(),
        details: err.get("details").cloned().unwrap_or_else(|| json!({})),
    })
}
