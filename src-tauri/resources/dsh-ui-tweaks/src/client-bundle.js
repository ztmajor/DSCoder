'use strict';

// dsh-ui-tweaks — client half（静态 bundle 形态）
// - 设置页面「界面调整」分区：文本与表格 / 布局 / 功能（时间线 + 价格面板）
// - 文本调节快捷键：Ctrl + = / Ctrl + - 全局热键（可在设置中录制改绑）
// - 对话时间线导航轨（session 槽 conversation.input.dock）
// - host.call 经 fetch 走 /_dsh/dsh-ui-tweaks/<method>（JSON）
// - React 由 bundle 的 require('react') / require('react-dom') 提供（seed 模块）

const React = require('react');
const { createPortal } = require('react-dom');

const NS = 'ui-tweaks';
const ROUTE_BASE = '/_dsh/dsh-ui-tweaks';

// ---------- 默认值与边界（与 host 保持一致） ----------
const DEFAULT_FONT_SIZE = 16;
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 32;
const DEFAULT_CODE_FONT_SIZE = 13;
const MIN_CODE_FONT_SIZE = 8;
const MAX_CODE_FONT_SIZE = 32;
const DEFAULT_LINE_HEIGHT = 16;
const MIN_LINE_HEIGHT = 0;
const MAX_LINE_HEIGHT = 64;
const DEFAULT_DIALOG_WIDTH = 748;
const MIN_DIALOG_WIDTH = 600;
const MAX_DIALOG_WIDTH = 1600;
const DEFAULT_UI_OPACITY = 100;
const MIN_UI_OPACITY = 50;
const MAX_UI_OPACITY = 100;
const DEFAULT_CODE_FONT_SCALE = 81;

// ---------- 文本调节快捷键（与 host 校验规则保持一致） ----------
const DEFAULT_ZOOM_IN_SHORTCUT = ['Control', '='];
const DEFAULT_ZOOM_OUT_SHORTCUT = ['Control', '-'];
const SHORTCUT_MODIFIERS = ['Control', 'Shift', 'Alt', 'Meta'];
const SHORTCUT_MODIFIER_LABELS = { Control: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Meta: 'Win' };
const SHORTCUT_MAX_KEYS = 3;
const SHORTCUT_NAMED_KEYS = ['Space', 'Enter', 'Tab', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const SHORTCUT_SYMBOLS = '`~!@#$%^&*()-_=+[]{};:\'",<.>/?\\|';

const I18N = {
  nav: '界面调整',
  sectionText: '文本与表格',
  sectionLayout: '布局与样式',
  sectionFeatures: '功能',
  fontSize: '消息字体大小',
  fontSizeHint: '取值 10–32，作用于消息正文、标题、表格与代码。',
  codeFontSize: '代码字号',
  codeFontSizeHint: '代码绝对字号，取值 8–32px；13px 为默认（正文 16 时）。作用于代码块，行内代码按比例跟随。',
  lineHeight: '行高',
  lineHeightHint: '回复区垂直间距的基准值：消息之间、回复内块之间、正文行高、段落与列表边距都按它缩放；取值 0–64px，16 为默认。',
  tableStyle: '表格样式',
  tableStyleHint: 'Markdown 表格的外观：默认边框，或 Claude Desktop 卡片风格。',
  tableStyleDefault: '默认',
  tableStyleClaude: 'Claude Desktop',
  shortcut: '文本调节快捷键',
  shortcutHint: 'Ctrl + = 增大、Ctrl + - 减小：消息字体、行高、代码字号一次各调整 2。点击「修改」录制新组合键：1–3 个键，需包含至少一个修饰键（Ctrl / Shift / Alt / Win），Esc 取消；在输入框与文本域内不触发，避免误触。',
  shortcutZoomIn: '增大',
  shortcutZoomOut: '减小',
  shortcutEdit: '修改',
  shortcutSave: '保存',
  shortcutCancel: '取消',
  shortcutPlaceholder: '请按下快捷键…',
  shortcutRecording: '按下组合键，Esc 取消 · 需含修饰键，最多三个键',
  shortcutRecorded: '已录制，点击「保存」生效',
  shortcutNeedModifier: '需包含至少一个修饰键（Ctrl / Shift / Alt / Win），请重新录制',
  shortcutTooMany: '最多三个键，多余的修饰键已忽略',
  shortcutSaveFailed: '保存失败，请重试',
  shortcutConflict: '与另一个快捷键冲突，请重新录制',
  dialogWidth: '对话框宽度',
  dialogWidthHint: '取值 600–1600px；748 为默认列宽，数字越大越宽。',
  uiOpacity: '界面透明度',
  uiOpacityHint: '仅设置界面的不透明度（聊天界面不受影响，方便对照效果），取值 50–100%，100 为不透明；滑块右侧实时显示数值。',
  presetDefault: '默认',
  presetWide: '稍宽',
  presetWideXl: '更宽',
  timeline: '时间线',
  timelineHint: '在消息区右侧显示导航轨：悬停预览、点击跳转；会话较短时自动隐藏。',
  timelineOn: '开启',
  timelineOff: '关闭',
  priceBar: '价格面板',
  priceBarHint: '在会话头部右侧显示余额、峰谷价与花费胶囊；关闭后立即隐藏。',
  restoreDefault: '恢复默认',
  loading: '加载中…',
  unavailable: '设置暂不可用。',
  railLabel: '对话时间线',
  roleUser: '用户',
  noText: '（无文本内容）',
};

function resolveDialogWidth(value) {
  if (value === 'wide') return 880;
  if (typeof value === 'number') return value;
  return DEFAULT_DIALOG_WIDTH;
}

function resolveValue(value) {
  const fontSize = typeof value?.fontSize === 'number' ? value.fontSize : DEFAULT_FONT_SIZE;
  const codeFontSize = typeof value?.codeFontSize === 'number'
    ? Math.min(MAX_CODE_FONT_SIZE, Math.max(MIN_CODE_FONT_SIZE, value.codeFontSize))
    : Math.max(8, Math.round(fontSize * (13 / 16) * ((value?.codeFontScale ?? DEFAULT_CODE_FONT_SCALE) / DEFAULT_CODE_FONT_SCALE)));
  return {
    fontSize,
    codeFontSize,
    lineHeight: typeof value?.lineHeight === 'number' ? value.lineHeight : DEFAULT_LINE_HEIGHT,
    tableStyle: value?.tableStyle === 'claude' ? 'claude' : 'default',
    dialogWidth: resolveDialogWidth(value?.dialogWidth),
    timelineEnabled: value?.timelineEnabled ?? false,
    bottomInfoBarEnabled: value?.bottomInfoBarEnabled ?? true,
    zoomInShortcut: shortcutOf(value?.zoomInShortcut, DEFAULT_ZOOM_IN_SHORTCUT),
    zoomOutShortcut: shortcutOf(value?.zoomOutShortcut, DEFAULT_ZOOM_OUT_SHORTCUT),
    uiOpacity: typeof value?.uiOpacity === 'number'
      ? Math.min(MAX_UI_OPACITY, Math.max(MIN_UI_OPACITY, Math.round(value.uiOpacity)))
      : DEFAULT_UI_OPACITY,
  };
}

// ---------- 组合键工具 ----------
function shortcutOf(raw, fallback) {
  if (!Array.isArray(raw) || raw.length === 0) return fallback;
  for (const token of raw) if (typeof token !== 'string') return fallback;
  return raw;
}

// 触发键规范化：与 host 的白名单一致；返回 null 表示不支持（静默忽略）
function normalizeTriggerKey(key) {
  if (typeof key !== 'string' || key.length === 0) return null;
  if (key === ' ') return 'Space';
  if (key.length === 1) {
    if (/^[a-z]$/i.test(key)) return key.toUpperCase();
    if (/^[0-9]$/.test(key)) return key;
    if (SHORTCUT_SYMBOLS.indexOf(key) !== -1) return key;
    return null;
  }
  if (/^F([1-9]|1[0-2])$/.test(key)) return key;
  if (SHORTCUT_NAMED_KEYS.indexOf(key) !== -1) return key;
  return null;
}

function formatCombo(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) return '';
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test((navigator.platform || '') + (navigator.userAgent || ''));
  const metaLabel = isMac ? 'Cmd' : 'Win';
  return tokens.map((token) => {
    if (token === 'Meta') return metaLabel;
    return SHORTCUT_MODIFIER_LABELS[token] || token;
  }).join(' + ');
}

function sameCombo(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function comboHasTrigger(tokens) {
  if (!Array.isArray(tokens)) return false;
  return tokens.filter((t) => SHORTCUT_MODIFIERS.indexOf(t) === -1).length === 1;
}

function comboHasModifier(tokens) {
  if (!Array.isArray(tokens)) return false;
  return tokens.some((t) => SHORTCUT_MODIFIERS.indexOf(t) !== -1);
}

function isValidCombo(tokens) {
  return Array.isArray(tokens) && tokens.length >= 2 && tokens.length <= SHORTCUT_MAX_KEYS
    && comboHasModifier(tokens) && comboHasTrigger(tokens);
}

// 当前按键事件 → 规范化组合键（修饰键按固定顺序在前，触发键最后）
function comboOfEvent(event) {
  const mods = [];
  if (event.ctrlKey) mods.push('Control');
  if (event.shiftKey) mods.push('Shift');
  if (event.altKey) mods.push('Alt');
  if (event.metaKey) mods.push('Meta');
  const trigger = normalizeTriggerKey(event.key);
  if (trigger === null) return null;
  return mods.concat([trigger]);
}

function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable === true;
}

