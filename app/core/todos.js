// 待办 —— **说了没做要看得见,但不羞辱。**
//
// ⚠️ `id` 稳定是这个文件的地基。「买黄金」这件事这个月和上个月是同一件,
//    只是金额从 68,660 变成了 45,365。id 里含日期或含金额的话,
//    每期都会算成一条崭新的待办,`bornAt` 跟着归零,
//    「挂了多久」永远显示 0 天 —— 这个功能就白做了。
//    tools/check.sh 有一条 grep 直接禁掉 id 里出现 period/ym/date。
//
// ⚠️ **`resolved` 不是 `done`。** 缺口被市值涨平了,那不是你做的。
//    记成「已完成」的话,「说了做了多少 vs 实际投了多少」全是错的,
//    而错的方向恰好是让你看起来比实际更自律。界面上显示成灰字「已达标」。
//
// ⚠️ **勾选即申报,申报即现金流。** 勾的时候填「实际买了多少」,
//    同时往 `flows[]` 写一条。这是整个设计的枢纽:有了分类净流入,
//    才能把「涨了 15,308」和「你又投进去 15,308」分开,才谈得上收益率。
//
// ⚠️ 一条挂了 44 天的待办,**更可能说明它本来就不该在清单里**。
//    所以配一个体面的出口(`drop`),而不是让它一直红着提醒你不守信用。

