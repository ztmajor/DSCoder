# 构建与发布

DSCoder 打包成**自包含**的 Windows 安装包：内嵌 Node 运行时 + 预置 dsh 运行时，目标机器**无需安装 Node/pnpm、无需联网**即可运行。更新走 GitHub Releases + 内置自动更新。

## 环境要求（仅构建机需要）

- Node.js `^22.19 || >=24`
- pnpm
- Rust 工具链（`x86_64-pc-windows-msvc`）+ Tauri 2 系统依赖（Windows 需 WebView2、MSVC 构建工具）

## 本地构建

```powershell
# 国内网络：设置 GitHub 镜像（否则打包工具 WiX/NSIS 下载超时）
$env:TAURI_BUNDLER_TOOLS_GITHUB_MIRROR_TEMPLATE = "https://ghproxy.net/https://github.com/<owner>/<repo>/releases/download/<version>/<asset>"

# 设置签名私钥（生成 updater 产物 latest.json / .sig 用）
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content "$env:USERPROFILE\.tauri\dscoder.key" -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content "$env:USERPROFILE\.tauri\dscoder.key.password" -Raw).Trim()

pnpm tauri build
```

产物在 `src-tauri/target/release/bundle/`：
- `nsis/dscoder_<version>_x64-setup.exe`（推荐，NSIS 安装包）
- `msi/dscoder_<version>_x64_en-US.msi`
- 同名 `.sig` 签名文件（自动更新校验用）

`tauri build` 会自动先跑 `scripts/prepare-runtime.mjs`，下载/预置内嵌 Node 与 dsh 运行时（幂等，产物已存在则跳过）。

## 签名密钥

自动更新用 Ed25519 签名保证更新包完整性。密钥对由 `pnpm tauri signer generate` 生成，保存在：

| 文件 | 内容 |
| --- | --- |
| `~/.tauri/dscoder.key` | 私钥（**保密**） |
| `~/.tauri/dscoder.key.pub` | 公钥（已写入 `tauri.conf.json` 的 `plugins.updater.pubkey`） |
| `~/.tauri/dscoder.key.password` | 私钥密码（**保密**） |

> 丢失私钥或密码将无法再签发更新包，需重新生成并更新公钥。

## 发布（GitHub Releases + 自动更新）

### 方式一：GitHub Actions（推荐）

1. 在仓库 `Settings → Secrets and variables → Actions` 添加两个 secret：
   - `TAURI_SIGNING_PRIVATE_KEY`：`~/.tauri/dscoder.key` 的文件内容
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：`~/.tauri/dscoder.key.password` 的文件内容
2. 打 tag 并推送，自动构建、发 Release、生成 `latest.json`：

```sh
git tag v0.1.0
git push origin v0.1.0
```

工作流 `.github/workflows/release.yml` 会构建 NSIS/MSI 安装包、生成 updater 产物并上传到 GitHub Release（草稿，需手动点发布）。用户下次启动应用时会收到更新提示。

### 方式二：手动发布

```sh
# 1. 本地构建（见上）
# 2. 生成 latest.json
node scripts/make-latest-json.mjs
# 3. 上传到 Release（把 v0.1.0 换成实际 tag）
gh release create v0.1.0 \
  src-tauri/target/release/bundle/nsis/dscoder_0.1.0_x64-setup.exe \
  src-tauri/target/release/bundle/nsis/dscoder_0.1.0_x64-setup.exe.sig \
  src-tauri/target/release/bundle/latest.json
```

## 自包含原理

- `scripts/prepare-runtime.mjs` 在构建时把 Node（`node.exe`）和 dsh 运行时（`node_modules` 打成 `dsh-runtime.zip`）放进 `src-tauri/resources/`。
- 运行时：应用优先用内置 `node.exe` 运行内置运行时；首次启动从 `dsh-runtime.zip` 解压到 `%APPDATA%\DSCoder\runtime`（离线，无需下载）。
- 仅在开发态（无内置包）才回退到联网 `pnpm add` 安装。
