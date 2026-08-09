// 待办 —— **id 跨期稳定、resolved≠done、partial 不消失。**
//
// ⚠️ 这三条都是「看代码看不出、跑一遍才暴露」的那类。
//    id 含日期的话:每期都是新待办,「挂了 44 天」永远显示 0 —— 而代码读起来完全正常。
//    resolved 记成 done 的话:统计里「说了做了多少」偏高,而偏高的方向
//    恰好是让你看起来比实际更自律,于是不会有人怀疑。
//    partial 记成 done 的话:没投完的那一截从此没人再提,静默消失。

var path = require('path');
var A = path.join(__dirname, '..', '..', 'app');

var mem = {};
global.Store = {
  get: function (k, d) { return mem[k] === undefined ? d : mem[k]; },
  set: function (k, v) { mem[k] = v; },
  remove: function (k) { delete mem[k]; },
};
global.Actions = require(path.join(A, 'core', 'actions.js'));
var Todos = require(path.join(A, 'core', 'todos.js'));

var fail = 0;
function ok(c, m) { if (!c) { console.log('  FAIL ' + m); fail++; } }
function get(id) { return Todos.all().filter(function (t) { return t.id === id; })[0]; }

var GOLD = { category: '黄金', fund: { code: '000216', name: '华安黄金' }, amount: 60000 };
var SP = { category: '标普500', fund: { code: '018738', name: '博时标普500' },
           amount: 160000, perDay: 2000, days: 80 };

// ---- 1. id 不含日期不含金额 ----
mem.todos = []; mem.flows = [];
Todos.sync({ today: [GOLD], daily: [SP] }, '2026-06-26', '2026-06-26');
ok(get('buy:000216'), 'id 应该是 buy:000216');
ok(Todos.all().length === 2, '两条待办');
ok(get('buy:000216').bornAt === '2026-06-26', 'bornAt 记的是第一次出现那天');

// ---- 2. 换了一期、金额变了,bornAt 不许动 ----
//
// 这就是「挂了多久」的全部依赖。id 里含日期的话这条必挂。
Todos.sync({ today: [{ category: '黄金', fund: GOLD.fund, amount: 40000 }], daily: [SP] },
           '2026-07-30', '2026-07-30');
var g = get('buy:000216');
ok(Todos.all().length === 2, '还是两条 —— 不该长出新的');
ok(g.bornAt === '2026-06-26', 'bornAt 必须还是 6/26(实得 ' + g.bornAt + ')');
ok(g.target === 40000, '金额跟着重算');
ok(Todos.pendingDays(g, '2026-08-09') === 44, '挂了 44 天(实得 ' +
   Todos.pendingDays(g, '2026-08-09') + ')');

// ---- 3. 计划里没了 → resolved,**不是 done** ----
Todos.sync({ today: [], daily: [SP] }, '2026-08-09', '2026-08-09');
g = get('buy:000216');
ok(g.status === 'resolved', '缺口被涨平了应该是 resolved(实得 ' + g.status + ')');
ok(g.actual === null, 'resolved 的没有实际金额 —— 因为你根本没买');
ok(Todos.flows().length === 0, 'resolved 不许写现金流');
ok(Todos.pendingDays(g, '2026-08-09') === null, 'resolved 的不算「挂着」');

// ---- 4. 勾选 → 写 flow ----
mem.todos = []; mem.flows = [];
Todos.sync({ today: [GOLD] }, '2026-07-30', '2026-07-30');
var r = Todos.complete('buy:000216', 60000, '2026-08-01');
ok(r.ok && r.status === 'done', '足额 → done');
ok(Todos.flows().length === 1, '勾选必须写一条现金流 —— 这是收益率的唯一来源');
ok(Todos.flows()[0].amount === 60000 && Todos.flows()[0].category === '黄金',
   '现金流带着类别和金额');

// ---- 5. 没填金额不许勾掉 ----
mem.todos = []; mem.flows = [];
Todos.sync({ today: [GOLD] }, '2026-07-30', '2026-07-30');
ok(!Todos.complete('buy:000216', null, '2026-08-01').ok, '不填金额勾不掉');
ok(!Todos.complete('buy:000216', 0, '2026-08-01').ok, '0 也不行 —— 真没做该用「不做了」');
ok(Todos.flows().length === 0, '失败的勾选不许留下现金流');

