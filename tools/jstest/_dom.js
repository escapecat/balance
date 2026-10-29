// 开机冒烟 —— **白屏是最糟的一种故障:功能全在,你什么都看不见。**
//
// ⚠️ `node --check` 只查语法。少一个全局、加载顺序反了、某个函数名打错 ——
//    语法全都合法,check.sh 全绿,可页面一片空白,而且控制台之外没有任何提示。
//
// ⚠️ 所以这里按 index.html 的**真实顺序**把所有脚本跑一遍,再挨个挂载页面。
//    用最小 DOM 桩,不引 jsdom(零依赖是硬要求)。
//
// ⚠️ 还要**塞真实数据进去再挂一次**:空数据能挂上不代表有数据时能挂上,
//    而有数据的那条路才是你天天走的。

var path = require('path');
var fs = require('fs');
var vm = require('vm');
var APP = path.join(__dirname, '..', '..', 'app');

function El(tag) {
  this.tagName = String(tag).toUpperCase();
  this.children = []; this.attrs = {}; this.handlers = {};
  this.className = ''; this.style = {}; this.value = ''; this.text = '';
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

// ⚠️ 前缀必须和 lib/store.js 里的一致。写错的话夹具全塞进了一个线上永远读不到
//    的命名空间 —— 页面拿到的是空数据,而测试「有内容」的断言照样能过。
//    这个坑在另一个项目里真发生过,整套页面测试空跑了一段时间。
var NS = 'balance:';

/** 造一个全新的运行环境,按 index.html 的真实顺序把所有脚本跑一遍。
 *
 *  ⚠️ 抽成函数是因为**开机路径不止一条**:空数据 / 有数据 / 数据版本对不上。
 *     最后那条只有在重新开一次机的时候才走得到,而它恰恰是最危险的一条 ——
 *     写错了的表现是用户打开 app 发现数据没了。 */
function makeCtx(seed) {
  var mem = {};
  Object.keys(seed || {}).forEach(function (k) {
    mem[NS + k] = typeof seed[k] === 'string' ? seed[k] : JSON.stringify(seed[k]);
  });
  var body = new El('body'), appDiv = new El('div');
  appDiv.attrs.id = 'app'; body.appendChild(appDiv);
  var sandbox = {
    document: {
      body: body, documentElement: new El('html'), activeElement: null,
      createElement: function (t) { return new El(t); },
      createElementNS: function (ns, t) { return new El(t); },   // SVG 走这条
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
    location: { reload: function () {} },
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  var c = vm.createContext(sandbox);
  // ⚠️ 得容忍 `?v=时间戳`(commit.sh 打的破缓存版本号),并且**剥掉它**再读文件。
  //    原来的正则是 `src="([^"]+\.js)"`,版本号一加就一个都匹配不到 ——
  //    于是这里一个脚本都不加载,而失败信息是「Store 没加载出来」,
  //    看起来像 store.js 坏了,实际上是这行正则过时了。
  var loaded = 0;
  fs.readFileSync(path.join(APP, 'index.html'), 'utf8')
    .replace(/src="([^"?]+\.js)(?:\?v=\d+)?"/g, function (_, f) {
      vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), c, { filename: f });
      loaded++;
      return _;
    });
  // 一个都没加载 = 正则和 index.html 又对不上了。**当场喊出来**,
  // 否则下面每一条断言都会失败,而没有一条指向真正的原因。
  if (loaded < 5) {
    throw new Error('boot: 只从 index.html 里认出 ' + loaded + ' 个脚本 —— 正则过时了');
  }
  c.__app = appDiv;
  c.__mem = mem;
  return c;
}


module.exports = { makeCtx: makeCtx, El: El, NS: NS };
