// dsh-ui-settings — host half（静态 bundle 形态）
// 业务：对话界面调整（消息字体/代码字号/行高/表格样式/对话框宽度）+ 对话时间线投影 + 文本调节快捷键
// 持久化：~/.dsh/dsh-ui-settings/config.json（可用 DSH_UI_SETTINGS_DATA_DIR 覆盖目录）
// RPC：webServer HTTP 路由 /_dsh/dsh-ui-settings/<method>（JSON 进出，同源防护）
// 依赖：可选服务 webServer（ctx.inject 等待）、sessionProjections（ctx.inject 等待）
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DATA_DIR = process.env.DSH_UI_SETTINGS_DATA_DIR || join(homedir(), '.dsh', 'dsh-ui-settings')
const DATA_FILE = join(DATA_DIR, 'config.json')

// ---------- 配置默认值与边界 ----------
const DEFAULTS = {
  fontSize: 16,
  codeFontSize: 13,
  lineHeight: 16,
  tableStyle: 'default',
  dialogWidth: 748,
  timelineEnabled: false,
  usageQuotaEnabled: true,
  zoomInShortcut: ['Control', '='],
  zoomOutShortcut: ['Control', '-'],
  uiOpacity: 100,
}

const LIMITS = {
  fontSize: { min: 10, max: 32 },
  codeFontSize: { min: 8, max: 32 },
  lineHeight: { min: 0, max: 64 },
  dialogWidth: { min: 600, max: 1600 },
  uiOpacity: { min: 50, max: 100 },
}

const NUMERIC_FIELDS = ['fontSize', 'codeFontSize', 'lineHeight', 'dialogWidth', 'uiOpacity']
const SHORTCUT_FIELDS = ['zoomInShortcut', 'zoomOutShortcut']
const ALL_FIELDS = ['fontSize', 'codeFontSize', 'lineHeight', 'tableStyle', 'dialogWidth', 'timelineEnabled', 'usageQuotaEnabled', 'zoomInShortcut', 'zoomOutShortcut', 'uiOpacity']

function clampNumber(field, value) {
  const limit = LIMITS[field]
  if (!limit) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(limit.max, Math.max(limit.min, Math.round(value)))
}

// ---------- 组合键（文本调节快捷键）校验 ----------
// 规则（安全边界，客户端与主机端保持一致）：
// - 1–3 个键；必须包含 ≥1 个修饰键（Control/Shift/Alt/Meta），触发键（非修饰键）恰好 1 个
// - 修饰键去重并规范化到固定顺序（Control/Shift/Alt/Meta），触发键位于最后
// - 触发键白名单：字母/数字/常见符号/F1–F12/少量命名键；Escape 与未知键一律拒绝
const SHORTCUT_MODIFIERS = ['Control', 'Shift', 'Alt', 'Meta']
const SHORTCUT_NAMED_KEYS = ['Space', 'Enter', 'Tab', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
const SHORTCUT_SYMBOLS = '`~!@#$%^&*()-_=+[]{};:\'",<.>/?\\|'

function normalizeShortcutToken(token) {
  if (typeof token !== 'string' || token.length === 0) return null
  if (token === ' ') return 'Space'
  if (token.length === 1) {
    if (/^[a-z]$/i.test(token)) return token.toUpperCase()
    if (/^[0-9]$/.test(token)) return token
    if (SHORTCUT_SYMBOLS.indexOf(token) !== -1) return token
    return null
  }
  if (/^F([1-9]|1[0-2])$/.test(token)) return token
  if (SHORTCUT_NAMED_KEYS.indexOf(token) !== -1) return token
  return null
}

function validateShortcut(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) return null
  const mods = []
  const triggers = []
  for (const raw of value) {
    if (typeof raw !== 'string') return null
    const token = raw.trim()
    if (SHORTCUT_MODIFIERS.indexOf(token) !== -1) {
      if (mods.indexOf(token) !== -1) return null
      mods.push(token)
    } else {
      const normalized = normalizeShortcutToken(token)
      if (normalized === null) return null
      triggers.push(normalized)
    }
  }
  if (mods.length === 0 || triggers.length !== 1) return null
  return SHORTCUT_MODIFIERS.filter((m) => mods.indexOf(m) !== -1).concat(triggers[0])
}

