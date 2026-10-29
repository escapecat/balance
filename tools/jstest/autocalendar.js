// 合成日期：计时从首次盘点起，不从收益完整起点、最近盘点或旧年度输入推算。
var assert = require('assert/strict'), harness = require('./_dom'), seed = require('./_strategyseed');
function clone(v) { return JSON.parse(JSON.stringify(v)); }
var data = seed('2026-10-30');
data.settings.reviewPolicy = { annualDate: '2026-04-20', halfEnabled: true };
data.snapshots.unshift(Object.assign({}, clone(data.snapshots[0]), { date: '2026-04-20' }));
data.prefs.actionsSince = '2026-08-01';
var original = clone(data), c = harness.makeCtx(data), settings = c.Config.get();
var sc = c.Strategy.schedule(settings, '2026-09-30');
assert.equal(sc.startDate, '2026-04-20'); assert.equal(sc.halfDate, '2026-10-20'); assert.equal(sc.annualDate, '2027-04-20');
assert.equal(sc.halfDue, false); assert.equal(sc.annualDue, false);
assert.equal(c.Strategy.schedule(settings, '2026-10-20').halfDue, true);
assert.equal(c.Strategy.schedule(settings, '2027-04-20').annualDue, true);
['snapshots', 'flows', 'prefs', 'assets'].forEach(function (key) { assert.equal(JSON.stringify(c.Store.get(key)), JSON.stringify(original[key])); });
assert.equal(c.Store.getRollback().version, 4);
var calendarSettings = clone(c.Store.get('settings')); delete calendarSettings.reviewPolicy.startDate; delete calendarSettings.reviewPolicy.source;
assert.equal(JSON.stringify(calendarSettings), JSON.stringify(original.settings));
assert.equal(c.Store.exportAll().version, 5);
var backup = c.Store.exportAll(), reloaded = harness.makeCtx(Object.assign({}, backup.data, { __meta: { schema: backup.version } }));
assert.deepEqual(clone(reloaded.Strategy.schedule(reloaded.Config.get(), '2026-09-30')), clone(sc));
c.Ledger.removeSnapshot('2026-04-20');
assert.equal(c.Strategy.schedule(c.Config.get(), '2026-09-30').startDate, '2026-04-20', 'Deleting an early snapshot must not move the pinned clock');
// 首周年之前误点的旧检查不能跳过真正的首周年；旧记录仍完整保留。
data.prefs.strategyReviews = [{ kind: 'annual', decision: 'no-trade', date: '2026-09-01', dueDate: '2026-04-20', nextDate: '2027-04-20', base: '2026-04-20' }];
var early = harness.makeCtx(data);
assert.equal(early.Strategy.schedule(early.Config.get(), '2027-04-20').annualDue, true);
assert.equal(early.Strategy.reviews().length, 1);
// 真正完成过的旧检查继续有效，但周年从原始起点推算，不沿旧输入/闰年截断漂移。
data.prefs.strategyReviews.push({ kind: 'annual', decision: 'no-trade', date: '2027-04-22', dueDate: '2027-04-20', nextDate: '2028-04-22', base: '2026-04-20' });
var done = harness.makeCtx(data);
assert.equal(done.Strategy.schedule(done.Config.get(), '2027-04-23').annualDate, '2028-04-20');
assert.equal(done.Strategy.schedule(done.Config.get(), '2027-04-23').annualDue, false);
assert.equal(done.Strategy.schedule({ reviewPolicy: { startDate: '2024-02-29' } }, '2024-03-01').halfDate, '2024-08-29');
assert.equal(done.Strategy.schedule({ reviewPolicy: { startDate: '2024-02-29' } }, '2024-03-01').annualDate, '2025-02-28');
// 新账本首笔盘点自动固定起点；事务失败不丢余额、不留下半个设置。
var fresh = harness.makeCtx(), initial = clone(seed().snapshots[0]);
fresh.Ledger.commit(initial);
assert.equal(fresh.Config.get().reviewPolicy.startDate, initial.date);
var failing = harness.makeCtx(), storage = failing.localStorage, write = storage.setItem;
storage.setItem = function (key, value) { if (key === 'balance:snapshots') throw new Error('simulated snapshot failure'); return write(key, value); };
assert.throws(function () { failing.Ledger.commit(initial); });
assert.equal(failing.Store.get('settings'), null); assert.equal(failing.Store.get('snapshots'), null);
assert.equal(failing.Store.get('__meta').schema, 5);
assert.equal(c.Store.firstSnapshotDate([{ date: '2026-02-31' }, { date: '2026-03-02' }, { date: '2026-01-03' }]), '2026-01-03');
console.log('  Auto calendar ok: first snapshot, pinned clock, migration/export/reload, legacy checks, leap dates and failed-first-save rollback');
