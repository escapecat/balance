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

  var el, period = 'all', categoryView = false, selectedCategory = null, chartOffset = 0, chartScope = 'portfolio';
  var MAX_BARS = 12;          // 图上最多画几期
  var overviewScroll = 0;
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

  function periodTabs() {
    return h('div', { class: 'period-tabs', role: 'group', 'aria-label': '统计时间' },
      [['latest', '本期'], ['three', '近三期'], ['year', '今年'], ['all', '完整记录']].map(function (p) {
        return h('button', { class: period === p[0] ? 'active' : '', 'aria-pressed': String(period === p[0]),
          onclick: function () { period = p[0]; chartOffset = 0; render(); } }, [p[1]]);
      }));
  }
  function note(t) { return h('div', { class: 'hint' }, [t]); }
  function valueRow(label, value) {
    return h('div', { class: 'equation-row' }, [h('span', {}, [label]), h('b', { class: 'amount' }, [value])]);
  }
  function categoryPanel(w, snaps, flows, st) {
    var con = Stats.contribution(snaps, flows, st);
    if (!con.ok) { w.appendChild(h('div', { class: 'note' }, [con.why])); return; }
    w.appendChild(note('收益区间 ' + con.from + ' — ' + con.to + ' · 不含组合外估值'));
    var rows = con.rows.slice().sort(function (a, b) { return b.market - a.market; });
    var max = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.market); }).concat([1]));
    if (!rows.some(function (r) { return r.category === selectedCategory; })) selectedCategory = null;
    var list = h('div', { class: 'category-list' });
    rows.forEach(function (r) {
      var width = Math.abs(r.market) / max * 45;
      list.appendChild(h('button', { class: 'category-row' + (selectedCategory === r.category ? ' selected' : ''),
        style: '--c:' + Palette.color(r.category), 'aria-expanded': String(selectedCategory === r.category),
        onclick: function () { selectedCategory = selectedCategory === r.category ? null : r.category; render(); } }, [
        h('div', {}, [h('div', { class: 'ttl' }, [h('i', { class: 'dot' }), r.category]),
          h('div', { class: 'sub2' }, ['净买入 ' + signed(r.inflow)])]),
        h('div', { class: 'diverging-bar', 'aria-hidden': 'true' }, [h('i', {
          style: 'left:' + (r.market < 0 ? 50 - width : 50) + '%;width:' + width + '%',
        })]), h('b', { class: 'amount' }, [signed(r.market)]),
      ]));
      if (selectedCategory === r.category) list.appendChild(h('div', { class: 'equation-card category-detail' }, [h('h2', {}, [r.category + ' · 把账拆开']),
        valueRow('期初市值', money(r.from)), valueRow('＋ 区间净买入', signed(r.inflow)),
        valueRow('＋ 区间盈亏', signed(r.market)), valueRow('− 现金分红', money(r.dividend)), valueRow('＝ 期末市值', money(r.to)),
      ]));
    });
    w.appendChild(list);
    var row = rows.filter(function (r) { return r.category === selectedCategory; })[0];
    if (!row) return;
    var known = {}, names = {};
    Config.allKnown(st).forEach(function (f) { known[f.code] = f.category || '未分类'; names[f.code] = f.name || f.code; });
    var pf = Ledger.perFund(snaps[snaps.length - 1], snaps[0]);
    var funds = (pf || []).filter(function (f) { return (known[f.code] || '未分类') === row.category; });
    if (funds.length) {
      w.appendChild(h('h2', {}, ['这一类里的基金']));
      var fundList = h('div', { class: 'list' });
      funds.forEach(function (f) { fundList.appendChild(h('div', { class: 'list-row' }, [
        h('div', { class: 'body' }, [h('div', { class: 'ttl' }, [names[f.code] || f.code]),
          h('div', { class: 'sub2' }, ['净买入 ' + signed(f.netBuy) + ' · 分红 ' + money(f.dividend)])]),
        h('div', { class: 'amt' }, [signed(f.market)]),
      ])); });
      w.appendChild(fundList);
    }
    if (Actions.between(snaps[0], snaps[snaps.length - 1], flows).some(function (f) { return Actions.MONEY[f.kind] && !f.code; }))
      w.appendChild(h('div', { class: 'note warn' }, ['区间内有未指定基金代码的流水；分类账包含它，但逐只盈亏无法完整分摊，请先核对。']));
  }

  function render() {
    var w = h('div', { class: 'wrap dashboard' });
    var snaps = Store.get('snapshots', []) || [], st = Config.get(), flows = Todos.flows();
    if (categoryView) w.appendChild(Dom.backBar('各类区间盈亏', function () { categoryView = false; render(); Dom.restoreScroll(overviewScroll); }));
    else w.appendChild(h('h1', {}, ['统计']));
    w.appendChild(h('p', { class: 'sub' }, [categoryView ? '看哪类赚了、哪类亏了，点一类能复算' : '先选时间，再看这段时间发生了什么']));
    if (snaps.length < 2) { w.appendChild(h('div', { class: 'note' }, ['至少要两次盘点才有得比。'])); replace(w); return; }
    w.appendChild(periodTabs());
    var range = Stats.select(snaps, period, new Date().getFullYear()), covered = range.covered;
    if (!range.snapshots.length) { w.appendChild(h('div', { class: 'note' }, ['今年还没有盘点记录，可切换“完整记录”查看以前的账。'])); replace(w); return; }
    var sum = Stats.summary(covered);
    w.appendChild(h('div', { class: 'range-line' }, [h('span', {}, [range.from + ' — ' + range.to]), h('span', {}, ['组合口径'])]));
    if (sum.ok && (sum.from !== range.from || range.limited)) w.appendChild(note('收益仅核算 ' + sum.from + ' — ' + sum.to + '；更早买卖不全，不当作零收益。'));
    if (categoryView) {
      categoryPanel(w, covered, flows, st); replace(w); return;
    }
    if (!sum.ok) w.appendChild(h('div', { class: 'note' }, [sum.why + '。不把未知当成零。']));
    else w.appendChild(h('div', { class: 'profit-card' }, [
      h('div', { class: 'range-line' }, [h('span', {}, ['区间投资盈亏']), h('span', { class: 'tag strong' }, ['非年化 · 金额'])]),
      h('div', { class: 'profit-number amount' }, [signed(sum.market)]),
      note('含原有持仓与新买入部分产生的盈亏，已剔除买卖本金。'),
      h('div', { class: 'growth-equation' }, [
        h('div', {}, [h('span', {}, ['外部净流入']), h('b', { class: 'amount' }, [signed(sum.inflow)])]),
        h('span', {}, ['＋']), h('div', {}, [h('span', {}, ['投资盈亏']), h('b', { class: 'amount' }, [signed(sum.market)])]),
        h('span', {}, ['＝']), h('div', {}, [h('span', {}, ['组合总额变化']), h('b', { class: 'amount' }, [signed(sum.change)])]),
      ]),
    ]));
    w.appendChild(h('button', { class: 'btn ghost category-jump', onclick: function () { overviewScroll = Dom.scrollPosition(); categoryView = true; Dom.toTop(); render(); } }, ['查看各类区间盈亏 ›']));
    w.appendChild(h('h2', {}, ['资产增长']));
    var comp = Stats.composition(range.snapshots, st);
    var end = Math.max(1, comp.length - chartOffset), begin = Math.max(0, end - MAX_BARS), shown = comp.slice(begin, end);
    var chart = h('div', { class: 'card asset-chart' });
    chart.appendChild(h('div', { class: 'period-tabs compact', role: 'group', 'aria-label': '资产图口径' },
      [['portfolio', '投资组合'], ['total', '总资产（含组合外）']].map(function (v) {
        return h('button', { class: chartScope === v[0] ? 'active' : '', onclick: function () { chartScope = v[0]; render(); } }, [v[1]]);
      })));
    chart.appendChild(lineChart(shown.map(function (r) { return Object.assign({}, r, { total: r[chartScope], external: chartScope === 'total' ? r.external : 0 }); })));
    chart.appendChild(note('包含外部净流入，仅连接盘点点位；纵轴非零起点，不代表每日收益。'));
    chart.appendChild(note('图示 ' + shown[0].date + ' — ' + shown[shown.length - 1].date + '（' + shown.length + '/' + comp.length + ' 期）'));
    if (comp.length > MAX_BARS) chart.appendChild(h('div', { class: 'button-pair' }, [
      h('button', { class: 'link', disabled: begin === 0 ? '' : null, onclick: function () { chartOffset += MAX_BARS; render(); } }, ['更早的盘点']),
      h('button', { class: 'link', disabled: chartOffset === 0 ? '' : null, onclick: function () { chartOffset = Math.max(0, chartOffset - MAX_BARS); render(); } }, ['较新的盘点']),
    ]));
    var table = h('details', {}, [h('summary', {}, ['查看图中各期金额'])]);
    shown.forEach(function (r) { table.appendChild(valueRow(r.date, money(r[chartScope]))); });
    chart.appendChild(table); w.appendChild(chart);
    w.appendChild(h('h2', {}, ['每期盈亏']));
    w.appendChild(note('按盘点区间，不是自然月。点击查看当期变化。'));
    var spans = range.snapshots.slice(1).map(function (s, i) { return { snap: s, prev: range.snapshots[i], delta: Ledger.delta(s, range.snapshots[i]) }; });
    var grid = h('div', { class: 'period-grid' });
    spans.slice(-MAX_BARS).forEach(function (p) {
      grid.appendChild(h('button', { class: 'period-cell', onclick: function () {
        Modal.note({ title: p.prev.date + ' — ' + p.snap.date,
          body: p.delta.market == null ? '买卖记录不完整，投资盈亏未知。' :
            '投资盈亏 ' + signed(p.delta.market) + '；外部净流入（推算）' + signed(p.delta.inflow) + '；组合总额变化 ' + signed(p.delta.change) + '。' });
      } }, [h('span', {}, [md(p.prev.date) + '–' + md(p.snap.date)]), h('b', { class: 'amount' }, [p.delta.market == null ? '未知' : signed(p.delta.market)])]));
    });
    w.appendChild(grid);
    if (spans.length > MAX_BARS) w.appendChild(note('只显示最近 ' + MAX_BARS + ' 个区间，较早记录可在历史中按年份查阅。'));
    w.appendChild(h('div', { class: 'coverage-note' }, [
      h('b', {}, [sum.ok ? '收益可核算：' + sum.from + ' 起，连续 ' + sum.periods + ' 个区间' : '尚无完整收益区间']),
      note('外部净流入由余额与买卖推算；现金类利息未单独拆分，不等于工资减花费。组合外估值不计入投资盈亏。'),
    ]));
    var rates = h('details', { class: 'secondary-details' }, [h('summary', {}, ['收益率 · 盘点期近似'])]);
    var g = Stats.gate(covered);
    if (!g.ok) rates.appendChild(note('所选收益区间不足 ' + Stats.MIN_PERIODS + ' 期；不延长区间凑数。'));
    else {
      var tw = Stats.twr(covered), xi = Stats.xirr(covered);
      rates.appendChild(valueRow('区间收益率（期末净流入假设）', tw.ok ? pct(tw.rate, 2) : '未知'));
      rates.appendChild(valueRow('资金加权 XIRR（年化近似）', xi.ok && xi.days >= 330 ? pct(xi.rate, 2) : xi.ok ? '未满 330 天，不展示年化' : '未收敛，不展示'));
    }
    rates.appendChild(note('缺少现金流时点的估值，不是精确 TWR；XIRR 将净流入近似放在盘点日。不还原日收益或日级最大回撤。'));
    w.appendChild(rates);
    var structure = h('details', { class: 'secondary-details' }, [h('summary', {}, ['资产结构 · 按当前已知分类回看'])]);
    structure.appendChild(stackChart(shown, orderCats(comp)));
    var last = shown[shown.length - 1], lg = h('div', { class: 'legend' });
    Object.keys(last.pct).forEach(function (c) { if (last.pct[c] > 0) lg.appendChild(h('span', { class: 'lg' }, [h('i', { style: 'background:' + hue(c) }), h('span', {}, [c + ' ' + pct(last.pct[c])])])); });
    structure.appendChild(lg);
    structure.appendChild(note('组合外计入结构，不计入投资盈亏。历史使用当前已知代码归类，不代表当时的目标权重。'));
    w.appendChild(structure); replace(w);
  }
  function replace(w) { el.innerHTML = ''; el.appendChild(w); }

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
    var W = 340, H = 140, padX = 46, padY = 15;
    var vals = comp.map(function (c) { return c.total; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi === lo) { hi = lo + 1; }
    var margin = (hi - lo) * 0.1;
    lo -= margin; hi += margin;
    var span = hi - lo;
    var t0 = Date.parse(comp[0].date), t1 = Date.parse(comp[comp.length - 1].date);
    function X(i) { return padX + (Date.parse(comp[i].date) - t0) / Math.max(1, t1 - t0) * (W - padX - 12); }
    function Y(v) { return padY + (1 - (v - lo) / span) * (H - padY * 2); }

    var ctx = chartBox();
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + (H + 16), width: '100%',
                         role: 'img', 'aria-label': (chartScope === 'total' ? '总资产' : '投资组合') + '盘点走势，纵轴非零起点，含外部净流入' });
    svg.appendChild(s('desc', {}, [txt(comp.map(function (c) { return c.date + '：' + money(c.total); }).join('；'))]));
    [hi, (hi + lo) / 2, lo].forEach(function (v) {
      svg.appendChild(s('line', { x1: padX, x2: W - 12, y1: Y(v), y2: Y(v), stroke: 'var(--border)', 'stroke-dasharray': '3 4' }));
      svg.appendChild(s('text', { x: 0, y: Y(v) + 3, 'font-size': 10, fill: 'var(--text-dim)' }, [txt((v / 10000).toFixed(1) + '万')]));
    });
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
        [c.date], [chartScope === 'total' ? '总资产' : '投资组合', '¥' + money(c.total)],
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
    categoryView = false;
    chartOffset = 0;
    render();
  }

  return { mount: mount };
})();

if (typeof module !== 'undefined') module.exports = StatsUI;
