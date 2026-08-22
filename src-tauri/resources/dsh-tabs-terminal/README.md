# dsh-tabs-terminal

DeepSeek Harness 的 IDE 式「文件树 + 标签页 + 终端」插件（静态 bundle 形态）。安装一次，每次打开 DSH 自动生效。

## 功能

1. **右侧文件树**：可折叠/拖拽调宽的目录树，懒加载子目录。
   - 根目录默认取当前 DSH 工作区目录；无工作区时回退到用户主目录。
   - 顶部「🗀 打开文件夹」按钮可切换根目录。
   - 文件夹前用**小箭头**指示：未展开时箭头指向文件夹（右向），展开时箭头转向下方。
   - 点击文件在标签页中打开；点击目录展开/折叠。
2. **顶部标签栏**：
   - 第一个「💬 聊天」标签**不可关闭**，点击回到官方对话界面。
   - 每个打开的文件各占一个**可关闭**标签，未保存修改时标签上显示「●」。
3. **可编辑文件查看**：文本文件可直接编辑并保存（`Ctrl+S` 或右上角「保存」按钮）。
   - 读取上限 4MB（超限只读前 4MB 并标记截断），拒绝二进制文件；写入上限 16MB。
   - 写入走原子写（临时文件 + rename），避免写坏。
4. **终端面板**：底部可切换的终端，快捷键 **Ctrl + `` ` ``**（与 VS Code 一致，反引号键）。
   - 使用 dsh 的 `subprocess.spawnTerminal`（node-pty）分配真实 PTY（Windows 走 ConPTY）。
   - 默认 shell：Windows 为 `powershell.exe`，其他平台为 `$SHELL` 或 `bash`。

## 形态

- host 半（`lib/index.js`）：注册 `/_dsh/dsh-tabs-terminal/*` HTTP 路由，负责
  终端 PTY 生命周期（start/write/read/kill）与本地文件读写（readFile/writeFile/listDir）。
- client 半（`lib/client.js`）：经 `window.__ModuleLoader__` 注入页面，注册到
  `shell.overlay` 槽，渲染 标签栏 / 文件树 / 可编辑查看 / 终端 / 目录选择器。

## 构建

```sh
node scripts/build.mjs   # 生成 lib/index.js 与 lib/client.js
```

## 说明 / 已知限制

- 终端输出通过 120ms 轮询 `termRead` 拉取（非 SSE），少量延迟可接受。
- 目录树懒加载，不做整树递归（超大目录按需展开）。
- 文件编辑为纯文本；编辑器使用受控 `<textarea>`，超大文件（接近 4MB）编辑可能卡顿。
- 终端面板尺寸固定（cols 按宽度估算、rows 24）；`SubprocessTerminalHandle` 未暴露 resize。
- 本插件作为 DSCoder 桌面「默认插件」冻结，不检查上游 npm 更新。
