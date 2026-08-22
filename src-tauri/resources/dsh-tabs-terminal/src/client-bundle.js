// dsh-tabs-terminal（文件树 + 标签页 + 终端插件）— client half（静态 bundle 形态）
// - rpc(method, args) → fetch POST /_dsh/dsh-tabs-terminal/<method>（JSON）
// - 注册到 shell.overlay（frame 级浮动层），渲染：顶部标签栏 / 右侧文件树 / 可编辑文件查看 / 底部终端 / 目录选择器
// - 顶部标签栏：第一个是"聊天"标签（不可关闭，点击回到官方对话界面）；打开的文件各占一个可关闭标签
// - 文件树根目录：当前 DSH 工作区目录（无工作区时回退到用户主目录），可经"打开文件夹"换根
// - 快捷键：Ctrl + ` 切换终端（与 VS Code 一致）
// - React 由 bundle 的 require('react') 提供（seed 模块）
'use strict';

const React = require('react');

const RPC_BASE = '/_dsh/dsh-tabs-terminal';
const ASSET_BASE = RPC_BASE + '/assets'; // 插件静态资源（SVG/图片图标等）
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
    .replace(/\u001b\][^\u0007]*(\u0007|\u001b\\)/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function basenameOf(p) {
  const parts = String(p).split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

// 渲染 assets/ 下的 SVG 作为图标（<img>，尺寸由 CSS 控制）。
function svgIcon(file, alt) {
  return React.createElement('img', {
    className: 'dtt-svg-icon',
    src: ASSET_BASE + '/' + file,
    alt: alt || '',
    draggable: false,
  });
}

// DSH core（rc.6）工作区文件夹图标：16px、fill=currentColor。
// 未展开灰（--dsw-alias-label-tertiary），展开蓝（--dsw-alias-state-business-primary）。
const FOLDER_CLOSE_SVG = '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path transform="translate(1.5 2.429)" d="M5.05582 0.518756L4.50669 0.86654L5.05582 0.518756ZM13 9.4837L13.65 9.4837L13.65 3.53962L13 3.53962L12.35 3.53962L12.35 9.4837L13 9.4837ZM11.3264 1.86603L11.3264 1.21603L6.52313 1.21603L6.52313 1.86603L6.52313 2.51603L11.3264 2.51603L11.3264 1.86603ZM5.58054 1.34727L6.12968 0.999489L5.60495 0.170972L5.05582 0.518756L4.50669 0.86654L5.03141 1.69506L5.58054 1.34727ZM4.11323 1.23058e-13L4.11323 -0.65L1.67359 -0.65L1.67359 5.00699e-14L1.67359 0.65L4.11323 0.65L4.11323 1.23058e-13ZM0 1.67359L-0.65 1.67359L-0.65 9.4837L0 9.4837L0.65 9.4837L0.65 1.67359L0 1.67359ZM11.3264 11.1573L11.3264 10.5073L1.67359 10.5073L1.67359 11.1573L1.67359 11.8073L11.3264 11.8073L11.3264 11.1573ZM0 9.4837L-0.65 9.4837C-0.65 10.767 0.390308 11.8073 1.67359 11.8073L1.67359 11.1573L1.67359 10.5073C1.10828 10.5073 0.65 10.049 0.65 9.4837L0 9.4837ZM1.67359 5.00699e-14L1.67359 -0.65C0.390307 -0.65 -0.65 0.390309 -0.65 1.67359L0 1.67359L0.65 1.67359C0.65 1.10828 1.10828 0.65 1.67359 0.65L1.67359 5.00699e-14ZM5.05582 0.518756L5.60495 0.170972C5.28121 -0.340193 4.71829 -0.65 4.11323 -0.65L4.11323 1.23058e-13L4.11323 0.65C4.27282 0.65 4.4213 0.731715 4.50669 0.86654L5.05582 0.518756ZM6.52313 1.86603L6.52313 1.21603C6.36354 1.21603 6.21507 1.13431 6.12968 0.999489L5.58054 1.34727L5.03141 1.69506C5.35515 2.20622 5.91808 2.51603 6.52313 2.51603L6.52313 1.86603ZM13 3.53962L13.65 3.53962C13.65 2.25634 12.6097 1.21603 11.3264 1.21603L11.3264 1.86603L11.3264 2.51603C11.8917 2.51603 12.35 2.97431 12.35 3.53962L13 3.53962ZM13 9.4837L12.35 9.4837C12.35 10.049 11.8917 10.5073 11.3264 10.5073L11.3264 11.1573L11.3264 11.8073C12.6097 11.8073 13.65 10.767 13.65 9.4837L13 9.4837Z" fill="currentColor"/></svg>';
const FOLDER_OPEN_SVG = '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.19629 1.57104C5.81144 1.5711 6.38623 1.8786 6.72754 2.39038L7.19922 3.09839C7.28454 3.22635 7.42824 3.30344 7.58203 3.30347H12.1699C13.5039 3.30348 14.5859 4.38548 14.5859 5.71948V6.62671C15.2694 7.02689 15.6605 7.85012 15.4385 8.68726L14.3848 12.658C14.1037 13.7164 13.1449 14.4527 12.0498 14.4529H2.91699C1.51651 14.4529 0.451662 13.2814 0.501954 11.9519V3.98706C0.501954 2.65305 1.58396 1.57104 2.91797 1.57104H5.19629ZM3.7793 7.75562C3.30994 7.75562 2.89883 8.07153 2.77832 8.52515L1.91602 11.7722C1.74167 12.4291 2.23734 13.073 2.91699 13.073H12.0498C12.5191 13.0728 12.9304 12.757 13.0508 12.3035L14.1045 8.33374C14.1819 8.04202 13.9619 7.756 13.6602 7.75562H3.7793ZM2.91797 2.9519C2.34625 2.9519 1.88281 3.41534 1.88281 3.98706V7.2937C2.33068 6.7269 3.02249 6.37476 3.7793 6.37476H13.2051V5.71948C13.2051 5.14777 12.7416 4.68434 12.1699 4.68433H7.58203C6.96675 4.6843 6.39209 4.37595 6.05078 3.86401L5.5791 3.15601C5.49379 3.02821 5.34995 2.95196 5.19629 2.9519H2.91797Z" fill="currentColor"/><path opacity="0.2" d="M13.6602 7.75525C13.9618 7.7556 14.1815 8.04179 14.1045 8.33337L13.0508 12.3031C12.9304 12.7567 12.5191 13.0725 12.0498 13.0726H2.91701C2.23744 13.0725 1.7417 12.4287 1.91603 11.7719L2.77834 8.52478C2.89898 8.07146 3.31018 7.75532 3.77931 7.75525H13.6602ZM5.1963 2.95154C5.34985 2.95159 5.49377 3.02803 5.57912 3.15564L6.0508 3.86365C6.39205 4.37553 6.96685 4.68385 7.58205 4.68396H12.1699C12.7416 4.68396 13.2049 5.14754 13.2051 5.71912V6.37439H3.77931C3.02267 6.37444 2.33067 6.72671 1.88283 7.29333V3.98669C1.88299 3.4152 2.34649 2.95168 2.91798 2.95154H5.1963Z" fill="currentColor"/></svg>';

// 内联 SVG（currentColor 随 CSS color 变化）：用于需要"灰→蓝"变色的图标。
function inlineSvgIcon(markup) {
  return React.createElement('span', {
    className: 'dtt-inline-icon',
    dangerouslySetInnerHTML: { __html: markup },
  });
}

// 按文件扩展名返回图标。
// 目录在调用处单独处理（📁）。
function fileIcon(name) {
  const n = String(name || '').toLowerCase();
  const dot = n.lastIndexOf('.');
  const ext = dot >= 0 ? n.slice(dot + 1) : '';
  if (ext === 'py') return svgIcon('file-type-python.svg', '🐍');
  if (ext === 'json') return svgIcon('file-type-json.svg', '📦');
  if (ext === 'html' || ext === 'htm') return svgIcon('file-type-html.svg', '🌐');
  if (ext === 'md' || ext === 'markdown') return svgIcon('file-type-markdown.svg', '📝');
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'svg' || ext === 'gif' ||
      ext === 'webp' || ext === 'bmp' || ext === 'ico' || ext === 'avif' || ext === 'tiff') {
    return svgIcon('file-type-image.svg', '🖼️');
  }
  return svgIcon('default-file.svg', '📄');
}

