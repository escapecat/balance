// 再平衡 —— 月度只买,年度买卖两侧。
//
// ⚠️ 这个文件里最要紧的是第 3 条:**无限额的必须一次填平,不许和有限额的一起按比例缩。**
//    我第一版就是「所有类别按缺口比例一起分」——看着最公平,拿真数据一跑才露馅:
//    有限额的类今天只吃得下日限额那么多,分给它一大笔钱是**假的**,
//    那笔钱实际还躺在现金里。而无限额的那一类因为「按比例」
//    只分到该有的八成 —— 本来今天能进场的钱没进场。
//    结果:本来今天能进场的钱没进场,现金比例继续偏离,
//    **而账面上显示「已经合理分配了」**。光读代码看不出来。
//
// ⚠️ 第 6 条守的是另一件事:「只买不卖」不是永久规则,是月度模式的特征。
//    现金见底之后还坚持不卖,等于宣布以后不再做再平衡。

var path = require('path');
var A = path.join(__dirname, '..', '..', 'app');
global.Portfolio = require(path.join(A, 'core', 'portfolio.js'));
var Allocate = require(path.join(A, 'core', 'allocate.js'));

var fail = 0;
function ok(c, m) { if (!c) { console.log('  FAIL ' + m); fail++; } }
function pick(list, cat) { return list.filter(function (x) { return x.category === cat; })[0]; }

var S = {
  targets: { 股: 0.50, 债: 0.50 },
  cashTarget: 0.05, cashFloor: 0, band: 0.05, minBuy: 1000,
  funds: [
    { code: 'S1', name: '股基', category: '股', primary: true, dailyLimit: 2000 },
    { code: 'B1', name: '债基', category: '债', primary: true },
  ],
};

// ---- 1. 超配的一律分到 0(只买不卖)----
var r1 = Allocate.planMonthly(
  { holdings: { S1: 100000, B1: 20000 }, cash: { c: 30000 } }, S);
ok(!pick(r1.today, '股') && !pick(r1.daily, '股'),
   '股已经超配了,还给它分钱 —— 月度模式是只买不卖');
ok(!!pick(r1.today, '债'), '债欠配却没分到钱');

// ---- 2. 缺口按组合总额算 · 而现金要留够目标占比 ----
//
// 当前 股 10 万、现金 10 万,总额 20 万。债目标 50% → 缺口 10 万
// (按当前总额算的话只该补 5 万 —— 那样钱投进去总额变大、目标跟着变大,
//  永远差一口气)。
//
// ⚠️ 但**今天能投的不是 10 万**:现金目标 5%,总额 20 万,得留 1 万。
//    第一版只减 cashFloor(这里是 0),于是把现金抽干到 0 ——
//    而配置表明明写着现金目标 5%。同一屏上两个数打架。
//    两个设置都得守:cashFloor 是绝对下限,cashTarget 是比例目标,取更严的。
var r2 = Allocate.planMonthly({ holdings: { S1: 100000 }, cash: { c: 100000 } }, S);
ok(pick(r2.today, '债') && Math.abs(pick(r2.today, '债').amount - 90000) < 2,
   '★ 今天该投 9 万(缺口 10 万,但要留 5% 现金),实际 ' +
   (pick(r2.today, '债') || {}).amount);
ok(Math.abs(r2.cashAvailable - 90000) < 2,
   '★ 可投现金没扣掉「现金目标占比」那部分(实得 ' + r2.cashAvailable + ')');
ok(Math.abs(r2.shortfall - 10000) < 2,
   '填不满的那 1 万要说出来,实得 ' + r2.shortfall);

