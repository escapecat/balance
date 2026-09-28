// 同日盘点 → 完成 todo → 下一次盘点。仅使用合成金额,不落用户数据。
var assert = require('assert');
var mem = {}, failKey = null;
global.localStorage = {
  getItem: function (k) { return mem[k] === undefined ? null : mem[k]; },
  setItem: function (k, v) {
    if (k === failKey) { failKey = null; throw new Error('simulated storage failure'); }
    mem[k] = String(v);
  },
  removeItem: function (k) { delete mem[k]; },
  key: function (i) { return Object.keys(mem)[i] || null; },
  get length() { return Object.keys(mem).length; },
};
var Store = global.Store = require('../../app/lib/store.js');
global.Portfolio = require('../../app/core/portfolio.js');
var Actions = global.Actions = require('../../app/core/actions.js');
var Ledger = global.Ledger = require('../../app/core/ledger.js');
var Todos = require('../../app/core/todos.js');
var Stats = require('../../app/core/stats.js');
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function reset() { mem = {}; assert(Store.boot().ok); Actions.startFrom('2020-01-01'); }
function snap(date, held, cash) { return { date: date, holdings: { A: held }, cash: { c: cash } }; }
function plan(date) {
  Todos.sync({ today: [{ category: 'stock', fund: { code: 'A', name: 'Synthetic' }, amount: 20000 }] }, date, date);
}
function eq(actual, expected, message) { assert.deepStrictEqual(actual, expected, message); }

// 先盘点、再买:刚勾完不改写历史;现金和持仓下次同时录入才结算。
reset();
Ledger.commit(snap('2020-01-01', 100000, 100000));
Ledger.commit(snap('2020-02-01', 101000, 109000));
var snapshotsBefore = Store.get('snapshots');
var before = Ledger.delta(snapshotsBefore[1], snapshotsBefore[0]);
plan('2020-02-01');
assert(Todos.complete('buy:A', 20000, '2020-02-01').ok);
eq(Store.get('snapshots'), snapshotsBefore, '勾选不能伪造余额');
eq(Ledger.delta(snapshotsBefore[1], snapshotsBefore[0]), before, '同日盘点后的买入不能影响上一段收益');
eq(Actions.between(snapshotsBefore[1], null).length, 1, '同日交易必须显示待对账');
eq(Ledger.perFund(snapshotsBefore[1], snapshotsBefore[0])[0].market, 1000);
var flow = Actions.all()[0];
assert(Todos.complete('buy:A', 21000, '2020-02-03').ok);
eq(Actions.all()[0].id, flow.id, '改金额保留 id');
eq(Actions.all()[0].date, flow.date, '改金额不移动成交日期');
assert(Todos.complete('buy:A', 20000, '2020-02-03').ok);
Ledger.commit(snap('2020-03-01', 124000, 94000)); // 真实涨了三千,外部流入五千
var ss = Store.get('snapshots'), delta = Ledger.delta(ss[2], ss[1]);
eq([delta.market, delta.inflow, delta.netBuy], [3000, 5000, 20000]);
eq(Ledger.perFund(ss[2], ss[1])[0].market, 3000);
eq(Actions.between(ss[2], null).length, 0);
var contribution = Stats.contribution(ss, Actions.all(), { funds: [{ code: 'A', category: 'stock' }] });
eq(contribution.rows[0].market, 3000, '分类收益与逐只/总收益共用同一边界');
assert(Stats.twr(ss).ok && Stats.xirr(ss).ok);

// 同一个稳定 todo 在下一期再完成,不能删掉上一期买入;撤销也只影响本轮。
plan('2020-03-01');
assert(Todos.complete('buy:A', 10000, '2020-03-01').ok);
eq(Actions.all().length, 2);
eq(Ledger.delta(ss[2], ss[1]), delta);
eq(Stats.contribution(ss, Actions.all(), { funds: [{ code: 'A', category: 'stock' }] }).rows[0].market, 3000,
   '尚未对账的买入不能漏进分类收益');
assert(Todos.undo('buy:A').ok);
eq(Actions.all().length, 1, '不能撤销上一轮真实买入');
eq(Ledger.delta(ss[2], ss[1]), delta);

// 先交易再录当天余额:应该计入这期,且交易仅计一次。买卖/分红同一规则。
['buy', 'sell', 'dividend'].forEach(function (kind) {
  reset(); Ledger.commit(snap('2020-01-01', 100000, 100000));
  Actions.add({ date: '2020-02-01', kind: kind, code: 'A', amount: 20000 });
  var sign = kind === 'buy' ? 1 : -1;
  Ledger.commit(snap('2020-02-01', 100000 + sign * 20000, 100000 - sign * 20000));
  var rows = Store.get('snapshots'), d = Ledger.delta(rows[1], rows[0]);
  eq([d.market, d.inflow], [0, 0], kind + '不能产生收入或盈亏');
  eq(Actions.between(rows[1], null).length, 0);
});