// ---------- 语法高亮（轻量正则分词，无第三方依赖） ----------
const HIGHLIGHT_MAX_CHARS = 512 * 1024; // 超过此大小的文件不做高亮，避免卡顿

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 各语言规则：pattern 在「HTML 转义后」的文本上匹配；type 对应 CSS 类 tok-<type>。
const HL_RULES = {
  python: [
    { type: 'comment', pattern: `#[^\\n]*` },
    { type: 'string', pattern: `"""[\\s\\S]*?"""|'''[\\s\\S]*?'''|"[^"\\n]*"|'[^'\\n]*'` },
    { type: 'number', pattern: `\\b\\d+(?:\\.\\d+)?\\b` },
    { type: 'keyword', pattern: `\\b(?:False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield)\\b` },
    { type: 'function', pattern: `\\b[A-Za-z_]\\w*(?=\\()` },
  ],
  json: [
    { type: 'string', pattern: `"[^"\\n]*"` },
    { type: 'number', pattern: `-?\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b` },
    { type: 'keyword', pattern: `\\b(?:true|false|null)\\b` },
  ],
  markdown: [
    { type: 'heading', pattern: `^#{1,6}\\s+.*$` },
    { type: 'bold', pattern: `\\*\\*[^*\\n]+\\*\\*` },
    { type: 'link', pattern: `\\[[^\\]\\n]*\\]\\([^\\)\\n]*\\)` },
  ],
  xml: [
    { type: 'comment', pattern: `&lt;!--[\\s\\S]*?--&gt;` },
    { type: 'tag', pattern: `&lt;/?[a-zA-Z][a-zA-Z0-9-]*|&gt;` },
    { type: 'attr', pattern: `\\b[a-zA-Z-]+(?==)` },
    { type: 'string', pattern: `"[^"]*"|'[^']*'` },
  ],
  rust: [
    { type: 'comment', pattern: `//[^\\n]*|/\\*[\\s\\S]*?\\*/` },
    { type: 'string', pattern: `"[^"\\n]*"` },
    { type: 'number', pattern: `\\b\\d[\\d_]*(?:\\.\\d[\\d_]*)?(?:[eE][+-]?\\d+)?\\b` },
    { type: 'keyword', pattern: `\\b(?:as|async|await|box|break|const|continue|crate|dyn|else|enum|extern|false|fn|for|if|impl|in|let|loop|match|mod|move|mut|pub|ref|return|self|Self|static|struct|super|trait|true|type|unsafe|use|where|while)\\b` },
    { type: 'function', pattern: `\\b[A-Za-z_]\\w*(?=\\()` },
  ],
  typescript: [
    { type: 'comment', pattern: `//[^\\n]*|/\\*[\\s\\S]*?\\*/` },
    { type: 'string', pattern: `"[^"\\n]*"|'[^'\\n]*'` },
    { type: 'number', pattern: `\\b\\d+(?:\\.\\d+)?\\b` },
    { type: 'keyword', pattern: `\\b(?:abstract|any|as|async|await|bigint|boolean|break|case|catch|class|const|constructor|continue|debugger|declare|default|delete|do|else|enum|export|extends|false|finally|for|from|function|get|if|implements|import|in|infer|instanceof|interface|is|keyof|let|module|namespace|never|new|null|number|object|of|private|protected|public|readonly|return|satisfies|set|static|string|super|switch|symbol|this|throw|true|try|type|typeof|undefined|unknown|var|void|while|with|yield)\\b` },
    { type: 'function', pattern: `\\b[A-Za-z_$]\\w*(?=\\()` },
  ],
};