// ---- 6. partial:投了一半,下一期还在 ----
Todos.complete('buy:000216', 20000, '2026-08-01');
ok(get('buy:000216').status === 'partial', '20000 < 60000 → partial');
// 同一期内再渲染一次,不许自己变回没勾过
Todos.sync({ today: [GOLD] }, '2026-07-30', '2026-08-01');
ok(get('buy:000216').status === 'partial' && get('buy:000216').actual === 20000,
   '同一期内 partial 和已填金额都得留着');
Todos.sync({ today: [{ category: '黄金', fund: GOLD.fund, amount: 40000 }] },
           '2026-08-09', '2026-08-09');
g = get('buy:000216');
ok(g.status === 'open', 'partial 下一期回到清单(实得 ' + g.status + ')');
ok(g.actual === null, '上期填的金额过期了 —— 新 target 已经是剩下那截,留着会打架');
ok(g.target === 40000, '金额是剩下那截');
ok(g.bornAt === '2026-07-30', 'partial 的 bornAt 不许重置 —— 这笔一直欠着');

// ---- 7. 同一期内勾完不许自己变回来 ----
//
// 快照没变,计划就还是那份。不认「代」的话,下一次渲染它就又是 open,
// 你会以为刚才那一下没生效 —— 然后再勾一次,现金流多出一条假的。
mem.todos = []; mem.flows = [];
Todos.sync({ today: [GOLD] }, '2026-07-30', '2026-07-30');
Todos.complete('buy:000216', 60000, '2026-08-01');
Todos.sync({ today: [GOLD] }, '2026-07-30', '2026-08-02');     // 同一期又渲染一次
ok(get('buy:000216').status === 'done', '同一期内保持 done(实得 ' +
   get('buy:000216').status + ')');
ok(Todos.flows().length === 1, '不许多出一条现金流');

// ---- 7b. ★ 达标之后计划里又出现了 → 必须退回 open ----
//
// 界面上同时显示「买 中短债 ¥X」和「达标」是自相矛盾的:
// resolved 的意思就是「计划里没有这一条了」。
// 而**同一期内计划是会变的** —— 改一次现金保底,可投的钱变多,
// 某一类就重新进了清单。早先这里只按「换没换期」判断,于是状态卡住不动。
mem.todos = []; mem.flows = [];
Todos.sync({ today: [GOLD] }, '2026-07-30', '2026-08-09');
Todos.sync({ today: [] }, '2026-07-30', '2026-08-09');
ok(get('buy:000216').status === 'resolved', '计划里没了应该是 resolved');
Todos.sync({ today: [{ category: '黄金', fund: GOLD.fund, amount: 12345 }] },
           '2026-07-30', '2026-08-09');
var back = get('buy:000216');
ok(back.status === 'open',
   '★ 计划里又有了却还挂着「达标」—— 清单和状态互相打脸(实得 ' + back.status + ')');
ok(back.target === 12345, '金额跟着新计划走');
ok(Todos.flows().length === 0, '这一来一回不许产生现金流');

// 对比:done **不能**因为同一期重算就退回 open ——
// 那会让你以为刚才勾的那一下没生效,再勾一次就多一条假流水
mem.todos = []; mem.flows = [];
Todos.sync({ today: [GOLD] }, '2026-07-30', '2026-08-09');
Todos.complete('buy:000216', 60000, '2026-08-09');
Todos.sync({ today: [{ category: '黄金', fund: GOLD.fund, amount: 999 }] },
           '2026-07-30', '2026-08-09');
ok(get('buy:000216').status === 'done',
   '★ 同一期内 done 被重算冲掉了(实得 ' + get('buy:000216').status + ')');

// ---- 8. 换一期之后是新一轮,bornAt 重置 ----
Todos.sync({ today: [{ category: '黄金', fund: GOLD.fund, amount: 30000 }] },
           '2026-08-30', '2026-08-30');
