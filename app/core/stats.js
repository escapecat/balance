// 统计 —— **样本不够的时候,一个数都不给。**
//
// ⚠️ 这是整个文件的立场。理财工具最容易犯的错是「有几个点就画条线」——
//    两期数据也能算出个年化,而那个数会大得离谱或小得离谱,
//    但它长得和真的一模一样,你会拿它做决定。
//
//    所以这里的 API 不返回 null 让界面自己猜,而是返回
//    `{ ok: false, have: 1, need: 3 }` —— 界面照着说「还需 2 期」。
//
// ⚠️ **收益率的唯一前提是「这一期分得开涨跌和投入」。**
//    分不开的话,总额从 A 涨到 B 你不知道是赚的还是又投的,
//    任何收益率都是编的。老库那几期没有买卖记录,所以分不开;
//    从你记第一笔买卖开始就分得开了 —— 这是时间问题,不是工作量问题。
//
// ⚠️ 时间加权(TWR)和资金加权(XIRR)答的是**两个不同的问题**:
//      TWR  —— 这个组合本身表现如何(剔除你的申购时点)
//      XIRR —— 你这笔钱实际赚了多少(算上你什么时候投的)
//    两个都给,因为定投的人这两个数常常差得很远,
//    而只看其中一个都会得出错误的结论。

