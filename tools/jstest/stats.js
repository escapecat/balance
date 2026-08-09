// 统计 —— **样本不够就不给数 · 算法用已知答案验过。**
//
// ⚠️ 收益率现在一个数都出不来(历史几期都没记净投入),
//    所以这个文件用**构造的、答案已知的**数据验算法本身:
//    投 100 万,一年后 110 万,XIRR 必须是 10%。
//    等真实数据攒够了直接就能用 —— 而不是那时候才发现算错了。
//
// ⚠️ 最要紧的几条其实是**不出数**的那几条:
//    两期就敢给年化、三个月赚 5% 年化成 21.6%、没收敛把最后一次迭代当答案 ——
//    这三种都会给出一个长得和真的一模一样的数,而你会拿它做决定。

var path = require('path');
var A = path.join(__dirname, '..', '..', 'app');
global.Portfolio = require(path.join(A, 'core', 'portfolio.js'));
// ⚠️ Stats 靠 Ledger.delta 判断「这一期分不分得开」—— 那是接缝所在。
//    夹具里不给 Actions,于是走的是 delta 的「手填 netInflow」那条退路,
//    正好覆盖老数据;动作驱动那条在 jstest/actions.js 里测。
global.Ledger = require(path.join(A, 'core', 'ledger.js'));
var Stats = require(path.join(A, 'core', 'stats.js'));

var fail = 0;
function ok(c, m) { if (!c) { console.log('  FAIL ' + m); fail++; } }
function near(a, b, tol, m) {
  ok(a != null && Math.abs(a - b) < (tol || 1e-6),
     m + '(应 ' + b + ',实得 ' + a + ')');
}
function snap(date, value, netInflow) {
  var s = { date: date, holdings: { A: value }, cash: {} };
  if (netInflow !== undefined) s.netInflow = netInflow;
  return s;
}

// ---- 1. ★ 样本不够,一个数都不给 ----
//
// 而且要说清**还差几期**,不是返回 null 让界面自己猜。
var none = [snap('2026-05-11', 1000000), snap('2026-06-11', 1050000),
            snap('2026-07-11', 1100000)];      // 三期,但都没记净投入
var g = Stats.gate(none);
ok(!g.ok, '★ 没记净投入却给出了收益率 —— 那是编的');
ok(g.have === 0 && g.need === 3, '要说清还差几期(实得 have=' + g.have + ')');
ok(!Stats.twr(none).ok && !Stats.xirr(none).ok, '两种收益率都得拒绝');

var two = [snap('2026-05-11', 1000000, 0), snap('2026-06-11', 1050000, 0)];
ok(!Stats.gate(two).ok, '★ 两期就敢给年化 —— 一个区间的年化没有意义');
ok(Stats.gate(two).have === 2, '两期都可用,但不够');

// ---- 2. ★ 连续性:中间断一期不许跨过去接 ----
//
// 断掉的那段里投过多少钱是未知的,把两截接起来等于假装没投过。
//
// ⚠️ 但**起点那一期不需要有流水记录** —— 它只提供期初市值。
//    所以下面这组:第 2 期没记,断点在 1→2 之间;
//    可用的是第 2、3、4 期(两个区间 2→3、3→4),一共 3 期,不是 2 期。
//    早先的实现按「带 netInflow 的期数」数,白白少算一期 ——
//    表现是明明记满了却还提示「还差一期」。
var broken = [snap('2026-05-11', 1000000, 0), snap('2026-06-11', 1050000),
              snap('2026-07-11', 1100000, 0), snap('2026-08-11', 1150000, 0)];
ok(Stats.usable(broken) === 3,
   '★ 可用期数算错(实得 ' + Stats.usable(broken) + ',应为 3:两个区间 + 起点)');
ok(Stats.gate(broken).ok, '三期够了,不该再拦着');

// 断点更靠后的话就真的不够了
var broken2 = [snap('2026-05-11', 1000000, 0), snap('2026-06-11', 1050000, 0),
               snap('2026-07-11', 1100000), snap('2026-08-11', 1150000, 0)];
ok(Stats.usable(broken2) === 2,
   '★ 断点靠后时只剩两期(实得 ' + Stats.usable(broken2) + ')');
ok(!Stats.gate(broken2).ok, '两期不够,不许出数');

// ---- 3. TWR:净投入要从期末扣掉 ----
//
// 三期:100 万 → 110 万(其中投了 10 万,市场 0)→ 121 万(投 0,涨 10%)
// 正确答案:第一段 (110−10)/100 = 1.0,第二段 121/110 = 1.1,连乘 = 1.1
var t = Stats.twr([snap('2026-01-01', 1000000, 0),
                   snap('2026-02-01', 1100000, 100000),
                   snap('2026-03-01', 1210000, 0)]);
