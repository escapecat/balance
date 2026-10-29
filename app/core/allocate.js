// 只计算建议，不写余额、不下单。日期到期由 Strategy 提醒，不能被现金见底替代。
var Allocate = (function () {
  var Trade = typeof Trading !== 'undefined' ? Trading : require('./trading.js');
  var Digest = typeof Fingerprint !== 'undefined' ? Fingerprint : require('./fingerprint.js');
  function primaryOf(funds, holdings) {
    var p = {}, h = holdings || {};
    (funds || []).filter(Boolean).forEach(function (f) {
      if (!p[f.category] || (h[f.code] || 0) > (h[p[f.category].code] || 0)) p[f.category] = f;
    });
    return p;
  }
  // 显式选择同类通道；受限时不自动换另一只，更不跨类别替代。
  function buyingOf(settings, holdings) {
    var p = primaryOf(settings.funds, holdings), selected = settings.buyFundByCategory || {};
    Object.keys(selected).forEach(function (cat) {
      var f = (settings.funds || []).filter(function (x) { return x && x.code === selected[cat] && x.category === cat; })[0];
      p[cat] = f || null;
    });
    return p;
  }
  function gaps(sm) {
    return sm.rows.filter(function (r) { return !r.isCash && !r.unknown; }).map(function (r) {
      return { category: r.category, value: r.value, need: sm.total * r.target - r.value, target: r.target };
    });
  }
  // 整元预算守恒；逐项向下取整后分配尾差，绝不因四舍五入超支或超缺口。
  function distribute(rows, total, key) {
    var sum = rows.reduce(function (n, r) { return n + r[key]; }, 0);
    var budget = Math.max(0, Math.floor(Math.min(total, sum)));
    var result = rows.map(function (r, i) {
      var raw = sum ? budget * r[key] / sum : 0;
      return { i: i, amount: Math.min(Math.floor(r[key]), Math.floor(raw)), fraction: raw % 1 };
    });
    var left = budget - result.reduce(function (n, r) { return n + r.amount; }, 0);
    result.slice().sort(function (a, b) { return b.fraction - a.fraction || a.i - b.i; }).forEach(function (r) {
      if (left > 0 && r.amount + 1 <= Math.floor(rows[r.i][key])) { r.amount++; left--; }
    });
    return result.map(function (r) { return r.amount; });
  }
  function contextKey(snap, settings) {
    function stable(v) {
      if (!v || typeof v !== 'object') return v;
      if (Array.isArray(v)) return v.map(stable);
      var n = {}; Object.keys(v).sort().forEach(function (k) { n[k] = stable(v[k]); }); return n;
    }
    return Digest.hash(JSON.stringify(stable({ policyVersion: 4, snapshot: snap, settings: settings })));
  }
  function configurationIssue(s) {
    var targets = s.targets || {}, sum = s.cashTarget == null ? 0.05 : s.cashTarget;
    var ratios = Object.keys(targets).map(function (k) { return targets[k]; }).concat([sum]);
    if (ratios.some(function (v) { return typeof v !== 'number' || !isFinite(v) || v < 0 || v > 1; })) return '目标比例含无效数值，请到设置核对';
    Object.keys(targets).forEach(function (k) { sum += targets[k]; });
    if (Math.abs(sum - 1) > 0.0001) return '目标比例（含现金）不是 100%，请到设置核对';
    if (['cashFloor', 'minBuy', 'band'].some(function (k) { return s[k] != null && (typeof s[k] !== 'number' || !isFinite(s[k]) || s[k] < 0 || (k === 'band' && s[k] > 1)); })) return '现金保护或偏差带无效，请到设置核对';
    return '';
  }
  function planMonthly(snap, settings, date, flows) {
    date = date || Trade.today();
    var issue = configurationIssue(settings);
    if (issue) return { mode: 'monthly', invalid: issue, version: 3, today: [], daily: [], deferred: [], rows: [],
      budget: 0, spentToday: 0, pendingAmount: 0, restrictedAmount: 0, cashAvailable: 0 };
    flows = flows || (typeof Actions !== 'undefined' ? Actions.all() : []);
    var sm = Portfolio.summarize(snap, settings), cash = Portfolio.investableCash(snap, settings);
    var primary = buyingOf(settings, snap.holdings);
    var rows = gaps(sm).filter(function (g) { return g.need >= 1; }).sort(function (a, b) { return b.need - a.need; });
    var totalNeed = rows.reduce(function (n, r) { return n + r.need; }, 0);
    var amounts = distribute(rows, cash, 'need');
    rows.forEach(function (r, i) {
      r.budget = amounts[i]; r.fund = primary[r.category] || null;
      r.limit = r.fund ? Trade.availability(r.fund, date, flows) : { remaining: 0, why: '未配置该类买入基金' };
      r.eligible = Math.min(r.budget, r.limit.remaining);
      r.restricted = r.budget - Math.floor(r.eligible);
    });
    var today = [], deferred = [];
    rows.forEach(function (r) {
      r.today = Math.floor(r.eligible);
      if (r.today > 0) today.push({ category: r.category, fund: r.fund, amount: r.today });
      if (r.budget > r.today) deferred.push(r);
    });
    var spent = today.reduce(function (n, r) { return n + r.amount; }, 0);
    var budget = amounts.reduce(function (n, x) { return n + x; }, 0);
    return { mode: 'monthly', version: 3, contextKey: contextKey(snap, settings), executionDate: date,
      rows: rows, today: today, daily: [], deferred: deferred, skipped: [], spentToday: spent,
      budget: budget, pendingAmount: budget - spent,
      restrictedAmount: rows.reduce(function (n, r) { return n + r.restricted; }, 0),
      shortfall: Math.max(0, Math.round(totalNeed - cash)), cashAvailable: Math.floor(cash),
      cashLeft: Math.max(0, sm.cash - spent), daysNeeded: null };
  }
  // 年度只预览卖出与未来资金去向。买入必须在真实到账、更新余额后重新计算。
  function planAnnual(snap, settings, date) {
    var issue = configurationIssue(settings);
    if (issue) return { mode: 'annual', invalid: issue, version: 3, sells: [], buys: [], amount: 0, inBand: false };
    var sm = Portfolio.summarize(snap, settings), band = settings.band == null ? 0.05 : settings.band;
    var primary = primaryOf(settings.funds, snap.holdings), buyFunds = buyingOf(settings, snap.holdings);
    var funds = {}, locks = {}, skipped = [], sells = [], raised = 0;
    Portfolio.knownFunds(settings).forEach(function (f) { funds[f.code] = f; });
    (settings.locked || []).filter(Boolean).forEach(function (l) {
      if (!date || l.unlockDate > date) locks[l.fundCode] = (locks[l.fundCode] || 0) + Math.max(0, l.amount || 0);
    });
    var g = gaps(sm), over = g.filter(function (r) { return r.need < -1 && -r.need / (sm.total || 1) >= band; });
    over.sort(function (a, b) { return a.need - b.need; }).forEach(function (r) {
      var left = Math.floor(-r.need);
      Object.keys(snap.holdings || {}).filter(function (c) { return funds[c] && funds[c].category === r.category; })
        .sort(function (a, b) { return (a === (primary[r.category] || {}).code ? 1 : 0) - (b === (primary[r.category] || {}).code ? 1 : 0); })
        .forEach(function (code) {
          var have = Math.max(0, (snap.holdings[code] || 0) - (locks[code] || 0));
          if (locks[code]) skipped.push({ fund: funds[code], why: '有锁定持仓，本次只计算可赎回部分；交易前仍须核对限制与费用' });
          var amount = Math.floor(Math.min(have, left));
          if (amount > 0) { sells.push({ category: r.category, fund: funds[code], amount: amount }); left -= amount; raised += amount; }
        });
    });
    var under = g.filter(function (r) { return r.need >= 1; }), amounts = distribute(under, raised, 'need');
    var buys = under.map(function (r, i) { return { category: r.category, fund: buyFunds[r.category] || { code: '', name: '尚未配置基金' }, amount: amounts[i], executable: false }; }).filter(function (r) { return r.amount > 0; });
    return { mode: 'annual', version: 3, contextKey: contextKey(snap, settings), executionDate: date,
      preview: true, inBand: !over.length, band: band, sells: sells, buys: buys, amount: raised,
      retainedCash: raised - buys.reduce(function (n, r) { return n + r.amount; }, 0),
      skipped: skipped, cashUntouched: Portfolio.investableCash(snap, settings) };
  }
  function suggestMode(snap, settings) {
    var issue = configurationIssue(settings);
    if (issue) return { mode: 'none', why: issue };
    var cash = Portfolio.investableCash(snap, settings);
    return cash >= Math.max(1, settings.minBuy == null ? 1000 : settings.minBuy)
      ? { mode: 'monthly', why: '先保护现金，再用新钱补欠配；限购部分保留待投' }
      : { mode: 'none', why: '可投资金不足日常补仓门槛，暂不买；正式再平衡按检查日评估，不因现金见底自动卖出' };
  }
  return { primaryOf: primaryOf, buyingOf: buyingOf, gaps: gaps, distribute: distribute,
    contextKey: contextKey, configurationIssue: configurationIssue, planMonthly: planMonthly, planAnnual: planAnnual, suggestMode: suggestMode };
})();
if (typeof module !== 'undefined') module.exports = Allocate;