// 同日重录:默认保持旧边界;明确确认余额已包含买卖才覆盖边界。
reset(); Ledger.commit(snap('2020-01-01', 100000, 100000));
Ledger.commit(snap('2020-02-01', 100000, 100000));
Actions.add({ date: '2020-02-01', kind: 'buy', code: 'A', amount: 20000 });
var prev = Store.get('snapshots')[1];
var corrected = Ledger.build({ holdings: { A: 120000 }, cash: { c: 80000 } }, prev, prev.date).snapshot;
eq(corrected.actionIds, [], '不能把仅修正原盘点当作确认到账');
corrected.actionIds = Actions.capture(corrected.date);
Ledger.commit(corrected);
eq(Store.get('snapshots').length, 2, '同日覆盖不新增一期');
eq(Actions.between(corrected, null).length, 0);
eq(Ledger.delta(corrected, Store.get('snapshots')[0]).market, 0);
var capturedId = Actions.all()[0].id;
Actions.remove(capturedId);
Actions.add({ date: corrected.date, kind: 'buy', code: 'A', amount: 1000 });
assert(Actions.all()[0].id !== capturedId, '已被盘点引用的 id 不能复用');
eq(Actions.between(corrected, null).length, 1, '同日第二轮交易仍待对账');

// 旧数据升级:只有明确关联当日盘点 todo 的记录才自动纠正,原值一字不改。
var legacy = { version: 1, data: {
  snapshots: [snap('2020-01-01', 100000, 100000), snap('2020-02-01', 99000, 111000)],
  flows: [{ id: 'f1', date: '2020-02-01', kind: 'buy', code: 'A', category: 'stock', amount: 20000, todoId: 'buy:A' }],
  todos: [{ id: 'buy:A', kind: 'buy', code: 'A', category: 'stock', target: 20000, actual: 20000,
            status: 'done', doneAt: '2020-02-01', lastSnap: '2020-02-01' }],
  prefs: { actionsSince: '2020-01-01' }, settings: {}, assets: [],
} };
mem = {};
Object.keys(legacy.data).forEach(function (k) { Store.set(k, legacy.data[k]); });
assert(Store.boot().ok);
eq(Store.getRollback().version, 1);
eq(Store.getRollback().data, legacy.data, '保留完整升级前回滚点');
var upgraded = Store.exportAll();
eq(upgraded.version, 2, '新版同步文件必须阻止旧代码按旧规则读取');
upgraded.data.snapshots.forEach(function (s, i) {
  var originalFields = clone(s); delete originalFields.actionIds;
  eq(originalFields, legacy.data.snapshots[i], '不能修改任何原始余额');
});
eq(upgraded.data.flows[0].afterSnapshot, '2020-02-01');
eq(upgraded.data.flows[0].planDate, '2020-02-01');
var f = clone(upgraded.data.flows[0]); delete f.afterSnapshot; delete f.planDate;
eq(f, legacy.data.flows[0], '实际交易保留全部原字段');
eq(Ledger.delta(upgraded.data.snapshots[1], upgraded.data.snapshots[0]).market, -1000);
eq(Store.boot().migrated, [], '升级只跑一次');
eq(Store.exportAll().data, upgraded.data);
reset(); Store.importAll(legacy);
eq(Store.exportAll().data, upgraded.data, '旧云端同步/手动导入也必须走迁移');
reset(); Store.importAll(upgraded);
eq(Store.exportAll().data, upgraded.data, '新版跨设备往返保留对账边界');
assert(!Store.inspectImport({ version: 3, data: {} }).ok);
assert(!Store.inspectImport({ version: 2, data: legacy.data }).ok, '新版缺边界不能猜');
assert(Store.rollback().ok);
assert(Store.rollback().ok);
eq(Store.exportAll().data.snapshots, upgraded.data.snapshots);

// 升级/导入写失败:旧数据和版本一起恢复,不能半份新半份旧。
var old = Store.exportAll();
failKey = 'balance:flows';
assert.throws(function () { Store.importAll(legacy); }, /保存/);
eq(Store.exportAll().data, old.data);
eq(Store.exportAll().version, old.version);
console.log('  对账边界 ok(先录后买 · 先买后录 · 同日重录 · 次月不重不漏 · 修改撤销 · 升级同步回滚)');
