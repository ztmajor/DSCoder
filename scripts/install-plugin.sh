#!/usr/bin/env bash
# 安装 dsh-bottom-info-bar 插件到 DSCoder 的 web profile（幂等，可重复执行）
# 依赖：node、pnpm 均在 PATH 中；DSCoder 专用运行时已安装到数据目录 runtime/
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_SRC="$ROOT/vendor/dsh-bottom-info-bar"

DATA="${XDG_DATA_HOME:-$HOME/.local/share}/DSCoder"
PLUGIN_DST="$DATA/plugins/dsh-bottom-info-bar"
DSH_HOME="$DATA/dsh-home"
BIN="$DATA/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js"

if [[ ! -f "$BIN" ]]; then
  echo "错误：未找到 DSCoder 专用运行时：$BIN" >&2
  echo "先安装：pnpm --dir $DATA/runtime add @deepseek-ai/dsh@0.1.1-rc.2" >&2
  exit 1
fi

# 1) 构建插件 lib/
node "$PLUGIN_SRC/scripts/build.mjs"

# 2) 复制构建产物到稳定位置
rm -rf "$PLUGIN_DST"
mkdir -p "$PLUGIN_DST"
for f in package.json cordis.patch.yml README.md LICENSE; do
  cp "$PLUGIN_SRC/$f" "$PLUGIN_DST/"
done
cp -R "$PLUGIN_SRC/lib" "$PLUGIN_DST/"

# 3) 用专用运行时的 dsh plugin 命令安装进 web profile
DSH_HOME="$DSH_HOME" node "$BIN" plugin --profile web add "$PLUGIN_DST"

echo ""
echo "✔ dsh-bottom-info-bar 已安装。重启 DSCoder（或 dsh web）后底部信息栏生效。"
echo "  验证：DSH_HOME=$DSH_HOME node $BIN web --dump-config | grep dsh-bottom-info-bar"
