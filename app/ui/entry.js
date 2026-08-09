// 录入 —— **一屏滚完,不做逐个问答。**
//
// ⚠️ 逐个问答的形态本身就是错的:抄到第 7 个想回头核对第 3 个,问答式做不到。
//    而这些数字是你从基金 app 里一个一个看出来抄过来的,来回核对是常态。
//
// ⚠️ **留空 ≠ 0**,这是这一页的地基:
//      留空 = 这项我没抄,沿用上次
//      0    = 这项清仓了
//    所以输入框的 value **恒为空**,上次的值放在 placeholder 里(灰的)。
//    **不预填** —— 预填会让人分不清「这是上次的还是我刚填的」,
//    而分不清的后果是你把上次的值又原样提交一遍,一期数据就废了。
//
// ⚠️ 每次 blur 存草稿。手机上抄一半接电话、切 app、被杀进程,回来能续。
//    草稿里**留空仍然是留空**(见 jstest/blank.js 第 7 条)。

var EntryUI = (function () {

  var el, draft = null, onDone = null;

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

  function settings() { return Store.get('settings', {}) || {}; }
  function snapshots() { return Store.get('snapshots', []) || []; }
  function money(n) {
    if (n == null || isNaN(n)) return '—';
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function signed(n) { return (n > 0 ? '+' : '') + money(n); }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) +
           '-' + ('0' + d.getDate()).slice(-2);
  }

  function saveDraft() { Ledger.saveDraft(draft); }

  /** 一个输入框 + 上次的值 + 实时 delta */
  function numRow(label, sub, bag, key, prev) {
    var row = h('div', { class: 'list-row' });
    var body = h('div', { class: 'body' }, [
      h('div', { class: 'ttl' }, [label]),
    ]);
    if (sub) body.appendChild(h('div', { class: 'sub2' }, [sub]));
    row.appendChild(body);

    var delta = h('div', { class: 'xs dim', style: 'min-width:5.5em;text-align:right' }, ['']);
    function refresh() {
      var p = Ledger.parse(bag[key]);
      if (p === Ledger.EMPTY || prev == null) { delta.textContent = prev == null ? '' : '沿用'; return; }
      var d = p - prev;
      delta.textContent = d === 0 ? '±0' : signed(d);
      // 单项变动超过一半就标一下 —— 多半是抄串行或者少打一位
      delta.className = 'xs ' + (prev && Math.abs(d) > prev * 0.5 ? 'warn-text' : 'dim');
    }

    var inp = h('input', {
      type: 'text', inputmode: 'decimal',
      // ⚠️ value 恒为空,上次的值只做 placeholder。见文件头那段。
      value: bag[key] == null ? '' : bag[key],
      placeholder: prev == null ? '' : money(prev),
      oninput: function (e) { bag[key] = e.target.value; refresh(); },
      onblur: saveDraft,
      style: 'width:7.5em;text-align:right',
    });
    row.appendChild(inp);
    row.appendChild(delta);
    refresh();
    return row;
  }

  function render() {
    el.innerHTML = '';
    var w = h('div', { class: 'wrap' });
    var st = settings();
    var snaps = snapshots();
    var prev = Ledger.latest(snaps) || { holdings: {}, cash: {}, external: {} };
    var funds = (st.funds || []);

    var filled = 0, total = 0;
    function count(bag, keys) {
      keys.forEach(function (k) {
        total++;
        if (!Ledger.isEmpty(bag[k])) filled++;
      });
    }
    count(draft.holdings, funds.map(function (f) { return f.code; }));
    count(draft.cash, Object.keys(prev.cash || {}));

    w.appendChild(h('h1', {}, ['录入 ' + draft.date.slice(0, 7)]));
    w.appendChild(h('p', { class: 'sub' }, [
      '留空 = 沿用上次。已填 ' + filled + ' / ' + total,
    ]));

    // ⚠️ 交叉校验:基金 app 里那个总数你本来就看得到,填一下,
    //    漏抄一只 / 抄串一行 / 少打一位 全都当场暴露。
    //    这一条比后面任何异常检测都管用,而成本几乎为零。
    w.appendChild(h('div', { class: 'list', style: 'margin-bottom:16px' }, [
      numRow('基金 app 显示的总市值', '可选。填了能当场查出抄错', draft, 'declared', null),
    ]));

    // 按类别分组 —— 和你在基金 app 里看到的顺序对上,能省一半眼睛
    var byCat = {};
    funds.forEach(function (f) {
      (byCat[f.category] = byCat[f.category] || []).push(f);
    });
    Object.keys(byCat).forEach(function (cat) {
      w.appendChild(h('div', { class: 'sec-h' }, [cat]));
      var list = h('div', { class: 'list' });
      byCat[cat].forEach(function (f) {
        var sub = f.code + (f.dailyLimit ? ' · 日限额 ' + money(f.dailyLimit) : '');
        if (f.active === false) sub += ' · 未启用';
        list.appendChild(numRow(f.name || f.code, sub, draft.holdings, f.code,
                                prev.holdings[f.code]));
      });
      w.appendChild(list);
    });

    // 未分类的也要露出来 —— 有钱在这儿说明基金清单缺一条,
    // 而藏起来的话那笔钱永远不参与再平衡,你还查不出总额为什么对不上
    var unknown = Object.keys(prev.holdings || {}).filter(function (c) {
      return !funds.some(function (f) { return f.code === c; });
    });
    if (unknown.length) {
      w.appendChild(h('div', { class: 'sec-h' }, ['未分类']));
      w.appendChild(h('div', { class: 'hint', style: 'margin-bottom:8px' }, [
        '这几只不在基金清单里,不会参与再平衡 —— 去「设置」补一条就好',
      ]));
      var ul = h('div', { class: 'list' });
      unknown.forEach(function (c) {
        ul.appendChild(numRow(c, '未分类', draft.holdings, c, prev.holdings[c]));
      });
      w.appendChild(ul);
    }

    w.appendChild(h('div', { class: 'sec-h' }, ['现金']));
    var cl = h('div', { class: 'list' });
    Object.keys(prev.cash || {}).forEach(function (k) {
      cl.appendChild(numRow(Labels.cash(k), null, draft.cash, k, prev.cash[k]));
    });
    w.appendChild(cl);

    var ext = Assets.all();
    if (ext.length) {
      w.appendChild(h('div', { class: 'sec-h' }, ['组合之外']));
      var el2 = h('div', { class: 'list' });
      ext.forEach(function (a) {
        // 上次的值来自上一期快照,不是资产条目自己 —— 金额只有一处出处
        el2.appendChild(numRow(a.name, Labels.kind(a.kind), draft.external, a.id,
                               Assets.valueAt(prev, a.id)));
      });
      w.appendChild(el2);
    }

    // ⚠️ 净投入是这一页唯一的**新增输入**,也是「统计分析」的全部前提。
    //    没有它,「总额涨了这么多」永远分不清是赚的还是又投的。
    w.appendChild(h('div', { class: 'sec-h' }, ['本期净投入']));
    w.appendChild(h('div', { class: 'list' }, [
      numRow('转进去的 − 取出来的', '不填 = 这期没动过钱。取钱出来填负数',
             draft, 'netInflow', null),
    ]));

    w.appendChild(summary(prev));

    w.appendChild(h('button', {
      class: 'btn', style: 'margin-top:16px', onclick: submit,
    }, ['保存这一期']));
    w.appendChild(h('button', {
      class: 'link', style: 'margin-top:8px',
      onclick: function () { if (onDone) onDone(false); },
    }, ['先不存,回去']));

    el.appendChild(w);
  }

  /** 底部对账 —— 抄错的话在这儿现形 */
  function summary(prev) {
    var box = h('div', { class: 'card', style: 'margin-top:16px' });
    var built = Ledger.build(draft, prev, draft.date);
    var d = Ledger.delta(built.snapshot, prev);

    box.appendChild(h('div', { class: 'between' }, [
      h('strong', {}, ['合计 ¥' + money(d.total)]),
      h('span', { class: 'xs dim' }, [
        d.change == null ? '第一期' : '上次 ' + money(d.total - d.change) + '  ' + signed(d.change),
      ]),
    ]));

    var declared = Ledger.parse(draft.declared);
    if (declared !== Ledger.EMPTY) {
      var mine = Portfolio.sum(built.snapshot.holdings);
      var diff = declared - mine;
      if (Math.abs(diff) > 1) {
        box.appendChild(h('div', { class: 'note warn', style: 'margin-top:8px' }, [
          '你说总市值 ' + money(declared) + ',这里加起来是 ' + money(mine) +
          ' —— 差 ' + money(Math.abs(diff)) + '。是不是漏了一只,或者少打了一位?',
        ]));
      } else {
        box.appendChild(h('div', { class: 'hint', style: 'margin-top:8px' }, ['和基金 app 对上了 ✓']));
      }
    }

    if (!built.ok) {
      box.appendChild(h('div', { class: 'note warn', style: 'margin-top:8px' },
                        [built.errors.join(';')]));
    }
    return box;
  }

  function submit() {
    var prev = Ledger.latest(snapshots());
    var built = Ledger.build(draft, prev, draft.date);
    if (!built.ok) {
      Modal.note({ title: '这几项没法存', body: built.errors.join('\n') });
      return;
    }

    // ⚠️ 显式填 0 = 清仓,得确认一次。这是唯一会「把一整只基金抹掉」的输入,
    //    而抹掉之后从总额上完全看不出来 —— 你只会以为市场跌了。
    var zeroed = [];
    Object.keys(draft.holdings || {}).forEach(function (k) {
      if (Ledger.parse(draft.holdings[k]) === 0 && prev && prev.holdings[k] > 0) zeroed.push(k);
    });
    var go = zeroed.length
      ? Modal.confirm({
          title: '这几只记成 0?',
          body: zeroed.join('、') + ' 填的是 0,等于已经清仓。\n' +
                '要是只想「沿用上次」,把框清空就行 —— 留空和 0 不是一回事。',
          ok: '确认清仓', danger: true,
        })
      : Promise.resolve(true);

    go.then(function (yes) {
      if (!yes) return;
      Ledger.commit(built.snapshot);
      if (onDone) onDone(true);
    });
  }

  function mount(node, opts) {
    el = node;
    onDone = (opts || {}).onDone;
    draft = Ledger.loadDraft() || { date: today(), holdings: {}, cash: {},
                                    external: {}, netInflow: '', declared: '' };
    if (!draft.date) draft.date = today();
    render();
  }

  return { mount: mount };
})();

if (typeof module !== 'undefined') module.exports = EntryUI;
