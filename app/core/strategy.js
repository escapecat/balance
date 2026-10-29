// 日历、检查留痕和卖出授权。检查完成不是成交；唯一成交来源仍是 Actions。
var Strategy = (function () {
  function firstDate(snaps) {
    return Store.firstSnapshotDate(snaps);
  }
  function policy(s, snaps) {
    var p = s.reviewPolicy || {};
    var start = Trading.isDate(p.startDate) ? p.startDate : firstDate(snaps || Store.get('snapshots', []));
    return { startDate: start, annualDate: start ? addMonths(start, 12) : '', halfEnabled: p.halfEnabled !== false,
      legacyAnnualDate: Trading.isDate(p.annualDate) ? p.annualDate : '' };
  }
  function addMonths(date, months) {
    if (!Trading.isDate(date)) return '';
    var d = new Date(date + 'T12:00:00Z'), day = d.getUTCDate();
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + months);
    var end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, end)); return d.toISOString().slice(0, 10);
  }
  function reviews() {
    var list = (Store.get('prefs', {}) || {}).strategyReviews;
    return (Array.isArray(list) ? list : []).filter(function (r) {
      return r && (r.kind === 'half' || r.kind === 'annual') && Trading.isDate(r.date) && Trading.isDate(r.dueDate) && Trading.isDate(r.base) && (r.kind !== 'annual' || Trading.isDate(r.nextDate));
    });
  }
  function schedule(s, date) {
    var p = policy(s), cycle = 1, next = p.annualDate;
    function matches(r) { return r.base === p.startDate || r.base === p.legacyAnnualDate; }
    reviews().forEach(function (r) {
      // 旧误报产生的首个周年之前的检查保留在历史，但不跳过真正的首个周年。
      if (next && matches(r) && r.kind === 'annual' && r.dueDate >= p.annualDate && r.date >= r.dueDate && r.date <= date) {
        while (next <= r.date) { cycle++; next = addMonths(p.startDate, cycle * 12); }
      }
    });
    var half = p.halfEnabled && next ? addMonths(p.startDate, cycle * 12 - 6) : '';
    var checked = reviews().some(function (r) { return matches(r) && r.kind === 'half' && r.dueDate === half && r.date >= half && r.date <= date; });
    var approval = (Store.get('prefs', {}) || {}).strategyApproval, recheck = false;
    var sameApproval = approval && (approval.calendar === 'start-v1' ? approval.base === p.startDate : approval.base === p.legacyAnnualDate && approval.dueDate >= p.annualDate);
    if (sameApproval && next && approval.date <= date) {
      var items = (Store.get('todos', []) || []).filter(function (t) { return t.kind === 'sell' && t.contextKey === approval.contextKey; });
      var outstanding = !items.length || items.some(function (t) { return t.status === 'open' || t.status === 'partial' || t.status === 'held'; });
      var latest = Ledger.latest(Store.get('snapshots', []) || []);
      recheck = outstanding && (approval.date !== date || !latest || approval.contextKey !== Allocate.contextKey(latest, s));
    }
    return { configured: !!next, startDate: p.startDate, annualDate: next, halfDate: half,
      annualDue: !!next && date >= next, annualRecheck: recheck, halfDue: !!half && date >= half && date < next && !checked };
  }
  function pending(snap) { return Actions.between(snap, null).filter(function (a) { return Actions.MONEY[a.kind]; }); }
  function block(snap, date) {
    if (!snap || !Trading.isDate(snap.date)) return '先录入有效的最新余额';
    var age = (Date.parse(date) - Date.parse(snap.date)) / 864e5;
    if (age < 0 || age > 25) return '先录入最新余额，再评估交易';
    if (pending(snap).length) return '有待对账买卖，先录入已经包含这些交易的真实余额';
    return '';
  }
  function review(kind, decision, snap, settings, date) {
    if (!Trading.isDate(date)) return { ok: false, why: '无效检查日期' };
    var due = schedule(settings, date);
    if (kind !== 'annual' && kind !== 'half') return { ok: false, why: '无效检查类型' };
    if (kind === 'annual' ? !due.annualDue && !due.annualRecheck : !due.halfDue) return { ok: false, why: '这次检查尚未到期或已经记过了' };
    if (kind === 'half' && decision !== 'checked') return { ok: false, why: '半年检查只留痕，不生成交易' };
    if (kind === 'annual' && ['no-trade', 'approved'].indexOf(decision) < 0) return { ok: false, why: '请选择明确的检查结果' };
    var prefs = Store.get('prefs', {}) || {};
    var cycleDate = due.annualRecheck ? prefs.strategyApproval.dueDate : due.annualDate;
    if (decision === 'approved') {
      var why = block(snap, date) || Allocate.configurationIssue(settings);
      if (why) return { ok: false, why: why };
      if (Allocate.suggestMode(snap, settings).mode === 'monthly') return { ok: false, why: '先用可投新钱修正配置，更新余额后再评估卖出' };
      var plan = Allocate.planAnnual(snap, settings, date);
      if (!plan.sells.length) return { ok: false, why: '当前没有可生成的卖出计划' };
      prefs.strategyApproval = { contextKey: plan.contextKey, date: date, dueDate: cycleDate, base: policy(settings).startDate, calendar: 'start-v1' };
    } else if (kind === 'annual') delete prefs.strategyApproval;
    var start = policy(settings).startDate, n = 1, next = due.annualDate;
    if (kind === 'annual') { next = addMonths(start, 12); while (next && next <= date) { n++; next = addMonths(start, n * 12); } }
    prefs.strategyReviews = reviews().concat([{ kind: kind, decision: decision, date: date,
      dueDate: kind === 'annual' ? cycleDate : due.halfDate, nextDate: next, base: start }]);
    if (Store.set('prefs', prefs) === false) return { ok: false, why: '检查记录保存失败，未生成计划' };
    return { ok: true };
  }
  function approved(snap, settings, date) {
    var a = (Store.get('prefs', {}) || {}).strategyApproval;
    return !!a && a.calendar === 'start-v1' && a.base === policy(settings).startDate && a.date === date && a.contextKey === Allocate.contextKey(snap, settings);
  }
  return { policy: policy, firstDate: firstDate, addMonths: addMonths, reviews: reviews, schedule: schedule,
    pending: pending, block: block, review: review, approved: approved };
})();
if (typeof module !== 'undefined') module.exports = Strategy;
