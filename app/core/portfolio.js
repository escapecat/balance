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

  /** 每个现金科目的角色和到账天数。
   *
   *  ⚠️ 三个现金科目**性质完全不同**,混成一个「现金」一视同仁是不对的:
   *      现金账户  T+0,日常周转
   *      日日宝    T+0,但那是刻意留着的备用金 —— 一分不该拿去买基金
   *      月月宝    待投的钱池,**赎回要 2 天才到账**
   *
   *     没有这一层的话,工具会建议你「今天买 19 万」,而其中 15 万在月月宝里,
   *     今天根本到不了账 —— 一份做不到的清单。
   *
   *  没配过就都当「可投 · 当天到账」,和以前一样。 */
  function bucketOf(settings, key) {
    var m = (settings || {}).cashBuckets || {};
    var b = m[key] || {};
    return { role: b.role === 'buffer' ? 'buffer' : 'investable',
             settleDays: typeof b.settleDays === 'number' ? b.settleDays : 0 };
  }

  /** 标成「备用金」的那几个科目合计 —— 这部分永远不投。 */
  function bufferCash(snap, settings) {
    var c = snap.cash || {}, n = 0;
    Object.keys(c).forEach(function (k) {
      if (bucketOf(settings, k).role === 'buffer') n += c[k];
    });
    return n;
  }

  /** 可以拿去买东西的钱。
   *
   *  ⚠️ **要留下的现金 = 三个约束取最严**:
   *       cashFloor        绝对下限,应急用的钱
   *       cashTarget × 总额 比例目标,总额涨了备用金跟着涨
   *       Σ备用金科目       你明确标成「不投」的那几个
   *
   *     第一版只减了 `cashFloor`,于是同一屏上出现两个打架的数:
   *     配置表(现金也是一个类别,目标 5%)说「现金超配 19 万」,
   *     而这里说「可投 29 万」—— 照后者做,现金会被抽到只剩保底那 1 万,
   *     而你明明把现金目标设成了 5%。
   *
   *     三个都得守:只守绝对数的话资产涨上去备用金越来越薄;
   *     只守比例的话刚起步时那点钱不够应急;
   *     只守科目的话,你哪天忘了标记就一点保护都没有。
   */
  function investableCash(snap, settings) {
    var cash = sum(snap.cash || {});
    var total = sum(snap.holdings || {}) + cash;
    var floor = settings.cashFloor || 0;
    var byTarget = (settings.cashTarget != null ? settings.cashTarget : 0) * total;
    var byBucket = bufferCash(snap, settings);
    return Math.max(0, cash - Math.max(floor, byTarget, byBucket));
  }

  /** 今天就能动的钱 —— 可投科目里**当天到账**的那部分。
   *
   *  ⚠️ 和 investableCash 是两个问题:
   *      「该投多少」  → investableCash
   *      「今天能投多少」→ 这个
   *     月月宝赎回要 2 天,那笔钱该投,但今天到不了账。
   *     不区分的话清单上会写「今天可以做完」,而你今天做不到。 */
  function liquidNow(snap, settings) {
    var c = snap.cash || {}, n = 0;
    Object.keys(c).forEach(function (k) {
      var b = bucketOf(settings, k);
      if (b.role === 'investable' && b.settleDays === 0) n += c[k];
    });
    // 留下的那部分优先从「不投」的科目扣,扣不完的再从可投里扣
    var keep = Math.max(0, Math.max(settings.cashFloor || 0,
                                    (settings.cashTarget || 0) *
                                      (sum(snap.holdings || {}) + sum(c)))
                           - bufferCash(snap, settings));
    return Math.max(0, n - keep);
  }

  /** 要等几天才到账的钱,按天数分组 —— 界面上要说清「先赎回,X 天后能买」。 */
  function pending(snap, settings) {
    var c = snap.cash || {}, out = [];
    Object.keys(c).forEach(function (k) {
      var b = bucketOf(settings, k);
      if (b.role === 'investable' && b.settleDays > 0 && c[k] > 0) {
        out.push({ key: k, amount: c[k], settleDays: b.settleDays });
      }
    });
    return out.sort(function (a, b) { return a.settleDays - b.settleDays; });
  }

  return { byCategory: byCategory, sum: sum, summarize: summarize,
           investableCash: investableCash, bucketOf: bucketOf,
           bufferCash: bufferCash, liquidNow: liquidNow, pending: pending };
})();

if (typeof module !== 'undefined') module.exports = Portfolio;