// ---- 3. ★ 无限额的一次填平,不许被有限额的按比例摊薄 ----
//
// ⚠️ 夹具要造得对:`Σ缺口 ≡ 可投现金` 是个恒等式(因为 Σ目标 = 投完后的总额),
//    所以想让「正缺口合计 > 现金」,**必须至少有一类超配**。
//    第一版夹具只有两类,我以为在测「摊薄」,实际那一类本来就是超配的,
//    压根不该分到钱 —— 测的不是我想测的东西。
//
// 造:商品超配 75k;股(有限额)缺 112.5k;债(无限额)缺 112.5k;现金 150k。
// 错的做法:按 1:1 摊 → 债只拿 75k。
// 对的做法:债一次拿满 11.25 万,股走按日投 —— 它今天本来也只吃得下日限额。
var S3 = { targets: { 股: 0.45, 债: 0.45, 商: 0.10 }, cashFloor: 0,
           funds: [{ code: 'S1', category: '股', primary: true, dailyLimit: 2000 },
                   { code: 'B1', category: '债', primary: true },
                   { code: 'C1', category: '商', primary: true }] };
var r3 = Allocate.planMonthly(
  { holdings: { S1: 0, B1: 0, C1: 100000 }, cash: { c: 150000 } }, S3);
var bond = pick(r3.today, '债');
ok(bond && Math.abs(bond.amount - 112500) < 2,
   '★ 无限额的债应该一次拿满 11.25 万,实际 ' + (bond || {}).amount +
   ' —— 按比例摊薄的话,本来今天就能进场的钱会躺着等瓶颈,' +
   '而账面上显示「已经合理分配了」');
var stock = pick(r3.daily, '股');
ok(stock && stock.perDay === 2000,
   '有限额的股应该走「按日投」,而不是今天一次买完');
ok(!pick(r3.today, '商') && !pick(r3.daily, '商'), '超配的商品还分到了钱');

// ---- 4. 有限额的:天数 = 缺口 / 日限额,完工时间取最慢的那一类 ----
var r4 = Allocate.planMonthly(
  { holdings: { S1: 0, B1: 100000 }, cash: { c: 100000 } },
  { targets: { 股: 0.50, 债: 0.50 }, cashFloor: 0,
    funds: [{ code: 'S1', category: '股', primary: true, dailyLimit: 1000 },
            { code: 'B1', category: '债', primary: true }] });
var s4 = pick(r4.daily, '股');
ok(s4 && s4.days === Math.ceil(s4.amount / 1000),
   '天数没按日限额算:' + JSON.stringify(s4));
ok(r4.daysNeeded === s4.days, '完工天数应该等于最慢那一类');

// ---- 5. 现金填不满全部缺口时要说出来 ----
ok(r3.shortfall > 0,
   '★ 现金不够填满缺口却没报 shortfall —— 你会以为照做了就到位,' +
   '然后疑惑「怎么还是不达标」');

// ---- 6. ★ 现金见底 + 偏差超带 → 建议年度那一刀 ----
var dry = { holdings: { S1: 130000, B1: 70000 }, cash: { c: 0 } };
var m = Allocate.suggestMode(dry, S, '2026-08-09');
ok(m.mode === 'annual',
   '★ 现金见底了、股超配 15 个点,还建议「月度只买」—— ' +
   '没钱可投的时候不卖就修不了,等于宣布以后不再做再平衡(实际 ' + m.mode + ')');

var m2 = Allocate.suggestMode({ holdings: { S1: 100000, B1: 100000 }, cash: { c: 50000 } },
                              S, '2026-08-09');
ok(m2.mode === 'monthly', '还有现金可投时应该走月度');

// ---- 7. 年度:卖多少买多少,现金不动 ----
var a = Allocate.planAnnual(dry, S, '2026-08-09');
var sold = a.sells.reduce(function (s, x) { return s + x.amount; }, 0);
var bought = a.buys.reduce(function (s, x) { return s + x.amount; }, 0);
ok(sold > 0 && Math.abs(sold - bought) <= 2,
   '★ 年度这一刀卖了 ' + sold + ' 买了 ' + bought + ' —— 必须相等,' +
   '否则它就混进了「投新钱」,事后看不出这一刀到底调了什么');

// ---- 8. 带内不折腾 ----
var inband = Allocate.planAnnual({ holdings: { S1: 102000, B1: 98000 }, cash: { c: 0 } },
                                 S, '2026-08-09');
ok(inband.inBand, '偏差 1 个点就动刀了 —— 带子是用来防止瞎折腾的');