function sameShortcut(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// 读取落盘配置；损坏/缺失一律回退默认，绝不崩溃
function loadConfig() {
  try {
    if (!existsSync(DATA_FILE)) return Object.assign({}, DEFAULTS)
    const parsed = JSON.parse(readFileSync(DATA_FILE, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return Object.assign({}, DEFAULTS)
    const out = Object.assign({}, DEFAULTS)
    for (const field of NUMERIC_FIELDS) {
      const clamped = clampNumber(field, parsed[field])
      if (clamped !== null) out[field] = clamped
    }
    if (parsed.tableStyle === 'claude' || parsed.tableStyle === 'default') out.tableStyle = parsed.tableStyle
    if (typeof parsed.timelineEnabled === 'boolean') out.timelineEnabled = parsed.timelineEnabled
    if (typeof parsed.usageQuotaEnabled === 'boolean') out.usageQuotaEnabled = parsed.usageQuotaEnabled
    const zoomIn = validateShortcut(parsed.zoomInShortcut)
    if (zoomIn !== null) out.zoomInShortcut = zoomIn
    const zoomOut = validateShortcut(parsed.zoomOutShortcut)
    if (zoomOut !== null) out.zoomOutShortcut = zoomOut
    // 防御手工改坏的配置：两个快捷键相同会让按键永远只走“增大”分支，回退为默认
    if (sameShortcut(out.zoomInShortcut, out.zoomOutShortcut)) {
      out.zoomOutShortcut = DEFAULTS.zoomOutShortcut.slice()
    }
    return out
  } catch {
    return Object.assign({}, DEFAULTS)
  }
}

function flushConfig(config) {
  try {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
    const tmp = DATA_FILE + '.tmp'
    writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 })
    renameSync(tmp, DATA_FILE)
  } catch (err) {
    console.warn('[dsh-ui-settings] 配置落盘失败', String((err && err.message) || err))
  }
}

export default {
  inject: [],
  apply(ctx) {
    let config = loadConfig()
    let revision = 0

    function snapshot() {
      return { writable: true, value: Object.assign({}, config), revision }
    }

    // ---------- 同源防护（与官方 client RPC 一致） ----------
    function sameOrigin(req) {
      const fetchSite = req.headers['sec-fetch-site']
      if (fetchSite === 'cross-site') return false
      const origin = req.headers.origin
      if (origin === undefined) return fetchSite === 'same-origin' || fetchSite === 'same-site' || fetchSite === 'none'
      const host = req.headers.host
      if (host === undefined) return false
      try {
        const parsed = new URL(origin)
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host
      } catch {
        return false
      }
    }

    function readBody(req, maxBytes) {
      return new Promise(function (resolve, reject) {
        const chunks = []
        let size = 0
        req.on('data', function (chunk) {
          size += chunk.length
          if (size > maxBytes) {
            const err = new Error('body too large')
            err.status = 413
            reject(err)
            req.destroy()
            return
          }
          chunks.push(chunk)
        })
        req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')) })
        req.on('error', reject)
      })
    }

    function respond(res, status, payload) {
      const body = JSON.stringify(payload)
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
      })
      res.end(body)
    }

    // ---------- RPC 方法 ----------
    function rpcGetConfig() {
      return snapshot()
    }

    function rpcSetField(args) {
      const field = args && typeof args === 'object' ? args.field : null
      const value = args && typeof args === 'object' ? args.value : undefined
      if (typeof field !== 'string' || ALL_FIELDS.indexOf(field) === -1) {
        const err = new Error('unknown field: ' + field)
        err.status = 400
        throw err
      }
      if (NUMERIC_FIELDS.indexOf(field) !== -1) {
        const clamped = clampNumber(field, value)
        if (clamped === null) {
          const err = new Error('invalid value for field: ' + field)
          err.status = 400
          throw err
        }
        config[field] = clamped
      } else if (field === 'tableStyle') {
        config.tableStyle = value === 'claude' ? 'claude' : 'default'
      } else if (field === 'timelineEnabled') {
        config.timelineEnabled = !!value
      } else if (field === 'usageQuotaEnabled') {
        config.usageQuotaEnabled = !!value
      } else if (SHORTCUT_FIELDS.indexOf(field) !== -1) {
        const validated = validateShortcut(value)
        if (validated === null) {
          const err = new Error('invalid shortcut for field: ' + field)
          err.status = 400
          throw err
        }
        const otherField = field === 'zoomInShortcut' ? 'zoomOutShortcut' : 'zoomInShortcut'
        if (sameShortcut(validated, config[otherField])) {
          const err = new Error('shortcut conflict')
          err.status = 400
          throw err
        }
        config[field] = validated
      }
      revision += 1
      flushConfig(config)
      return snapshot()
    }

    function rpcUnsetField(args) {
      const field = args && typeof args === 'object' ? args.field : null
      if (typeof field !== 'string' || ALL_FIELDS.indexOf(field) === -1) {
        const err = new Error('unknown field: ' + field)
        err.status = 400
        throw err
      }
      // 注意：快捷键字段的 unset 不做冲突校验——设置面板「恢复默认」需要能同时恢复两个
      // 快捷键，若其中一方恰为对方默认值，冲突检查会让恢复永远失败；两个都恢复后必互不相同。
      // 运行中短暂相同仅导致热键按「增大」优先，重启后 loadConfig 兜底修复。
      config[field] = DEFAULTS[field]
      revision += 1
      flushConfig(config)
      return snapshot()
    }

    // 快捷键触发的原子调整：主机端对三个字段统一 +delta/-delta 并各自夹紧，
    // 每次按键一个请求、按到达顺序逐个应用，连按不会互相覆盖
    function rpcAdjust(args) {
      const delta = args && typeof args === 'object' ? args.delta : undefined
      if (delta !== 2 && delta !== -2) {
        const err = new Error('invalid delta')
        err.status = 400
        throw err
      }
      const fields = ['fontSize', 'codeFontSize', 'lineHeight']
      let changed = false
      for (const field of fields) {
        const next = clampNumber(field, config[field] + delta)
        if (next !== null && next !== config[field]) {
          config[field] = next
          changed = true
        }
      }
      if (changed) {
        revision += 1
        flushConfig(config)
      }
      return snapshot()
    }

    const ROUTE_PREFIX = '/_dsh/dsh-ui-settings'
    const ROUTES = { getConfig: rpcGetConfig, setField: rpcSetField, unsetField: rpcUnsetField, adjust: rpcAdjust }
    const MUTATING = { setField: true, unsetField: true, adjust: true }

    ctx.inject(['webServer'], function (webCtx) {
      webCtx.effect(function () {
        const dispose = webCtx.webServer.register({
          kind: 'prefix',
          path: ROUTE_PREFIX,
          handler: async function (req, res) {
            try {
              const url = new URL(req.url || '/', 'http://localhost')
              const path = url.pathname
              if (!path.startsWith(ROUTE_PREFIX + '/')) {
                respond(res, 404, { error: 'not found' })
                return
              }
              const method = decodeURIComponent(path.slice(ROUTE_PREFIX.length + 1))
              const fn = Object.hasOwn(ROUTES, method) ? ROUTES[method] : null
              if (typeof fn !== 'function') {
                respond(res, 404, { error: 'unknown method: ' + method })
                return
              }
              if (Object.hasOwn(MUTATING, method) && !sameOrigin(req)) {
                respond(res, 403, { error: 'cross-origin request rejected' })
                return
              }
              let args = {}
              if (req.method === 'POST' || req.method === 'PUT') {
                const raw = await readBody(req, 64 * 1024)
                if (raw.length > 0) {
                  try { args = JSON.parse(raw) } catch (e) { respond(res, 400, { error: 'invalid JSON body' }); return }
                }
              }
              const result = fn(args)
              respond(res, 200, result)
            } catch (err) {
              const status = (err && err.status) || 500
              respond(res, status, { error: status === 500 ? 'internal error' : String((err && err.message) || err) })
            }
          },
        })
        return function () { dispose() }
      }, 'dsh-ui-settings: Web routes')
    })

    // ---------- 对话时间线投影（host 半）：仅折叠用户直接发送的消息 ----------
    const TIMELINE_PROJECTION_KEY = 'dshChatTimeline'
    const MAX_TEXT_CHARS = 240

    function textOf(content) {
      if (!Array.isArray(content)) return ''
      let out = ''
      for (const block of content) {
        if (block !== null && typeof block === 'object') {
          const record = block
          if (record.type === 'text' && typeof record.text === 'string') out += record.text
        }
      }
      return out.trim().slice(0, MAX_TEXT_CHARS)
    }

    // wire-schema shim：投影值为纯 JSON，注册表只调用 parse
    const messageIndexSchema = { parse: (value) => value }

    const timelineProjectionDefinition = {
      key: TIMELINE_PROJECTION_KEY,
      stateSchema: messageIndexSchema,
      init: () => ({ messages: [] }),
      apply: (state, event) => {
        // 仅直接用户消息进入时间线；插件/工具注入的上下文同走 user/message 事件但 source.kind 不同
        if (event.type !== 'user/message') return state
        const source = event.data && event.data.source
        if (source === null || typeof source !== 'object' || source.kind !== 'user') return state
        const text = textOf(event.data.content)
        const entry = {
          seq: event.seq,
          time: event.time,
          text,
        }
        if (typeof event.data.id === 'string') entry.id = event.data.id
        return { messages: state.messages.concat([entry]) }
      },
      wire: {
        viewSchema: messageIndexSchema,
        view: (state) => state,
      },
      stateVersion: 5,
    }

    ctx.inject(['sessionProjections'], function (projectionCtx) {
      projectionCtx.sessionProjections.register(timelineProjectionDefinition)
    })
  },
}