// ---------- 配置读写（same-origin HTTP） ----------
async function apiRequest(method, args) {
  const response = await fetch(ROUTE_BASE + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
    credentials: 'same-origin',
  });
  let body = null;
  try { body = await response.json(); } catch (e) { /* 非 JSON */ }
  if (!response.ok) {
    throw new Error((body && body.error) || ('HTTP ' + response.status));
  }
  return body;
}

class SettingsClient {
  constructor() {
    this.state = { status: 'loading', writable: false, value: undefined, revision: undefined };
    this.listeners = new Set();
    this.generation = 0;
  }
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = () => this.state;
  publish(next) {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
  async load() {
    const generation = ++this.generation;
    try {
      const snapshot = await apiRequest('getConfig');
      if (generation !== this.generation) return;
      this.publish({ status: 'ready', writable: snapshot.writable, value: snapshot.value, revision: snapshot.revision });
    } catch (error) {
      if (generation !== this.generation) return;
      this.publish({ ...this.state, status: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  }
  async set(field, value) {
    const generation = ++this.generation;
    const snapshot = await apiRequest('setField', { field, value });
    if (generation !== this.generation) return;
    this.publish({ status: 'ready', writable: snapshot.writable, value: snapshot.value, revision: snapshot.revision });
  }
  async unset(field) {
    const generation = ++this.generation;
    const snapshot = await apiRequest('unsetField', { field });
    if (generation !== this.generation) return;
    this.publish({ status: 'ready', writable: snapshot.writable, value: snapshot.value, revision: snapshot.revision });
  }
  // 快捷键一次性调整三个字段；主机端按请求到达顺序逐个应用，连按不会互相覆盖
  async adjust(delta) {
    const generation = ++this.generation;
    const snapshot = await apiRequest('adjust', { delta });
    if (generation !== this.generation) return;
    this.publish({ status: 'ready', writable: snapshot.writable, value: snapshot.value, revision: snapshot.revision });
  }
}

// ---------- 运行时 CSS ----------
function rel(base, fontSize) {
  return Math.max(8, Math.round((base / DEFAULT_FONT_SIZE) * fontSize));
}

function buildFontCss(fontSize, lineHeight, codeFontSize) {
  const cs = getComputedStyle(document.body);
  const fam = (name, fallback) => {
    const value = cs.getPropertyValue(name).trim();
    return value.length > 0 ? value : fallback;
  };
  const base = fam('--dsw-font-markdown-base-font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif');
  const code = fam('--dsw-font-markdown-code-font-family', '"SF Mono", Consolas, monospace');
  const codeBlock = fam('--dsw-font-markdown-code-block-font-family', '"SF Mono", Consolas, monospace');

  const parts = [];
  const token = (shorthand, size, baseLine, family) => {
    const line = Math.max(12, Math.round((baseLine / DEFAULT_FONT_SIZE) * fontSize * (lineHeight / DEFAULT_LINE_HEIGHT)));
    parts.push(`--${shorthand}:${size}px/${line}px ${family}`);
    parts.push(`--${shorthand}-font-size:${size}px`);
    parts.push(`--${shorthand}-line-height:${line}px`);
  };
  const codePx = (blockRatio) => Math.max(8, Math.round(codeFontSize * blockRatio));
  token('dsw-font-markdown-base', fontSize, 28, base);
  token('dsw-font-markdown-base-strong', fontSize, 28, base);
  token('dsw-font-markdown-base-italic', fontSize, 28, base);
  token('dsw-font-markdown-base-strong-italic', fontSize, 28, base);
  token('dsw-font-markdown-h1', rel(24, fontSize), 34, base);
  token('dsw-font-markdown-h2', rel(22, fontSize), 32, base);
  token('dsw-font-markdown-h3', rel(20, fontSize), 30, base);
  token('dsw-font-markdown-h4', fontSize, 28, base);
  token('dsw-font-markdown-code', codePx(14 / 13), 22, code);
  token('dsw-font-markdown-code-block', codePx(1), 22, codeBlock);
  token('dsw-font-markdown-code-block-small', codePx(12 / 13), 18, codeBlock);
  return `body{${parts.join(';')}}`;
}

const CLAUDE_TABLE_CSS = `
div[data-slot="conversation.chat.node"] table{
  border-collapse:separate !important;
  border-spacing:3px !important;
  width:100% !important;
  border:none !important;
  font-size:var(--dsw-font-markdown-base-font-size) !important;
}
div[data-slot="conversation.chat.node"] table thead th{
  background:var(--dsw-alias-markdown-inline-code) !important;
  color:inherit !important;
  font-weight:400 !important;
  font-size:inherit !important;
  padding:7px 10px !important;
  border:none !important;
  border-radius:6px !important;
}
div[data-slot="conversation.chat.node"] table tbody td{
  background:var(--dsw-alias-markdown-inline-code) !important;
  color:inherit !important;
  font-size:inherit !important;
  padding:7px 10px !important;
  vertical-align:top !important;
  border:none !important;
  border-radius:6px !important;
}
div[data-slot="conversation.chat.node"] table code,
div[data-slot="conversation.chat.node"] table pre{
  background:transparent !important;
  border:none !important;
  box-shadow:none !important;
}
`;

function buildRuntimeCss(value) {
  const rules = [];
  rules.push(buildFontCss(value.fontSize, value.lineHeight, value.codeFontSize));
  rules.push(`[data-chat-flow-kind="user"] [class^="_text_"],[data-chat-flow-kind="steering"] [class^="_text_"],[data-pending-steering] [class^="_text_"]{font-size:var(--dsw-font-markdown-base-font-size) !important}`);
  rules.push(`[data-composer-card="true"] textarea,[data-composer-card="true"] [data-input-backdrop],[data-composer-card="true"] [data-input-mirror]{font-size:var(--dsw-font-markdown-base-font-size) !important}`);
  rules.push(`[data-composer-card="true"] textarea::placeholder{font-size:var(--dsw-font-markdown-base-font-size) !important}`);
  rules.push(`div[data-slot="conversation.chat.node"] table th,div[data-slot="conversation.chat.node"] table td{font-size:var(--dsw-font-markdown-base-font-size) !important}`);
  const stockCodeBlock = value.fontSize * (13 / 16);
  if (Math.abs(value.codeFontSize - stockCodeBlock) > 0.5) {
    const em = (0.875 * (value.codeFontSize / stockCodeBlock)).toFixed(3);
    rules.push(`div[data-slot="conversation.chat.node"] div[class*="_markdown_"] :not(pre)>code{font-size:${em}em !important}`);
  }
  if (value.lineHeight !== DEFAULT_LINE_HEIGHT) {
    const n = value.lineHeight;
    const md = `div[data-slot="conversation.chat.node"] div[class*="_markdown_"]`;
    const liGap = Math.max(2, Math.round((6 * n) / DEFAULT_LINE_HEIGHT));
    const liPGap = Math.max(2, Math.round((8 * n) / DEFAULT_LINE_HEIGHT));
    rules.push(`div[data-slot="conversation.view"] .Md3f7G_column{gap:${n}px !important}`);
    rules.push(`div[data-slot="conversation.chat.node"] .Sxvs8a_body{gap:${n}px !important}`);
    rules.push(`${md} p{margin:${n}px 0 !important}`);
    rules.push(`${md} ul,${md} ol{margin:${n}px 0 !important}`);
    rules.push(`${md} pre{margin:${n}px 0 !important}`);
    const codePad = Math.max(4, Math.round((16 * n) / DEFAULT_LINE_HEIGHT));
    rules.push(`${md} pre{padding-top:${codePad}px !important;padding-bottom:${codePad}px !important}`);
    if (value.tableStyle !== 'claude') {
      const cellPad = Math.max(2, Math.round((10 * n) / DEFAULT_LINE_HEIGHT));
      rules.push(`${md} table th,${md} table td{padding-top:${cellPad}px !important;padding-bottom:${cellPad}px !important}`);
    }
    rules.push(`${md} li:not(:first-child){margin-top:${liGap}px !important}`);
    rules.push(`${md} li>p{margin:${liPGap}px 0 !important}`);
    rules.push(`${md} h1,${md} h2,${md} h3{margin:${2 * n}px 0 ${n}px !important}`);
    rules.push(`${md} h4,${md} h5,${md} h6{margin:${n}px 0 !important}`);
    rules.push(`${md} hr{margin:${2 * n}px 0 !important}`);
    rules.push(`${md} blockquote{margin:${n}px 0 0 !important}`);
    rules.push(`${md} > :first-child{margin-top:0 !important}`);
    rules.push(`${md} > :last-child{margin-bottom:0 !important}`);
  }
  if (value.dialogWidth !== DEFAULT_DIALOG_WIDTH) {
    const width = value.dialogWidth;
    rules.push(`[data-chat-flow]{max-width:${width}px !important}`);
    rules.push(`[data-composer-card="true"]{max-width:${width + 32}px !important}`);
    rules.push(`[data-slot="conversation.composer.dock"] > div{max-width:${width + 32}px !important}`);
    rules.push(`:root{--dsh-composer-card-max-width:${width + 32}px}`);
  }
  if (value.tableStyle === 'claude') {
    rules.push(CLAUDE_TABLE_CSS);
  }
  return rules.join('\n');
}

function runtimeStyleElement() {
  const id = 'dsh-ui-tweaks-runtime';
  let style = document.querySelector(`style[data-plugin-css="${id}"]`);
  if (style === null) {
    style = document.createElement('style');
    style.dataset.plugin = 'dsh-ui-tweaks';
    style.dataset.pluginCss = id;
    document.head.appendChild(style);
  }
  return style;
}

// ---------- 设置界面透明度 ----------
// 只把不透明度应用到设置界面所在的浮层（向上定位 overlay/面板），聊天界面不受影响，
// 方便一边看聊天区一边调节。设置面板未打开时找不到目标，直接跳过。
function findSettingsLayer(start) {
  let node = start.parentElement;
  let fixedFallback = null;
  let absFallback = null;
  let guard = 0;
  while (node !== null && guard++ < 25) {
    if (typeof node.getAttribute === 'function' && node.getAttribute('role') === 'dialog') return node;
    const style = getComputedStyle(node);
    const pos = style.position;
    if (pos === 'fixed' || pos === 'absolute') {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        // 优先选择覆盖大块视口的 fixed 层（overlay/面板），小浮层只是候选
        if (pos === 'fixed' && (rect.height >= window.innerHeight * 0.4 || rect.width >= window.innerWidth * 0.4)) {
          return node;
        }
        if (fixedFallback === null && pos === 'fixed') fixedFallback = node;
        if (absFallback === null && pos === 'absolute') absFallback = node;
      }
    }
    node = node.parentElement;
  }
  return fixedFallback ?? absFallback ?? start;
}

// 定位结果缓存：面板以 display 隐藏/显示（DOM 复用）时无需重新遍历；
// 元素断开（面板 DOM 重建）或 GC 后自动失效并重新定位。
const canWeakRef = typeof WeakRef === 'function';
let settingsLayerCache = null; // WeakRef<Element> | Element | null

function readSettingsLayerCache() {
  if (settingsLayerCache === null) return null;
  const el = canWeakRef ? settingsLayerCache.deref() : settingsLayerCache;
  if (el === undefined || el === null || !el.isConnected) {
    settingsLayerCache = null;
    return null;
  }
  return el;
}

function writeSettingsLayerCache(el) {
  const prev = readSettingsLayerCache();
  if (prev !== null && prev !== el) {
    try { prev.style.opacity = ''; } catch (err) { /* 忽略 */ }
  }
  settingsLayerCache = canWeakRef ? new WeakRef(el) : el;
}

// 无锚点兜底：设置面板刚打开时默认 tab 可能不是「界面调整」（.dut-settings 未挂载）。
// 事件驱动定位：从“信号来源节点”（新增节点 / 被改属性的元素 / 焦点元素）向上找
// 其最外层 fixed/absolute 祖先（即浮层壳），配合最小面积阈值过滤小浮层，避免误伤。
function isSettingsLayerCandidate(el) {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  if (el.childElementCount === 0 && (el.textContent || '').trim().length === 0) return false;
  const area = rect.width * rect.height;
  const viewportArea = (window.innerWidth || 1) * (window.innerHeight || 1);
  return area >= viewportArea * 0.15;
}

function findOutermostLayer(node) {
  let best = null;
  let cur = node;
  let guard = 0;
  while (cur !== null && cur !== document.body && cur !== document.documentElement && guard++ < 50) {
    const style = getComputedStyle(cur);
    if (style.position === 'fixed' || style.position === 'absolute') {
      if (isSettingsLayerCandidate(cur)) best = cur;
    }
    cur = cur.parentElement;
  }
  return best;
}

function applySettingsOpacity(opacity, sourceNodes) {
  if (typeof document === 'undefined') return;
  const targetOpacity = opacity >= 100 ? '' : String(Math.round(opacity) / 100);
  let layer = readSettingsLayerCache();
  const root = document.querySelector('.dut-settings');
  if (root !== null) {
    // 缓存层失效或不再包含当前设置内容（面板层重建）时，以锚点重新定位（结果最准确）
    if (layer === null || !layer.contains(root)) {
      layer = findSettingsLayer(root);
      if (layer !== null) writeSettingsLayerCache(layer);
    }
  }
  if (layer === null && sourceNodes !== undefined) {
    // 无锚点且无有效缓存：面板刚打开（默认 tab 不是「界面调整」），从信号来源向上定位浮层；
    // 之后切到「界面调整」会经锚点重新校准，误定位的层会被自动清除透明度
    for (const src of sourceNodes) {
      if (src === null || src.nodeType !== 1) continue;
      const candidate = findOutermostLayer(src);
      if (candidate !== null) {
        layer = candidate;
        writeSettingsLayerCache(candidate);
        break;
      }
    }
  }
  if (layer === null) return; // 设置面板未打开：跳过，等面板出现后再应用
  if (layer.style.opacity !== targetOpacity) layer.style.opacity = targetOpacity;
}

const BASE_CSS = `
.dut-settings{display:grid;gap:8px;max-width:680px;padding:4px 2px 24px;color:var(--dsw-alias-label-primary)}
.dut-panel{display:grid;gap:0;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv1);overflow:hidden}
.dut-section-label{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);padding:6px 16px 5px}
.dut-section-label .dut-restore-btn{text-transform:none;letter-spacing:0;font-weight:600}
.dut-field{display:grid;gap:6px;padding:7px 16px 10px}
.dut-field+.dut-field{border-top:1px solid var(--dsw-alias-border-l1)}
.dut-grid{grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:1px;background:var(--dsw-alias-border-l1)}
.dut-grid>.dut-section-label{grid-column:1/-1;background:var(--dsw-alias-bg-layer-1)}
.dut-grid .dut-field{background:var(--dsw-alias-bg-layer-1)}
.dut-grid .dut-field+.dut-field{border-top:none}
.dut-field-top{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.dut-field-top>span{font-size:13.5px;font-weight:600}
.dut-label{display:inline-flex;align-items:center;gap:6px}
.dut-hint{flex:none;display:inline-grid;place-items:center;width:15px;height:15px;border-radius:50%;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-size:9.5px;font-weight:600;font-style:normal;line-height:1;cursor:help;user-select:none;transition:color .15s ease,border-color .15s ease}
.dut-hint:hover,.dut-hint:focus-visible{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}
.dut-hint-pop{position:fixed;z-index:9999;width:max-content;max-width:300px;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:11.5px;line-height:1.5;box-shadow:0 4px 16px rgba(0,0,0,.14);pointer-events:none}
.dut-controls{display:flex;align-items:center;gap:8px}
.dut-stepper{display:inline-flex;align-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.dut-stepper button{width:28px;height:28px;border:none;background:transparent;color:inherit;font-size:15px;font-weight:500;line-height:1;cursor:pointer;display:grid;place-items:center;transition:background .15s ease}
.dut-stepper button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dut-stepper button:disabled{opacity:.35;cursor:default}
.dut-stepper input{box-sizing:border-box;width:60px;height:28px;border:none;border-left:1px solid var(--dsw-alias-border-l1);border-right:1px solid var(--dsw-alias-border-l1);background:transparent;color:inherit;font:inherit;font-size:13px;text-align:center;-moz-appearance:textfield}
.dut-stepper input::-webkit-outer-spin-button,.dut-stepper input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.dut-stepper input:focus{outline:none}
.dut-seg{display:inline-flex;padding:3px;gap:3px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}
.dut-seg button{border:none;border-radius:7px;padding:5px 12px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;cursor:pointer;transition:background .15s ease,color .15s ease}
.dut-seg button:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.dut-seg button.dut-seg-active{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);color:var(--dsw-alias-state-business-primary);font-weight:600;box-shadow:none}
.dut-seg button:disabled{opacity:.45;cursor:default}
.dut-presets{display:inline-flex;flex-wrap:wrap;margin-top:2px}
.dut-range{display:flex;align-items:center;gap:10px}
.dut-range input[type="range"]{-webkit-appearance:none;appearance:none;flex:1;min-width:150px;max-width:240px;height:18px;margin:0;background:transparent;cursor:pointer}
.dut-range input[type="range"]:disabled{opacity:.45;cursor:default}
.dut-range input[type="range"]::-webkit-slider-runnable-track{height:4px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-tertiary) 32%,transparent)}
.dut-range input[type="range"]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;margin-top:-6px;border-radius:50%;background-color:color-mix(in srgb,var(--dsw-alias-label-tertiary) 45%,var(--dsw-alias-bg-layer-1));background-image:radial-gradient(circle,var(--dsw-alias-state-business-primary) 49%,transparent 50%);background-size:9px 9px;background-position:center;background-repeat:no-repeat;border:1px solid var(--dsw-alias-border-l1);box-shadow:0 1px 3px rgba(0,0,0,.18);cursor:pointer;transition:background-size .16s ease,border-color .15s ease,box-shadow .15s ease}
.dut-range input[type="range"]::-webkit-slider-thumb:hover{background-size:13px 13px;border-color:var(--dsw-alias-state-business-primary)}
.dut-range input[type="range"]:focus-visible{outline:none}
.dut-range input[type="range"]:focus-visible::-webkit-slider-thumb{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 25%,transparent)}
.dut-range input[type="range"]::-moz-range-track{height:4px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-tertiary) 32%,transparent)}
.dut-range input[type="range"]::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background-color:color-mix(in srgb,var(--dsw-alias-label-tertiary) 45%,var(--dsw-alias-bg-layer-1));background-image:radial-gradient(circle,var(--dsw-alias-state-business-primary) 49%,transparent 50%);background-size:9px 9px;background-position:center;background-repeat:no-repeat;border:1px solid var(--dsw-alias-border-l1);box-shadow:0 1px 3px rgba(0,0,0,.18);cursor:pointer;transition:background-size .16s ease,border-color .15s ease}
.dut-range input[type="range"]::-moz-range-thumb:hover{background-size:13px 13px;border-color:var(--dsw-alias-state-business-primary)}
.dut-range-value{min-width:38px;text-align:right;font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
.dut-btn{display:inline-flex;align-items:center;height:26px;padding:0 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;cursor:pointer;transition:background .15s ease,color .15s ease,border-color .15s ease}
.dut-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dut-btn.dut-btn-active{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 45%,transparent);color:var(--dsw-alias-state-business-primary)}
.dut-btn:disabled{opacity:.4;cursor:default}
.dut-restore-btn{flex:none}
.dut-restore-btn:active:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 50%,transparent);color:var(--dsw-alias-state-business-primary)}
.dut-loading{padding:16px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);font-size:12px;color:var(--dsw-alias-label-secondary)}
.dut-alert{padding:10px 12px;border-radius:10px;font-size:12px;line-height:1.5}
.dut-alert.error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}
.dut-shortcut-item{display:grid;gap:3px}
.dut-shortcut-rows{display:grid;gap:9px;margin-top:2px}
.dut-shortcut-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dut-shortcut-tag{flex:none;min-width:34px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.dut-shortcut-key{box-sizing:border-box;flex:1 1 150px;min-width:140px;max-width:250px;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit;font-size:12.5px;text-align:center;letter-spacing:.02em;outline:none;transition:border-color .15s ease,box-shadow .15s ease,background-color .15s ease}
.dut-shortcut-key::placeholder{color:var(--dsw-alias-label-tertiary)}
.dut-shortcut-key:focus{border-color:var(--dsw-alias-state-business-primary)}
.dut-shortcut-key:disabled{opacity:.45;cursor:default}
.dut-shortcut-key-recording{border-color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 8%,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary) 16%,transparent);animation:dut-key-pulse 1.6s ease-in-out infinite}
.dut-shortcut-key-recording::placeholder{color:var(--dsw-alias-state-business-primary)}
@keyframes dut-key-pulse{0%,100%{box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent)}50%{box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 34%,transparent)}}
@media (prefers-reduced-motion:reduce){.dut-shortcut-key-recording{animation:none}}
.dut-shortcut-status{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-tertiary);min-height:15px;padding:0 2px}
.dut-shortcut-status-warn{color:var(--dsw-alias-state-error-primary)}
`;

function installBaseStyles() {
  const id = 'dsh-ui-tweaks-base';
  const existing = document.querySelector(`style[data-plugin-css="${id}"]`);
  if (existing !== null) return () => {};
  const style = document.createElement('style');
  style.dataset.plugin = 'dsh-ui-tweaks';
  style.dataset.pluginCss = id;
  style.textContent = BASE_CSS;
  document.head.appendChild(style);
  return () => { style.remove(); };
}

// ---------- Hint 悬浮说明 ----------
function Hint({ text }) {
  const anchorRef = React.useRef(null);
  const popRef = React.useRef(null);
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState({ top: -9999, left: -9999 });
  React.useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current?.getBoundingClientRect();
    const pop = popRef.current;
    if (anchor === undefined || pop === null) return;
    const left = Math.min(Math.max(8, anchor.left), window.innerWidth - pop.offsetWidth - 8);
    let top = anchor.top - pop.offsetHeight - 8;
    if (top < 8) top = anchor.bottom + 8;
    setPos({ top, left });
  }, [open]);
  return React.createElement(React.Fragment, null,
    React.createElement('span', {
      ref: anchorRef, className: 'dut-hint', role: 'note', 'aria-label': text, tabIndex: 0,
      onMouseEnter: () => { setOpen(true); },
      onMouseLeave: () => { setOpen(false); },
      onFocus: () => { setOpen(true); },
      onBlur: () => { setOpen(false); },
    }, 'i'),
    open ? createPortal(
      React.createElement('div', { ref: popRef, className: 'dut-hint-pop', style: { top: pos.top, left: pos.left } }, text),
      document.body,
    ) : null,
  );
}

// ---------- 设置分区（文本与表格 / 布局 / 功能） ----------
function Field(props) {
  const { label, hint, children, extra } = props;
  return React.createElement('div', { className: 'dut-field' },
    React.createElement('div', { className: 'dut-field-top' },
      React.createElement('span', { className: 'dut-label' }, label, hint ? React.createElement(Hint, { text: hint }) : null),
      React.createElement('div', { className: 'dut-controls' }, children),
    ),
    extra ? extra : null,
  );
}

// 分区标题行：左侧分区名，最右侧放置该分区统一的「恢复默认」按钮
function SectionLabel(props) {
  const { title, onRestore } = props;
  return React.createElement('div', { className: 'dut-section-label' },
    React.createElement('span', null, title),
    onRestore ? React.createElement(RestoreBtn, { onClick: onRestore }) : null,
  );
}

function Stepper(props) {
  const { value, draft, min, max, step, disabled, onStep, onChange, onCommit } = props;
  return React.createElement('div', { className: 'dut-stepper' },
    React.createElement('button', { type: 'button', 'aria-label': '−', disabled: disabled || value <= min, onClick: () => onStep(-step) }, '−'),
    React.createElement('input', {
      type: 'number', min, max, step, value: draft, disabled,
      onChange: (event) => { onChange(event.target.value); },
      onBlur: (event) => { onCommit(event.target.value); },
      onKeyDown: (event) => { if (event.key === 'Enter') onCommit(event.target.value); },
    }),
    React.createElement('button', { type: 'button', 'aria-label': '+', disabled: disabled || value >= max, onClick: () => onStep(step) }, '+'),
  );
}

function Seg(props) {
  const { options, value, disabled } = props;
  return React.createElement('div', { className: 'dut-seg' },
    options.map((o) => React.createElement('button', {
      key: o.value, type: 'button', disabled,
      className: value === o.value ? 'dut-seg-active' : '',
      onClick: o.onClick,
    }, o.label)),
  );
}

// 界面透明度：音量条（滑块）形式，右侧实时显示数值（百分比）
function OpacityControl(props) {
  const { value, disabled, onCommit } = props;
  return React.createElement('div', { className: 'dut-range' },
    React.createElement('input', {
      type: 'range', min: MIN_UI_OPACITY, max: MAX_UI_OPACITY, step: 1,
      value, disabled,
      'aria-label': I18N.uiOpacity,
      onChange: (event) => { onCommit(Number(event.target.value)); },
    }),
    React.createElement('span', { className: 'dut-range-value' }, value + '%'),
  );
}

// 恢复默认按钮：位于每个 label 行的最右侧；按下即高亮（:active），松开鼠标时触发恢复并取消高亮
function RestoreBtn(props) {
  const { disabled, onClick } = props;
  return React.createElement('button', {
    type: 'button', disabled,
    className: 'dut-btn dut-restore-btn',
    onMouseDown: (event) => { event.preventDefault(); }, // 保持输入框焦点，避免 blur 提交竞态
    onClick,
  }, I18N.restoreDefault);
}

// ---------- 文本调节快捷键：全局热键 + 录制组件 ----------
const activeRecorders = new Set();
let recorderSeq = 0;

function installHotkeys(controller) {
  const onKeyDown = (event) => {
    if (activeRecorders.size > 0) return;            // 录制中：按键交给录制输入框
    if (isEditableTarget(event.target)) return;       // 输入框/文本域内不触发，避免误触
    const state = controller.getSnapshot();
    if (state.status !== 'ready' || !state.value) return;
    const combo = comboOfEvent(event);
    if (combo === null) return;
    const zoomIn = shortcutOf(state.value.zoomInShortcut, DEFAULT_ZOOM_IN_SHORTCUT);
    const zoomOut = shortcutOf(state.value.zoomOutShortcut, DEFAULT_ZOOM_OUT_SHORTCUT);
    const isIn = sameCombo(combo, zoomIn);
    if (!isIn && !sameCombo(combo, zoomOut)) return;
    event.preventDefault();                           // 拦截浏览器/宿主自身的 Ctrl+= / Ctrl+- 缩放
    event.stopPropagation();
    if (event.repeat) return;                         // 长按不连发：一次按键只调整一步
    void controller.adjust(isIn ? 2 : -2).catch(() => {});
  };
  window.addEventListener('keydown', onKeyDown, { capture: true });
  return () => { window.removeEventListener('keydown', onKeyDown, { capture: true }); };
}

function ShortcutRow(props) {
  const { tag, field, savedValue, disabled, controller } = props;
  const recorderIdRef = React.useRef(null);
  if (recorderIdRef.current === null) recorderIdRef.current = ++recorderSeq;
  const recorderId = recorderIdRef.current;

  const inputRef = React.useRef(null);
  const heldModsRef = React.useRef([]);
  const [mode, setMode] = React.useState('idle'); // idle | recording | done
  const [combo, setCombo] = React.useState(null);
  const [heldMods, setHeldMods] = React.useState([]);
  const [note, setNote] = React.useState(null);

  const stop = React.useCallback(() => {
    activeRecorders.delete(recorderId);
    heldModsRef.current = [];
    setMode('idle');
    setCombo(null);
    setHeldMods([]);
    setNote(null);
  }, [recorderId]);
  const start = React.useCallback(() => {
    activeRecorders.add(recorderId);
    heldModsRef.current = [];
    setMode('recording');
    setCombo(null);
    setHeldMods([]);
    setNote(null);
  }, [recorderId]);

  // 组件卸载（如离开设置页）时兜底解除录制，避免全局热键被锁死
  React.useEffect(() => () => { activeRecorders.delete(recorderId); }, [recorderId]);

  const beginCapture = () => {
    if (disabled) return;
    start();
    if (inputRef.current !== null) inputRef.current.focus();
  };

  const captureKey = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') { stop(); return; }
    if (SHORTCUT_MODIFIERS.indexOf(event.key) !== -1) {
      if (heldModsRef.current.indexOf(event.key) === -1) {
        heldModsRef.current = SHORTCUT_MODIFIERS.filter(
          (m) => heldModsRef.current.indexOf(m) !== -1 || m === event.key,
        );
      }
      setHeldMods(heldModsRef.current);
      return;
    }
    const trigger = normalizeTriggerKey(event.key);
    if (trigger === null) return; // 不支持的按键：静默忽略
    let mods = heldModsRef.current;
    if (mods.length > SHORTCUT_MAX_KEYS - 1) {
      mods = mods.slice(0, SHORTCUT_MAX_KEYS - 1);
      setNote({ kind: 'warn', text: I18N.shortcutTooMany });
    }
    heldModsRef.current = [];
    setHeldMods([]);
    setCombo(mods.concat([trigger]));
    setMode('done');
    if (mods.length === 0) setNote({ kind: 'warn', text: I18N.shortcutNeedModifier });
  };

