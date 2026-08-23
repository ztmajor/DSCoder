# dsh-local-git

DeepSeek Harness 的本地快照版本管理插件（无需云端 git 仓库）。

## 功能

1. **本地快照仓库**：在工作区根目录创建 `.dsh-git/`，内容寻址存储每次提交的文件快照。
   - 与真实 `.git` 完全隔离，**不影响 GitHub/Gitee 等任何现有 git 仓库**。
2. **行级 diff 着色**：相对上一次提交，当前文件的改动按行标注 ——
   - 新增行：绿色
   - 删除行：红色（行内 gutter 标记 + 底部面板完整显示）
   - 修改行：蓝色
3. **底部可展开面板**：改动文件列表（绿/红/蓝状态）、逐文件 diff、提交信息输入框 + 提交按钮、提交历史与回退。
4. **保存与提交分离**：`Ctrl+S` / 保存按钮只写盘，默认**不**提交；提交需点击「提交」并填写信息。
5. **AI 修改完成后提示提交**：AI 每轮回复结束（`sessionStats` 投影稳定）后，若工作区有改动则提示提交；可开启「AI 修改后自动提交」，用默认信息自动提交，方便回退。

## 存储结构（工作区根目录 `.dsh-git/`）

```
.dsh-git/
  config.json          # 版本管理启用标记与元信息
  HEAD                 # 当前提交 id（或 "empty"）
  objects/<sha256>     # 文件内容（内容寻址）
  commits/<id>/meta.json   # { id, ts, message, parent }
  commits/<id>/tree.json   # { relPath: { hash, size } }
```

## 忽略规则

遍历工作区时自动跳过：`.git`、`.dsh-git`、`node_modules`、`dist`、`target`、`.next`、
`.nuxt`、`.cache`、`build`、`out`、`__pycache__`、`.venv`、`venv`、各类测试/打包缓存，
以及二进制文件和超过 4MB 的文件。

## 构建

```sh
node scripts/build.mjs   # 生成 lib/index.js 与 lib/client.js
```

## 已知限制

- 快照为纯文本内容寻址存储（无压缩、无增量），大文件/大仓库提交体积较大。
- 行级 diff 对超过 1MB 或 2 万行的文件降级为「仅标记整文件已修改」。
- 单机单用户场景，未做并发提交的加锁。