function highlightCode(code, lang) {
  // 优先用 highlight.js（vendor/highlight.min.js 打包后挂到 window.hljs）
  if (typeof window !== 'undefined' && window.hljs && lang && window.hljs.getLanguage(lang)) {
    try {
      const r = window.hljs.highlight(code, { language: lang, ignoreIllegals: true });
      const value = (r && typeof r === 'object') ? r.value : r;
      if (typeof value === 'string') return value;
    } catch (e) { /* 高亮失败则回退轻量正则 */ }
  }
  // 轻量正则回退（未打包 highlight.js 时使用）
  const rules = HL_RULES[lang];
  const text = escHtml(code);
  if (!rules) return text;

  const parts = [];
  const types = [];
  for (let i = 0; i < rules.length; i++) {
    parts.push('(' + rules[i].pattern + ')');
    types.push(rules[i].type);
  }
  const re = new RegExp(parts.join('|'), 'gm');
  return text.replace(re, function () {
    for (let i = 1; i < arguments.length - 2; i++) {
      if (arguments[i] !== undefined) {
        return '<span class="tok-' + types[i - 1] + '">' + arguments[i] + '</span>';
      }
    }
    return arguments[0];
  });
}

function detectLang(name) {
  const n = String(name || '').toLowerCase();
  const dot = n.lastIndexOf('.');
  const ext = dot >= 0 ? n.slice(dot + 1) : '';
  if (ext === 'py') return 'python';
  if (ext === 'json') return 'json';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'html' || ext === 'htm') return 'xml';
  if (ext === 'rs') return 'rust';
  if (ext === 'ts' || ext === 'tsx') return 'typescript';
  return '';
}

// 带语法高亮与行号的可编辑查看器：行号 gutter + 高亮 <pre> + 透明 textarea 叠放。
function CodeEditor(props) {
  const taRef = React.useRef(null);
  const hlRef = React.useRef(null);
  const gutterRef = React.useRef(null);
  const value = props.value || '';

  // 超大文件退回纯 textarea（不建行号/高亮层，避免卡顿）。
  if (value.length > HIGHLIGHT_MAX_CHARS) {
    return React.createElement('textarea', {
      className: 'dtt-reader-body dtt-editor',
      value: value,
      spellCheck: false,
      wrap: 'off',
      autoCapitalize: 'off',
      autoComplete: 'off',
      onChange: function (e) { props.onChange(e.target.value); },
    });
  }

  const lang = detectLang(props.name || '');
  const html = lang ? highlightCode(value, lang) : escHtml(value);

  // 行号与 gutter 宽度。
  const lineCount = value.split('\n').length;
  const digits = String(Math.max(1, lineCount)).length;
  const gutterWidth = Math.max(32, digits * 8 + 20);
  let gutter = '';
  for (let i = 1; i <= lineCount; i++) gutter += (i > 1 ? '\n' : '') + i;
  gutter += '\n';

  React.useEffect(function () {
    const ta = taRef.current, hl = hlRef.current, gt = gutterRef.current;
    if (ta && hl) { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; }
    if (ta && gt) { gt.scrollTop = ta.scrollTop; }
  });

  function syncScroll() {
    const ta = taRef.current, hl = hlRef.current, gt = gutterRef.current;
    if (ta && hl) { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; }
    if (ta && gt) { gt.scrollTop = ta.scrollTop; }
  }

  return React.createElement('div', { className: 'dtt-editor-wrap' },
    React.createElement('div', {
      className: 'dtt-editor-gutter',
      ref: gutterRef,
      style: { width: gutterWidth + 'px' },
      'aria-hidden': 'true',
    }, gutter),
    React.createElement('pre', {
      className: 'dtt-editor-highlight',
      ref: hlRef,
      style: { left: gutterWidth + 'px' },
      'aria-hidden': 'true',
      dangerouslySetInnerHTML: { __html: html + '\n' },
    }),
    React.createElement('textarea', {
      className: 'dtt-reader-body dtt-editor dtt-editor-overlay',
      ref: taRef,
      style: { left: gutterWidth + 'px' },
      value: value,
      spellCheck: false,
      wrap: 'off',
      autoCapitalize: 'off',
      autoComplete: 'off',
      onScroll: syncScroll,
      onChange: function (e) { props.onChange(e.target.value); },
    }),
  );
}

