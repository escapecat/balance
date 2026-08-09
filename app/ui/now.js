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

    // ---- 总额 ----
    w.appendChild(h('h1', {}, ['¥' + money(sm.total + ext)]));
    var sub = '组合 ' + money(sm.total) + (ext ? '　组合外 ' + money(ext) : '');
    w.appendChild(h('p', { class: 'sub' }, [
      sub + '　·　' + snap.date.slice(5).replace('-', '月') + '日录的' +
      (age > 0 ? ',' + age + ' 天前' : ''),
    ]));
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
        body.appendChild(h('h2', {}, ['今天可以做完 · ¥' + money(p.spentToday)]));
        var l1 = h('div', { class: 'list' });
        p.today.forEach(function (t) {
          l1.appendChild(todoRow(todoOf[Todos.keyOf('buy', t.fund.code)], t,
                                 (t.fund.name || t.fund.code) + ' · 无限额'));
        });
        body.appendChild(l1);
      }
      if (p.daily.length) {
        body.appendChild(h('h2', {}, ['按日投']));
        var l2 = h('div', { class: 'list' });
        p.daily.forEach(function (d) {
          l2.appendChild(todoRow(todoOf[Todos.keyOf('buy', d.fund.code)], d,
                                 (d.fund.name || d.fund.code) + ' · 还要 ' + d.days +
                                 ' 个交易日,共 ¥' + money(d.amount),
                                 d.category + '　¥' + money(d.perDay) + ' / 日'));
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
                               x.fund.name || x.fund.code,
                               '卖 ' + x.category + '　¥' + money(x.amount)));
      });
      a.buys.forEach(function (x) {
        la.appendChild(todoRow(todoOf[Todos.keyOf('buy', x.fund.code)], x,
                               (x.fund.name || x.fund.code) +
                               (x.perDay ? ' · ' + money(x.perDay) + '/日 × ' + x.days + ' 天' : '')));
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
      var b2 = h('div', { class: 'body' }, [
        h('div', { class: 'ttl' }, [
          r.category + (r.unknown ? '(未分类)' : ''),
        ]),
      ]);
      if (r.target != null) {
        // 条的长度 = **相对目标的完成度**(12.4% / 20% = 62%),不是占总资产的比例。
        // 后者在六个类别之间长度差得太小,一眼分不出谁欠得多 ——
        // 而这一页存在的理由就是「一眼看出哪儿不对」。
        var fill = r.target > 0 ? Math.min(100, r.pct / r.target * 100) : 0;
        b2.appendChild(h('div', { class: 'bar' }, [h('i', { style: 'width:' + fill + '%' })]));
        b2.appendChild(h('div', { class: 'sub2' }, [
          pct(r.pct) + ' / 目标 ' + pct(r.target) +
          (Math.abs(r.gap) > 500 ? '　' + (r.gap > 0 ? '缺 ' : '超 ') + money(Math.abs(r.gap)) : ''),
        ]));
      } else {
        b2.appendChild(h('div', { class: 'sub2' }, [
          pct(r.pct) + ' · 不在目标比例里,不参与再平衡 —— 去设置补一条',
        ]));
      }
      row.appendChild(b2);
      row.appendChild(h('div', { class: 'num', style: 'text-align:right;font-weight:600' },
                        ['¥' + money(r.value)]));
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
   *  @param title  主行,不给就用「买 类别 ¥金额」
   *
   *  ⚠️ 「从 6/26 挂到现在 · 44 天」用**和基金名同一档的灰字**。
   *     不用红、不用 ⚠、不写「你已经拖了」—— 一条挂了 44 天的待办,
   *     更可能说明它本来就不该在清单里,而不是说明你不守信用。
   */
  function todoRow(t, x, sub, title) {
    var ttl = title || ((t && t.kind === 'sell' ? '卖 ' : '买 ') +
                        x.category + '　¥' + money(x.amount));
    var body2 = h('div', { class: 'body' }, [h('div', { class: 'ttl' }, [ttl])]);

    var bits = [sub];
    if (t) {
      var days = Todos.pendingDays(t, today());
      if (days != null && days >= 7) bits.push('从 ' + t.bornAt.slice(5) + ' 挂到现在 · ' + days + ' 天');
      if (t.status === 'partial') bits.push('已投 ¥' + money(t.actual));
    }
    body2.appendChild(h('div', { class: 'sub2' }, [bits.filter(Boolean).join(' · ')]));

    var done = t && (t.status === 'done' || t.status === 'resolved');
    var row = h('div', {
      class: 'list-row' + (done ? ' dim' : ''),
      onclick: t ? function () { tapTodo(t); } : null,
    }, [body2]);
    row.appendChild(h('span', { class: 'dim' }, [
      !t ? '' :
      t.status === 'done' ? '✓' :
      t.status === 'resolved' ? '已达标' :
      t.status === 'dropped' ? '不做了' : '○',
    ]));
    return row;
  }

  function tapTodo(t) {
    // ⚠️ 勾待办也会写一笔动作,所以这条路也得先把起点问清楚 ——
    //    否则第一次勾选会留下一笔「不知道该不该算进区间」的记录。
    if (Actions.needsStart()) { askStart(function () { tapTodo(t); }); return; }
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

  /** 手动记一笔 —— 加仓、补仓、临时卖出、收到分红。
   *
   *  ⚠️ 三步问完:什么动作 → 哪只 → 多少钱。不做表单页 ——
   *     这个操作发生在你刚在基金 app 里点完确认的那一刻,
   *     多一步都会让人想「回头再说」,而回头就忘了。
   */
  function recordOne() {
    // ⚠️ **第一次记账之前,先问清「从哪天算起买卖都记全了」。**
    //    这是工具没法知道、只有你知道的一件事:上次对账到今天之间,
    //    你可能买过东西没记。猜的话两种错法都很糟 ——
    //    猜早了,那几天的买入会被算成「市场涨跌」,数字全错还看不出来;
    //    猜晚了,整个第一期白等。
    //    所以问一次,一次就够,以后再也不问。
    if (Actions.needsStart()) { askStart(recordOne); return; }
    doRecord();
  }

  function askStart(then) {
    var snaps = Store.get('snapshots', []) || [];
    var last = Ledger.latest(snaps);
    var opts = [];
    if (last) {
      opts.push({ key: last.date, label: last.date + ' 之后的都记全了',
                  hint: '上次对账那天。这么选的话下次对账就能算出涨跌' });
    }
    opts.push({ key: today(), label: '从今天开始记',
                hint: last ? '上次对账到今天之间买过东西但没记 —— 那要多等一期'
                           : '之后每笔买卖都记下来' });
    Modal.pick({
      title: '从哪天起,买卖都记下来了?',
      hint: '**只问这一次。** 有了它才分得开「涨了多少」和「你又投了多少」。',
      options: opts,
    }).then(function (d) {
      if (!d) return;
      Actions.startFrom(d);
      if (then) then();
    });
  }

  function doRecord() {
    Modal.pick({
      title: '记一笔',
      hint: '不记的话,这笔钱下次会被算成「市场涨跌」',
      options: [
        { key: 'buy', label: '买入', hint: '加仓 · 补仓 · 定投' },
        { key: 'sell', label: '卖出', hint: '减仓 · 清仓 · 止盈' },
        { key: 'dividend', label: '现金分红', hint: '钱从基金打到现金账户' },
        { key: 'note', label: '记个决定', hint: '改了目标比例之类,不涉及钱' },
      ],
    }).then(function (kind) {
      if (!kind) return;
      if (kind === 'note') {
        Modal.ask({ title: '记点什么', hint: '以后回看想知道当时在想什么' })
          .then(function (txt) {
            if (!txt) return;
            Actions.add({ date: today(), kind: 'note', note: txt });
            render();
          });
        return;
      }
      var st = Store.get('settings', {}) || {};
      var funds = (st.funds || []).filter(function (f) { return f.active !== false; });
      if (!funds.length) {
        Modal.note({ title: '还没有基金清单', body: '先去设置里加一只。' });
        return;
      }
      Modal.pick({
        title: '哪一只',
        options: funds.map(function (f) {
          return { key: f.code, label: f.name || f.code, hint: f.code + ' · ' + f.category };
        }),
      }).then(function (code) {
        if (!code) return;
        var f = funds.filter(function (x) { return x.code === code; })[0];
        Modal.ask({
          title: { buy: '买了多少', sell: '卖了多少', dividend: '分了多少' }[kind],
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
