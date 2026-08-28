#!/usr/bin/env node
/**
 * 生成本地发布的 updater 清单 latest.json（手动发 GitHub Release 时用）。
 * CI（.github/workflows/release.yml）里由 tauri-action 自动生成，本脚本用于本地/手动发布。
 *
 * 用法：
 *   node scripts/make-latest-json.mjs
 *   REPO=owner/repo TAG=v0.1.0 NOTES="修复 xx" node scripts/make-latest-json.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const conf = JSON.parse(
  readFileSync(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'),
);
const version = conf.version;
const productName = conf.productName;

const bundleDir = path.join(ROOT, 'src-tauri', 'target', 'release', 'bundle');
const installer = path.join(bundleDir, 'nsis', `${productName}_${version}_x64-setup.exe`);
const sigFile = `${installer}.sig`;

if (!existsSync(installer) || !existsSync(sigFile)) {
  console.error('找不到安装包或签名文件，请先运行 `pnpm tauri build`（需设置签名私钥环境变量）。');
  process.exit(1);
}

const signature = readFileSync(sigFile, 'utf8').trim();
const tag = process.env.TAG || `v${version}`;
const repo = process.env.REPO || 'ztmajor/DSCoder';
const installerName = path.basename(installer);

const manifest = {
  version,
  notes: process.env.NOTES || '',
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature,
      url: `https://github.com/${repo}/releases/download/${tag}/${installerName}`,
    },
  },
};

const out = path.join(bundleDir, 'latest.json');
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`已生成 ${out}`);
console.log(JSON.stringify(manifest, null, 2));
