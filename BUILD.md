# 构建与发布

本应用通过 **GitHub Releases + Tauri Updater** 分发 Windows 安装包并实现自动更新。
仓库：`ztmajor/DSCoder`（更新器端点已指向该仓库的 `latest.json`）。

## 前置条件

- Node.js + pnpm（前端与 Tauri CLI）
- Rust 工具链（`rustc` / `cargo`）
- 更新器签名私钥（构建 `createUpdaterArtifacts` 产物必需，缺失则构建失败）：

  | 环境变量 | 说明 |
  | --- | --- |
  | `TAURI_SIGNING_PRIVATE_KEY` | minisign 私钥内容（或文件路径，加 `file:` 前缀） |
  | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码 |

## 版本号升级

发布新版本需同步修改以下文件（当前为 `1.0.0`）：

- `package.json`（`version`）
- `src-tauri/Cargo.toml`（`version`）
- `src-tauri/tauri.conf.json`（`version`）
- `src-tauri/Cargo.lock`（根包 `dscoder` 的 `version`）
- `package-lock.json`（两处根 `version`）

> 注意：`src-tauri/src/provision.rs`、`scripts/prepare-runtime.mjs` 中的
> `DSH_VERSION = 0.1.1-rc.2` 是内嵌 dsh 运行时的版本，**不要**随应用版本改动。

## 本地构建

```powershell
# 设置签名环境变量后构建（含 NSIS 安装包 + .sig 签名文件）
$env:TAURI_SIGNING_PRIVATE_KEY = "..."
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "..."
pnpm tauri build
```

产物位于 `src-tauri/target/release/bundle/`：

- `nsis/dscoder_1.0.0_x64-setup.exe`
- `nsis/dscoder_1.0.0_x64-setup.exe.sig`

## 生成更新器清单 latest.json

本地构建不会自动生成 `latest.json`（CI 的 tauri-action 才会），手动发布时运行：

```powershell
# REPO 默认 ztmajor/DSCoder；TAG 默认 v{version}；NOTES 为更新说明
REPO=ztmajor/DSCoder TAG=v1.0.0 NOTES="正式版发布说明" node scripts/make-latest-json.mjs
```

生成 `src-tauri/target/release/bundle/latest.json`，内容包含版本、签名与下载 URL。

## 打标签并推送

```powershell
git add -A
git commit -m "发布 v1.0.0（正式版）"
git tag -a v1.0.0 -m "v1.0.0 - 正式版"
git push origin main
git push origin v1.0.0
```

> 若本地已有同名的 `v1.0.0` 标签需要重指向，先 `git tag -d v1.0.0` 再重新打。
> 若该标签此前已推送过，还需删除远端标签：`git push origin :refs/tags/v1.0.0`，
> 然后再 `git push origin v1.0.0`。

## 创建 GitHub Release

### 方式一：Web 界面

1. 打开 https://github.com/ztmajor/DSCoder/releases/new
2. **Tag** 选择 `v1.0.0`（或输入后自动创建）
3. **Release title** 填写：`v1.0.0 - 正式版`
4. 正文填写更新说明
5. 上传附件（把三个文件都拖进去）：
   - `dscoder_1.0.0_x64-setup.exe`
   - `dscoder_1.0.0_x64-setup.exe.sig`
   - `latest.json`
6. 点击 **Publish release**

### 方式二：gh CLI

```powershell
gh release create v1.0.0 `
  --title "v1.0.0 - 正式版" `
  --notes "正式版更新说明" `
  "src-tauri/target/release/bundle/nsis/dscoder_1.0.0_x64-setup.exe" `
  "src-tauri/target/release/bundle/nsis/dscoder_1.0.0_x64-setup.exe.sig" `
  "src-tauri/target/release/bundle/latest.json"
```

## 验证自动更新

发布后，客户端更新器会请求：

```
https://github.com/ztmajor/DSCoder/releases/latest/download/latest.json
```

GitHub 会把 `/releases/latest/download/<文件名>` 自动指向最新 Release 的同名资产，
因此只要 `latest.json` 上传成功，更新检查即可生效。可先在浏览器打开该 URL 确认返回最新清单。
