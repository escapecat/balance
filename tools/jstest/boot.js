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

var harness = require('./_dom.js');
var makeCtx = harness.makeCtx, El = harness.El, NS = harness.NS;

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
// 没有私有迁移产物时仍跑完整有数据的开机路径，不凭空生成“真实基线”。
var privateFixture = require('path').join(process.env.TEMP || '/tmp', 'pf', 'backup-keep.json');
var real = require('fs').existsSync(privateFixture) ? JSON.parse(require('fs').readFileSync(privateFixture, 'utf8')) : {
  version: 2, data: {
    settings: { targets: { 股: 0.5, 债: 0.45 }, cashTarget: 0.05, cashFloor: 0, minBuy: 100,
      funds: [{ code: 'A', category: '股', name: '合成股基' }, { code: 'B', category: '债', name: '合成债基' }], retired: [null] },
    snapshots: [{ date: '2020-01-01', holdings: { A: 80000, B: 80000, orphan: 100 }, cash: { c: 40000 }, actionIds: [] },
      { date: '2020-02-01', holdings: { A: 81000, B: 80000 }, cash: { c: 44000 }, actionIds: [] }],
    assets: [], flows: [], todos: [], prefs: { actionsSince: '2020-01-01' },
  },
};
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