function installStyles() {
  const id = 'dsh-tabs-terminal';
  const existing = document.querySelector('style[data-plugin-css="' + id + '"]');
  if (existing !== null) return function () {};
  const style = document.createElement('style');
  style.dataset.plugin = 'dsh-tabs-terminal';
  style.dataset.pluginCss = id;
  style.textContent = `
    /* 应用容器 box-sizing 便于内部 padding（顶部标签栏 + 右侧文件树）不撑破 100% 高度 */
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
      font-size: 13px; line-height: 20px; scrollbar-width: thin; z-index: 40;
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
    .dtt-svg-icon { width: 16px; height: 16px; display: block; object-fit: contain; }
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
      font-size: 13px; line-height: 20px; display: inline-flex; align-items: center; justify-content: center;
    }
    .dtt-tabbar-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.05)); color: var(--dsw-alias-label-primary, #0f1115); }
    .dtt-tabbar-btn.active { color: var(--dsw-alias-label-primary, #0f1115); background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.08)); }
    .dtt-spacer { flex: 1 1 auto; }

    /* ---------- 右侧文件树 ---------- */
    .dtt-tree {
      position: fixed; top: ${TAB_BAR_HEIGHT}px; right: 0; bottom: 0; width: ${TREE_DEFAULT_WIDTH}px;
      display: flex; flex-direction: column; pointer-events: auto; z-index: 39;
      background: var(--dsw-alias-bg-base, #fff);
      border-left: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.1));
      font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary, #0f1115);
    }
    .dtt-tree-header {
      flex: 0 0 auto; display: flex; align-items: center; gap: 4px; padding: 6px 8px;
      border-bottom: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.08));
      font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-primary, #0f1115);
      text-transform: uppercase; letter-spacing: 0.04em;
    }
    .dtt-tree-title { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .dtt-tree-btn {
      flex: 0 0 auto; height: 20px; min-width: 20px; padding: 0 5px; border: 1px solid transparent;
      border-radius: 4px; background: transparent; cursor: pointer; font-size: 14px; line-height: 1;
      color: var(--dsw-alias-label-primary, #0f1115);
      display: inline-flex; align-items: center; justify-content: center;
    }
    .dtt-tree-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06)); color: var(--dsw-alias-label-primary, #0f1115); }
    .dtt-tree-scroll { flex: 1 1 auto; overflow: auto; padding: 6px 8px; }
    .dtt-tree-row {
      display: flex; align-items: center; gap: 6px; height: 32px; padding: 0 8px;
      cursor: pointer; white-space: nowrap; overflow: hidden; user-select: none;
      border-radius: 8px;
      color: var(--dsw-alias-label-primary, #0f1115);
    }
    .dtt-tree-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06)); }
    .dtt-tree-row.dtt-tree-row-dir { font-weight: 500; }
    .dtt-tree-arrow {
      flex: 0 0 auto; width: 12px; height: 18px;
      display: inline-flex; align-items: center; justify-content: center;
      color: rgba(255, 255, 225, 0.8);
    }
    .dtt-tree-arrow.has-chevron::before {
      content: ''; display: inline-block; width: 0; height: 0;
      border-left: 6px solid currentColor;
      border-top: 4px solid transparent;
      border-bottom: 4px solid transparent;
      transition: transform 0.2s ease;
    }
    .dtt-tree-arrow.has-chevron.open::before { transform: rotate(90deg); }
    .dtt-tree-icon { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.9)); }
    .dtt-tree-icon img { opacity: 0.75; width: 16px; height: 16px; }
    .dtt-tree-icon.dtt-tree-icon-active { color: var(--dsw-alias-state-business-primary, rgb(103, 158, 254)); }
    .dtt-inline-icon { display: inline-flex; width: 16px; height: 16px; flex: 0 0 auto; }
    .dtt-inline-icon svg { width: 100%; height: 100%; display: block; }
    .dtt-tree-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; }
    .dtt-tree-empty, .dtt-tree-error, .dtt-tree-loading { padding: 10px 14px; color: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.9)); font-size: 12px; line-height: 18px; }
    .dtt-tree-error { color: var(--dsw-alias-state-error-primary, #dc2626); }
    .dtt-tree-resize {
      position: fixed; top: ${TAB_BAR_HEIGHT}px; bottom: 0; width: 5px; cursor: col-resize; z-index: 40;
      background: transparent; pointer-events: auto;
    }
    .dtt-tree-resize:hover { background: rgba(0,0,0,0.08); }

    /* ---------- 可编辑文件查看 ---------- */
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
    .dtt-reader-body.dtt-editor {
      display: block; width: 100%; box-sizing: border-box; resize: none; border: none; outline: none;
      background: transparent; color: inherit; white-space: pre; overflow: auto; tab-size: 4;
    }
    .dtt-editor-wrap { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; }
    .dtt-editor-gutter {
      position: absolute; top: 0; bottom: 0; left: 0;
      overflow: hidden; pointer-events: none; user-select: none;
      box-sizing: border-box; margin: 0; padding: 12px 8px 12px 0;
      text-align: right; white-space: pre;
      font-family: var(--dsw-font-mono, ui-monospace, 'Cascadia Code', 'JetBrains Mono', Consolas, monospace);
      font-size: 12.5px; line-height: 1.55;
      color: var(--dsw-alias-label-tertiary, #7f848e);
      border-right: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.06));
    }
    .dtt-editor-highlight {
      position: absolute; inset: 0; margin: 0; padding: 12px 16px;
      box-sizing: border-box; overflow: hidden; pointer-events: none; background: transparent;
      font-family: var(--dsw-font-mono, ui-monospace, 'Cascadia Code', 'JetBrains Mono', Consolas, monospace);
      font-size: 12.5px; line-height: 1.55; color: var(--dsw-alias-label-primary, #0f1115);
      white-space: pre; tab-size: 4;
    }
    .dtt-reader-body.dtt-editor.dtt-editor-overlay {
      position: absolute; inset: 0; height: 100%;
      color: transparent; caret-color: var(--dsw-alias-label-primary, #0f1115);
    }
    .dtt-reader-body.dtt-editor.dtt-editor-overlay::selection { background: rgba(120, 150, 220, 0.35); }
    /* 语法高亮 token 颜色（One-Dark 风格，深浅主题通用） */
    .tok-comment { color: var(--dsw-alias-label-tertiary, #7f848e); font-style: italic; }
    .tok-string { color: #98c379; }
    .tok-number { color: #d19a66; }
    .tok-keyword { color: #c678dd; }
    .tok-function { color: #61afef; }
    .tok-heading { color: var(--dsw-alias-label-primary, #0f1115); font-weight: 700; }
    .tok-code { color: #56b6c2; }
    .tok-bold { font-weight: 700; }
    .tok-link { color: #61afef; }
    .tok-tag { color: #e06c75; }
    .tok-attr { color: #d19a66; }
    /* highlight.js token 颜色（与上面 .tok-* 主题配色一致） */
    .hljs-comment, .hljs-quote { color: var(--dsw-alias-label-tertiary, #7f848e); font-style: italic; }
    .hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-doctag, .hljs-section { color: #c678dd; }
    .hljs-string, .hljs-regexp, .hljs-addition, .hljs-template-variable { color: #98c379; }
    .hljs-number, .hljs-symbol, .hljs-bullet, .hljs-meta { color: #d19a66; }
    .hljs-title, .hljs-title.function_, .hljs-title.class_, .hljs-name, .hljs-built_in { color: #61afef; }
    .hljs-type, .hljs-params { color: #e5c07b; }
    .hljs-attr, .hljs-attribute, .hljs-variable, .hljs-selector-attr, .hljs-selector-class, .hljs-selector-id { color: #e06c75; }
    .hljs-emphasis { font-style: italic; }
    .hljs-strong { font-weight: 700; }
    .hljs-link { color: #61afef; }
    .hljs-deletion { color: #e06c75; }
    .dtt-reader-status { flex: 0 0 auto; color: var(--dsw-alias-state-warn-primary, #d97706); }
    .dtt-reader-status.error { color: var(--dsw-alias-state-error-primary, #dc2626); }
    .dtt-tab-dirty { flex: 0 0 auto; color: var(--dsw-alias-state-warn-primary, #d97706); font-weight: 700; }
    .dtt-reader-error { margin: 16px; padding: 12px; border-radius: 8px; color: var(--dsw-alias-state-error-primary, #dc2626); background: rgba(220,38,38,0.08); font-size: 13px; }
    .dtt-reader-loading { margin: 16px; color: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.9)); font-size: 13px; }

    /* ---------- 终端面板 ---------- */
    .dtt-terminal {
      position: fixed; left: 0; right: 0; bottom: 0;
      height: clamp(180px, 40vh, 70vh);
      display: flex; flex-direction: column; pointer-events: auto; z-index: 42;
      background: var(--dsw-alias-bg-base, #fff); color: var(--dsw-alias-label-primary, #0f1115);
      border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.1));
      font-family: var(--dsw-font-mono, ui-monospace, 'Cascadia Code', Consolas, monospace);
    }
    .dtt-term-header {
      flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 4px 10px;
      background: var(--dsw-alias-bg-base, #fff); font-size: 12px;
      color: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.9));
      border-bottom: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.08));
    }
    .dtt-term-title { color: var(--dsw-alias-label-primary, #0f1115); font-weight: 600; }
    .dtt-term-btn {
      height: 20px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.12));
      border-radius: 4px; background: transparent; cursor: pointer; font-size: 11px;
      color: var(--dsw-alias-label-primary, #0f1115);
    }
    .dtt-term-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06)); }
    .dtt-term-output {
      flex: 1 1 auto; overflow: auto; margin: 0; padding: 8px 10px;
      font-size: 12.5px; line-height: 1.45; white-space: pre-wrap; word-break: break-all;
      cursor: text;
    }
    .dtt-term-output:focus { outline: none; }
    .dtt-term-caret { animation: dtt-caret-blink 1.1s steps(1) infinite; }
    @keyframes dtt-caret-blink { 50% { opacity: 0; } }

    /* ---------- 保存按钮（文件查看用） ---------- */
    .dtt-save-btn {
      flex: 0 0 auto; height: 24px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.12));
      border-radius: 5px; background: transparent; cursor: pointer; font-size: 12px;
      color: var(--dsw-alias-label-primary, #0f1115);
    }
    .dtt-save-btn:hover { background: var(--dsw-alias-bg-hover, rgba(0,0,0,0.05)); }
    .dtt-save-btn.primary { color: #fff; background: var(--dsw-alias-state-info-primary, #2563eb); border-color: transparent; }
    .dtt-save-btn.primary:hover { background: var(--dsw-alias-state-info-hover, #1d4ed8); }
    .dtt-save-btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }
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

      const arrowCls = 'dtt-tree-arrow' + (isDir ? ' has-chevron' + (open ? ' open' : '') : '');
      const icon = isDir
        ? inlineSvgIcon(open ? FOLDER_OPEN_SVG : FOLDER_CLOSE_SVG)
        : fileIcon(entry.name);
      const iconCls = 'dtt-tree-icon' + (isDir && open ? ' dtt-tree-icon-active' : '');
      const rows = [];
      rows.push(React.createElement('div', {
        key: entry.path,
        className: 'dtt-tree-row' + (isDir ? ' dtt-tree-row-dir' : ''),
        style: { paddingLeft: (8 + props.depth * 14) + 'px' },
        title: entry.path,
        onClick: toggle,
      },
        React.createElement('span', { className: arrowCls }),
        React.createElement('span', { className: iconCls }, icon),
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
          }, svgIcon('open-file.svg', '🗀'))),
        React.createElement('div', { className: 'dtt-tree-scroll' },
          React.createElement('div', {
            className: 'dtt-tree-row dtt-tree-row-dir', title: root.path || '（主目录）',
            style: { paddingLeft: '8px' },
            onClick: function () { if (root.parent != null) load(root.parent); },
          },
            React.createElement('span', { className: 'dtt-tree-icon' }, svgIcon('root.svg', '根目录')),
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
      const [terminalAlive, setTerminalAlive] = React.useState(false); // 是否已创建（隐藏时保留，仅点 × 或退出销毁）

      // 切换终端可见性：首次打开即创建并保留；之后只是隐藏/显示，不销毁进程与状态。
      function toggleTerminal() {
        setTerminalAlive(true);
        setTerminalOpen(function (v) { return !v; });
      }
      // 显式关闭（点 ×）：真正卸载并终止 PTY。
      function closeTerminal() {
        setTerminalOpen(false);
        setTerminalAlive(false);
      }

      // 键盘快捷键（Ctrl+S 保存）需访问最新状态：用 ref 快照，避免闭包过期。
      const stateRef = React.useRef({ openFiles: openFiles, activeTab: activeTab });
      stateRef.current = { openFiles: openFiles, activeTab: activeTab };

      function updateFile(path, patch) {
        setOpenFiles(function (files) {
          return files.map(function (f) { return f.path === path ? Object.assign({}, f, patch) : f; });
        });
      }

      function onEditFile(path, value) {
        updateFile(path, { content: value, dirty: true, saveError: null });
      }

      function saveFile(path) {
        const f = stateRef.current.openFiles.find(function (x) { return x.path === path; });
        if (!f || f.status !== 'ready' || !f.dirty || f.saving) return;
        updateFile(path, { saving: true, saveError: null });
        rpc('writeFile', { path: path, content: f.content }).then(function (res) {
          if (res && res.ok) {
            updateFile(path, { dirty: false, saving: false, saveError: null, bytes: res.bytes, truncated: false });
          } else {
            updateFile(path, { saving: false, saveError: (res && res.error) || '保存失败' });
          }
        }).catch(function (err) {
          updateFile(path, { saving: false, saveError: String((err && err.message) || err) });
        });
      }

      // 把应用整体下移（顶部标签栏）并左移（右侧文件树），退出时还原。
      React.useEffect(function () {
        const rootEl = document.getElementById('root');
        if (!rootEl) return;
        const prevTop = rootEl.style.paddingTop;
        const prevRight = rootEl.style.paddingRight;
        rootEl.style.paddingTop = TAB_BAR_HEIGHT + 'px';
        rootEl.style.paddingRight = treeOpen ? treeWidth + 'px' : '0px';
        return function () {
          rootEl.style.paddingTop = prevTop;
          rootEl.style.paddingRight = prevRight;
        };
      }, [treeOpen, treeWidth]);

      // 全局快捷键：Ctrl + ` 切换终端
      React.useEffect(function () {
        function onKey(e) {
          if (e.key === '`' && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
            e.stopPropagation();
            toggleTerminal();
          }
        }
        window.addEventListener('keydown', onKey, true);
        return function () { window.removeEventListener('keydown', onKey, true); };
      }, []);

      // 全局快捷键：Ctrl + S 保存当前文件标签（仅在有文件激活且有未保存修改时）。
      React.useEffect(function () {
        function onKey(e) {
          if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S')) {
            const tab = stateRef.current.activeTab;
            if (tab === CHAT_TAB_KEY) return;
            e.preventDefault();
            e.stopPropagation();
            saveFile(tab);
          }
        }
        window.addEventListener('keydown', onKey, true);
        return function () { window.removeEventListener('keydown', onKey, true); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
          return files.concat([{ path: path, name: basenameOf(path), status: 'loading', content: '', error: null, bytes: 0, truncated: false, dirty: false, saving: false, saveError: null }]);
        });
        setActiveTab(path);
        rpc('readFile', { path: path }).then(function (res) {
          if (res && res.ok) {
            setOpenFiles(function (files) {
              return files.map(function (f) {
                return f.path === path ? { path: f.path, name: res.name, status: 'ready', content: res.content, error: null, bytes: res.bytes, truncated: res.truncated, dirty: false, saving: false, saveError: null } : f;
              });
            });
          } else {
            setOpenFiles(function (files) {
              return files.map(function (f) {
                return f.path === path ? { path: f.path, name: f.name, status: 'error', content: '', error: (res && res.error) || '读取失败', bytes: 0, truncated: false, dirty: false, saving: false, saveError: null } : f;
              });
            });
          }
        }).catch(function (err) {
          setOpenFiles(function (files) {
            return files.map(function (f) {
              return f.path === path ? { path: f.path, name: f.name, status: 'error', content: '', error: String((err && err.message) || err), bytes: 0, truncated: false, dirty: false, saving: false, saveError: null } : f;
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
      }, React.createElement('span', { className: 'dtt-file-icon' }, svgIcon('chat.svg', '聊天')),
         React.createElement('span', { className: 'dtt-tab-label' }, '聊天')));

      for (let i = 0; i < openFiles.length; i++) {
        const f = openFiles[i];
        const active = activeTab === f.path;
        tabNodes.push(React.createElement('div', {
          key: 'f:' + f.path,
          className: 'dtt-tab dtt-tab-file' + (active ? ' active' : ''),
          title: f.path,
          onClick: function () { setActiveTab(f.path); },
        }, React.createElement('span', { className: 'dtt-file-icon' }, fileIcon(f.name)),
           React.createElement('span', { className: 'dtt-tab-label' }, f.name),
           f.dirty ? React.createElement('span', { className: 'dtt-tab-dirty', title: '未保存' }, '●') : null,
           React.createElement('button', {
             className: 'dtt-tab-close', title: '关闭', type: 'button',
             onClick: function (e) { e.stopPropagation(); closeFile(f.path); },
           }, '×')));
      }

      const tabBar = React.createElement('div', { className: 'dtt-tabbar' },
        tabNodes,
        React.createElement('div', { className: 'dtt-spacer' }),
        React.createElement('button', {
          className: 'dtt-tabbar-btn' + (treeOpen ? ' active' : ''),
          title: '切换文件树', type: 'button',
          onClick: function () { setTreeOpen(function (v) { return !v; }); },
        }, treeOpen? svgIcon('file-tree-open.svg', '切换文件树') : svgIcon('file-tree.svg', '切换文件树')),
        React.createElement('button', {
          className: 'dtt-tabbar-btn', title: '切换终端（Ctrl + `）', type: 'button',
          onClick: toggleTerminal,
        }, terminalOpen ? svgIcon('terminal-open.svg', '终端') : svgIcon('terminal.svg', '终端')),
      );

      // ---------- 可编辑文件查看 ----------
      const activeFile = activeTab === CHAT_TAB_KEY ? null : openFiles.find(function (f) { return f.path === activeTab; });
      let reader = null;
      if (activeFile) {
        let body = null;
        if (activeFile.status === 'loading') {
          body = React.createElement('div', { className: 'dtt-reader-loading' }, '读取中…');
        } else if (activeFile.status === 'error') {
          body = React.createElement('div', { className: 'dtt-reader-error' }, '读取失败：' + activeFile.error);
        } else {
          body = React.createElement(CodeEditor, {
            name: activeFile.name,
            value: activeFile.content,
            onChange: function (v) { onEditFile(activeFile.path, v); },
          });
        }

        const byteLabel = activeFile.status === 'ready'
          ? ((activeFile.truncated ? '（截断）' : '') + activeFile.bytes + ' 字节')
          : '';
        const saveLabel = activeFile.saving ? '保存中…' : (activeFile.dirty ? '保存 ●' : '已保存');

        reader = React.createElement('div', {
          className: 'dtt-reader',
          style: { right: treeOpen ? treeWidth + 'px' : '0px' },
        },
          React.createElement('div', { className: 'dtt-reader-header' },
            React.createElement('span', { className: 'dtt-reader-title', title: activeFile.path }, activeFile.name),
            React.createElement('span', null, byteLabel),
            activeFile.saveError ? React.createElement('span', { className: 'dtt-reader-status error', title: activeFile.saveError }, '保存失败') : null,
            activeFile.dirty ? React.createElement('span', { className: 'dtt-reader-status' }, '未保存') : null,
            React.createElement('div', { className: 'dtt-spacer' }),
            React.createElement('button', {
              className: 'dtt-save-btn primary', type: 'button',
              disabled: activeFile.status !== 'ready' || !activeFile.dirty || activeFile.saving,
              onClick: function () { saveFile(activeFile.path); },
            }, saveLabel)),
          body,
        );
      }

      // 用原生 OS 目录选择器（与 DSH core 添加工作区一致）切换文件树根。
      function pickRootDir() {
        const ws = ctx.get ? ctx.get('workspaces') : null;
        if (!ws || typeof ws.pickDirectory !== 'function') {
          console.warn('[dsh-tabs-terminal] workspaces.pickDirectory 不可用');
          return;
        }
        ws.pickDirectory().then(function (path) {
          if (path) { setTreeRoot(path); setTreeOpen(true); }
        }).catch(function (err) {
          console.warn('[dsh-tabs-terminal] 选择目录失败', String((err && err.message) || err));
        });
      }

      // ---------- 文件树（含拖拽调宽手柄） ----------
      const treeRootPath = resolveTreeRoot();
      const tree = treeOpen ? React.createElement(FileTreePanel, {
        root: treeRootPath,
        width: treeWidth,
        onOpenFile: openFile,
        onPickRoot: pickRootDir,
      }) : null;

      // 拖拽调整文件树宽度（树在右侧：向左拖加宽）。
      function startResize(e) {
        e.preventDefault();
        const startX = e.clientX;
        const startW = treeWidth;
        function onMove(ev) {
          const w = Math.max(TREE_MIN_WIDTH, Math.min(TREE_MAX_WIDTH, startW - (ev.clientX - startX)));
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
        style: { right: treeWidth + 'px' },
        onPointerDown: startResize,
      }) : null;

      return React.createElement('div', { className: 'dtt-root', style: { pointerEvents: 'none' } },
        tabBar,
        tree,
        resizeHandle,
        reader,
        terminalAlive ? React.createElement(TerminalPanel, { hidden: !terminalOpen, onClose: closeTerminal, cwd: treeRootPath }) : null,
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

      React.useEffect(function () {
        let alive = true;
        let pollTimer = null;

        (async function () {
          const cols = Math.max(40, Math.floor(window.innerWidth / 8));
          const rows = 24;
          try {
            const r = await rpc('termStart', { cols: cols, rows: rows, cwd: props.cwd || undefined }, 30000);
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
      }, [output, status, input]);

      React.useEffect(function () {
        if (status === 'running' && !props.hidden && outputElRef.current) outputElRef.current.focus();
      }, [status, props.hidden]);

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

      function onTermKeyDown(e) {
        if (e.key === 'Enter') { e.preventDefault(); send(); return; }
        if (e.key === 'Backspace') { e.preventDefault(); setInput(function (v) { return v.slice(0, -1); }); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); navigateHistory(-1); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); navigateHistory(1); return; }
        if (e.key === 'c' && e.ctrlKey) { e.preventDefault(); sendInterrupt(); return; }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key.length === 1) { e.preventDefault(); setInput(function (v) { return v + e.key; }); }
      }

      const statusLabel = status === 'starting' ? '启动中…'
        : status === 'exited' ? '已退出' + (exitCode === null || exitCode === undefined ? '' : '（code ' + exitCode + '）')
        : status === 'error' ? '错误' : '运行中';

      return React.createElement('div', {
        className: 'dtt-terminal',
        style: { display: props.hidden ? 'none' : undefined },
        onClick: function () { if (outputElRef.current) outputElRef.current.focus(); },
      },
        React.createElement('div', { className: 'dtt-term-header' },
          React.createElement('span', { className: 'dtt-term-title' }, '终端'),
          React.createElement('span', null, statusLabel),
          pid ? React.createElement('span', null, 'PID ' + pid) : null,
          React.createElement('div', { className: 'dtt-spacer' }),
          React.createElement('button', { className: 'dtt-term-btn', type: 'button', title: '关闭终端（Ctrl + `）', onClick: props.onClose }, '×'),
        ),
        React.createElement('pre', {
          className: 'dtt-term-output', ref: outputElRef, tabIndex: 0, onKeyDown: onTermKeyDown,
        },
          error ? '[错误] ' + error + '\r\n' : (status === 'starting' ? '启动终端…\r\n' : output),
          status === 'running' ? React.createElement('span', null, input) : null,
          status === 'running' ? React.createElement('span', { className: 'dtt-term-caret' }, '\u2588') : null,
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