// ---- 9. 锁仓的不卖,而且要说出来 ----
var L = { targets: { 股: 0.50, 债: 0.50 }, cashFloor: 0, band: 0.05,
          locked: [{ fundCode: 'S1', amount: 100000, unlockDate: '2027-01-01' }],
          funds: [{ code: 'S1', category: '股', primary: true },
                  { code: 'B1', category: '债', primary: true }] };
var a2 = Allocate.planAnnual({ holdings: { S1: 130000, B1: 70000 }, cash: { c: 0 } },
                             L, '2026-08-09');
var soldS = (pick(a2.sells, '股') || {}).amount || 0;
ok(soldS <= 30000 + 1,
   '★ 卖掉了锁仓的部分(卖 ' + soldS + ',可卖只有 3 万)—— 这份清单没法照着做');
ok((a2.skipped || []).length > 0,
   '锁仓少卖了一笔却没说 —— 静默少卖会让金额对不上,而你查不出差在哪');

// ---- 10. 卖不超过实际持仓 ----
a2.sells.forEach(function (x) {
  ok(x.amount <= 130000, '卖出超过了实际持仓:' + JSON.stringify(x));
});

// ---- ★ 年度:卖出来的钱必须有地方去 ----
//
// 拿真数据模拟「一年后」时抓到的:某一类超配 5.4 个点被卖掉,
// 而欠配的几类各差 1~4 个点、都够不着偏差带,于是买入清单是空的 ——
// 卖了十几万,那笔钱凭空消失,而界面上还写着「卖多少买多少」。
//
// 正确语义:**够不够得着带子决定要不要动手;一旦动手,
// 钱就该回到所有欠配的地方去。** 带子只筛「卖谁」,不筛「买谁」。
var BAND = {
  targets: { 股: 0.25, 债: 0.25, 金: 0.25, 红: 0.25 },
  funds: [{ code: 'S1', category: '股', primary: true },
          { code: 'B1', category: '债', primary: true },
          { code: 'G1', category: '金', primary: true },
          { code: 'R1', category: '红', primary: true }],
  cashFloor: 0, cashTarget: 0, band: 0.05, minBuy: 1000,
};
// 股超配 6 个点(要卖);其余三类各欠 2 个点(都够不着带子)
var drifted = { holdings: { S1: 310000, B1: 230000, G1: 230000, R1: 230000 }, cash: {} };
var ann = Allocate.planAnnual(drifted, BAND, '2027-01-01');
var sold = ann.sells.reduce(function (a, x) { return a + x.amount; }, 0);
var got = ann.buys.reduce(function (a, x) { return a + x.amount; }, 0);
ok(sold > 0, '股超配 6 个点,该卖(实得卖 ' + sold + ')');
ok(got > 0, '★ 卖了 ' + sold + ' 却一分钱都没买 —— 那笔钱凭空消失了');
ok(Math.abs(sold - got) < 2,
   '★ 卖出和买入必须相等(卖 ' + sold + ' / 买 ' + got + ')—— 年度这一刀不碰现金');
ok(ann.buys.length === 3, '三个欠配的类都该分到钱(实得 ' + ann.buys.length + ' 个)');

// 没有哪一类超配到一个带 → 不动手
var calm = { holdings: { S1: 252000, B1: 249000, G1: 250000, R1: 249000 }, cash: {} };
ok(Allocate.planAnnual(calm, BAND, '2027-01-01').inBand, '都在带子里就不该动手');

// ★ 两处口径必须一致:说该动手了,进去就得真有东西卖
ok(Allocate.suggestMode(drifted, BAND, '2027-01-01').mode === 'annual',
   'suggestMode 应该说该做年度了');
ok(Allocate.planAnnual(drifted, BAND, '2027-01-01').sells.length > 0,
   '★ suggestMode 说该动手,planAnnual 却没东西卖 —— 两处分母不一致');

console.log(fail ? '再平衡 ' + fail + ' 处不对'
                 : '  再平衡 ok(只买不卖 · 无限额一次填平 · 限额拆天数 · ' +
                   '现金见底转年度 · 卖买相等 · 锁仓不卖)');
process.exit(fail ? 1 : 0);
