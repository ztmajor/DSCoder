# DSCoder

> 干净的 AI 编码壳 —— Tauri 桌面版 DeepSeek Harness。

主要供我个人日常使用；如果你觉得这个挺好，欢迎取用。

## 界面预览

| 主界面 | 主界面 |
| :---: | :---: |
| ![界面1](assets/ui1.png) | ![界面2](assets/ui2.png) |

| 代码高亮 | 本地版本管理 |
| :---: | :---: |
| ![代码高亮](assets/highlight.png) | ![本地版本管理](assets/local-version-manage.png) |

## 特性

- **秒级启动**：Tauri 2 桌面壳，不做自绘臃肿前端，直接复用 DeepSeek Harness 官方 Web UI 的完整能力。
- **内置终端**：真实 PTY（`Ctrl + \`` 呼出），终端优先的编码体验。
- **DeepSeek 驱动**：模型、会话、工作区、工具、审批等全部能力由 dsh 提供，DSCoder 只做「干净的壳」。
- **开箱即用**：内置文件树 / 标签页 / 终端、余额信息栏、本地版本管理等插件，首次启动自动装好。
- **自包含**：安装包内嵌 Node + dsh 运行时，目标机器免装 Node、免联网即可运行。
- **自动更新**：GitHub Releases 驱动，发现新版弹窗提示，一键更新并自动重启。
- **干净隔离**：运行时与数据全部收进独立目录，不碰你全局的 dsh（vibe coding 用的那个互不影响）。

## 工作原理

DSCoder 是一个 Tauri 2（Rust）桌面壳：把 DeepSeek Harness（dsh）作为 sidecar 子进程拉起（`dsh web --port 0 --no-open`），等它就绪后把窗口导航到官方 Web UI（同源加载，天然通过 dsh 的鉴权栅栏）。Rust 侧只负责：

- **运行时自动供给**：安装包内嵌 `@deepseek-ai/dsh`（锁定 `0.1.1-rc.2`），首次启动自动解压到应用数据目录；仅开发态才联网下载。
- **进程监督**：端口发现、健康探活、崩溃退避重启、退出联动。
- **配置与凭证**：完全交给官方 UI，写入 `$DSH_HOME` 下的 `settings.yaml` 与 `.credentials.yaml`。
- **自动更新**：后台检查 GitHub Releases，原生对话框确认后下载安装并重启。

## 项目结构

```
src-tauri/
  src/                 Rust 后端（进程监督、供给、代理、路径解析）
  resources/           内置 dsh 插件（存在即注册）
    dsh-tabs-terminal/
    dsh-bottom-info-bar/
    dsh-local-git/
    dsh-ui-tweaks/
  tauri.conf.json      Tauri 配置
dist/                  启动占位页（内核就绪后跳转到官方 UI）
docs/                  设计与分析文档
scripts/               构建/发布脚本（预置运行时、生成 updater 清单）
```

## 构建与发布

自包含打包与 GitHub Releases 自动更新，详见 [BUILD.md](BUILD.md)。

## 感谢

本项目参考并感谢以下开源项目：

- [songoao25/dsh-bottom-info-bar](https://github.com/songoao25/dsh-bottom-info-bar) —— 内置底部信息栏插件
- [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) —— 侧边栏 / 文件树布局参考
- [wlj521/dsh-ui-tweaks](https://github.com/wlj521/dsh-ui-tweaks) —— 界面调整插件

## License

[Apache License 2.0](LICENSE)
