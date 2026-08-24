#!/usr/bin/env node
/**
 * 预置自包含运行时：把 Node 可执行文件与 dsh 运行时打进 src-tauri/resources/，
 * 供 `tauri build` 打包进安装包。幂等：产物已存在则跳过（--force 强制重做）。
 *
 * 用法：
 *   node scripts/prepare-runtime.mjs                # 复制本机 node.exe + 预置 dsh 运行时
 *   node scripts/prepare-runtime.mjs --force        # 全部重做
 *   node scripts/prepare-runtime.mjs --download-node # node.exe 改为下载官方 v24.19.0
 */
import { execFileSync, execSync } from 'node:child_process';
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RES = path.join(ROOT, 'src-tauri', 'resources');
const NODE_DIR = path.join(RES, 'node');
const NODE_EXE = path.join(NODE_DIR, 'node.exe');
const RUNTIME_DIR = path.join(RES, 'runtime');
const RUNTIME_ZIP = path.join(RUNTIME_DIR, 'dsh-runtime.zip');

const DSH_VERSION = '0.1.1-rc.2';
const NODE_VERSION = 'v24.19.0'; // 仅 --download-node 使用

const FORCE = process.argv.includes('--force');
const DOWNLOAD_NODE = process.argv.includes('--download-node');

const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';
const log = (msg) => console.log(`[prepare-runtime] ${msg}`);

function nodeOk() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 19);
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`);
  await pipeline(res.body, createWriteStream(dest));
}

function prepareNode() {
  if (!FORCE && existsSync(NODE_EXE)) {
    log('node.exe 已存在，跳过（--force 重做）。');
    return;
  }
  mkdirSync(NODE_DIR, { recursive: true });

  if (!DOWNLOAD_NODE) {
    if (!nodeOk()) {
      throw new Error(
        `本机 node ${process.versions.node} 低于 dsh 要求（^22.19 || >=24）；请升级 node，或加 --download-node。`,
      );
    }
    log(`复制本机 node.exe（${process.versions.node}）→ resources/node/`);
    copyFileSync(process.execPath, NODE_EXE);
    return;
  }

  const zip = path.join(tmpdir(), `node-${NODE_VERSION}-win-x64.zip`);
  const folder = `node-${NODE_VERSION}-win-x64`;
  return (async () => {
    if (!existsSync(zip)) {
      log(`下载官方 Node ${NODE_VERSION} win-x64 …`);
      await download(`https://nodejs.org/dist/${NODE_VERSION}/${folder}.zip`, zip);
    }
    const extractDir = mkdtempSync(path.join(tmpdir(), 'node-extract-'));
    try {
      execFileSync('tar.exe', ['-xf', zip, '-C', extractDir, `${folder}/node.exe`], {
        stdio: 'inherit',
      });
      copyFileSync(path.join(extractDir, folder, 'node.exe'), NODE_EXE);
    } finally {
      rmSync(extractDir, { recursive: true, force: true });
    }
    log(`node.exe 已就绪。`);
  })();
}

function prepareRuntime() {
  if (!FORCE && existsSync(RUNTIME_ZIP)) {
    log('dsh-runtime.zip 已存在，跳过（--force 重做）。');
    return;
  }
  mkdirSync(RUNTIME_DIR, { recursive: true });

  const staging = mkdtempSync(path.join(tmpdir(), 'dsc-runtime-'));
  try {
    log(`staging：pnpm add @deepseek-ai/dsh@${DSH_VERSION}（hoisted 布局）…`);
    // pnpm 10+ 默认忽略依赖 build 脚本并可能以退出码 1 结束；
    // 本项目原生模块（node-pty/koffi 等）走 prebuilds，无需 build，故容忍该退出码，靠下面校验兜底。
    try {
      execSync(`pnpm add @deepseek-ai/dsh@${DSH_VERSION} --node-linker=hoisted`, {
        stdio: 'inherit',
        cwd: staging,
      });
    } catch {
      // 退出码非 0 可能是 ERR_PNPM_IGNORED_BUILDS，继续；真正失败由下面 bin.js 校验拦截。
    }

    const bin = path.join(staging, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    if (!existsSync(bin)) {
      throw new Error('staging 失败：未找到 dsh/lib/bin.js。');
    }
    log('打包 node_modules → resources/runtime/dsh-runtime.zip …');
    execFileSync('tar.exe', ['-a', '-c', '-f', RUNTIME_ZIP, '-C', staging, 'node_modules'], {
      stdio: 'inherit',
    });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  log(`dsh-runtime.zip 大小：${mb(statSync(RUNTIME_ZIP).size)}`);
}

async function main() {
  log('准备 Node 运行时…');
  await prepareNode();
  log('准备 dsh 运行时…');
  prepareRuntime();
  log('完成。');
}

main().catch((e) => {
  console.error(`[prepare-runtime] 失败：${e.message}`);
  process.exit(1);
});
