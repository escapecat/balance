// 日历、检查留痕和卖出授权。检查完成不是成交；唯一成交来源仍是 Actions。
var Strategy = (function () {
  function policy(s) {
    var p = s.reviewPolicy || {};
    return { annualDate: Trading.isDate(p.annualDate) ? p.annualDate : '', halfEnabled: p.halfEnabled !== false };
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
    var p = policy(s), next = p.annualDate;
    reviews().forEach(function (r) { if (r.base === p.annualDate && r.kind === 'annual' && r.nextDate > next) next = r.nextDate; });
    var half = p.halfEnabled && next ? addMonths(next, -6) : '';
    var checked = reviews().some(function (r) { return r.base === p.annualDate && r.kind === 'half' && r.dueDate === half; });
    var approval = (Store.get('prefs', {}) || {}).strategyApproval, recheck = false;
    if (approval && approval.base === p.annualDate && next) {
      var items = (Store.get('todos', []) || []).filter(function (t) { return t.kind === 'sell' && t.contextKey === approval.contextKey; });
      var outstanding = !items.length || items.some(function (t) { return t.status === 'open' || t.status === 'partial'; });
      var latest = Ledger.latest(Store.get('snapshots', []) || []);
      recheck = outstanding && (approval.date !== date || !latest || approval.contextKey !== Allocate.contextKey(latest, s));
    }
    return { configured: !!next, annualDate: next, halfDate: half,
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
    var due = schedule(settings, date), why = block(snap, date);
    if (why) return { ok: false, why: why };
    if (kind !== 'annual' && kind !== 'half') return { ok: false, why: '无效检查类型' };
    if (Allocate.configurationIssue(settings)) return { ok: false, why: Allocate.configurationIssue(settings) };
    if (kind === 'annual' ? !due.annualDue && !due.annualRecheck : !due.halfDue) return { ok: false, why: '这次检查尚未到期或已经记过了' };
    if (kind === 'half' && decision !== 'checked') return { ok: false, why: '半年检查只留痕，不生成交易' };
    if (kind === 'annual' && ['no-trade', 'approved'].indexOf(decision) < 0) return { ok: false, why: '请选择明确的检查结果' };
    var prefs = Store.get('prefs', {}) || {};
    var cycleDate = due.annualRecheck ? prefs.strategyApproval.dueDate : due.annualDate;
    if (decision === 'approved') {
      if (Allocate.suggestMode(snap, settings).mode === 'monthly') return { ok: false, why: '先用可投新钱修正配置，更新余额后再评估卖出' };
      var plan = Allocate.planAnnual(snap, settings, date);
      if (!plan.sells.length) return { ok: false, why: '当前没有可生成的卖出计划' };
      prefs.strategyApproval = { contextKey: plan.contextKey, date: date, dueDate: cycleDate, base: policy(settings).annualDate };
    } else delete prefs.strategyApproval;
    var next = cycleDate;
    if (kind === 'annual') { do { next = addMonths(next, 12); } while (next && next <= date); }
    prefs.strategyReviews = reviews().concat([{ kind: kind, decision: decision, date: date,
      dueDate: kind === 'annual' ? cycleDate : due.halfDate, nextDate: next, base: policy(settings).annualDate }]);
    if (Store.set('prefs', prefs) === false) return { ok: false, why: '检查记录保存失败，未生成计划' };
    return { ok: true };
  }
  function approved(snap, settings, date) {
    var a = (Store.get('prefs', {}) || {}).strategyApproval;
    return !!a && a.date === date && a.contextKey === Allocate.contextKey(snap, settings);
  }
  return { policy: policy, addMonths: addMonths, reviews: reviews, schedule: schedule,
    pending: pending, block: block, review: review, approved: approved };
})();
if (typeof module !== 'undefined') module.exports = Strategy;