ok(t.ok, 'TWR 应该算得出来');
near(t.rate, 0.1, 1e-9,
     '★ TWR 把申购算成了收益 —— 第一段投了 10 万、市场没动,那一段该是 0%');
ok(t.periods === 2, '两个区间');

// ---- 4. ★ 不满一年不年化 ----
//
// 三个月赚 5% 年化成 21.6%:数学上对,用起来极具误导 —— 短期波动放大了四倍。
ok(t.annual === null,
   '★ 才两个月就给了年化 ' + t.annual + ' —— 短期波动会被放大好几倍');
ok(Stats.annualize(0.05, 90) === null, '90 天不许年化');
near(Stats.annualize(0.1, 365), 0.1, 1e-9, '满一年就是它本身');
near(Stats.annualize(0.21, 730), 0.1, 1e-3, '两年 21% ≈ 年化 10%');

// ---- 5. XIRR:用已知答案验 ----
//
// 一开始投 100 万,一年后变成 110 万,中间没再投 → 正好 10%
var x = Stats.xirr([snap('2026-01-01', 1000000, 0),
                    snap('2026-07-01', 1050000, 0),
                    snap('2027-01-01', 1100000, 0)]);
ok(x.ok, 'XIRR 应该算得出来');
near(x.rate, 0.1, 1e-4, '★ XIRR 算错了');

// 年中又投了 10 万:期末 121 万。
// 那 10 万只工作了半年,所以年化必然**高于** (121−110)/110,
// 而且必然低于把它当成年初就投的算法。
var x2 = Stats.xirr([snap('2026-01-01', 1000000, 0),
                     snap('2026-07-01', 1150000, 100000),
                     snap('2027-01-01', 1210000, 0)]);
ok(x2.ok && x2.rate > 0 && x2.rate < 0.2,
   '★ 中途投钱的 XIRR 跑飞了:' + (x2.rate * 100).toFixed(1) + '%');

// ---- 6. ★ 解不出来的时候要说解不出来 ----
var same = Stats.xirr([snap('2026-01-01', 0, 0), snap('2026-02-01', 0, 0),
                       snap('2026-03-01', 0, 0)]);
ok(!same.ok, '★ 现金流全是同向却给出了一个收益率 —— 那是没收敛时的残值');

// ---- 7. 结构变化:现金要算一类 ----
//
// 现金常常是变化最大的那一类,而按持仓分类的话它根本不出现。
var S = { targets: { 股: 0.5, 债: 0.5 }, cashTarget: 0,
          funds: [{ code: 'S1', category: '股' }, { code: 'B1', category: '债' }] };
var comp = Stats.composition([
  { date: '2026-01-01', holdings: { S1: 100000 }, cash: { c: 100000 } },
  { date: '2026-02-01', holdings: { S1: 150000, B1: 50000 }, cash: { c: 0 } },
], S);
ok(comp.length === 2, '两期');
near(comp[0].pct['现金'], 0.5, 1e-9, '★ 结构图里没有现金这一类');
near(comp[1].pct['现金'], 0, 1e-9, '现金花完了应该是 0');
near(comp[1].pct['股'], 0.75, 1e-9, '股的占比算错');

// ---- 8. 各类贡献:没有分类流水就不给 ----
var noFlow = Stats.contribution(
  [{ date: '2026-01-01', holdings: { S1: 100000 }, cash: {} },
   { date: '2026-02-01', holdings: { S1: 150000 }, cash: {} }], [], S);
ok(!noFlow.ok, '★ 没有分类流水却把总变化当成了涨跌');

// 有流水:投了 3 万,总共涨了 5 万 → 市场贡献 2 万
var withFlow = Stats.contribution(
  [{ date: '2026-01-01', holdings: { S1: 100000 }, cash: {} },
   { date: '2026-02-01', holdings: { S1: 150000 }, cash: {} }],
  [{ date: '2026-01-15', kind: 'buy', category: '股', amount: 30000 }], S);
ok(withFlow.ok, '有流水就该算得出来');
var row = withFlow.rows.filter(function (r) { return r.category === '股'; })[0];
near(row.inflow, 30000, 1, '申购算错');
near(row.market, 20000, 1, '★ 涨跌算错 —— 涨了 5 万里有 3 万是你自己投的');

if (fail) { console.log('  ' + fail + ' 条没过'); process.exit(1); }
console.log('  统计 ok(样本不够不给数 · 不满一年不年化 · XIRR 对上已知答案 · 申购不算收益)');
