// 历史 —— **决策历史 + 钱怎么流动。**
//
// ⚠️ 这一页存在的**全部理由**是把「净投入」和「涨跌」分开。
//    总额涨了 6 万,你没法知道是赚了 6 万,
//    还是又投进去 10 万、市场亏了 4 万 —— 而这两件事的含义天差地别。
//
// ⚠️ 分不开的时候**写「涨跌未知」,不给一个数**。
//    迁移进来的那几期正好都没有「本期净投入」,拿总额倒推的话,
//    能编出一条完全虚假的收益曲线,而每个数字看着都合理 ——
//    然后你会根据它做决定。
//
// ⚠️ 「建议 vs 实际」那两行就是**「说了没做」的账**,它自然长在这儿。
//    不用另做一个功能,也不用红字提醒 —— 摆在时间线上就够了。

var HistoryUI = (function () {

  var el, onChanged = null;

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
  function signed(n) {
    if (n == null || isNaN(n)) return '—';
    return (n > 0 ? '+' : n < 0 ? '−' : '') +
           String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function md(d) { return d ? d.slice(5).replace('-', '月') + '日' : ''; }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) +
           '-' + ('0' + d.getDate()).slice(-2);
  }

  var viewing = null;    // 正在看哪一期的详情
  var SHOW = 8;          // 列表默认显示几条
  var expanded = {};     // 哪几段被展开了

  /** 长列表折叠 —— **记录只会越来越多。**
   *  一年 12 期、三年 36 期、动作上百条,全铺出来就没法翻了。
   *  ⚠️ 折叠了要**说出来还有多少条**,并且一点就能展开 ——
   *     悄悄少显示几条,你会以为那几个月不存在。 */
  function collapsible(key, rows, w) {
    if (rows.length <= SHOW || expanded[key]) {
      rows.forEach(function (r) { w.appendChild(r); });
      if (rows.length > SHOW) {
        w.appendChild(h('button', {
          class: 'link', onclick: function () { expanded[key] = false; render(); },
        }, ['收起']));
      }
      return;
    }
    rows.slice(0, SHOW).forEach(function (r) { w.appendChild(r); });
    w.appendChild(h('button', {
      class: 'link', onclick: function () { expanded[key] = true; render(); },
    }, ['还有 ' + (rows.length - SHOW) + ' 条,全部展开']));
  }

  function render() {
    el.innerHTML = '';
    // 看某一期的详情时**整屏接管** —— 和录入页、基金表单同一个模式
    if (viewing) { el.appendChild(snapshotView()); return; }
    var w = h('div', { class: 'wrap' });
    var snaps = (Store.get('snapshots', []) || []).slice();
    var todos = Todos.all();
    var flows = Todos.flows();

    w.appendChild(h('h1', {}, ['历史']));

    if (!snaps.length) {
      w.className = 'wrap wrap-fill';   // 空状态：把 tab 栏以上占满，内容居中
      w.appendChild(h('div', { class: 'empty' }, [
        h('div', { class: 'big' }, ['≡']),
        h('div', {}, ['还没有记录 —— 录一期就有了']),
      ]));
      el.appendChild(w);
      return;
    }

    // ---- 做过什么 ----
    //
    // 倒序 —— 最近的在最上面。翻历史的时候没人从头开始看。
    w.appendChild(h('h2', {}, ['做过什么']));
    var acted = flows.slice().reverse();
    if (!acted.length) {
      w.appendChild(h('div', { class: 'note' }, [
        '还没有勾过任何一条待办。在「现在」页点一下清单里的项目,' +
        '填上实际买了多少 —— **那是收益率的唯一来源**。',
      ]));
    } else {
      var fl = h('div', { class: 'list' });
      var actRows = [];
      acted.forEach(function (f) {
        var t = todos.filter(function (x) { return x.id === f.todoId; })[0];
        var bits = [md(f.date)];
        if (t && t.status === 'partial') bits.push('计划 ¥' + money(t.target) + ',只做了一部分');
        else if (t) bits.push('计划 ¥' + money(t.target));
        actRows.push(h('div', { class: 'list-row' }, [
          h('div', { class: 'body' }, [
            h('div', { class: 'ttl' }, [(f.kind === 'sell' ? '卖 ' : '买 ') + f.category]),
            h('div', { class: 'sub2' }, [bits.join(' · ')]),
          ]),
          h('div', { class: 'amt' }, [
            h('span', { class: 'u' }, [f.kind === 'sell' ? '−¥' : '¥']), money(f.amount),
          ]),
        ]));
      });
      collapsible('acted', actRows, fl);
      w.appendChild(fl);
    }

    // ---- 说了没做的 ----
    var dropped = todos.filter(function (t) { return t.status === 'dropped'; });
    if (dropped.length) {
      w.appendChild(h('h2', {}, ['决定不做的']));
      var dl = h('div', { class: 'list' });
      dropped.forEach(function (t) {
        dl.appendChild(h('div', {
          class: 'list-row', onclick: function () { reconsider(t); },
        }, [
          h('div', { class: 'body' }, [
            h('div', { class: 'ttl' }, [(t.kind === 'sell' ? '卖 ' : '买 ') + t.category]),
            h('div', { class: 'sub2' }, [
              (t.reason || '没写理由') + ' · ' + md(t.doneAt),
            ]),
          ]),
          h('div', { class: 'amt dim' }, [
            h('span', { class: 'u' }, ['¥']), money(t.target),
          ]),
          h('span', { class: 'chev' }),
        ]));
      });
      w.appendChild(dl);
    }

    // ---- 每一期的总额变化 ----
    w.appendChild(h('h2', {}, ['每期总额']));
    w.appendChild(h('div', { class: 'hint', style: 'margin-bottom:8px' }, [
      '大数是**总资产**;右下角的涨跌只算**组合** —— ' +
      '组合外那部分(MSFT、房产)是估值,一改就会让「市场赚了多少」凭空跳一下。',
    ]));
    var sl = h('div', { class: 'list' });
    var snapRows = [];
    snaps.slice().reverse().forEach(function (s, i, arr) {
      var prev = arr[i + 1];
      var d = Ledger.delta(s, prev);
      var row = h('div', {
        class: 'list-row', onclick: function () { openSnapshot(s); },
      }, [
        h('div', { class: 'body' }, [
          h('div', { class: 'ttl' }, [s.date]),
          h('div', { class: 'sub2' }, [
            // ⚠️ 三种情况说三句不同的话:第一期 / 分得开 / 分不开。
            //    第三种最要紧 —— 不许拿总额当涨跌。
            (d.external ? '组合 ' + money(d.total) + ' · 组合外 ' + money(d.external) + ' · ' : '') +
            (d.change == null ? '第一期'
              : d.market == null
                ? signed(d.change) + ',分不出涨跌'
                : '工资−花费 ' + signed(d.inflow) + ' · 涨跌 ' + signed(d.market)),
          ]),
        ]),
      ]);
      // ⚠️ 涨跌**不着色**。样式表开头就写着「钱的事不用高饱和,也不该是绿的」——
      //    而且涨红跌绿还是涨绿跌红,中西正好相反,一眼看去容易读反。
      //    `+` / `−` 本来就说清楚了。
      // ⚠️ 主数字给**总资产**(组合 + 组合外),和首页顶上那个大数一致。
      //    只给组合口径的话,两页对同一天显示两个不同的总额 ——
      //    而你根本不知道差的那一块去哪了。
      //    但**涨跌仍然只按组合算**:组合外那部分是拍脑袋估的估值,
      //    一改就会让「市场让我赚了多少」凭空跳一下。
      row.appendChild(h('div', { class: 'amt' }, [
        h('span', { class: 'u' }, ['¥']), money(d.total + (d.external || 0)),
        h('div', { class: 'sub2', style: 'font-weight:500' },
          [d.market != null ? signed(d.market) : d.change != null ? '涨跌未知' : '']),
      ]));
      snapRows.push(row);
    });
    collapsible('snaps', snapRows, sl);
    w.appendChild(sl);

    // ⚠️ 这里**没有「钱去哪了」那一段**,是删掉的。
    //    它按类别汇总净投入,和上面「做过什么」同一份 flows[],
    //    只是换了个聚合方式 —— 而这个工具一个月记几笔、一年二三十笔,
    //    在这个量级上汇总几乎不产生新信息,两块看着就是同一件事排两遍。
    //    真正有价值的汇总(投入 **和** 涨跌一起看)在统计页「各类贡献」:
    //    光知道往黄金投了多少没用,得知道投进去之后它给了你什么。

    el.appendChild(w);
  }

  /** 点某一期 → 进详情屏。
   *
   *  ⚠️ 早先这里是「弹个菜单 → 再弹个纯文本框」。
   *     `Modal.note` 只能吐字符串,于是逐只盈亏被硬拼成几行文本:
   *     金额没法右对齐、没有分隔线、长基金名和数字挤在一起 —— 难看是必然的。
   *     **拿弹窗当页面用,做出来一定丑。** 弹窗是用来说一句话的。
   */
  function openSnapshot(s0) {
    var all = Store.get('snapshots', []) || [];
    var i = all.findIndex(function (x) { return x.date === s0.date; });
    viewing = { snap: s0, prev: i > 0 ? all[i - 1] : null,
                next: i < all.length - 1 ? all[i + 1].date : null };
    render();
  }

  /** 某一期的详情屏 —— 那天的账、各只赚了多少、以及删除入口。 */
  function snapshotView() {
    var v = viewing;
    var w = h('div', { class: 'wrap' });
    var d = Ledger.delta(v.snap, v.prev);
    var st = Store.get('settings', {}) || {};
    var name = {};
    Config.allKnown(st).forEach(function (f) { name[f.code] = f.name || f.code; });

    w.appendChild(h('h1', {}, [v.snap.date]));

    // 那天的账 —— 和首页 hero 一个格式,不用重新适应。
    //
    // ⚠️ **结构必须和 now.js 那份逐字一致**。这两处是各写一遍的,
    //    改版时我只动了 now.js,这边就成了「新背景 + 旧结构」:
    //    数字贴着顶(inline 的 padding-top:0 把卡片内边距干掉了)、
    //    组合和组合外挤成一行没样式的灰字。
    //    抽成共享组件才是根治 —— 在那之前,改一边**务必**回来改这边。
    var hero = h('div', { class: 'hero' });
    hero.appendChild(h('div', { class: 'hero-cap' }, ['当期总额']));
    hero.appendChild(h('div', { class: 'hero-num' },
                       ['¥' + money(d.total + (d.external || 0))]));
    var split = h('div', { class: 'hero-split' });
    split.appendChild(h('div', {}, [
      h('span', { class: 'k' }, ['投资组合']),
      h('span', { class: 'v' }, ['¥' + money(d.total)]),
    ]));
    if (d.external) {
      split.appendChild(h('div', {}, [
        h('span', { class: 'k' }, ['组合外']),
        h('span', { class: 'v' }, ['¥' + money(d.external)]),
      ]));
    }
    hero.appendChild(split);
    w.appendChild(hero);

    if (d.change != null) {
      w.appendChild(h('div', { class: 'list' }, [
        infoRow('工资 − 花费', d.inflow == null ? '那时候还没记买卖' : null,
                d.inflow == null ? '—' : signed(d.inflow)),
        infoRow('市场涨跌', d.market == null ? '分不出来' : null,
                d.market == null ? '—' : signed(d.market)),
        infoRow('总额变化', '相对上一期 ' + (v.prev ? v.prev.date : ''), signed(d.change)),
      ]));
    }

    // ---- 各只赚了多少 ----
    var pf = v.prev ? Ledger.perFund(v.snap, v.prev) : null;
    var rows = (pf || []).filter(function (r) {
      return Math.abs(r.market) > 1 || Math.abs(r.netBuy) > 1;
    }).sort(function (a, b) { return b.market - a.market; });

    if (rows.length) {
      w.appendChild(h('h2', {}, ['各只赚了多少']));
      var l = h('div', { class: 'list' });
      rows.forEach(function (r) {
        var bits = [];
        if (Math.abs(r.netBuy) > 1) bits.push('你买了 ' + signed(r.netBuy));
        if (r.dividend > 1) bits.push('分红 ' + money(r.dividend));
        bits.push(money(r.from) + ' → ' + money(r.to));
        l.appendChild(h('div', { class: 'list-row' }, [
          h('div', { class: 'body' }, [
            h('div', { class: 'ttl' }, [name[r.code] || r.code]),
            h('div', { class: 'sub2' }, [bits.join(' · ')]),
          ]),
          h('div', { class: 'amt' }, [signed(r.market)]),
        ]));
      });
      w.appendChild(l);
      var sum = rows.reduce(function (a, r) { return a + r.market; }, 0);
      w.appendChild(h('div', { class: 'hint' }, [
        '合计涨跌 **' + signed(sum) + '** · 已经减掉你自己买进去的钱。',
      ]));
    } else if (v.prev) {
      w.appendChild(h('h2', {}, ['各只赚了多少']));
      w.appendChild(h('div', { class: 'note' }, [
        pf ? '这一期各只都没什么变化。'
           : '那时候还没开始记买卖 —— 分不出哪些是涨的、哪些是你买的。',
      ]));
    }

    w.appendChild(h('button', {
      class: 'btn ghost', style: 'margin-top:20px',
      onclick: function () { viewing = null; render(); },
    }, ['返回']));
    w.appendChild(h('button', {
      class: 'link danger', style: 'margin-top:8px',
      onclick: function () { dropSnapshot(v); },
    }, ['删掉这一期']));
    return w;
  }

  function infoRow(label, sub, value) {
    return h('div', { class: 'list-row' }, [
      h('div', { class: 'body' }, [
        h('div', { class: 'ttl' }, [label]),
        sub ? h('div', { class: 'sub2' }, [sub]) : '',
      ].filter(function (x) { return x !== ''; })),
      h('div', { class: 'amt' }, [value]),
    ]);
  }

  /** ⚠️ 删掉一期会让**它之后那一期的涨跌重新算**(基准变了)。
   *     不说的话你会发现别的月份数字也变了,而完全想不到是这一下删的。 */
  function dropSnapshot(v) {
    Modal.confirm({
      title: '删掉 ' + v.snap.date + ' 这一期?',
      body: (v.next ? '⚠️ ' + v.next + ' 那一期的涨跌会跟着重算 —— 基准变了。' : '') +
            '删之前会自动存一个回滚点,设置页里能退回来。',
      ok: '删掉', danger: true,
    }).then(function (ok) {
      if (!ok) return;
      var r = Ledger.removeSnapshot(v.snap.date);
      if (!r.ok) { Modal.note({ title: '删不掉', body: r.why }); return; }
      viewing = null;
      if (onChanged) onChanged();
      render();
    });
  }

  function reconsider(t) {
    Modal.confirm({
      title: '把「' + t.category + '」放回清单?',
      body: '当时的理由是「' + (t.reason || '没写') + '」。\n' +
            '放回去之后,下次算出来还欠配的话它会重新出现。',
      ok: '放回清单',
    }).then(function (ok) {
      if (!ok) return;
      Todos.revive(t.id, today());
      if (onChanged) onChanged();
      render();
    });
  }

  function mount(node, opts) {
    el = node;
    onChanged = (opts || {}).onChanged;
    viewing = null;
    render();
  }

  return { mount: mount };
})();

if (typeof module !== 'undefined') module.exports = HistoryUI;
