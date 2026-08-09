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
  // 底部对账区的当前节点 + 它依赖的上一期 —— 输入时要就地换掉它
  var sumBox = null, sumPrev = null;

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
      oninput: function (e) {
        bag[key] = e.target.value;
        refresh();
        // ⚠️ **底部对账区必须跟着一起变。**
        //    第一版只刷新了这一行右边的 delta,底部那块「合计 / 工资−花费 /
        //    市场涨跌」是进页面时算的一次,之后你怎么改它都不动 ——
        //    而那块是这一页存在的理由(抄完当场核对)。不动等于没有。
        //    整页 render() 不行:输入框会重建,焦点和光标位置全丢。
        refreshSummary();
      },
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
        list.appendChild(numRow(f.name || f.code, f.code, draft.holdings, f.code,
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

    // ⚠️ 这里**没有「本期净投入」输入框**,而且不该有。
    //
    //    原来是有的:你得自己算「这个月转进去多少」填进来,填错了收益率就错。
    //    现在它是**解出来的**:
    //        现金变化 = 外部净流入 − 净买入 + 分红
    //    净买入和分红来自你记的动作,现金变化是这一页抄的,
    //    于是「工资 − 花费」自己就出来了。少一个框,少一处会填错的地方。
    //
    //    下面这块顺便把解出来的数当场显示 —— **抄完就能核对**,
    //    离谱的话多半是漏记了一笔买卖,而不是你真的花了那么多。
    sumPrev = prev;
    sumBox = summary(prev);
    w.appendChild(sumBox);

    w.appendChild(h('button', {
      class: 'btn', style: 'margin-top:16px', onclick: submit,
    }, ['保存这一期']));
    w.appendChild(h('button', {
      class: 'link', style: 'margin-top:8px',
      onclick: function () { if (onDone) onDone(false); },
    }, ['先不存,回去']));

    el.appendChild(w);
  }

  /** 就地换掉底部对账区。**不重建输入框** —— 那会丢焦点和光标位置。 */
  function refreshSummary() {
    if (!sumBox || !sumBox.parentNode) return;
    var fresh = summary(sumPrev);
    sumBox.parentNode.replaceChild(fresh, sumBox);
    sumBox = fresh;
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

    // ---- 解出来的两个数 ----
    //
    // ⚠️ **抄完就当场显示,不等到历史页去看。**
    //    这两个数是这一页的产出,而它们同时也是最好的错误探测器:
    //    「这个月花了二十万」几乎一定是漏记了一笔买入,不是你真的花了。
    //    等你翻到历史页才看见的话,当时的记忆已经没了。
    if (d.source === 'actions') {
      var box2 = h('div', { style: 'margin-top:8px' });
      // ⚠️ **把构成写出来。** 算出个 0 却不说为什么,看着就像坏了 ——
      //    而 0 的成因几乎总是「现金那几栏留空了」:留空 = 沿用上次 = 现金没变,
      //    于是工具认为你这个月一分钱没进过。
      //    工资是体现在**现金余额**上的,不照实抄就没有。
      var dCash = Portfolio.sum(built.snapshot.cash) - Portfolio.sum(prev.cash || {});
      box2.appendChild(h('div', { class: 'between' }, [
        h('span', { class: 'xs dim' }, ['工资 − 花费']),
        h('span', {}, [signed(d.inflow)]),
      ]));
      box2.appendChild(h('div', { class: 'xs dim', style: 'text-align:right;margin-top:-2px' }, [
        '= 现金变化 ' + signed(dCash) + (d.netBuy ? ' + 买卖 ' + signed(d.netBuy) : ''),
      ]));
      box2.appendChild(h('div', { class: 'between' }, [
        h('span', { class: 'xs dim' }, ['市场涨跌']),
        h('span', {}, [signed(d.market)]),
      ]));
      if (d.netBuy) {
        box2.appendChild(h('div', { class: 'between' }, [
          h('span', { class: 'xs dim' }, ['这期买卖(记了的)']),
          h('span', { class: 'xs dim' }, [signed(d.netBuy)]),
        ]));
      }
      box.appendChild(box2);
      // ⚠️ 现金一分没变**几乎一定是漏抄了**,不是真的没变 ——
      //    工资进账、日常开销都走现金账户,一个月下来正好持平的概率极低。
      if (Math.abs(dCash) < 1) {
        box.appendChild(h('div', { class: 'note warn', style: 'margin-top:8px' }, [
          '现金三栏和上次**一模一样** —— 是不是没抄?' +
          '工资和花费都体现在现金余额上,不照实填的话「工资 − 花费」永远是 0。',
        ]));
      }

      // 离谱值兜底。阈值取「一个月净流出超过组合的 5%」——
      // 真发生这种事你自己知道;而更常见的原因是漏记了一笔买入。
      if (d.inflow < 0 && Math.abs(d.inflow) > d.total * 0.05) {
        box.appendChild(h('div', { class: 'note warn', style: 'margin-top:8px' }, [
          '算出来这期净流出 ' + money(-d.inflow) + ' —— ' +
          '**是不是有笔买入忘了记?** 漏记一笔的话,那笔钱会被算成你花掉了。',
        ]));
      }
    } else if (d.change != null) {
      box.appendChild(h('div', { class: 'hint', style: 'margin-top:8px' }, [
        '这一期还分不出「涨跌」和「投入」—— 从记第一笔买卖开始就有了。',
      ]));
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
    // ⚠️ **一项都没填就保存 = 原样复制上一期。**
    //    留空是「沿用上次」,全留空就是「这个月一切没变」——
    //    而那几乎不可能。真存下去的话:涨跌 0、工资 0、清单不变,
    //    看着像工具坏了,实际是多了一期空数据。
    var touched = 0;
    [draft.holdings, draft.cash, draft.external].forEach(function (bag) {
      Object.keys(bag || {}).forEach(function (k) {
        if (!Ledger.isEmpty(bag[k])) touched++;
      });
    });
    if (!touched) {
      Modal.confirm({
        title: '一项都没填 —— 确定要存吗?',
        body: '留空的意思是「沿用上次」,所以这一期会和上一期**一模一样**:' +
              '涨跌 0、工资 − 花费 0、清单也不会变。' +
              '要记这个月的变化,得把基金 app 里的数字抄进来 ——' +
              '尤其是**现金那几栏**,工资和花费都体现在那儿。',
        ok: '还是存', danger: true,
      }).then(function (yes) { if (yes) doSubmit(built); });
      return;
    }
    doSubmit(built);
  }

  function doSubmit(built) {
    var prev = Ledger.latest(snapshots());
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