  const onKeyDown = (event) => {
    if (mode === 'recording') { captureKey(event); return; }
    if (mode === 'done') {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') { stop(); return; }
      // 录制完成后再按键：视为重新录制，立即处理当前按键
      heldModsRef.current = [];
      setHeldMods([]);
      setCombo(null);
      setNote(null);
      setMode('recording');
      captureKey(event);
    }
  };

  const onKeyUp = (event) => {
    if (mode !== 'recording') return;
    if (SHORTCUT_MODIFIERS.indexOf(event.key) === -1) return;
    heldModsRef.current = heldModsRef.current.filter((m) => m !== event.key);
    setHeldMods(heldModsRef.current);
  };

  const onBlur = () => { if (mode !== 'idle') stop(); };

  const canSave = mode === 'done' && isValidCombo(combo);
  const save = () => {
    if (!isValidCombo(combo)) return;
    controller.set(field, combo)
      .then(() => { stop(); })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setNote({
          kind: 'warn',
          text: message.indexOf('conflict') !== -1 ? I18N.shortcutConflict : I18N.shortcutSaveFailed,
        });
      });
  };

  let display = formatCombo(savedValue);
  if (mode === 'recording') display = heldMods.length > 0 ? formatCombo(heldMods) + ' + …' : '';
  else if (mode === 'done') display = formatCombo(combo);
  const status = note !== null ? note
    : mode === 'recording' ? { kind: 'info', text: I18N.shortcutRecording }
    : mode === 'done' ? { kind: 'info', text: I18N.shortcutRecorded }
    : null;

  return React.createElement('div', { className: 'dut-shortcut-item' },
    React.createElement('div', { className: 'dut-shortcut-row' },
      React.createElement('span', { className: 'dut-shortcut-tag' }, tag),
      React.createElement('input', {
        ref: inputRef,
        className: 'dut-shortcut-key' + (mode !== 'idle' ? ' dut-shortcut-key-recording' : ''),
        type: 'text',
        readOnly: true,
        disabled,
        value: display,
        placeholder: I18N.shortcutPlaceholder,
        'aria-label': tag,
        onKeyDown,
        onKeyUp,
        onBlur,
      }),
      mode === 'idle'
        ? React.createElement('button', { type: 'button', className: 'dut-btn', disabled, onClick: beginCapture }, I18N.shortcutEdit)
        : React.createElement(React.Fragment, null,
          React.createElement('button', {
            type: 'button', className: 'dut-btn dut-btn-active', disabled: !canSave,
            onMouseDown: (event) => { event.preventDefault(); }, // 防止失焦取消录制
            onClick: save,
          }, I18N.shortcutSave),
          React.createElement('button', {
            type: 'button', className: 'dut-btn',
            onMouseDown: (event) => { event.preventDefault(); },
            onClick: stop,
          }, I18N.shortcutCancel),
        ),
    ),
    React.createElement('div', {
      className: 'dut-shortcut-status' + (status !== null && status.kind === 'warn' ? ' dut-shortcut-status-warn' : ''),
    }, status !== null ? status.text : '\u00A0'),
  );
}

