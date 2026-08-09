// 组合汇总 —— 纯函数,不碰 DOM,不碰存储。
//
// ⚠️ **现金是第七个类别。**
//    按持仓分类算比例的话,现金根本不出现在表里 —— 而它常常是最大的偏离项。
//    2026-07-30 那期:现金 13.9% 对目标 5%,差 8.9 个点,比标普500 的 7.6 还大,
//    却一个字都看不到。所以这里把现金和六大类放在同一张表上。

var Portfolio = (function () {

  /** 各基金市值 → 各类别市值 */
  function byCategory(holdings, funds) {
    var cat = {};
    funds.forEach(function (f) { cat[f.code] = f.category; });
    var out = {};
    Object.keys(holdings || {}).forEach(function (code) {
      var c = cat[code];
      // ⚠️ 清单里没有的基金代码**不许静默丢掉**,归到「未分类」。
      //    静默丢掉的后果:那笔钱既不在任何类别里,也不进总额,
      //    对不上账的时候完全查不出钱去哪了。
      if (!c) c = '未分类';
      out[c] = (out[c] || 0) + (holdings[code] || 0);
    });
    return out;
  }

  function sum(obj) {
    var t = 0;
    Object.keys(obj || {}).forEach(function (k) {
      if (typeof obj[k] === 'number') t += obj[k];
    });
    return t;
  }

  /**
   * 一期快照的全貌。
   * @param snap    {holdings:{code:值}, cash:{桶:值}}
   * @param settings {funds, targets:{类别:比例}, cashTarget, cashFloor}
   */
  function summarize(snap, settings) {
    var funds = settings.funds || [];
    var targets = settings.targets || {};
    var held = byCategory(snap.holdings || {}, funds);
    var cash = sum(snap.cash || {});
    var invested = sum(held);
    var total = invested + cash;

    var rows = [];
    Object.keys(targets).forEach(function (c) {
      var v = held[c] || 0;
      rows.push({ category: c, value: v, pct: total ? v / total : 0,
                  target: targets[c], gap: total * targets[c] - v, isCash: false });
    });
    // 未分类的也要露出来 —— 有钱在这儿说明基金清单缺一条
    Object.keys(held).forEach(function (c) {
      if (targets[c] === undefined) {
        rows.push({ category: c, value: held[c], pct: total ? held[c] / total : 0,
                    target: null, gap: null, isCash: false, unknown: true });
      }
    });
    var ct = settings.cashTarget != null ? settings.cashTarget : 0.05;
    rows.push({ category: '现金', value: cash, pct: total ? cash / total : 0,
                target: ct, gap: total * ct - cash, isCash: true });

    return { total: total, invested: invested, cash: cash, rows: rows };
  }

  /** 可以拿去买东西的钱。
   *
   *  ⚠️ **要留下的现金 = max(绝对保底, 目标占比 × 总额)**,两个条件都得满足。
   *
   *     第一版只减了 `cashFloor`,于是同一屏上出现两个打架的数:
   *     配置表(现金也是一个类别,目标 5%)说「现金超配 19 万」,
   *     而这里说「可投 29 万」—— 照后者做,现金会被抽到只剩保底那 1 万,
   *     占比 0.5%,而你明明把现金目标设成了 5%。
   *
   *     两个设置是不同的东西,都得守:
   *       cashFloor  —— 绝对下限。应急用的钱,跌到这个数以下不许再投
   *       cashTarget —— 比例目标。现金作为一个类别,它也有自己的位置
   *     总资产涨上去之后,后者会自动超过前者 —— 这正是「保持一定现金流」
   *     该有的行为:钱多了,备用金也该跟着多。
   */
  function investableCash(snap, settings) {
    var cash = sum(snap.cash || {});
    var total = sum(snap.holdings || {}) + cash;
    var floor = settings.cashFloor || 0;
    var byTarget = (settings.cashTarget != null ? settings.cashTarget : 0) * total;
    return Math.max(0, cash - Math.max(floor, byTarget));
  }

  return { byCategory: byCategory, sum: sum, summarize: summarize,
           investableCash: investableCash };
})();

if (typeof module !== 'undefined') module.exports = Portfolio;
