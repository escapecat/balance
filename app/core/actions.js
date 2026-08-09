// 动作 —— **发生了什么就记什么。**
//
// ⚠️ 这是整个模型的地基,而它替掉了一个手填的输入框。
//
//    原来的做法是「拍快照」:每月抄一遍所有数字,月与月之间发生过什么
//    靠前后两张快照相减去猜 —— 猜不出来,所以只好让人手填一个「本期净投入」。
//    填错了、忘了填,收益率就是错的,而错得看不出来。
//
//    改成记动作之后,那个框可以直接删掉。两个式子两个未知数:
//
//        现金变化 = (工资 − 花费) − 净买入
//        持仓变化 =  净买入 + 市场涨跌
//
//    净买入是你记的动作(已知),现金和持仓是对账时抄的(已知)——
//    于是**工资花费净值**和**市场涨跌**都解得出来,一个都不用填。
//
// ⚠️ 而且因为动作带着基金代码,**逐只基金的盈亏也算得出来**:
//        某只的涨跌 = 它的市值变化 − 你买它的钱
//
// ⚠️ 代价是**漏记一笔就全错**,而且是静默地错(数字仍然合理)。
//    所以有两条防线:
//      · `since` —— 从哪天开始记的。之前的区间一律算「没有记录」,
//        不拿 0 当「这期没买过」
//      · 对账时算出来的「工资花费净值」离谱的话(比如一个月花了几十万),
//        多半是漏记了买入 —— 界面上要提出来

