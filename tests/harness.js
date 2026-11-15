// テスト用の土台：スプレッドシートの模型、GASコードの読み込み、アプリ（index.html）を動かす入れ物。
// すべて Mac の中だけで動く（本物のGAS・スプレッドシートには接続しない）。Node.js だけで動く。
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');
const LS = 'custom_manabi_';

// ── スプレッドシート1枚の模型（1セル50,000文字上限・数式や数値への自動変換を再現） ──
function makeSheet(initial) {
  const st = { cells: initial ? initial.map(r => r.slice()) : [], textFmt: false, maxRows: 1000, maxCols: 26, failNextSet: false, setCalls: 0 };
  const width = () => st.cells.reduce((m, r) => { let w = 0; r.forEach((c, i) => { if (c !== '' && c !== undefined) w = i + 1; }); return Math.max(m, w); }, 0);
  const lastRow = () => { let n = 0; st.cells.forEach((r, i) => { if (r.some(c => c !== '' && c !== undefined)) n = i + 1; }); return n; };
  const coerce = (v, col) => {
    if (typeof v !== 'string') return v;
    if (v.length > 50000) throw new Error('入力した内容は、1 つのセルに入力できる最大文字数 50000 を超えています');
    if (st.textFmt && col >= 2) return v;
    if (/^[=+]/.test(v)) return '#FORMULA!';
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    if (v === 'true') return true; if (v === 'false') return false;
    return v;
  };
  return {
    _st: st,
    getLastRow: lastRow, getLastColumn: width,
    getMaxRows: () => st.maxRows, getMaxColumns: () => st.maxCols,
    insertRowsAfter: (a, n) => { st.maxRows += n; }, insertColumnsAfter: (a, n) => { st.maxCols += n; },
    deleteRows: (start, n) => { st.cells.splice(start - 1, n); },
    getRange: (r, c, nr, nc) => {
      if (r + nr - 1 > st.maxRows || c + nc - 1 > st.maxCols) throw new Error('範囲がシートの外です');
      return {
        getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const v = (st.cells[r - 1 + i] || [])[c - 1 + j]; row.push(v === undefined ? '' : v); } out.push(row); } return out; },
        setValues: (m) => {
          st.setCalls++;
          if (st.failNextSet) { st.failNextSet = false; throw new Error('模擬エラー'); }
          const conv = m.map(row => row.map((v, j) => coerce(v, c + j)));   // 全セル検査してから反映（全か無か）
          conv.forEach((row, i) => { st.cells[r - 1 + i] = st.cells[r - 1 + i] || []; row.forEach((v, j) => { st.cells[r - 1 + i][c - 1 + j] = v; }); });
        },
        clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) { if (st.cells[r - 1 + i]) st.cells[r - 1 + i][c - 1 + j] = ''; } },
        setNumberFormat: function (f) { if (f === '@') st.textFmt = true; return this; },
      };
    },
  };
}

// ── gas_code.js を模型のシートにつないで読み込む（合言葉は 'tok'） ──
function loadGas(sheet, opts = {}) {
  const ctx = {
    console: { error: () => {}, log: () => {}, warn: () => {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      getSheetByName: (n) => n === 'data' ? sheet : (opts.sheets && opts.sheets[n]) || null,
      insertSheet: (n) => { if (n === 'data') return sheet; opts.sheets = opts.sheets || {}; opts.sheets[n] = makeSheet(); return opts.sheets[n]; } }) },
    Utilities: { formatDate: (d, tz, f) => f.includes('mm') ? '2026-11-16 10:05:00' : '2026-11-16 10' },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => (opts.noToken ? null : 'tok') }) },
    LockService: { getScriptLock: () => ({ waitLock: () => { if (opts.busy) throw new Error('lock'); }, tryLock: () => !opts.busy, releaseLock: () => {} }) },
    ContentService: { MimeType: { JSON: 'json', TEXT: 'text' }, createTextOutput: (s) => ({ setMimeType: (t) => ({ text: s, mime: t }) }) },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'gas_code.js'), 'utf8') + '\nthis.doGet = doGet; this.doPost = doPost;', ctx);
  return {
    opts,
    getRaw: (params) => ctx.doGet({ parameter: params || {} }),
    post: (body) => JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(Object.assign({ token: 'tok' }, body)) } }).text),
    all: () => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ action: 'getAll', token: 'tok' }) } }).text),
  };
}

