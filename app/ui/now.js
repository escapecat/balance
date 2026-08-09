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

  var el, onEntry = null;

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

    // ---- 总额:这一页唯一的主视觉 ----
    //
    // ⚠️ 用 .hero 而不是 h1。别的页面的 h1 是「历史」「设置」这种路牌,
    //    而这里是一个**要被读的数**。同一个样式扛两种角色,哪边都不出彩。
    var hero = h('div', { class: 'hero' });
    hero.appendChild(h('div', { class: 'hero-cap' }, ['总资产']));
    hero.appendChild(h('div', { class: 'hero-num' }, ['¥' + money(sm.total + ext)]));
    // ⚠️ 组合和组合外拆成两格,不再挤在一行灰字里 ——
    //    「这两个加起来才是上面那个」这层关系,并排才读得出来。
    //    组合外为 0 时整格不出现:一个写着 ¥0 的格子只会让人以为漏填了。
    var split = h('div', { class: 'hero-split' });
    split.appendChild(h('div', {}, [
      h('span', { class: 'k' }, ['投资组合']),
      h('span', { class: 'v' }, ['¥' + money(sm.total)]),
    ]));
    if (ext) {
      split.appendChild(h('div', {}, [
        h('span', { class: 'k' }, ['组合外']),
        h('span', { class: 'v' }, ['¥' + money(ext)]),
      ]));
    }
    hero.appendChild(split);
    var sub = h('div', { class: 'hero-sub' });
    sub.appendChild(h('span', { class: 'pill' + (stale ? ' warn' : '') }, [
      snap.date.slice(5).replace('-', '/') + (age > 0 ? ' · ' + age + ' 天前' : ' · 今天'),
    ]));
    hero.appendChild(sub);
    w.appendChild(hero);

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

    // ⚠️ **不通过清单也得能记一笔。**
    //    清单只覆盖「工具建议你做的事」,而你会临时加仓、会看到机会自己买、
    //    会收到一笔分红 —— 这些不记的话,下次对账时它们会被算成「市场涨跌」,
    //    于是收益率错了,而每个数字看着都合理。
    body.appendChild(h('button', {
      class: 'btn ghost', style: 'margin-top:20px', onclick: recordOne,
    }, ['记一笔买卖 / 分红']));

    // ⚠️ **录入的入口必须永远在。**
    //    第一版只有「超过 25 天」才给按钮 —— 而录入不占 tab(它是动作不是地方),
    //    于是刚录完的那 25 天里,想补一笔外部资产、想改抄错的数字,一个入口都没有。
    //    tools/view.js 打出「可点 0」才发现:整页没有一处能点。
    //    不过期的时候用次要样式,别跟「今天该买什么」抢注意力。
    body.appendChild(h('button', {
      class: 'btn ghost', style: 'margin-top:20px',
      onclick: function () { onEntry(); },
    }, [stale ? '再录一期' : '录 ' + monthLabel() + '的数字']));

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
    if (t.status === 'done') {
      Modal.note({ title: '已经记过了',
                   body: '实际 ¥' + money(t.actual) + ',' + t.doneAt + ' 记的。' });
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
          var r = Actions.add({ date: today(), kind: kind, code: f.code,
                                category: f.category, amount: parseFloat(v) });
          if (!r.ok) { Modal.note({ title: '记不下来', body: r.why }); return; }
          render();
        });
      });
    });
  }

  function mount(node, opts) {
    el = node;
    onEntry = (opts || {}).onEntry || function () {};
    render();
  }

  return { mount: mount };
})();

if (typeof module !== 'undefined') module.exports = NowUI;
