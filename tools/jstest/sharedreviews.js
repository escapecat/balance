// A check records intent; only a trade authorization needs reconciled, recent balances.
var assert = require('assert/strict'), h = require('./_dom'), seed = require('./_strategyseed');
function copy(v) { return JSON.parse(JSON.stringify(v)); }
var date = '2026-10-30';
['half', 'annual'].forEach(function (kind) {
  ['recent-pending', 'stale-pending', 'stale'].forEach(function (scenario) {
    var data = seed(date); data.__meta.schema = 5;
    data.settings.reviewPolicy = { startDate: kind === 'half' ? '2026-04-30' : '2025-10-30', halfEnabled: true };
    if (scenario !== 'recent-pending') data.snapshots[0].date = '2026-09-01';
    if (scenario !== 'stale') data.flows = [{ id: 'already-bought', date: date, kind: 'buy', code: '111111', amount: 10, afterSnapshot: data.snapshots[0].date }];
    var c = h.makeCtx(data), snap = c.Ledger.latest(c.Store.get('snapshots')), settings = c.Config.get();
    var before = copy(c.Store.exportAll().data), decision = kind === 'half' ? 'checked' : 'no-trade';
    assert(c.Strategy.block(snap, date), 'Transaction gate remains closed for this scenario');
    assert.equal(c.Strategy.review('annual', 'approved', snap, settings, date).ok, false);
    assert(c.Strategy.review(kind, decision, snap, settings, date).ok, kind + ' check should reuse the existing snapshot');
    ['snapshots', 'flows', 'todos', 'settings'].forEach(function (key) { assert.deepEqual(copy(c.Store.get(key)), before[key]); });
    assert.equal(c.Strategy.reviews().length, 1);
    assert.equal(c.Strategy.review(kind, decision, snap, settings, date).ok, false, 'No duplicate check for the same cycle');
    assert(c.Strategy.block(snap, date), 'A recorded check never settles existing trades or refreshes an old balance');
    assert.equal(c.Strategy.approved(snap, settings, date), false);
  });
});
var d = seed(date); d.__meta.schema = 5; d.settings.reviewPolicy.startDate = '2026-04-30';
d.prefs.strategyApproval = { calendar: 'start-v1', base: '2026-04-30', date: date, dueDate: '2026-01-01', contextKey: 'prior' };
var c = h.makeCtx(d), approval = copy(c.Store.get('prefs').strategyApproval);
assert(c.Strategy.review('half', 'checked', c.Ledger.latest(c.Store.get('snapshots')), c.Config.get(), date).ok);
assert.deepEqual(copy(c.Store.get('prefs').strategyApproval), approval, 'A non-trading half check must not rewrite annual authorization');
console.log('  Shared reviews ok: one snapshot, pending/stale checks, no duplicate trades or checks, unchanged accounting and preserved trade gates');