// ── アプリ（index.html のスクリプト全体）を1台分起動する ──
const clock = { t: Date.parse('2026-11-16T10:00:00+09:00') };
const errors = [];
const appSrc = () => [...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

function makeApp(name, gas, initialStore) {
  const store = Object.assign({}, initialStore);
  const els = {};
  const mkEl = (id) => ({ id, value: '', textContent: '', innerHTML: '', className: '', type: '', style: { display: /-modal$/.test(id) ? 'none' : '' }, files: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, closest: () => null,
    appendChild(c) { return c; }, click() {}, focus() {}, setAttribute() {} });
  const timers = [], intervals = [];
  const app = { name, store, els, toasts: [], posts: [], warns: [], fetches: 0, confirms: [], appended: [], confirmAnswer: true, promptAnswer: null, offline: false, failSet: null };
  const ctx = {
    console: { log() {}, warn: (...a) => app.warns.push(a.map(String).join(' ')), error: (...a) => { (app.expectErrors ? app.warns : errors).push(name + ': ' + a.map(x => (x && x.stack) ? x.stack.split('\n').slice(0, 3).join(' | ') : String(x)).join(' ')); } },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { if (app.failSet && app.failSet(k)) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } store[k] = String(v); },
      removeItem: k => { delete store[k]; }, key: i => Object.keys(store)[i], get length() { return Object.keys(store).length; } },
    document: { getElementById: id => (els[id] = els[id] || mkEl(id)), createElement: () => mkEl('new'), addEventListener() {}, body: Object.assign(mkEl('body'), { appendChild(c) { app.appended.push(c.id); return c; } }), visibilityState: 'visible' },
    confirm: (msg) => { app.confirms.push(msg); return app.confirmAnswer !== false; }, prompt: () => app.promptAnswer, alert() {},
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].f = null; },
    setInterval: (f) => { intervals.push({ f }); return intervals.length; }, clearInterval: (id) => { if (intervals[id - 1]) intervals[id - 1].f = null; },
    URL: { createObjectURL: () => 'blob:x' }, Blob: function (parts) { app.lastExport = parts[0]; },
    FileReader: function () { this.readAsText = (f) => { this.onload({ target: { result: f.text } }); }; },
    fetch: async (url, o) => {
      app.fetches++;
      if (app.offline) throw new Error('offline');
      if (!o || o.method !== 'POST') throw new Error('GETは使わないはず');
      if (/token=/.test(url)) throw new Error('URLに合言葉を付けてはいけない');
      const body = JSON.parse(o.body);
      app.posts.push(body);
      const out = gas.post(o.body);
      if (app.dropResponse) throw new Error('応答を受け取れなかった（書き込みは済んでいる）');
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(out)) };
    },
    encodeURIComponent, decodeURIComponent, JSON, Math, Object, Array, Map, Set, Number, String, Boolean, RegExp, Error, Promise, parseInt, parseFloat, isNaN, isFinite, Symbol,
  };
  class FDate extends Date { constructor(...a) { if (a.length === 0) super(clock.t); else super(...a); } static now() { return (clock.t += 7); } }
  ctx.Date = FDate; ctx.window = ctx; ctx.window.addEventListener = () => {};
  vm.createContext(ctx);
  vm.runInContext(appSrc(), ctx, { filename: 'index.html#' + name });
  vm.runInContext('showToast = (m) => { __toasts.push(m); };', Object.assign(ctx, { __toasts: app.toasts }));
  app.ev = (code) => vm.runInContext(code, ctx);
  app.runTimers = () => { const list = timers.splice(0); list.forEach(t => { if (t.f) t.f(); }); };
  app.runIntervals = () => { intervals.forEach(t => { if (t.f) t.f(); }); };
  app.el = id => ctx.document.getElementById(id);
  app.get = (k, def) => { const v = store[LS + k]; return v === undefined ? def : JSON.parse(v); };
  app.html = () => ['setup-hint', 'summary', 'quick-container', 'form-container', 'filter-bar', 'memo-list'].map(id => app.el(id).innerHTML).join('\n');
  return app;
}
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r)); };
// 操作を1つ行い、送信とタイマーが落ち着くまで待つ
const act = async (app, code) => { const r = app.ev(code); await settle(); app.runTimers(); await settle(); return r; };
// 1分以上たってから画面に戻った、という状況を作って受信し直す
const sync = async (app) => { clock.t += 61000; app.ev('maybeResync()'); await settle(); app.runTimers(); await settle(); };

let pass = 0, fail = 0;
const t = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  OK  ' : '  NG  ') + n + (!c && x !== undefined ? '  … ' + JSON.stringify(x).slice(0, 400) : '')); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const finish = () => { console.log(fail === 0 ? `すべてOK（${pass}件）` : `NG ${fail}件 / OK ${pass}件`); process.exit(fail === 0 ? 0 : 1); };

module.exports = { makeSheet, loadGas, makeApp, settle, act, sync, t, eq, finish, clock, errors, LS, ROOT };
