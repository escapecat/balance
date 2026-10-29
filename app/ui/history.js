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
  var lastView = null;   // 换了一屏才回顶部，重渲染不动

  var historyType = 'snapshots', query = '', year = '', limit = 20;
  var resultsNode = null;
  function refreshResults() {
    var next = historyResults();
    if (resultsNode && resultsNode.parentNode) resultsNode.parentNode.replaceChild(next, resultsNode);
    resultsNode = next;
  }
  function historyResults() {
    var w = h('div', { id: 'history-results' });
    var snaps = Store.get('snapshots', []) || [], todos = Todos.all(), flows = Todos.flows();
    var latest = Ledger.latest(snaps), names = {};
    Config.allKnown().forEach(function (f) { names[f.code] = f.name || f.code; });
    var pending = {};
    if (latest) Actions.between(latest, null).forEach(function (f) { pending[f.id] = true; });
    var rows = historyType === 'snapshots' ? snaps.slice() : historyType === 'flows'
      ? flows.slice() : todos.filter(function (t) { return t.status === 'dropped'; });
    rows.sort(function (a, b) { return (b.date || b.doneAt || '').localeCompare(a.date || a.doneAt || ''); });
    var q = query.trim().toLowerCase();
    rows = rows.filter(function (r) {
      var date = r.date || r.doneAt || '';
      return (!year || date.slice(0, 4) === year) &&
        (!q || [date, r.category, r.code, names[r.code], r.note, r.reason].join(' ').toLowerCase().indexOf(q) >= 0);
    });
    w.appendChild(h('p', { class: 'hint result-count' }, ['找到 ' + rows.length + (historyType === 'flows' ? ' 笔买卖' : ' 条记录') +
      ' · 显示 ' + Math.min(limit, rows.length) + ' 条']));
    if (!rows.length) w.appendChild(h('div', { class: 'note' }, ['没有匹配的记录，试试调整年份或搜索词。']));
    var month = '';
    rows.slice(0, limit).forEach(function (r) {
      var date = r.date || r.doneAt || '', m = date.slice(0, 7);
      if (m !== month) { month = m; w.appendChild(h('h2', { class: 'history-month' }, [m.replace('-', ' 年 ') + ' 月'])); }
      if (historyType === 'snapshots') {
        var i = snaps.findIndex(function (s) { return s.date === r.date; });
        var d = Ledger.delta(r, i > 0 ? snaps[i - 1] : null);
        var row = h('button', { class: 'history-card', onclick: function () { openSnapshot(r); } }, [
          h('div', { class: 'range-line' }, [h('b', {}, [r.date + ' 盘点']), h('span', { class: 'tag' }, [d.market == null ? '盈亏未知' : '可核算'])]),
          h('div', { class: 'history-total amount' }, ['¥' + money(d.total + (d.external || 0))]),
          h('div', { class: 'hint' }, ['总资产含组合外 · 投资盈亏只按组合']),
          h('div', { class: 'history-breakdown' }, [
            h('span', {}, ['投资盈亏 ', h('b', { class: 'amount' }, [signed(d.market)])]),
            h('span', {}, ['净流入 ', h('b', { class: 'amount' }, [signed(d.inflow)])]),
          ]),
        ]);
        if (latest && r.date === latest.date && Object.keys(pending).length)
          row.appendChild(h('div', { class: 'pending-label' }, ['盘点后另有 ' + Object.keys(pending).length + ' 笔，待下次对账']));
        w.appendChild(row);
      } else if (historyType === 'flows') {
        var actionName = r.kind === 'sell' ? '卖出' : r.kind === 'dividend' ? '现金分红' : r.kind === 'note' ? '备注' : '买入';
        w.appendChild(h('div', { class: 'list-row history-flow' }, [
          h('div', { class: 'body' }, [h('div', { class: 'ttl' }, [actionName + ' · ' + (r.category || names[r.code] || r.code || '未分类')]),
            h('div', { class: 'sub2' }, [date + (r.code ? ' · ' + (names[r.code] || r.code) : '')]),
            h('div', { class: 'sub2' }, [pending[r.id] ? '待下次对账 · 已保存，不用重复记' : '已归入盘点区间']),
          ]), h('div', { class: 'amt' }, [r.kind === 'note' ? '—' : money(r.amount)]),
        ]));
      } else {
        w.appendChild(h('button', { class: 'history-card', onclick: function () { reconsider(r); } }, [
          h('b', {}, [(r.kind === 'sell' ? '卖出 ' : '买入 ') + r.category]),
          h('div', { class: 'sub2' }, [(r.reason || '没写理由') + ' · ' + date + ' · 点一下重新考虑']),
        ]));
      }
    });
    if (rows.length > limit) w.appendChild(h('button', { class: 'btn ghost', onclick: function () { limit += 20; refreshResults(); } }, ['再显示 20 条（还有 ' + (rows.length - limit) + ' 条）']));
    return w;
  }
  function render() {
    var w;
    try {
      if (viewing) w = snapshotView();
      else {
        w = h('div', { class: 'wrap dashboard' });
        var snaps = Store.get('snapshots', []) || [], flows = Todos.flows(), dropped = Todos.all().filter(function (t) { return t.status === 'dropped'; });
        w.appendChild(h('h1', {}, ['历史']));
        w.appendChild(h('p', { class: 'sub' }, ['盘点与买卖分开查，每一期都能展开']));
        if (!snaps.length) w.appendChild(h('div', { class: 'note' }, ['还没有记录，录一期就有了。']));
        else {
          w.appendChild(h('div', { class: 'period-tabs', role: 'group', 'aria-label': '历史记录类型' },
            [['snapshots', '盘点 · ' + snaps.length + ' 期'], ['flows', '买卖 · ' + flows.length + ' 笔']]
              .concat(dropped.length ? [['dropped', '决定不做 · ' + dropped.length]] : []).map(function (p) {
                return h('button', { class: historyType === p[0] ? 'active' : '', 'aria-pressed': String(historyType === p[0]),
                  onclick: function () { historyType = p[0]; limit = 20; query = ''; render(); } }, [p[1]]);
              })));
          w.appendChild(h('input', { id: 'history-search', type: 'search', class: 'history-search', value: query,
            placeholder: historyType === 'snapshots' ? '搜索盘点日期或备注' : '搜索日期、基金、类别',
            'aria-label': '搜索历史', oninput: function (e) { query = e.target.value; limit = 20; refreshResults(); } }));
          var years = {};
          snaps.concat(flows).forEach(function (s) { if (s.date) years[s.date.slice(0, 4)] = true; });
          var select = h('select', { id: 'history-year', 'aria-label': '筛选年份',
            onchange: function (e) { year = e.target.value; limit = 20; refreshResults(); } },
            [['', '全部年份']].concat(Object.keys(years).sort().reverse().map(function (y) { return [y, y + ' 年']; })).map(function (v) {
              return h('option', { value: v[0], selected: year === v[0] ? '' : null }, [v[1]]);
            }));
          w.appendChild(h('div', { class: 'history-controls' }, [select, h('span', { class: 'hint' }, ['最近在前 · 按月分组'])]));
          w.appendChild(h('div', { class: 'coverage-note' }, [
            h('b', {}, ['记录 ' + snaps[0].date + ' — ' + snaps[snaps.length - 1].date]),
            h('div', { class: 'hint' }, ['完整买卖记录起点：' + (Actions.since() || '尚未声明') + '。此前盈亏未知，不猜算。']),
          ]));
          resultsNode = historyResults(); w.appendChild(resultsNode);
        }
      }
    } catch (e) {
      console.error('历史显示失败:', e.message);
      w = h('div', { class: 'wrap' }, [h('h1', {}, ['暂时无法显示这条记录']),
        h('div', { class: 'note warn' }, ['资产记录没有修改。请先到设置导出备份，再检查基金配置。']),
        h('button', { class: 'btn ghost', onclick: function () { viewing = null; render(); } }, ['返回历史'])]);
    }
    el.innerHTML = ''; el.appendChild(w);
    var key = viewing ? viewing.snap.date : '';
    if (key !== lastView) { lastView = key; Dom.toTop(); }
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

    w.appendChild(Dom.hero(d.total, d.external || 0, '当期总资产'));

    if (d.change != null) {
      w.appendChild(h('div', { class: 'list' }, [
        infoRow('外部净流入（推算）', d.inflow == null ? '买卖记录不完整' : '包含未单列的现金类利息，不等于工资减花费',
                d.inflow == null ? '—' : signed(d.inflow)),
        infoRow('市场涨跌', d.market == null ? '分不出来' : null,
                d.market == null ? '—' : signed(d.market)),
        infoRow('组合总额变化', '相对上一期 ' + (v.prev ? v.prev.date : ''), signed(d.change)),
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
      var sum = (pf || []).reduce(function (a, r) { return a + r.market; }, 0);
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
