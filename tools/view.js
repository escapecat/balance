// 页面渲染出来到底长什么样 —— **看得见才改得动。**
//
// ⚠️ 光读代码只能改到「间距对不对齐」这种能算出来的东西,
//    看不见「一屏塞了两件事」「主操作埋在第三屏」这类真问题。
//
// 用法:node tools/view.js [now | entry | me]

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var ROOT = path.join(__dirname, '..');
var APP = path.join(ROOT, 'app');

function El(tag) {
  this.tagName = String(tag).toUpperCase();
  this.children = []; this.attrs = {}; this.handlers = {};
  this.className = ''; this.style = {}; this.value = ''; this.text = '';
  this.parentNode = null;
}
Object.defineProperty(El.prototype, 'innerHTML',
  { get: function () { return ''; }, set: function () { this.children = []; } });
Object.defineProperty(El.prototype, 'textContent',
  { get: function () { return this.text; },
    set: function (v) { this.text = v; this.children = []; } });
El.prototype.appendChild = function (c) { c.parentNode = this; this.children.push(c); return c; };
El.prototype.removeChild = function (c) {
  this.children = this.children.filter(function (x) { return x !== c; });
};
El.prototype.insertBefore = function (n, ref) {
  var i = this.children.indexOf(ref);
  n.parentNode = this;
  if (i < 0) this.children.push(n); else this.children.splice(i, 0, n);
  return n;
};
El.prototype.replaceChild = function (n, old) {
  var i = this.children.indexOf(old);
  n.parentNode = this;
  if (i >= 0) this.children[i] = n; else this.children.push(n);
  return old;
};
El.prototype.setAttribute = function (k, v) { this.attrs[k] = v; };
El.prototype.getAttribute = function (k) { return this.attrs[k]; };
El.prototype.addEventListener = function (k, f) { (this.handlers[k] = this.handlers[k] || []).push(f); };
El.prototype.removeEventListener = function () {};
El.prototype.focus = function () {}; El.prototype.select = function () {};
El.prototype.setSelectionRange = function () {};
El.prototype.all = function (out) {
  out = out || [];
  this.children.forEach(function (c) { out.push(c); c.all(out); });
  return out;
};
El.prototype.querySelector = function (sel) {
  var want = sel.replace(/^#/, ''), byId = sel[0] === '#';
  return this.all().filter(function (c) {
    return byId ? c.attrs.id === want : c.tagName === sel.toUpperCase();
  })[0] || null;
};

var mem = {}, NS = 'balance:';
var body = new El('body'), appDiv = new El('div');
appDiv.attrs.id = 'app'; body.appendChild(appDiv);
var sandbox = {
  document: {
    body: body, documentElement: new El('html'), activeElement: null,
    createElement: function (t) { return new El(t); },
    // SVG 走的是带命名空间的创建方式 —— 假 DOM 里少了它,
    // 图表那一段会直接抛异常而不是「画不出来」,反而更容易发现
    createElementNS: function (ns, t) { return new El(t); },
    createTextNode: function (t) { var n = new El('#text'); n.text = t; return n; },
    createDocumentFragment: function () { return new El('#frag'); },
    getElementById: function (id) { return id === 'app' ? appDiv : null; },
    querySelector: function (s) { return body.querySelector(s); },
    addEventListener: function () {}, removeEventListener: function () {},
  },
  console: console, setTimeout: setTimeout, clearTimeout: clearTimeout,
  Promise: Promise, Date: Date, Math: Math, JSON: JSON, Object: Object, Array: Array,
  String: String, Number: Number, isNaN: isNaN, parseInt: parseInt, parseFloat: parseFloat,
  RegExp: RegExp, Error: Error, encodeURIComponent: encodeURIComponent,
  localStorage: {
    getItem: function (k) { return mem[k] === undefined ? null : mem[k]; },
    setItem: function (k, v) { mem[k] = String(v); },
    removeItem: function (k) { delete mem[k]; },
    key: function (i) { return Object.keys(mem)[i] || null; },
    get length() { return Object.keys(mem).length; },
  },
  location: { protocol: 'file:', reload: function () {} },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;

// 塞真实数据 —— 空状态看不出布局问题
try {
  var real = JSON.parse(fs.readFileSync(
    path.join(process.env.TEMP || '/tmp', 'pf', 'backup-keep.json'), 'utf8'));
  Object.keys(real.data).forEach(function (k) { mem[NS + k] = JSON.stringify(real.data[k]); });
} catch (e) { console.log('(没找到迁移产物,用空数据)'); }

var ctx = vm.createContext(sandbox);
fs.readFileSync(path.join(APP, 'index.html'), 'utf8')
  .replace(/src="([^"]+\.js)"/g, function (_, f) {
    if (f === 'app.js') return _;          // app.js 自己会挂,这里手动挂指定页面
    vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), ctx, { filename: f });
    return _;
  });

// 有些界面分支只在特定状态下才出现(比如「退回上一个状态」只在真有回滚点时显示)。
// 不给个开关的话,那些分支**从写完到上线一次都没被人看过**。
//     node tools/view.js me +rollback
if (process.argv.indexOf('+rollback') > 0) {
  var cur0 = JSON.parse(mem[NS + 'snapshots'] || '[]');
  mem[NS + '__rollback'] = JSON.stringify({
    version: 1, reason: '导入备份之前', savedAt: '2026-08-09T10:30:00.000Z',
    data: { snapshots: cur0.slice(0, Math.max(1, cur0.length - 1)),
            settings: JSON.parse(mem[NS + 'settings'] || '{}') },
  });
}

var page = process.argv[2] || 'now';
var MOUNT = { now: 'NowUI', entry: 'EntryUI', me: 'SettingsUI',
              history: 'HistoryUI', stats: 'StatsUI' };
var mod = MOUNT[page];
if (!mod) { console.log('页面只有:' + Object.keys(MOUNT).join(' / ')); process.exit(1); }

var node = new El('div');
try {
  ctx[mod].mount(node, { onEntry: function () {}, onDone: function () {},
                         onChanged: function () {} });
} catch (e) {
  console.log('挂载 ' + mod + ' 失败:' + e.message);
  console.log((e.stack || '').split('\n').slice(0, 3).join('\n'));
  process.exit(1);
}

var stats = { nodes: 0, tappable: 0, chars: 0, depth: 0 };
function walk(el, d, out) {
  if (el.tagName === '#TEXT') {
    var t = (el.text || '').trim();
    if (t) { out.push('  '.repeat(d) + t); stats.chars += t.length; }
    return;
  }
  stats.nodes++;
  if (d > stats.depth) stats.depth = d;
  var tap = (el.handlers.click || []).length;
  if (tap) stats.tappable++;
  var tag = el.tagName.toLowerCase() +
            (el.className ? '.' + el.className.split(' ').join('.') : '');
  out.push('  '.repeat(d) + (tap ? '▶ ' : '') + tag);
  var own = (el.text || '').trim();
  if (own) { out.push('  '.repeat(d + 1) + own); stats.chars += own.length; }
  el.children.forEach(function (c) { walk(c, d + 1, out); });
}
var lines = [];
node.children.forEach(function (c) { walk(c, 0, lines); });
console.log('==== ' + page + ' ====');
console.log(lines.join('\n'));
console.log('');
console.log('节点 ' + stats.nodes + ' · 可点 ' + stats.tappable +
            ' · 总字数 ' + stats.chars + ' · 最深嵌套 ' + stats.depth);
