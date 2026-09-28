// 可选私有数据验证:只在内存里迁移,不输出金额,不写回备份/云端。
var file = process.env.BALANCE_VERIFY_SYNCED;
if (!file) { console.log('  同步实账验证跳过(未提供 BALANCE_VERIFY_SYNCED)'); process.exit(0); }
var assert = require('assert'), fs = require('fs');
var text = fs.readFileSync(file, 'utf8'), original = JSON.parse(text), mem = {};
global.localStorage = {
  getItem: function (k) { return mem[k] === undefined ? null : mem[k]; },
  setItem: function (k, v) { mem[k] = String(v); },
  removeItem: function (k) { delete mem[k]; },
  key: function (i) { return Object.keys(mem)[i] || null; },
  get length() { return Object.keys(mem).length; },
};
var Store = global.Store = require('../../app/lib/store.js');
var Portfolio = global.Portfolio = require('../../app/core/portfolio.js');
var Actions = global.Actions = require('../../app/core/actions.js');
var Ledger = require('../../app/core/ledger.js');
Object.keys(original.data).forEach(function (k) { Store.set(k, original.data[k]); });
Store.set('__meta', { schema: original.version });
assert(Store.boot().ok);
var after = Store.exportAll();
original.data.snapshots.forEach(function (s, i) {
  Object.keys(s).forEach(function (k) { assert.deepStrictEqual(after.data.snapshots[i][k], s[k]); });
});
original.data.flows.forEach(function (f, i) {
  Object.keys(f).forEach(function (k) { assert.deepStrictEqual(after.data.flows[i][k], f[k]); });
});
['todos', 'settings', 'assets', 'prefs'].forEach(function (k) {
  assert.deepStrictEqual(after.data[k], original.data[k]);
});
var snaps = after.data.snapshots, last = snaps[snaps.length - 1];
var pending = Actions.between(last, null);
var deferred = pending.filter(function (f) { return f.afterSnapshot === last.date; });
var interval = Actions.between(snaps[snaps.length - 2], last);
assert(deferred.every(function (f) { return !interval.some(function (x) { return x.id === f.id; }); }));
// 假设下次盘点仅反映这些交易、没有新收入/市场波动,买卖不能凭空产生盈亏。
var next = JSON.parse(JSON.stringify(last));
next.date = last.date.slice(0, 4) + '-12-31'; next.actionIds = [];
assert(next.date > last.date);
var cash = Portfolio.sum(last.cash);
pending.forEach(function (f) {
  if (!Actions.MONEY[f.kind]) return;
  var amount = (f.kind === 'buy' ? 1 : -1) * f.amount;
  next.holdings[f.code] = (next.holdings[f.code] || 0) + amount;
  cash -= amount;
});
next.cash = { verification: cash };
var d = Ledger.delta(next, last);
assert(Math.abs(d.market) < 0.01 && Math.abs(d.inflow) < 0.01);
assert.deepStrictEqual(Store.exportAll().data, after.data);
assert.strictEqual(fs.readFileSync(file, 'utf8'), text, '原同步备份不得修改');
console.log('  同步实账验证通过:原余额/交易/设置全部保留; ' + deferred.length +
            ' 笔同日交易待对账; 模拟下一期无重复、无虚构盈亏; 私有文件未改动');
