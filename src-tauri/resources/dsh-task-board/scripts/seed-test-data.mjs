// dsh-task-board — 注入归档测试数据（用于验证归档页粘性年份/日期分组头部与序号排序）
// 用法（先停止 DSCoder，确保宿主进程未持有账本锁）：
//   node scripts/seed-test-data.mjs             追加 12 条跨年份（2024/2025/2026）固定数据
//   node scripts/seed-test-data.mjs 20          追加 20 条 2025 年随机日期数据
//   node scripts/seed-test-data.mjs --reset     清除全部 test- 数据后再追加 12 条跨年份数据
// 说明：向 ledger-v2.json 追加 status=done 的归档任务（archivedAt 秒级精度），
//       同日期的任务按出现顺序分配 archiveSeq 1/2/3…（验证同秒归档的序号排序）。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function dataDir() {
  const override = process.env.DSH_TASK_BOARD_DATA_DIR
  if (override && override.trim() !== '') return override.trim()
  // DSCoder 桌面应用的数据目录优先（其宿主进程以 %APPDATA%\DSCoder\dsh-home 为 DSH_HOME）
  if (process.platform === 'win32' && process.env.APPDATA) {
    const appData = join(process.env.APPDATA, 'DSCoder', 'dsh-home', 'task-board')
    if (existsSync(join(appData, 'ledger-v2.json'))) return appData
  }
  if (process.env.DSH_HOME && process.env.DSH_HOME.trim() !== '') return join(process.env.DSH_HOME.trim(), 'task-board')
  return join(homedir(), '.dsh', 'task-board')
}

const dir = dataDir()
const file = join(dir, 'ledger-v2.json')
if (!existsSync(file)) {
  console.error('ledger not found:', file)
  process.exit(1)
}
const doc = JSON.parse(readFileSync(file, 'utf8'))
if (doc.schemaVersion !== 2 || !Array.isArray(doc.tasks)) {
  console.error('unsupported ledger schema:', file)
  process.exit(1)
}

const args = process.argv.slice(2)
const wantReset = args.includes('--reset')
const numArg = args.map(Number).find((n) => Number.isInteger(n) && n > 0) || 0

// 清除旧的 test- 数据（仅 --reset）
if (wantReset) {
  const before = doc.tasks.length
  doc.tasks = doc.tasks.filter(function (t) { return !String(t.id || '').startsWith('test-') })
  const removed = before - doc.tasks.length
  if (removed > 0) console.log('已清除旧测试数据', removed, '条')
}

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min
const uuid = () => 'test-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)

// 现有 test- 数据的最大编号，新数据从 max+1 开始编号（追加不覆盖）
const maxNo = doc.tasks.reduce((acc, t) => {
  if (!String(t.id || '').startsWith('test-')) return acc
  const n = parseInt(String(t.title || '').replace(/[^0-9]/g, ''), 10)
  return Number.isInteger(n) && n > acc ? n : acc
}, 0)

// 数据源：无数量参数时用固定跨年份条目；有数量参数时仅生成 2025 年随机条目
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
function random2025Entry() {
  const m = rand(1, 12)
  const d = rand(1, DAYS_IN_MONTH[m - 1])
  return { y: 2025, m, d, fixed: [rand(0, 23), rand(0, 59), rand(0, 59)] }
}
let entries
if (numArg > 0) {
  entries = []
  for (let i = 0; i < numArg; i++) entries.push(random2025Entry())
} else {
  entries = [
    { y: 2024, m: 11, d: 2, fixed: null },
    { y: 2024, m: 12, d: 25, fixed: [10, 0, 0] },
    { y: 2024, m: 12, d: 25, fixed: [10, 0, 0] },
    { y: 2025, m: 1, d: 5, fixed: [9, 30, 0] },
    { y: 2025, m: 1, d: 5, fixed: [9, 30, 0] },
    { y: 2025, m: 5, d: 30, fixed: [14, 0, 0] },
    { y: 2025, m: 5, d: 30, fixed: [14, 0, 0] },
    { y: 2025, m: 8, d: 19, fixed: null },
    { y: 2026, m: 2, d: 14, fixed: null },
    { y: 2026, m: 3, d: 22, fixed: null },
    { y: 2026, m: 6, d: 12, fixed: null },
    { y: 2026, m: 7, d: 3, fixed: null },
  ]
}

const byDate = {}
const tasks = entries.map((e, i) => {
  const hms = e.fixed || [rand(0, 23), rand(0, 59), rand(0, 59)]
  const ts = new Date(e.y, e.m - 1, e.d, hms[0], hms[1], hms[2], 0).getTime()
  const key = e.y + '-' + e.m + '-' + e.d
  byDate[key] = (byDate[key] || 0) + 1
  const is2025Random = numArg > 0 && e.y === 2025 && e.fixed && entries.indexOf(e) >= entries.length - numArg
  return {
    id: uuid(),
    title: '测试归档-' + String(maxNo + i + 1).padStart(2, '0'),
    description: is2025Random
      ? '2025 随机归档数据（验证归档页日期分组与粘性日期头部）'
      : '跨年份测试数据（验证归档页粘性年份分组头部）',
    prompt: is2025Random
      ? '这是 2025 年随机测试归档任务 #' + (maxNo + i + 1) + '。'
      : '这是第 ' + (maxNo + i + 1) + ' 条跨年份测试归档任务。',
    status: 'done',
    createdAt: ts - 86400000,
    updatedAt: ts,
    executions: [],
    model: 'flash',
    reasoning: 'off',
    archivedAt: Math.floor(ts / 1000) * 1000,
    archiveSeq: byDate[key],
  }
})

doc.tasks = doc.tasks.concat(tasks)
doc.revision = (doc.revision || 0) + 1
writeFileSync(file, JSON.stringify(doc, null, 2), 'utf8')
const label = numArg > 0
  ? '已追加 ' + numArg + ' 条 2025 年随机归档测试数据'
  : '已追加 ' + tasks.length + ' 条跨年份（2024/2025/2026）归档测试数据'
console.log(label + '（编号 测试归档-' + String(maxNo + 1).padStart(2, '0') + ' 起）→', file)
