// 迁移 —— **只跑一次,而跑错了当场看不出来。**
//
// ⚠️ 金额类的迁移错误不会报错,只会变成一个看着合理的数字。
//    少搬一只基金、把两只并错、小数点错一位 —— 界面照样正常显示,
//    要等几个月后对不上账才发现,那时候已经没法回溯了。
//    所以这里拿**真实的每期总额**精确钉死,一分钱都不许差。
//
// ⚠️ 第 3 条守的是另一件事:老库**没有净投入**,迁进来必须是 null 不是 0。
//    填 0 的话「这期涨了几万」会被当成真涨跌,
//    于是一条完全虚假的收益曲线就诞生了,而每个数字看着都合理。
//
// ⚠️ **期望值不写在这个文件里** —— 仓库是公开的,那几个数是真实净资产。
//    它们在 %TEMP%/pf/expected.json,由 tools/mkbaseline.js 生成(人工核对过)。

var path = require('path');
var fs = require('fs');
var A = path.join(__dirname, '..', '..', 'app');
global.Portfolio = require(path.join(A, 'core', 'portfolio.js'));
var Ledger = require(path.join(A, 'core', 'ledger.js'));
var Store = require(path.join(A, 'lib', 'store.js'));

var fail = 0;
function ok(c, m) { if (!c) { console.log('  FAIL ' + m); fail++; } }

// 迁移产物在 /tmp 里,没有就跳过 —— 这条测试只在真跑过迁移之后才有意义。
// ⚠️ **跳过要说出来。** 静默跳过的测试和通过的测试长得一模一样,
//    而这个文件恰恰是「跑错了看不出来」的最后一道防线。
var DIR = path.join(process.env.TEMP || '/tmp', 'pf');
var CAND = [path.join(DIR, 'backup-keep.json'),
            path.join(__dirname, '..', '..', 'migration-check.json')];
var file = CAND.filter(function (p) { return fs.existsSync(p); })[0];
if (!file) {
  console.log('  迁移 —— 跳过(没找到迁移产物,跑一次 tools/migrate.py 再来)');
  process.exit(0);
}
var EXPF = path.join(DIR, 'expected.json');
if (!fs.existsSync(EXPF)) {
  console.log('  迁移 —— 跳过(没有 expected.json,跑一次 node tools/mkbaseline.js 再来)');
  process.exit(0);
}

var raw = JSON.parse(fs.readFileSync(file, 'utf8'));
var E = JSON.parse(fs.readFileSync(EXPF, 'utf8'));

// ---- 1. 备份格式本身要过校验(和线上导入走同一条路)----
var chk = Store.inspectImport(raw);
ok(chk.ok, '迁移出来的备份连导入校验都过不了:' + chk.why);

var snaps = raw.data.snapshots;

// ---- 2. ★ 每期总额精确钉死 ----
var EXPECT = E.snapshotTotals;
ok(snaps.length === E.snapshotCount, '应该是 ' + E.snapshotCount + ' 期,实际 ' + snaps.length);
snaps.forEach(function (s) {
  var want = EXPECT[s.date];
  if (want === undefined) { ok(false, '冒出来一期没见过的:' + s.date); return; }
  var got = Math.round(Portfolio.sum(s.holdings) + Portfolio.sum(s.cash));
  ok(got === Math.round(want),
     '★ ' + s.date + ' 的总额和基线差了 ' + (got - Math.round(want)) +
     ' —— 迁移只跑一次,这个数错了就再也发现不了');
});

// ---- 3. ★ 净投入必须是 null,不是 0 ----
var zeroed = snaps.filter(function (s) { return s.netInflow === 0; });
ok(zeroed.length === 0,
   '★ 有 ' + zeroed.length + ' 期的净投入被填成了 0 —— 老库根本没记这个。' +
   '填 0 的话整段变化会被当成涨跌,编出一条假的收益曲线');
snaps.forEach(function (s) {
  var prev = snaps[snaps.indexOf(s) - 1];
  if (!prev) return;
  var d = Ledger.delta(s, prev);
  ok(d.market === null,
     '★ ' + s.date + ' 报出了涨跌 ' + d.market + ',而这一期没有净投入记录 —— 那是编的');
});

// ---- 4. 配置搬全了 ----
var st = raw.data.settings || {};
ok(Object.keys(st.targets || {}).length === 6, '六大类目标比例没搬全');
ok(Math.abs(Object.keys(st.targets).reduce(function (a, k) { return a + st.targets[k]; }, 0) - 1)
   < 1e-9, '目标比例加起来不等于 1');
ok((st.funds || []).length >= 10, '基金清单没搬全,只有 ' + (st.funds || []).length + ' 只');
ok((st.funds || []).some(function (f) { return f.dailyLimit === 2000; }),
   '日限额没搬过来 —— 没有它,再平衡算不出「还要几个交易日」');
ok((st.locked || []).length >= 1, '锁仓持仓没搬 —— 年度再平衡会把锁着的也卖了');

// ---- 5. 每只基金都归得了类 ----
var known = {};
(st.funds || []).forEach(function (f) { known[f.code] = f.category; });
var orphan = [];
snaps.forEach(function (s) {
  Object.keys(s.holdings).forEach(function (c) { if (!known[c]) orphan.push(s.date + '/' + c); });
});
// ⚠️ 孤儿持仓**允许存在,但必须是你明确选过的**。
//    「你选了保留」和「悄悄混进来一条」是两回事:前者你知道那笔钱在哪,
//    后者会让总额对不上而你查不出原因。所以认 settings.unclassified 这份登记。
var acked = st.unclassified || [];
var un = orphan.filter(function (o) { return acked.indexOf(o.split('/')[1]) < 0; });
ok(un.length === 0,
   '★ 有没登记过的「未分类」持仓:' + un.join(' ') +
   ' —— 迁移必须停下来问,不许静默混进去');

console.log(fail ? '迁移 ' + fail + ' 处不对'
                 : '  迁移 ok(四期总额精确对上 · 净投入留 null 不编 0 · 配置搬全)');
process.exit(fail ? 1 : 0);