var Actions = (function () {

  // 会发生的事分三类,判据是**不记它会不会让某个数字算错**。
  //
  //   影响数字,必须记:
  //     buy       买入 —— 加仓 / 补仓 / 定投,都是它
  //     sell      卖出 —— 减仓 / 清仓 / 止盈
  //     dividend  现金分红 —— 钱从基金流到现金
  //
  //   只留痕,不参与计算:
  //     note      改了目标比例、临时决定,以后回看想知道当时在想什么
  //
  // ⚠️ **基金转换(A 直接换成 B)不给新类型** —— 它数学上就是「卖 A + 买 B」,
  //    记两笔就对了。多一个类型就多一处要维护的分支,而它一点新信息都没带来。
  //
  // ⚠️ **工资到账、花钱、申赎手续费都不记。**
  //    前两个算得出来(现金变化 + 净买入);
  //    手续费已经含在你实际扣款的金额里了 —— 你买 10000 到账 9985,记 10000。
  //    要求人记那些的工具,最后都会因为记不全而作废。
  //
  // ⚠️ **红利再投资也不记**:份额变多、钱没动,等价于涨了一点,
  //    对账的时候自然就体现在市值里了。只有**现金分红**要记。
  var MONEY = { buy: 1, sell: 1, dividend: 1 };

  function all() { return Store.get('flows', []) || []; }

  /** id 只跟序号有关。**不用时间戳** —— 同一秒记两笔会撞,
   *  而撞了之后其中一笔就静默消失了(按 id 去重的地方全中招)。 */
  function newId(list) {
    var n = 1, used = {};
    (list || []).forEach(function (f) { used[f.id] = 1; });
    while (used['f' + n]) n++;
    return 'f' + n;
  }

  /** 记一笔。
   *  @param a {date, kind, code?, category?, amount?, note?, todoId?} */
  function add(a) {
    if (!a || !a.date) return { ok: false, why: '没有日期' };
    if (a.kind !== 'note' && !MONEY[a.kind]) {
      return { ok: false, why: '认不出这种动作:' + a.kind };
    }
    if (MONEY[a.kind]) {
      if (typeof a.amount !== 'number' || isNaN(a.amount) || a.amount <= 0) {
        return { ok: false, why: '金额得是个大于 0 的数' };
      }
    }
    var list = all().slice();
    var rec = { id: newId(list), date: a.date, kind: a.kind };
    if (a.code) rec.code = a.code;
    if (a.category) rec.category = a.category;
    if (MONEY[a.kind]) rec.amount = a.amount;
    if (a.note) rec.note = a.note;
    if (a.todoId) rec.todoId = a.todoId;
    list.push(rec);
    list.sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : 0; });
    Store.set('flows', list);
    return { ok: true, id: rec.id };
  }

  function remove(id) {
    Store.set('flows', all().filter(function (f) { return f.id !== id; }));
  }

  /** 从哪天开始,买卖就都记全了。**在这之前的区间一律算「没有记录」** ——
   *  那时候没有动作不代表没买过,只代表没记。
   *
   *  ⚠️ 这个日期**不能从第一笔动作自动推**。
   *     第一次记账那天(比如 8/09)往前到上次对账(7/30)之间的十天,
   *     你可能买过东西没记 —— 工具没法知道,只有你知道。
   *     自动推的后果是那十天的买入被算成「市场涨跌」,数字全错还看不出来;
   *     而如果保守地取第一笔动作那天,**整个第一期就白等了**。
   *     所以这是一个需要你回答一次的问题,界面上问,这里只负责存。
   */
  function since() {
    var p = Store.get('prefs', {}) || {};
    return p.actionsSince || null;
  }

  /** 明确声明「从这天起买卖都记全了」。 */
  function startFrom(date) {
    var p = Store.get('prefs', {}) || {};
    p.actionsSince = date;
    Store.set('prefs', p);
    return date;
  }

  /** 还没声明过起点。界面靠这个决定要不要问那一句。 */
  function needsStart() { return !since(); }

  /** (from, to] 区间内的动作。左开右闭 —— 对账日当天的买入算这一期的。 */
  function between(from, to) {
    return all().filter(function (f) {
      return (!from || f.date > from) && (!to || f.date <= to);
    });
  }

  /** 这个区间**有没有记录可用**。
   *
   *  ⚠️ 「一条动作都没有」有两种可能:这期真没买过 · 那时候还没开始记。
   *     分不清的话就会把「没记」当成「没买」,于是市场涨跌里混进了申购,
   *     而数字看着完全正常。所以靠 `since` 判断,不靠条数。 */
  function covered(from) {
    var s = since();
    return !!(s && from && from >= s);
  }

  /** 区间净买入(买 − 卖)。**分红不算在里面** —— 它是钱从基金流出来,
   *  方向和买入相反,但也不是「你卖了」,所以单独一项。
   *  @return {total, byCode:{}, byCategory:{}} */
  function netBuy(from, to) {
    var out = { total: 0, byCode: {}, byCategory: {} };
    between(from, to).forEach(function (f) {
      if (f.kind !== 'buy' && f.kind !== 'sell') return;
      var v = (f.kind === 'sell' ? -1 : 1) * f.amount;
      out.total += v;
      if (f.code) out.byCode[f.code] = (out.byCode[f.code] || 0) + v;
      if (f.category) out.byCategory[f.category] = (out.byCategory[f.category] || 0) + v;
    });
    return out;
  }

  /** 区间现金分红。基金市值减少、现金增加 —— 两边都要减掉它才算得对。 */
  function dividends(from, to) {
    var out = { total: 0, byCode: {}, byCategory: {} };
    between(from, to).forEach(function (f) {
      if (f.kind !== 'dividend') return;
      out.total += f.amount;
      if (f.code) out.byCode[f.code] = (out.byCode[f.code] || 0) + f.amount;
      if (f.category) out.byCategory[f.category] = (out.byCategory[f.category] || 0) + f.amount;
    });
    return out;
  }

  /** 每一类累计投进去多少(买 − 卖)。历史页「钱去哪了」用这个。 */
  function netByCategory() {
    return netBuy(null, null).byCategory;
  }

  return { MONEY: MONEY, all: all, add: add, remove: remove, newId: newId,
           since: since, startFrom: startFrom, needsStart: needsStart, between: between,
           covered: covered, netBuy: netBuy, dividends: dividends,
           netByCategory: netByCategory };
})();

if (typeof module !== 'undefined') module.exports = Actions;
