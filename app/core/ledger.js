// 账本 —— 快照的读写和**不变量**。纯函数,不碰 DOM。
//
// ⚠️ 这一层最要紧的不是功能,是**几条拒绝**。
//    金额类的数据出错不会报错,只会变成一个看着合理的数字,
//    然后你照着它做决策 —— 等发现不对的时候已经过了几个月。
//
// ⚠️ **留空 ≠ 0。** 这是整个录入流程的地基:
//      留空  = 这一项我没抄,沿用上次
//      0     = 这一项清仓了
//    把留空当成 0,一次提交就能把整个组合抹平。
//    所以这里的 normalize 只认 `undefined` / `null` / `''` 三种「留空」,
//    而 `0` 和 `'0'` 一律当成显式的零。
//    **不许用 `x || 0`** —— 那正是把留空变成 0 的唯一入口,check.sh 有 grep 守着。

var Ledger = (function () {

  var EMPTY = '__empty__';

  /** 一个输入值 → 数字 或 EMPTY。**不做兜底猜测。** */
  function parse(v) {
    if (v === undefined || v === null) return EMPTY;
    if (typeof v === 'string') {
      var t = v.trim().replace(/,/g, '');
      if (t === '') return EMPTY;
      var n = Number(t);
      return isNaN(n) ? EMPTY : n;      // 打错字当成没填,而不是当成 0
    }
    if (typeof v === 'number') return isNaN(v) ? EMPTY : v;
    return EMPTY;
  }

  function isEmpty(v) { return parse(v) === EMPTY; }

  /**
   * 把一份录入草稿合成一期快照。
   * @param raw   {holdings:{code:输入}, cash:{桶:输入}, netInflow, external:{id:输入}}
   * @param prev  上一期快照,留空的项从这儿沿用
   * @return {ok, snapshot, errors[]}
   */
  function build(raw, prev, date) {
    var errors = [];
    var out = { date: date, holdings: {}, cash: {}, external: {}, netInflow: 0 };
    prev = prev || { holdings: {}, cash: {}, external: {} };

    function fill(srcKey) {
      var src = raw[srcKey] || {};
      var old = prev[srcKey] || {};
      // 上一期有、这一期没提到的键也要带过来 —— 不然那一项会静默消失,
      // 而总额少一块你只会以为是市场跌了
      var keys = {};
      Object.keys(old).forEach(function (k) { keys[k] = 1; });
      Object.keys(src).forEach(function (k) { keys[k] = 1; });
      Object.keys(keys).forEach(function (k) {
        var p = parse(src[k]);
        var v = (p === EMPTY) ? old[k] : p;
        if (v === undefined || v === null) return;
        if (typeof v !== 'number' || isNaN(v)) { errors.push(k + ' 不是个数'); return; }
        if (v < 0) { errors.push(k + ' 是负数(' + v + ')—— 持仓和现金不可能为负'); return; }
        // 浮点残渣:0.4 分以下当成 0。不 clamp 的话「已清仓」会剩个 0.0000001,
        // 于是它永远出现在持仓列表里,而显示成 0
        out[srcKey][k] = Math.abs(v) < 0.005 ? 0 : v;
      });
    }
    fill('holdings'); fill('cash'); fill('external');

    var ni = parse(raw.netInflow);
    // 净投入**可以是负的**(取钱出来),这是它和持仓的关键区别
    out.netInflow = (ni === EMPTY) ? 0 : ni;
    if (raw.note) out.note = String(raw.note);

    return { ok: errors.length === 0, snapshot: out, errors: errors };
  }

  /** 追加一期。**永不修改历史** —— 同一天再录一次就是替换那一天。 */
  function append(snapshots, snap) {
    var list = (snapshots || []).slice();
    var i = list.findIndex(function (s) { return s.date === snap.date; });
    if (i >= 0) list[i] = snap; else list.push(snap);
    list.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    return list;
  }

  function latest(snapshots) {
    var l = snapshots || [];
    return l.length ? l[l.length - 1] : null;
  }

  /** 这一期 vs 上一期:总额变了多少,其中多少是投进去的、多少是涨跌。
   *
   * ⚠️ **这两个必须分开。** 总额涨了 6 万,
   *    是赚了 6 万,还是又投进去 10 万、市场亏了 4 万?含义天差地别,
   *    而不记 netInflow 的话永远分不开 —— 收益率也就无从谈起。
   *
   * ⚠️ **没记净投入时返回 null,不返回 0。**
   *    第一版写的是 `snap.netInflow || 0` —— 那会把「不知道投了多少」
   *    当成「投了 0」,于是整段变化全算成涨跌。
   *    迁移进来的历史几期正好都没有 netInflow,这一下就能编出一条
   *    完全虚假的收益曲线,而每个数字看着都合理。
   *    界面上宁可写「涨跌未知」,也不给一个错的数。 */
  function delta(snap, prev) {
    // ⚠️ 「组合」= 持仓 + 现金,**不含组合外资产**。
    //    房产估值一年动一次、还是拍脑袋估的,把它加进来的话,
    //    某天把房子从 200 万改成 220 万,组合就凭空「涨」了 20 万 ——
    //    而这一页存在的全部理由就是分清「赚的」和「投的」。
    function tot(s) {
      return Portfolio.sum(s.holdings) + Portfolio.sum(s.cash);
    }
    function ext(s) { return Portfolio.sum(s.external || {}); }
    if (!prev) {
      return { total: tot(snap), change: null, inflow: null, market: null,
               netBuy: null, external: ext(snap) };
    }
    var t = tot(snap), p = tot(prev);

    // ⚠️ **两个式子,两个未知数** —— 这是不用手填「本期净投入」的全部理由:
    //
    //      现金变化 = 外部净流入 − 净买入 + 分红
    //      持仓变化 = 净买入 − 分红 + 市场涨跌
    //
    //    → 外部净流入 = 现金变化 + 净买入 − 分红      (工资 − 花费)
    //    → 市场涨跌   = 持仓变化 − 净买入 + 分红
    //
    //    净买入和分红来自你记的动作。剩下两个都是解出来的,一个都不用填。
    //
    // ⚠️ 分红那一项漏了的话,它会被算成「基金亏了这么多 + 工资多了这么多」——
    //    两个数同时错,方向相反,而总额完全对得上,所以查不出来。
    if (typeof Actions !== 'undefined' && Actions.covered(prev.date)) {
      var nb = Actions.netBuy(prev.date, snap.date).total;
      var dv = Actions.dividends(prev.date, snap.date).total;
      var dCash = Portfolio.sum(snap.cash) - Portfolio.sum(prev.cash);
      var dHeld = Portfolio.sum(snap.holdings) - Portfolio.sum(prev.holdings);
      return { total: t, change: t - p,
               inflow: dCash + nb - dv,     // 工资 − 花费
               market: dHeld - nb + dv,     // 市场让你赚/亏了多少
               netBuy: nb, dividend: dv,    // 钱在内部搬了多少家
               source: 'actions', external: ext(snap) };
    }

    // 退路:老数据手填过 netInflow 的,还认。
    // ⚠️ 两个都没有就返回 null —— **不拿总额倒推**。
    //    倒推能编出一条完全虚假的收益曲线,而每个数字看着都合理。
    var has = typeof snap.netInflow === 'number' && !isNaN(snap.netInflow);
    return { total: t, change: t - p,
             inflow: has ? snap.netInflow : null,
             market: has ? t - p - snap.netInflow : null,
             netBuy: null,
             source: has ? 'manual' : null, external: ext(snap) };
  }

  /** 逐只基金这一期赚了多少。
   *
   *      某只的涨跌 = 它的市值变化 − 你这期买它的钱
   *
   *  ⚠️ 没有动作记录的区间返回 `null`,**不返回 0**。
   *     0 的意思是「没涨没跌」,null 的意思是「不知道」——
   *     而把后者显示成前者,你会以为这只基金一动没动。 */
  function perFund(snap, prev) {
    if (!prev) return null;
    if (typeof Actions === 'undefined' || !Actions.covered(prev.date)) return null;
    var by = Actions.netBuy(prev.date, snap.date).byCode;
    var dv = Actions.dividends(prev.date, snap.date).byCode;
    var codes = {};
    Object.keys(snap.holdings || {}).forEach(function (c) { codes[c] = 1; });
    Object.keys(prev.holdings || {}).forEach(function (c) { codes[c] = 1; });
    Object.keys(by).forEach(function (c) { codes[c] = 1; });
    Object.keys(dv).forEach(function (c) { codes[c] = 1; });
    return Object.keys(codes).map(function (c) {
      // ⚠️ 这里的 0 是**真的 0**,不是「没填」:某只基金不在某期的持仓里,
      //    就是那一期没有它。和录入页那个「留空 ≠ 0」是两回事 ——
      //    所以写成显式的类型判断,而不是 `|| 0`(那个写法分不出两种情况,
      //    check.sh 也就一律禁掉了)。
      var now = num((snap.holdings || {})[c]);
      var was = num((prev.holdings || {})[c]);
      var bought = num(by[c]), paid = num(dv[c]);
      return { code: c, from: was, to: now, netBuy: bought, dividend: paid,
               market: now - was - bought + paid };
    });
  }

  /** 没有这一项 = 0(不是「没填」)。见 perFund 里那段注释。 */
  function num(v) { return typeof v === 'number' && !isNaN(v) ? v : 0; }

  // ---------------- 存写入口 ----------------
  //
  // ⚠️ 这几个放在 core 而不是 ui,是因为 tools/check.sh 有一条守卫:
  //    **ui/ 里不许出现 Store.set**。写存储就是业务,业务归 core ——
  //    界面以后可能重写,业务不该跟着写第二遍。

  function commit(snap) {
    Store.set('snapshots', append(Store.get('snapshots', []) || [], snap));
    Store.remove('draft');            // 存成功了草稿就该消失,不然下次进来还问你要不要续
    return snap;
  }

  /** 删掉某一期 —— 录错了、或者手滑存了个空的。
   *
   * ⚠️ **先留回滚点再删。** 删除是这个 app 里第二个不可撤销的写操作,
   *    而且它比导入更容易误触:导入要选文件,删除只要点两下。
   *
   * ⚠️ 删掉一期会让**它之后那一期的「涨跌」重新算**(基准变了),
   *    所以调用方要把这件事说出来 —— 不然你会发现别的月份的数字也变了,
   *    而完全想不到是刚才那一下删的。 */
  function removeSnapshot(date) {
    var list = Store.get('snapshots', []) || [];
    var i = list.findIndex(function (s) { return s.date === date; });
    if (i < 0) return { ok: false, why: '没有 ' + date + ' 这一期' };
    Store.saveRollback('删掉 ' + date + ' 之前');
    var next = list.slice();
    next.splice(i, 1);
    Store.set('snapshots', next);
    // 后面那一期的基准变了 —— 报出来让界面能说清
    return { ok: true, removed: date,
             affects: i < list.length - 1 ? list[i + 1].date : null,
             left: next.length };
  }

  /** 把某个代码的持仓**并进**另一只 —— 处理「当年打错了代码」。
   *
   * ⚠️ 这会改历史,所以先留回滚点。但它**不改任何一期的总额** ——
   *    钱还是那些钱,只是换了个名字挂着。这是三种处理里最安全的一种。 */
  function mergeHolding(from, to) {
    if (!from || !to || from === to) return { ok: false, why: '得是两个不同的代码' };
    var list = Store.get('snapshots', []) || [];
    var hit = list.filter(function (s) { return (s.holdings || {})[from] != null; });
    if (!hit.length) return { ok: false, why: '没有哪一期持有 ' + from };
    Store.saveRollback('把 ' + from + ' 并进 ' + to + ' 之前');
    var moved = 0;
    var next = list.map(function (s) {
      var h = Object.assign({}, s.holdings || {});
      if (h[from] == null) return s;
      moved += h[from];
      h[to] = (typeof h[to] === 'number' ? h[to] : 0) + h[from];
      delete h[from];
      return Object.assign({}, s, { holdings: h });
    });
    Store.set('snapshots', next);
    return { ok: true, periods: hit.length, moved: moved };
  }

  /** 把某个代码从**所有历史**里抹掉 —— 处理「当年记错了,那笔钱本来就不存在」。
   *
   * ⚠️ 这是唯一会**改变历史总额**的操作。做完之后那几期的数字
   *    和你当年在基金 app 上看到的就对不上了 —— 所以调用方必须
   *    把「哪几期、各变多少」摆出来让人确认,而不是问一句「确定吗」。 */
  function dropHolding(code) {
    var list = Store.get('snapshots', []) || [];
    var hit = list.filter(function (s) { return (s.holdings || {})[code] != null; });
    if (!hit.length) return { ok: false, why: '没有哪一期持有 ' + code };
    Store.saveRollback('删掉 ' + code + ' 之前');
    var removed = 0;
    var next = list.map(function (s) {
      if ((s.holdings || {})[code] == null) return s;
      var h = Object.assign({}, s.holdings);
      removed += h[code];
      delete h[code];
      return Object.assign({}, s, { holdings: h });
    });
    Store.set('snapshots', next);
    return { ok: true, periods: hit.length, removed: removed,
             dates: hit.map(function (s) { return s.date; }) };
  }

  /** 某个代码在各期分别是多少 —— 界面上要先摆出来再让人决定。 */
  function holdingHistory(code) {
    return (Store.get('snapshots', []) || []).filter(function (s) {
      return (s.holdings || {})[code] != null;
    }).map(function (s) {
      return { date: s.date, value: s.holdings[code] };
    });
  }

  /** 草稿 —— 手机上抄一半切走、被杀进程,回来能续。
   *
   * ⚠️ 存的是**原始输入字符串**,不是解析后的数字。
   *    存数字的话「留空」在序列化时就没了(JSON 吃掉 undefined),
   *    读回来变成「这个键不存在」,再兜底一下就变成 0 —— 绕回清库那个坑。
   *    见 jstest/blank.js 第 7 条。 */
  function saveDraft(d) { Store.set('draft', d); }
  function loadDraft() { return Store.get('draft', null); }
  function dropDraft() { Store.remove('draft'); }

  return { EMPTY: EMPTY, parse: parse, isEmpty: isEmpty,
           build: build, append: append, latest: latest, delta: delta, perFund: perFund,
           commit: commit, removeSnapshot: removeSnapshot,
           mergeHolding: mergeHolding, dropHolding: dropHolding,
           holdingHistory: holdingHistory,
           saveDraft: saveDraft, loadDraft: loadDraft, dropDraft: dropDraft };
})();

if (typeof module !== 'undefined') module.exports = Ledger;