g = get('buy:000216');
ok(g.status === 'open', 'done 之后换一期 → 新的一轮');
ok(g.bornAt === '2026-08-30', '上一笔的账结清了,bornAt 重置(实得 ' + g.bornAt + ')');
ok(g.actual === null, '新一轮没有实际金额');

// ---- 9. 「不做了」永远不自动复活 ----
mem.todos = []; mem.flows = [];
Todos.sync({ today: [GOLD] }, '2026-07-30', '2026-07-30');
Todos.drop('buy:000216', '不需要', '2026-08-01');
Todos.sync({ today: [GOLD] }, '2026-08-30', '2026-08-30');
ok(get('buy:000216').status === 'dropped',
   '「不做了」是个决定不是遗漏 —— 不许每个月重新拒绝一次(实得 ' +
   get('buy:000216').status + ')');
ok(get('buy:000216').reason === '不需要', '理由留着');
ok(Todos.open().length === 0, 'dropped 不算欠着');

Todos.revive('buy:000216', '2026-09-01');
ok(get('buy:000216').status === 'open', '手动能让它回来');

// ---- 10. 卖出也走同一套 ----
mem.todos = []; mem.flows = [];
Todos.sync({ sells: [{ category: '红利低波', fund: { code: '007466', name: '红利' },
                       amount: 80000 }],
             buys: [{ category: '标普500', fund: SP.fund, amount: 50000 }] },
           '2026-08-09', '2026-08-09');
ok(get('sell:007466') && get('buy:018738'), '买卖各一条,id 前缀分得开');
Todos.complete('sell:007466', 80000, '2026-08-10');
ok(Todos.netByCategory()['红利低波'] === -80000,
   '卖出在累计流水里是负的(实得 ' + Todos.netByCategory()['红利低波'] + ')');

// ---- 勾选 / 改金额 / 撤销:一条待办**只对应一笔流水** ----
//
// ⚠️ 早先 complete 是无脑 append,于是界面上「改金额」变成了追加:
//    记一笔、改一次金额,flows[] 里就两条,净买入直接翻倍。
//    而待办上只显示最后那个金额 —— **清单看着完全正常**,
//    收益率却按双倍投入算,分母错了所有收益率跟着错。
//
// ⚠️ 撤销也必须把流水一起带走。只改状态的话,清单说你没做、
//    收益率说你投了,两边对不上而且没人报错。
(function () {
  mem = {};
  Store.set('todos', []);
  Store.set('flows', []);
  Actions.startFrom('2026-07-30');

  var plan = { today: [{ category: '黄金', fund: { code: '000216', name: '黄金基金' },
                         amount: 30000 }], daily: [] };
  Todos.sync(plan, '2026-07-30', '2026-08-10');
  var t = Todos.open()[0];

  Todos.complete(t.id, 20000, '2026-08-10');
  ok(Actions.all().length === 1, '★ 勾一次应该只有 1 条流水,实际 ' + Actions.all().length);

  Todos.complete(t.id, 25000, '2026-08-10');
  ok(Actions.all().length === 1,
     '★ 改金额是修正同一笔,不是又买一次 —— 流水应该还是 1 条,实际 ' +
     Actions.all().length);
  ok(Actions.netBuy('2026-07-30', '2026-08-31').total === 25000,
     '★ 净买入应该是改后的金额,实际 ' + Actions.netBuy('2026-07-30', '2026-08-31').total);

  var r = Todos.undo(t.id);
  ok(r.ok && r.removed === 1, '撤销应该删掉那 1 条流水,实际删了 ' + r.removed);
  ok(Actions.all().length === 0, '★ 撤销后不许留下流水 —— 清单说没做、收益率说投了');
  ok(Todos.all()[0].status === 'open' && Todos.all()[0].actual === null,
     '★ 撤销后待办要回到 open 且清掉实际金额');
})();

if (fail) { console.log('  ' + fail + ' 条没过'); process.exit(1); }
console.log('  待办 ok(id 跨期稳定 · bornAt 不漂 · resolved≠done · partial 不消失 · 勾选写流水 · 改金额不重复记 · 撤销带走流水)');
