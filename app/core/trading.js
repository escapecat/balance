// 交易限制只取决于明确的状态和额度；平台、核实日期仅作可选备注。
var Trading = (function () {
  var LABELS = { unknown: '待核实', open: '正常申购', limited: '限额申购', paused: '暂停申购' };
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function isDate(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    var d = new Date(v + 'T12:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }
  function valid(t) {
    if (!t || typeof t !== 'object' || Array.isArray(t) || !Object.prototype.hasOwnProperty.call(LABELS, t.status)) return false;
    if (t.platform != null && typeof t.platform !== 'string') return false;
    if (t.checkedOn != null && t.checkedOn !== '' && !isDate(t.checkedOn)) return false;
    if (t.status === 'limited' && !(typeof t.dailyLimit === 'number' && isFinite(t.dailyLimit) && t.dailyLimit >= 0)) return false;
    return (!t.usedDate || isDate(t.usedDate)) &&
      (t.usedAmount === undefined || (typeof t.usedAmount === 'number' && isFinite(t.usedAmount) && t.usedAmount >= 0));
  }
  function of(f) {
    var t = (f || {}).trade;
    return valid(t) ? Object.assign({}, t, { platform: t.platform || '', checkedOn: t.checkedOn || '' })
      : { status: 'unknown', platform: '', checkedOn: '' };
  }
  function availability(f, date, flows) {
    var t = of(f), r = { status: t.status, platform: t.platform, checkedOn: t.checkedOn, remaining: 0, used: 0, why: '' };
    if (t.status === 'paused') { r.why = '暂停申购'; return r; }
    if (t.status === 'unknown') { r.why = '申购状态待核实'; return r; }
    if (t.status === 'open') { r.remaining = Infinity; return r; }
    r.used = (t.usedDate === date ? (t.usedAmount || 0) : 0) + (flows || []).reduce(function (n, a) {
      return n + (a && a.date === date && a.kind === 'buy' && a.code === f.code ? a.amount : 0);
    }, 0);
    r.remaining = Math.max(0, t.dailyLimit - r.used);
    r.why = r.remaining ? '日限额 ¥' + t.dailyLimit + '，今日已用 ¥' + r.used : '今日可用额度为 0';
    return r;
  }
  return { LABELS: LABELS, today: today, isDate: isDate, valid: valid, of: of, availability: availability };
})();
if (typeof module !== 'undefined') module.exports = Trading;