function SettingsSection({ controller }) {
  const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const resolved = resolveValue(state.value);
  const writable = state.writable;

  const [draft, setDraft] = React.useState(String(resolved.fontSize));
  const [codeDraft, setCodeDraft] = React.useState(String(resolved.codeFontSize));
  const [lineHeightDraft, setLineHeightDraft] = React.useState(String(resolved.lineHeight));
  const [widthDraft, setWidthDraft] = React.useState(String(resolved.dialogWidth));

  React.useEffect(() => { if (state.status === 'loading' && state.value === undefined) void controller.load(); }, [controller, state.status, state.value]);
  React.useEffect(() => { setDraft(String(resolved.fontSize)); }, [resolved.fontSize]);
  React.useEffect(() => { setCodeDraft(String(resolved.codeFontSize)); }, [resolved.codeFontSize]);
  React.useEffect(() => { setLineHeightDraft(String(resolved.lineHeight)); }, [resolved.lineHeight]);
  React.useEffect(() => { setWidthDraft(String(resolved.dialogWidth)); }, [resolved.dialogWidth]);
  // 面板挂载/透明度变化时应用设置界面透明度（宿主重建面板 DOM 后也会重新应用）
  React.useEffect(() => { applySettingsOpacity(resolved.uiOpacity); }, [resolved.uiOpacity]);

  const commitNumber = (field, raw, setter, min, max) => {
    setter(raw);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.min(max, Math.max(min, Math.round(parsed)));
    setter(String(clamped));
    void controller.set(field, clamped).catch(() => {});
  };
  const step = (field, current, setter, min, max, delta) => {
    const next = Math.min(max, Math.max(min, current + delta));
    setter(String(next));
    void controller.set(field, next).catch(() => {});
  };
  const togglePriceBar = (next) => {
    void controller.set('bottomInfoBarEnabled', next).catch(() => {});
    window.dispatchEvent(new CustomEvent('dsh-bottom-info-bar:visibility', { detail: { enabled: next } }));
  };
  // 各分区统一的「恢复默认」：恢复该分区下全部字段的默认值
  const restoreTextSection = () => {
    void controller.unset('fontSize').catch(() => {});
    void controller.unset('lineHeight').catch(() => {});
    void controller.unset('codeFontSize').catch(() => {});
    void controller.unset('zoomOutShortcut').catch(() => {});
    void controller.unset('zoomInShortcut').catch(() => {});
    void controller.unset('tableStyle').catch(() => {});
  };
  const restoreLayoutSection = () => {
    void controller.unset('dialogWidth').catch(() => {});
    void controller.unset('uiOpacity').catch(() => {});
  };
  const restoreFeaturesSection = () => {
    void controller.unset('timelineEnabled').catch(() => {});
    void controller.unset('bottomInfoBarEnabled').catch(() => {});
    window.dispatchEvent(new CustomEvent('dsh-bottom-info-bar:visibility', { detail: { enabled: true } }));
  };

  if (state.status === 'loading' && state.value === undefined) {
    return React.createElement('div', { className: 'dut-settings' },
      React.createElement('div', { className: 'dut-loading' }, I18N.loading));
  }
  if (state.status === 'error') {
    return React.createElement('div', { className: 'dut-settings' },
      React.createElement('div', { className: 'dut-alert error' }, I18N.unavailable));
  }

  return React.createElement('div', { className: 'dut-settings' },

    // 文本与表格
    React.createElement('section', { className: 'dut-panel' },
      React.createElement(SectionLabel, { title: I18N.sectionText, onRestore: restoreTextSection }),

      React.createElement(Field, { label: I18N.fontSize, hint: I18N.fontSizeHint },
        React.createElement(Stepper, {
          value: resolved.fontSize, draft, min: MIN_FONT_SIZE, max: MAX_FONT_SIZE, step: 1, disabled: !writable,
          onStep: (d) => { step('fontSize', resolved.fontSize, setDraft, MIN_FONT_SIZE, MAX_FONT_SIZE, d); },
          onChange: setDraft,
          onCommit: (v) => { commitNumber('fontSize', v, setDraft, MIN_FONT_SIZE, MAX_FONT_SIZE); },
        }),
      ),

      React.createElement(Field, { label: I18N.lineHeight, hint: I18N.lineHeightHint },
        React.createElement(Stepper, {
          value: resolved.lineHeight, draft: lineHeightDraft, min: MIN_LINE_HEIGHT, max: MAX_LINE_HEIGHT, step: 2, disabled: !writable,
          onStep: (d) => { step('lineHeight', resolved.lineHeight, setLineHeightDraft, MIN_LINE_HEIGHT, MAX_LINE_HEIGHT, d); },
          onChange: setLineHeightDraft,
          onCommit: (v) => { commitNumber('lineHeight', v, setLineHeightDraft, MIN_LINE_HEIGHT, MAX_LINE_HEIGHT); },
        }),
      ),

      React.createElement(Field, { label: I18N.codeFontSize, hint: I18N.codeFontSizeHint },
        React.createElement(Stepper, {
          value: resolved.codeFontSize, draft: codeDraft, min: MIN_CODE_FONT_SIZE, max: MAX_CODE_FONT_SIZE, step: 1, disabled: !writable,
          onStep: (d) => { step('codeFontSize', resolved.codeFontSize, setCodeDraft, MIN_CODE_FONT_SIZE, MAX_CODE_FONT_SIZE, d); },
          onChange: setCodeDraft,
          onCommit: (v) => { commitNumber('codeFontSize', v, setCodeDraft, MIN_CODE_FONT_SIZE, MAX_CODE_FONT_SIZE); },
        }),
      ),

      React.createElement(Field, { label: I18N.shortcut, hint: I18N.shortcutHint },
        null,
        React.createElement('div', { className: 'dut-shortcut-rows' },
          React.createElement(ShortcutRow, {
            tag: I18N.shortcutZoomIn, field: 'zoomInShortcut',
            savedValue: resolved.zoomInShortcut,
            disabled: !writable, controller,
          }),
          React.createElement(ShortcutRow, {
            tag: I18N.shortcutZoomOut, field: 'zoomOutShortcut',
            savedValue: resolved.zoomOutShortcut,
            disabled: !writable, controller,
          }),
        ),
      ),

      React.createElement(Field, { label: I18N.tableStyle, hint: I18N.tableStyleHint },
        React.createElement(Seg, {
          value: resolved.tableStyle, disabled: !writable,
          options: [
            { value: 'claude', label: I18N.tableStyleClaude, onClick: () => { void controller.set('tableStyle', 'claude').catch(() => {}); } },
            { value: 'default', label: I18N.tableStyleDefault, onClick: () => { void controller.set('tableStyle', 'default').catch(() => {}); } },
          ],
        }),
      ),
    ),

    // 布局
    React.createElement('section', { className: 'dut-panel' },
      React.createElement(SectionLabel, { title: I18N.sectionLayout, onRestore: restoreLayoutSection }),

      React.createElement(Field, {
        label: I18N.dialogWidth, hint: I18N.dialogWidthHint,
        extra: React.createElement('div', { className: 'dut-presets' },
          React.createElement(Seg, {
            value: resolved.dialogWidth, disabled: !writable,
            options: [
              { value: 880, label: I18N.presetWide + ' · 880', onClick: () => { setWidthDraft('880'); void controller.set('dialogWidth', 880).catch(() => {}); } },
              { value: 1024, label: I18N.presetWideXl + ' · 1024', onClick: () => { setWidthDraft('1024'); void controller.set('dialogWidth', 1024).catch(() => {}); } },
              { value: 748, label: I18N.presetDefault + ' · 748', onClick: () => { setWidthDraft('748'); void controller.set('dialogWidth', 748).catch(() => {}); } },
            ],
          }),
        ),
      },
        React.createElement(Stepper, {
          value: resolved.dialogWidth, draft: widthDraft, min: MIN_DIALOG_WIDTH, max: MAX_DIALOG_WIDTH, step: 20, disabled: !writable,
          onStep: (d) => { step('dialogWidth', resolved.dialogWidth, setWidthDraft, MIN_DIALOG_WIDTH, MAX_DIALOG_WIDTH, d); },
          onChange: setWidthDraft,
          onCommit: (v) => { commitNumber('dialogWidth', v, setWidthDraft, MIN_DIALOG_WIDTH, MAX_DIALOG_WIDTH); },
        }),
      ),

      React.createElement(Field, { label: I18N.uiOpacity, hint: I18N.uiOpacityHint },
        React.createElement(OpacityControl, {
          value: resolved.uiOpacity, disabled: !writable,
          onCommit: (v) => { void controller.set('uiOpacity', v).catch(() => {}); },
        }),
      ),
    ),

    // 功能（时间线 + 价格面板开关）
    React.createElement('section', { className: 'dut-panel dut-grid' },
      React.createElement(SectionLabel, { title: I18N.sectionFeatures, onRestore: restoreFeaturesSection }),

      React.createElement(Field, { label: I18N.timeline, hint: I18N.timelineHint },
        React.createElement(Seg, {
          value: resolved.timelineEnabled, disabled: !writable,
          options: [
            { value: true, label: I18N.timelineOn, onClick: () => { void controller.set('timelineEnabled', true).catch(() => {}); } },
            { value: false, label: I18N.timelineOff, onClick: () => { void controller.set('timelineEnabled', false).catch(() => {}); } },
          ],
        }),
      ),

      React.createElement(Field, { label: I18N.priceBar, hint: I18N.priceBarHint },
        React.createElement(Seg, {
          value: resolved.bottomInfoBarEnabled, disabled: !writable,
          options: [
            { value: true, label: I18N.timelineOn, onClick: () => { togglePriceBar(true); } },
            { value: false, label: I18N.timelineOff, onClick: () => { togglePriceBar(false); } },
          ],
        }),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// 对话时间线导航轨
// ---------------------------------------------------------------------------
const TIMELINE_PROJECTION_KEY = 'dshChatTimeline';
const EDGE_GAP = 12;
const PANEL_WIDTH = 240;
const BUBBLE_GAP = 14;

const TIMELINE_CSS = `
.dutl-nav{-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none;z-index:100;display:flex;position:fixed;align-items:center;justify-content:flex-end;pointer-events:auto}
.dutl-wrap{position:relative;z-index:2;border-radius:16px;width:24px;max-width:240px;transition:width .28s cubic-bezier(0.32,0.72,0,1),background-color .22s ease,box-shadow .22s ease,border-color .22s ease;display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box;border:1px solid transparent;background:transparent}
.dutl-wrap.dutl-show{width:240px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 88%,transparent);-webkit-backdrop-filter:blur(18px) saturate(1.35);backdrop-filter:blur(18px) saturate(1.35);border:1px solid var(--dsw-alias-border-l1);box-shadow:var(--dsw-shadow-lv1),0 0 0 1px color-mix(in srgb,var(--dsw-alias-border-l1) 55%,transparent)}
.dutl-page{max-height:340px;padding:6px 0;box-sizing:border-box;overscroll-behavior:contain;display:flex;flex-direction:column;align-items:stretch;width:100%;overflow:hidden}
.dutl-wrap.dutl-show .dutl-page{overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--dsw-alias-label-tertiary) 35%,transparent) transparent}
.dutl-page::-webkit-scrollbar{width:5px}
.dutl-page::-webkit-scrollbar-track{background:transparent}
.dutl-page::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--dsw-alias-label-tertiary) 35%,transparent);border-radius:4px}
.dutl-item{flex-shrink:0;cursor:pointer;height:30px;min-height:30px;width:100%;padding:0 2px 0 12px;box-sizing:border-box;display:flex;align-items:center;justify-content:flex-end;background:none;border:none;font:inherit;text-align:right;border-radius:10px;transition:color .18s ease,background-color .18s ease;color:var(--dsw-alias-label-secondary)}
.dutl-wrap.dutl-show .dutl-item{padding:0 8px 0 12px}
.dutl-item:hover{color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-interactive-bg-hover) 72%,transparent)}
.dutl-item.dutl-active{color:var(--dsw-alias-state-business-primary)}
.dutl-title{font-size:12.5px;line-height:20px;text-overflow:ellipsis;white-space:nowrap;opacity:0;margin-right:10px;flex:1;min-width:0;text-align:right;overflow:hidden;color:inherit;transform:translateX(5px);transition:opacity .18s ease,color .18s ease,transform .22s cubic-bezier(0.32,0.72,0,1)}
.dutl-title.dutl-show{opacity:1;transform:translateX(0)}
.dutl-ind{flex-shrink:0;width:22px;height:22px;display:flex;justify-content:center;align-items:center}
.dutl-line{position:relative;background-color:color-mix(in srgb,var(--dsw-alias-label-tertiary) 55%,transparent);border-radius:3px;flex-shrink:0;width:8px;height:2px;transition:background-color .2s ease,width .24s cubic-bezier(0.34,1.56,0.64,1),height .24s cubic-bezier(0.34,1.56,0.64,1),box-shadow .2s ease}
.dutl-item:hover .dutl-line{background-color:var(--dsw-alias-state-business-primary);width:18px;height:3px;box-shadow:0 0 8px color-mix(in srgb,var(--dsw-alias-state-business-primary) 55%,transparent);animation:dutl-pop .32s cubic-bezier(0.34,1.56,0.64,1)}
.dutl-item.dutl-active .dutl-line{background-color:var(--dsw-alias-state-business-primary);width:12px;height:3px;box-shadow:0 0 6px color-mix(in srgb,var(--dsw-alias-state-business-primary) 38%,transparent)}
@keyframes dutl-pop{0%{transform:scaleY(1)}45%{transform:scaleY(1.55)}100%{transform:scaleY(1)}}
.dutl-bubble{position:fixed;z-index:200;max-width:280px;max-height:230px;box-sizing:border-box;padding:10px 12px;border-radius:12px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);box-shadow:var(--dsw-shadow-lv1);color:var(--dsw-alias-label-primary);pointer-events:none;display:flex;flex-direction:column;gap:5px;transform:translateY(-50%);animation:dutl-bubble-in .16s cubic-bezier(0.32,0.72,0,1)}
.dutl-bubble::after{content:"";position:absolute;right:-5px;top:50%;width:8px;height:8px;margin-top:-4px;background:inherit;border-right:1px solid var(--dsw-alias-border-l1);border-top:1px solid var(--dsw-alias-border-l1);border-top-right-radius:2px;transform:rotate(45deg)}
.dutl-bubble-head{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:500;color:var(--dsw-alias-label-tertiary)}
.dutl-bubble-user{display:inline-flex;align-items:center;gap:5px}
.dutl-bubble-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-business-primary);box-shadow:0 0 5px color-mix(in srgb,var(--dsw-alias-state-business-primary) 60%,transparent)}
.dutl-bubble-time{margin-left:auto;font-variant-numeric:tabular-nums;font-weight:400}
.dutl-bubble-text{font-size:12.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word;overflow-y:auto;max-height:150px;color:var(--dsw-alias-label-primary)}
@keyframes dutl-bubble-in{from{opacity:0;transform:translateY(-50%) translateX(6px)}to{opacity:1;transform:translateY(-50%) translateX(0)}}
@media (prefers-reduced-motion:reduce){.dutl-wrap,.dutl-title,.dutl-line,.dutl-bubble{transition:none;animation:none}}
`;

function installTimelineStyles() {
  const id = 'dsh-ui-tweaks-timeline';
  const existing = document.querySelector(`style[data-plugin-css="${id}"]`);
  if (existing !== null) return () => {};
  const style = document.createElement('style');
  style.dataset.plugin = 'dsh-ui-tweaks';
  style.dataset.pluginCss = id;
  style.textContent = TIMELINE_CSS;
  document.head.appendChild(style);
  return () => { style.remove(); };
}

function userTextOf(content) {
  if (!Array.isArray(content)) return '';
  let out = '';
  for (const block of content) {
    if (block !== null && typeof block === 'object') {
      if (block.type === 'text' && typeof block.text === 'string') out += block.text;
    }
  }
  return out.trim().slice(0, 240);
}

function normalizeTimeline(m) {
  if (m === null || typeof m !== 'object') return null;
  if (typeof m.seq !== 'number') return null;
  const out = { seq: m.seq, time: typeof m.time === 'number' ? m.time : 0, text: typeof m.text === 'string' ? m.text : '' };
  if (typeof m.key === 'string') out.key = m.key;
  if (typeof m.id === 'string') out.id = m.id;
  return out;
}

function collectFromNodes(snapshot) {
  const out = [];
  if (snapshot === undefined) return out;
  for (const node of snapshot.chat.nodes.values()) {
    if (node.kind !== 'user') continue;
    const data = node.data;
    if (data === null || typeof data !== 'object') continue;
    if (typeof data.time !== 'number' || !Array.isArray(data.content)) continue;
    out.push({ seq: node.anchorSeq, time: data.time, text: userTextOf(data.content), key: node.key });
  }
  out.sort((a, b) => a.seq - b.seq);
  return out;
}

function anchorKeyOf(m) {
  if (typeof m.key === 'string' && m.key !== '') return m.key;
  if (typeof m.id === 'string' && m.id !== '') return `13:input-message${m.id}`;
  return undefined;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function formatTime(ms) {
  const date = new Date(ms);
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return date.toDateString() === now.toDateString()
    ? time
    : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

async function jumpToMessage(sessionsService, sessionId, key) {
  const session = sessionsService.binding(sessionId)?.session;
  if (session === undefined) return false;
  let guard = 0;
  while (guard++ < 120) {
    const snapshot = session.getSnapshot();
    if (snapshot?.chat?.nodes?.get(key) !== undefined) break;
    if (snapshot?.hasMore !== true) return false;
    if (snapshot.loadingOlder === true) { await delay(50); continue; }
    await session.loadOlder();
  }
  const scrollport = document.querySelector('[data-conversation-scroll]');
  const row = scrollport === null ? null : scrollport.querySelector(`[data-chat-anchor-key="${CSS.escape(key)}"]`);
  if (row === null || scrollport === null) return false;
  const reducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const distance = Math.abs(row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top);
  const far = distance > scrollport.clientHeight * 2;
  row.scrollIntoView({ behavior: reducedMotion || far ? 'auto' : 'smooth', block: 'center' });
  return true;
}

const NOOP_STORE = {
  getSnapshot: () => undefined,
  subscribe: () => () => {},
};

function TimelineRail({ useProjection, sessionId, sessionsService, controller }) {
  const settingsState = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const enabled = settingsState.value?.timelineEnabled ?? false;

  const projected = useProjection(TIMELINE_PROJECTION_KEY);
  const session = sessionId === undefined ? undefined : sessionsService.binding(sessionId)?.session;
  const fallbackStore = session === undefined ? NOOP_STORE : session;
  const subscribe = React.useMemo(() => (fn) => fallbackStore.subscribe(fn), [fallbackStore]);
  const getSnapshot = React.useMemo(() => () => fallbackStore.getSnapshot(), [fallbackStore]);
  const nodeSnapshot = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const { messages, source } = React.useMemo(() => {
    if (Array.isArray(projected?.messages) && projected.messages.length > 0) {
      return {
        messages: projected.messages.map(normalizeTimeline).filter((m) => m !== null),
        source: 'projection',
      };
    }
    return { messages: collectFromNodes(nodeSnapshot), source: 'nodes' };
  }, [projected, nodeSnapshot]);

  const [activeIndex, setActiveIndex] = React.useState(-1);
  const [show, setShow] = React.useState(false);
  const [anchor, setAnchor] = React.useState(null);
  const [bubble, setBubble] = React.useState(null);
  const pageRef = React.useRef(null);

  React.useEffect(() => {
    if (show || activeIndex < 0) return;
    const raf = requestAnimationFrame(() => {
      const page = pageRef.current;
      if (page === null) return;
      const item = page.children[activeIndex];
      if (item === undefined) return;
      const pageRect = page.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();
      if (itemRect.top >= pageRect.top - 1 && itemRect.bottom <= pageRect.bottom + 1) return;
      page.scrollTop += itemRect.top - pageRect.top - (pageRect.height - itemRect.height) / 2;
    });
    return () => { cancelAnimationFrame(raf); };
  }, [show, activeIndex]);

  React.useEffect(() => {
    if (!enabled || session === undefined) return;
    if (Array.isArray(projected?.messages) && projected.messages.length > 0) return;
    let cancelled = false;
    const run = async () => {
      let guard = 0;
      while (!cancelled && guard++ < 120) {
        if (Array.isArray(projected?.messages) && projected.messages.length > 0) return;
        const snap = session.getSnapshot();
        if (snap === undefined) { await delay(100); continue; }
        if (snap.openState !== 'open') {
          if (snap.openState === 'error') return;
          await delay(100);
          continue;
        }
        if (snap.hasMore !== true) return;
        if (snap.loadingOlder === true) { await delay(50); continue; }
        await session.loadOlder();
      }
    };
    run().catch(() => {});
    return () => { cancelled = true; };
  }, [enabled, sessionId, Array.isArray(projected?.messages) && projected.messages.length > 0 ? 'have' : 'none']);

  React.useEffect(() => {
    if (!enabled) return;
    const measure = () => {
      const sp = document.querySelector('[data-conversation-scroll]');
      if (sp === null) return;
      const rect = sp.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const top = Math.round(rect.top + rect.height / 2);
      const right = Math.max(0, Math.round(window.innerWidth - rect.right + EDGE_GAP));
      setAnchor((prev) => {
        if (prev !== null && Math.abs(prev.top - top) < 2 && Math.abs(prev.right - right) < 2) return prev;
        return { top, right };
      });
    };
    measure();
    let raf = 0;
    const scrollport = document.querySelector('[data-conversation-scroll]');
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    });
    if (scrollport !== null) observer.observe(scrollport);
    observer.observe(document.body);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [enabled, sessionId]);

  React.useEffect(() => {
    if (messages.length === 0) return;
    const messageIndexByKey = new Map();
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (message === undefined) continue;
      const key = anchorKeyOf(message);
      if (key !== undefined) messageIndexByKey.set(key, i);
    }
    let scrollport = null;
    let rows = new Map();
    const resolveRows = () => {
      const sp = document.querySelector('[data-conversation-scroll]');
      scrollport = sp;
      const next = new Map();
      if (sp !== null) {
        for (const row of sp.querySelectorAll('[data-chat-anchor-key^="13:input-message"]')) {
          const key = row.getAttribute('data-chat-anchor-key');
          if (key !== null) next.set(key, row);
        }
      }
      rows = next;
    };
    const updateActive = () => {
      const sp = document.querySelector('[data-conversation-scroll]');
      if (sp === null) return;
      if (sp !== scrollport || rows.size === 0) resolveRows();
      if (sp === null || sp !== scrollport || rows.size === 0) return;
      const rect = sp.getBoundingClientRect();
      if (rect.height === 0) return;
      const line = rect.top + rect.height * 0.4;
      let best = -1;
      let bestDist = Infinity;
      for (const [key, row] of rows) {
        const idx = messageIndexByKey.get(key) ?? -1;
        if (idx === -1) continue;
        const r = row.getBoundingClientRect();
        const dist = Math.abs(r.top + r.height / 2 - line);
        if (dist < bestDist) { bestDist = dist; best = idx; }
      }
      setActiveIndex(best);
    };
    let retries = 0;
    const retry = () => {
      if (rows.size === 0 && ++retries <= 120) {
        requestAnimationFrame(() => { resolveRows(); retry(); });
        return;
      }
      updateActive();
    };
    retry();
    let scrollRaf = 0;
    const onScroll = () => {
      if (scrollRaf !== 0) return;
      scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; updateActive(); });
    };
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });
    const observer = new ResizeObserver(() => { updateActive(); });
    observer.observe(document.body);
    return () => {
      if (scrollRaf !== 0) cancelAnimationFrame(scrollRaf);
      document.removeEventListener('scroll', onScroll, { capture: true });
      observer.disconnect();
    };
  }, [sessionId, messages.length, source]);

  if (!enabled || sessionId === undefined || messages.length < 2) return null;

  const railRight = anchor === null ? EDGE_GAP : anchor.right;
  const railStyle = anchor === null
    ? { top: '50%', right: EDGE_GAP, transform: 'translateY(-50%)' }
    : { top: anchor.top, right: anchor.right, transform: 'translateY(-50%)' };
  const bubbleStyle = { top: bubble === null ? 0 : bubble.top, right: railRight + PANEL_WIDTH + BUBBLE_GAP };

  return createPortal(
    React.createElement(React.Fragment, null,
      React.createElement('div', {
        className: 'dutl-nav', role: 'navigation', 'aria-label': I18N.railLabel, style: railStyle,
        onMouseEnter: () => { setShow(true); },
        onMouseLeave: () => { setShow(false); },
      },
        React.createElement('div', { className: 'dutl-wrap' + (show ? ' dutl-show' : '') },
          React.createElement('div', { className: 'dutl-page', ref: pageRef },
            messages.map((m, i) => {
              const key = anchorKeyOf(m);
              return React.createElement('button', {
                key: m.seq, type: 'button',
                className: 'dutl-item' + (activeIndex === i ? ' dutl-active' : ''),
                'aria-label': `${I18N.roleUser}: ${m.text.slice(0, 60) || I18N.noText}`,
                'aria-current': activeIndex === i ? 'location' : undefined,
                onClick: () => { if (key !== undefined) void jumpToMessage(sessionsService, sessionId, key).catch(() => {}); },
                onMouseEnter: (event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const top = Math.min(Math.max(rect.top + rect.height / 2, 150), window.innerHeight - 150);
                  setBubble({ top, entry: m });
                },
                onMouseLeave: () => { setBubble(null); },
              },
                React.createElement('span', { className: 'dutl-title' + (show ? ' dutl-show' : '') }, m.text === '' ? I18N.noText : m.text),
                React.createElement('span', { className: 'dutl-ind', 'aria-hidden': true },
                  React.createElement('span', { className: 'dutl-line' }),
                ),
              );
            }),
          ),
        ),
      ),
      bubble !== null && show
        ? React.createElement('div', { className: 'dutl-bubble', style: bubbleStyle, role: 'tooltip' },
          React.createElement('div', { className: 'dutl-bubble-head' },
            React.createElement('span', { className: 'dutl-bubble-user' }, React.createElement('span', { className: 'dutl-bubble-dot' }), I18N.roleUser),
            React.createElement('span', { className: 'dutl-bubble-time' }, formatTime(bubble.entry.time)),
          ),
          React.createElement('div', { className: 'dutl-bubble-text' }, bubble.entry.text === '' ? I18N.noText : bubble.entry.text),
        )
        : null,
    ),
    document.body,
  );
}

