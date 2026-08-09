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

  function render() {
    el.innerHTML = '';
    var w = h('div', { class: 'wrap' });
    var snaps = (Store.get('snapshots', []) || []).slice();
    var todos = Todos.all();
    var flows = Todos.flows();

    w.appendChild(h('h1', {}, ['历史']));

    if (!snaps.length) {
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
      acted.forEach(function (f) {
        var t = todos.filter(function (x) { return x.id === f.todoId; })[0];
        var bits = [md(f.date)];
        if (t && t.status === 'partial') bits.push('计划 ¥' + money(t.target) + ',只做了一部分');
        else if (t) bits.push('计划 ¥' + money(t.target));
        fl.appendChild(h('div', { class: 'list-row' }, [
          h('div', { class: 'body' }, [
            h('div', { class: 'ttl' }, [
              (f.kind === 'sell' ? '卖 ' : '买 ') + f.category + '　¥' + money(f.amount),
            ]),
            h('div', { class: 'sub2' }, [bits.join(' · ')]),
          ]),
        ]));
      });
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
            h('div', { class: 'ttl' }, [
              (t.kind === 'sell' ? '卖 ' : '买 ') + t.category + '　¥' + money(t.target),
            ]),
            h('div', { class: 'sub2' }, [
              (t.reason || '没写理由') + ' · ' + md(t.doneAt) + ' · 点一下重新考虑',
            ]),
          ]),
          h('span', { class: 'dim' }, ['▸']),
        ]));
      });
      w.appendChild(dl);
    }

    // ---- 每一期的总额变化 ----
    w.appendChild(h('h2', {}, ['每期总额']));
    var sl = h('div', { class: 'list' });
    snaps.slice().reverse().forEach(function (s, i, arr) {
      var prev = arr[i + 1];
      var d = Ledger.delta(s, prev);
      var row = h('div', { class: 'list-row' }, [
        h('div', { class: 'body' }, [
          h('div', { class: 'ttl' }, [s.date + '　¥' + money(d.total)]),
          h('div', { class: 'sub2' }, [
            // ⚠️ 三种情况说三句不同的话:第一期 / 分得开 / 分不开。
            //    第三种最要紧 —— 不许拿总额当涨跌。
            d.change == null ? '第一期'
              : d.market == null
                ? signed(d.change) + ' · 没记「本期净投入」,分不出涨跌'
                : '净投入 ' + signed(d.inflow) + '　涨跌 ' + signed(d.market),
          ]),
        ]),
      ]);
      if (d.market != null) {
        // ⚠️ 涨跌**不着色**。样式表开头就写着「钱的事不用高饱和,也不该是绿的」——
        //    而且涨红跌绿还是涨绿跌红,中西正好相反,一眼看去容易读反。
        //    `+` / `−` 本来就说清楚了。
        row.appendChild(h('div', { class: 'num', style: 'font-weight:600' },
                          [signed(d.market)]));
      } else if (d.change != null) {
        row.appendChild(h('span', { class: 'dim xs' }, ['涨跌未知']));
      }
      sl.appendChild(row);
    });
    w.appendChild(sl);

    // ---- 钱去哪了 ----
    //
    // ⚠️ 只统计**勾选申报过的**。2026-08 之前没有分类流水
    //    (旧工具只记了建仓那一笔总的),所以这里明写从哪天开始有 ——
    //    不许拿总额倒推补一段假的出来。
    var net = Todos.netByCategory();
    var cats = Object.keys(net).filter(function (c) { return Math.abs(net[c]) > 0; });
    w.appendChild(h('h2', {}, ['钱去哪了']));
    if (!cats.length) {
      w.appendChild(h('div', { class: 'hint' }, [
        '还没有分类流水。勾掉一条待办就会有第一条。',
      ]));
    } else {
      var max = cats.reduce(function (m, c) { return Math.max(m, Math.abs(net[c])); }, 0);
      var nl = h('div', { class: 'list' });
      cats.sort(function (a, b) { return Math.abs(net[b]) - Math.abs(net[a]); })
          .forEach(function (c) {
        var b = h('div', { class: 'body' }, [h('div', { class: 'ttl' }, [c])]);
        b.appendChild(h('div', { class: 'bar' }, [
          h('i', { style: 'width:' + (max ? Math.abs(net[c]) / max * 100 : 0) + '%' }),
        ]));
        b.appendChild(h('div', { class: 'sub2' }, [
          net[c] >= 0 ? '净投入 ¥' + money(net[c]) : '净取出 ¥' + money(-net[c]),
        ]));
        nl.appendChild(h('div', { class: 'list-row' }, [b]));
      });
      w.appendChild(nl);
      var first = flows.reduce(function (m, f) { return !m || f.date < m ? f.date : m; }, null);
      w.appendChild(h('div', { class: 'hint' }, [
        '从 ' + first + ' 开始记的。**再早的没有分类流水** —— ' +
        '旧工具只留了每期总额,倒推出来的会是假的。',
      ]));
    }

    el.appendChild(w);
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
    render();
  }

  return { mount: mount };
})();

if (typeof module !== 'undefined') module.exports = HistoryUI;
