// dsh-tabs-terminal（文件树 + 标签页 + 终端插件）— client half（静态 bundle 形态）
// - rpc(method, args) → fetch POST /_dsh/dsh-tabs-terminal/<method>（JSON）
// - 注册到 shell.overlay（frame 级浮动层），渲染：顶部标签栏 / 左侧文件树 / 只读文件查看 / 底部终端 / 目录选择器
// - 顶部标签栏：第一个是"聊天"标签（不可关闭，点击回到官方对话界面）；打开的文件各占一个可关闭标签
// - 文件树根目录：当前 DSH 工作区目录（无工作区时回退到用户主目录），可经"打开文件夹"换根
// - 快捷键：Ctrl + ` 切换终端（与 VS Code 一致）
// - React 由 bundle 的 require('react') 提供（seed 模块）
'use strict';

const React = require('react');

const RPC_BASE = '/_dsh/dsh-tabs-terminal';
const RPC_TIMEOUT_MS = 20000;
const TERM_POLL_MS = 120;       // 终端输出轮询间隔
const MAX_DISPLAY_CHARS = 128 * 1024; // 客户端终端显示缓冲上限
const TAB_BAR_HEIGHT = 34;      // 顶部标签栏高度 px
const TREE_DEFAULT_WIDTH = 240; // 文件树默认宽度 px
const TREE_MIN_WIDTH = 180;
const TREE_MAX_WIDTH = 520;
const CHAT_TAB_KEY = '__chat__'; // 非关闭"聊天"标签的稳定标识

// rpc(method, args, timeoutMs)：POST JSON；超时/解析失败抛可读错误。
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

// 去除 ANSI 转义序列（终端颜色码在纯文本展示下会乱码；MVP 不做颜色渲染）。
function stripAnsi(s) {
  return String(s)
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\u001b\][^\u0007]*(\u0007|\u001b\\)/g, '');
}

