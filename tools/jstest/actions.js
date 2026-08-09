// 动作驱动 —— **两个式子,两个未知数,一个都不用填。**
//
//      现金变化 = 外部净流入 − 净买入 + 分红
//      持仓变化 = 净买入 − 分红 + 市场涨跌
//
//   → 外部净流入 = 现金变化 + 净买入 − 分红      (工资 − 花费)
//   → 市场涨跌   = 持仓变化 − 净买入 + 分红
//
// ⚠️ 这个文件守的是「算出来的数必须和真相一致」。
//    夹具的造法是**先定真相**(这个月工资多少、市场涨了多少),
//    再倒推出对账时会看到的数字,然后检查解出来的等不等于真相。
//    反过来造(先编数字再算)的话,测的只是「代码和它自己一致」。
//
// ⚠️ 最要紧的是**分不出来的时候不许给数**:
//    没开始记动作的那些区间,`inflow` 和 `market` 必须是 null 而不是 0。

var path = require('path');
var A = path.join(__dirname, '..', '..', 'app');

var mem = {};
global.Store = {
  get: function (k, d) { return mem[k] === undefined ? d : mem[k]; },
  set: function (k, v) { mem[k] = v; },
  remove: function (k) { delete mem[k]; },
};
global.Portfolio = require(path.join(A, 'core', 'portfolio.js'));
var Actions = require(path.join(A, 'core', 'actions.js'));
global.Actions = Actions;
var Ledger = require(path.join(A, 'core', 'ledger.js'));

var fail = 0;
function ok(c, m) { if (!c) { console.log('  FAIL ' + m); fail++; } }
function near(a, b, m) {
  ok(a != null && Math.abs(a - b) < 0.5, m + '(应 ' + b + ',实得 ' + a + ')');
}
function reset() { mem = {}; }

// ---- 1. ★ 先定真相,再倒推,再检查解出来的对不对 ----
//
// 真相:这个月工资花完剩 50000 进来,买了基金 80000,市场让基金涨了 12000。
reset();
var 工资净额 = 50000, 买入 = 80000, 涨跌 = 12000;

var 上期 = { date: '2026-08-01', holdings: { S1: 600000 }, cash: { c: 200000 } };
var 本期 = {
  date: '2026-09-01',
  holdings: { S1: 600000 + 买入 + 涨跌 },        // 持仓 = 原来 + 买的 + 涨的
  cash:     { c: 200000 + 工资净额 - 买入 },      // 现金 = 原来 + 工资 − 买的
};

Actions.startFrom('2026-08-01');
Actions.add({ date: '2026-08-15', kind: 'buy', code: 'S1', category: '股', amount: 买入 });

var d = Ledger.delta(本期, 上期);
ok(d.source === 'actions', '应该走动作那条路(实得 ' + d.source + ')');
near(d.inflow, 工资净额, '★ 工资花费净值算错了 —— 那是你想看的那个数');
near(d.market, 涨跌, '★ 市场涨跌算错了');
near(d.netBuy, 买入, '净买入');
near(d.change, 工资净额 + 涨跌, '总额变化 = 工资 + 涨跌');

// ---- 2. ★ 买入不许被算成「涨了」 ----
//
// 这是整件事的初衷。全月只买不涨:market 必须是 0,不是买入的金额。
reset();
Actions.startFrom('2026-08-01');
Actions.add({ date: '2026-08-15', kind: 'buy', code: 'S1', amount: 100000 });
var d2 = Ledger.delta(
  { date: '2026-09-01', holdings: { S1: 700000 }, cash: { c: 100000 } },
  { date: '2026-08-01', holdings: { S1: 600000 }, cash: { c: 200000 } });
near(d2.market, 0, '★ 把买进去的钱算成了赚的 —— 这是整个改动的初衷');
near(d2.inflow, 0, '钱只是从现金搬到基金,没有外部流入');
near(d2.change, 0, '总额一分没变');

