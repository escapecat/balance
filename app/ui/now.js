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
  var el, onEntry = null;
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
    var hero = h('div', { class: 'hero' });
    if (withSpark) {
      var sp = sparkline(c.snaps, c.st);
      if (sp) hero.appendChild(sp);
    }
    hero.appendChild(h('div', { class: 'hero-cap' }, ['总资产']));
    hero.appendChild(h('div', { class: 'hero-num' }, ['¥' + money(c.sm.total + c.ext)]));
    // ⚠️ 组合和组合外拆成两格,不挤在一行灰字里 ——
    //    「这两个加起来才是上面那个」这层关系,并排才读得出来。
    //    组合外为 0 时整格不出现:一个写着 ¥0 的格子只会让人以为漏填了。
    var split = h('div', { class: 'hero-split' });
    split.appendChild(h('div', {}, [
      h('span', { class: 'k' }, ['投资组合']),
      h('span', { class: 'v' }, ['¥' + money(c.sm.total)]),
    ]));
    if (c.ext) {
      split.appendChild(h('div', {}, [
        h('span', { class: 'k' }, ['组合外']),
        h('span', { class: 'v' }, ['¥' + money(c.ext)]),
      ]));
    }
    hero.appendChild(split);
    hero.appendChild(h('div', { class: 'hero-sub' }, [
      h('span', { class: 'pill' + (c.stale ? ' warn' : '') }, [
        c.snap.date.slice(5).replace('-', '/') +
        (c.age > 0 ? ' · ' + c.age + ' 天前' : ' · 今天'),
      ]),
    ]));
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
    w.appendChild(heroBlock(c, true));

    if (c.extBlank.length) {
      w.appendChild(h('div', {
        class: 'note', style: 'margin-bottom:12px', onclick: function () { onEntry(); },
      }, [
        c.extBlank.join('、') + ' 还没填过金额,**没算进上面这个数** —— 录入时补一下。',
      ]));
    }

    // ---- 上一期发生了什么 ----
    var prev = c.snaps.length > 1 ? c.snaps[c.snaps.length - 2] : null;
    var d = prev ? Ledger.delta(c.snap, prev) : null;
    if (d && d.change != null) {
      w.appendChild(h('h2', {}, [
        '上一期',
        h('span', { class: 'n' }, [
          prev.date.slice(5).replace('-', '/') + ' → ' + c.snap.date.slice(5).replace('-', '/'),
        ]),
      ]));
      var dl = h('div', { class: 'list' });
      // ⚠️ 分不出来的时候写「—」并说明为什么,**不拿总额倒推**。
      //    倒推出来的曲线和真的长得一模一样,而你会拿它做决定。
      dl.appendChild(statRow('市场涨跌', d.market,
        d.market == null ? '要先记买卖才分得出来' : '钱自己赚的,不含你投进去的'));
      dl.appendChild(statRow('工资 − 花费', d.inflow,
        d.inflow == null ? '同上' : '这段时间净流入组合的钱'));
      dl.appendChild(statRow('总额变化', d.change, '上面两项之和'));
      w.appendChild(dl);
      if (d.market == null) {
        w.appendChild(h('div', { class: 'hint' }, [
          '**记买卖就够了** —— 涨跌和投入是解出来的,一个数都不用手填。',
        ]));
      }
    }

    // ---- 入口 ----
    w.appendChild(h('button', {
      class: 'btn', style: 'margin-top:24px', onclick: function () { onEntry(); },
    }, [c.stale ? '录 ' + monthLabel() + '的数字' : '再录一期']));
    w.appendChild(h('button', {
      class: 'btn ghost', style: 'margin-top:8px', onclick: recordOne,
    }, ['记一笔买卖']));

    // ⚠️ **方案屏必须留一个门。** 主界面不显示清单是你选的,
    //    但没有入口的话,录入那一次看完就再也回不去了 ——
    //    而清单是跨天的:今天买了黄金没买中短债,明天还得找得到它。
    //    以前踩过一次「整页没有一处能点」,不能再踩第二次。
    var open = Todos.open().length;
    w.appendChild(h('button', {
      class: 'link', style: 'margin-top:12px;display:block;width:100%',
      onclick: function () { view = 'plan'; render(); },
    }, [open ? '这个月该做什么 · 还欠 ' + open + ' 件 ›' : '这个月该做什么 ›']));
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

  function render() {
    el.innerHTML = '';
    var w = h('div', { class: 'wrap' });
    var st = Store.get('settings', {}) || {};
    var snaps = Store.get('snapshots', []) || [];
    var snap = Ledger.latest(snaps);

    if (!snap) {
      w.appendChild(h('h1', {}, ['还没有数据']));
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

    w.appendChild(heroBlock(ctx, false));

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

    // ---- 该做什么 ----
    //
    // ⚠️ 计划算出来之后**立刻和待办对账**,再拿对账后的结果渲染 ——
    //    不能一边显示 Allocate 的原始清单、一边另存一份待办。
    //    那样勾掉的那条下次照样出现在清单里,而 todos 里静静记着 done。
    var mode = Allocate.suggestMode(snap, st, today());
    var plan = mode.mode === 'monthly' ? Allocate.planMonthly(snap, st)
             : mode.mode === 'annual' ? Allocate.planAnnual(snap, st, today())
             : null;
    if (plan) Todos.sync(plan, snap.date, today());
    var todoOf = {};
    Todos.all().forEach(function (t) { todoOf[t.id] = t; });

    if (mode.mode === 'monthly') {
      var p = plan;
      if (p.today.length) {
        body.appendChild(h('h2', {}, ['今天可以做完',
          h('span', { class: 'n' }, ['¥' + money(p.spentToday)])]));
        var l1 = h('div', { class: 'list' });
        p.today.forEach(function (t) {
          l1.appendChild(todoRow(todoOf[Todos.keyOf('buy', t.fund.code)], t,
                                 t.fund.name || t.fund.code));
        });
        body.appendChild(l1);
      }
      if (p.daily.length) {
        body.appendChild(h('h2', {}, ['按日投']));
        var l2 = h('div', { class: 'list' });
        p.daily.forEach(function (d) {
          l2.appendChild(todoRow(todoOf[Todos.keyOf('buy', d.fund.code)], d,
                                 (d.fund.name || d.fund.code) + ' · 还要 ' + d.days +
                                 ' 天,共 ¥' + money(d.amount),
                                 d.category));
        });
        body.appendChild(l2);
      }
      if (p.shortfall > 0) {
        body.appendChild(h('div', { class: 'note', style: 'margin-top:12px' }, [
          '现金填不满全部缺口,还差 **¥' + money(p.shortfall) + '** —— 靠后面几个月的钱。',
        ]));
      }
      if (!p.today.length && !p.daily.length) {
        body.appendChild(h('div', { class: 'note' }, ['各类都到位了,这个月不用买。']));
      }
    } else if (mode.mode === 'annual') {
      // ⚠️ 年度这一刀要卖东西,和月度补仓是**完全不同量级的决定**,
      //    所以不直接铺清单,先说清为什么走到这一步。
      body.appendChild(h('h2', {}, ['该做一次再平衡了']));
      body.appendChild(h('div', { class: 'note warn' }, [mode.why]));
      var a = plan;
      var la = h('div', { class: 'list' });
      a.sells.forEach(function (x) {
        la.appendChild(todoRow(todoOf[Todos.keyOf('sell', x.fund.code)], x,
                               x.fund.name || x.fund.code, '卖 ' + x.category));
      });
      a.buys.forEach(function (x) {
        la.appendChild(todoRow(todoOf[Todos.keyOf('buy', x.fund.code)], x,
                               (x.fund.name || x.fund.code) +
                               (x.perDay ? ' · ' + x.days + ' 天投完' : ''),
                               '买 ' + x.category));
      });
      body.appendChild(la);
      (a.skipped || []).forEach(function (s2) {
        body.appendChild(h('div', { class: 'note warn', style: 'margin-top:8px' }, [
          (s2.fund ? (s2.fund.name || s2.fund.code) : s2.category) + ':' + s2.why,
        ]));
      });
      body.appendChild(h('div', { class: 'hint', style: 'margin-top:8px' }, [
        '卖多少买多少,现金不动 —— 这一刀只调比例,不投新钱。' +
        '赎回费算不了(没有申购日期),动手前自己看一眼持有天数。',
      ]));
    } else {
      body.appendChild(h('div', { class: 'note' }, [mode.why]));
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
    var acts = Actions.between(snap.date, null).filter(function (a) { return !a.todoId; });
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
    // ⚠️ 方案屏的出口是「知道了」,不是「再录一期」。
    //    这一屏是**录完之后看的**,再摆一个录入按钮等于邀请你连录两期。
    body.appendChild(h('button', {
      class: 'btn', style: 'margin-top:24px',
      onclick: function () { view = 'home'; render(); },
    }, ['知道了']));

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
    var st = Store.get('settings', {}) || {};
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
            return t.code === f.code && t.kind === kind;
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
    view = pendingPlan ? 'plan' : 'home';
    pendingPlan = false;
    render();
  }

  return { mount: mount, showPlan: showPlan };
})();

if (typeof module !== 'undefined') module.exports = NowUI;
