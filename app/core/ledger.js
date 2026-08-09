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
               external: ext(snap) };
    }
    var t = tot(snap), p = tot(prev);
    var has = typeof snap.netInflow === 'number' && !isNaN(snap.netInflow);
    return { total: t, change: t - p,
             inflow: has ? snap.netInflow : null,
             market: has ? t - p - snap.netInflow : null,
             external: ext(snap) };
  }

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
           build: build, append: append, latest: latest, delta: delta,
           commit: commit, removeSnapshot: removeSnapshot,
           saveDraft: saveDraft, loadDraft: loadDraft, dropDraft: dropDraft };
})();

if (typeof module !== 'undefined') module.exports = Ledger;
