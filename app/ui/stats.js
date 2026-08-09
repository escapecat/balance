// 统计 —— **样本不够的时候,老老实实说还差几期。**
//
// ⚠️ 收益率的前提是「这一期分得开涨跌和投入」,而那要等你记满几期买卖。
//    在此之前这一页**一个收益率都不给** —— 硬要出个数的话拿总额倒推就行,
//    而那条曲线会长得和真的一模一样,你会拿它做决定。
//
// ⚠️ **图上必须能读出数。** 第一版只有一张没有任何标注的堆叠柱,
//    看得出「有变化」,看不出「变了多少」—— 那种图约等于装饰。
//    现在:柱子上直接标百分比(块够大时)、悬停有原生 tooltip、
//    图例带当前占比。
//
// ⚠️ **期数会一直涨。** 三年 36 期、五年 60 期,全画出来每根柱子不到 8px。
//    所以图只画最近 12 期,并且**说出来自己截断了** ——
//    悄悄少画几根,你会以为那几个月不存在。
//
// ⚠️ SVG 手写,零依赖 —— 引一个图表库要 200KB,而这里只需要几个 <rect>。

var StatsUI = (function () {

  var el;
  var MAX_BARS = 12;          // 图上最多画几期
  var NS = 'http://www.w3.org/2000/svg';

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
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }
  function txt(t) { return document.createTextNode(t); }

  /** 一个图表容器 + 它自己的浮层。
   *
   *  ⚠️ 第一版用的是 SVG 原生 `<title>` —— 以为「零 JS 就有 tooltip」很划算,
   *     实际上要把鼠标停住 1~2 秒才弹,样式是系统那套灰框,手机上只有长按才出。
   *     **用起来等于没有。** 交互这种事没有便宜的近似:要么做,要么别声称有。
   */
  function chartBox() {
    var box = h('div', { class: 'chart' });
    var pop = h('div', { class: 'ctip' });
    box.appendChild(pop);
    return { box: box, pop: pop };
  }

  /** 给一个 svg 元素绑上浮层。
   *  @param lines [[标题], [标签, 值], ...]
   *
   *  ⚠️ 触摸也要绑。手机上没有 hover,只绑 mouse 事件的话,
   *     这些提示在手机上全是死的 —— 而这个 app 主要在手机上看。 */
  function bindTip(node, ctx, lines, onEnter, onLeave) {
    node.setAttribute('class', 'seg');
    function place(e) {
      var r = ctx.box.getBoundingClientRect();
      var pt = e.touches && e.touches[0] ? e.touches[0] : e;
      ctx.pop.style.left = Math.max(48, Math.min(r.width - 48, pt.clientX - r.left)) + 'px';
      ctx.pop.style.top = (pt.clientY - r.top) + 'px';
    }
    function show(e) {
      ctx.pop.innerHTML = '';
      lines.forEach(function (l, i) {
        var row = h('div', {});
        if (l.length === 1) row.appendChild(h('b', {}, [l[0]]));
        else {
          row.appendChild(Dom.text(l[0] + ' '));
          row.appendChild(h('b', { class: 'v' }, [l[1]]));
        }
        ctx.pop.appendChild(row);
      });
      ctx.pop.className = 'ctip on';
      place(e);
      if (onEnter) onEnter();
    }
    function hide() { ctx.pop.className = 'ctip'; if (onLeave) onLeave(); }
    node.addEventListener('mouseenter', show);
    node.addEventListener('mousemove', place);
    node.addEventListener('mouseleave', hide);
    node.addEventListener('touchstart', show);
    node.addEventListener('touchend', hide);
    return node;
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
  function pct(x, d) { return x == null ? '—' : (x * 100).toFixed(d == null ? 1 : d) + '%'; }
  function md(d) { return d.slice(5).replace('-', '/'); }

  // 低饱和的一组 —— 钱的事不用高饱和,也不该是绿的(见 style.css 开头)
  // 类别色一律走 data/palette.js。
  // ⚠️ 早先这里是一个写死的 HUES 数组，按**索引**取色，
  //    而索引来自当次渲染的排序 —— 于是同一个类别
  //    在饼图里是棕色、在柱图里是蓝色，图例反而帮倒忙。
  //    还有一层：它吐的是字面 hex，深色模式下那套低饱和度色几乎看不见。
  function hue(cat) { return Palette.color(cat); }
  var LINE = 'var(--cat-a)';   // 总资产走势线 —— 不属于任何类别，固定一个色

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

    var comp = Stats.composition(snaps, st);
    var shown = comp.slice(-MAX_BARS);
    var cut = comp.length - shown.length;

    // ---- 总资产走势 ----
    //
    // 放最前面,因为它回答的是最直接的问题:「我的钱在往哪个方向走」。
    // 折线而不是柱子:柱子比的是「谁高谁低」,折线看的是「趋势」。
    w.appendChild(h('h2', {}, ['总资产走势']));
    w.appendChild(lineChart(shown));
    var first = shown[0], last = shown[shown.length - 1];
    w.appendChild(h('div', { class: 'hint' }, [
      md(first.date) + ' 到 ' + md(last.date) + ':' +
      money(first.total) + ' → ' + money(last.total) +
      '(' + signed(last.total - first.total) + ')' +
      (cut ? ' · 只画最近 ' + MAX_BARS + ' 期,更早的 ' + cut + ' 期没画' : ''),
    ]));

    // ---- 现在的配置 ----
    //
    // ⚠️ 「结构变化」那张图看的是**趋势**,这一段看的是**此刻**。
    //    只给趋势图的话,你得眯着眼从最后一根柱子上估当前占比 ——
    //    而那正是最常问的一个数。
    w.appendChild(h('h2', {}, ['现在的配置']));
    var cur = shown[shown.length - 1];
    var cats = orderCats(comp);
    w.appendChild(donut(cur, cats));
    var lg = h('div', { class: 'legend' });
    cats.forEach(function (c, i) {
      if (!(cur.pct[c] > 0)) return;
      lg.appendChild(h('span', { class: 'lg' }, [
        h('i', { style: 'background:' + hue(c) }),
        h('span', {}, [c + ' ' + pct(cur.pct[c])]),
      ]));
    });
    w.appendChild(lg);

    // ---- 结构变化 ----
    w.appendChild(h('h2', {}, ['结构变化']));
    w.appendChild(stackChart(shown, cats));
    var f0 = shown[0], f1 = cur;
    var moved = cats.map(function (c) {
      return { c: c, from: f0.pct[c] || 0, to: f1.pct[c] || 0 };
    }).sort(function (a, b) {
      return Math.abs(b.to - b.from) - Math.abs(a.to - a.from);
    })[0];
    if (moved && Math.abs(moved.to - moved.from) > 0.01) {
      w.appendChild(h('div', { class: 'hint' }, [
        '变化最大的是 **' + moved.c + '**:' + pct(moved.from) + ' → ' + pct(moved.to),
      ]));
    }

    // ---- 收益率 ----
    w.appendChild(h('h2', {}, ['收益率']));
    var g = Stats.gate(snaps);
    if (!g.ok) {
      // ⚠️ 这里**一个数都不给**,只说为什么和还差多少。
      //    给个「参考值」的话,你会记住那个数字,而它是编的。
      w.appendChild(h('div', { class: 'note' }, [g.why + '。']));
      w.appendChild(h('div', { class: 'hint' }, [
        '要能算,得先分得开「涨了多少」和「你又投了多少」。' +
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

    // ---- 各类贡献 ----
    w.appendChild(h('h2', {}, ['各类贡献']));
    var con = Stats.contribution(snaps, flows, st);
    if (!con.ok) {
      w.appendChild(h('div', { class: 'note' }, [con.why + '。']));
      w.appendChild(h('div', { class: 'hint' }, [
        '在「现在」页记一笔买卖,就有第一条分类流水了。' +
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
            h('div', { class: 'sub2' }, ['投入 ' + signed(r.inflow)]),
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

  /** 类别顺序:现金压最后一层。它是「还没分配的」,视觉上在顶上最好读。 */
  function orderCats(comp) {
    var cats = [];
    comp.forEach(function (c) {
      Object.keys(c.pct).forEach(function (k) { if (cats.indexOf(k) < 0) cats.push(k); });
    });
    var tail = ['未分类', '现金', '组合外'];
    return cats.filter(function (c) { return tail.indexOf(c) < 0; })
               .concat(tail.filter(function (c) { return cats.indexOf(c) >= 0; }));
  }

  /** 总资产折线。
   *  ⚠️ y 轴**不从 0 起**:总额两百多万、月度波动几万,从 0 起的话
   *     那条线就是一条水平直线,什么都看不出来。
   *     代价是视觉上放大了波动,所以下面用文字给出真实变化额。 */
  function lineChart(comp) {
    var W = 320, H = 110, padX = 10, padY = 12;
    var vals = comp.map(function (c) { return c.total; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi === lo) { hi = lo + 1; }
    var span = hi - lo;
    function X(i) { return padX + i * ((W - padX * 2) / Math.max(1, comp.length - 1)); }
    function Y(v) { return padY + (1 - (v - lo) / span) * (H - padY * 2); }

    var ctx = chartBox();
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + (H + 16), width: '100%',
                         role: 'img', 'aria-label': '总资产走势' });
    // 面积 + 线,面积让趋势更容易读
    var area = comp.map(function (c, i) { return X(i) + ',' + Y(c.total); }).join(' ');
    svg.appendChild(s('polygon', {
      points: X(0) + ',' + (H - padY) + ' ' + area + ' ' +
              X(comp.length - 1) + ',' + (H - padY),
      fill: LINE, opacity: '.12',
    }));
    svg.appendChild(s('polyline', {
      points: area, fill: 'none', stroke: LINE, 'stroke-width': '2.5',
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }));
    comp.forEach(function (c, i) {
      // 命中区比圆点大得多 —— 3.5px 的点在手机上根本点不中
      var hit = s('circle', { cx: X(i), cy: Y(c.total), r: '14', fill: 'transparent' });
      var dot = s('circle', { cx: X(i), cy: Y(c.total), r: '3.5',
                              fill: 'var(--surface)', stroke: LINE, 'stroke-width': '2' });
      svg.appendChild(dot);
      svg.appendChild(bindTip(hit, ctx, [
        [c.date], ['总资产', '¥' + money(c.total)],
        c.external ? ['其中组合外', '¥' + money(c.external)] : null,
      ].filter(Boolean), function () { dot.setAttribute('r', '5.5'); },
         function () { dot.setAttribute('r', '3.5'); }));
    });
    // 只标首尾的日期 —— 期数多了全标会糊成一片
    svg.appendChild(s('text', { x: X(0), y: H + 10, 'font-size': '9',
                                fill: 'currentColor', opacity: '.55' },
                      [txt(md(comp[0].date))]));
    svg.appendChild(s('text', { x: X(comp.length - 1), y: H + 10, 'text-anchor': 'end',
                                'font-size': '9', fill: 'currentColor', opacity: '.55' },
                      [txt(md(comp[comp.length - 1].date))]));
    ctx.box.insertBefore(svg, ctx.pop);
    return ctx.box;
  }

  /** 当前配置的环形图。
   *  ⚠️ 用环不用饼:中间那个洞可以放总额,而饼图的圆心什么也放不下。 */
  function donut(cur, cats) {
    var W = 320, R = 52, C = 2 * Math.PI * R, cx = W / 2, cy = 68;
    var ctx = chartBox();
    var svg = s('svg', { viewBox: '0 0 ' + W + ' 140', width: '100%',
                         role: 'img', 'aria-label': '当前各类占比' });
    var off = 0;
    cats.forEach(function (c, i) {
      var p = cur.pct[c] || 0;
      if (p <= 0) return;
      var arc = s('circle', {
        cx: cx, cy: cy, r: R, fill: 'none',
        stroke: hue(c), 'stroke-width': '20',
        'stroke-dasharray': (p * C) + ' ' + C,
        'stroke-dashoffset': -off * C,
        transform: 'rotate(-90 ' + cx + ' ' + cy + ')',
      });
      svg.appendChild(bindTip(arc, ctx, [
        [c], ['占比', pct(p)], ['金额', '¥' + money(cur.by[c])],
      ]));
      off += p;
    });
    svg.appendChild(s('text', {
      x: cx, y: cy - 2, 'text-anchor': 'middle', 'font-size': '15',
      'font-weight': '650', fill: 'currentColor',
    }, [txt('¥' + money(cur.total))]));
    svg.appendChild(s('text', {
      x: cx, y: cy + 14, 'text-anchor': 'middle', 'font-size': '9',
      fill: 'currentColor', opacity: '.55',
    }, [txt(cur.external ? '组合 ' + money(cur.portfolio) + ' + 组合外' : md(cur.date))]));
    ctx.box.insertBefore(svg, ctx.pop);
    return ctx.box;
  }

  /** 堆叠柱 —— 每期一根,叠起来正好 100%。
   *
   *  ⚠️ 画的是**占比**不是金额。金额图上所有类别都跟着总额一起涨,
   *     看不出「谁的比重在变」—— 而这一段问的正是后者。
   *
   *  ⚠️ 块够大就直接把百分比写在上面。没有数字的图只能看出「有变化」,
   *     看不出「变了多少」—— 那种图约等于装饰。 */
  function stackChart(comp, cats) {
    var W = 320, H = 150, pad = 8;
    var slot = (W - pad * 2) / comp.length;
    var bw = Math.min(38, slot - 4);
    var ctx = chartBox();
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + (H + 18), width: '100%',
                         role: 'img', 'aria-label': '各类占比随时间的变化' });
    comp.forEach(function (c, i) {
      var x = pad + i * slot + (slot - bw) / 2;
      var y = 0;
      cats.forEach(function (cat, j) {
        var p = c.pct[cat] || 0;
        if (p <= 0) return;
        var hgt = p * H;
        var rect = s('rect', { x: x, y: y, width: bw, height: hgt,
                               fill: hue(cat) });
        svg.appendChild(bindTip(rect, ctx, [
          [cat], [c.date, pct(p)], ['金额', '¥' + money(c.by[cat])],
        ]));
        // 够高够宽才写字,否则挤成一团反而更难读
        if (hgt >= 16 && bw >= 26) {
          svg.appendChild(s('text', {
            x: x + bw / 2, y: y + hgt / 2 + 3, 'text-anchor': 'middle',
            'font-size': '9', fill: 'var(--on-cat)', opacity: '.92',
          }, [txt(pct(p, 0))]));
        }
        y += hgt;
      });
      // 期数多了就隔一根标一次日期
      var every = comp.length > 8 ? 2 : 1;
      if (i % every === 0 || i === comp.length - 1) {
        svg.appendChild(s('text', {
          x: x + bw / 2, y: H + 12, 'text-anchor': 'middle',
          'font-size': '9', fill: 'currentColor', opacity: '.55',
        }, [txt(md(c.date))]));
      }
    });
    ctx.box.insertBefore(svg, ctx.pop);
    return ctx.box;
  }

  function rateRow(label, sub, rate, annual) {
    return h('div', { class: 'list-row' }, [
      h('div', { class: 'body' }, [
        h('div', { class: 'ttl' }, [label]),
        h('div', { class: 'sub2' }, [sub + (annual != null ? ' · 年化 ' + pct(annual) : '')]),
      ]),
      h('div', { class: 'amt' }, [rate == null ? '—' : (rate > 0 ? '+' : '') + pct(rate)]),
    ]);
  }

  function mount(node) {
    el = node;
    render();
  }

  return { mount: mount };
})();

if (typeof module !== 'undefined') module.exports = StatsUI;
