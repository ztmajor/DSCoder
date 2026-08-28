window.__ModuleLoader__.load({ id: "dsh-task-board", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
// dsh-task-board — client half（静态 bundle 形态）
// - rpc(method, args) → fetch /api/task-board/{state|options|action}
// - 注册到 shell.overlay，渲染五列任务看板；侧边栏入口为纯 DOM 注入（自愈）
// - 新建任务支持定时执行：只执行一次 / 每天固定时间执行（每天或固定次数）/ 循环执行（分钟/小时/天/月）
// - React 由 bundle 的 require('react') 提供（seed 模块）
'use strict';

const React = require('react');
const h = React.createElement;
const { useState, useEffect } = React;

const RPC_BASE = '/api/task-board';
const RPC_TIMEOUT_MS = 20000;
const POLL_MS = 3000;

const COLUMNS = [
  { status: 'backlog', label: '待规划' },
  { status: 'todo', label: '待执行' },
  { status: 'running', label: '进行中' },
  { status: 'done', label: '已完成' },
  { status: 'failed', label: '已失败' },
];

// 每列列头按钮（action: new / delete / archive / terminate）
const COLUMN_ACTIONS = {
  backlog: [{ action: 'delete', label: '删除' }, { action: 'new', label: '新建' }],
  todo: [{ action: 'delete', label: '删除' }, { action: 'new', label: '新建' }],
  running: [{ action: 'terminate', label: '终止' }, { action: 'new', label: '新建' }],
  done: [{ action: 'delete', label: '删除' }, { action: 'archive', label: '归档' }],
  failed: [{ action: 'delete', label: '删除' }, { action: 'archive', label: '归档' }],
};

function selectionVerb(action) {
  if (action === 'delete') return '删除';
  if (action === 'archive') return '归档';
  if (action === 'terminate') return '终止';
  return '';
}

// 工作区下拉里「新建工作区」动作选项的哨兵值（绝不进入默认值/记忆/任务数据）
const NEW_WORKSPACE_SENTINEL = '__new_workspace__';

const STATUS_LABEL = { backlog: '待规划', todo: '待执行', running: '进行中', done: '已完成', failed: '已失败' };
const SCHEDULE_MODE_LABEL = { once: '只执行一次', daily: '每天固定时间执行', interval: '循环执行' };
const DAILY_REPEAT_LABEL = { infinite: '每天执行', count: '固定次数' };
const INTERVAL_UNIT_LABEL = { minute: '分钟', hour: '小时', day: '天', month: '月' };
const INTERVAL_UNITS = ['minute', 'hour', 'day', 'month'];
const PERMISSION_LABEL = { 'read-only': '只读', 'workspace-write': '工作区可写', 'danger-full-access': '完全访问' };
const RESULT_LABEL = { succeeded: '成功', failed: '失败', cancelled: '已取消' };
const PERMISSIONS = ['read-only', 'workspace-write', 'danger-full-access'];

const MODEL_KINDS = ['pro', 'flash'];
const MODEL_LABEL = { pro: 'Pro', flash: 'Flash' };
const REASONING_LEVELS = ['off', 'low', 'high', 'max'];
const REASONING_LABEL = { off: 'Off', low: 'Low', high: 'High', max: 'Max' };
const DEFAULT_LAST_CONFIG = {
  mode: 'standard',
  model: 'flash',
  reasoning: 'off',
  permission: 'workspace-write',
  scheduleEnabled: false,
  scheduleMode: 'once',
  scheduleTime: '12:00',
  scheduleCount: 1,
  scheduleRepeat: 'infinite',
  scheduleInterval: 10,
  scheduleIntervalUnit: 'minute',
};

const ICON = '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M6.5 6.5v7"/></svg>';

// ---------- uuid ----------
function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 't-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// ---------- rpc ----------
function rpc(method, args, opts) {
  const controller = new AbortController();
  const timer = window.setTimeout(function () { controller.abort(); }, (opts && opts.timeout) || RPC_TIMEOUT_MS);
  const init = {
    method: (opts && opts.method) || 'GET',
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
  };
  if (args !== undefined && args !== null) init.body = JSON.stringify(args);
  return fetch(RPC_BASE + '/' + method, init)
    .then(function (res) {
      if (!res.ok) {
        return res.text().then(function (raw) {
          let body = null;
          try { body = JSON.parse(raw); } catch (e) { /* 非 JSON 错误体 */ }
          throw new Error((body && body.error) || ('HTTP ' + res.status));
        });
      }
      return res.text().then(function (raw) {
        try { return JSON.parse(raw); } catch (e) { throw new Error('响应解析失败'); }
      });
    })
    .catch(function (err) {
      if (err && err.name === 'AbortError') throw new Error('请求超时');
      throw err;
    })
    .finally(function () { window.clearTimeout(timer); });
}

function rpcState() { return rpc('state'); }
function rpcOptions() { return rpc('options'); }
function rpcAction(requestId, action) { return rpc('action', { requestId: requestId, action: action }, { method: 'POST' }); }

// ---------- 控制器 ----------
class Controller {
  constructor(api, sessionsSvc) {
    this.tasks = [];
    this.boardOpen = false;
    this.archiveView = false;
    this.selectedTaskId = undefined;
    this.api = api;
    this.sessions = sessionsSvc;
    this.options = { workspaces: [], presets: [] };
    this.pendingTaskIds = new Set();
    this.transportError = undefined;
    this.host = undefined;
    this.lastConfig = { ...DEFAULT_LAST_CONFIG };
    this.power = undefined;
    this.needsHuman = [];
    this.listeners = new Set();
    this.pollTimer = undefined;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    const self = this;
    return function () { self.listeners.delete(fn); };
  }
  notify() { for (const fn of Array.from(this.listeners)) fn(); }

  getSnapshot() {
    return {
      tasks: this.tasks,
      boardOpen: this.boardOpen,
      archiveView: this.archiveView,
      selectedTaskId: this.selectedTaskId,
      options: this.options,
      pendingTaskIds: Array.from(this.pendingTaskIds),
      transportError: this.transportError,
      host: this.host,
      lastConfig: this.lastConfig,
      power: this.power,
      needsHuman: this.needsHuman,
    };
  }

  openBoard() { this.boardOpen = true; this.notify(); }
  closeBoard() { this.boardOpen = false; this.notify(); }
  toggleBoard() { this.boardOpen = !this.boardOpen; this.notify(); }
  toggleArchiveView() {
    this.archiveView = !this.archiveView;
    if (!this.archiveView && this.selectedTaskId !== undefined) {
      const sel = this.tasks.find(function (t) { return t.id === this.selectedTaskId; }.bind(this));
      if (sel && sel.archivedAt !== undefined) this.selectedTaskId = undefined;
    }
    this.notify();
  }
  openTask(id) { if (this.tasks.some(function (t) { return t.id === id; })) { this.selectedTaskId = id; this.notify(); } }
  // 点击卡片：有会话则关闭看板并跳转到对应会话位置（方便操作/回答）；无会话（未执行过）则打开详情页
  openTaskOrSession(task) {
    const ex = task.executions.slice().reverse().find(function (e) { return typeof e.sessionId === 'string' && e.sessionId !== ''; });
    if (ex !== undefined) {
      if (this.sessions === undefined) {
        console.warn('[dsh-task-board] sessions 服务不可用，回退打开详情页');
        this.openTask(task.id);
        return;
      }
      try {
        this.sessions.open(ex.sessionId);
        this.closeBoard();
      } catch (err) {
        console.warn('[dsh-task-board] 跳转会话失败，回退打开详情页', err);
        this.openTask(task.id);
      }
      return;
    }
    this.openTask(task.id);
  }
  closeTask() { if (this.selectedTaskId !== undefined) { this.selectedTaskId = undefined; this.notify(); } }

  async start() {
    await this.refreshOptions();
    await this.refreshState();
    this.pollTimer = window.setInterval(() => { this.refreshState(); this.refreshOptions(); }, POLL_MS);
  }

  dispose() {
    if (this.pollTimer !== undefined) window.clearInterval(this.pollTimer);
    this.listeners.clear();
  }

  async refreshOptions() {
    try {
      const o = await rpcOptions();
      this.options = o || { workspaces: [], presets: [] };
      this.notify();
    } catch (e) { /* 缺省为空 */ }
  }

  // 「新建工作区」：打开系统目录选择器 → 创建 → 刷新选项；返回新工作区或 undefined（取消/失败）
  async pickAndCreateWorkspace() {
    if (!this.api) {
      showToast('无法打开目录选择器');
      return undefined;
    }
    try {
      const picked = await this.api.host.pickDirectory({}, new AbortController().signal);
      if (!picked.result.ok) return undefined;
      const path = picked.result.value.path;
      if (!path) return undefined; // 用户取消
      const created = await this.api.workspace.create({ path: path });
      if (!created.result.ok) return undefined;
      await this.refreshOptions();
      const ws = created.result.value.workspace;
      return { workspaceId: ws.workspaceId, title: ws.title };
    } catch (e) {
      console.error('[dsh-task-board] create workspace failed', e);
      return undefined;
    }
  }

  async refreshState() {
    try {
      const snap = await rpcState();
      this.acceptRemote(snap);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      // 网络层 HTTP 状态码对用户无意义，折叠为友好文案（真实原因打印到控制台）。
      if (/^HTTP \d+$/.test(raw) || raw === '请求超时' || raw === '响应解析失败') {
        this.transportError = '任务看板服务连接异常';
      } else {
        this.transportError = raw;
      }
      this.notify();
    }
  }

  acceptRemote(snap) {
    if (!snap || !Array.isArray(snap.tasks)) return;
    this.tasks = snap.tasks;
    this.host = { revision: snap.revision, scheduler: snap.scheduler };
    if (snap.lastConfig && typeof snap.lastConfig === 'object') this.lastConfig = { ...DEFAULT_LAST_CONFIG, ...snap.lastConfig };
    if (snap.power && typeof snap.power === 'object') this.power = snap.power;
    if (Array.isArray(snap.needsHuman)) {
      // 只保留仍处于「进行中」的任务标记：终止/完成/取消后立即熄灭呼吸灯（host 轮询清理作为兜底）
      this.needsHuman = snap.needsHuman.filter(function (h) {
        return snap.tasks.some(function (t) { return t.id === h.taskId && t.status === 'running'; });
      });
    }
    this.transportError = undefined;
    if (this.selectedTaskId !== undefined && !this.tasks.some(function (t) { return t.id === this.selectedTaskId; }.bind(this))) {
      this.selectedTaskId = undefined;
    }
    this.notify();
  }

  async sendAction(action) {
    const requestId = uuid();
    try {
      const snap = await rpcAction(requestId, action);
      this.acceptRemote(snap);
      return snap;
    } catch (err) {
      this.transportError = err instanceof Error ? err.message : String(err);
      this.notify();
      return undefined;
    }
  }

  async createTask(input) {
    const id = uuid();
    const snap = await this.sendAction({ kind: 'create', id: id, input: input });
    if (snap === undefined) return undefined;
    return this.tasks.find(function (t) { return t.id === id; });
  }

  updateTask(id, patch) { return this.sendAction({ kind: 'update', taskId: id, patch: patch }); }
  deleteTask(id) { return this.sendAction({ kind: 'delete', taskId: id }); }
  moveTask(id, status) { return this.sendAction({ kind: 'move', taskId: id, status: status }); }
  archiveTask(id, seq) { return this.sendAction({ kind: 'archive', taskId: id, ...(seq === undefined ? {} : { seq }) }); }
  restoreTask(id) { return this.sendAction({ kind: 'restore', taskId: id }); }
  setSchedule(id, patch) { return this.sendAction({ kind: 'set-schedule', taskId: id, patch: patch }); }
  runTask(id) { return this.sendAction({ kind: 'run', taskId: id }); }
  rerunTask(id) { return this.sendAction({ kind: 'rerun', taskId: id }); }
  cancelTask(id) { return this.sendAction({ kind: 'cancel', taskId: id }); }
  setSettings(patch) { return this.sendAction({ kind: 'set-settings', patch: patch }); }
}

// ---------- Toast（轻提示）：居中、向上位移 + fade-out 消散，非阻塞、自动消失 ----------
function showToast(message) {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.className = 'dtb-toast';
  el.textContent = message;
  document.body.appendChild(el);
  const remove = function () { if (el.parentNode) el.parentNode.removeChild(el); };
  el.addEventListener('animationend', remove);
  window.setTimeout(remove, 2600); // 兜底：animationend 未触发时也移除
}

// ---------- 样式 ----------
function installStyles() {
  const id = 'dsh-task-board';
  if (document.querySelector('style[data-plugin-css="' + id + '"]')) return function () {};
  const style = document.createElement('style');
  style.dataset.plugin = id;
  style.dataset.pluginCss = id;
  style.textContent = `
    .dtb-sidebar-entry { display:flex; align-items:center; gap:8px; width:100%; padding:8px 10px; border:none; background:transparent; cursor:pointer; color:var(--dsw-alias-label-primary,#0f1115); font-size:13px; font-family:inherit; border-radius:6px; }
    .dtb-sidebar-entry:hover { background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,0.06)); }
    .dtb-sidebar-entry[data-active="true"] { background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,0.08)); }
    .dtb-sidebar-icon { display:inline-flex; align-items:center; }
    .dtb-sidebar-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .dtb-sidebar-entry.dtb-sidebar-collapsed { justify-content:center; gap:0; width:36px; height:36px; padding:0; margin:0 0 8px; }
    .dtb-sidebar-entry.dtb-sidebar-collapsed .dtb-sidebar-label { display:none; }
    .dtb-sidebar-entry.dtb-sidebar-collapsed .dtb-sidebar-icon { justify-content:center; }

    .dtb-overlay { position:fixed; inset:0; z-index:50; display:flex; flex-direction:column; background:var(--dsw-alias-bg-base,#fff); color:var(--dsw-alias-label-primary,#0f1115); font-family:var(--dsw-font-family,inherit); font-size:13px; }
    .dtb-header { flex:0 0 auto; display:flex; align-items:center; gap:10px; padding:10px 14px; border-bottom:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,0.1)); }
    .dtb-title { font-size:16px; font-weight:600; margin:0; }
    .dtb-meta { font-size:12px; color:var(--dsw-alias-label-tertiary,rgba(128,128,128,0.9)); }
    .dtb-spacer { flex:1 1 auto; }
    .dtb-btn { height:26px; padding:0 10px; border:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,0.14)); border-radius:5px; background:transparent; cursor:pointer; font-size:12.5px; color:var(--dsw-alias-label-primary,#0f1115); display:inline-flex; align-items:center; gap:4px; }
    .dtb-btn:hover { background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,0.06)); }
    .dtb-btn.primary { color:#fff; background:var(--dsw-alias-state-info-primary,#2563eb); border-color:transparent; }
    .dtb-btn.primary:hover { background:var(--dsw-alias-state-info-hover,#1d4ed8); }
    .dtb-btn.danger { color:var(--dsw-alias-state-error-primary,#dc2626); }
    .dtb-btn:disabled { opacity:0.5; cursor:not-allowed; }

    .dtb-search { height:26px; padding:0 8px; border:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,0.14)); border-radius:5px; background:var(--dsw-alias-bg-base,#fff); color:var(--dsw-alias-label-primary,#0f1115); font-size:12.5px; min-width:160px; }

    .dtb-error { margin:8px 14px 0; padding:8px 10px; border-radius:6px; background:var(--dsw-alias-state-error-hover,rgba(220,38,38,0.1)); color:var(--dsw-alias-state-error-primary,#dc2626); font-size:12px; }

    .dtb-columns { flex:1 1 auto; display:flex; gap:10px; padding:10px 14px; overflow-x:auto; }
    .dtb-archive-wrap { flex:1 1 auto; display:flex; flex-direction:column; min-width:0; }
    .dtb-archive-scroll { flex:1 1 auto; overflow-y:auto; min-height:0; }
    .dtb-year-head { position:sticky; top:0; z-index:6; height:28px; display:flex; align-items:center; padding:0 4px; font-size:13px; font-weight:600; color:var(--dsw-alias-label-secondary,rgba(0,0,0,0.65)); background:var(--dsw-alias-bg-base,#fff); }
    .dtb-date-head { height:24px; display:flex; align-items:center; padding:0 4px; font-size:12px; font-weight:600; color:var(--dsw-alias-label-secondary,rgba(0,0,0,0.65)); background:var(--dsw-alias-bg-base,#fff); border-bottom:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,0.08)); }
    .dtb-archive-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; padding:8px 4px 14px; }
    .dtb-card-check { width:16px; height:16px; margin:0; cursor:pointer; }
    .dtb-column { flex:1 1 0; min-width:180px; display:flex; flex-direction:column; background:var(--dsw-alias-bg-subtle,rgba(0,0,0,0.03)); border-radius:8px; padding:8px; }
    .dtb-column-head { display:flex; align-items:center; gap:6px; padding:2px 4px 8px; }
    .dtb-dot { width:8px; height:8px; border-radius:50%; flex:0 0 auto; }
    .dtb-dot[data-status="backlog"] { background:#94a3b8; }
    .dtb-dot[data-status="todo"] { background:#3b82f6; }
    .dtb-dot[data-status="running"] { background:#d97706; }
    .dtb-dot[data-status="done"] { background:#22c55e; }
    .dtb-dot[data-status="failed"] { background:#ef4444; }
    .dtb-col-title { font-size:12.5px; font-weight:600; margin:0; flex:1 1 auto; }
    .dtb-col-count { font-size:11px; color:var(--dsw-alias-label-tertiary,rgba(128,128,128,0.9)); }
    .dtb-col-btn { height:20px; padding:0 6px; font-size:11px; line-height:1; border:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,0.14)); border-radius:4px; background:transparent; color:var(--dsw-alias-label-primary,#0f1115); cursor:pointer; flex:0 0 auto; }
    .dtb-col-btn:hover { background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,0.06)); }
    .dtb-col-btn.armed { color:#fff; background:var(--dsw-alias-state-error-primary,#dc2626); border-color:transparent; }
    .dtb-cards { flex:1 1 auto; overflow-y:auto; display:flex; flex-direction:column; gap:6px; padding:5px; }
    .dtb-empty { padding:12px; color:var(--dsw-alias-label-tertiary,rgba(128,128,128,0.9)); font-size:12px; text-align:center; }

    .dtb-card { position:relative; padding:8px 9px; border-radius:6px; background:var(--dsw-alias-bg-base,#fff); border:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,0.08)); cursor:pointer; }
    .dtb-card-select { position:absolute; top:6px; right:6px; width:16px; height:16px; line-height:0; }
    .dtb-card:hover { border-color:var(--dsw-alias-state-info-primary,#2563eb); }
    .dtb-card-title { font-size:12.5px; font-weight:600; word-break:break-word; }
    .dtb-card-desc { margin-top:6px; font-size:12px; color:var(--dsw-alias-label-secondary,rgba(0,0,0,0.65)); white-space:pre-wrap; word-break:break-word; }
    .dtb-card-divider { border-top:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,0.08)); margin-bottom:6px; }
    .dtb-card-meta { margin-top:4px; display:flex; gap:6px; flex-wrap:wrap; font-size:11px; color:var(--dsw-alias-label-tertiary,rgba(128,128,128,0.9)); }
    .dtb-badge { padding:1px 6px; border-radius:8px; background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,0.06)); }
    .dtb-badge.sched { background:var(--dsw-alias-state-info-hover,rgba(37,99,235,0.12)); color:var(--dsw-alias-state-info-primary,#2563eb); }
    @keyframes dtb-breath { 0%,100% { box-shadow:0 0 0 0 rgba(234,179,8,0); } 50% { box-shadow:0 0 0 3px rgba(234,179,8,0.6); } }
    .dtb-card-human { border-color:#eab308 !important; animation:dtb-breath 1.6s ease-in-out infinite; }
    .dtb-fail-tag { display:inline-flex; align-items:center; padding:1px 7px; border-radius:9px; background:rgba(220,38,38,0.12); color:#dc2626; font-size:11px; cursor:pointer; }
    .dtb-fail-tag:hover { background:rgba(220,38,38,0.22); }
    .dtb-card-detail-btn { margin-left:auto; padding:1px 10px; border-radius:999px; border:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,0.16)); background:var(--dsw-alias-bg-base,#fff); color:var(--dsw-alias-label-tertiary,rgba(128,128,128,0.9)); font-size:11px; cursor:pointer; line-height:1.6; }
    .dtb-card-detail-btn:hover { color:var(--dsw-alias-state-info-primary,#2563eb); border-color:var(--dsw-alias-state-info-primary,#2563eb); }

    .dtb-modal-backdrop { position:fixed; inset:0; z-index:60; background:rgba(0,0,0,0.35); display:flex; align-items:center; justify-content:center; padding:20px; }
    .dtb-modal { width:min(620px,100%); max-height:90vh; overflow:auto; background:var(--dsw-alias-bg-base,#fff); border-radius:10px; padding:18px; box-shadow:0 12px 40px rgba(0,0,0,0.2); }
    .dtb-modal-title { margin:0 0 12px; font-size:16px; font-weight:600; }
    .dtb-field { display:flex; flex-direction:column; gap:4px; margin-bottom:10px; }
    .dtb-field-label { font-size:12px; color:var(--dsw-alias-label-secondary,rgba(0,0,0,0.65)); }
    .dtb-input, .dtb-select { width:100%; padding:6px 8px; border:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,0.16)); border-radius:5px; background:var(--dsw-alias-bg-base,#fff); color:var(--dsw-alias-label-primary,#0f1115); font-size:12.5px; font-family:inherit; }
    textarea.dtb-input { resize:none; }
    .dtb-input:focus, .dtb-select:focus { outline:none; border-color:var(--dsw-alias-state-info-primary,#2563eb); }
    .dtb-form-error { color:var(--dsw-alias-state-error-primary,#dc2626); font-size:12px; margin:6px 0; }
    .dtb-toast { position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); z-index:1200; background:rgba(45,45,45,0.96); color:#fff; padding:10px 18px; border-radius:6px; font-size:13px; max-width:70vw; pointer-events:none; box-shadow:0 6px 20px rgba(0,0,0,0.3); animation:dtb-toast-anim 2.4s ease forwards; }
    @keyframes dtb-toast-anim { 0% { opacity:0; transform:translate(-50%,-50%) translateY(12px); } 12% { opacity:1; transform:translate(-50%,-50%) translateY(0); } 75% { opacity:1; transform:translate(-50%,-50%) translateY(0); } 100% { opacity:0; transform:translate(-50%,-50%) translateY(-28px); } }
    .dtb-modal-footer { display:flex; justify-content:flex-end; gap:8px; margin-top:12px; }
    .dtb-section { margin-top:12px; padding-top:10px; border-top:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,0.08)); }
    .dtb-section-title { font-size:13px; font-weight:600; margin:0 0 8px; }
    .dtb-toggle { display:flex; align-items:center; gap:6px; font-size:12.5px; cursor:pointer; user-select:none; }
    .dtb-row { display:flex; gap:8px; align-items:center; }

    .dtb-detail { position:fixed; inset:0; z-index:59; background:rgba(0,0,0,0.28); display:flex; justify-content:flex-end; }
    .dtb-detail-panel { width:min(520px,100%); height:100%; overflow:auto; background:var(--dsw-alias-bg-base,#fff); padding:18px; box-shadow:-8px 0 30px rgba(0,0,0,0.15); }
    .dtb-detail-title { margin:0 0 4px; font-size:17px; font-weight:600; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .dtb-detail-desc { margin:0 0 12px; color:var(--dsw-alias-label-secondary,rgba(0,0,0,0.65)); white-space:pre-wrap; word-break:break-word; }
    .dtb-detail-prompt { background:var(--dsw-alias-bg-subtle,rgba(0,0,0,0.03)); border-radius:6px; padding:10px; white-space:pre-wrap; word-break:break-word; font-size:12.5px; margin-bottom:12px; }
    .dtb-kv { font-size:12px; color:var(--dsw-alias-label-secondary,rgba(0,0,0,0.65)); margin-bottom:3px; }
    .dtb-exec-item { display:flex; align-items:center; gap:8px; padding:5px 0; border-bottom:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,0.06)); font-size:12px; }
    .dtb-exec-result { flex:0 0 auto; }
    .dtb-exec-result.succeeded { color:#16a34a; }
    .dtb-exec-result.failed { color:#dc2626; }
    .dtb-exec-result.cancelled { color:#94a3b8; }
    .dtb-exec-result.running { color:#d97706; }
    .dtb-exec-time { flex:0 0 auto; color:var(--dsw-alias-label-tertiary,rgba(128,128,128,0.9)); }
    .dtb-exec-session { flex:1 1 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:var(--dsw-font-mono,monospace); font-size:11px; color:var(--dsw-alias-label-tertiary,rgba(128,128,128,0.9)); }
  `;
  document.head.appendChild(style);
  return function () { style.remove(); };
}

// ---------- 侧边栏入口（纯 DOM，自愈） ----------
function mountSidebarEntry(controller) {
  if (document.querySelector('[data-dsh-taskboard-entry]')) return function () {};
  const entry = document.createElement('button');
  entry.type = 'button';
  entry.setAttribute('data-dsh-taskboard-entry', '');
  entry.setAttribute('data-dsh-plugin', 'task-board');
  entry.className = 'dtb-sidebar-entry';
  entry.innerHTML = '<span class="dtb-sidebar-icon">' + ICON + '</span><span class="dtb-sidebar-label">任务看板</span>';
  entry.addEventListener('click', function () { controller.toggleBoard(); });

  const syncActive = function () { if (controller.getSnapshot().boardOpen) entry.dataset.active = 'true'; else delete entry.dataset.active; };
  const unsubActive = controller.subscribe(syncActive);
  syncActive();

  let root;
  let placed = false;
  let collapsedObserver;
  // 侧边栏收起时与其他按钮对齐（36×36 图标居中），并悬浮显示「任务面板」提示
  const syncCollapsed = function () {
    if (root === undefined || !root.isConnected) return;
    const collapsed = typeof root.className === 'string' && root.className.indexOf('collapsed') !== -1;
    entry.classList.toggle('dtb-sidebar-collapsed', collapsed);
    entry.title = collapsed ? '任务面板' : '';
  };
  const observeRoot = function () {
    if (collapsedObserver !== undefined) { collapsedObserver.disconnect(); collapsedObserver = undefined; }
    if (root === undefined || !root.isConnected) return;
    collapsedObserver = new MutationObserver(syncCollapsed);
    collapsedObserver.observe(root, { attributes: true, attributeFilter: ['class'] });
    syncCollapsed();
  };
  const findRoot = function () {
    const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
    if (!column) return undefined;
    const logoOwner = column.querySelector('[class*="logoRow"]');
    return (logoOwner && logoOwner.parentElement) || column.firstElementChild || undefined;
  };
  const findButton = function (r) {
    const nested = r.querySelector('button[class*="newSession"]');
    if (nested) return nested;
    for (const child of r.children) { if (child.tagName === 'BUTTON') return child; }
    return undefined;
  };
  const place = function () {
    if (root !== undefined && !root.isConnected) { root = undefined; placed = false; }
    if (placed) {
      if (document.body.contains(entry)) return;
      root = undefined; placed = false;
    }
    if (root === undefined) root = findRoot();
    if (root === undefined) return;
    const button = findButton(root);
    if (button === undefined) return;
    if (entry.parentElement !== root) {
      const row = button.closest('[class*="logoRow"]');
      const base = (row && row.parentElement === root) ? row : button;
      const anchor = base.nextElementSibling;
      root.insertBefore(entry, anchor);
    }
    placed = true;
    observeRoot();
  };
  const waitObserver = new MutationObserver(function () { place(); });
  waitObserver.observe(document.body, { childList: true, subtree: true });
  place();

  return function () {
    waitObserver.disconnect();
    if (collapsedObserver !== undefined) collapsedObserver.disconnect();
    unsubActive();
    entry.remove();
  };
}

// ---------- 组件 ----------
function formatTime(ms) {
  if (ms === undefined || ms === null) return '';
  const d = new Date(ms);
  const p = function (n) { return n < 10 ? '0' + n : String(n); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// 任务在所属列从上到下的位置（1 起，归档前快照）：用于同秒归档时的序号
function columnPosition(tasks, taskId) {
  const task = tasks.find(function (t) { return t.id === taskId; });
  if (!task) return undefined;
  const list = tasks.filter(function (t) { return t.status === task.status && t.archivedAt === undefined; });
  const idx = list.findIndex(function (t) { return t.id === taskId; });
  return idx === -1 ? undefined : idx + 1;
}

// 归档日期分组：key 含年份（避免跨年同月日合并），label 只显示「M月D日」
function archiveDateKey(ms) {
  const d = new Date(ms);
  const p = function (n) { return n < 10 ? '0' + n : String(n); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function archiveDateLabel(ms) {
  const d = new Date(ms);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

// 按工作区 ID 解析显示名称；重命名后 workspaceId 不变、title 更新，故此处用实时 options 解析。
function workspaceTitle(workspaceId, workspaces) {
  if (!workspaceId) return '';
  const list = Array.isArray(workspaces) ? workspaces : [];
  for (const w of list) {
    if (w && w.workspaceId === workspaceId) return w.title || w.workspaceId;
  }
  return workspaceId;
}

// 按 agent 预设 ID 解析中文名称（name 字段即为「标准模式/PTC 模式/极简模式/创造模式」）。
function presetName(presetId, presets) {
  if (!presetId) return '';
  const list = Array.isArray(presets) ? presets : [];
  for (const p of list) {
    if (p && p.id === presetId) return p.name || p.id;
  }
  return presetId;
}

// 循环间隔合法性（与 host 一致）：数值 ≥ 1、单位受支持、总周期 ≤ 1 年（month 上限 12）。
function validIntervalValue(interval, unit) {
  if (!/^\d+$/.test(String(interval)) || Number(interval) < 1) return false;
  const n = Number(interval);
  if (unit === 'month') return n <= 12;
  if (unit === 'minute') return n <= 365 * 24 * 60;
  if (unit === 'hour') return n <= 365 * 24;
  if (unit === 'day') return n <= 365;
  return false;
}

// 失败原因标签：会话异常退出 / 挂起时间过长 / 未知失败原因（旧数据无 failKind 时按错误文本兜底归类）
function failKindLabel(execution) {
  if (execution.failKind === 'timeout' || execution.error === '挂起时间过长') return '挂起时间过长';
  const msg = String(execution.error || '');
  if (execution.failKind === 'abnormal' || /terminated by user|aborted|interrupted|restart|no longer exists|recorded/.test(msg)) return '会话异常退出';
  return '未知失败原因';
}

function scheduleSummary(schedule) {
  if (!schedule) return '';
  const parts = [SCHEDULE_MODE_LABEL[schedule.mode] || schedule.mode];
  if (schedule.mode === 'once') {
    parts.push(schedule.time);
  } else if (schedule.mode === 'daily') {
    parts.push(schedule.time);
    if (schedule.repeat === 'count' && schedule.totalRuns !== undefined) {
      const remaining = schedule.remainingRuns !== undefined ? schedule.remainingRuns : schedule.totalRuns;
      parts.push('共 ' + schedule.totalRuns + ' 次 / 剩 ' + remaining + ' 次');
    }
  } else if (schedule.mode === 'interval') {
    parts.push('每 ' + schedule.interval + ' ' + (INTERVAL_UNIT_LABEL[schedule.intervalUnit] || schedule.intervalUnit));
  }
  if (schedule.nextRunAt !== undefined) parts.push('下次 ' + formatTime(schedule.nextRunAt));
  return parts.join(' · ');
}

function Card({ task, pending, onClick, draggable, onDragStart, selectionIcon, selectionCheckbox, checked, onToggleCheck, needsHuman, failInfo, onFailTagClick, onDetail }) {
  const hasDesc = typeof task.description === 'string' && task.description.trim() !== '';
  return h('div', { className: 'dtb-card' + (needsHuman ? ' dtb-card-human' : ''), onClick: onClick, draggable: draggable, onDragStart: onDragStart },
    (selectionIcon || selectionCheckbox) ? h('span', { className: 'dtb-card-select' },
      selectionCheckbox
        ? h('input', { className: 'dtb-card-check', type: 'checkbox', checked: checked, onClick: function (e) { e.stopPropagation(); }, onChange: function () { if (onToggleCheck) onToggleCheck(); } })
        : h('span', { dangerouslySetInnerHTML: { __html: selectionIcon } }),
    ) : null,
    h('div', { className: 'dtb-card-title' }, task.title),
    hasDesc ? h('div', { className: 'dtb-card-desc' },
      h('div', { className: 'dtb-card-divider' }),
      task.description,
    ) : null,
    h('div', { className: 'dtb-card-meta' },
      failInfo ? h('span', { className: 'dtb-fail-tag', title: '点击查看失败原因', onClick: function (e) { e.stopPropagation(); if (onFailTagClick) onFailTagClick(); } }, failInfo.label) : null,
      task.schedule && task.schedule.enabled ? h('span', { className: 'dtb-badge sched' }, scheduleSummary(task.schedule)) : null,
      task.executions.length > 0 ? h('span', { className: 'dtb-badge' }, '执行 ' + task.executions.length + ' 次') : null,
      pending ? h('span', { className: 'dtb-badge' }, '…') : null,
      onDetail ? h('button', { className: 'dtb-card-detail-btn', type: 'button', title: '打开详情', onClick: function (e) { e.stopPropagation(); onDetail(); } }, '详情') : null,
    ),
  );
}

function NewModal({ controller, onClose, initialStatus, hideSchedule, autoRun }) {
  const snap = controller.getSnapshot();
  const last = snap.lastConfig || DEFAULT_LAST_CONFIG;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  const [workspaceId, setWorkspaceId] = useState(function () {
    const ws = snap.options.workspaces || [];
    return ws.length > 0 ? ws[0].workspaceId : '';
  });
  const [mode, setMode] = useState(last.mode || 'standard');
  const [model, setModel] = useState(MODEL_KINDS.indexOf(last.model) !== -1 ? last.model : 'flash');
  const [reasoning, setReasoning] = useState(REASONING_LEVELS.indexOf(last.reasoning) !== -1 ? last.reasoning : 'off');
  const [permission, setPermission] = useState(PERMISSIONS.indexOf(last.permission) !== -1 ? last.permission : 'workspace-write');
  const [schedEnabled, setSchedEnabled] = useState(last.scheduleEnabled === true);
  const [schedMode, setSchedMode] = useState(function () {
    const m = last.scheduleMode;
    if (m === 'times') return 'daily'; // 旧版本迁移：times 并入 daily+count
    return SCHEDULE_MODE_LABEL[m] ? m : 'once';
  });
  const [schedTime, setSchedTime] = useState(last.scheduleTime || '12:00');
  const [schedRepeat, setSchedRepeat] = useState(DAILY_REPEAT_LABEL[last.scheduleRepeat] ? last.scheduleRepeat : 'infinite');
  const [schedCount, setSchedCount] = useState(String(last.scheduleCount || 1));
  const [schedInterval, setSchedInterval] = useState(String(last.scheduleInterval || 10));
  const [schedIntervalUnit, setSchedIntervalUnit] = useState(INTERVAL_UNITS.indexOf(last.scheduleIntervalUnit) !== -1 ? last.scheduleIntervalUnit : 'minute');
  const [error, setError] = useState(undefined);
  const [pending, setPending] = useState(false);
  const options = snap.options;
  const workspaces = options.workspaces || [];
  // 工作区下拉无占位项：有可用工作区且尚未选择时，自动选中第一个，避免「看起来已选中但实际为空」
  useEffect(function () {
    if (workspaceId === '' && workspaces.length > 0) {
      setWorkspaceId(workspaces[0].workspaceId);
    }
  }, [workspaces, workspaceId]);

  // 工作区下拉：选中「新建工作区」哨兵项时打开目录选择器并创建工作区，完成后选中新工作区（取消则恢复原值）
  const onWorkspaceChange = async function (value) {
    if (value === NEW_WORKSPACE_SENTINEL) {
      const previous = workspaceId;
      setWorkspaceId(NEW_WORKSPACE_SENTINEL);
      const ws = await controller.pickAndCreateWorkspace();
      setWorkspaceId(ws ? ws.workspaceId : previous);
      return;
    }
    setWorkspaceId(value);
  };

  const submit = async function () {
    if (title.trim() === '') { showToast('请填写任务标题'); return; }
    if (prompt.trim() === '') { showToast('请填写任务文本'); return; }
    if (workspaceId === '' || workspaceId === NEW_WORKSPACE_SENTINEL) { showToast('请填写工作区'); return; }
    if (!hideSchedule && schedEnabled && schedMode !== 'interval' && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(schedTime.trim())) { showToast('请填写有效的执行时间（HH:MM）'); return; }
    if (!hideSchedule && schedEnabled && schedMode === 'daily' && schedRepeat === 'count' && (!/^\d+$/.test(schedCount.trim()) || Number(schedCount) < 1)) { showToast('请填写有效的执行次数'); return; }
    if (!hideSchedule && schedEnabled && schedMode === 'interval' && !validIntervalValue(schedInterval.trim(), schedIntervalUnit)) { showToast('循环间隔无效（最大 1 年）'); return; }
    setPending(true);
    let schedule;
    if (!hideSchedule && schedEnabled) {
      schedule = { enabled: true, mode: schedMode };
      if (schedMode === 'once' || schedMode === 'daily') schedule.time = schedTime.trim();
      if (schedMode === 'daily') {
        schedule.repeat = schedRepeat;
        if (schedRepeat === 'count') schedule.totalRuns = Number(schedCount.trim());
      }
      if (schedMode === 'interval') {
        schedule.interval = Number(schedInterval.trim());
        schedule.intervalUnit = schedIntervalUnit;
      }
    }
    const task = await controller.createTask({
      title: title,
      description: description,
      prompt: prompt,
      workspaceId: workspaceId === '' ? undefined : workspaceId,
      mode: mode === '' ? undefined : mode,
      permission: permission === '' ? undefined : permission,
      model: model,
      reasoning: reasoning,
      status: initialStatus === 'backlog' ? 'backlog' : 'todo',
      schedule: schedule,
    });
    setPending(false);
    if (task === undefined) { setError(controller.getSnapshot().transportError || '创建失败'); return; }
    if (autoRun) { await controller.runTask(task.id); }
    onClose();
  };

  return h('div', { className: 'dtb-modal-backdrop', onMouseDown: function (e) { if (e.target === e.currentTarget) onClose(); } },
    h('div', { className: 'dtb-modal' },
      h('h2', { className: 'dtb-modal-title' }, '新建任务'),
      h('label', { className: 'dtb-field' }, h('span', { className: 'dtb-field-label' }, '标题'), h('input', { className: 'dtb-input', value: title, autoFocus: true, placeholder: '任务标题', onChange: function (e) { setTitle(e.target.value); setError(undefined); } })),
      h('label', { className: 'dtb-field' }, h('span', { className: 'dtb-field-label' }, '描述'), h('textarea', { className: 'dtb-input', rows: 2, value: description, placeholder: '任务描述（可选）', onChange: function (e) { setDescription(e.target.value); } })),
      h('label', { className: 'dtb-field' }, h('span', { className: 'dtb-field-label' }, '任务文本（执行时发送给 DSH）'), h('textarea', { className: 'dtb-input', rows: 4, value: prompt, placeholder: '预先输入的文本，执行时作为 prompt 发送', onChange: function (e) { setPrompt(e.target.value); } })),
      h('label', { className: 'dtb-field' }, h('span', { className: 'dtb-field-label' }, '工作区'), h('select', { className: 'dtb-select', value: workspaceId, onChange: function (e) { onWorkspaceChange(e.target.value); } },
        h('option', { value: NEW_WORKSPACE_SENTINEL }, '新建工作区'),
        options.workspaces.map(function (w) { return h('option', { key: w.workspaceId, value: w.workspaceId }, w.title); }),
      )),
      h('div', { className: 'dtb-section' },
        h('h4', { className: 'dtb-section-title' }, 'Agent 预设'),
        h('div', { className: 'dtb-row' },
          h('label', { className: 'dtb-field', style: { flex: '1 1 auto' } }, h('span', { className: 'dtb-field-label' }, '模型'), h('select', { className: 'dtb-select', value: model, onChange: function (e) { setModel(e.target.value); } },
            MODEL_KINDS.map(function (k) { return h('option', { key: k, value: k }, MODEL_LABEL[k]); }),
          )),
          h('label', { className: 'dtb-field', style: { flex: '1 1 auto' } }, h('span', { className: 'dtb-field-label' }, '推理等级'), h('select', { className: 'dtb-select', value: reasoning, onChange: function (e) { setReasoning(e.target.value); } },
            REASONING_LEVELS.map(function (k) { return h('option', { key: k, value: k }, REASONING_LABEL[k]); }),
          )),
        ),
        h('label', { className: 'dtb-field' }, h('span', { className: 'dtb-field-label' }, '预设'), h('select', { className: 'dtb-select', value: mode, onChange: function (e) { setMode(e.target.value); } },
          options.presets.map(function (p) { return h('option', { key: p.id, value: p.id, disabled: p.broken !== undefined }, (p.name || p.id) + (p.broken !== undefined ? '（不可用）' : '')); }),
        )),
      ),
      h('label', { className: 'dtb-field' }, h('span', { className: 'dtb-field-label' }, '权限'), h('select', { className: 'dtb-select', value: permission, onChange: function (e) { setPermission(e.target.value); } },
        PERMISSIONS.map(function (id) { return h('option', { key: id, value: id }, PERMISSION_LABEL[id]); }),
      )),

      !hideSchedule ? h('div', { className: 'dtb-section' },
        h('h4', { className: 'dtb-section-title' }, '定时执行'),
        h('label', { className: 'dtb-toggle' }, h('input', { type: 'checkbox', checked: schedEnabled, onChange: function (e) { setSchedEnabled(e.target.checked); } }), '启用定时执行'),
        schedEnabled ? h('div', { style: { marginTop: 8 } },
          h('div', { className: 'dtb-row' },
            h('select', { className: 'dtb-select', value: schedMode, onChange: function (e) { setSchedMode(e.target.value); } },
              h('option', { value: 'once' }, '只执行一次'),
              h('option', { value: 'daily' }, '每天固定时间执行'),
              h('option', { value: 'interval' }, '循环执行'),
            ),
            schedMode === 'once' || schedMode === 'daily' ? h('input', { className: 'dtb-input', type: 'time', value: schedTime, style: { width: 130 }, onChange: function (e) { setSchedTime(e.target.value); } }) : null,
          ),
          schedMode === 'daily' ? h('div', { className: 'dtb-row', style: { marginTop: 6 } },
            h('select', { className: 'dtb-select', value: schedRepeat, onChange: function (e) { setSchedRepeat(e.target.value); } },
              h('option', { value: 'infinite' }, '每天执行'),
              h('option', { value: 'count' }, '固定次数'),
            ),
            schedRepeat === 'count' ? h('input', { className: 'dtb-input', type: 'number', min: 1, value: schedCount, style: { width: 90 }, placeholder: '次数', onChange: function (e) { setSchedCount(e.target.value); } }) : null,
          ) : null,
          schedMode === 'interval' ? h('div', { className: 'dtb-row', style: { marginTop: 6 } },
            h('input', { className: 'dtb-input', type: 'number', min: 1, value: schedInterval, style: { width: 90 }, placeholder: '间隔', onChange: function (e) { setSchedInterval(e.target.value); } }),
            h('select', { className: 'dtb-select', value: schedIntervalUnit, onChange: function (e) { setSchedIntervalUnit(e.target.value); } },
              INTERVAL_UNITS.map(function (u) { return h('option', { key: u, value: u }, INTERVAL_UNIT_LABEL[u]); }),
            ),
          ) : null,
          schedMode === 'daily' && schedRepeat === 'count' ? h('div', { className: 'dtb-kv', style: { marginTop: 6 } }, '每天在 ' + schedTime + ' 执行一次，共执行 ' + (schedCount || 1) + ' 次后自动停止。') : null,
          schedMode === 'daily' && schedRepeat === 'infinite' ? h('div', { className: 'dtb-kv', style: { marginTop: 6 } }, '每天 ' + schedTime + ' 执行一次。') : null,
          schedMode === 'once' ? h('div', { className: 'dtb-kv', style: { marginTop: 6 } }, '在下一个 ' + schedTime + ' 执行一次，之后自动停止。') : null,
          schedMode === 'interval' ? h('div', { className: 'dtb-kv', style: { marginTop: 6 } }, '每 ' + (schedInterval || 1) + ' ' + (INTERVAL_UNIT_LABEL[schedIntervalUnit] || schedIntervalUnit) + ' 执行一次（间隔最大 1 年）。') : null,
        ) : null,
      ) : null,

      error !== undefined ? h('div', { className: 'dtb-form-error' }, error) : null,
      h('div', { className: 'dtb-modal-footer' },
        h('button', { className: 'dtb-btn', type: 'button', onClick: onClose }, '取消'),
        h('button', { className: 'dtb-btn primary', type: 'button', disabled: pending, onClick: submit }, pending ? '创建中…' : '创建'),
      ),
    ),
  );
}

function EditModal({ task, controller, onClose }) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [prompt, setPrompt] = useState(task.prompt);
  const [workspaceId, setWorkspaceId] = useState(task.workspaceId || '');
  const [mode, setMode] = useState(task.mode || '');
  const [model, setModel] = useState(MODEL_KINDS.indexOf(task.model) !== -1 ? task.model : 'flash');
  const [reasoning, setReasoning] = useState(REASONING_LEVELS.indexOf(task.reasoning) !== -1 ? task.reasoning : 'off');
  const [permission, setPermission] = useState(task.permission || '');
  const s = task.schedule || { enabled: false, mode: 'once', time: '12:00', repeat: 'infinite', totalRuns: undefined, interval: 10, intervalUnit: 'minute' };
  const [schedEnabled, setSchedEnabled] = useState(s.enabled === true);
  const [schedMode, setSchedMode] = useState(function () {
    const m = s.mode;
    if (m === 'times') return 'daily'; // 旧版本迁移：times 并入 daily+count
    return SCHEDULE_MODE_LABEL[m] ? m : 'once';
  });
  const [schedTime, setSchedTime] = useState(s.time || '12:00');
  const [schedRepeat, setSchedRepeat] = useState(DAILY_REPEAT_LABEL[s.repeat] ? s.repeat : 'infinite');
  const [schedCount, setSchedCount] = useState(s.totalRuns !== undefined ? String(s.totalRuns) : '1');
  const [schedInterval, setSchedInterval] = useState(s.interval !== undefined ? String(s.interval) : '10');
  const [schedIntervalUnit, setSchedIntervalUnit] = useState(INTERVAL_UNITS.indexOf(s.intervalUnit) !== -1 ? s.intervalUnit : 'minute');
  const [error, setError] = useState(undefined);
  const options = controller.getSnapshot().options;
  const contentLocked = !(task.archivedAt === undefined && task.status !== 'running' && task.executions.length === 0);

  // 工作区下拉：选中「新建工作区」哨兵项时打开目录选择器并创建工作区，完成后选中新工作区（取消则恢复原值）
  const onWorkspaceChange = async function (value) {
    if (value === NEW_WORKSPACE_SENTINEL) {
      const previous = workspaceId;
      setWorkspaceId(NEW_WORKSPACE_SENTINEL);
      const ws = await controller.pickAndCreateWorkspace();
      setWorkspaceId(ws ? ws.workspaceId : previous);
      return;
    }
    setWorkspaceId(value);
  };

  const submit = async function () {
    if (title.trim() === '') { setError('标题不能为空'); return; }
    if (schedEnabled && schedMode !== 'interval' && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(schedTime.trim())) { setError('请填写有效时间（HH:MM）'); return; }
    if (schedEnabled && schedMode === 'daily' && schedRepeat === 'count' && (!/^\d+$/.test(schedCount.trim()) || Number(schedCount) < 1)) { setError('请填写有效次数'); return; }
    if (schedEnabled && schedMode === 'interval' && !validIntervalValue(schedInterval.trim(), schedIntervalUnit)) { setError('循环间隔无效（最大 1 年）'); return; }
    const patch = {};
    if (!contentLocked) { patch.title = title; patch.description = description; patch.prompt = prompt; }
    patch.workspaceId = workspaceId === '' ? undefined : workspaceId;
    patch.mode = mode === '' ? undefined : mode;
    patch.model = model;
    patch.reasoning = reasoning;
    patch.permission = permission === '' ? undefined : permission;
    const snap = await controller.updateTask(task.id, patch);
    if (snap === undefined) { setError(controller.getSnapshot().transportError || '保存失败'); return; }

    const currentSched = task.schedule || { enabled: false, mode: 'once', time: '12:00', repeat: 'infinite', totalRuns: undefined };
    const schedChanged = currentSched.enabled !== schedEnabled
      || currentSched.mode !== schedMode
      || currentSched.time !== schedTime.trim()
      || (schedMode === 'daily' && currentSched.repeat !== schedRepeat)
      || (schedMode === 'daily' && schedRepeat === 'count' && currentSched.totalRuns !== Number(schedCount.trim()))
      || (schedMode === 'interval' && currentSched.interval !== Number(schedInterval.trim()))
      || (schedMode === 'interval' && currentSched.intervalUnit !== schedIntervalUnit);
    if (schedChanged) {
      const schedPatch = { enabled: schedEnabled, mode: schedMode };
      if (schedMode === 'once' || schedMode === 'daily') schedPatch.time = schedTime.trim();
      if (schedMode === 'daily') {
        schedPatch.repeat = schedRepeat;
        if (schedRepeat === 'count') schedPatch.totalRuns = Number(schedCount.trim());
      }
      if (schedMode === 'interval') {
        schedPatch.interval = Number(schedInterval.trim());
        schedPatch.intervalUnit = schedIntervalUnit;
      }
      const snap2 = await controller.setSchedule(task.id, schedPatch);
      if (snap2 === undefined) { setError(controller.getSnapshot().transportError || '保存失败'); return; }
    }
    onClose();
  };

  return h('div', { className: 'dtb-modal-backdrop', onMouseDown: function (e) { if (e.target === e.currentTarget) onClose(); } },
    h('div', { className: 'dtb-modal' },
      h('h2', { className: 'dtb-modal-title' }, '编辑任务'),
      contentLocked ? h('div', { className: 'dtb-kv' }, '任务已执行过，标题/描述/任务文本只读；其余项可改。') : null,
      h('label', { className: 'dtb-field' }, h('span', { className: 'dtb-field-label' }, '标题'), h('input', { className: 'dtb-input', value: title, disabled: contentLocked, onChange: function (e) { setTitle(e.target.value); } })),
      h('label', { className: 'dtb-field' }, h('span', { className: 'dtb-field-label' }, '描述'), h('textarea', { className: 'dtb-input', rows: 2, value: description, disabled: contentLocked, onChange: function (e) { setDescription(e.target.value); } })),
      h('label', { className: 'dtb-field' }, h('span', { className: 'dtb-field-label' }, '任务文本'), h('textarea', { className: 'dtb-input', rows: 4, value: prompt, disabled: contentLocked, onChange: function (e) { setPrompt(e.target.value); } })),
      h('label', { className: 'dtb-field' }, h('span', { className: 'dtb-field-label' }, '工作区'), h('select', { className: 'dtb-select', value: workspaceId, onChange: function (e) { onWorkspaceChange(e.target.value); } },
        h('option', { value: NEW_WORKSPACE_SENTINEL }, '新建工作区'),
        options.workspaces.map(function (w) { return h('option', { key: w.workspaceId, value: w.workspaceId }, w.title); }),
      )),
      h('div', { className: 'dtb-section' },
        h('h4', { className: 'dtb-section-title' }, 'Agent 预设'),
        h('div', { className: 'dtb-row' },
          h('label', { className: 'dtb-field', style: { flex: '1 1 auto' } }, h('span', { className: 'dtb-field-label' }, '模型'), h('select', { className: 'dtb-select', value: model, onChange: function (e) { setModel(e.target.value); } },
            MODEL_KINDS.map(function (k) { return h('option', { key: k, value: k }, MODEL_LABEL[k]); }),
          )),
          h('label', { className: 'dtb-field', style: { flex: '1 1 auto' } }, h('span', { className: 'dtb-field-label' }, '推理等级'), h('select', { className: 'dtb-select', value: reasoning, onChange: function (e) { setReasoning(e.target.value); } },
            REASONING_LEVELS.map(function (k) { return h('option', { key: k, value: k }, REASONING_LABEL[k]); }),
          )),
        ),
        h('label', { className: 'dtb-field' }, h('span', { className: 'dtb-field-label' }, '预设'), h('select', { className: 'dtb-select', value: mode, onChange: function (e) { setMode(e.target.value); } },
          options.presets.map(function (p) { return h('option', { key: p.id, value: p.id, disabled: p.broken !== undefined }, (p.name || p.id)); }),
        )),
      ),
      h('label', { className: 'dtb-field' }, h('span', { className: 'dtb-field-label' }, '权限'), h('select', { className: 'dtb-select', value: permission, onChange: function (e) { setPermission(e.target.value); } },
        PERMISSIONS.map(function (id) { return h('option', { key: id, value: id }, PERMISSION_LABEL[id]); }),
      )),
      h('div', { className: 'dtb-section' },
        h('h4', { className: 'dtb-section-title' }, '定时执行'),
        h('label', { className: 'dtb-toggle' }, h('input', { type: 'checkbox', checked: schedEnabled, onChange: function (e) { setSchedEnabled(e.target.checked); } }), '启用定时执行'),
        schedEnabled ? h('div', { style: { marginTop: 8 } },
          h('div', { className: 'dtb-row' },
            h('select', { className: 'dtb-select', value: schedMode, onChange: function (e) { setSchedMode(e.target.value); } },
              h('option', { value: 'once' }, '只执行一次'),
              h('option', { value: 'daily' }, '每天固定时间执行'),
              h('option', { value: 'interval' }, '循环执行'),
            ),
            schedMode === 'once' || schedMode === 'daily' ? h('input', { className: 'dtb-input', type: 'time', value: schedTime, style: { width: 120 }, onChange: function (e) { setSchedTime(e.target.value); } }) : null,
          ),
          schedMode === 'daily' ? h('div', { className: 'dtb-row', style: { marginTop: 6 } },
            h('select', { className: 'dtb-select', value: schedRepeat, onChange: function (e) { setSchedRepeat(e.target.value); } },
              h('option', { value: 'infinite' }, '每天执行'),
              h('option', { value: 'count' }, '固定次数'),
            ),
            schedRepeat === 'count' ? h('input', { className: 'dtb-input', type: 'number', min: 1, value: schedCount, style: { width: 80 }, onChange: function (e) { setSchedCount(e.target.value); } }) : null,
          ) : null,
          schedMode === 'interval' ? h('div', { className: 'dtb-row', style: { marginTop: 6 } },
            h('input', { className: 'dtb-input', type: 'number', min: 1, value: schedInterval, style: { width: 80 }, placeholder: '间隔', onChange: function (e) { setSchedInterval(e.target.value); } }),
            h('select', { className: 'dtb-select', value: schedIntervalUnit, onChange: function (e) { setSchedIntervalUnit(e.target.value); } },
              INTERVAL_UNITS.map(function (u) { return h('option', { key: u, value: u }, INTERVAL_UNIT_LABEL[u]); }),
            ),
          ) : null,
        ) : null,
      ),
      error !== undefined ? h('div', { className: 'dtb-form-error' }, error) : null,
      h('div', { className: 'dtb-modal-footer' },
        h('button', { className: 'dtb-btn', type: 'button', onClick: onClose }, '取消'),
        h('button', { className: 'dtb-btn primary', type: 'button', onClick: submit }, '保存'),
      ),
    ),
  );
}

function Detail({ task, controller, onEdit }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isArchived = task.archivedAt !== undefined;
  const running = task.status === 'running' || task.executions.some(function (e) { return e.endedAt === undefined; });

  return h('div', { className: 'dtb-detail', onMouseDown: function (e) { if (e.target === e.currentTarget) controller.closeTask(); } },
    h('div', { className: 'dtb-detail-panel' },
      h('div', { className: 'dtb-row' },
        h('h2', { className: 'dtb-detail-title', style: { flex: '1 1 auto' } }, task.title),
        h('button', { className: 'dtb-btn', type: 'button', style: { flex: '0 0 auto' }, onClick: function () { controller.closeTask(); } }, '关闭'),
      ),
      h('div', { className: 'dtb-kv' }, '状态：' + (STATUS_LABEL[task.status] || task.status) + (isArchived ? '（已归档）' : '')),
      isArchived && task.archivedAt !== undefined ? h('div', { className: 'dtb-kv' }, '归档时间：' + formatTime(task.archivedAt)) : null,
      task.description ? h('p', { className: 'dtb-detail-desc' }, task.description) : null,
      task.prompt ? h('div', { className: 'dtb-detail-prompt' }, task.prompt) : null,
      task.workspaceId ? h('div', { className: 'dtb-kv' }, '工作区：' + workspaceTitle(task.workspaceId, controller.getSnapshot().options.workspaces)) : null,
      task.mode ? h('div', { className: 'dtb-kv' }, 'Agent 预设：' + presetName(task.mode, controller.getSnapshot().options.presets)) : null,
      h('div', { className: 'dtb-kv' }, '模型：' + (MODEL_LABEL[task.model] || task.model || 'Flash') + ' · 推理：' + (REASONING_LABEL[task.reasoning] || task.reasoning || 'Off')),
      task.permission ? h('div', { className: 'dtb-kv' }, '权限：' + (PERMISSION_LABEL[task.permission] || task.permission)) : null,

      h('div', { className: 'dtb-section' },
        h('h4', { className: 'dtb-section-title' }, '定时执行'),
        isArchived
          ? h('div', { className: 'dtb-kv' }, '已归档，定时已停用')
          : h('div', { className: 'dtb-kv' }, (task.schedule && task.schedule.enabled) ? scheduleSummary(task.schedule) : '未启用定时（点击「编辑」可修改）'),
      ),

      h('div', { className: 'dtb-section' },
        h('h4', { className: 'dtb-section-title' }, '执行历史（' + task.executions.length + '）'),
        task.executions.length === 0 ? h('div', { className: 'dtb-kv' }, '暂无执行记录') : null,
        task.executions.slice().reverse().map(function (ex) {
          const label = ex.result ? (RESULT_LABEL[ex.result] || ex.result) : '执行中';
          return h('div', { className: 'dtb-exec-item', key: ex.id },
            h('span', { className: 'dtb-exec-result ' + (ex.result || 'running') }, label),
            h('span', { className: 'dtb-exec-time' }, formatTime(ex.startedAt)),
            ex.sessionId ? h('span', { className: 'dtb-exec-session', title: ex.sessionId }, ex.sessionId) : null,
            ex.error ? h('span', { className: 'dtb-form-error', style: { margin: 0, flex: '1 1 auto' } }, ex.error) : null,
          );
        }),
      ),

      h('div', { className: 'dtb-modal-footer', style: { flexWrap: 'wrap' } },
        isArchived
          ? h(React.Fragment, null,
              h('button', { className: 'dtb-btn primary', type: 'button', onClick: function () { controller.restoreTask(task.id); } }, '恢复'),
              h('button', { className: 'dtb-btn danger', type: 'button', onClick: function () { setConfirmDelete(true); } }, '删除'),
            )
          : task.status === 'backlog'
            ? h(React.Fragment, null,
                h('button', { className: 'dtb-btn', type: 'button', onClick: function () { controller.moveTask(task.id, 'todo'); } }, '启动任务'),
                h('button', { className: 'dtb-btn primary', type: 'button', disabled: running, onClick: function () { controller.runTask(task.id); } }, '立即执行'),
                h('button', { className: 'dtb-btn', type: 'button', onClick: onEdit }, '编辑'),
                h('button', { className: 'dtb-btn danger', type: 'button', disabled: running, onClick: function () { setConfirmDelete(true); } }, '删除'),
              )
            : task.status === 'todo'
              ? h(React.Fragment, null,
                  h('button', { className: 'dtb-btn', type: 'button', onClick: function () { controller.moveTask(task.id, 'backlog'); } }, '暂停任务'),
                  h('button', { className: 'dtb-btn primary', type: 'button', disabled: running, onClick: function () { controller.runTask(task.id); } }, '立即执行'),
                  h('button', { className: 'dtb-btn', type: 'button', onClick: onEdit }, '编辑'),
                  h('button', { className: 'dtb-btn danger', type: 'button', disabled: running, onClick: function () { setConfirmDelete(true); } }, '删除'),
                )
              : task.status === 'running'
                ? h(React.Fragment, null,
                    h('button', { className: 'dtb-btn danger', type: 'button', onClick: function () { controller.cancelTask(task.id); } }, '终止任务'),
                  )
                : h(React.Fragment, null,
                    h('button', { className: 'dtb-btn', type: 'button', disabled: running, onClick: function () { controller.moveTask(task.id, 'todo'); } }, '重启任务'),
                    h('button', { className: 'dtb-btn primary', type: 'button', disabled: running, onClick: function () { controller.rerunTask(task.id); } }, '重新执行'),
                    h('button', { className: 'dtb-btn', type: 'button', onClick: onEdit }, '编辑'),
                    h('button', { className: 'dtb-btn', type: 'button', disabled: running, onClick: function () { controller.archiveTask(task.id, columnPosition(controller.getSnapshot().tasks, task.id)); } }, '归档'),
                    h('button', { className: 'dtb-btn danger', type: 'button', disabled: running, onClick: function () { setConfirmDelete(true); } }, '删除'),
                  ),
      ),
      confirmDelete ? h(ConfirmModal, {
        action: 'delete',
        message: '是否要删除该任务？',
        onConfirm: function () { controller.deleteTask(task.id); controller.closeTask(); },
        onCancel: function () { setConfirmDelete(false); },
      }) : null,
    ),
  );
}

function matchesFilter(task, filter) {
  const needle = filter.trim().toLowerCase();
  if (needle === '') return true;
  return task.title.toLowerCase().indexOf(needle) !== -1 || task.description.toLowerCase().indexOf(needle) !== -1;
}

function ConfirmModal({ action, message, onConfirm, onCancel }) {
  const text = message || ('是否' + selectionVerb(action) + '当前任务？');
  return h('div', { className: 'dtb-modal-backdrop', onMouseDown: function (e) { if (e.target === e.currentTarget) onCancel(); } },
    h('div', { className: 'dtb-modal', style: { width: 'min(360px, 100%)' } },
      h('h2', { className: 'dtb-modal-title' }, text),
      h('div', { className: 'dtb-modal-footer' },
        h('button', { className: 'dtb-btn', type: 'button', onClick: onCancel }, '取消'),
        h('button', { className: 'dtb-btn danger', type: 'button', onClick: onConfirm }, '确定'),
      ),
    ),
  );
}

function Board({ controller, snapshot }) {
  const [filter, setFilter] = useState('');
  const [newTaskCol, setNewTaskCol] = useState(undefined);
  const [selection, setSelection] = useState(undefined);
  const [selectionSelected, setSelectionSelected] = useState([]);
  const [selectionConfirm, setSelectionConfirm] = useState(false);
  const [batchArmed, setBatchArmed] = useState(false);
  const [batchSelected, setBatchSelected] = useState([]);
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState(undefined);
  const [failTagInfo, setFailTagInfo] = useState(undefined);
  const selected = snapshot.tasks.find(function (t) { return t.id === snapshot.selectedTaskId; });
  const humanTaskIds = new Set((snapshot.needsHuman || []).map(function (h) { return h.taskId; }));
  const failInfoFor = function (task) {
    if (task.status !== 'failed') return undefined;
    const ex = task.executions.slice().reverse().find(function (e) { return e.result === 'failed'; });
    if (ex === undefined) return undefined;
    return { label: failKindLabel(ex), error: ex.error || '（无详细信息）' };
  };
  const archiveView = snapshot.archiveView;
  const visible = snapshot.tasks.filter(function (task) {
    return (archiveView ? task.archivedAt !== undefined : task.archivedAt === undefined) && matchesFilter(task, filter);
  });
  // 归档分组：按归档时间降序 + 序号升序排序，再按年份分组（年份新的在前），年份内按日期分组
  const archiveYears = (function () {
    const sorted = visible.slice().sort(function (a, b) {
      const byTime = (b.archivedAt || 0) - (a.archivedAt || 0);
      if (byTime !== 0) return byTime;
      return (a.archiveSeq || 0) - (b.archiveSeq || 0);
    });
    const years = [];
    const yearMap = {};
    const dateMap = {};
    for (const task of sorted) {
      const y = new Date(task.archivedAt).getFullYear();
      if (!yearMap[y]) {
        yearMap[y] = { year: y, key: 'y' + y, groups: [] };
        years.push(yearMap[y]);
        dateMap[y] = {};
      }
      const key = archiveDateKey(task.archivedAt);
      const inner = dateMap[y];
      if (!inner[key]) {
        inner[key] = { key: key, label: archiveDateLabel(task.archivedAt), tasks: [] };
        yearMap[y].groups.push(inner[key]);
      }
      inner[key].tasks.push(task);
    }
    return years;
  })();
  const editingTask = editingTaskId !== undefined ? snapshot.tasks.find(function (t) { return t.id === editingTaskId; }) : undefined;

  const openNewTask = function (colStatus) { setNewTaskCol(colStatus); };
  // 列级删除/终止/归档：进入勾选模式 / 切换勾选 / 打开确认 / 批量执行
  const toggleSelection = function (colStatus, action) {
    if (selection && selection.col === colStatus && selection.action === action) {
      setSelection(undefined);
      setSelectionSelected([]);
      setSelectionConfirm(false);
    } else {
      setSelection({ col: colStatus, action: action });
      setSelectionSelected([]);
      setSelectionConfirm(false);
    }
  };
  const exitSelection = function () {
    setSelection(undefined);
    setSelectionSelected([]);
    setSelectionConfirm(false);
  };
  const toggleSelectTask = function (id) {
    setSelectionSelected(function (prev) {
      return prev.indexOf(id) === -1 ? prev.concat([id]) : prev.filter(function (x) { return x !== id; });
    });
  };
  const openSelectionConfirm = function () {
    if (selectionSelected.length === 0) {
      setSelection(undefined);
      setSelectionSelected([]);
      return;
    }
    setSelectionConfirm(true);
  };
  const doSelectionAction = async function () {
    const action = selection ? selection.action : undefined;
    if (!action) return;
    for (const id of selectionSelected) {
      if (action === 'delete') await controller.deleteTask(id);
      else if (action === 'archive') await controller.archiveTask(id, columnPosition(snapshot.tasks, id));
      else if (action === 'terminate') await controller.cancelTask(id);
    }
    setSelectionConfirm(false);
    setSelection(undefined);
    setSelectionSelected([]);
  };

  // 归档页批量删除：进入勾选模式 / 切换勾选 / 确认删除
  const toggleBatch = function () {
    if (batchArmed) setBatchSelected([]);
    setBatchArmed(!batchArmed);
  };
  const toggleBatchSelect = function (id) {
    setBatchSelected(function (prev) {
      return prev.indexOf(id) === -1 ? prev.concat([id]) : prev.filter(function (x) { return x !== id; });
    });
  };
  const confirmBatchDelete = async function () {
    for (const id of batchSelected) {
      await controller.deleteTask(id);
    }
    setBatchConfirm(false);
    setBatchArmed(false);
    setBatchSelected([]);
  };
  const toggleBatchSelectAll = function () {
    const ids = visible.map(function (t) { return t.id; });
    const allSelected = ids.length > 0 && ids.every(function (id) { return batchSelected.indexOf(id) !== -1; });
    setBatchSelected(allSelected ? [] : ids);
  };
  const batchAllSelected = visible.length > 0 && visible.every(function (t) { return batchSelected.indexOf(t.id) !== -1; });
  // 离开归档视图时复位批量模式
  useEffect(function () {
    if (!snapshot.archiveView) {
      setBatchArmed(false);
      setBatchSelected([]);
      setBatchConfirm(false);
    }
  }, [snapshot.archiveView]);

  return h('div', { className: 'dtb-overlay', 'data-dsh-taskboard-board': '', 'data-dsh-plugin': 'task-board' },
    h('div', { className: 'dtb-header' },
      h('button', { className: 'dtb-btn', type: 'button', onClick: function () { controller.closeBoard(); } }, '‹ 返回'),
      h('h2', { className: 'dtb-title' }, '任务看板'),
      snapshot.host ? h('span', { className: 'dtb-meta' }, 'rev ' + snapshot.host.revision + ' · ' + (snapshot.host.scheduler && snapshot.host.scheduler.timeZone)) : null,
      h('label', { className: 'dtb-toggle', style: { marginLeft: 10 } },
        h('input', { type: 'checkbox', checked: !snapshot.power || snapshot.power.enabled !== false, onChange: function (e) { controller.setSettings({ preventIdleSleep: e.target.checked }); } }),
        '阻止休眠',
      ),
      h('span', { className: 'dtb-spacer' }),
      h('input', { className: 'dtb-search', type: 'search', placeholder: '搜索标题/描述', value: filter, onChange: function (e) { setFilter(e.target.value); } }),
      h('button', { className: archiveView ? 'dtb-btn primary' : 'dtb-btn', type: 'button', onClick: function () { controller.toggleArchiveView(); } }, archiveView ? '返回看板' : '查看归档'),
    ),
    snapshot.transportError !== undefined ? h('div', { className: 'dtb-error' }, snapshot.transportError) : null,
    h('div', { className: 'dtb-columns' },
      archiveView
        ? h('div', { className: 'dtb-archive-wrap' },
            h('div', { className: 'dtb-column-head' },
              h('h3', { className: 'dtb-col-title' }, '已归档'),
              batchArmed ? h(React.Fragment, null,
                h('button', { className: 'dtb-col-btn', type: 'button', onClick: toggleBatchSelectAll }, batchAllSelected ? '取消全选' : '全选'),
                h('button', { className: 'dtb-col-btn', type: 'button', onClick: function () { setBatchArmed(false); setBatchSelected([]); setBatchConfirm(false); } }, '取消'),
              ) : null,
              h('button', { className: 'dtb-col-btn' + (batchArmed ? ' armed' : ''), type: 'button', onClick: batchArmed ? function () {
                if (batchSelected.length === 0) {
                  setBatchArmed(false);
                  setBatchSelected([]);
                  return;
                }
                setBatchConfirm(true);
              } : toggleBatch }, batchArmed ? '完成' : '批量删除'),
              h('span', { className: 'dtb-col-count' }, String(visible.length)),
            ),
            h('div', { className: 'dtb-archive-scroll' },
              visible.length === 0
                ? h('div', { className: 'dtb-empty' }, '暂无归档任务')
                : archiveYears.map(function (yearGroup) {
                    return h('div', { className: 'dtb-archive-year', key: yearGroup.key },
                      h('div', { className: 'dtb-year-head' }, yearGroup.year + '年'),
                      yearGroup.groups.map(function (group) {
                        return h('div', { className: 'dtb-archive-group', key: group.key },
                          h('div', { className: 'dtb-date-head' }, group.label),
                          h('div', { className: 'dtb-archive-grid' },
                            group.tasks.map(function (task) {
                              return h(Card, {
                                key: task.id,
                                task: task,
                                pending: snapshot.pendingTaskIds.indexOf(task.id) !== -1,
                                onClick: batchArmed ? function () { toggleBatchSelect(task.id); } : function () { controller.openTask(task.id); },
                                draggable: false,
                                selectionCheckbox: batchArmed,
                                checked: batchSelected.indexOf(task.id) !== -1,
                                onToggleCheck: function () { toggleBatchSelect(task.id); },
                              });
                            }),
                          ),
                        );
                      }),
                    );
                  }),
            ),
          )
        : COLUMNS.map(function (column) {
            const tasks = visible.filter(function (t) { return t.status === column.status; });
            const droppable = column.status === 'backlog' || column.status === 'todo';
            return h('div', {
              key: column.status, className: 'dtb-column', 'data-status': column.status,
              onDragOver: droppable ? function (e) { e.preventDefault(); } : undefined,
              onDrop: droppable ? function (e) {
                e.preventDefault();
                const taskId = e.dataTransfer.getData('text/plain');
                if (!taskId) return;
                const dropped = snapshot.tasks.find(function (t) { return t.id === taskId; });
                if (dropped && dropped.status !== column.status && dropped.status !== 'running') controller.moveTask(taskId, column.status);
              } : undefined,
            },
              h('div', { className: 'dtb-column-head' },
                h('span', { className: 'dtb-dot', 'data-status': column.status }),
                h('h3', { className: 'dtb-col-title' }, column.label),
                (selection && selection.col === column.status) ? h('button', { key: 'cancel', className: 'dtb-col-btn', type: 'button', onClick: exitSelection }, '取消') : null,
                (COLUMN_ACTIONS[column.status] || []).map(function (entry) {
                  if (entry.action === 'new') {
                    return h('button', { key: 'new', className: 'dtb-col-btn', type: 'button', onClick: function () { openNewTask(column.status); } }, entry.label);
                  }
                  const armed = selection && selection.col === column.status && selection.action === entry.action;
                  return h('button', {
                    key: entry.action,
                    className: 'dtb-col-btn' + (armed ? ' armed' : ''),
                    type: 'button',
                    onClick: armed ? openSelectionConfirm : function () { toggleSelection(column.status, entry.action); },
                  }, armed ? '完成' : entry.label);
                }),
                h('span', { className: 'dtb-col-count' }, String(tasks.length)),
              ),
              h('div', { className: 'dtb-cards' },
                tasks.map(function (task) {
                  const inSelection = selection && selection.col === column.status;
                  return h(Card, {
                    key: task.id,
                    task: task,
                    pending: snapshot.pendingTaskIds.indexOf(task.id) !== -1,
                    needsHuman: humanTaskIds.has(task.id),
                    failInfo: failInfoFor(task),
                    onFailTagClick: failInfoFor(task) ? function () { setFailTagInfo(failInfoFor(task)); } : undefined,
                    onClick: inSelection ? function () { toggleSelectTask(task.id); } : function () { controller.openTaskOrSession(task); },
                    onDetail: function () { controller.openTask(task.id); },
                    draggable: task.status !== 'running' && !inSelection,
                    onDragStart: function (e) { e.dataTransfer.setData('text/plain', task.id); },
                    selectionCheckbox: inSelection,
                    checked: selectionSelected.indexOf(task.id) !== -1,
                    onToggleCheck: function () { toggleSelectTask(task.id); },
                  });
                }),
                tasks.length === 0 ? h('div', { className: 'dtb-empty' }, '空') : null,
              ),
            );
          }),
    ),
    selected !== undefined ? h(Detail, { task: selected, controller: controller, onEdit: function () { setEditingTaskId(selected.id); } }) : null,
    editingTask !== undefined ? h(EditModal, { task: editingTask, controller: controller, onClose: function () { setEditingTaskId(undefined); } }) : null,
    newTaskCol !== undefined ? h(NewModal, {
      controller: controller,
      onClose: function () { setNewTaskCol(undefined); },
      initialStatus: newTaskCol,
      hideSchedule: newTaskCol === 'running',
      autoRun: newTaskCol === 'running',
    }) : null,
    selectionConfirm ? h(ConfirmModal, { message: '是否' + selectionVerb(selection.action) + '当前选中的任务？', onConfirm: doSelectionAction, onCancel: function () { setSelectionConfirm(false); } }) : null,
    batchConfirm ? h(ConfirmModal, { message: '是否删除所选已归档的任务？', onConfirm: confirmBatchDelete, onCancel: function () { setBatchConfirm(false); } }) : null,
    failTagInfo ? h('div', { className: 'dtb-modal-backdrop', onMouseDown: function (e) { if (e.target === e.currentTarget) setFailTagInfo(undefined); } },
      h('div', { className: 'dtb-modal', style: { width: 'min(440px, 100%)' } },
        h('h2', { className: 'dtb-modal-title' }, '失败原因：' + failTagInfo.label),
        h('div', { className: 'dtb-detail-prompt', style: { whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto' } }, failTagInfo.error),
        h('div', { className: 'dtb-modal-footer' },
          h('button', { className: 'dtb-btn primary', type: 'button', onClick: function () { setFailTagInfo(undefined); } }, '确定'),
        ),
      ),
    ) : null,
  );
}

function TaskBoardApp({ controller }) {
  const [snapshot, setSnapshot] = useState(controller.getSnapshot());
  useEffect(function () {
    return controller.subscribe(function () { setSnapshot(controller.getSnapshot()); });
  }, [controller]);
  if (!snapshot.boardOpen) return null;
  return h(Board, { controller: controller, snapshot: snapshot });
}

// ---------- 插件入口 ----------
module.exports = {
  async apply(ctx) {
    let slots = ctx.get('slots');
    for (let i = 0; slots === undefined && i < 60; i++) {
      await new Promise(function (resolve) { window.setTimeout(resolve, 300); });
      slots = ctx.get('slots');
    }
    if (slots === undefined) {
      console.warn('[dsh-task-board] slots 服务 18s 内未就绪，插件未注册');
      return;
    }

    let connection = ctx.get('connection');
    let sessionsSvc = ctx.get('sessions');
    for (let i = 0; sessionsSvc === undefined && i < 60; i++) {
      await new Promise(function (resolve) { window.setTimeout(resolve, 300); });
      sessionsSvc = ctx.get('sessions');
    }
    const controller = new Controller(connection ? connection.api : undefined, sessionsSvc);
    window.__dshTaskBoard = {
      toggle: function () { controller.toggleBoard(); },
      open: function () { controller.openBoard(); },
      close: function () { controller.closeBoard(); },
    };

    ctx.effect(function () {
      const disposeStyles = installStyles();
      return function () { disposeStyles(); };
    }, 'dsh-task-board: styles');

    ctx.effect(function () {
      const disposeEntry = mountSidebarEntry(controller);
      return function () { disposeEntry(); };
    }, 'dsh-task-board: sidebar entry');

    let dispose = null;
    function applyMode() {
      if (dispose) { dispose(); dispose = null; }
      dispose = slots.register(
        { name: 'shell.overlay', id: 'dsh-task-board', order: 20, label: 'DSCoder 任务看板' },
        function (slotProps) { return h(TaskBoardApp, { controller: controller }); },
      );
    }
    slots.inject('shell.overlay', function () {
      applyMode();
      return function () { if (dispose) { dispose(); dispose = null; } };
    });

    void controller.start();

    return function () {
      if (dispose) { dispose(); dispose = null; }
      controller.dispose();
      if (window.__dshTaskBoard) delete window.__dshTaskBoard;
    };
  },
};

return module.exports;
} });
