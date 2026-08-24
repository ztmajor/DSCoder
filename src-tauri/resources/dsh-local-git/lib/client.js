window.__ModuleLoader__.load({ id: "dsh-local-git", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
// dsh-local-git（本地快照版本管理）— client half（静态 bundle 形态）
// - rpc(method, args) → fetch POST /_dsh/dsh-local-git/<method>（JSON）
// - 注册到 shell.overlay，渲染底部可展开「本地版本管理」面板：
//   改动文件列表（增绿/删红/改蓝）+ 逐文件 diff + 提交信息 + 历史回退
// - 暴露 window.__dshLocalGit 给编辑器做行内 diff 着色（dsh-idelike 读取）
// - 首次检测工作区未启用时提示初始化；AI 每轮回复结束（sessionStats 投影稳定）后
//   若有改动则提示提交，可开启「自动提交」用默认信息自动提交
// - React 由 bundle 的 require('react') 提供（seed 模块）
'use strict';

const React = require('react');
const el = React.createElement;

const RPC_BASE = '/_dsh/dsh-local-git';
const RPC_TIMEOUT_MS = 20000;
const AUTO_COMMIT_MESSAGE = 'AI 修改';
const AI_TURN_SETTLE_MS = 1500;

// ---------- rpc ----------
function rpc(method, args, timeoutMs) {
  const controller = new AbortController();
  const timer = window.setTimeout(function () { controller.abort(); }, timeoutMs || RPC_TIMEOUT_MS);
  return fetch(RPC_BASE + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
    signal: controller.signal,
  }).then(function (res) {
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
  }).catch(function (err) {
    if (err && err.name === 'AbortError') throw new Error('请求超时');
    throw err;
  }).finally(function () { window.clearTimeout(timer); });
}

// ---------- 路径 / 工具 ----------
function relPathOf(ws, abs) {
  const w = String(ws || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const a = String(abs || '').replace(/\\/g, '/');
  if (!w || !a) return '';
  if (a === w) return '';
  if (a.indexOf(w + '/') === 0) return a.slice(w.length + 1);
  return '';
}

// 与 dsh-idelike 一致的工作区根解析逻辑。
function resolveWorkspaceRoot(items, currentSessionId, recentId) {
  const list = Array.isArray(items) ? items : [];
  if (currentSessionId) {
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (it && Array.isArray(it.sessionIds) && it.sessionIds.indexOf(currentSessionId) >= 0 && it.path) return it.path;
    }
  }
  if (recentId) {
    for (let i = 0; i < list.length; i++) {
      if (list[i] && list[i].workspaceId === recentId && list[i].path) return list[i].path;
    }
  }
  if (list.length > 0 && list[0] && list[0].path) return list[0].path;
  return '';
}

// ---------- 样式 ----------
function installStyles() {
  const id = 'dsh-local-git';
  if (document.querySelector('style[data-plugin-css="' + id + '"]')) return function () {};
  const style = document.createElement('style');
  style.dataset.plugin = id;
  style.dataset.pluginCss = id;
  style.textContent = `
    .dlg-root { position: fixed; left: 0; right: 0; bottom: 0; z-index: 44; pointer-events: none; font-family: var(--dsw-font-family, inherit); }
    .dlg-panel-toolbar {
      flex: 0 0 auto; display: flex; align-items: center; gap: 8px;
      padding: 6px 10px;
      border-bottom: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.08));
      font-size: 12px; color: var(--dsw-alias-label-primary, #0f1115);
    }
    .dlg-bar-count { color: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.9)); }
    .dlg-bar-count.dirty { color: var(--dsw-alias-state-warn-primary, #d97706); }
    .dlg-spacer { flex: 1 1 auto; }
    .dlg-btn {
      height: 22px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.12));
      border-radius: 4px; background: transparent; cursor: pointer; font-size: 12px; line-height: 1;
      color: var(--dsw-alias-label-primary, #0f1115); display: inline-flex; align-items: center; gap: 4px;
    }
    .dlg-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06)); }
    .dlg-btn.primary { color: #fff; background: var(--dsw-alias-state-info-primary, #2563eb); border-color: transparent; }
    .dlg-btn.primary:hover { background: var(--dsw-alias-state-info-hover, #1d4ed8); }
    .dlg-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .dlg-panel {
      pointer-events: auto; display: flex; flex-direction: column;
      height: clamp(240px, 42vh, 70vh);
      background: var(--dsw-alias-bg-base, #fff);
      border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.1));
      box-shadow: 0 -8px 30px rgba(0,0,0,0.12);
      font-size: 12.5px; color: var(--dsw-alias-label-primary, #0f1115);
    }
    .dlg-notice {
      flex: 0 0 auto; margin: 6px 10px 0; padding: 8px 10px; border-radius: 6px;
      background: var(--dsw-alias-state-info-hover, rgba(37,99,235,0.1));
      color: var(--dsw-alias-label-primary, #0f1115); font-size: 12px;
      display: flex; align-items: center; gap: 8px;
    }
    .dlg-error { color: var(--dsw-alias-state-error-primary, #dc2626); font-size: 12px; padding: 0 10px; }

    .dlg-main { flex: 1 1 auto; display: flex; min-height: 0; }
    .dlg-files {
      flex: 0 0 240px; min-width: 0; overflow-y: auto; border-right: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.08));
      padding: 4px 0;
    }
    .dlg-files-empty { padding: 12px 14px; color: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.9)); font-size: 12px; }
    .dlg-file-row {
      display: flex; align-items: center; gap: 7px; height: 26px; padding: 0 10px; cursor: pointer;
      white-space: nowrap; overflow: hidden; user-select: none;
    }
    .dlg-file-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06)); }
    .dlg-file-row.sel { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.08)); }
    .dlg-file-dot { flex: 0 0 auto; width: 14px; height: 14px; border-radius: 3px; font-size: 10px; font-weight: 700; line-height: 14px; text-align: center; color: #fff; }
    .dlg-file-row.add .dlg-file-dot { background: #22c55e; }
    .dlg-file-row.del .dlg-file-dot { background: #ef4444; }
    .dlg-file-row.chg .dlg-file-dot { background: #3b82f6; }
    .dlg-file-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; }
    .dlg-file-kind { flex: 0 0 auto; font-size: 11px; color: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.9)); }

    .dlg-diff-wrap { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
    .dlg-diff {
      flex: 1 1 auto; overflow: auto; margin: 0; padding: 4px 0;
      font-family: var(--dsw-font-mono, ui-monospace, 'Cascadia Code', Consolas, monospace);
      font-size: 12px; line-height: 1.5; white-space: pre; tab-size: 4;
    }
    .dlg-diff-line { display: flex; padding: 0 10px; }
    .dlg-diff-num { flex: 0 0 44px; text-align: right; padding-right: 10px; color: var(--dsw-alias-label-tertiary, #7f848e); user-select: none; }
    .dlg-diff-marker { flex: 0 0 16px; text-align: center; color: var(--dsw-alias-label-tertiary, #7f848e); user-select: none; }
    .dlg-diff-text { flex: 1 1 auto; white-space: pre-wrap; word-break: break-all; }
    .dlg-diff-line.add { background: rgba(34,197,94,0.14); }
    .dlg-diff-line.add .dlg-diff-marker { color: #16a34a; }
    .dlg-diff-line.del { background: rgba(239,68,68,0.14); }
    .dlg-diff-line.del .dlg-diff-marker { color: #dc2626; }
    .dlg-diff-line.del .dlg-diff-text { text-decoration: line-through; opacity: 0.7; }
    .dlg-diff-line.chg { background: rgba(59,130,246,0.14); }
    .dlg-diff-line.chg .dlg-diff-marker { color: #2563eb; }
    .dlg-diff-empty { padding: 12px 14px; color: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.9)); }

    .dlg-commit {
      flex: 0 0 auto; display: flex; flex-direction: column; gap: 6px; padding: 8px 10px;
      border-top: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.08));
    }
    .dlg-commit-row { display: flex; align-items: center; gap: 8px; }
    .dlg-msg {
      flex: 1 1 auto; height: 26px; padding: 4px 8px; resize: none; border-radius: 5px;
      border: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.14));
      background: var(--dsw-alias-bg-base, #fff); color: var(--dsw-alias-label-primary, #0f1115);
      font-size: 12px; font-family: inherit;
    }
    .dlg-msg:focus { outline: none; border-color: var(--dsw-alias-state-info-primary, #2563eb); }
    .dlg-toggle { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.9)); cursor: pointer; user-select: none; }
    .dlg-toggle input { margin: 0; }

    .dlg-history { flex: 0 0 auto; max-height: 120px; overflow-y: auto; border-top: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.08)); padding: 4px 0; }
    .dlg-history-title { padding: 4px 10px 0; font-size: 11px; color: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.9)); }
    .dlg-history-item { display: flex; align-items: center; gap: 8px; height: 24px; padding: 0 10px; }
    .dlg-history-msg { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dlg-history-time { flex: 0 0 auto; font-size: 11px; color: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.9)); }
  `;
  document.head.appendChild(style);
  return function () { style.remove(); };
}

// ---------- diff 行渲染 ----------
function renderDiffRows(diff) {
  if (!diff || !diff.ok) return null;
  const rows = [];
  let idx = 0;

  function row(marker, text, cls, newNo, oldNo) {
    rows.push(el('div', { className: 'dlg-diff-line ' + cls, key: 'r' + (idx++) },
      el('span', { className: 'dlg-diff-num' }, newNo != null ? String(newNo) : ''),
      el('span', { className: 'dlg-diff-num' }, oldNo != null ? String(oldNo) : ''),
      el('span', { className: 'dlg-diff-marker' }, marker),
      el('span', { className: 'dlg-diff-text' }, text === '' ? '\u00A0' : text),
    ));
  }

  if (diff.status === 'unchanged') {
    return el('div', { className: 'dlg-diff-empty' }, '无改动');
  }
  if (diff.status === 'added') {
    for (let i = 0; i < diff.newLines.length; i++) row('+', diff.newLines[i], 'add', i + 1, null);
    return rows;
  }
  if (diff.status === 'deleted') {
    for (let i = 0; i < diff.oldLines.length; i++) row('-', diff.oldLines[i], 'del', null, i + 1);
    return rows;
  }
  if (diff.status === 'modified') {
    const ops = Array.isArray(diff.ops) ? diff.ops : [];
    let oldNo = 1;
    let newNo = 1;
    for (const op of ops) {
      if (op.kind === 'equal') {
        for (let k = 0; k < op.newCount; k++) { row(' ', diff.newLines[op.newStart + k], 'ctx', newNo, oldNo); oldNo++; newNo++; }
      } else if (op.kind === 'insert') {
        for (let k = 0; k < op.newCount; k++) { row('+', diff.newLines[op.newStart + k], 'add', newNo, null); newNo++; }
      } else if (op.kind === 'delete') {
        for (let k = 0; k < op.oldCount; k++) { row('-', diff.oldLines[op.oldStart + k], 'del', null, oldNo); oldNo++; }
      } else if (op.kind === 'replace') {
        for (let k = 0; k < op.oldCount; k++) { row('-', diff.oldLines[op.oldStart + k], 'del', null, oldNo); oldNo++; }
        for (let k = 0; k < op.newCount; k++) { row('~', diff.newLines[op.newStart + k], 'chg', newNo, null); newNo++; }
      }
    }
    if (rows.length === 0) return el('div', { className: 'dlg-diff-empty' }, '无改动');
    return rows;
  }
  return null;
}

function formatTime(ts) {
  try {
    const d = new Date(ts);
    const p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  } catch (e) {
    return '';
  }
}

// ---------- 主面板组件 ----------
function LocalGitPanel(props) {
  const wsItems = props.useWorkspaces ? props.useWorkspaces(function (s) { return s.items; }) : [];
  const recentId = props.useWorkspaces ? props.useWorkspaces(function (s) { return s.recentWorkspaceId; }) : undefined;
  const currentSessionId = props.useSessions ? props.useSessions(function (s) { return s.current; }) : undefined;
  const statsProj = props.useProjection ? props.useProjection('sessionStats') : undefined;

  const workspace = resolveWorkspaceRoot(wsItems, currentSessionId, recentId);

  const [enabled, setEnabled] = React.useState(false);
  const [status, setStatus] = React.useState(null); // { added, deleted, modified, head }
  const [commits, setCommits] = React.useState([]);
  const [expanded, setExpanded] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [selected, setSelected] = React.useState(null);
  const [diff, setDiff] = React.useState(null);
  const [autoCommit, setAutoCommit] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [promptTurn, setPromptTurn] = React.useState(false);

  const autoCommitRef = React.useRef(autoCommit);
  autoCommitRef.current = autoCommit;
  const promptedKeyRef = React.useRef('');
  const lastTurnKeyRef = React.useRef('');

  const refreshStatus = React.useCallback(function (ws) {
    return rpc('status', { workspace: ws }).then(function (r) {
      if (r && r.ok) setStatus({ added: r.added || [], deleted: r.deleted || [], modified: r.modified || [], head: r.head });
      return r;
    }).catch(function () { return null; });
  }, []);

  const loadLog = React.useCallback(function (ws) {
    rpc('log', { workspace: ws }).then(function (r) {
      if (r && r.ok) setCommits(r.commits || []);
    }).catch(function () { /* 历史拉取失败静默 */ });
  }, []);

  // 工作区变化：检测是否启用；启用则拉取状态与历史。
  React.useEffect(function () {
    if (!workspace) { setEnabled(false); setStatus(null); setCommits([]); return; }
    let active = true;
    rpc('enabled', { workspace: workspace }).then(function (r) {
      if (!active) return;
      const ok = !!(r && r.enabled);
      setEnabled(ok);
      if (ok) { refreshStatus(workspace); loadLog(workspace); }
      else setStatus(null);
    }).catch(function () { if (active) { setEnabled(false); setStatus(null); } });
    return function () { active = false; };
  }, [workspace, refreshStatus, loadLog]);

  function doInit() {
    setBusy(true);
    rpc('init', { workspace: workspace }).then(function (r) {
      setBusy(false);
      if (r && r.ok) { setEnabled(true); refreshStatus(workspace); loadLog(workspace); setError(null); }
      else setError((r && r.error) || '初始化失败');
    }).catch(function (e) { setBusy(false); setError(String((e && e.message) || e)); });
  }

  function doRefresh() {
    if (!workspace) return;
    refreshStatus(workspace);
    loadLog(workspace);
  }

  function doCommit(msg) {
    const text = (msg != null ? msg : message).trim();
    if (!text) { setError('请填写提交信息'); setExpanded(true); return; }
    setBusy(true);
    rpc('commit', { workspace: workspace, message: text }).then(function (r) {
      setBusy(false);
      if (r && r.ok) { setMessage(''); setError(null); setPromptTurn(false); refreshStatus(workspace); loadLog(workspace); }
      else setError((r && r.error) || '提交失败');
    }).catch(function (e) { setBusy(false); setError(String((e && e.message) || e)); });
  }

  function selectFile(rel) {
    setSelected(rel);
    setDiff(null);
    rpc('diffFile', { workspace: workspace, relPath: rel }).then(function (r) {
      if (r && r.ok) setDiff(r);
      else setDiff(null);
    }).catch(function () { setDiff(null); });
  }

  function doRollback(id) {
    if (!window.confirm('回退将用该提交的文件内容覆盖当前工作区文件（历史仍保留，回退结果可再提交）。确定继续？')) return;
    setBusy(true);
    rpc('rollback', { workspace: workspace, commitId: id }).then(function (r) {
      setBusy(false);
      if (r && r.ok) { setError(null); refreshStatus(workspace); loadLog(workspace); }
      else setError((r && r.error) || '回退失败');
    }).catch(function (e) { setBusy(false); setError(String((e && e.message) || e)); });
  }

  // AI 回合结束检测：sessionStats 稳定 1.5s 后，若有改动 → 提示提交或自动提交。
  React.useEffect(function () {
    if (!workspace || !enabled) return undefined;
    if (!statsProj) return undefined;
    const key = String(statsProj.turns || '') + ':' + String(statsProj.steps || '') + ':' + String(statsProj.decodeTokens || '');
    if (key === lastTurnKeyRef.current) return undefined;
    lastTurnKeyRef.current = key;
    const timer = window.setTimeout(function () {
      if (promptedKeyRef.current === lastTurnKeyRef.current) return;
      promptedKeyRef.current = lastTurnKeyRef.current;
      rpc('status', { workspace: workspace }).then(function (r) {
        if (!r || !r.ok) return;
        const count = (r.added || []).length + (r.deleted || []).length + (r.modified || []).length;
        if (count === 0) return;
        if (autoCommitRef.current) {
          rpc('commit', { workspace: workspace, message: AUTO_COMMIT_MESSAGE }).then(function (cr) {
            if (cr && cr.ok) { refreshStatus(workspace); loadLog(workspace); }
          }).catch(function () { /* 自动提交失败静默 */ });
        } else {
          setPromptTurn(true);
          setExpanded(true);
        }
      }).catch(function () { /* 状态拉取失败静默 */ });
    }, AI_TURN_SETTLE_MS);
    return function () { window.clearTimeout(timer); };
  }, [workspace, enabled, statsProj && statsProj.turns, statsProj && statsProj.steps, statsProj && statsProj.decodeTokens, refreshStatus, loadLog]);

  // 监听顶部标签栏图标按钮的切换事件（由 dsh-idelike 通过 window.__dshLocalGit.toggle 触发）。
  React.useEffect(function () {
    function onToggle() { setExpanded(function (v) { return !v; }); }
    window.addEventListener('dsh-local-git:toggle', onToggle);
    return function () { window.removeEventListener('dsh-local-git:toggle', onToggle); };
  }, []);

  // 面板展开/收起变化时广播可见性，供顶部图标按钮同步激活态。
  React.useEffect(function () {
    try {
      window.dispatchEvent(new CustomEvent('dsh-local-git:visibility', { detail: { open: expanded } }));
    } catch (e) { /* 忽略 */ }
  }, [expanded]);

  if (!workspace) return null;

  const changed = status ? (status.added || []).length + (status.deleted || []).length + (status.modified || []).length : 0;

  // 面板工具条：状态文本 + 动作按钮（已启用显示刷新，未启用显示启用按钮）。
  const toolbar = el('div', { className: 'dlg-panel-toolbar' },
    el('span', { className: 'dlg-bar-count' + (enabled && changed > 0 ? ' dirty' : '') },
      enabled ? (changed > 0 ? changed + ' 个改动' : '无改动') : '未启用本地版本管理'),
    el('span', { className: 'dlg-spacer' }),
    enabled
      ? el('button', { className: 'dlg-btn', type: 'button', onClick: doRefresh }, '刷新')
      : el('button', { className: 'dlg-btn primary', type: 'button', onClick: doInit, disabled: busy }, '启用本地版本管理'),
  );

  let panelBody = null;
  if (!enabled) {
    panelBody = el(React.Fragment, null,
      error ? el('div', { className: 'dlg-error' }, error) : null,
      el('div', { className: 'dlg-diff-empty' }, '启用后会把当前工作区内容作为 init 基线快照保存，之后每次改动都可提交并回退。'),
    );
  } else {
    const files = [];
    (status ? status.added : []).forEach(function (rel) { files.push({ rel: rel, kind: 'add' }); });
    (status ? status.deleted : []).forEach(function (rel) { files.push({ rel: rel, kind: 'del' }); });
    (status ? status.modified : []).forEach(function (rel) { files.push({ rel: rel, kind: 'chg' }); });

    const fileList = files.length === 0
      ? el('div', { className: 'dlg-files-empty' }, '没有改动')
      : files.map(function (f) {
        const cls = f.kind === 'add' ? 'add' : f.kind === 'del' ? 'del' : 'chg';
        const label = f.kind === 'add' ? '新增' : f.kind === 'del' ? '删除' : '修改';
        return el('div', {
          key: f.kind + ':' + f.rel,
          className: 'dlg-file-row ' + cls + (selected === f.rel ? ' sel' : ''),
          onClick: function () { selectFile(f.rel); },
        },
          el('span', { className: 'dlg-file-dot' }, f.kind === 'add' ? 'A' : f.kind === 'del' ? 'D' : 'M'),
          el('span', { className: 'dlg-file-name', title: f.rel }, f.rel),
          el('span', { className: 'dlg-file-kind' }, label),
        );
      });

    panelBody = el(React.Fragment, null,
      promptTurn ? el('div', { className: 'dlg-notice' },
        el('span', null, 'AI 本轮修改完成，是否需要提交这些改动？'),
        el('span', { className: 'dlg-spacer' }),
        el('button', { className: 'dlg-btn', type: 'button', onClick: function () { setPromptTurn(false); } }, '暂不'),
      ) : null,
      error ? el('div', { className: 'dlg-error' }, error) : null,
      el('div', { className: 'dlg-main' },
        el('div', { className: 'dlg-files' }, fileList),
        el('div', { className: 'dlg-diff-wrap' },
          el('div', { className: 'dlg-diff' },
            selected ? renderDiffRows(diff) : el('div', { className: 'dlg-diff-empty' }, '选择左侧文件查看改动')),
        ),
      ),
      el('div', { className: 'dlg-commit' },
        el('div', { className: 'dlg-commit-row' },
          el('textarea', {
            className: 'dlg-msg', rows: 1, placeholder: '提交信息（例如：修复登录、新增组件…）',
            value: message, onChange: function (e) { setMessage(e.target.value); },
          }),
          el('button', {
            className: 'dlg-btn primary', type: 'button', disabled: changed === 0 || busy,
            onClick: function () { doCommit(message); },
          }, busy ? '提交中…' : '提交'),
        ),
        el('div', { className: 'dlg-commit-row' },
          el('label', { className: 'dlg-toggle' },
            el('input', {
              type: 'checkbox', checked: autoCommit,
              onChange: function (e) { setAutoCommit(e.target.checked); },
            }),
            'AI 修改后自动提交（默认信息：' + AUTO_COMMIT_MESSAGE + '）'),
        ),
      ),
      commits.length > 0 ? el('div', { className: 'dlg-history' },
        el('div', { className: 'dlg-history-title' }, '提交历史（点击「回退」恢复到该版本的工作区文件）'),
        commits.map(function (c) {
          return el('div', { className: 'dlg-history-item', key: c.id },
            el('span', { className: 'dlg-history-msg', title: c.message }, c.message),
            el('span', { className: 'dlg-history-time' }, formatTime(c.ts)),
            el('button', { className: 'dlg-btn', type: 'button', onClick: function () { doRollback(c.id); } }, '回退'),
          );
        }),
      ) : null,
    );
  }

  return el('div', { className: 'dlg-root' },
    expanded ? el('div', { className: 'dlg-panel' }, toolbar, panelBody) : null,
  );
}

// ---------- 编辑器桥接（供 dsh-idelike 行内着色使用） ----------
const localGitBridge = {
  diffFile: function (args) {
    const ws = args && args.workspace;
    const abs = (args && (args.absPath || args.path)) || '';
    const content = args && args.content;
    if (!ws || !abs) return Promise.resolve({ ok: false, status: 'unchanged', lineTypes: [], deletionMarkers: [] });
    const rel = relPathOf(ws, abs);
    if (!rel) return Promise.resolve({ ok: false, status: 'unchanged', lineTypes: [], deletionMarkers: [] });
    return rpc('diffFile', { workspace: ws, relPath: rel, content: content });
  },
  toggle: function () {
    try { window.dispatchEvent(new CustomEvent('dsh-local-git:toggle')); } catch (e) { /* 忽略 */ }
  },
};

module.exports = {
  async apply(ctx) {
    let slots = ctx.get('slots');
    for (let i = 0; slots === undefined && i < 60; i++) {
      await new Promise(function (resolve) { window.setTimeout(resolve, 300); });
      slots = ctx.get('slots');
    }
    if (slots === undefined) {
      console.warn('[dsh-local-git] slots 服务 18s 内未就绪，插件未注册');
      return;
    }

    // 暴露桥接给编辑器（尽早可用）。
    window.__dshLocalGit = localGitBridge;

    ctx.effect(function () {
      const disposeStyles = installStyles();
      return function () { disposeStyles(); };
    }, 'dsh-local-git: styles');

    let dispose = null;
    function applyMode() {
      if (dispose) { dispose(); dispose = null; }
      dispose = slots.register(
        { name: 'shell.overlay', id: 'dsh-local-git', order: 10, label: 'DSCoder 本地版本管理' },
        function (slotProps) {
          return el(LocalGitPanel, slotProps);
        },
      );
    }

    slots.inject('shell.overlay', function () {
      applyMode();
      return function () { if (dispose) { dispose(); dispose = null; } };
    });

    return function () {
      if (dispose) { dispose(); dispose = null; }
      if (window.__dshLocalGit === localGitBridge) delete window.__dshLocalGit;
    };
  },
};

return module.exports;
} });
