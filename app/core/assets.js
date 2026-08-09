// 组合之外的资产 —— MSFT、房产、任何不参与再平衡的东西。
//
// ⚠️ 这里**只存元数据**(叫什么、算哪一类),**不存金额**。
//    金额的唯一出处是 `snapshot.external[id]` —— 和基金持仓走同一条录入路径,
//    同一期的所有数字待在同一条快照里,历史天然是齐的。
//
//    第一版两边都存:`assets[].value` 一份、`snapshot.external` 一份。
//    录入页只写后者,「现在」页只读前者 —— 于是填了 MSFT 28 万之后,
//    页面一边把它算进总额,一边挂着一条「MSFT 还没填过金额,没算进上面这个数」。
//    两条路径记同一件事,迟早会有一条没人喂。
//
// ⚠️ 外部资产**不算进「组合」口径**。组合 = 持仓 + 现金,再平衡和收益率都按它算。
//    房产估值一年动一次、还是拍脑袋的,混进去的话组合收益率会跟着假涨假跌。
//    界面上分两行显示:「组合 x」「组合外 y」,总额是两者之和。

var Assets = (function () {

  function all() { return Store.get('assets', []) || []; }

  /** id 只跟序号有关,不含名字不含日期 —— 改名字不该让已有快照里的金额失配。 */
  function newId(list) {
    var n = 1, used = {};
    (list || []).forEach(function (a) { used[a.id] = 1; });
    while (used['a' + n]) n++;
    return 'a' + n;
  }

  function upsert(a) {
    if (!a.name) return { ok: false, why: '没有名字' };
    var list = all().slice();
    var id = a.id || newId(list);
    var i = list.findIndex(function (x) { return x.id === id; });
    var next = { id: id, name: a.name, kind: a.kind || 'other' };
    if (i >= 0) list[i] = next; else list.push(next);
    Store.set('assets', list);
    return { ok: true, id: id };
  }

  /** ⚠️ 删掉的只是这一条**名目**。历史快照里那几个金额一个字不动 ——
   *     和删基金同一个道理:那是你当时真实看到的数,改了就再也对不回去。
   *     代价是它会变成一条没人认领的 external 金额,所以界面上要说清楚。 */
  function remove(id) {
    Store.set('assets', all().filter(function (a) { return a.id !== id; }));
  }

  /** 组合外的合计。
   *  @return {sum, blank[]}  blank = 有名目但这期没填过金额的,**不许当 0**。
   *          迁移进来的 MSFT 就是这样:名字有,金额从来没记过。
   *          当 0 的话总额静默少一大截,而页面上看不出少了什么。 */
  function total(snap) {
    var ext = (snap && snap.external) || {};
    var sum = 0, blank = [];
    all().forEach(function (a) {
      if (typeof ext[a.id] === 'number') sum += ext[a.id];
      else blank.push(a.name || a.id);
    });
    return { sum: sum, blank: blank };
  }

  /** 某一条在某期的金额,没有就是 null(不是 0)。 */
  function valueAt(snap, id) {
    var v = snap && snap.external && snap.external[id];
    return typeof v === 'number' ? v : null;
  }

  return { all: all, newId: newId, upsert: upsert, remove: remove,
           total: total, valueAt: valueAt };
})();

if (typeof module !== 'undefined') module.exports = Assets;