// ---------------------------------------------------------------------------
// 插件入口
// ---------------------------------------------------------------------------
module.exports = {
  inject: ['slots', 'sessions'],
  async apply(ctx) {
    // slots 服务可能晚于 apply 就绪（与官方 client 一致地轮询等待）
    let slots = ctx.slots || ctx.get('slots');
    for (let i = 0; slots === undefined && i < 60; i++) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      slots = ctx.slots || ctx.get('slots');
    }
    if (slots === undefined) {
      console.warn('[dsh-ui-tweaks] slots 服务 18s 内未就绪，界面调整未注册');
      return;
    }

    ctx.effect(installBaseStyles, 'dsh-ui-tweaks: base styles');
    ctx.effect(installTimelineStyles, 'dsh-ui-tweaks: timeline styles');

    const controller = new SettingsClient();

    ctx.effect(() => {
      const applyCss = () => {
        const state = controller.getSnapshot();
        if (state.status === 'ready') {
          const value = resolveValue(state.value);
          runtimeStyleElement().textContent = buildRuntimeCss(value);
          applySettingsOpacity(value.uiOpacity);
        }
      };
      applyCss();
      const dispose = controller.subscribe(applyCss);
      void controller.load();
      return dispose;
    }, 'dsh-ui-tweaks: runtime css');

    // 文本调节快捷键（默认 Ctrl + = / Ctrl + -，可在设置「文本与表格」中改绑）
    ctx.effect(() => installHotkeys(controller), 'dsh-ui-tweaks: hotkeys');

    // 事件驱动的全局信号：设置面板打开必然伴随“DOM 插入 / 属性变化 / 焦点移入 / 点击”之一，
    // 任一信号触发即探测并应用透明度（rAF 节流 + 冷却延后，不丢弃面板打开信号），无需轮询、零空转。
    // 解决“重启后第一次点开设置（默认 tab 不是「界面调整」）不生效”的问题。
    ctx.effect(() => {
      if (typeof document === 'undefined' || document.body === null) {
        return () => {};
      }
      let raf = 0;
      let sources = [];            // 信号来源节点：新增节点 + 被改属性的元素 + 焦点元素
      let pendingAfterCooldown = []; // 冷却期内的信号：延后处理，绝不丢弃
      let cooldownTimer = 0;
      let clickTimer = 0;
      let settleTimer = 0;
      let lastProbeAt = 0;

      const apply = (batch) => {
        const state = controller.getSnapshot();
        if (state.status === 'ready') applySettingsOpacity(resolveValue(state.value).uiOpacity, batch);
      };

      const runProbe = (batch) => {
        lastProbeAt = Date.now() + 200;
        const layerBefore = readSettingsLayerCache();
        apply(batch);
        // 有信号但尚未定位成功：面板可能正在异步挂载/布局，用同一批来源做一次有限重试（非轮询）
        if (layerBefore === null && readSettingsLayerCache() === null) {
          if (settleTimer !== 0) clearTimeout(settleTimer);
          settleTimer = setTimeout(() => {
            settleTimer = 0;
            apply(batch);
          }, 200);
        }
      };

      const reapply = () => {
        raf = 0;
        const batch = sources.splice(0);
        if (batch.length === 0) return;
        const wait = lastProbeAt - Date.now();
        if (wait > 0) {
          // 冷却期内：信号延后到冷却结束再探测（面板打开的信号必须被处理，不能丢弃）
          pendingAfterCooldown = pendingAfterCooldown.concat(batch);
          if (cooldownTimer === 0) {
            cooldownTimer = setTimeout(() => {
              cooldownTimer = 0;
              const b = pendingAfterCooldown;
              pendingAfterCooldown = [];
              if (b.length > 0) runProbe(b);
            }, wait);
          }
          return;
        }
        runProbe(batch);
      };

      const queue = (node) => {
        if (node !== null && node !== undefined && node.nodeType === 1) {
          if (sources.length < 200) sources.push(node);
        }
        if (raf !== 0) return;
        raf = requestAnimationFrame(reapply);
      };

      let observer = null;
      if (typeof MutationObserver === 'function') {
        observer = new MutationObserver((mutations) => {
          for (const m of mutations) {
            if (m.type === 'childList') {
              for (const node of m.addedNodes) queue(node);
            } else if (m.type === 'attributes') {
              queue(m.target);
            }
          }
        });
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'data-state'],
        });
      }

      // 面板打开通常抢焦点：焦点移入作为独立信号（即便 DOM 无变化也能触发）
      const onFocusIn = (event) => { queue(event.target); };
      document.addEventListener('focusin', onFocusIn);

      // 点击是打开设置的通用入口：点击后延迟确认一次，
      // 覆盖“面板已打开但打开信号被错过/面板不抢焦点”的时序
      const onClick = () => {
        if (clickTimer !== 0) return;
        clickTimer = setTimeout(() => {
          clickTimer = 0;
          const state = controller.getSnapshot();
          if (state.status === 'ready') applySettingsOpacity(resolveValue(state.value).uiOpacity, []);
        }, 120);
      };
      document.addEventListener('click', onClick, true);

      return () => {
        if (observer !== null) observer.disconnect();
        document.removeEventListener('focusin', onFocusIn);
        document.removeEventListener('click', onClick, true);
        if (raf !== 0) cancelAnimationFrame(raf);
        if (cooldownTimer !== 0) clearTimeout(cooldownTimer);
        if (clickTimer !== 0) clearTimeout(clickTimer);
        if (settleTimer !== 0) clearTimeout(settleTimer);
      };
    }, 'dsh-ui-tweaks: settings layer watch');

    // 设置页面分区
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: NS,
      order: 40,
      label: () => I18N.nav,
      inject: () => ({ controller }),
    }, SettingsSection));

    // 对话时间线导航轨
    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
      name: 'conversation.input.dock',
      id: NS,
      order: 40,
      inject: () => ({ controller, sessionsService: ctx.sessions }),
    }, TimelineRail));
  },
};
