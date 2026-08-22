// dsh-tabs-terminal（文件树 + 标签页 + 终端插件）— host half（静态 bundle 形态）
// 业务：① 终端 PTY 生命周期（经 ctx.subprocess.spawnTerminal，node-pty 真实终端）；
//       ② 本地文本文件读写与目录浏览（供 client 的"右侧文件树 / 可编辑文件标签页"使用）。
// RPC：webServer HTTP 路由（POST /_dsh/dsh-tabs-terminal/<method>，JSON 进出，同源防护）。
// 依赖：可选服务 subprocess（ctx.get，缺失时终端降级为不可用，文件阅读不受影响）；
//       webServer 经 ctx.inject 等待（web profile 必然存在）。
// 终端输出：在进程内做有界环形缓冲，client 以 offset 轮询 termRead 拉取增量。
import { open, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------- 常量 ----------
const ROUTE_PREFIX = '/_dsh/dsh-tabs-terminal'
const ASSETS_DIR = fileURLToPath(new URL('../assets/', import.meta.url)) // 插件静态资源目录（SVG/图片图标等）
const MAX_TERMINALS = 8        // 并发终端上限（桌面单用户足够，防资源耗尽）
const MAX_OUTPUT_CHARS = 256 * 1024 // 每终端滚动缓冲上限（字符数，超出只保留尾部）
const READ_FILE_MAX_BYTES = 4 * 1024 * 1024 // 单文件读取上限 4MB
const READ_FILE_HARD_LIMIT = 16 * 1024 * 1024 // 超过则直接拒绝
const WRITE_FILE_MAX_BYTES = 16 * 1024 * 1024 // 单文件写入上限 16MB
const TERM_GRACE_MS = 3000

// ---------- 默认 shell ----------
function defaultShellArgv() {
  if (process.platform === 'win32') {
    // Windows PowerShell 5.1 始终存在（System32 在 PATH 上）；node-pty 会按 PATH 解析。
    return ['cmd.exe']
  }
  const shell = process.env.SHELL || 'bash'
  return [shell]
}

// 文本文件内容是否包含 NUL 字节（二进制判定；仅探测前 8KB）。
function looksBinary(buf) {
  const probe = buf.length <= 8192 ? buf : buf.subarray(0, 8192)
  for (let i = 0; i < probe.length; i++) {
    if (probe[i] === 0) return true
  }
  return false
}

export default {
  apply(ctx) {
    // subprocess 服务可能晚于本插件 apply 就绪（挂载顺序），故每次调用时惰性读取，
    // 而不是在 apply 时捕获一次（否则会捕获到 undefined，导致"未挂载"）。
    function getSubprocess() {
      return ctx.get('subprocess')
    }

    // ---------- 终端注册表 ----------
    const terminals = new Map() // id -> record
    let terminalSeq = 0

    function pushOutput(rec, chunk) {
      rec.buffer += chunk
      rec.total += chunk.length
      if (rec.buffer.length > MAX_OUTPUT_CHARS) {
        rec.buffer = rec.buffer.slice(rec.buffer.length - MAX_OUTPUT_CHARS)
      }
    }

    async function termStart(args) {
      const subprocess = getSubprocess()
      if (!subprocess || typeof subprocess.spawnTerminal !== 'function') {
        return { ok: false, error: '终端后端不可用（subprocess.spawnTerminal 未挂载）' }
      }
      if (terminals.size >= MAX_TERMINALS) {
        return { ok: false, error: '打开的终端过多（上限 ' + MAX_TERMINALS + '）' }
      }
      const argv = Array.isArray(args && args.argv) && args.argv.length > 0
        ? args.argv.map(String)
        : defaultShellArgv()
      const cwd = args && typeof args.cwd === 'string' && isAbsolute(args.cwd)
        ? args.cwd
        : homedir()
      const rows = Number.isFinite(args && args.rows) && args.rows > 0 ? Math.floor(args.rows) : 24
      const cols = Number.isFinite(args && args.cols) && args.cols > 0 ? Math.floor(args.cols) : 80

      let handle
      try {
        handle = await subprocess.spawnTerminal({
          argv: argv,
          cwd: cwd,
          env: undefined,
          rows: rows,
          cols: cols,
          graceMs: TERM_GRACE_MS,
        })
      } catch (err) {
        return { ok: false, error: '终端启动失败：' + String((err && err.message) || err) }
      }

      const id = 't' + (++terminalSeq)
      const rec = {
        id: id,
        handle: handle,
        pid: handle.pid,
        buffer: '',
        total: 0,
        exited: false,
        exitCode: null,
      }
      terminals.set(id, rec)

      try {
        handle.output.setEncoding('utf8')
      } catch (err) { /* 部分实现不支持 setEncoding；后续 data 用 Buffer 兜底 */ }
      handle.output.on('data', function (chunk) {
        const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
        pushOutput(rec, text)
      })
      handle.done.then(function (outcome) {
        rec.exited = true
        rec.exitCode = outcome ? outcome.exitCode : null
      }, function () {
        rec.exited = true
        rec.exitCode = null
      })

      return { ok: true, id: id, pid: handle.pid }
    }

    async function termWrite(args) {
      const rec = terminals.get(String(args && args.id))
      if (!rec) return { ok: false, error: '终端不存在或已关闭' }
      if (rec.exited) return { ok: false, error: '终端已退出' }
      const data = typeof args.data === 'string' ? args.data : ''
      if (data.length === 0) return { ok: true }
      if (data.length > 64 * 1024) return { ok: false, error: '输入过大' }
      try {
        await rec.handle.write(data)
      } catch (err) {
        return { ok: false, error: '写入失败：' + String((err && err.message) || err) }
      }
      return { ok: true }
    }

    function termRead(args) {
      const rec = terminals.get(String(args && args.id))
      if (!rec) return { ok: false, error: '终端不存在或已关闭' }
      const from = Number(args && args.from) || 0
      const head = rec.total - rec.buffer.length // buffer[0] 对应全流的字符偏移
      let text = ''
      let lossy = false
      if (from < head) {
        lossy = true
        text = rec.buffer
      } else if (from < rec.total) {
        text = rec.buffer.slice(from - head)
      }
      return {
        ok: true,
        text: text,
        nextOffset: rec.total,
        lossy: lossy,
        exited: rec.exited,
        exitCode: rec.exitCode,
        pid: rec.pid,
      }
    }

    async function termKill(args) {
      const id = String(args && args.id)
      const rec = terminals.get(id)
      if (!rec) return { ok: true }
      try { await rec.handle.terminate() } catch (err) { /* 已退出则忽略 */ }
      terminals.delete(id)
      return { ok: true }
    }

    function termList() {
      const list = []
      for (const rec of terminals.values()) {
        list.push({ id: rec.id, pid: rec.pid, exited: rec.exited, exitCode: rec.exitCode })
      }
      return { ok: true, terminals: list }
    }

    // ---------- 文件读取 / 目录浏览 ----------
    async function readFileRpc(args) {
      const p = typeof args === 'object' && args.path ? String(args.path) : ''
      if (!p || !isAbsolute(p)) return { ok: false, error: '需要绝对路径' }

      let st
      try { st = await stat(p) } catch (err) {
        return { ok: false, error: '文件不存在或不可读' }
      }
      if (!st.isFile()) return { ok: false, error: '不是普通文件' }
      if (st.size > READ_FILE_HARD_LIMIT) {
        return { ok: false, error: '文件过大（>' + (READ_FILE_HARD_LIMIT / 1024 / 1024) + 'MB），暂不支持' }
      }

      let buf
      try {
        const fh = await open(p, 'r')
        const length = Math.min(st.size, READ_FILE_MAX_BYTES)
        const buffer = Buffer.alloc(length)
        const { bytesRead } = await fh.read(buffer, 0, length, 0)
        await fh.close()
        buf = buffer.subarray(0, bytesRead)
      } catch (err) {
        return { ok: false, error: '读取失败：' + String((err && err.message) || err) }
      }

      if (looksBinary(buf)) {
        return { ok: false, error: '二进制文件，仅支持文本阅读' }
      }

      return {
        ok: true,
        path: p,
        name: basename(p),
        content: buf.toString('utf8'),
        bytes: buf.length,
        totalBytes: st.size,
        truncated: buf.length < st.size,
      }
    }

    // 写回文本文件（覆盖）：原子写（临时文件 + rename），拒绝超限/非普通文件。
    async function writeFileRpc(args) {
      const p = typeof args === 'object' && args.path ? String(args.path) : ''
      if (!p || !isAbsolute(p)) return { ok: false, error: '需要绝对路径' }
      const content = args && typeof args.content === 'string' ? args.content : null
      if (content === null) return { ok: false, error: '缺少内容' }

      const bytes = Buffer.byteLength(content, 'utf8')
      if (bytes > WRITE_FILE_MAX_BYTES) {
        return { ok: false, error: '内容过大（>' + (WRITE_FILE_MAX_BYTES / 1024 / 1024) + 'MB），暂不支持' }
      }

      // 目标存在则必须是普通文件；不存在则允许新建。
      try {
        const st = await stat(p)
        if (!st.isFile()) return { ok: false, error: '不是普通文件' }
      } catch (err) {
        if (!err || err.code !== 'ENOENT') {
          return { ok: false, error: '无法访问：' + String((err && err.message) || err) }
        }
      }

      const tmp = p + '.dtt-tmp-' + process.pid + '-' + Date.now()
      try {
        await writeFile(tmp, content, 'utf8')
        await rename(tmp, p)
      } catch (err) {
        try { await unlink(tmp) } catch (_) { /* 清理临时文件失败忽略 */ }
        return { ok: false, error: '写入失败：' + String((err && err.message) || err) }
      }

      return { ok: true, path: p, bytes: bytes }
    }

    async function listDirRpc(args) {
      let p = typeof args === 'object' && args.path ? String(args.path) : ''
      if (!p) p = homedir()
      if (!isAbsolute(p)) return { ok: false, error: '需要绝对路径' }

      let dirents
      try { dirents = await readdir(p, { withFileTypes: true }) } catch (err) {
        return { ok: false, error: '目录不可读：' + String((err && err.message) || err) }
      }

      const dirs = []
      const files = []
      for (const d of dirents) {
        const full = join(p, d.name)
        let isDir = d.isDirectory()
        if (d.isSymbolicLink()) {
          try {
            const s = await stat(full)
            isDir = s.isDirectory()
          } catch (err) {
            continue // 断链跳过
          }
        }
        const entry = { name: d.name, path: full, isDir: isDir }
        if (isDir) dirs.push(entry)
        else files.push(entry)
      }
      dirs.sort(function (a, b) { return a.name.localeCompare(b.name) })
      files.sort(function (a, b) { return a.name.localeCompare(b.name) })

      return { ok: true, path: p, parent: dirname(p), entries: dirs.concat(files) }
    }

    // ---------- RPC 路由 ----------
    function debugInfo() {
      const sub = ctx.get('subprocess')
      return {
        ok: true,
        hasSubprocess: sub != null,
        hasSpawnTerminal: !!(sub && typeof sub.spawnTerminal === 'function'),
        hasSpawn: !!(sub && typeof sub.spawn === 'function'),
        subprocessKeys: sub ? Object.keys(sub) : [],
      }
    }

    const ROUTES = {
      termStart: termStart,
      termWrite: termWrite,
      termRead: termRead,
      termKill: termKill,
      termList: termList,
      readFile: readFileRpc,
      writeFile: writeFileRpc,
      listDir: listDirRpc,
      debug: debugInfo,
    }

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

    // 静态资源（assets/ 下的 SVG/图片图标）：文件名白名单校验 + 按扩展名返回 MIME。
    const ASSET_NAME_RE = /^[A-Za-z0-9._-]+\.(svg|png|jpg|jpeg|gif|webp)$/
    const ASSET_MIME = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }

    async function serveAsset(res, name) {
      let file
      try { file = decodeURIComponent(name) } catch (err) { respond(res, 404, { error: 'asset not found' }); return }
      if (!ASSET_NAME_RE.test(file)) { respond(res, 404, { error: 'asset not found' }); return }
      let buf
      try { buf = await readFile(join(ASSETS_DIR, file)) } catch (err) { respond(res, 404, { error: 'asset not found' }); return }
      const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase()
      res.writeHead(200, {
        'Content-Type': ASSET_MIME[ext] || 'application/octet-stream',
        'Content-Length': buf.length,
        'Cache-Control': 'no-store',
      })
      res.end(buf)
    }

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
              if (!sameOrigin(req)) {
                respond(res, 403, { error: 'cross-origin request rejected' })
                return
              }
              if (path.startsWith(ROUTE_PREFIX + '/assets/')) {
                await serveAsset(res, path.slice((ROUTE_PREFIX + '/assets/').length))
                return
              }
              const method = decodeURIComponent(path.slice(ROUTE_PREFIX.length + 1))
              const fn = Object.hasOwn(ROUTES, method) ? ROUTES[method] : null
              if (typeof fn !== 'function') {
                respond(res, 404, { error: 'unknown method: ' + method })
                return
              }
              let args = {}
              if (req.method === 'POST' || req.method === 'PUT') {
                const raw = await readBody(req, 64 * 1024)
                if (raw.length > 0) {
                  try { args = JSON.parse(raw) } catch (e) { respond(res, 400, { error: 'invalid JSON body' }); return }
                }
              }
              const result = await fn(args)
              respond(res, 200, result)
            } catch (err) {
              const status = (err && err.status) || 500
              respond(res, status, { error: status === 500 ? 'internal error' : String((err && err.message) || err) })
            }
          },
        })
        return function () { dispose() }
      }, 'dsh-tabs-terminal: Web routes')
    })

    // 卸载时终止所有终端，避免遗留子进程。
    return function () {
      for (const rec of terminals.values()) {
        try { rec.handle.terminate() } catch (err) { /* 忽略 */ }
      }
      terminals.clear()
    }
  },
}
