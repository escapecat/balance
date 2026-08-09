// 统计 —— **样本不够的时候,老老实实说还差几期。**
//
// ⚠️ 这一页现在**大半是空的**,而那正是它该有的样子。
//    收益率的唯一前提是「本期净投入」,老库的历史几期都没记 ——
//    硬要出个数的话,拿总额倒推就行,而那条曲线会长得和真的一模一样。
//
// ⚠️ 唯一现在就有的是**结构变化**:每一期各类占多少。
//    它只依赖持仓,不依赖净投入,所以从第一期就成立。
//
// ⚠️ SVG 手写,零依赖 —— 引一个图表库要 200KB,而这里只需要几个 <rect>。

var StatsUI = (function () {

  var el;

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
  /** SVG 元素得用带命名空间的创建方式 —— 用 createElement 建出来的
   *  在页面上是**看不见的**(浏览器当成未知 HTML 标签,不报错也不画)。 */
  function s(tag, attrs, kids) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  function money(n) {
    if (n == null || isNaN(n)) return '—';
    var t = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? '−' : '') + t;
  }
  function signed(n) {
    if (n == null || isNaN(n)) return '—';
    return (n > 0 ? '+' : n < 0 ? '−' : '') +
           String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function pct(x) { return x == null ? '—' : (x * 100).toFixed(1) + '%'; }

  // 低饱和的一组 —— 钱的事不用高饱和,也不该是绿的(见 style.css 开头)
  var HUES = ['#1d3f63', '#3d6b96', '#6b93b8', '#a25a09', '#c08a3e', '#8b7355',
              '#9aa4b0', '#c4ccd6'];

  function render() {
    el.innerHTML = '';
    var w = h('div', { class: 'wrap' });
    var snaps = Store.get('snapshots', []) || [];
    var st = Store.get('settings', {}) || {};
    var flows = Todos.flows();

    w.appendChild(h('h1', {}, ['统计']));

    if (snaps.length < 2) {
      w.appendChild(h('div', { class: 'empty' }, [
        h('div', { class: 'big' }, ['⌗']),
        h('div', {}, ['至少要两期才有得比']),
      ]));
      el.appendChild(w);
      return;
    }

    // ---- 收益率 ----
    w.appendChild(h('h2', {}, ['收益率']));
    var g = Stats.gate(snaps);
    if (!g.ok) {
      // ⚠️ 这里**一个数都不给**,只说为什么和还差多少。
      //    给个「参考值」的话,你会记住那个数字,而它是编的。
      w.appendChild(h('div', { class: 'note' }, [
        g.why + '。',
      ]));
      w.appendChild(h('div', { class: 'hint' }, [
        '收益率要能算,得先分得开「涨了多少」和「你又投了多少」。' +
        '**记买卖就够了** —— 剩下的是解出来的。' +
        '连着 ' + Stats.MIN_PERIODS + ' 期都有记录,这里就有数了。',
      ]));
    } else {
      var tw = Stats.twr(snaps), xi = Stats.xirr(snaps);
      var rl = h('div', { class: 'list' });
      rl.appendChild(rateRow('时间加权', '组合本身表现如何,剔除你的申购时点',
                             tw.ok ? tw.rate : null, tw.ok ? tw.annual : null));
      rl.appendChild(rateRow('资金加权(XIRR)', '你这笔钱实际赚了多少,算上什么时候投的',
                             xi.ok ? xi.rate : null, null));
      w.appendChild(rl);
      w.appendChild(h('div', { class: 'hint' }, [
        '基于最近 ' + g.have + ' 期。两个数常常差得很远 —— ' +
        '差得越大,说明你的申购时点影响越大。',
      ]));
    }

    // ---- 结构变化 ----
    //
    // 这一段从第一期就成立,不依赖净投入 —— 现在唯一有实料的地方。
    w.appendChild(h('h2', {}, ['结构变化']));
    var comp = Stats.composition(snaps, st);
    var cats = [];
    comp.forEach(function (c) {
      Object.keys(c.pct).forEach(function (k) { if (cats.indexOf(k) < 0) cats.push(k); });
    });
    // 现金排最后 —— 它是「还没分配的」,视觉上压在最上面一层最好读
    cats = cats.filter(function (c) { return c !== '现金' && c !== '未分类'; })
               .concat(cats.filter(function (c) { return c === '未分类'; }))
               .concat(cats.filter(function (c) { return c === '现金'; }));
    w.appendChild(stackChart(comp, cats));

    var legend = h('div', { class: 'legend' });
    cats.forEach(function (c, i) {
      legend.appendChild(h('span', { class: 'lg' }, [
        h('i', { style: 'background:' + HUES[i % HUES.length] }),
        h('span', {}, [c]),
      ]));
    });
    w.appendChild(legend);

    var f0 = comp[0], f1 = comp[comp.length - 1];
    var moved = cats.map(function (c) {
      return { c: c, from: f0.pct[c] || 0, to: f1.pct[c] || 0 };
    }).sort(function (a, b) {
      return Math.abs(b.to - b.from) - Math.abs(a.to - a.from);
    })[0];
    if (moved && Math.abs(moved.to - moved.from) > 0.01) {
      w.appendChild(h('div', { class: 'hint' }, [
        '变化最大的是 **' + moved.c + '**:' + pct(moved.from) + ' → ' + pct(moved.to) +
        '(' + f0.date + ' 到 ' + f1.date + ')',
      ]));
    }

    // ---- 各类贡献 ----
    w.appendChild(h('h2', {}, ['各类贡献']));
    var con = Stats.contribution(snaps, flows, st);
    if (!con.ok) {
      w.appendChild(h('div', { class: 'note' }, [con.why + '。']));
      w.appendChild(h('div', { class: 'hint' }, [
        '在「现在」页勾掉一条待办、填上实际买了多少,就有第一条分类流水了。' +
        '**有了它才分得开「涨了」和「投了」。**',
      ]));
    } else {
      var cl = h('div', { class: 'list' });
      con.rows.sort(function (a, b) {
        return Math.abs(b.market) - Math.abs(a.market);
      }).forEach(function (r) {
        cl.appendChild(h('div', { class: 'list-row' }, [
          h('div', { class: 'body' }, [
            h('div', { class: 'ttl' }, [r.category]),
            h('div', { class: 'sub2' }, [
              '投入 ' + signed(r.inflow) + '　涨跌 ' + signed(r.market),
            ]),
          ]),
          h('div', { class: 'amt' }, [signed(r.market)]),
        ]));
      });
      w.appendChild(cl);
      w.appendChild(h('div', { class: 'hint' }, [
        con.from + ' 到 ' + con.to + '。**再早的没有分类流水** —— 倒推出来的会是假的。',
      ]));
    }

    el.appendChild(w);
  }

  function rateRow(label, sub, rate, annual) {
    return h('div', { class: 'list-row' }, [
      h('div', { class: 'body' }, [
        h('div', { class: 'ttl' }, [label]),
        h('div', { class: 'sub2' }, [
          sub + (annual != null ? '　年化 ' + pct(annual) : ''),
        ]),
      ]),
      h('div', { class: 'amt' }, [
        rate == null ? '—' : (rate > 0 ? '+' : '') + pct(rate),
      ]),
    ]);
  }

  /** 堆叠面积图 —— 每一期一根柱子,叠起来正好 100%。
   *
   *  ⚠️ 画的是**占比**不是金额。金额图上所有类别都跟着总额一起涨,
   *     看不出「谁的比重在变」—— 而这一页问的正是后者。 */
  function stackChart(comp, cats) {
    var W = 320, H = 160, pad = 18, bw = Math.min(44, (W - pad * 2) / comp.length - 6);
    var svg = s('svg', {
      viewBox: '0 0 ' + W + ' ' + (H + 22), width: '100%',
      role: 'img', 'aria-label': '各类占比随时间的变化',
    });
    comp.forEach(function (c, i) {
      var x = pad + i * ((W - pad * 2) / comp.length) +
              ((W - pad * 2) / comp.length - bw) / 2;
      var y = 0;
      cats.forEach(function (cat, j) {
        var p = c.pct[cat] || 0;
        if (p <= 0) return;
        var hgt = p * H;
        svg.appendChild(s('rect', {
          x: x, y: y, width: bw, height: hgt,
          fill: HUES[j % HUES.length],
        }));
        y += hgt;
      });
      svg.appendChild(s('text', {
        x: x + bw / 2, y: H + 15, 'text-anchor': 'middle',
        'font-size': '9', fill: 'currentColor', opacity: '.55',
      }, [document.createTextNode(c.date.slice(5))]));
    });
    return h('div', { class: 'chart' }, [svg]);
  }

  function mount(node) {
    el = node;
    render();
  }

  return { mount: mount };
})();

if (typeof module !== 'undefined') module.exports = StatsUI;