// ---- 3. ★ 卖出也一样,反方向 ----
reset();
Actions.startFrom('2026-08-01');
Actions.add({ date: '2026-08-15', kind: 'sell', code: 'S1', amount: 50000 });
var d3 = Ledger.delta(
  { date: '2026-09-01', holdings: { S1: 550000 }, cash: { c: 250000 } },
  { date: '2026-08-01', holdings: { S1: 600000 }, cash: { c: 200000 } });
near(d3.market, 0, '★ 把卖出算成了亏损');
near(d3.inflow, 0, '卖出不是「取钱出去花」');

// ---- 4. ★ 现金分红:漏了这一项,两个数会同时错,而总额完全对得上 ----
//
// 真相:基金分了 8000 到现金,市场本身没动,工资也没进来。
// 不认分红的话会算成「基金亏了 8000 + 工资多了 8000」——
// 两个数方向相反、总额对得上,所以查不出来。
reset();
Actions.startFrom('2026-08-01');
Actions.add({ date: '2026-08-20', kind: 'dividend', code: 'S1', amount: 8000 });
var d4 = Ledger.delta(
  { date: '2026-09-01', holdings: { S1: 592000 }, cash: { c: 208000 } },
  { date: '2026-08-01', holdings: { S1: 600000 }, cash: { c: 200000 } });
near(d4.market, 0, '★ 分红被算成了基金亏损');
near(d4.inflow, 0, '★ 分红被算成了工资');
near(d4.dividend, 8000, '分红要单独报出来');

// ---- 5. ★ 没开始记动作的区间:不许给 0,要给 null ----
//
// 「没有动作记录」和「这期没买过」长得一模一样,而含义天差地别。
// 老数据(迁移进来的那几期)全是前者。
reset();
var d5 = Ledger.delta(
  { date: '2026-06-01', holdings: { S1: 700000 }, cash: { c: 100000 } },
  { date: '2026-05-01', holdings: { S1: 600000 }, cash: { c: 200000 } });
ok(d5.inflow === null && d5.market === null,
   '★ 没有动作记录却给出了涨跌 —— 那是拿总额倒推,能编出一条完全虚假的曲线');
ok(d5.change === 0, '总额变化还是要算的');
ok(d5.source === null, '要说清数据是哪来的(实得 ' + d5.source + ')');

// ---- 6. 老数据手填过 netInflow 的还认 ----
reset();
var d6 = Ledger.delta(
  { date: '2026-06-01', holdings: { S1: 700000 }, cash: {}, netInflow: 60000 },
  { date: '2026-05-01', holdings: { S1: 600000 }, cash: {} });
near(d6.inflow, 60000, '手填的净投入还得认');
near(d6.market, 40000, '涨跌 = 总变化 − 手填的净投入');
ok(d6.source === 'manual', '要标明这是手填的,不是算出来的');

// ---- 7. ★ 逐只基金的盈亏 ----
//
// 你要的「这个月哪只赚了哪只亏了」。
// 真相:A 买了 30000 涨了 5000;B 没动作但跌了 2000。
reset();
Actions.startFrom('2026-08-01');
Actions.add({ date: '2026-08-10', kind: 'buy', code: 'A', amount: 30000 });
var pf = Ledger.perFund(
  { date: '2026-09-01', holdings: { A: 135000, B: 48000 }, cash: {} },
  { date: '2026-08-01', holdings: { A: 100000, B: 50000 }, cash: {} });
ok(pf, '应该算得出来');
var a = pf.filter(function (x) { return x.code === 'A'; })[0];
var b = pf.filter(function (x) { return x.code === 'B'; })[0];
near(a.market, 5000, '★ A 的涨跌算错 —— 买进去的 30000 不是赚的');
near(a.netBuy, 30000, 'A 的净买入');
near(b.market, -2000, '★ B 的涨跌算错');
near(b.netBuy, 0, 'B 这个月没动过');

// 没有动作记录的区间,逐只也不许给数
reset();
ok(Ledger.perFund(
     { date: '2026-06-01', holdings: { A: 100 }, cash: {} },
     { date: '2026-05-01', holdings: { A: 90 }, cash: {} }) === null,
   '★ 没有动作记录却给出了逐只盈亏');

