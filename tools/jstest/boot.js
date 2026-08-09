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

// ⚠️ 第一段**故意什么都不塞** —— 测的是「一条数据都没有」的状态,
//    那是你第一次打开时看到的东西,也是最容易白屏的一条路。
var ctx = makeCtx();
var appDiv = ctx.__app;

var fail = 0;
function ok(c, m) { if (!c) { console.log('  FAIL ' + m); fail++; } }
function deep(el) {
  if (el.tagName === '#TEXT') return el.text || '';
  return (el.text || '') + el.children.map(deep).join('');
}

// ---- 1. 空数据也得挂得上(第一次打开就是这个状态)----
ok(typeof ctx.Store === 'object', 'Store 没加载出来');
ok(typeof ctx.Portfolio === 'object', 'Portfolio 没加载出来');
ok(typeof ctx.Allocate === 'object', 'Allocate 没加载出来');
ok(typeof ctx.Ledger === 'object', 'Ledger 没加载出来');
ok(typeof ctx.Config === 'object', 'Config 没加载出来');
ok(typeof ctx.NowUI === 'object' && typeof ctx.NowUI.mount === 'function', 'NowUI 没挂上');
ok(typeof ctx.EntryUI === 'object', 'EntryUI 没挂上');
ok(typeof ctx.SettingsUI === 'object', 'SettingsUI 没挂上');

var t0 = deep(appDiv);
ok(t0.length > 0, '★ 空数据时页面是空的 —— 第一次打开就白屏');
ok(/录第一期|还没有数据/.test(t0), '空状态没说清下一步该干什么:' + t0.slice(0, 60));

// ---- 2. ★ 塞真实数据再挂一次 ----
// 空数据能挂不代表有数据能挂,而有数据那条路才是天天走的。
var real = JSON.parse(require('fs').readFileSync(
  require('path').join(process.env.TEMP || '/tmp', 'pf', 'backup-keep.json'), 'utf8'));
Object.keys(real.data).forEach(function (k) {
  ctx.__mem[NS + k] = JSON.stringify(real.data[k]);
});

// ⚠️ **每加一页就要加进这个数组。** 漏了的话那一页挂了没人知道 ——
//    而白屏在控制台之外没有任何提示,你得点到那个 tab 才发现。
['NowUI', 'SettingsUI', 'EntryUI', 'HistoryUI', 'StatsUI'].forEach(function (name) {
  var node = new El('div');
  try {
    ctx[name].mount(node, { onEntry: function () {}, onDone: function () {},
                            onChanged: function () {} });
  } catch (e) {
    ok(false, '★ ' + name + ' 拿真实数据挂载时抛异常:' + e.message);
    console.log('     ' + (e.stack || '').split('\n')[1]);
    return;
  }
  var t = deep(node);
  ok(t.length > 30, '★ ' + name + ' 挂上了但页面是空的(' + t.length + ' 字)—— 白屏');
});

// ---- 3. 「现在」页要真的把该做的事算出来 ----
//
// ⚠️ 断言里**不写死金额** —— 仓库是公开的。
//    改成从加载进去的那份数据里现算一个总额出来比对:
//    既不泄露数字,又比写死更严 —— 换一份数据这条照样有效。
var now = new El('div');
ctx.NowUI.mount(now, { onEntry: function () {} });
var tn = deep(now).replace(/\s/g, '');

var latest = ctx.Ledger.latest(ctx.Store.get('snapshots', []));
var wantTotal = Math.round(ctx.Portfolio.sum(latest.holdings) +
                           ctx.Portfolio.sum(latest.cash));
var withCommas = String(wantTotal).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
ok(tn.indexOf(withCommas) >= 0 || tn.indexOf(String(wantTotal)) >= 0,
   '★ 首屏没显示最新一期的组合总额 —— 那是这一页的第一行');

