// Account names belong to balance entry, not a second set of purpose/settlement settings.
var assert = require('assert/strict'), harness = require('./_dom'), seed = require('./_strategyseed');
function text(n) { return (n.text || '') + n.children.map(text).join(''); }
function all(n) { return [n].concat.apply([n], n.children.map(all)); }
function click(root, label) { var n = all(root).filter(function (x) { return x.tagName === 'BUTTON' && text(x).indexOf(label) >= 0; })[0]; assert(n); n.handlers.click[0](); }
var data = seed();
data.snapshots[0].cash = { cash: 10000, instant_buffer: 20000, moneymarket: 30000 };
data.settings.cashBuckets = { cash: { role: 'buffer', settleDays: 99 },
  instant_buffer: { role: 'buffer', settleDays: 365 }, moneymarket: { role: 'investable', settleDays: 2 },
  自定义备用金: { role: 'buffer', settleDays: 0 } };
var c = harness.makeCtx(data), root = new harness.El('div');
var before = JSON.stringify(c.Store.exportAll().data);
c.SettingsUI.mount(root, {});
click(root, '现金保留');
assert(!/现金用途|到账等待|instant_buffer|moneymarket|\bcash\b|日日宝|月月宝/.test(text(root)));
assert(text(root).includes('现金保底'));
var settings = c.Config.get(), snap = c.Ledger.latest(c.Store.get('snapshots'));
var withLegacy = c.Allocate.planMonthly(snap, settings, snap.date);
delete settings.cashBuckets;
var withoutLegacy = c.Allocate.planMonthly(snap, settings, snap.date);
assert.equal(withLegacy.budget, withoutLegacy.budget);
assert.equal(withLegacy.spentToday, withoutLegacy.spentToday);
assert.equal(withLegacy.cashAvailable, 10000);
assert.equal(c.Portfolio.bucketOf, undefined);
assert.equal(c.Portfolio.liquidNow, undefined);
assert.equal(c.Portfolio.pending, undefined);
c.EntryUI.mount(root, {});
while (!text(root).includes('日日宝')) click(root, '下一步');
['现金账户', '日日宝', '月月宝'].forEach(function (name) { assert(text(root).includes(name)); });
assert(!/\bcash\b|instant_buffer|moneymarket/.test(text(root)));
c.HistoryUI.mount(root, {});
assert(!/\bcash\b|instant_buffer|moneymarket/.test(text(root)));
assert.equal(JSON.stringify(c.Store.exportAll().data), before, 'Removing UI/rules must not rewrite financial data or legacy metadata');
assert.equal(c.Labels.cash('custom_cash'), 'custom_cash');
var backup = c.Store.exportAll();
var restored = harness.makeCtx();
restored.Store.importAll(backup);
assert.equal(JSON.stringify(restored.Store.exportAll().data), before, 'Existing cash keys and metadata survive backup round trips');
console.log('  Cash simplification ok: no account controls, old roles ignored, Chinese entry and unchanged balances/flows/backups');
