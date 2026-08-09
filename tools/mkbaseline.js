// 生成 e2e 的期望值基线 —— **不进仓库,因为里面是真金额。**
//
// ⚠️ 这个文件生成的是**基线**,不是「跑一遍存下来」。
//    直接把当前实现的输出存成期望值,等于把 bug 一起钉死 ——
//    以后哪怕算错了,测试也永远绿。
//
//    所以它**打印出来让你看**,并且要求你对着基金 app 核一遍再用。
//    第一版基线核过的是这几条:
//      · 每一类的缺口 = 目标比例 × 组合总额 − 当前持仓
//      · 清单上的数和「配置」表上显示的缺口**一模一样**
//      · 有日限额的:天数 = ceil(缺口 ÷ 日限额)
//      · 今天花掉的 = 无限额那几类的缺口之和(现金够的时候)
//
// ⚠️ 什么时候该重新生成:**只有在你确认口径变了**的时候
//    (比如这次把 cashFloor 从缺口基数里拿出来)。
//    测试变红的时候第一反应应该是「是不是我改错了」,
//    而不是重跑这个脚本把红的变绿 —— 那就等于没有测试。
//
// 用法:node tools/mkbaseline.js

var fs = require('fs');
var path = require('path');
var A = path.join(__dirname, '..', 'app');

var DIR = path.join(process.env.TEMP || '/tmp', 'pf');
var BK = path.join(DIR, 'backup-keep.json');
var OUT = path.join(DIR, 'expected.json');

if (!fs.existsSync(BK)) {
  console.log('没有 ' + BK + ' —— 先跑 python tools/migrate.py');
  process.exit(1);
}

var mem = {};
global.Store = {
  get: function (k, d) { return mem[k] === undefined ? d : mem[k]; },
  set: function (k, v) { mem[k] = v; },
  remove: function (k) { delete mem[k]; },
};
global.Portfolio = require(path.join(A, 'core', 'portfolio.js'));
global.Ledger = require(path.join(A, 'core', 'ledger.js'));
var Allocate = require(path.join(A, 'core', 'allocate.js'));

var real = JSON.parse(fs.readFileSync(BK, 'utf8')).data;
Object.keys(real).forEach(function (k) { mem[k] = real[k]; });

var snap = Ledger.latest(mem.snapshots);
var st = mem.settings;
var p = Allocate.planMonthly(snap, st);
var sm = Portfolio.summarize(snap, st);

var exp = { latestDate: snap.date, snapshotCount: mem.snapshots.length,
            snapshotTotals: {}, today: {}, daily: {}, spentToday: p.spentToday };
mem.snapshots.forEach(function (s) {
  exp.snapshotTotals[s.date] = Portfolio.sum(s.holdings) + Portfolio.sum(s.cash);
});
p.today.forEach(function (t) { exp.today[t.category] = t.amount; });
p.daily.forEach(function (d) { exp.daily[d.category] = { days: d.days, amount: d.amount }; });

// 自己先验一遍口径 —— 对不上就不该写出去。
//
// ⚠️ **「清单 = 配置表缺口」只在现金充足时成立。**
//    我一开始把它当成无条件的不变量,结果现金一变紧就整片误报。
//    现金不够时正确的不变量是另外两条:
//      · Σ今天买的 = 可投现金(一分不剩,也一分不超)
//      · 各类按缺口比例分,谁都不该被单独优待
var bad = [];
var tight = p.spentToday < p.cashAvailable - 1 ? false : true;
sm.rows.forEach(function (r) {
  if (r.isCash || r.unknown || r.gap == null || r.gap <= 1) return;
  var got = exp.today[r.category] != null ? exp.today[r.category]
          : (exp.daily[r.category] || {}).amount;
  if (got == null) { bad.push(r.category + ' 有缺口 ' + Math.round(r.gap) + ' 但清单上没有'); return; }
  if (!tight && got !== Math.round(r.gap)) {
    bad.push(r.category + ' 清单 ' + got + ' ≠ 配置表 ' + Math.round(r.gap));
  }
});
if (tight) {
  var listed = 0;
  Object.keys(exp.today).forEach(function (c) { listed += exp.today[c]; });
  if (Math.abs(listed - p.cashAvailable) > 2) {
    bad.push('现金紧的时候,今天买的合计应该正好等于可投现金(' +
             listed + ' vs ' + p.cashAvailable + ')');
  }
  // 比例:每一类拿到的应该是「它的缺口 ÷ 总缺口 × 可投现金」
  var totalGap = 0;
  sm.rows.forEach(function (r) {
    if (!r.isCash && !r.unknown && r.gap > 1) totalGap += r.gap;
  });
  sm.rows.forEach(function (r) {
    if (r.isCash || r.unknown || !(r.gap > 1)) return;
    var want = r.gap / totalGap * p.cashAvailable;
    var got2 = exp.today[r.category];
    if (got2 != null && Math.abs(got2 - want) > 2) {
      bad.push(r.category + ' 分到的和按缺口比例算的对不上(' +
               got2 + ' vs ' + Math.round(want) + ')');
    }
  });
}

console.log('');
console.log('基线(' + snap.date + ',' + exp.snapshotCount + ' 期):');
console.log('');
console.log('  每期总额');
Object.keys(exp.snapshotTotals).forEach(function (d) {
  console.log('    ' + d + '  ' + Math.round(exp.snapshotTotals[d]).toLocaleString());
});
console.log('');
console.log('  今天买');
Object.keys(exp.today).forEach(function (c) {
  console.log('    ' + c + '  ' + exp.today[c].toLocaleString());
});
console.log('  按日投');
Object.keys(exp.daily).forEach(function (c) {
  console.log('    ' + c + '  共 ' + exp.daily[c].amount.toLocaleString() +
              ',还要 ' + exp.daily[c].days + ' 天');
});
console.log('  今天合计  ' + exp.spentToday.toLocaleString());
console.log('');

if (bad.length) {
  console.log('✗ 清单和配置表对不上,**没有写出去**:');
  bad.forEach(function (b) { console.log('    ' + b); });
  process.exit(1);
}

console.log(tight ? '✓ 现金不够,按缺口比例分,合计正好花光可投现金。'
                  : '✓ 现金够,清单和配置表逐类一致。');
console.log('');
console.log('  ⚠️ 写出去之前**对着基金 app 核一遍**上面这几个数。');
console.log('     核过了就没事了;没核就写出去的话,以后测试永远绿,');
console.log('     而绿的原因是它在拿实现自己的输出考自己。');
console.log('');

fs.writeFileSync(OUT, JSON.stringify(exp, null, 1));
console.log('写到了 ' + OUT + '(不进仓库)');