// ⚠️ 主界面**故意不显示清单** —— 清单在「方案屏」里,录完一期自动进。
//    所以这里分两段测:主界面有入口(不然方案屏永远到不了),
//    方案屏有产出。合在一起测的话,「主界面没清单」这个设计
//    和「清单算错了」这个 bug 长得一模一样。
ok(tn.indexOf('该做什么') >= 0,
   '★ 主界面没有通往方案屏的入口 —— 清单是跨天的,没入口就再也回不去');

var plan = ctx.Allocate.planMonthly(latest, ctx.Store.get('settings', {}));
var head = (plan.today[0] || plan.daily[0] || {}).category;

var planEl = new El('div');
ctx.NowUI.showPlan();
ctx.NowUI.mount(planEl, { onEntry: function () {} });
var tp = deep(planEl).replace(/\s/g, '');
ok(head && tp.indexOf(head) >= 0,
   '★ 方案屏没给出「今天买什么」(算出来该买 ' + head + ')');
ok(plan.daily.length === 0 || tp.indexOf(plan.daily[0].category) >= 0,
   '按日投那几项没出来');

// ---- 4. 设置页要把未分类的露出来 ----
//
// 未分类的基金代码从数据里取,不写死 —— 代码本身不是秘密,
// 但写死了换一份数据这条就静默失效了。
var se = new El('div');
ctx.SettingsUI.mount(se, {});
var ts = deep(se);
var known = {};
(ctx.Store.get('settings', {}).funds || []).forEach(function (f) { known[f.code] = 1; });
var orphans = [];
(ctx.Store.get('snapshots', []) || []).forEach(function (s) {
  Object.keys(s.holdings || {}).forEach(function (c) {
    if (!known[c] && orphans.indexOf(c) < 0) orphans.push(c);
  });
});
orphans.forEach(function (c) {
  ok(ts.indexOf(c) >= 0,
     '★ 设置页没显示未分类的 ' + c + ' —— 藏起来的话那笔钱永远不参与再平衡,' +
     '而你只会奇怪总额为什么对不上');
});

// ---- 5. ★ 数据版本对不上 → 停在一屏「先别动」,不许挂任何页面 ----
//
// 场景:另一台设备上跑着更新的代码写了数据,这台的 Service Worker 还缓存着旧代码。
// 旧代码去读新数据是**静默算错**,所以正确反应是停下来。
//
// ⚠️ 这条只有**重新开一次机**才走得到,而它恰恰是最危险的一条 ——
//    写错了的表现是「打开 app 发现数据没了」。
var future = {};
Object.keys(real.data).forEach(function (k) { future[k] = real.data[k]; });
future.__meta = { schema: 999 };
var ctx2 = makeCtx(future);
var t2 = deep(ctx2.__app);

ok(/先别动/.test(t2), '★ 版本对不上却照常挂了页面:' + t2.slice(0, 80));
ok(/更新版本|刷新/.test(t2), '停止屏要说清怎么办:' + t2.slice(0, 120));
ok(!/现在.*历史.*统计/.test(t2), '★ 停止屏上还挂着 tab 栏 —— 点一下就写数据了');

// ★ 最要紧的一条:拦住的时候**一个字节都没写**
var snapsAfter = JSON.parse(ctx2.__mem[NS + 'snapshots']);
ok(snapsAfter.length === real.data.snapshots.length,
   '★ 被拦住时数据被改动了(' + real.data.snapshots.length + ' → ' +
   snapsAfter.length + ' 期)');
ok(!ctx2.__mem[NS + 'todos'] ||
   JSON.parse(ctx2.__mem[NS + 'todos']).length === (real.data.todos || []).length,
   '★ 被拦住时待办被写了 —— 「现在」页渲染时会同步待办,说明它还是挂上了');

console.log(fail ? '开机 ' + fail + ' 处不对'
                 : '  开机 ok(空数据不白屏 · 真实数据能挂 · 方案屏算得出该买什么)');
process.exit(fail ? 1 : 0);
