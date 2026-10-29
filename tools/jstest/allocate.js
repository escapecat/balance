// Allocation contract changed intentionally: proportional budgets, not unlimited-first.
// Old limits were removed in 350d448 while the old allocator still double-budgeted cash.
var assert = require('assert/strict'), seed = require('./_strategyseed'), harness = require('./_dom');
var ctx = harness.makeCtx(seed()), P = ctx.Portfolio, A = ctx.Allocate, T = ctx.Trading;
var settings = ctx.Config.get(), snap = ctx.Ledger.latest(ctx.Store.get('snapshots')), date = snap.date;
var clone = function (v) { return JSON.parse(JSON.stringify(v)); };
var plan = function (s, st, fs) { return A.planMonthly(s || snap, st || settings, date, fs || []); };
var crypto = require('crypto');
['', 'abc', '核实纳指额度🙂', 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(65), JSON.stringify(seed())].forEach(function (v) {
  assert.equal(ctx.Fingerprint.hash(v), 'sha256:' + crypto.createHash('sha256').update(v).digest('hex'));
});
assert.equal(A.contextKey(snap, settings).length, 71);
function invariant(p, st, s) {
  assert.equal(p.spentToday + p.pendingAmount, p.budget);
  assert.equal(p.restrictedAmount, p.pendingAmount);
  assert(p.spentToday <= p.cashAvailable);
  assert(p.budget <= p.cashAvailable);
  assert(p.cashLeft >= s.cash.c - P.investableCash(s, st));
  p.rows.forEach(function (r) { assert(r.today <= r.budget && r.budget <= r.need); });
}
var p = plan();
assert.equal(p.budget, 20000); assert.equal(p.spentToday, 4100); assert.equal(p.restrictedAmount, 15900);
assert.equal(p.today[0].amount, 100); assert.equal(p.today[1].amount, 4000);
assert.equal(p.daily.length, 0); assert.equal(p.daysNeeded, null);
assert(!p.today.some(function (r) { return r.category === '其他'; }), 'Overweight assets never receive monthly buys');
invariant(p, settings, snap);
['unknown', 'paused'].forEach(function (status) {
  var s = clone(settings); s.funds[0].trade.status = status;
  var p = plan(null, s); assert.equal(p.spentToday, 4000); assert.equal(p.restrictedAmount, 16000); invariant(p, s, snap);
});
[0, 100, 20000].forEach(function (cap) {
  var s = clone(settings); s.funds[0].trade.dailyLimit = cap;
  assert.equal(plan(null, s).rows[0].today, Math.min(16000, cap));
});
var old = clone(settings); delete old.funds[0].trade; old.funds[0].dailyLimit = 99999;
assert.equal(plan(null, old).rows[0].today, 0, 'Legacy limits must not imply current availability');
var stale = clone(settings); stale.funds[0].trade.checkedOn = '2026-10-29';
assert.equal(plan(null, stale).rows[0].today, 100, 'A stale optional note must not disable the entered limit');
var optional = clone(settings); delete optional.funds[0].trade.platform; delete optional.funds[0].trade.checkedOn;
assert.equal(plan(null, optional).rows[0].today, 100, 'Platform and review date are not trading prerequisites');
assert(T.valid({ status: 'open' })); assert(T.valid({ status: 'limited', dailyLimit: 100 }));
assert(!T.valid({ status: 'limited' })); assert(!T.valid({ status: 'limited', dailyLimit: -1 }));
var used = clone(settings); Object.assign(used.funds[0].trade, { usedDate: date, usedAmount: 20 });
assert.equal(plan(null, used, [{ date: date, code: '111111', kind: 'buy', amount: 30 }]).rows[0].today, 50);
assert.equal(plan(null, used, [{ date: date, code: '111111', kind: 'buy', amount: 500 }]).rows[0].today, 0);
var wait = clone(settings); wait.cashBuckets = { c: { role: 'investable', settleDays: 2 } };
var wp = plan(null, wait); assert.equal(wp.spentToday, 4100); invariant(wp, wait, snap);
wait.cashBuckets.c.role = 'buffer'; assert.equal(plan(null, wait).cashAvailable, 20000, 'Removed bucket rules must not silently reserve cash');
var floor = clone(settings); floor.cashFloor = 100000; assert.equal(plan(null, floor).budget, 0);
var invalid = clone(settings); invalid.targets.纳指 = 'bad';
assert(plan(null, invalid).invalid); assert.equal(plan(null, invalid).today.length, 0);
invalid = clone(settings); invalid.targets.纳指 = 0.9;
assert(A.planAnnual(snap, invalid, date).invalid);
assert.equal(A.suggestMode(snap, settings).mode, 'monthly');
var dry = clone(snap); dry.cash.c = 0;
assert.equal(A.suggestMode(dry, settings).mode, 'none', 'Cash depletion must never automatically trigger selling');
var selected = clone(settings);
selected.funds.push({ code: '444444', category: '纳指', trade: { status: 'open', platform: '合成平台', checkedOn: date } });
assert.equal(plan(null, selected).rows[0].today, 100, 'Do not auto-switch to the unlimited alternate');
selected.buyFundByCategory = { 纳指: '444444' }; assert.equal(plan(null, selected).rows[0].today, 16000);
selected.buyFundByCategory.纳指 = 'missing'; assert.equal(plan(null, selected).rows[0].today, 0, 'An explicit but invalid route must fail closed');
var annual = clone(snap); annual.holdings = { '111111': 300000, '222222': 250000, '333333': 400000 }; annual.cash.c = 50000;
var ap = A.planAnnual(annual, settings, date);
assert.equal(ap.sells.length, 1); assert.equal(ap.sells[0].amount, 150000);
assert.equal(ap.buys.reduce(function (n, r) { return n + r.amount; }, 0), 150000);
assert(ap.buys.every(function (r) { return r.executable === false; }));
var locked = clone(settings); locked.locked = [{ fundCode: '111111', amount: 280000, unlockDate: '2027-01-01' }];
var lp = A.planAnnual(annual, locked, date); assert.equal(lp.amount, 20000); assert(lp.skipped.length);
assert.equal(A.planAnnual(annual, locked, '2027-01-02').amount, 150000);
var calm = clone(annual); calm.holdings = { '111111': 150000, '222222': 250000, '333333': 550000 };
assert(A.planAnnual(calm, settings, date).inBand);
// Reproducible sweep exercises rounding and tight cash, no stochastic test failures.
for (var i = 1; i <= 160; i++) {
  var st = clone(settings), s = clone(snap); s.cash.c = 50000 + i * 139; s.holdings['333333'] = 550000 + i * 337;
  st.funds[0].trade.dailyLimit = i % 11; invariant(plan(s, st), st, s);
}
assert.equal(T.isDate('2027-02-29'), false); assert.equal(T.isDate('2028-02-29'), true);
console.log('  Allocation ok: constrained budgets, zero/unknown, optional metadata, used quota, ignored legacy cash roles, cash floors, routes and annual locks');
