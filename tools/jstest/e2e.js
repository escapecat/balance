// 端到端 —— **用真数据从头走一遍。**
//
// ⚠️ 单元测试各自的夹具都是我编的,而编夹具的人和写实现的人是同一个 ——
//    一起错的时候两边都不会响。这个文件用迁移出来的**真实数据**跑,
//    数字对不上就说明某一环的假设和现实不符。
//
// ⚠️ 走的是「计划 → 待办 → 勾选 → 现金流 → 下一期重算」整条链。
//    每一段单独都测过了,但**接缝**没测过 ——
//    而这个项目记录在案的失败模式第一条就是「写了没接上」。
//
// ⚠️ **真实金额一分钱都不进仓库。** 仓库是公开的。
//    数据和期望值都在 %TEMP%/pf/ 下面:
//      backup-keep.json  ← python tools/migrate.py
//      expected.json     ← node  tools/mkbaseline.js(人工核对过的基线)
//    两个都没有的话这个文件**整个跳过** —— 而不是悄悄少跑几条断言。

var fs = require('fs');
var path = require('path');
var A = path.join(__dirname, '..', '..', 'app');
var DIR = path.join(process.env.TEMP || '/tmp', 'pf');

var BK = path.join(DIR, 'backup-keep.json');
var EXP = path.join(DIR, 'expected.json');
if (!fs.existsSync(BK)) {
  console.log('  (跳过:没有 backup-keep.json —— 先跑 python tools/migrate.py)');
  process.exit(0);
}
if (!fs.existsSync(EXP)) {
  console.log('  (跳过:没有 expected.json —— 先跑 node tools/mkbaseline.js)');
  process.exit(0);
}

var mem = {};
global.Store = {
  get: function (k, d) { return mem[k] === undefined ? d : mem[k]; },
  set: function (k, v) { mem[k] = v; },
  remove: function (k) { delete mem[k]; },
};
global.Portfolio = require(path.join(A, 'core', 'portfolio.js'));
global.Actions = require(path.join(A, 'core', 'actions.js'));
global.Ledger = require(path.join(A, 'core', 'ledger.js'));
var Allocate = require(path.join(A, 'core', 'allocate.js'));
var Todos = require(path.join(A, 'core', 'todos.js'));

var real = JSON.parse(fs.readFileSync(BK, 'utf8')).data;
var E = JSON.parse(fs.readFileSync(EXP, 'utf8'));
Object.keys(real).forEach(function (k) { mem[k] = real[k]; });

var fail = 0;
function ok(c, m) { if (!c) { console.log('  FAIL ' + m); fail++; } }
function get(id) { return Todos.all().filter(function (t) { return t.id === id; })[0]; }

var st = mem.settings;
var snap = Ledger.latest(mem.snapshots);
ok(snap.date === E.latestDate, '最新一期对得上基线');
ok(mem.snapshots.length === E.snapshotCount, '期数对得上基线');

// ---- 1. 真数据算出来的计划,和基线一致 ----
//
// ⚠️ 而且必须和「配置」表上显示的缺口**一模一样**。
//    两处走的是不同的代码(配置表走 Portfolio.summarize,清单走 Allocate.gaps),
//    口径差一点点就会在同一屏上并排出现两个数 ——
//    算错还能查,两个都言之凿凿的数并排放着,只会让人不再信这个工具。
var p = Allocate.planMonthly(snap, st);
var sm = Portfolio.summarize(snap, st);
var gapOf = {};
sm.rows.forEach(function (r) { if (!r.isCash && !r.unknown) gapOf[r.category] = r.gap; });

// ⚠️ **「清单 = 配置表缺口」只在现金充足时成立。**
//    现金不够时清单是按缺口比例缩过的,这时候正确的不变量是另外两条:
//      · Σ今天买的 = 可投现金(一分不剩,也一分不超)
//      · 各类按缺口比例分,谁都不该被单独优待
//    我一开始把前一条当成无条件的不变量,现金一变紧就整片误报。
var tight = p.spentToday >= p.cashAvailable - 1;
var todayMap = {};
p.today.forEach(function (t) { todayMap[t.category] = t.amount; });
Object.keys(E.today).forEach(function (c) {
  ok(todayMap[c] === E.today[c], c + ':今天买的金额偏离基线');
  if (!tight) {
    ok(todayMap[c] === Math.round(gapOf[c]),
       c + ':现金够的时候,清单和配置表得是同一个数(差 ' +
       Math.round((todayMap[c] || 0) - gapOf[c]) + ')');
  }
});
if (tight) {
  var listed = Object.keys(todayMap).reduce(function (a, c) { return a + todayMap[c]; }, 0);
  ok(Math.abs(listed - p.cashAvailable) < 2,
     '★ 现金紧的时候,今天买的合计该正好花光可投现金(' +
     listed + ' vs ' + p.cashAvailable + ')');
  var totalGap = 0;
  sm.rows.forEach(function (r) { if (!r.isCash && !r.unknown && r.gap > 1) totalGap += r.gap; });
  Object.keys(todayMap).forEach(function (c) {
    var want = gapOf[c] / totalGap * p.cashAvailable;
    ok(Math.abs(todayMap[c] - want) < 2,
       '★ ' + c + ' 没按缺口比例分(' + todayMap[c] + ' vs ' + Math.round(want) + ')');
  });
}
ok(Object.keys(todayMap).length === Object.keys(E.today).length,
   '今天买的条数偏离基线(实得 ' + Object.keys(todayMap).length + ')');

