// 组合外资产 —— **金额只有一处出处。**
//
// ⚠️ 这个文件守的是一次「两条路径记同一件事」的返工:
//    第一版 `assets[].value` 存一份、`snapshot.external` 也存一份。
//    录入页只写后者,「现在」页只读前者 —— 于是填完组合外那笔之后,
//    页面一边把它算进总额,一边挂着「还没填过金额,没算进上面这个数」。
//    两个数字都言之凿凿,而它们是矛盾的。
//
// ⚠️ 另一半是口径:**组合 = 持仓 + 现金,不含组合外**。
//    房产估值一年动一次还是拍脑袋估的,混进组合的话,
//    某天把房子从 200 万改成 220 万,`delta.market` 就凭空「涨」20 万 ——
//    而 delta 存在的全部理由就是分清「赚的」和「投的」。

var path = require('path');
var A = path.join(__dirname, '..', '..', 'app');

var mem = {};
global.Store = {
  get: function (k, d) { return mem[k] === undefined ? d : mem[k]; },
  set: function (k, v) { mem[k] = v; },
  remove: function (k) { delete mem[k]; },
};
global.Portfolio = require(path.join(A, 'core', 'portfolio.js'));
var Ledger = require(path.join(A, 'core', 'ledger.js'));
var Assets = require(path.join(A, 'core', 'assets.js'));

var fail = 0;
function ok(c, m) { if (!c) { console.log('  FAIL ' + m); fail++; } }

// ---- 1. 元数据里不许带金额 ----
mem.assets = [];
var r = Assets.upsert({ name: 'MSFT', kind: 'other', value: 300000 });
ok(r.ok, '加得进去');
var a = Assets.all()[0];
ok(a.value === undefined,
   'assets[] 不许存金额 —— 存了就会和快照里的那份不同步(实得 ' + a.value + ')');
ok(a.id === 'a1', 'id 按序号发,不含名字不含日期');

// ---- 2. 改名字不动 id —— 否则快照里那笔金额瞬间失配 ----
Assets.upsert({ id: 'a1', name: '微软', kind: 'other' });
ok(Assets.all().length === 1, '改名是改不是加');
ok(Assets.all()[0].id === 'a1', '改名字之后 id 还得是 a1');

// ---- 3. 没填过 ≠ 0 ----
var snapNo = { date: '2026-07-30', holdings: { x: 100 }, cash: {}, external: {} };
var t0 = Assets.total(snapNo);
ok(t0.sum === 0 && t0.blank.length === 1,
   '没填过要进 blank 让界面说出来,不能静默当 0');

var snapYes = { date: '2026-08-09', holdings: { x: 100 }, cash: {},
                external: { a1: 300000 } };
var t1 = Assets.total(snapYes);
ok(t1.sum === 300000 && t1.blank.length === 0, '填了就该加进来');
ok(Assets.valueAt(snapNo, 'a1') === null, '没填的那期取值是 null 不是 0');

// ---- 4. 删名目不动历史金额 ----
Assets.remove('a1');
ok(Assets.all().length === 0, '名目删掉了');
ok(snapYes.external.a1 === 300000, '快照里那笔钱一个字都不许动');

// ---- 5. 口径:组合外的涨跌不许算进组合 ----
//
// 两期之间**只有房产估值变了**,持仓和现金一动没动。
// 房产估值从 100 万改成 120 万,组合的 change 必须是 0 —— 不是 20 万。
var p1 = { date: '2026-07-30', holdings: { x: 1000 }, cash: { c: 500 },
           external: { h: 1000000 }, netInflow: 0 };
var p2 = { date: '2026-08-09', holdings: { x: 1000 }, cash: { c: 500 },
           external: { h: 1200000 }, netInflow: 0 };
var d = Ledger.delta(p2, p1);
ok(d.total === 1500, '组合总额 = 持仓 + 现金 = 1500(实得 ' + d.total + ')');
ok(d.change === 0, '房子估值涨了 20 万,组合一分钱没动,change 必须是 0(实得 ' + d.change + ')');
ok(d.market === 0, '涨跌也必须是 0 —— 否则收益率会被房产估值带跑');
ok(d.external === 1200000, '组合外单独给出来,让界面能分两行显示');

// ---- 6. 没有 netInflow 的那几期仍然不许编涨跌 ----
var noFlow = { date: '2026-08-09', holdings: { x: 1200 }, cash: { c: 500 }, external: {} };
var d2 = Ledger.delta(noFlow, p1);
ok(d2.change === 200, '总额变化算得出来');
ok(d2.market === null && d2.inflow === null,
   '不知道投了多少就不给涨跌 —— 宁可写「未知」也不给个错的');

if (fail) { console.log('  ' + fail + ' 条没过'); process.exit(1); }
console.log('  组合外资产 ok(金额只在快照 · 没填≠0 · 删名目不动历史 · 估值不污染组合涨跌)');
