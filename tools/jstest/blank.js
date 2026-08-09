// 留空 ≠ 0 —— **这个文件守的是那次「提交一下把数据库清零」的事故。**
//
// ⚠️ 录入页上一个空白的输入框有两种可能的意思:
//      「这项我没抄,沿用上次」   ← 绝大多数情况
//      「这项清仓了,现在是 0」   ← 罕见,但必须表达得出来
//    把前者当成后者,一次提交就能把整个组合抹平,而且**每个数字看着都合理**。
//
// ⚠️ 最容易写出这个 bug 的地方是 `Number(x) || 0` 和 `x || 0` ——
//    它们把空串、null、undefined、NaN **全部**变成 0,一行代码四种错。
//    tools/check.sh 有一条 grep 直接禁掉这两种写法。
//
// ⚠️ 草稿往返也要测:手机上抄一半切走,草稿序列化再读回来,
//    留空**仍然得是留空**。JSON.stringify 会把 undefined 吃掉,
//    读回来变成「这个键不存在」—— 如果那时候再兜底成 0,就绕回同一个坑。

var path = require('path');
var A = path.join(__dirname, '..', '..', 'app');
global.Portfolio = require(path.join(A, 'core', 'portfolio.js'));
var Ledger = require(path.join(A, 'core', 'ledger.js'));

var fail = 0;
function ok(c, m) { if (!c) { console.log('  FAIL ' + m); fail++; } }

// ---- 1. parse:只有真·空才算空 ----
[undefined, null, '', '   ', 'abc', NaN].forEach(function (v) {
  ok(Ledger.parse(v) === Ledger.EMPTY, JSON.stringify(v) + ' 应该算「没填」');
});
ok(Ledger.parse(0) === 0, '数字 0 是显式的零,不是没填');
ok(Ledger.parse('0') === 0, '字符串 "0" 是显式的零,不是没填');
ok(Ledger.parse('1,234') === 1234,           // check:money-ok 这是在测千分位解析
   '带千分位的也要认 —— 从基金 app 复制粘贴常带逗号');
ok(Ledger.parse(-500) === -500, '负数照原样返回,拒不拒由 build 决定');

// ---- 2. build:留空沿用上次,显式 0 清仓 ----
var prev = { holdings: { A: 100, B: 200, C: 300 }, cash: { 现金: 50 }, external: {} };
var r = Ledger.build({ holdings: { A: '150', B: '', C: '0' }, cash: {}, netInflow: '' },
                     prev, '2026-08-09');
ok(r.ok, '正常输入被拒了:' + r.errors.join(' '));
ok(r.snapshot.holdings.A === 150, 'A 填了 150 却没记上');
ok(r.snapshot.holdings.B === 200,
   '★ B 留空,应该沿用上次的 200,实际是 ' + r.snapshot.holdings.B +
   ' —— 留空当成 0 的话,一次提交就把整个组合抹平了');
ok(r.snapshot.holdings.C === 0, '★ C 显式填 0 应该记成 0(清仓),实际 ' + r.snapshot.holdings.C);
ok(r.snapshot.cash.现金 === 50, '整个 cash 都没提到,应该沿用上次');

// ---- 3. 上一期有、这一期没提到的键不许消失 ----
var r2 = Ledger.build({ holdings: { A: '150' } }, prev, '2026-08-09');
ok(r2.snapshot.holdings.B === 200 && r2.snapshot.holdings.C === 300,
   '★ 这一期只提到 A,B/C 就消失了 —— 总额少一块,你只会以为是市场跌了');

// ---- 4. 拒负 ----
var r3 = Ledger.build({ holdings: { A: '-100' } }, prev, '2026-08-09');
ok(!r3.ok && /负数/.test(r3.errors.join('')), '负持仓没被拒');
ok(r3.snapshot.holdings.A === undefined, '被拒的值还是写进去了');

// ---- 5. 浮点残渣 clamp ----
var r4 = Ledger.build({ holdings: { A: 0.0000001 } }, prev, '2026-08-09');
ok(r4.snapshot.holdings.A === 0,
   '0.0000001 没被 clamp 成 0 —— 「已清仓」会永远挂在列表里,而且显示成 0');

// ---- 6. 净投入**可以是负的** ----
var r5 = Ledger.build({ netInflow: '-30000' }, prev, '2026-08-09');
ok(r5.ok && r5.snapshot.netInflow === -30000,
   '净投入不许为负的话,取钱出来这件事就记不了了');

// ---- 7. ★ 草稿往返之后,留空仍然是留空 ----
// JSON.stringify 会把 undefined 吃掉,读回来那个键就不存在了。
// 这时候要是兜底成 0,就绕回第 2 条那个坑 —— 而且只在「切走再回来」时才发生。
var draft = { holdings: { A: '150', B: '', C: undefined }, cash: {}, netInflow: '' };
var back = JSON.parse(JSON.stringify(draft));
var r6 = Ledger.build(back, prev, '2026-08-09');
ok(r6.snapshot.holdings.B === 200 && r6.snapshot.holdings.C === 300,
   '★ 草稿存取一个来回之后,留空变成了 0 —— 手机上抄一半切走再回来就中招');

// ---- 8. append:同一天替换,不追加两条 ----
var list = Ledger.append([], { date: '2026-07-30', holdings: {} });
list = Ledger.append(list, { date: '2026-08-09', holdings: {} });
list = Ledger.append(list, { date: '2026-08-09', holdings: { A: 1 } });
ok(list.length === 2, '同一天录两次应该是替换,实际有 ' + list.length + ' 条');
ok(list[1].holdings.A === 1, '同一天的第二次录入没覆盖掉第一次');
ok(Ledger.latest(list).date === '2026-08-09', 'latest 拿错了');

// ---- 9. delta:涨跌和申购必须分开 ----
//
// 夹具是编的整数 —— 仓库公开,真实金额一分钱不进来。
// 挑的这组有意思:总额涨了 6 万,但其中投进去 10 万、市场亏了 4 万。
// 不分开的话你会以为赚了 6 万,实际是亏了 4 万。
var d = Ledger.delta(
  { holdings: { A: 1060000 }, cash: {}, netInflow: 100000 },
  { holdings: { A: 1000000 }, cash: {} });
ok(d.change === 60000, '总额变化算错:' + d.change);
ok(d.inflow === 100000 && d.market === -40000,
   '★ 涨跌和申购没分开 —— 总额涨了 6 万,是赚的还是又投的?' +
   '不分开的话这个问题永远没有答案(实际 涨跌=' + d.market + ')');

// ---- 10. ★ 没记净投入时,涨跌必须是「不知道」,不是 0 ----
// 迁移进来的历史几期正好都没有 netInflow。写成 `snap.netInflow || 0` 的话,
// 整段变化会全算成涨跌 —— 上面那组就会显示成「赚了 6 万」,
// 而实际是亏了 4 万。一条完全虚假的收益曲线,每个数字看着都合理。
var d2 = Ledger.delta({ holdings: { A: 1060000 }, cash: {} },
                      { holdings: { A: 1000000 }, cash: {} });
ok(d2.change === 60000, '总额变化还是要算的');
ok(d2.inflow === null && d2.market === null,
   '★ 没记净投入却报出了涨跌 ' + d2.market + ' —— 那是编的。' +
   '宁可写「涨跌未知」,也不给一个错的数');

console.log(fail ? '留空语义 ' + fail + ' 处不对'
                 : '  留空语义 ok(留空沿用 · 显式 0 清仓 · 草稿往返不变 · 涨跌与申购分开)');
process.exit(fail ? 1 : 0);