function basenameOf(p) {
  const parts = String(p).split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

function installStyles() {
  const id = 'dsh-tabs-terminal';
  const existing = document.querySelector('style[data-plugin-css="' + id + '"]');
  if (existing !== null) return function () {};
  const style = document.createElement('style');
  style.dataset.plugin = 'dsh-tabs-terminal';
  style.dataset.pluginCss = id;
  style.textContent = `
    /* 应用容器 box-sizing 便于内部 padding（顶部标签栏 + 左侧文件树）不撑破 100% 高度 */
    #root { box-sizing: border-box; }

    .dtt-root { position: fixed; inset: 0; pointer-events: none; z-index: 40; font-family: var(--dsw-font-family, inherit); }

    /* ---------- 顶部标签栏 ---------- */
    .dtt-tabbar {
      position: fixed; top: 0; left: 0; right: 0; height: ${TAB_BAR_HEIGHT}px;
      display: flex; align-items: center; gap: 3px; padding: 0 8px;
      background: var(--dsw-alias-bg-base, #fff);
      border-bottom: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.1));
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
      pointer-events: auto; overflow-x: auto; overflow-y: hidden;
      font-size: 12px; line-height: 1; scrollbar-width: thin; z-index: 40;
    }
    .dtt-tab {
      flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px;
      height: 24px; max-width: 200px; padding: 0 8px; border-radius: 5px;
      color: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.9));
      cursor: pointer; white-space: nowrap; user-select: none;
      border: 1px solid transparent;
    }
    .dtt-tab:hover { background: var(--dsw-alias-bg-hover, rgba(0,0,0,0.05)); }
    .dtt-tab.active {
      color: var(--dsw-alias-label-primary, #0f1115);
      background: var(--dsw-alias-bg-hover, rgba(0,0,0,0.07));
      border-color: var(--dsw-alias-border-l3, rgba(0,0,0,0.12));
    }
    .dtt-tab-label { overflow: hidden; text-overflow: ellipsis; }
    .dtt-tab-chat { font-weight: 600; }
    .dtt-file-icon { flex: 0 0 auto; opacity: 0.7; }
    .dtt-tab-close {
      flex: 0 0 auto; width: 16px; height: 16px; padding: 0; border: none; border-radius: 3px;
      background: transparent; color: inherit; cursor: pointer; font-size: 14px; line-height: 1;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .dtt-tab-close:hover { background: rgba(0,0,0,0.15); color: var(--dsw-alias-label-primary, #0f1115); }
    .dtt-tabbar-btn {
      flex: 0 0 auto; height: 24px; min-width: 24px; padding: 0 7px; border: 1px solid transparent;
      border-radius: 5px; background: transparent; cursor: pointer;
      color: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.9));
      font-size: 14px; line-height: 1; display: inline-flex; align-items: center; justify-content: center;
    }
    .dtt-tabbar-btn:hover { background: var(--dsw-alias-bg-hover, rgba(0,0,0,0.05)); color: var(--dsw-alias-label-primary, #0f1115); }
    .dtt-tabbar-btn.active { color: var(--dsw-alias-label-primary, #0f1115); background: var(--dsw-alias-bg-hover, rgba(0,0,0,0.08)); }
    .dtt-spacer { flex: 1 1 auto; }

    /* ---------- 左侧文件树 ---------- */
    .dtt-tree {
      position: fixed; top: ${TAB_BAR_HEIGHT}px; left: 0; bottom: 0; width: ${TREE_DEFAULT_WIDTH}px;
      display: flex; flex-direction: column; pointer-events: auto; z-index: 39;
      background: var(--dsw-alias-bg-base, #fff);
      border-right: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.1));
      font-size: 12.5px; color: var(--dsw-alias-label-primary, #0f1115);
    }
    .dtt-tree-header {
      flex: 0 0 auto; display: flex; align-items: center; gap: 4px; padding: 6px 8px;
      border-bottom: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.08));
      font-size: 11px; color: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.9));
      text-transform: uppercase; letter-spacing: 0.04em;
    }
    .dtt-tree-title { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .dtt-tree-btn {
      flex: 0 0 auto; height: 20px; min-width: 20px; padding: 0 5px; border: 1px solid transparent;
      border-radius: 4px; background: transparent; cursor: pointer; font-size: 12px; line-height: 1;
      color: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.9));
      display: inline-flex; align-items: center; justify-content: center;
    }
    .dtt-tree-btn:hover { background: var(--dsw-alias-bg-hover, rgba(0,0,0,0.06)); color: var(--dsw-alias-label-primary, #0f1115); }
    .dtt-tree-scroll { flex: 1 1 auto; overflow: auto; padding: 4px 0; }
    .dtt-tree-row {
      display: flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px;
      cursor: pointer; white-space: nowrap; overflow: hidden; user-select: none;
      color: var(--dsw-alias-label-primary, #0f1115);
    }
    .dtt-tree-row:hover { background: var(--dsw-alias-bg-hover, rgba(0,0,0,0.06)); }
    .dtt-tree-row.dtt-tree-row-dir { font-weight: 500; }
    .dtt-tree-arrow { flex: 0 0 auto; width: 12px; text-align: center; color: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.8)); font-size: 10px; }
    .dtt-tree-icon { flex: 0 0 auto; opacity: 0.75; }
    .dtt-tree-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; }
    .dtt-tree-empty, .dtt-tree-error, .dtt-tree-loading { padding: 10px 14px; color: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.9)); font-size: 12px; }
    .dtt-tree-error { color: var(--dsw-alias-state-error-primary, #dc2626); }
    .dtt-tree-resize {
      position: fixed; top: ${TAB_BAR_HEIGHT}px; bottom: 0; width: 5px; cursor: col-resize; z-index: 40;
      background: transparent; pointer-events: auto;
    }
    .dtt-tree-resize:hover { background: rgba(0,0,0,0.08); }

    /* ---------- 只读文件查看 ---------- */
    .dtt-reader {
      position: fixed; top: ${TAB_BAR_HEIGHT}px; left: 0; right: 0; bottom: 0;
      display: flex; flex-direction: column; pointer-events: auto;
      background: var(--dsw-alias-bg-base, #fff); z-index: 38;
    }
    .dtt-reader-header {
      flex: 0 0 auto; display: flex; align-items: center; gap: 10px; padding: 6px 12px;
      border-bottom: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.1));
      font-size: 12px; color: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.9));
    }
    .dtt-reader-title { color: var(--dsw-alias-label-primary, #0f1115); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dtt-reader-body {
      flex: 1 1 auto; overflow: auto; margin: 0; padding: 12px 16px;
      font-family: var(--dsw-font-mono, ui-monospace, 'Cascadia Code', 'JetBrains Mono', Consolas, monospace);
      font-size: 12.5px; line-height: 1.55; color: var(--dsw-alias-label-primary, #0f1115);
      white-space: pre; tab-size: 4;
    }
    .dtt-reader-error { margin: 16px; padding: 12px; border-radius: 8px; color: var(--dsw-alias-state-error-primary, #dc2626); background: rgba(220,38,38,0.08); font-size: 13px; }
    .dtt-reader-loading { margin: 16px; color: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.9)); font-size: 13px; }

    /* ---------- 终端面板 ---------- */
    .dtt-terminal {
      position: fixed; left: 0; right: 0; bottom: 0;
      height: clamp(180px, 40vh, 70vh);
      display: flex; flex-direction: column; pointer-events: auto; z-index: 42;
      background: #0d1117; color: #e6edf3; border-top: 1px solid rgba(255,255,255,0.12);
      font-family: var(--dsw-font-mono, ui-monospace, 'Cascadia Code', Consolas, monospace);
    }
    .dtt-term-header {
      flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 4px 10px;
      background: #161b22; font-size: 12px; color: #8b949e; border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .dtt-term-title { color: #e6edf3; font-weight: 600; }
    .dtt-term-btn {
      height: 20px; padding: 0 8px; border: 1px solid rgba(255,255,255,0.15); border-radius: 4px;
      background: transparent; color: #c9d1d9; cursor: pointer; font-size: 11px;
    }
    .dtt-term-btn:hover { background: rgba(255,255,255,0.08); }
    .dtt-term-output {
      flex: 1 1 auto; overflow: auto; margin: 0; padding: 8px 10px;
      font-size: 12.5px; line-height: 1.45; white-space: pre-wrap; word-break: break-all;
    }
    .dtt-term-input {
      flex: 0 0 auto; display: flex; align-items: center; gap: 6px; padding: 6px 10px;
      border-top: 1px solid rgba(255,255,255,0.08); background: #161b22;
    }
    .dtt-term-prompt { color: #58a6ff; font-size: 12.5px; }
    .dtt-term-input input {
      flex: 1 1 auto; border: none; outline: none; background: transparent; color: #e6edf3;
      font-family: inherit; font-size: 12.5px; line-height: 1.45; caret-color: #e6edf3;
    }
    .dtt-term-hint { color: #8b949e; font-size: 11px; padding: 0 10px 6px; background: #161b22; }

    /* ---------- 目录选择器 ---------- */
    .dtt-picker-mask {
      position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.4); pointer-events: auto; z-index: 50;
    }
    .dtt-picker {
      width: min(600px, 92vw); height: min(440px, 82vh); display: flex; flex-direction: column;
      background: var(--dsw-alias-bg-base, #fff); border-radius: 10px; overflow: hidden;
      border: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.12));
      box-shadow: 0 12px 40px rgba(0,0,0,0.25);
    }
    .dtt-picker-header {
      flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 8px 12px;
      border-bottom: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.1)); font-size: 12px;
    }
    .dtt-picker-path { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.9)); }
    .dtt-picker-btn {
      flex: 0 0 auto; height: 24px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.12));
      border-radius: 5px; background: transparent; cursor: pointer; font-size: 12px;
      color: var(--dsw-alias-label-primary, #0f1115);
    }
    .dtt-picker-btn:hover { background: var(--dsw-alias-bg-hover, rgba(0,0,0,0.05)); }
    .dtt-picker-btn.primary { color: #fff; background: var(--dsw-alias-state-info-primary, #2563eb); border-color: transparent; }
    .dtt-picker-btn.primary:hover { background: var(--dsw-alias-state-info-hover, #1d4ed8); }
    .dtt-picker-btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .dtt-picker-list { flex: 1 1 auto; overflow: auto; padding: 4px; }
    .dtt-picker-row {
      display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 6px;
      cursor: pointer; font-size: 13px; color: var(--dsw-alias-label-primary, #0f1115);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .dtt-picker-row:hover { background: var(--dsw-alias-bg-hover, rgba(0,0,0,0.06)); }
    .dtt-picker-row-dir { font-weight: 600; }
    .dtt-picker-empty { padding: 20px; text-align: center; color: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.9)); font-size: 13px; }
    .dtt-picker-error { padding: 20px; text-align: center; color: var(--dsw-alias-state-error-primary, #dc2626); font-size: 13px; }
  `;
  document.head.appendChild(style);
  return function () { style.remove(); };
}

module.exports = {
  async apply(ctx) {
    let slots = ctx.get('slots');
    for (let i = 0; slots === undefined && i < 60; i++) {
      await new Promise(function (resolve) { window.setTimeout(resolve, 300); });
      slots = ctx.get('slots');
    }
    if (slots === undefined) {
      console.warn('[dsh-tabs-terminal] slots 服务 18s 内未就绪，插件未注册');
      return;
    }

    ctx.effect(function () {
      const disposeStyles = installStyles();
      return function () { disposeStyles(); };
    }, 'dsh-tabs-terminal: styles');

    // ---------- 文件树节点（懒加载子目录） ----------
    function TreeNode(props) {
      const entry = props.entry;
      const isDir = !!entry.isDir;
      const [open, setOpen] = React.useState(!!props.initiallyOpen);
      const [kids, setKids] = React.useState(null); // null=未加载 | 'loading' | array
      const [err, setErr] = React.useState(null);

      function toggle() {
        if (!isDir) {
          props.onOpenFile(entry.path);
          return;
        }
        const next = !open;
        setOpen(next);
        if (next && kids === null) {
          setKids('loading');
          rpc('listDir', { path: entry.path }).then(function (res) {
            if (res && res.ok) {
              setKids(Array.isArray(res.entries) ? res.entries : []);
              setErr(null);
            } else {
              setKids([]);
              setErr((res && res.error) || '目录不可读');
            }
          }).catch(function (e) {
            setKids([]);
            setErr(String((e && e.message) || e));
          });
        }
      }

      const arrow = isDir ? (open ? '▾' : '▸') : '';
      const icon = isDir ? (open ? '📂' : '📁') : '📄';
      const rows = [];
      rows.push(React.createElement('div', {
        key: entry.path,
        className: 'dtt-tree-row' + (isDir ? ' dtt-tree-row-dir' : ''),
        style: { paddingLeft: (8 + props.depth * 14) + 'px' },
        title: entry.path,
        onClick: toggle,
      },
        React.createElement('span', { className: 'dtt-tree-arrow' }, arrow),
        React.createElement('span', { className: 'dtt-tree-icon' }, icon),
        React.createElement('span', { className: 'dtt-tree-name' }, entry.name)));

      if (isDir && open) {
        if (kids === 'loading') {
          rows.push(React.createElement('div', {
            key: entry.path + ':loading',
            className: 'dtt-tree-loading',
            style: { paddingLeft: (8 + (props.depth + 1) * 14) + 'px' },
          }, '加载中…'));
        } else if (err) {
          rows.push(React.createElement('div', {
            key: entry.path + ':error',
            className: 'dtt-tree-error',
            style: { paddingLeft: (8 + (props.depth + 1) * 14) + 'px' },
          }, err));
        } else if (Array.isArray(kids) && kids.length > 0) {
          for (let i = 0; i < kids.length; i++) {
            rows.push(React.createElement(TreeNode, {
              key: kids[i].path,
              entry: kids[i],
              depth: props.depth + 1,
              onOpenFile: props.onOpenFile,
            }));
          }
        } else if (Array.isArray(kids)) {
          rows.push(React.createElement('div', {
            key: entry.path + ':empty',
            className: 'dtt-tree-empty',
            style: { paddingLeft: (8 + (props.depth + 1) * 14) + 'px' },
          }, '（空目录）'));
        }
      }
      return React.createElement(React.Fragment, null, rows);
    }

    // ---------- 文件树面板 ----------
    function FileTreePanel(props) {
      const [root, setRoot] = React.useState({ status: 'loading', path: props.root || '', parent: null, entries: [], error: null });

      const load = React.useCallback(function (path) {
        setRoot({ status: 'loading', path: path || '', parent: null, entries: [], error: null });
        rpc('listDir', path ? { path: path } : {}).then(function (res) {
          if (res && res.ok) setRoot({ status: 'ready', path: res.path, parent: res.parent, entries: res.entries || [], error: null });
          else setRoot({ status: 'error', path: path || '', parent: null, entries: [], error: (res && res.error) || '目录不可读' });
        }).catch(function (err) {
          setRoot({ status: 'error', path: path || '', parent: null, entries: [], error: String((err && err.message) || err) });
        });
      }, []);

      React.useEffect(function () {
        load(props.root);
      }, [load, props.root]);

      const rows = [];
      if (root.status === 'ready') {
        if (root.entries.length === 0) {
          rows.push(React.createElement('div', { key: 'empty', className: 'dtt-tree-empty' }, '（空目录）'));
        }
        for (let i = 0; i < root.entries.length; i++) {
          const e = root.entries[i];
          rows.push(React.createElement(TreeNode, {
            key: e.path,
            entry: e,
            depth: 0,
            onOpenFile: props.onOpenFile,
          }));
        }
      }

      let body = null;
      if (root.status === 'loading') body = React.createElement('div', { className: 'dtt-tree-loading' }, '加载中…');
      else if (root.status === 'error') body = React.createElement('div', { className: 'dtt-tree-error' }, root.error);
      else body = rows;

      return React.createElement('div', { className: 'dtt-tree', style: { width: props.width + 'px' } },
        React.createElement('div', { className: 'dtt-tree-header' },
          React.createElement('span', { className: 'dtt-tree-title', title: root.path }, '资源管理器'),
          React.createElement('button', {
            className: 'dtt-tree-btn', title: '打开文件夹（切换根目录）', type: 'button',
            onClick: function () { props.onPickRoot(); },
          }, '🗀'),
          React.createElement('button', {
            className: 'dtt-tree-btn', title: '折叠文件树', type: 'button',
            onClick: function () { props.onCollapse(); },
          }, '«')),
        React.createElement('div', { className: 'dtt-tree-scroll' },
          React.createElement('div', {
            className: 'dtt-tree-row dtt-tree-row-dir', title: root.path || '（主目录）',
            style: { paddingLeft: '8px' },
            onClick: function () { if (root.parent != null) load(root.parent); },
          },
            React.createElement('span', { className: 'dtt-tree-icon' }, '🏠'),
            React.createElement('span', { className: 'dtt-tree-name' }, basenameOf(root.path) || '主目录')),
          body),
      );
    }

    // ---------- 顶层组件 ----------
    function DscoderWorkspace(props) {
      const wsItems = props.useWorkspaces ? props.useWorkspaces(function (s) { return s.items; }) : [];
      const recentId = props.useWorkspaces ? props.useWorkspaces(function (s) { return s.recentWorkspaceId; }) : undefined;

      const [openFiles, setOpenFiles] = React.useState([]);
      const [activeTab, setActiveTab] = React.useState(CHAT_TAB_KEY);
      const [treeOpen, setTreeOpen] = React.useState(true);
      const [treeWidth, setTreeWidth] = React.useState(TREE_DEFAULT_WIDTH);
      const [treeRoot, setTreeRoot] = React.useState(null); // null → 自动取工作区/主目录
      const [terminalOpen, setTerminalOpen] = React.useState(false);
      const [pickerOpen, setPickerOpen] = React.useState(false);

      // 把应用整体下移（顶部标签栏）并右移（文件树），退出时还原。
      React.useEffect(function () {
        const rootEl = document.getElementById('root');
        if (!rootEl) return;
        const prevTop = rootEl.style.paddingTop;
        const prevLeft = rootEl.style.paddingLeft;
        rootEl.style.paddingTop = TAB_BAR_HEIGHT + 'px';
        rootEl.style.paddingLeft = treeOpen ? treeWidth + 'px' : '0px';
        return function () {
          rootEl.style.paddingTop = prevTop;
          rootEl.style.paddingLeft = prevLeft;
        };
      }, [treeOpen, treeWidth]);

      // 全局快捷键：Ctrl + ` 切换终端
      React.useEffect(function () {
        function onKey(e) {
          if (e.key === '`' && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
            e.stopPropagation();
            setTerminalOpen(function (v) { return !v; });
          }
        }
        window.addEventListener('keydown', onKey, true);
        return function () { window.removeEventListener('keydown', onKey, true); };
      }, []);

      // 文件树根目录解析：显式选择 > 最近工作区 > 第一个工作区 > 空（host 回退主目录）。
      function resolveTreeRoot() {
        if (treeRoot) return treeRoot;
        const items = Array.isArray(wsItems) ? wsItems : [];
        if (recentId) {
          for (let i = 0; i < items.length; i++) {
            if (items[i] && items[i].workspaceId === recentId && items[i].path) return items[i].path;
          }
        }
        if (items.length > 0 && items[0] && items[0].path) return items[0].path;
        return '';
      }

      function closeFile(path) {
        const next = openFiles.filter(function (f) { return f.path !== path; });
        setOpenFiles(next);
        if (activeTab === path) setActiveTab(CHAT_TAB_KEY);
      }

      function openFile(path) {
        setOpenFiles(function (files) {
          if (files.some(function (f) { return f.path === path; })) return files;
          return files.concat([{ path: path, name: basenameOf(path), status: 'loading', content: '', error: null, bytes: 0, truncated: false }]);
        });
        setActiveTab(path);
        rpc('readFile', { path: path }).then(function (res) {
          if (res && res.ok) {
            setOpenFiles(function (files) {
              return files.map(function (f) {
                return f.path === path ? { path: f.path, name: res.name, status: 'ready', content: res.content, error: null, bytes: res.bytes, truncated: res.truncated } : f;
              });
            });
          } else {
            setOpenFiles(function (files) {
              return files.map(function (f) {
                return f.path === path ? { path: f.path, name: f.name, status: 'error', content: '', error: (res && res.error) || '读取失败', bytes: 0, truncated: false } : f;
              });
            });
          }
        }).catch(function (err) {
          setOpenFiles(function (files) {
            return files.map(function (f) {
              return f.path === path ? { path: f.path, name: f.name, status: 'error', content: '', error: String((err && err.message) || err), bytes: 0, truncated: false } : f;
            });
          });
        });
      }

      function activateChat() { setActiveTab(CHAT_TAB_KEY); }

      // ---------- 组装顶部标签栏 ----------
      const tabNodes = [];
      tabNodes.push(React.createElement('div', {
        key: CHAT_TAB_KEY,
        className: 'dtt-tab dtt-tab-chat' + (activeTab === CHAT_TAB_KEY ? ' active' : ''),
        title: '对话（不可关闭）',
        onClick: activateChat,
      }, React.createElement('span', { className: 'dtt-file-icon' }, '💬'),
         React.createElement('span', { className: 'dtt-tab-label' }, '聊天')));

      for (let i = 0; i < openFiles.length; i++) {
        const f = openFiles[i];
        const active = activeTab === f.path;
        tabNodes.push(React.createElement('div', {
          key: 'f:' + f.path,
          className: 'dtt-tab dtt-tab-file' + (active ? ' active' : ''),
          title: f.path,
          onClick: function () { setActiveTab(f.path); },
        }, React.createElement('span', { className: 'dtt-file-icon' }, '📄'),
           React.createElement('span', { className: 'dtt-tab-label' }, f.name),
           React.createElement('button', {
             className: 'dtt-tab-close', title: '关闭', type: 'button',
             onClick: function (e) { e.stopPropagation(); closeFile(f.path); },
           }, '×')));
      }

      const tabBar = React.createElement('div', { className: 'dtt-tabbar' },
        React.createElement('button', {
          className: 'dtt-tabbar-btn' + (treeOpen ? ' active' : ''),
          title: '切换文件树', type: 'button',
          onClick: function () { setTreeOpen(function (v) { return !v; }); },
        }, '🗂'),
        tabNodes,
        React.createElement('div', { className: 'dtt-spacer' }),
        React.createElement('button', {
          className: 'dtt-tabbar-btn', title: '切换终端（Ctrl + `）', type: 'button',
          onClick: function () { setTerminalOpen(function (v) { return !v; }); },
        }, terminalOpen ? '⌄ 终端' : '终端'),
      );

      // ---------- 只读文件查看 ----------
      const activeFile = activeTab === CHAT_TAB_KEY ? null : openFiles.find(function (f) { return f.path === activeTab; });
      let reader = null;
      if (activeFile) {
        let body = null;
        if (activeFile.status === 'loading') {
          body = React.createElement('div', { className: 'dtt-reader-loading' }, '读取中…');
        } else if (activeFile.status === 'error') {
          body = React.createElement('div', { className: 'dtt-reader-error' }, '读取失败：' + activeFile.error);
        } else {
          body = React.createElement('pre', { className: 'dtt-reader-body' }, activeFile.content);
        }
        reader = React.createElement('div', {
          className: 'dtt-reader',
          style: { left: treeOpen ? treeWidth + 'px' : '0px' },
        },
          React.createElement('div', { className: 'dtt-reader-header' },
            React.createElement('span', { className: 'dtt-reader-title', title: activeFile.path }, activeFile.name),
            React.createElement('span', null, activeFile.status === 'ready'
              ? ((activeFile.truncated ? '（截断）' : '') + activeFile.bytes + ' 字节')
              : ''),
            React.createElement('div', { className: 'dtt-spacer' }),
            React.createElement('span', null, '只读 — 代码修改请交由 AI 代理完成')),
          body,
        );
      }

      // ---------- 文件树（含拖拽调宽手柄） ----------
      const treeRootPath = resolveTreeRoot();
      const tree = treeOpen ? React.createElement(FileTreePanel, {
        root: treeRootPath,
        width: treeWidth,
        onOpenFile: openFile,
        onPickRoot: function () { setPickerOpen(true); },
        onCollapse: function () { setTreeOpen(false); },
      }) : null;

      // 拖拽调整文件树宽度。
      function startResize(e) {
        e.preventDefault();
        const startX = e.clientX;
        const startW = treeWidth;
        function onMove(ev) {
          const w = Math.max(TREE_MIN_WIDTH, Math.min(TREE_MAX_WIDTH, startW + (ev.clientX - startX)));
          setTreeWidth(w);
        }
        function onUp() {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      }
      const resizeHandle = treeOpen ? React.createElement('div', {
        className: 'dtt-tree-resize',
        style: { left: treeWidth + 'px' },
        onPointerDown: startResize,
      }) : null;

      return React.createElement('div', { className: 'dtt-root', style: { pointerEvents: 'none' } },
        tabBar,
        tree,
        resizeHandle,
        reader,
        terminalOpen ? React.createElement(TerminalPanel, { onClose: function () { setTerminalOpen(false); } }) : null,
        pickerOpen ? React.createElement(PickerModal, {
          onClose: function () { setPickerOpen(false); },
          onPickDir: function (path) { setTreeRoot(path); setTreeOpen(true); setPickerOpen(false); },
        }) : null,
      );
    }

    // ---------- 终端面板 ----------
    function TerminalPanel(props) {
      const [status, setStatus] = React.useState('starting'); // starting | running | exited | error
      const [pid, setPid] = React.useState(null);
      const [exitCode, setExitCode] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [output, setOutput] = React.useState('');
      const [input, setInput] = React.useState('');

      const termIdRef = React.useRef(null);
      const offsetRef = React.useRef(0);
      const outputRef = React.useRef('');
      const inFlightRef = React.useRef(false);
      const historyRef = React.useRef([]);
      const historyIdxRef = React.useRef(-1);
      const outputElRef = React.useRef(null);
      const inputRef = React.useRef(null);

      React.useEffect(function () {
        let alive = true;
        let pollTimer = null;

        (async function () {
          const cols = Math.max(40, Math.floor(window.innerWidth / 8));
          const rows = 24;
          try {
            const r = await rpc('termStart', { cols: cols, rows: rows }, 30000);
            if (!alive) { if (r && r.ok) rpc('termKill', { id: r.id }).catch(function () {}); return; }
            if (!r || !r.ok) { setStatus('error'); setError((r && r.error) || '终端启动失败'); return; }
            termIdRef.current = r.id;
            setPid(r.pid);
            setStatus('running');
            pollTimer = window.setInterval(poll, TERM_POLL_MS);
          } catch (err) {
            if (!alive) return;
            setStatus('error');
            setError(String((err && err.message) || err));
          }
        })();

        function poll() {
          if (inFlightRef.current) return;
          const id = termIdRef.current;
          if (!id) return;
          inFlightRef.current = true;
          rpc('termRead', { id: id, from: offsetRef.current }, 8000).then(function (res) {
            inFlightRef.current = false;
            if (!alive) return;
            if (!res || !res.ok) return;
            if (res.text && res.text.length > 0) {
              outputRef.current = stripAnsi(outputRef.current + res.text);
              if (outputRef.current.length > MAX_DISPLAY_CHARS) {
                outputRef.current = outputRef.current.slice(outputRef.current.length - MAX_DISPLAY_CHARS);
              }
              setOutput(outputRef.current);
            }
            offsetRef.current = res.nextOffset;
            if (res.exited) {
              setStatus('exited');
              setExitCode(res.exitCode);
            }
          }).catch(function () { inFlightRef.current = false; });
        }

        return function () {
          alive = false;
          if (pollTimer) window.clearInterval(pollTimer);
          const id = termIdRef.current;
          if (id) rpc('termKill', { id: id }).catch(function () {});
        };
      }, []);

      React.useEffect(function () {
        const el = outputElRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      }, [output, status]);

      React.useEffect(function () {
        if (status === 'running' && inputRef.current) inputRef.current.focus();
      }, [status]);

      function send() {
        const id = termIdRef.current;
        const text = input;
        if (!id || status !== 'running') return;
        if (text.length > 0) historyRef.current.push(text);
        historyIdxRef.current = -1;
        setInput('');
        rpc('termWrite', { id: id, data: text + '\r' }).catch(function (err) {
          setOutput(outputRef.current + '\r\n[写入失败: ' + String((err && err.message) || err) + ']');
        });
      }

      function sendInterrupt() {
        const id = termIdRef.current;
        if (!id || status !== 'running') return;
        rpc('termWrite', { id: id, data: '\x03' }).catch(function () {});
      }

      function navigateHistory(dir) {
        const h = historyRef.current;
        if (h.length === 0) return;
        let idx = historyIdxRef.current;
        if (idx === -1 && dir < 0) idx = h.length;
        idx += dir;
        if (idx < 0) idx = 0;
        if (idx > h.length) idx = h.length;
        historyIdxRef.current = idx;
        setInput(idx < h.length ? h[idx] : '');
      }

      function onInputKeyDown(e) {
        if (e.key === 'Enter') { e.preventDefault(); send(); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); navigateHistory(-1); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); navigateHistory(1); return; }
        if (e.key === 'c' && e.ctrlKey) { e.preventDefault(); sendInterrupt(); return; }
      }

      const statusLabel = status === 'starting' ? '启动中…'
        : status === 'exited' ? '已退出' + (exitCode === null || exitCode === undefined ? '' : '（code ' + exitCode + '）')
        : status === 'error' ? '错误' : '运行中';

      return React.createElement('div', { className: 'dtt-terminal' },
        React.createElement('div', { className: 'dtt-term-header' },
          React.createElement('span', { className: 'dtt-term-title' }, '终端'),
          React.createElement('span', null, statusLabel),
          pid ? React.createElement('span', null, 'PID ' + pid) : null,
          React.createElement('div', { className: 'dtt-spacer' }),
          React.createElement('button', { className: 'dtt-term-btn', type: 'button', title: '发送 Ctrl+C 中断', onClick: sendInterrupt }, 'Ctrl+C'),
          React.createElement('button', { className: 'dtt-term-btn', type: 'button', title: '关闭终端（Ctrl + `）', onClick: props.onClose }, '×'),
        ),
        React.createElement('pre', { className: 'dtt-term-output', ref: outputElRef },
          error ? '[错误] ' + error + '\r\n' : (status === 'starting' ? '启动终端…\r\n' : output)),
        React.createElement('div', { className: 'dtt-term-input' },
          React.createElement('span', { className: 'dtt-term-prompt' }, '❯'),
          React.createElement('input', {
            ref: inputRef, type: 'text', value: input,
            spellCheck: false, autoCapitalize: 'off', autoComplete: 'off',
            disabled: status === 'starting',
            placeholder: status === 'running' ? '输入命令，回车执行' : '',
            onChange: function (e) { setInput(e.target.value); },
            onKeyDown: onInputKeyDown,
          }),
        ),
        React.createElement('div', { className: 'dtt-term-hint' }, '↑↓ 历史 · Ctrl+C 中断 · Ctrl+` 关闭'),
      );
    }

    // ---------- 目录选择器（仅选目录，用于切换文件树根） ----------
    function PickerModal(props) {
      const [dir, setDir] = React.useState({ status: 'loading', path: '', parent: null, entries: [], error: null });

      const load = React.useCallback(function (path) {
        setDir({ status: 'loading', path: path || '', parent: null, entries: [], error: null });
        rpc('listDir', path ? { path: path } : {}).then(function (res) {
          if (res && res.ok) setDir({ status: 'ready', path: res.path, parent: res.parent, entries: res.entries || [], error: null });
          else setDir({ status: 'error', path: path || '', parent: null, entries: [], error: (res && res.error) || '目录不可读' });
        }).catch(function (err) {
          setDir({ status: 'error', path: path || '', parent: null, entries: [], error: String((err && err.message) || err) });
        });
      }, []);

      React.useEffect(function () { load(''); }, [load]);

      function onRowClick(entry) {
        if (entry.isDir) load(entry.path);
        // 文件在"选目录"模式下忽略
      }

      const rows = [];
      if (dir.status === 'ready') {
        if (dir.parent != null) {
          rows.push(React.createElement('div', {
            key: '..', className: 'dtt-picker-row dtt-picker-row-dir',
            onClick: function () { load(dir.parent); },
          }, '⬆ 上级目录'));
        }
        const dirEntries = dir.entries.filter(function (e) { return e.isDir; });
        for (let i = 0; i < dirEntries.length; i++) {
          const e = dirEntries[i];
          rows.push(React.createElement('div', {
            key: e.path,
            className: 'dtt-picker-row dtt-picker-row-dir',
            title: e.path,
            onClick: function () { onRowClick(e); },
          }, '📁 ', e.name));
        }
        if (dirEntries.length === 0) {
          rows.push(React.createElement('div', { key: 'empty', className: 'dtt-picker-empty' }, '（无子目录）'));
        }
      }

      let listBody = null;
      if (dir.status === 'loading') listBody = React.createElement('div', { className: 'dtt-picker-empty' }, '加载中…');
      else if (dir.status === 'error') listBody = React.createElement('div', { className: 'dtt-picker-error' }, dir.error);
      else listBody = rows;

      const ready = dir.status === 'ready' && !!dir.path;
      return React.createElement('div', {
        className: 'dtt-picker-mask',
        onClick: function (e) { if (e.target === e.currentTarget) props.onClose(); },
      },
        React.createElement('div', { className: 'dtt-picker' },
          React.createElement('div', { className: 'dtt-picker-header' },
            React.createElement('span', { className: 'dtt-picker-path', title: dir.path }, dir.path || '…'),
            React.createElement('div', { className: 'dtt-spacer' }),
            React.createElement('button', { className: 'dtt-picker-btn', type: 'button', onClick: props.onClose }, '取消'),
            React.createElement('button', {
              className: 'dtt-picker-btn primary', type: 'button', disabled: !ready,
              onClick: function () { if (ready) props.onPickDir(dir.path); },
            }, '选择此文件夹'),
          ),
          React.createElement('div', { className: 'dtt-picker-list' }, listBody),
        ),
      );
    }

    // ---------- 注册 shell.overlay ----------
    let dispose = null;
    function applyMode() {
      if (dispose) { dispose(); dispose = null; }
      dispose = slots.register(
        { name: 'shell.overlay', id: 'dsh-tabs-terminal', order: 0, label: 'DSCoder 文件树与标签页' },
        function (slotProps) {
          return React.createElement(DscoderWorkspace, slotProps);
        },
      );
    }

    slots.inject('shell.overlay', function () {
      applyMode();
      return function () { if (dispose) { dispose(); dispose = null; } };
    });
  },
};
