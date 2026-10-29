// 「现在」—— **五秒内答完:什么状况,该做什么。**
//
// ⚠️ 这是个**一个月只打开一次**的工具,注意力预算极小。
//    所以首屏只有三块:我有多少 · 今天做什么 · 配置偏到哪儿了。
//    别的都往后放 —— 一屏塞五件事和塞零件事,实际效果一样,都是全部忽略。
//
// ⚠️ 数据过期是**常态**,不是错误。一个月开一次,大部分时候看到的都是上个月的数。
//    所以过期时不弹窗、不报红,只把主按钮换成「录这个月的数」,
//    内容降一档灰,顶上一行小字说清「你看到的是哪天的」。

var NowUI = (function () {

  // ⚠️ 两个视图，不是两个页面。
  //    `home` —— 打开 app 看到的：我有多少、上一期发生了什么、两个入口。
  //    `plan` —— **录完一期之后自动进的**：配置偏到哪儿、这一期该买什么。
  //
  //    早先这两块挤在同一屏。问题不是挤，是**时机不对**：
  //    再平衡建议依附于「刚录完一期」这个事件，做完就该结束；
  //    而它常驻首屏的话，一个月里剩下的 29 天你每次打开都被同一份
  //    已经做完的清单挡着，久了就自动忽略 —— 那它该提醒你的时候也提醒不动了。
  var el, onEntry = null, onSettings = null;
  var view = 'home';
  var pendingPlan = false;   // 刚存完一期 —— 下次 mount 直接进方案屏

  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) {
      n.appendChild(typeof c === 'string' ? Dom.text(c) : c);
    });
    return n;
  }

  function money(n) {
    if (n == null || isNaN(n)) return '—';
    var s = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? '−' : '') + s;
  }
  function pct(x) { return (x * 100).toFixed(1) + '%'; }
  function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 864e5); }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) +
           '-' + ('0' + d.getDate()).slice(-2);
  }

  function monthLabel() {
    return today().slice(5, 7).replace(/^0/, '') + ' 月';
  }

  /** 录完一期之后跳过来。app.js 在 EntryUI 的 onDone(true) 里调。
   *
   *  ⚠️ 这里**只是举个手**,不直接改 view —— 因为 app.js 调完它才 mount,
   *     而 mount 要把 view 拨回 home(不然你在方案屏切去统计再切回来,
   *     看到的还是方案屏,而那一屏是「刚录完」的产物,过后再看很莫名)。
   *     直接设 view 的话会被紧接着的 mount 抹掉,showPlan 白调。 */
  function showPlan() { pendingPlan = true; }

  var NS = 'http://www.w3.org/2000/svg';
  /** ⚠️ SVG 得用带命名空间的创建方式。用 createElement 建出来的
   *     在页面上是**看不见的** —— 浏览器当成未知 HTML 标签,不报错也不画。 */
  function sv(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    return n;
  }

  /** 总额走势的缩略线 —— 压在 hero 卡片右下角当背景。
   *
   *  ⚠️ 它是**装饰兼氛围**,不承担读数的职责:没有坐标轴、没有标注,
   *     要看具体数字去统计页。所以两期以下直接不画 ——
   *     两个点连成的一条直线看着像「一直在涨」,而那是没有信息的。
   *
   *  ⚠️ 归一化用 min/max 而不是 0 起点。总额都在 200 万上下浮动,
   *     从 0 起画的话那条线是一条笔直的横线,什么也看不出来。 */
  function sparkline(snaps, st) {
    if (!snaps || snaps.length < 3) return null;
    var pts = snaps.slice(-12).map(function (x) {
      return Portfolio.sum(x.holdings) + Portfolio.sum(x.cash);
    });
    var lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts);
    if (!(hi > lo)) return null;
    var W = 150, H = 40;
    var d = pts.map(function (v, i) {
      var x = (i / (pts.length - 1)) * W;
      var y = H - ((v - lo) / (hi - lo)) * (H - 4) - 2;
      return (i ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'hero-spark',
                          'aria-hidden': 'true', preserveAspectRatio: 'none' });
    svg.appendChild(sv('path', {
      d: d + ' L' + W + ',' + H + ' L0,' + H + ' Z',
      fill: 'rgba(255,255,255,.10)', stroke: 'none',
    }));
    svg.appendChild(sv('path', {
      d: d, fill: 'none', stroke: 'rgba(255,255,255,.45)', 'stroke-width': '1.5',
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }));
    return svg;
  }

  /** 总额卡片 —— 两个视图共用。
   *  ⚠️ 早先 now.js 和 history.js 各写了一遍,改了一边另一边就成了
   *     「新背景 + 旧结构」。同一个视觉块只许有一处定义。 */
  function heroBlock(c, withSpark) {
    var hero = Dom.hero(c.sm.total, c.ext, '总资产 · 含组合外');
    if (withSpark) { var sp = sparkline(c.snaps, c.st); if (sp) hero.appendChild(sp); }
    hero.appendChild(h('div', { class: 'hero-sub' }, [c.snap.date + ' 盘点 · 非实时余额']));
    return hero;
  }

  /** 主界面 —— **回顾 + 两个入口**,没有清单。
   *
   *  ⚠️ 这里放「上一期发生了什么」而不是「接下来该做什么」,是刻意的分工:
   *     该做什么依附于「刚录完一期」那个瞬间,做完就结束(在方案屏);
   *     而发生了什么是**每次打开都值得看一眼**的 —— 它不会因为你看过就失效。
   *
   *  ⚠️ 主角是「市场涨跌」,因为**这个数别处拿不到**。
   *     基金 app 只告诉你总额变了多少,而那个数混着你自己投进去的钱 ——
   *     总额涨了五万多,其中哪部分是赚的、哪部分是你搬进去的,只有这儿分得开。
   */
  function renderHome(w, c) {
    w.className = 'wrap dashboard';
    w.appendChild(h('h1', {}, ['现在']));
    w.appendChild(heroBlock(c, true));
    w.appendChild(h('div', { class: 'button-pair home-actions' }, [
      h('button', { class: 'btn', onclick: onEntry }, [c.stale ? '录这个月的数字' : '录入最新余额']),
      h('button', { class: 'btn ghost', onclick: function () { view = 'plan'; render(); } }, ['这个月该做什么 ›']),
    ]));
    w.appendChild(h('button', { class: 'link quick-record', onclick: recordOne }, [Dom.icon('plus'), '记一笔买卖']));
    if (c.extBlank.length) w.appendChild(h('div', { class: 'note', onclick: onEntry }, [c.extBlank.join('、') + ' 还没填金额，点此补录。']));
    var prev = c.snaps.length > 1 ? c.snaps[c.snaps.length - 2] : null;
    var d = prev ? Ledger.delta(c.snap, prev) : null;
    if (d) {
      w.appendChild(h('div', { class: 'section-heading' }, [h('h2', {}, ['这一期']), h('span', { class: 'hint' }, [prev.date.slice(5) + ' — ' + c.snap.date.slice(5)])]));
      w.appendChild(h('div', { class: 'metric-grid' }, [
        h('div', { class: 'metric-card' }, [h('span', {}, ['投资盈亏']), h('b', { class: 'amount' }, [Dom.signed(d.market)]), h('small', {}, [d.market == null ? '买卖不全，盈亏未知' : '已剔除买卖本金'])]),
        h('div', { class: 'metric-card' }, [h('span', {}, ['外部净流入']), h('b', { class: 'amount' }, [Dom.signed(d.inflow)]), h('small', {}, ['由现金与买卖推算'])]),
      ]));
      w.appendChild(h('div', { class: 'hint', style: 'margin-top:8px' }, ['组合总额变化 ' + Dom.signed(d.change) + ' · 现金类利息未单列，不等于工资减花费。']));
    }
    var pending = Actions.between(c.snap, null).filter(function (a) { return Actions.MONEY[a.kind]; });
    if (pending.length) {
      var pendingBox = h('div', { class: 'coverage-note pending-note' }, [
        h('b', {}, [c.snap.date.slice(5).replace('-', '/') + ' 盘点后已记 ' + pending.length + ' 笔,待下次对账']),
        h('div', { class: 'hint' }, ['已保存，不用重复记。余额仍是盘点时的数，买卖不改写上一期收益；下次照实抄余额，不要手动加减买入金额。']),
        h('button', { class: 'link', onclick: function () {
          Modal.note({ title: '盘点后已记 · 待下次对账', body: pending.map(function (f) {
            return f.date + ' ' + (f.kind === 'sell' ? '卖出' : f.kind === 'dividend' ? '现金分红' : '买入') + ' ' + (f.category || f.code || '未分类') + ' ¥' + money(f.amount);
          }).join('\n') + '\n有待对账买卖时，先核对余额，再生成新方案。' });
        } }, ['查看这 ' + pending.length + ' 笔记录 ›']),
      ]);
      w.appendChild(pendingBox);
    }
    if (typeof Sync !== 'undefined' && Sync.ready() && Sync.cfg().dirty)
      w.appendChild(h('div', { class: 'note warn' }, ['有改动还没推到云端，请到设置同步。同步不是独立备份。']));
    var key = Allocate.contextKey(c.snap, c.st);
    var open = Todos.open().filter(function (t) {
      return t.version === 3 && t.contextKey === key && t.executionDate === today() &&
        (t.kind !== 'sell' || Strategy.approved(c.snap, c.st, today()));
    }).length;
    if (open) w.appendChild(h('div', { class: 'hint' }, ['本次计划还有 ' + open + ' 项未记录成交。']));
    reviewCard(w, c);
    var allocation = h('details', { class: 'secondary-details' }, [h('summary', {}, ['盘点时的配置 · 全部 ' + c.sm.rows.length + ' 类'])]);
    c.sm.rows.forEach(function (r) {
      allocation.appendChild(h('div', { class: 'allocation-row', style: '--c:' + Palette.color(r.category) }, [
        h('span', {}, [h('i', { class: 'dot' }), r.category]),
        h('div', { class: 'allocation-track' }, [h('i', { style: 'width:' + Math.min(100, r.pct * 100) + '%' }),
          r.target != null ? h('span', { class: 'target-marker', style: 'left:' + r.target * 100 + '%' }) : '']),
        h('span', { class: 'small' }, [pct(r.pct) + ' / ' + (r.target == null ? '无目标' : pct(r.target))]),
      ]));
    });
    allocation.appendChild(h('div', { class: 'hint' }, ['当前 / 目标占比；竖线是目标。待对账交易未计入，不是实时配置。']));
    w.appendChild(allocation);
    w.appendChild(h('div', { class: 'hint footer-note' }, ['完整买卖记录起点：' + (Actions.since() || '尚未声明') + ' · 更早收益不猜算']));
  }

  /** 一行数字 —— 正负用颜色区分,分不出来的写「—」。 */
  function statRow(label, v, sub) {
    return h('div', { class: 'list-row' }, [
      h('div', { class: 'body' }, [
        h('div', { class: 'ttl' }, [label]),
        h('div', { class: 'sub2' }, [sub]),
      ]),
      h('div', {
        class: 'amt' + (v == null ? ' dim' : v > 0 ? ' up' : v < 0 ? ' down' : ''),
      }, [v == null ? '—' : (v > 0 ? '+' : '') + money(v)]),
    ]);
  }

  function removeAct(a) {
    Modal.confirm({ title: '删除这条误记的买卖？',
      body: a.date + ' · ' + (a.category || a.code) + ' · ¥' + money(a.amount) +
        '。仅在这笔交易实际没有发生时删除。真实成交不能当误记删掉。', ok: '删除误记', danger: true,
    }).then(function (yes) {
      if (!yes) return;
      var todo = Todos.all().filter(function (t) { return t.id === a.todoId && (a.planKey ? t.contextKey === a.planKey : t.lastSnap === a.planDate); })[0];
      if (todo) Todos.undo(todo.id); else Actions.remove(a.id);
      render();
    });
  }

  function reviewCard(w, c) {
    var sc = Strategy.schedule(c.st, today());
    var annual = sc.annualDue || sc.annualRecheck;
    var box = h('div', { class: 'policy-card' }, [h('b', {}, ['新钱每月补仓 · 正式调整每年评估'])]);
    box.appendChild(h('div', { class: 'hint' }, [!sc.configured ? '还没设首次年度检查日。日常补仓仍可用，不会自动卖出。'
      : sc.annualRecheck ? '上次年度计划尚未执行完，日期或余额已变化；重新检查后才能继续。'
      : sc.annualDue ? '年度检查已到期；先检查，不代表必须交易。'
      : sc.halfDue ? '半年中途检查已到期；只留痕，不自动交易。'
      : '年度检查 ' + sc.annualDate + (sc.halfDate ? ' · 半年提醒 ' + sc.halfDate : '')]));
    box.appendChild(h('button', { class: 'link', onclick: function () {
      if (!sc.configured) { onSettings(); return; }
      view = annual ? 'annual' : 'half'; render();
    } }, [!sc.configured ? '去设置检查日 ›' : annual ? '开始年度检查 ›' : sc.halfDue ? '开始半年检查 ›' : '查看检查安排 ›']));
    w.appendChild(box);
  }

  function pendingRows(w, pending) {
    pending.forEach(function (a) {
      w.appendChild(h('button', { class: 'history-card', onclick: function () { removeAct(a); } }, [
        h('b', {}, [(a.kind === 'sell' ? '已记卖出 ' : a.kind === 'dividend' ? '已记现金分红 ' : '已记买入 ') + (a.category || a.code)]),
        h('div', { class: 'hint amount' }, [a.date + ' · ¥' + money(a.amount) + ' · 点击核对误记；不要重复记录']),
      ]));
    });
  }

  function renderExecution(w, c) {
    var date = today(), key = Allocate.contextKey(c.snap, c.st), pending = Strategy.pending(c.snap);
    if (c.stale || c.snap.date > date || Allocate.configurationIssue(c.st)) {
      w.appendChild(h('div', { class: 'note warn' }, [c.stale || c.snap.date > date ? '余额不是近期有效盘点，先更新真实余额；本页不生成可执行计划。' : Allocate.configurationIssue(c.st) + '；暂不生成计划。']));
      return false;
    }
    if (pending.some(function (a) { return a.planKey !== key || a.date !== date; })) {
      w.appendChild(h('div', { class: 'note warn' }, ['有待对账买卖，先录入已包含这些交易的真实余额，再生成新方案。不要重复执行旧余额的建议。']));
      pendingRows(w, pending);
      w.appendChild(h('button', { class: 'btn', onclick: onEntry }, ['录入最新余额']));
      return false;
    }
    if (pending.length) w.appendChild(h('div', { class: 'note' }, ['以下仍是本次盘点的同一份计划，做过的已保留。全部成交并到账后更新余额，不会把剩余待投资金自动变成新买入。']));
    var approved = Strategy.approved(c.snap, c.st, date);
    var mode = Allocate.suggestMode(c.snap, c.st);
    var plan = approved ? Allocate.planAnnual(c.snap, c.st, date)
      : mode.mode === 'monthly' ? Allocate.planMonthly(c.snap, c.st, date, Actions.all().filter(function (f) { return f.planKey !== key; })) : null;
    if (!plan) { w.appendChild(h('div', { class: 'note' }, [mode.why])); return; }
    Todos.sync(plan, c.snap.date, date);
    var by = {}; Todos.all().forEach(function (t) { by[t.id] = t; });
    if (approved) {
      w.appendChild(h('h2', {}, ['已确认的年度卖出计划']));
      w.appendChild(h('div', { class: 'note warn' }, ['只生成卖出待办，不是成交。授权仅对今天当前盘点和配置有效；隔天或数据变化后重新检查。卖出款实际到账、重新盘点后，才按新余额与申购限制计算买入。']));
      var sells = h('div', { class: 'list' });
      plan.sells.forEach(function (x) { sells.appendChild(todoRow(by[Todos.keyOf('sell', x.fund.code)], x, x.fund.name || x.fund.code, '卖 ' + x.category)); });
      w.appendChild(sells); return;
    }
    var hero = h('div', { class: 'strategy-summary' }, [
      h('span', { class: 'hint' }, ['本次建议买入 · 已考虑基金限额']),
      h('div', { class: 'strategy-amount amount' }, ['¥' + money(plan.spentToday)]),
      h('div', { class: 'hint' }, ['本次分配 ¥' + money(plan.budget) + ' · 受限待投 ¥' + money(plan.restrictedAmount)]),
    ]);
    w.appendChild(h('h2', {}, ['日常新钱补仓 · 只买不卖'])); w.appendChild(hero);
    w.appendChild(h('div', { class: 'cash-breakdown' }, [
      h('span', {}, ['盘点现金 ¥' + money(c.sm.cash)]), h('span', {}, ['保留 ¥' + money(c.sm.cash - plan.cashAvailable)]),
      h('span', {}, ['可投 ¥' + money(plan.cashAvailable)]),
    ]));
    w.appendChild(h('div', { class: 'hint' }, ['按盘点现金合计计算；现金赎回、到账和实际下单由你自行安排。']));
    plan.rows.filter(function (r) { return r.budget > 0; }).forEach(function (r) {
      var card = h('section', { class: 'equation-card' }, [
        h('h2', {}, [r.category]),
        h('div', { class: 'hint' }, ['目标缺口 ¥' + money(r.need) + ' · 本次分配 ¥' + money(r.budget)]),
      ]);
      if (r.today > 0) card.appendChild(todoRow(by[Todos.keyOf('buy', r.fund.code)], { category: r.category, amount: r.today }, [r.fund.name || r.fund.code, r.limit.platform].filter(Boolean).join(' · '), '建议买 ' + r.category));
      else card.appendChild(h('div', { class: 'equation-row' }, [h('span', {}, ['建议买入']), h('b', {}, ['¥0'])]));
      if (r.restricted) card.appendChild(h('div', { class: 'pending-label' }, ['受限待投 ¥' + money(r.restricted) + ' · ' + r.limit.why]));
      w.appendChild(card);
    });
    if (plan.pendingAmount) w.appendChild(h('div', { class: 'note' }, ['待投资金仍是现金，不算已补齐，不自动改买其他类别。下次补仓核实限制再计算；若连续多期受限，评估同指数其他通道，不承诺固定几天买完。']));
    if (!plan.rows.length) w.appendChild(h('div', { class: 'note' }, ['当前没有可补的类别缺口。']));
    if (plan.restrictedAmount) w.appendChild(h('button', { class: 'btn ghost', onclick: onSettings }, ['去设置核实基金与交易限制']));
    if (plan.shortfall > 0) w.appendChild(h('div', { class: 'hint', style: 'margin-top:12px' }, ['全部目标缺口仍差 ¥' + money(plan.shortfall) + '，不靠卖出旧仓填本月预算。']));
  }

  function renderReview(w, c) {
    var date = today(), sc = Strategy.schedule(c.st, date), half = view === 'half', checks = [false, false, false];
    w.appendChild(Dom.backBar(half ? '半年检查' : '年度评估', function () { view = 'home'; render(); }));
    w.appendChild(h('p', { class: 'sub' }, [half ? '检查不是交易；不因检查完成生成买卖' : '日期到期只是检查入口，不代表必须卖出']));
    w.appendChild(h('div', { class: 'policy-card' }, [h('b', {}, [sc.configured ? '年度 ' + sc.annualDate + (sc.halfDate ? ' · 半年 ' + sc.halfDate : '') : '尚未设置首次检查日'])]));
    var why = Strategy.block(c.snap, date) || Allocate.configurationIssue(c.st);
    if (why) { w.appendChild(h('div', { class: 'note warn' }, [why])); w.appendChild(h('button', { class: 'btn', onclick: onEntry }, ['录入最新余额'])); }
    else if (half) {
      var done = h('button', { class: 'btn', disabled: 'disabled', onclick: function () {
        if (!checks.every(Boolean)) return;
        finishReview('half', 'checked', c);
      } }, ['本次已检查，不交易']);
      ['生活与应急现金足够，近期用途没有变化', '目标配置仍符合自己的风险承受能力', '已看过偏离与交易限制，不需要自动买卖'].forEach(function (label, i) {
        w.appendChild(h('label', { class: 'review-check' }, [h('input', { type: 'checkbox', onchange: function (e) { checks[i] = e.target.checked; done.disabled = !checks.every(Boolean) || !sc.halfDue; } }), h('span', {}, [label])]));
      });
      if (!sc.halfDue) w.appendChild(h('div', { class: 'note' }, ['半年检查尚未到期或已经记过。本页可查看安排，不会重复留痕。']));
      w.appendChild(done);
    } else {
      var a = Allocate.planAnnual(c.snap, c.st, date), newMoney = Allocate.suggestMode(c.snap, c.st).mode === 'monthly';
      w.appendChild(h('div', { class: 'note' }, [newMoney ? '先投新钱，暂不卖旧仓。成交到账、更新余额后再评估是否还需要卖出。' : a.inBand ? '各类超配未越过偏差带，本次无需生成卖出。' : '有类别超过偏差带；先看预览，是否交易由你确认。']));
      if (!newMoney) {
        a.sells.forEach(function (x) { w.appendChild(h('div', { class: 'equation-row' }, [h('span', {}, ['预览卖出 · ' + x.category]), h('b', {}, ['¥' + money(x.amount)])])); });
        if (a.buys.length) {
          w.appendChild(h('h2', {}, ['到账后的资金去向 · 仅预览']));
          a.buys.forEach(function (x) { w.appendChild(h('div', { class: 'equation-row' }, [h('span', {}, [x.category]), h('b', {}, ['约 ¥' + money(x.amount)])])); });
          w.appendChild(h('div', { class: 'hint' }, ['这不是买入待办。真实卖出金额、到账、费用与届时限购都会影响下一步；受限部分可能暂留现金。']));
        }
        if (a.retainedCash > 0) w.appendChild(h('div', { class: 'equation-row' }, [h('span', {}, ['预留现金']), h('b', {}, ['约 ¥' + money(a.retainedCash)])]));
        (a.skipped || []).forEach(function (x) { w.appendChild(h('div', { class: 'note warn' }, [(x.fund ? x.fund.name || x.fund.code : x.category) + '：' + x.why])); });
      }
      if ((sc.annualDue || sc.annualRecheck) && !newMoney && a.sells.length) w.appendChild(h('button', { class: 'btn', onclick: function () {
        Modal.confirm({ title: '确认生成年度卖出计划？', body: '请先核对锁定期、赎回费用与资金到账。确认仅生成卖出待办，不是已经成交。卖出款到账并更新余额后才算买入；限购时可能继续持有待投资金。', ok: '确认生成卖出计划' }).then(function (yes) { if (yes) finishReview('annual', 'approved', c); });
      } }, ['预览确认后，生成卖出计划']));
      if (sc.annualDue || sc.annualRecheck) w.appendChild(h('button', { class: 'btn ghost', onclick: function () {
        Modal.confirm({ title: '本次检查完成，暂不交易？', body: '只记录检查结果，并安排下一次年度检查；不写买卖流水。', ok: '确认检查完成' }).then(function (yes) { if (yes) finishReview('annual', 'no-trade', c); });
      } }, ['检查完成，暂不交易']));
    }
  }
  function finishReview(kind, decision, c) {
    // 弹窗期间数据可能从另一设备更新，旧上下文不能用来签发授权。
    var snap = Ledger.latest(Store.get('snapshots', []) || []), settings = Config.get();
    if (Allocate.contextKey(snap, settings) !== Allocate.contextKey(c.snap, c.st)) { Modal.note({ title: '余额或配置已变化', body: '请重新打开检查，不复用旧预览。' }); render(); return; }
    var r = Strategy.review(kind, decision, snap, settings, today());
    if (!r.ok) { Modal.note({ title: '还不能记为完成', body: r.why }); return; }
    view = decision === 'approved' ? 'plan' : 'home'; render();
  }

  var lastView = null;   // 换了一屏才回顶部，重渲染不动

  function render() {
    el.innerHTML = '';
    // 换了一屏就回到顶部。⚠️ 只在**视图真的变了**时做 ——
    // 每次 render 都做的话，勾一条待办都会把你弹回顶部。
    var vNow = String(view);
    if (vNow !== lastView) { lastView = vNow; Dom.toTop(); }
    var w = h('div', { class: 'wrap' });
    var st = Config.get();
    var snaps = Store.get('snapshots', []) || [];
    var snap = Ledger.latest(snaps);

    if (!snap) {
      w.appendChild(h('h1', {}, ['还没有数据']));
      w.className = 'wrap wrap-fill';   // 空状态：把 tab 栏以上占满，内容居中
      w.appendChild(h('div', { class: 'empty' }, [
        h('div', { class: 'big' }, ['📊']),
        h('div', { style: 'font-weight:600' }, ['先录一期,或者导入备份']),
        h('div', { class: 'hint', style: 'margin-top:8px' },
          ['录一期就是把基金 app 里那几个数字抄进来,大概两分钟']),
      ]));
      w.appendChild(h('button', { class: 'btn', onclick: function () { onEntry(); } },
                      ['录第一期']));
      el.appendChild(w);
      return;
    }

    var age = daysBetween(snap.date, today());
    var stale = age > 25;
    var sm = Portfolio.summarize(snap, st);
    // ⚠️ 组合外的资产**可能一次都没填过金额**(迁移只带进来了名字)。
    //    那时候是 null 不是 0 —— 直接当 0 加起来会让总额少一大截,
    //    而页面上完全看不出少了什么。所以空的要单独数出来、说出来。
    var extT = Assets.total(snap);
    var ext = extT.sum, extBlank = extT.blank;

    // ---- 分派 ----
    // 公共部分(总额、过期判断、组合外)算完之后再分岔 ——
    // 两个视图都要用这几个数,各算一遍迟早会算出两个不一样的总额。
    var ctx = { st: st, snaps: snaps, snap: snap, sm: sm, ext: ext,
                extBlank: extBlank, age: age, stale: stale };
    if (view === 'home') { renderHome(w, ctx); el.appendChild(w); return; }
    if (view === 'half' || view === 'annual') { renderReview(w, ctx); el.appendChild(w); return; }

    w.appendChild(Dom.backBar('补仓与执行建议', function () { view = 'home'; render(); }));
    w.appendChild(h('p', { class: 'sub' }, [snap.date + ' 盘点 · 组合 ¥' + money(sm.total) + ' · 非实时余额']));

    if (extBlank.length) {
      w.appendChild(h('div', {
        class: 'note', style: 'margin-bottom:12px', onclick: function () { onEntry(); },
      }, [
        extBlank.join('、') + ' 还没填过金额,**没算进上面这个数** —— 录入时补一下。',
      ]));
    }

    if (stale) {
      w.appendChild(h('button', { class: 'btn', onclick: function () { onEntry(); } },
                      ['录 ' + monthLabel() + '的数字']));
      w.appendChild(h('div', { class: 'hint', style: 'text-align:center;margin-bottom:16px' }, [
        '下面看到的是 ' + snap.date + ' 的旧数据',
      ]));
    }

    var body = h('div', stale ? { style: 'opacity:.6' } : {});

    if (renderExecution(body, ctx) === false) {
      w.appendChild(body); el.appendChild(w); return;
    }

    // ---- 配置 ----
    body.appendChild(h('h2', {}, ['配置']));
    var lc = h('div', { class: 'list' });
    sm.rows.sort(function (a, b) {
      // 偏得最多的排前面 —— 这一页是用来「看哪儿不对」的,不是用来看排名的
      var da = a.gap == null ? -1 : Math.abs(a.gap);
      var db = b.gap == null ? -1 : Math.abs(b.gap);
      return db - da;
    }).forEach(function (r) {
      var row = h('div', { class: 'list-row' });
      // 类别色从 data/palette.js 来,行内设成 --c,条和点共用同一个值。
      // ⚠️ 不在这里写死颜色 —— 写死的话深色模式跟不上,而且饼图那边会各写一套。
      var b2 = h('div', { class: 'body', style: '--c:' + Palette.color(r.category) }, [
        h('div', { class: 'ttl' }, [
          h('i', { class: 'dot' }),
          r.category + (r.unknown ? '(未分类)' : ''),
        ]),
      ]);
      if (r.target != null) {
        // 条的长度 = **相对目标的完成度**(12.4% / 20% = 62%),不是占总资产的比例。
        // 后者在六个类别之间长度差得太小,一眼分不出谁欠得多 ——
        // 而这一页存在的理由就是「一眼看出哪儿不对」。
        //
        // 超配的条子用暖色:同样是「满格」,一个是到位了、一个是溢出了,
        // 光看长度分不出来 —— 而这两件事要采取的行动正好相反。
        var over = r.gap < 0;
        var fill = r.target > 0 ? Math.min(100, r.pct / r.target * 100) : 0;
        b2.appendChild(h('div', { class: 'bar' + (over ? ' over' : '') },
                        [h('i', { style: 'width:' + fill + '%' })]));
        b2.appendChild(h('div', { class: 'sub2' }, [
          pct(r.pct) + ' / ' + pct(r.target) +
          (Math.abs(r.gap) > 500 ? ' · ' + (over ? '超 ' : '缺 ') + money(Math.abs(r.gap)) : ''),
        ]));
      } else {
        b2.appendChild(h('div', { class: 'sub2' }, [
          pct(r.pct) + ' · 不在目标比例里 —— 去设置补一条',
        ]));
      }
      row.appendChild(b2);
      row.appendChild(h('div', { class: 'amt' }, [
        h('span', { class: 'u' }, ['¥']), money(r.value),
      ]));
      lc.appendChild(row);
    });
    body.appendChild(lc);

    // ---- 本期已记的买卖 ----
    //
    // ⚠️ **记完之后必须看得见,而且必须能删。**
    //    早先只有「记一笔」这个入口:记完就沉进 flows[] 再也见不到。
    //    金额敲错一位、买卖点反、同一笔手滑记两遍 —— 一个都发现不了,
    //    而每一条都会直接歪掉「工资−花费」和「市场涨跌」这两个数
    //    (漏记 5 万 = 凭空多 5 万花费 + 凭空多 5 万浮盈,总额还对得上)。
    //    core/actions.js 里 remove() 早就写好了,只是从来没人调用它。
    // ⚠️ 只列**清单外**的。清单上的那几条勾掉之后自己就变成已完成
    //    (划线、变灰),在这儿再列一遍就是同一笔显示两次 ——
    //    而两处金额一旦看着不一样(比如清单显示计划数、这儿显示实际数),
    //    你根本不知道该信哪个。
    //    带 todoId 的就是从清单勾掉的,过滤掉。
    var acts = Actions.between(snap, null).filter(function (a) { return !a.todoId; });
    if (acts.length) {
      var nb = 0;
      acts.forEach(function (a) { nb += (a.kind === 'sell' ? -1 : 1) * a.amount; });
      // ⚠️ 标题说「已经做了」,不能只叫「这一期记的买卖」——
      //    这一屏叫「该做什么」,里面冒出一份买卖清单,
      //    第一眼分不清是「建议你买」还是「你买过了」。
      // 叫「清单外记的」而不是「已经做了」—— 清单上勾掉的那几条
      // 也是「已经做了」,却不在这个列表里,两个名字对不上会让人以为漏了。
      body.appendChild(h('h2', {}, [
        '清单外记的',
        h('span', { class: 'n' }, [acts.length + ' 笔 · 净 ¥' + money(nb)]),
      ]));
      var al = h('div', { class: 'list' });
      acts.slice().sort(function (a, b) {
        return a.date < b.date ? 1 : -1;          // 新的在上面
      }).forEach(function (a) {
        var f = (st.funds || []).filter(function (x) { return x.code === a.code; })[0];
        var row = h('div', { class: 'list-row' });
        row.appendChild(h('div', {
          class: 'body', style: '--c:' + Palette.color(a.category),
        }, [
          h('div', { class: 'ttl' }, [
            h('i', { class: 'dot' }),
            (a.kind === 'sell' ? '卖 ' : '买 ') + a.category,
          ]),
          h('div', { class: 'sub2' }, [
            (f ? (f.name || a.code) : a.code) + ' · ' + a.date.slice(5).replace('-', '/'),
          ]),
        ]));
        row.appendChild(h('div', { class: 'amt' }, [
          h('span', { class: 'u' }, [a.kind === 'sell' ? '−¥' : '¥']), money(a.amount),
        ]));
        row.appendChild(h('button', {
          class: 'act warn', title: '删掉这一笔',
          onclick: function (e) {
            e.stopPropagation();
            Modal.confirm({
              title: '删掉这一笔?',
              // ⚠️ 说清后果。删掉不是「撤销一次误操作」那么轻 ——
              //    它会同时改动这一期的「工资−花费」和「市场涨跌」。
              body: (a.kind === 'sell' ? '卖 ' : '买 ') + a.category + ' ¥' + money(a.amount) +
                    '\n\n删了之后,这笔钱会被重新算进「市场涨跌」—— ' +
                    '真买过的话,数字就错了。',
              danger: true, ok: '删掉',
            }).then(function (yes) {
              if (!yes) return;
              Actions.remove(a.id);
              render();
            });
          },
        }, ['删']));
        al.appendChild(row);
      });
      body.appendChild(al);
    }

    // ⚠️ 这里**没有「记一笔买卖」按钮** —— 主界面已经有一个了。
    //    清单上的那几条直接点行就能填实际金额;清单外的临时加仓回主界面记。
    //    同一个动作在两屏各摆一个入口,只会让人想「这两个是不是不一样的东西」。

    // ⚠️ **录入的入口必须永远在。**
    //    第一版只有「超过 25 天」才给按钮 —— 而录入不占 tab(它是动作不是地方),
    //    于是刚录完的那 25 天里,想补一笔外部资产、想改抄错的数字,一个入口都没有。
    //    tools/view.js 打出「可点 0」才发现:整页没有一处能点。
    //    不过期的时候用次要样式,别跟「今天该买什么」抢注意力。
    // 方案屏使用顶部统一返回栏；不用滚到页尾才能离开。

    w.appendChild(body);
    el.appendChild(w);
  }

  /** 一条可勾的待办。
   *
   *  @param t      待办(可能还没建出来 —— 首次渲染时 sync 已经建好了,兜底而已)
   *  @param x      计划里的那一项,用来兜底显示
   *  @param sub    副行
   *  @param title  主行,不给就用类别名
   *
   *  ⚠️ 金额**单独一列右对齐**,不塞进标题里。
   *     塞在标题里的话,几行金额长短不一、左边界还被名字顶得七零八落,
   *     扫一眼根本比不出大小 —— 而「今天该买哪个多」正是你要一眼看到的。
   *
   *  ⚠️ 「从 6/26 挂到现在 · 44 天」用**和基金名同一档的灰字**。
   *     不用红、不用 ⚠、不写「你已经拖了」—— 一条挂了 44 天的待办,
   *     更可能说明它本来就不该在清单里,而不是说明你不守信用。
   */
  function todoRow(t, x, sub, title) {
    var ttl = title || ((t && t.kind === 'sell' ? '卖 ' : '买 ') + x.category);
    var body2 = h('div', { class: 'body' }, [h('div', { class: 'ttl' }, [ttl])]);

    var bits = [sub];
    if (t) {
      var days = Todos.pendingDays(t, today());
      if (days != null && days >= 7) bits.push('挂了 ' + days + ' 天');
      if (t.status === 'partial') bits.push('已投 ¥' + money(t.actual));
    }
    body2.appendChild(h('div', { class: 'sub2' }, [bits.filter(Boolean).join(' · ')]));

    var done = t && (t.status === 'done' || t.status === 'resolved');
    var row = h('div', {
      class: 'list-row' + (done ? ' dim' : ''),
      onclick: t ? function () { tapTodo(t); } : null,
    }, [body2]);

    // 金额自成一列 —— 等宽数位,右对齐,一眼可比
    row.appendChild(h('div', { class: 'amt' }, [
      h('span', { class: 'u' }, ['¥']),
      money(x.perDay != null ? x.perDay : x.amount),
      x.perDay != null ? h('span', { class: 'u' }, [' /日']) : '',
    ].filter(function (n) { return n !== ''; })));

    row.appendChild(h('span', { class: 'dim', style: 'width:2.2em;text-align:right' }, [
      !t ? '' :
      t.status === 'done' ? '✓' :
      t.status === 'resolved' ? '达标' :
      t.status === 'dropped' ? '—' : '○',
    ]));
    return row;
  }

  function tapTodo(t) {
    if (t.status === 'held') { Modal.note({ title: '当前不可执行', body: '限制、余额或策略已变化。这不代表已达标；已真实成交的请单独记一笔。' }); return; }
    // 勾待办也会写一笔动作 —— 起点同样默认成最近一期对账日
    if (Actions.needsStart()) {
      var last0 = Ledger.latest(Store.get('snapshots', []) || []);
      Actions.startFrom(last0 ? last0.date : today());
    }
    // ⚠️ 已达标的**不许勾成「做了」**。缺口是市值涨平的,不是你买的 ——
    //    记成 done 会让「说了做了多少 vs 实际投了多少」全错,
    //    而错的方向恰好是让你看起来比实际更自律,于是不会有人怀疑。
    if (t.status === 'resolved') {
      Modal.note({ title: '这条已经达标了',
                   body: '缺口是被市值涨平的,不是你买的 —— 所以不记成「做了」。' });
      return;
    }
    // ⚠️ 已经记过的**不能是死胡同**。原先这里只弹一句「已经记过了」就完了 ——
    //    金额敲错一位、买卖点反、根本没买成,一个都改不了。
    //    而清单外的买卖在「清单外记的」那块能删,清单内的反而不能,
    //    同一件事两种待遇。
    if (t.status === 'done' || t.status === 'partial') {
      Modal.pick({
        title: '已经记过了',
        hint: (t.kind === 'sell' ? '卖' : '买') + ' ' + t.name +
              ' · 实际 ¥' + money(t.actual) + ' · ' + t.doneAt + ' 记的' +
              (t.status === 'partial' ? '(没做完,还剩 ¥' + money(t.target) + ')' : ''),
        options: [
          { key: 'edit', label: '改金额', hint: '敲错了一位就改这个' },
          { key: 'undo', label: '撤销这一笔', danger: true,
            hint: '连同它写的那条流水一起删掉,清单上重新挂回去' },
        ],
      }).then(function (v) {
        if (v === 'edit') { askAmount(t); return; }
        if (v !== 'undo') return;
        Modal.confirm({
          title: '撤销这一笔?',
          // ⚠️ 说清后果:撤销会改动「工资−花费」和「市场涨跌」。
          body: '那条流水会被删掉,这笔钱重新算进「市场涨跌」—— ' +
                '真买过的话,数字就错了。',
          ok: '撤销', danger: true,
        }).then(function (yes) {
          if (!yes) return;
          var r = Todos.undo(t.id);
          if (!r.ok) { Modal.note({ title: '撤不了', body: r.why }); return; }
          render();
        });
      });
      return;
    }
    Modal.pick({
      title: (t.kind === 'sell' ? '卖 ' : '买 ') + t.category,
      hint: t.name + ' · 计划 ¥' + money(t.target),
      options: [
        { key: 'done', label: '做了', hint: '填实际' + (t.kind === 'sell' ? '卖' : '买') + '了多少' },
        { key: 'drop', label: '不做了', hint: '挑个理由,之后不再滚到清单里' },
      ],
    }).then(function (v) {
      if (v === 'done') askAmount(t);
      else if (v === 'drop') askReason(t);
    });
  }

  function askAmount(t) {
    // ⚠️ 金额**必须填**,不给「就按计划数」的快捷键。
    //    实际和计划几乎从不相等(份额、手续费、你临时改主意),
    //    而收益率全靠这个数 —— 一次省事就是一条假的现金流。
    Modal.ask({
      title: '实际' + (t.kind === 'sell' ? '卖' : '买') + '了多少',
      hint: '计划是 ¥' + money(t.target) + '。填真实成交的数,不是计划数',
      type: 'number', suffix: '元',
    }).then(function (v) {
      if (v == null || v === '') return;
      var r = Todos.complete(t.id, parseFloat(v), today());
      if (!r.ok) { Modal.note({ title: '记不下来', body: r.why }); return; }
      render();
    });
  }

  function askReason(t) {
    Modal.pick({
      title: '为什么不做?',
      hint: '记一下,以后回头看得出当时在想什么',
      options: [
        { key: '不需要', label: '不需要', hint: '这一类本来就不该补到这么多' },
        { key: '改主意', label: '改主意了', hint: '目标比例该调了 —— 去设置里改' },
        { key: '做不到', label: '做不到', hint: '限额、锁仓、钱不够' },
      ],
    }).then(function (v) {
      if (!v) return;
      Todos.drop(t.id, v, today());
      render();
    });
  }

  /** 手动记一笔 —— 加仓、补仓、临时卖出。
   *
   *  ⚠️ 三步问完:买还是卖 → 哪只 → 多少钱。**没有第四步。**
   *     这个操作发生在你刚在基金 app 里点完确认的那一刻,
   *     多一步都会让人想「回头再说」,而回头就忘了。
   *
   *  ⚠️ 早先这里还有「现金分红」和「记个决定」两个选项,砍了:
   *     分红记成卖出数学上完全等价(见 core/actions.js 开头),
   *     而纯留痕的选项只会让你每次都要跳过它。
   *     日期一律记今天 —— 隔几天补记是少数情况,真需要时再加回来。
   */
  function recordOne() {
    // 记录的起点默认就是**最近一期对账日** —— 因为你的做法是「买了就录」,
    // 所以从上次对账起,记录天然是全的。不问,直接定。
    if (Actions.needsStart()) {
      var last = Ledger.latest(Store.get('snapshots', []) || []);
      Actions.startFrom(last ? last.date : today());
    }
    var st = Config.get();
    var funds = st.funds || [];
    if (!funds.length) {
      Modal.note({ title: '还没有基金清单', body: '先去设置里加一只。' });
      return;
    }
    Modal.pick({
      title: '记一笔',
      hint: '不记的话,这笔钱下次会被算成「市场涨跌」',
      options: [
        { key: 'buy', label: '买入', hint: '加仓 · 补仓 · 定投' },
        { key: 'sell', label: '卖出', hint: '减仓 · 清仓 · 止盈 · 收到分红也记这儿' },
      ],
    }).then(function (kind) {
      if (!kind) return;
      var snap = Ledger.latest(Store.get('snapshots', []) || []);
      var held = (snap || {}).holdings || {};
      // 持仓大的排前面 —— 你要记的多半就是在用的那只
      var sorted = funds.slice().sort(function (a, b) {
        return (held[b.code] || 0) - (held[a.code] || 0);
      });
      Modal.pick({
        title: kind === 'buy' ? '买的哪一只' : '卖的哪一只',
        options: sorted.map(function (f) {
          return { key: f.code, label: f.name || f.code,
                   hint: f.category + (held[f.code] ? ' · 持有 ' + money(held[f.code]) : '') };
        }),
      }).then(function (code) {
        if (!code) return;
        var f = funds.filter(function (x) { return x.code === code; })[0];
        Modal.ask({
          title: kind === 'buy' ? '买了多少' : '卖了多少',
          hint: (f.name || f.code) + ' · 填**实际成交**的金额,不是计划数',
          type: 'number', suffix: '元',
        }).then(function (v) {
          if (v == null || v === '') return;
          var amt = parseFloat(v);

          // ⚠️ **先看清单上有没有这一条。**
          //    早先这里一律 Actions.add,和「勾掉待办」是两条互不知情的路径:
          //    你照着清单买了黄金、回来点「记一笔买卖」记下来,结果
          //    清单上那条还挂着「买 黄金 四万五」(以为你没做),
          //    下面又多一条「买 黄金 四万五」——
          //    **一个说没做,一个说做了**,而它们说的是同一件事。
          //
          //    Todos.complete 内部会写流水,所以认领之后**不能再 add 一次**,
          //    否则一笔买入记两条,净买入翻倍,「市场涨跌」跟着错。
          var hit = Todos.open().filter(function (t) {
            return t.code === f.code && t.kind === kind && (t.version !== 3 ||
              (t.executionDate === today() && t.contextKey === Allocate.contextKey(Ledger.latest(Store.get('snapshots', []) || []), Config.get())));
          })[0];
          if (hit) {
            var r0 = Todos.complete(hit.id, amt, today());
            if (!r0.ok) { Modal.note({ title: '记不下来', body: r0.why }); return; }
            render();
            return;
          }

          var r = Actions.add({ date: today(), kind: kind, code: f.code,
                                category: f.category, amount: amt });
          if (!r.ok) { Modal.note({ title: '记不下来', body: r.why }); return; }
          render();
        });
      });
    });
  }

  function mount(node, opts) {
    el = node;
    onEntry = (opts || {}).onEntry || function () {};
    onSettings = (opts || {}).onSettings || function () { Modal.note({ title: '到设置核实', body: '设置 → 执行策略 / 基金与交易限制。' }); };
    view = pendingPlan ? 'plan' : 'home';
    pendingPlan = false;
    render();
  }

  return { mount: mount, showPlan: showPlan };
})();

if (typeof module !== 'undefined') module.exports = NowUI;