var dailyMap = {};
p.daily.forEach(function (d) { dailyMap[d.category] = d; });
Object.keys(E.daily).forEach(function (c) {
  ok(dailyMap[c] && dailyMap[c].days === E.daily[c].days,
     c + ':天数偏离基线(实得 ' + (dailyMap[c] || {}).days + ')');
  ok(dailyMap[c] && dailyMap[c].amount === Math.round(gapOf[c]),
     c + ':总额和配置表得一致');
});
ok(Object.keys(E.daily).length === p.daily.length,
   '按日投的条数偏离基线 —— 日限额被改过?(实得 ' + p.daily.length + ')');

// ⚠️ 现金够的时候,无限额的几类**今天一次填平** —— 不许按比例缩。
//    第一版「按比例一起分」跑真数据才露馅:黄金只分到该有的八成。
ok(p.spentToday === E.spentToday, '今天合计偏离基线(实得 ' + p.spentToday + ')');
ok(tight ? p.shortfall > 0 : p.cashAvailable > p.spentToday,
   tight ? '现金不够就该报出填不满的差额' : '现金够就不该出现缩放');

// ---- 2. 计划 → 待办 ----
var nToday = Object.keys(E.today).length, nDaily = Object.keys(E.daily).length;
mem.todos = []; mem.flows = [];
Todos.sync(p, snap.date, '2026-08-09');
ok(Todos.all().length === nToday + nDaily,
   '待办条数 = 今天买 + 按日投(实得 ' + Todos.all().length + ')');
ok(Todos.open().length === nToday + nDaily, '都还欠着');

// 挑今天买的第一条走完整条链
var firstCat = Object.keys(E.today)[0];
var firstItem = p.today.filter(function (t) { return t.category === firstCat; })[0];
var firstId = Todos.keyOf('buy', firstItem.fund.code);
ok(get(firstId).target === E.today[firstCat], '待办带着金额');

// ---- 3. 勾掉 → 写现金流 ----
var r = Todos.complete(firstId, E.today[firstCat], '2026-08-09');
ok(r.ok && r.status === 'done', '足额 → done');
ok(Todos.flows().length === 1, '多了一条现金流');
ok(Todos.netByCategory()[firstCat] === E.today[firstCat], '累计投入对得上');
ok(Todos.open().length === nToday + nDaily - 1, '少欠一条');

// ---- 4. 下一期录入之后,买过的不该再出现在清单里 ----
var next = JSON.parse(JSON.stringify(snap));
next.date = '2026-08-09';
var code = firstItem.fund.code;
next.holdings[code] = (next.holdings[code] || 0) + E.today[firstCat];
var cashKey = Object.keys(next.cash)[0];
next.cash[cashKey] -= E.today[firstCat];
next.netInflow = 0;

var p2 = Allocate.planMonthly(next, st);
var still = p2.today.concat(p2.daily).filter(function (x) { return x.fund.code === code; });
var sm2 = Portfolio.summarize(next, st);
var gap2 = sm2.rows.filter(function (r) { return r.category === firstCat; })[0].gap;

// ⚠️ 现金够不够,决定了「买完之后它还在不在清单上」——
//    现金够 → 缺口填平,清单上没有了
//    现金紧 → 只买了一部分,它还在,只是缺口小了一截
//    这两种都对,错的是「买了之后缺口没变小」。
if (tight) {
  ok(gap2 < gapOf[firstCat] - 1,
     '★ 买了一笔之后缺口没变小(' + Math.round(gapOf[firstCat]) +
     ' → ' + Math.round(gap2) + ')');
} else {
  ok(still.length === 0, '现金够的时候买完就该填平,清单上不该还有(实得 ' +
     still.length + ' 条)');
}

Todos.sync(p2, next.date, '2026-08-09');
// ⚠️ 换了一期之后,没做完的会开新一轮(open),做完的保持 done。
//    **无论如何都不许是 resolved** —— 那个状态的意思是「缺口被市值涨平的」,
//    把你真金白银买出来的记成 resolved,统计里「实投 vs 应投」就全错了。
ok(get(firstId).status !== 'resolved',
   '★ 你买出来的被记成了「已达标」—— 那是市值涨平才用的状态');
ok(tight ? get(firstId).status === 'open' : get(firstId).status === 'done',
   '换一期之后的状态不对(实得 ' + get(firstId).status + ')');
ok(Todos.flows().length === 1, '重新对账不许凭空多出现金流');

// ---- 5. 组合口径:外部资产不进组合总额 ----
var d = Ledger.delta(next, snap);
ok(d.total === Portfolio.sum(next.holdings) + Portfolio.sum(next.cash),
   '组合 = 持仓 + 现金,不含组合外');
ok(d.inflow === 0 && d.market === 0,
   '只是把现金换成了基金,组合总额没变、涨跌是 0(实得 change=' + d.change + ')');

if (fail) { console.log('  ' + fail + ' 条没过'); process.exit(1); }
console.log('  端到端 ok(真数据 → 计划 → 待办 → 勾选 → 现金流 → 下一期不再出现)');
