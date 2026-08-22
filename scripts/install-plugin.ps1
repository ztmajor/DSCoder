# 安装 dsh-bottom-info-bar 插件到 DSCoder 的 web profile（幂等，可重复执行）
# 依赖：node、pnpm 均在 PATH 中；DSCoder 专用运行时已安装到 %APPDATA%\DSCoder\runtime
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$pluginSrc = Join-Path $root 'vendor\dsh-bottom-info-bar'
$data = Join-Path $env:APPDATA 'DSCoder'
$pluginDst = Join-Path $data 'plugins\dsh-bottom-info-bar'
$dshHome = Join-Path $data 'dsh-home'
$bin = Join-Path $data 'runtime\node_modules\@deepseek-ai\dsh\lib\bin.js'

if (-not (Test-Path $bin)) {
    Write-Error "未找到 DSCoder 专用运行时：$bin。请先安装 dsh 运行时（pnpm.cmd --dir $data\runtime add @deepseek-ai/dsh@0.1.1-rc.2）"
}

# 1) 构建插件 lib/（host.js → lib/index.js，client-bundle.js → lib/client.js）
node (Join-Path $pluginSrc 'scripts\build.mjs')

# 2) 复制构建产物到应用数据目录的稳定位置
Remove-Item $pluginDst -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $pluginDst | Out-Null
foreach ($f in 'package.json', 'cordis.patch.yml', 'README.md', 'LICENSE') {
    Copy-Item (Join-Path $pluginSrc $f) $pluginDst
}
Copy-Item (Join-Path $pluginSrc 'lib') $pluginDst -Recurse

# 3) 用专用运行时的 dsh plugin 命令安装进 web profile（init + pnpm link + 登记 bundles）
$env:DSH_HOME = $dshHome
node $bin plugin --profile web add $pluginDst

Write-Host ''
Write-Host '✔ dsh-bottom-info-bar 已安装。重启 DSCoder（或 dsh web）后底部信息栏生效。'
Write-Host "  验证：node $bin web --dump-config | Select-String dsh-bottom-info-bar"
