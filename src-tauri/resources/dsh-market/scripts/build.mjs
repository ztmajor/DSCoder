// scripts/build.mjs — 从 src/ 重新生成 lib/（对标 dsh-ui-settings 的 scripts/build.mjs）
//
// host：esbuild 把 src/host/ 的 29 个模块打包成单个 lib/index.js
//       —— 相对 import 全部内联，js-yaml（../../script-deps/js-yaml.mjs）一并内联，
//          node:* 内建模块保持外部；动态 import(变量) 原样保留。
// client：src/client-bundle.js → lib/client.js（原样复制）。
//
// 依赖：esbuild（devDependency）——在 dsh-market 目录先运行 `npm install`。
import { build } from 'esbuild'
import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const libDir = join(root, 'lib')

await rm(libDir, { recursive: true, force: true })
await mkdir(libDir, { recursive: true })

// 1) host：单文件 bundle
await build({
  entryPoints: [join(root, 'src', 'host', 'index.js')],
  outfile: join(libDir, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  external: ['node:*'],
  legalComments: 'inline',
  logLevel: 'warning',
})

// 2) client：原样复制
await cp(join(root, 'src', 'client-bundle.js'), join(libDir, 'client.js'))

console.log('build OK → lib/index.js, lib/client.js')