var Stats = (function () {

  var MIN_PERIODS = 3;      // 至少 3 期 → 2 个区间。1 个区间的年化没有意义

  function total(s) {
    return Portfolio.sum(s.holdings || {}) + Portfolio.sum(s.cash || {});
  }

  /** 这一期相对上一期,**分不分得开「涨跌」和「投入」**。
   *
   *  ⚠️ 判据必须走 `Ledger.delta`,**不能直接读 `snap.netInflow`**。
   *     那个字段是老版本手填的产物,现在已经不写入了 ——
   *     直接读它的话,你记满一年动作这里也永远是 0 期可用,
   *     而页面上只会写「还差 3 期」,看不出是代码没接上。
   *     (这就是本项目记录在案的头号失败模式:写了没接上。) */
  function inflowOf(snap, prev) {
    if (!prev) return null;
    return Ledger.delta(snap, prev).inflow;
  }

  /** 从最新往回数,**连续**分得开的有几期(含起点那一期)。
   *
   *  ⚠️ 必须连续。中间断一期的话,那一段的涨跌就分不出来了,
   *     而把断掉的两截接起来算,等于假装中间那段没投过钱。 */
  function usable(snaps) {
    var list = snaps || [];
    var spans = 0;
    for (var i = list.length - 1; i >= 1; i--) {
      if (inflowOf(list[i], list[i - 1]) == null) break;
      spans++;
    }
    return spans ? spans + 1 : 0;      // n 个区间要 n+1 期
  }

  function gate(snaps) {
    var have = usable(snaps);
    if (have >= MIN_PERIODS) return { ok: true, have: have };
    return { ok: false, have: have, need: MIN_PERIODS,
             why: have === 0
               ? '还没有哪一期分得开「涨跌」和「投入」—— 从记第一笔买卖开始就有了'
               : '已经连着 ' + have + ' 期分得开了,还差 ' + (MIN_PERIODS - have) + ' 期' };
  }

  /** 时间加权收益率 —— 每个区间算一次,连乘。
   *
   *  ⚠️ 净投入要从**期末**扣掉再和期初比。放在期初(当作期初就有这笔钱)
   *     会把收益率压低,而且压低的幅度跟你投得多不多成正比 ——
   *     越努力定投,数字越难看,那显然是错的。
   *     真实情况在两者之间(钱是月中某天进的),月度数据分不了那么细,
   *     取期末口径是保守的那一侧。 */
  function twr(snaps) {
    var g = gate(snaps);
    if (!g.ok) return g;
    var list = snaps.slice(-g.have);
    var product = 1, periods = 0;
    for (var i = 1; i < list.length; i++) {
      var begin = total(list[i - 1]);
      if (begin <= 0) continue;
      var end = total(list[i]) - inflowOf(list[i], list[i - 1]);
      product *= end / begin;
      periods++;
    }
    if (!periods) return { ok: false, have: g.have, need: MIN_PERIODS,
                           why: '算不出区间' };
    var days = dayDiff(list[0].date, list[list.length - 1].date);
    return { ok: true, rate: product - 1, periods: periods, days: days,
             annual: annualize(product - 1, days) };
  }

  /** 资金加权(XIRR)—— 牛顿法求根,零依赖。
   *
   *  现金流:每期净投入是**流出**(负),最后的总额是**流入**(正),
   *  第一期的期初总额也算一笔流出。 */
  function xirr(snaps) {
    var g = gate(snaps);
    if (!g.ok) return g;
    var list = snaps.slice(-g.have);
    var t0 = list[0].date;
    var cf = [{ date: t0, amount: -total(list[0]) }];
    for (var i = 1; i < list.length; i++) {
      var inf = inflowOf(list[i], list[i - 1]);
      if (inf) cf.push({ date: list[i].date, amount: -inf });
    }
    cf.push({ date: list[list.length - 1].date, amount: total(list[list.length - 1]) });

    // 全是同号的话无解 —— 直接说算不出,不给一个假的
    var pos = cf.some(function (c) { return c.amount > 0; });
    var neg = cf.some(function (c) { return c.amount < 0; });
    if (!pos || !neg) return { ok: false, have: g.have, need: MIN_PERIODS,
                               why: '现金流全是同一个方向,解不出来' };

    var r = 0.1;
    for (var k = 0; k < 80; k++) {
      var f = 0, df = 0;
      for (var j = 0; j < cf.length; j++) {
        var y = dayDiff(t0, cf[j].date) / 365;
        var base = 1 + r;
        if (base <= 0) { r = -0.9999; base = 0.0001; }
        f += cf[j].amount / Math.pow(base, y);
        df += -y * cf[j].amount / Math.pow(base, y + 1);
      }
      if (Math.abs(df) < 1e-12) break;
      var next = r - f / df;
      if (next < -0.9999) next = -0.9999;
      if (Math.abs(next - r) < 1e-9) { r = next; break; }
      r = next;
    }
    // ⚠️ 没收敛就**说没收敛**,不把最后一次迭代的值当答案。
    if (!isFinite(r) || Math.abs(r) > 100) {
      return { ok: false, have: g.have, need: MIN_PERIODS, why: '没算收敛' };
    }
    return { ok: true, rate: r, days: dayDiff(t0, cf[cf.length - 1].date) };
  }

  /** 每一期各类占多少 —— 走势图和结构图用。
   *
   *  ⚠️ **分母是总资产,含组合外。** 现金是一类,组合外(MSFT、房产)也是一类。
   *     只画组合的话,标着「总资产走势」的图里少了一大块 ——
   *     而首页顶上那个大数是含的,两处对不上你根本不知道差的哪儿。
   *
   *  ⚠️ 但**收益率仍然只按组合算**(见 twr / xirr 里的 total)。
   *     组合外那部分是拍脑袋估的估值,一改就会让「市场赚了多少」凭空跳一下。
   *     同一个页面上两种口径并存是对的 —— 它们回答的是不同的问题:
   *       「我一共有多少 · 钱怎么分布」→ 总资产
   *       「市场让我赚了多少」        → 组合 */
  function composition(snaps, settings) {
    var cats = Object.keys((settings || {}).targets || {});
    return (snaps || []).map(function (s) {
      var sm = Portfolio.summarize(s, settings);
      var by = {};
      sm.rows.forEach(function (r) {
        var key = r.isCash ? '现金' : (r.unknown ? '未分类' : r.category);
        by[key] = (by[key] || 0) + r.value;
      });
      var ext = Portfolio.sum(s.external || {});
      if (ext > 0) by['组合外'] = ext;
      var t = total(s) + ext;
      return { date: s.date, total: t, portfolio: total(s), external: ext, by: by,
               pct: cats.concat(['现金', '未分类', '组合外']).reduce(function (m, c) {
                 if (by[c] != null) m[c] = t ? by[c] / t : 0;
                 return m;
               }, {}) };
    });
  }

  /** 每一类:投进去多少(来自申报的现金流)· 涨跌多少(总变化 − 投入)。
   *
   *  ⚠️ 只有**勾选申报过**的期间才算得出来。没有分类流水的那几期,
   *     `market` 是 null —— 界面上写「未知」,不许拿总额倒推。 */
  function contribution(snaps, flows, settings) {
    if (!snaps || snaps.length < 2) return { ok: false, why: '至少要两期' };
    var first = null;
    (flows || []).forEach(function (f) { if (!first || f.date < first) first = f.date; });
    if (!first) return { ok: false, why: '还没有勾过任何一条待办 —— 分类流水从第一次勾选开始' };

    // 起点取「第一条流水之前的最后一期」,再早的没有流水可对照
    var start = null;
    snaps.forEach(function (s) { if (s.date <= first) start = s; });
    if (!start) start = snaps[0];
    var end = snaps[snaps.length - 1];
    if (start.date === end.date) return { ok: false, why: '第一次勾选之后还没录过新的一期' };

    var funds = (settings || {}).funds || [];
    var a = Portfolio.byCategory(start.holdings, funds);
    var b = Portfolio.byCategory(end.holdings, funds);
    var inflow = {};
    (flows || []).forEach(function (f) {
      if (f.date <= start.date) return;
      inflow[f.category] = (inflow[f.category] || 0) + (f.kind === 'sell' ? -1 : 1) * f.amount;
    });

    var rows = [];
    Object.keys(b).concat(Object.keys(a)).forEach(function (c) {
      if (rows.some(function (r) { return r.category === c; })) return;
      var got = (inflow[c] || 0);
      rows.push({ category: c, from: a[c] || 0, to: b[c] || 0,
                  inflow: got, market: (b[c] || 0) - (a[c] || 0) - got });
    });
    return { ok: true, from: start.date, to: end.date, rows: rows };
  }

  // ---- 小工具 ----

  function dayDiff(a, b) {
    return Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 864e5));
  }
  /** 不满一年的**不年化**。三个月赚 5% 年化成 21.6% 是数学上对、
   *  用起来极具误导的那种数 —— 短期波动被放大了四倍。 */
  function annualize(rate, days) {
    if (!days || days < 330) return null;
    return Math.pow(1 + rate, 365 / days) - 1;
  }

  return { MIN_PERIODS: MIN_PERIODS, usable: usable, gate: gate, inflowOf: inflowOf,
           twr: twr, xirr: xirr, composition: composition,
           contribution: contribution, annualize: annualize };
})();

if (typeof module !== 'undefined') module.exports = Stats;