// ---- 8. 动作本身的规矩 ----
reset();
ok(!Actions.add({ date: '2026-08-01', kind: 'buy', amount: 0 }).ok, '0 元的买入不许记');
ok(!Actions.add({ date: '2026-08-01', kind: 'buy' }).ok, '没金额不许记');
ok(!Actions.add({ kind: 'buy', amount: 100 }).ok, '没日期不许记');
ok(!Actions.add({ date: '2026-08-01', kind: '转账', amount: 100 }).ok,
   '认不出的动作类型要拒绝,不能静默存进去');

// note 是留痕用的,不要金额
ok(Actions.add({ date: '2026-08-01', kind: 'note', note: '把黄金目标调高两个点' }).ok,
   'note 不需要金额');

// ---- 8b. ★ 「从哪天开始记全了」不许自动推 ----
//
// 第一次记账那天往前到上次对账之间,你可能买过东西没记 ——
// 工具没法知道,只有你知道。自动推的两种错法都很糟:
//   · 取第一笔动作那天 → 之前那几天的买入被算成「市场涨跌」,数字全错还看不出来
//   · 保守地往后推     → 整个第一期白等
// 所以它必须是一次明确的回答。
ok(Actions.needsStart(), '★ 记了几笔就自己把起点定了 —— 那是在替人回答他才知道的问题');
Actions.add({ date: '2026-08-05', kind: 'buy', code: 'A', amount: 1000 });
ok(Actions.needsStart(), '★ 记了一笔买入就自动定锚了');
ok(!Actions.covered('2026-08-01'), '没声明起点之前,任何区间都不算有记录');

Actions.startFrom('2026-07-30');
ok(Actions.covered('2026-07-30'), '声明之后,起点当天及以后的区间就算数了');
ok(!Actions.covered('2026-07-01'), '起点之前的还是不算');

// ---- 8c. ★ 补录:日期填当时的,而不是记账那天 ----
//
// 你不可能每次都在基金 app 点完确认那一刻就打开这里,隔两天想起来是常态。
// 日期落错了的话,这笔会算进错的那一期 —— **两期的涨跌同时错**,
// 一期多算、一期少算,而总额完全对得上,所以查不出来。
reset();
Actions.startFrom('2026-07-30');
Actions.add({ date: '2026-08-05', kind: 'buy', code: 'A', amount: 40000 });  // 补录
Actions.add({ date: '2026-09-15', kind: 'buy', code: 'A', amount: 10000 });  // 下一期的

near(Actions.netBuy('2026-07-30', '2026-09-01').total, 40000,
     '★ 补录的那笔没落进它该在的那一期');
near(Actions.netBuy('2026-09-01', '2026-10-01').total, 10000,
     '★ 下一期的那笔串到别处去了');

// 补录之后,跨越记账起点的那一期就能算了 —— 这正是「补录」存在的理由
var dBack = Ledger.delta(
  { date: '2026-09-01', holdings: { A: 145000 }, cash: { c: 60000 } },
  { date: '2026-07-30', holdings: { A: 100000 }, cash: { c: 100000 } });
ok(dBack.source === 'actions',
   '★ 补录完了那一期还是算不出来 —— 那补录就白做了');
near(dBack.market, 5000, '涨跌 = 持仓变化 45000 − 买进去的 40000');
near(dBack.inflow, 0, '钱只是从现金搬到基金');

// 区间是左开右闭 —— 对账日当天的买入算这一期
reset();
Actions.add({ date: '2026-08-01', kind: 'buy', code: 'A', amount: 111 });
Actions.add({ date: '2026-09-01', kind: 'buy', code: 'A', amount: 222 });
near(Actions.netBuy('2026-08-01', '2026-09-01').total, 222,
     '区间左开右闭:起点当天的不算,终点当天的算');

if (fail) { console.log('  ' + fail + ' 条没过'); process.exit(1); }
console.log('  动作驱动 ok(工资花费净值和市场涨跌都是解出来的 · 分红不混进涨跌 · 没记录不给数)');
