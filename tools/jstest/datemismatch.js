// 日期错配 —— **买卖的日期比快照晚,那笔投资会被算成花费。**
//
// ⚠️ 这条测的不是某个函数算错了,而是**两个正确的部件配在一起会骗人**:
//      Ledger.delta 的区间是 (上一期, 这一期]     —— 对的
//      记买卖固定用 today()                        —— 也是对的
//    可是快照的日期未必是今天(草稿留住了昨天的日期、或者你自己改过),
//    于是今天记的那笔买入掉到区间外。
//
// ⚠️ **错法是配对的,所以查不出来。**
//    现金的减少已经录进快照 → 「钱少了但没买东西」= 花费 −10000
//    持仓的增加没有对应记录 → 「持仓多了但没买」  = 市场涨 +10000
//    两个数一正一负,**总额完全对得上**,每个数字看着都合理。
//    2026-08-10 这个 bug 是用户问「我手动买了 10000 怎么变成我花了 10000」
//    才发现的 —— 我自己跑测试碰不到,因为夹具的日期都是我自己造的。

var path = require('path');
var mem = {};
global.Store = {
  get: function (k, d) { return mem[k] === undefined ? d : mem[k]; },
  set: function (k, v) { mem[k] = v; },
};
global.Portfolio = require(path.join(__dirname, '..', '..', 'app', 'core', 'portfolio.js'));
var Actions = global.Actions = require(path.join(__dirname, '..', '..', 'app', 'core', 'actions.js'));
var Ledger = require(path.join(__dirname, '..', '..', 'app', 'core', 'ledger.js'));

var fail = 0;
function ok(c, m) { if (!c) { console.log('  FAIL ' + m); fail++; } }

// 夹具的金额都是编的整数 —— 量级明显不真实(见 tools/check.sh 的金额守卫)
var PREV = {
  date: '2026-07-30',
  holdings: { '000216': 100000 },
  cash: { cash: 50000 },
};
var BUY = 10000;

function reset() {
  mem = {};
  mem.snapshots = [PREV];
  Actions.startFrom(PREV.date);
}

/** 从现金拿 BUY 买黄金:现金 −BUY,持仓 +BUY。真相是 inflow 0 · market 0。 */
function snapAfterBuy(date) {
  return {
    date: date,
    holdings: { '000216': PREV.holdings['000216'] + BUY },
    cash: { cash: PREV.cash.cash - BUY },
  };
}

// ---- 1. 日期对得上 → 两个数都是 0 ----
reset();
Actions.add({ date: '2026-08-10', kind: 'buy', code: '000216', category: '黄金', amount: BUY });
var d = Ledger.delta(snapAfterBuy('2026-08-10'), PREV);
ok(d.inflow === 0, '★ 日期对得上时「工资−花费」应该是 0,实际 ' + d.inflow);
ok(d.market === 0, '★ 日期对得上时「市场涨跌」应该是 0,实际 ' + d.market);

// ---- 2. ★ 快照日期比动作早 → 一笔投资变成一笔花费 ----
//
// 这一条**故意断言错误的行为**:它记录的是 delta 在数据自相矛盾时会怎样。
// 修的地方在录入页(存之前拦下来),而不是让 delta 去猜。
reset();
Actions.add({ date: '2026-08-10', kind: 'buy', code: '000216', category: '黄金', amount: BUY });
var bad = Ledger.delta(snapAfterBuy('2026-08-09'), PREV);
ok(bad.inflow === -BUY,
   '日期错配时 inflow 应该是 −' + BUY + '(这是 bug 的表现,不是期望)');
ok(bad.market === BUY, '日期错配时 market 应该是 +' + BUY);
ok(bad.change === bad.inflow + bad.market,
   '★ 两个错必须正好抵消 —— 总额对得上正是它查不出来的原因');

// ---- 3. ★ 录入页那道闸:有没有「晚于这一期」的动作 ----
//
// ⚠️ 这里复刻 ui/entry.js 的 lateActions 判据。UI 层测不到,
//    但**判据本身**必须钉住:漏了它,上面第 2 条就会在真实数据上重演。
function lateOnes(snapDate) {
  return Actions.between(PREV.date, null).filter(function (f) { return f.date > snapDate; });
}
reset();
Actions.add({ date: '2026-08-10', kind: 'buy', code: '000216', category: '黄金', amount: BUY });
ok(lateOnes('2026-08-09').length === 1, '★ 快照 08-09 时应该拦下那笔 08-10 的买入');
ok(lateOnes('2026-08-10').length === 0, '快照 08-10 时不该拦(日期对得上)');
ok(lateOnes('2026-08-11').length === 0, '快照比动作还晚,更不该拦');

// 选了「改成动作那天」之后,数字应该回到真相
var late = lateOnes('2026-08-09');
var fixed = Ledger.delta(snapAfterBuy(late[late.length - 1].date), PREV);
ok(fixed.inflow === 0 && fixed.market === 0,
   '★ 把快照日期改成动作那天之后,两个数应该都回到 0');

// ---- 4. 卖出方向也要对 ----
reset();
Actions.add({ date: '2026-08-10', kind: 'sell', code: '000216', category: '黄金', amount: BUY });
var sold = Ledger.delta({
  date: '2026-08-10',
  holdings: { '000216': PREV.holdings['000216'] - BUY },
  cash: { cash: PREV.cash.cash + BUY },
}, PREV);
ok(sold.inflow === 0, '★ 卖出后钱回到现金,「工资−花费」仍然是 0,实际 ' + sold.inflow);
ok(sold.market === 0, '★ 卖出不该产生市场涨跌,实际 ' + sold.market);

console.log(fail ? '  日期错配 ' + fail + ' 条没过'
                 : '  日期错配 ok(日期对得上算得对 · 错开时会骗人 · 闸拦得住)');
process.exit(fail ? 1 : 0);
