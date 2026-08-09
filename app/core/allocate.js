// 再平衡 —— 纯函数,两种模式。
//
// ⚠️ **「只买不卖」不是一条永久规则,是「月度补仓」这种模式的特征。**
//    它只在**手上还有可投现金**的时候成立:有钱就把钱投给欠配的,
//    超配的让它被稀释,不用卖、不产生赎回费、不打断持有期。
//
//    可现金总会见底。到了保底线之后再欠配,除了卖就没别的办法了 ——
//    这时候还坚持只买不卖,等于宣布「以后再也不做再平衡」。
//
// 所以分两种:
//
//    月度 planMonthly()    有可投现金 → 只买。默认模式,一个月一次
//    年度 planAnnual()     真动刀,买卖两侧 → 把比例拉回目标。一年一次
//
// ⚠️ 年度那次**才是真正的再平衡**(卖出涨多的、买入跌多的,强制低买高卖),
//    月度只是「把新钱放对地方」。两件事的成本和心理负担差一个量级,
//    混成一个功能的话,要么你每月都在纠结要不要卖,要么一年都不敢动。

var Allocate = (function () {

  function round(x) { return Math.round(x); }

  /** 每类挑一只**主基金**承接买入 —— 一个类别下挂着好几只(不同份额、备胎)
   *  的时候不说清买哪只,这份清单就没法照着操作。
   *
   *  ⚠️ **谁是主,从持仓推,不让人手工标。**
   *     早先有三个标记在表达同一件事(主 / 未启用 / 退役中),
   *     而它们永远指向同一批基金 —— 每加一只都要想「这三个该怎么勾」,
   *     想错了还没有任何提示。
   *     现在的规则一句话:**一类里持仓最大的那只就是你在用的。**
   *     拿真数据验过,六个类别全部和手工标记的结果一致。 */
  function primaryOf(funds, holdings) {
    var h = holdings || {};
    var p = {};
    (funds || []).forEach(function (f) {
      var cur = p[f.category];
      if (!cur) { p[f.category] = f; return; }
      // 持仓大的胜出 —— 你在用的那只自然就是钱最多的那只。
      // 拿真数据验过:六个类别全部和手工标记的一致。
      if ((h[f.code] || 0) > (h[cur.code] || 0)) p[f.category] = f;
    });
    return p;
  }

  /** 每一类离目标差多少。
   *
   *  ⚠️ 基数是**组合总额**(持仓 + 全部现金),不是「持仓 + 可投现金」。
   *
   *     第一版减掉了 cashFloor,理由听着挺对:「保底那笔钱又不能投」。
   *     但现金**本身就是第七个类别**,它有自己的目标(5%)——
   *     保底的那 1 万还是你的资产,只是不拿去买基金而已。
   *     从基数里抠掉的话,每一类的目标都跟着缩水:
   *     按 cashFloor × 目标比例的量缩,而缺口最小的那一类会被压成负数,
   *     直接从清单上消失。
   *
   *     更要命的是**同一屏上会出现两个不同的数**:
   *     同一个类别,配置表(走 Portfolio.summarize,基数是总额)
   *     和待办清单(走这里)会给出两个不同的缺口 —— 你不知道该信哪个。
   *     算错还能查,两个都言之凿凿的数并排放着,只会让人不再信这个工具。
   *
   *     cashFloor 只该约束「今天能花多少」,不该改变任何类别的目标。
   */
  function gaps(sm) {
    var T = sm.total;
    var out = [];
    (sm.rows || []).forEach(function (r) {
      if (r.isCash || r.unknown) return;
      out.push({ category: r.category, value: r.value,
                 need: T * r.target - r.value, target: r.target });
    });
    return out;
  }

  // ---------------- 月度:只买 ----------------

  function planMonthly(snap, settings) {
    var sm = Portfolio.summarize(snap, settings);
    var cash = Portfolio.investableCash(snap, settings);
    var primary = primaryOf(settings.funds, snap.holdings);
    var want = gaps(sm).filter(function (g) { return g.need > 1; });
    var totalNeed = want.reduce(function (s, x) { return s + x.need; }, 0);

    // ⚠️ **两轮分配,顺序不能反。** 先给无限额的,再给有限额的。
    //
    //    直觉上「所有类别按缺口比例一起分」看着公平,我第一版就那么写的,
    //    拿真数据一跑才看出问题:有限额的类**今天只吃得下 2000/3000**,
    //    分给它一大笔钱是假的 —— 那笔钱实际还躺在现金里,
    //    而无限额的那一类因为「按比例」只分到该有的八成。
    //    结果是本来今天能进场的钱没进场,现金比例继续偏离,
    //    账面上却显示「已经合理分配了」。
    var free = [], capped = [], skipped = [];
    want.forEach(function (w) {
      w.fund = primary[w.category];
      if (!w.fund) { skipped.push({ category: w.category, need: round(w.need),
                                    why: '这一类没有可买的基金' }); return; }
      (w.fund.dailyLimit ? capped : free).push(w);
    });

    var freeNeed = free.reduce(function (s, x) { return s + x.need; }, 0);
    var freeScale = freeNeed > cash && freeNeed > 0 ? cash / freeNeed : 1;

    var today = [], spent = 0;
    free.sort(function (a, b) { return b.need - a.need; }).forEach(function (w) {
      var amt = w.need * freeScale;
      if (amt < 1) return;
      today.push({ category: w.category, fund: w.fund, amount: round(amt) });
      spent += amt;
    });

    var daily = [], days = 0;
    capped.sort(function (a, b) { return b.need - a.need; }).forEach(function (w) {
      var n = Math.ceil(w.need / w.fund.dailyLimit);
      if (n > days) days = n;              // 完工时间由**最慢的那一类**决定
      daily.push({ category: w.category, fund: w.fund, perDay: w.fund.dailyLimit,
                   amount: round(w.need), days: n });
    });

    // ⚠️ 现金填不满全部缺口要**说出来**。装作没这回事,你会以为
    //    「照做了怎么还是不达标」。差额得靠后面几个月的工资。
    return { mode: 'monthly', today: today, daily: daily, skipped: skipped,
             spentToday: round(spent), daysNeeded: days,
             shortfall: round(Math.max(0, totalNeed - cash)),
             cashAvailable: round(cash), cashLeft: round(Math.max(0, cash - spent)) };
  }

  // ---------------- 年度:买卖两侧 ----------------

  /**
   * ⚠️ 卖出有三条约束,少一条这份清单就不能照着做:
   *
   *    1. **锁仓的不能卖** —— settings.locked 里带解锁日,没到期就跳过,
   *       而且要在结果里说出来(不是静默少卖一笔,那会让金额对不上)
   *    2. **退役中的先卖** —— status='phasing_out' 的基金本来就要清掉,
   *       优先从它出货,一举两得
   *    3. **卖不超过实际持仓** —— 一个类别下几只基金,逐只扣减,
   *       别算出「卖 50 万」而某只只有 20 万
   *
   * ⚠️ 短期赎回费我们**算不了**:没有申购日期。所以只提醒一句,不假装算得准。
   */
  function planAnnual(snap, settings, today) {
    var sm = Portfolio.summarize(snap, settings);
    var cash = Portfolio.investableCash(snap, settings);
    var band = settings.band != null ? settings.band : 0.05;   // 绝对偏差带,默认 5 个点
    var primary = primaryOf(settings.funds, snap.holdings);
    var byCode = {};
    (settings.funds || []).forEach(function (f) { byCode[f.code] = f; });
    var locked = {};
    (settings.locked || []).forEach(function (l) {
      if (!today || l.unlockDate > today) locked[l.fundCode] = l;
    });

    // 年度这一刀不动现金:卖多少就买多少,现金留在原地。
    // 拿现金一起算的话,「再平衡」和「投新钱」两件事混在一起,
    // 事后完全看不出这一刀到底调了什么。
    //
    // ⚠️ **偏差带只筛「卖谁」,不筛「买谁」。**
    //    两边都用带子过滤的话会出现「卖了没处买」:
    //    某一类超配 5.4 个点被卖掉,而欠配的几类各差 1~4 个点、都够不着带子,
    //    于是买入清单是空的,卖出来的钱凭空消失 ——
    //    而界面上还写着「卖多少买多少」。
    //    正确语义是:**够不够得着带子决定要不要动手;一旦动手,
    //    钱就该回到所有欠配的地方去。**
    //
    // ⚠️ 分母用 sm.total(组合总额),和 gaps 一个口径。
    //    第一版这里写的是 sm.invested(不含现金),于是同一个「偏差几个点」
    //    在两处算出不同的值 —— 而带子是「动不动手」的开关,
    //    差一点点就是差一整次再平衡。
    var g = gaps(sm);
    var over = [], under = [], skipped = [];
    g.forEach(function (x) {
      if (x.need < 0) {
        if (-x.need / (sm.total || 1) < band) return;   // 超配不到一个带,不折腾
        over.push(x);
      } else if (x.need > 1) {
        under.push(x);                                   // 欠配的全都接钱,不设门槛
      }
    });

    if (!over.length) {
      return { mode: 'annual', inBand: true, band: band, sells: [], buys: [],
               amount: 0, note: '没有哪一类超配到 ' + Math.round(band * 100) +
                                ' 个点,这次不用卖' };
    }

    // 卖:超配最多的先卖,同一类里退役基金优先出货
    var sells = [], raised = 0;
    over.sort(function (a, b) { return a.need - b.need; }).forEach(function (x) {
      var left = -x.need;
      var codes = Object.keys(snap.holdings || {}).filter(function (c) {
        return byCode[c] && byCode[c].category === x.category;
      }).sort(function (a, b) {
        // ⚠️ **非主基金先卖。** 你想清掉的通常正是那些历史遗留的份额
        //    (买错了类型、换过渠道、以前的备胎),而现在在用的那只该留着。
        //    早先这里看的是 status==='phasing_out' 这个单独的标记,
        //    但「想清掉」和「不是主」在实践中永远是同一批基金 ——
        //    与其让人维护两个标记,不如从一个推出来。
        // ⚠️ **非主的先卖。** 你想清掉的通常正是历史遗留的那些份额
        //    (买错了类型、换过渠道、以前的备胎),现在在用的那只该留着。
        var pri = primary[x.category] || {};
        var pa = a === pri.code ? 1 : 0;
        var pb = b === pri.code ? 1 : 0;
        if (pa !== pb) return pa - pb;
        return (snap.holdings[b] || 0) - (snap.holdings[a] || 0);
      });
      codes.forEach(function (c) {
        if (left < 1) return;
        var have = snap.holdings[c] || 0;
        if (locked[c]) {
          skipped.push({ fund: byCode[c], why: '锁到 ' + locked[c].unlockDate + ',这次卖不了',
                         locked: locked[c].amount });
          have = Math.max(0, have - locked[c].amount);
        }
        var amt = Math.min(left, have);                 // 卖不超过实际持仓
        if (amt < 1) return;
        sells.push({ category: x.category, fund: byCode[c], amount: round(amt) });
        left -= amt; raised += amt;
      });
    });

    // 买:卖出来的钱按欠配比例分回去
    var underNeed = under.reduce(function (s, x) { return s + x.need; }, 0);
    var buys = [];
    under.sort(function (a, b) { return b.need - a.need; }).forEach(function (x) {
      var amt = underNeed > 0 ? raised * (x.need / underNeed) : 0;
      if (amt < 1) return;
      var f = primary[x.category];
      if (!f) { skipped.push({ category: x.category, why: '这一类没有可买的基金' }); return; }
      buys.push({ category: x.category, fund: f, amount: round(amt),
                  perDay: f.dailyLimit || null,
                  days: f.dailyLimit ? Math.ceil(amt / f.dailyLimit) : 1 });
    });

    return { mode: 'annual', inBand: false, band: band, sells: sells, buys: buys,
             amount: round(raised), skipped: skipped, cashUntouched: round(cash) };
  }

  // ---------------- 该用哪个 ----------------

  /**
   * ⚠️ 「什么时候该做年度那一刀」不能只看日历,还得看现金 ——
   *    现金见底之后欠配就只能靠卖来修,拖到年底那几个月是白拖的。
   */
  function suggestMode(snap, settings, today, lastAnnual) {
    var cash = Portfolio.investableCash(snap, settings);
    var minBuy = settings.minBuy || 1000;
    if (cash >= minBuy) return { mode: 'monthly', why: '还有 ' + round(cash) + ' 可投,先用新钱填' };

    var sm = Portfolio.summarize(snap, settings);
    var band = settings.band != null ? settings.band : 0.05;
    var worst = 0;
    // ⚠️ 分母是**组合总额**,和 gaps / planAnnual 一个口径。
    //    这里判断「要不要动手」,那边判断「卖谁」——
    //    两处用不同分母就会出现「说该动手了,进去一看没有一类够得着」。
    gaps(sm).forEach(function (x) {
      var d = Math.abs(x.need) / (sm.total || 1);
      if (d > worst) worst = d;
    });
    if (worst >= band) {
      return { mode: 'annual', why: '现金到保底了,而最大偏差 ' +
               (worst * 100).toFixed(1) + ' 个点超过 ' + Math.round(band * 100) + ' —— 只能靠卖来修' };
    }
    return { mode: 'none', why: '现金到保底,偏差也在带子里 —— 这次什么都不用做' };
  }

  return { planMonthly: planMonthly, planAnnual: planAnnual,
           suggestMode: suggestMode, gaps: gaps, primaryOf: primaryOf };
})();

if (typeof module !== 'undefined') module.exports = Allocate;