var Todos = (function () {

  var OPEN = { open: 1, partial: 1 };        // 还欠着的两种状态

  function all() { return Store.get('todos', []) || []; }
  function flows() { return Store.get('flows', []) || []; }

  /** 稳定 key:动作 + 基金代码。**不含日期、不含金额。** */
  function keyOf(kind, code) { return kind + ':' + code; }

  function byKey(list) {
    var m = {};
    (list || []).forEach(function (t) { m[t.id] = t; });
    return m;
  }

  /** 把一份计划和现有待办对账。
   *
   *  @param plan      planMonthly / planAnnual 的返回值
   *  @param snapDate  这份计划依据的快照日期 —— 用来分「代」
   *  @param today     今天
   *
   *  ⚠️ `snapDate` 是「代」的锚。同一期里勾完一笔,计划**不会**跟着变
   *     (快照还是那条),要是不认代,下一次渲染它就又变回 open,
   *     你会以为自己刚才那一下没生效。
   */
  function sync(plan, snapDate, today) {
    var list = all().slice();
    var have = byKey(list);
    var wanted = {};

    function want(kind, x) {
      var id = keyOf(kind, x.fund.code);
      wanted[id] = 1;
      var t = have[id];
      var fresh = {
        id: id, kind: kind, category: x.category, code: x.fund.code,
        name: x.fund.name || x.fund.code,
        target: x.amount, perDay: x.perDay || null, days: x.days || null,
        lastSnap: snapDate,
      };
      if (!t) {
        list.push(Object.assign(fresh, {
          bornAt: today, status: 'open', actual: null, doneAt: null, reason: null,
        }));
        return;
      }
      // ⚠️ 「不做了」的**永远不自动复活**。它是一个决定,不是一次遗漏 ——
      //    自动回来的话,那个体面的出口就成了摆设,你得每个月重新拒绝一次。
      if (t.status === 'dropped') { t.target = x.amount; t.lastSnap = snapDate; return; }

      // 还欠着 → 金额跟着重算,**bornAt 一个字不动**(它记的是「从哪天开始欠的」)
      if (OPEN[t.status]) {
        var wasSnap = t.lastSnap;
        Object.assign(t, fresh);
        // ⚠️ 换了一期,上期填的 `actual` 就过期了 —— 新的 target 已经是**剩下那截**,
        //    再挂着「上次投了 20,000」的话,两个数字对不上,看的人分不清哪个是哪个。
        //    同一期内不动,否则勾完一半会自己变回没勾过。
        if (wasSnap !== snapDate) { t.status = 'open'; t.actual = null; }
        return;
      }

      // done / resolved 且**换了一期** → 新的一轮,上一笔的账已经结清了
      if (t.lastSnap !== snapDate) {
        Object.assign(t, fresh, {
          status: 'open', actual: null, doneAt: null, bornAt: today, reason: null,
        });
        return;
      }
      // done / resolved 且还在同一期 → 保持原样,只是金额跟着显示
      t.target = x.amount;
    }

    (plan.today || []).forEach(function (x) { want('buy', x); });
    (plan.daily || []).forEach(function (x) { want('buy', x); });
    (plan.buys || []).forEach(function (x) { want('buy', x); });
    (plan.sells || []).forEach(function (x) { want('sell', x); });

    // ⚠️ 计划里没有了,但还欠着 → 缺口是被**市值涨平**的,不是你做的。
    //    标 resolved,不标 done。
    list.forEach(function (t) {
      if (!wanted[t.id] && OPEN[t.status]) {
        t.status = 'resolved';
        t.doneAt = today;
      }
    });

    Store.set('todos', list);
    return list;
  }

  /** 勾掉一条。
   *
   *  @param amount  实际买(卖)了多少。**必须填** —— 没有它就写不出现金流,
   *                 而现金流是收益率的唯一来源。
   *
   *  ⚠️ 实际 < 目标 = `partial`,它**下一期还在清单里**,只是金额是剩下那截。
   *     一律记成 done 的话,没投完的那部分从此没人再提。
   */
  function complete(id, amount, today) {
    var list = all().slice();
    var t = list.filter(function (x) { return x.id === id; })[0];
    if (!t) return { ok: false, why: '没有这条待办' };
    if (typeof amount !== 'number' || isNaN(amount)) {
      return { ok: false, why: '得填实际金额 —— 现金流全靠它' };
    }
    if (amount <= 0) return { ok: false, why: '金额得大于 0;真没做就用「不做了」' };

    t.actual = amount;
    t.doneAt = today;
    t.status = amount + 1 < t.target ? 'partial' : 'done';

    Store.set('todos', list);
    appendFlow({ date: today, kind: t.kind, category: t.category,
                 code: t.code, amount: amount, todoId: t.id });
    return { ok: true, status: t.status };
  }

  /** 「不做了」—— 体面的出口。
   *  @param reason  不需要 / 改主意 / 做不到 */
  function drop(id, reason, today) {
    var list = all().slice();
    var t = list.filter(function (x) { return x.id === id; })[0];
    if (!t) return { ok: false, why: '没有这条待办' };
    t.status = 'dropped';
    t.reason = reason || null;
    t.doneAt = today;
    Store.set('todos', list);
    return { ok: true };
  }

  /** 手动让一条「不做了」的重新进清单 —— 下次 sync 时它会照常长出来。 */
  function revive(id, today) {
    var list = all().slice();
    var t = list.filter(function (x) { return x.id === id; })[0];
    if (!t) return { ok: false, why: '没有这条待办' };
    t.status = 'open';
    t.bornAt = today;
    t.reason = null;
    t.doneAt = null;
    Store.set('todos', list);
    return { ok: true };
  }

  /** 挂了多少天。resolved / done 的返回 null —— 那不是「挂着」。 */
  function pendingDays(t, today) {
    if (!OPEN[t.status] || !t.bornAt) return null;
    return Math.round((Date.parse(today) - Date.parse(t.bornAt)) / 864e5);
  }

  function open(list) {
    return (list || all()).filter(function (t) { return OPEN[t.status]; });
  }

  // ---------------- 现金流 ----------------

  /** flow 的 id 只跟序号有关。**不用时间戳** —— 同一秒勾两条会撞,
   *  而撞了之后其中一笔就静默消失了(按 id 去重的地方全中招)。 */
  function newFlowId(list) {
    var n = 1, used = {};
    (list || []).forEach(function (f) { used[f.id] = 1; });
    while (used['f' + n]) n++;
    return 'f' + n;
  }

  function appendFlow(f) {
    var list = flows().slice();
    list.push(Object.assign({ id: newFlowId(list) }, f));
    Store.set('flows', list);
    return list;
  }

  /** 每一类累计投进去多少(买 − 卖)。历史页「钱去哪了」用这个。
   *
   *  ⚠️ 只统计**勾选申报过的**。2026-08 之前没有分类流水,
   *     那几期只有总额 —— 界面上要明写「分类流向从这个月开始才有」,
   *     不许拿总额倒推假数。 */
  function netByCategory() {
    var m = {};
    flows().forEach(function (f) {
      var sign = f.kind === 'sell' ? -1 : 1;
      m[f.category] = (m[f.category] || 0) + sign * f.amount;
    });
    return m;
  }

  return { all: all, flows: flows, keyOf: keyOf, sync: sync,
           complete: complete, drop: drop, revive: revive,
           pendingDays: pendingDays, open: open,
           appendFlow: appendFlow, netByCategory: netByCategory };
})();

if (typeof module !== 'undefined') module.exports = Todos;
