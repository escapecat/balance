// 设置 —— **基金和类别都能自己加减改。**
//
// ⚠️ 这一页是这次重做最直接的收益。以前改一个日限额要:
//    改 config.yaml → git push → 等容器重启 —— 一个下拉框的事走了三步部署流程。
//    所以这里的原则是:**凡是会变的东西,界面上都能改**。
//
// ⚠️ 「未分类」的持仓要**显示在最上面**,而且一点就能归类。
//    藏起来的话那笔钱永远不参与再平衡,而你只会奇怪总额为什么对不上。
//    (迁移时留了一只 007174 —— 数字和 007147 一样只是顺序不同,像是笔误。)

var SettingsUI = (function () {

  var el, onChanged = null, editing = null;

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
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function pct(x) { return x == null ? '—' : (x * 100).toFixed(1).replace(/\.0$/, '') + '%'; }
  function st() { return Store.get('settings', {}) || {}; }
  function save(patch) { Config.save(patch); if (onChanged) onChanged(); render(); }

  function render() {
    el.innerHTML = '';
    // 编辑基金时**整屏接管** —— 和录入页同一个模式。
    // 在长长的设置列表中间就地展开的话,滚动位置会跳,改完还得自己找回来。
    if (editing) { el.appendChild(fundForm()); return; }
    var w = h('div', { class: 'wrap' });
    var s = st();
    var snaps = Store.get('snapshots', []) || [];
    var snap = Ledger.latest(snaps);
    var sm = snap ? Portfolio.summarize(snap, s) : null;

    w.appendChild(h('h1', {}, ['设置']));

    // ---- 未分类:排最上面,因为它在让账目对不上 ----
    //
    // ⚠️ 要扫**所有历史快照**,不是只扫最新一期。
    //    孤儿可能只出现在早期(比如建仓那天打错一个代码,后来改对了)——
    //    只扫最新一期的话它永远露不出来,而它的钱确实计在那一期的总额里,
    //    于是那一期的类别汇总和总额对不上,你还查不出差在哪。
    var funds = s.funds || [];
    var known = {};
    funds.forEach(function (f) { known[f.code] = 1; });
    var orphanAt = {};                    // code → [日期]
    snaps.forEach(function (sn) {
      Object.keys(sn.holdings || {}).forEach(function (c) {
        if (!known[c]) (orphanAt[c] = orphanAt[c] || []).push(sn.date);
      });
    });
    var orphans = Object.keys(orphanAt);
    if (orphans.length) {
      w.appendChild(h('h2', {}, ['未分类 · ' + orphans.length + ' 只']));
      w.appendChild(h('div', { class: 'hint', style: 'margin-bottom:8px' }, [
        '这几只不在基金清单里,**不参与再平衡**,但钱算在总额里 —— 补一条就好。',
      ]));
      var ol = h('div', { class: 'list' });
      orphans.forEach(function (code) {
        var dates = orphanAt[code];
        var stillHeld = snap && snap.holdings[code] != null;
        var amount = stillHeld ? snap.holdings[code]
                               : (snaps.filter(function (x) { return x.date === dates[dates.length - 1]; })[0] || {}).holdings[code];
        ol.appendChild(h('div', {
          class: 'list-row', onclick: function () { fixOrphan(code, amount, dates); },
        }, [
          h('div', { class: 'body' }, [
            h('div', { class: 'ttl' }, [code]),
            h('div', { class: 'sub2' }, [
              '¥' + money(amount) +
              (stillHeld ? '' : ' · 只在 ' + dates.join('、') + ' 出现过') +
              ' · 点一下归类',
            ]),
          ]),
          h('span', { class: 'chev' }),
        ]));
      });
      w.appendChild(ol);
    }

    // ---- 目标比例 ----
    //
    // ⚠️ **说清分母。** 百分比按「组合」算(持仓 + 现金),不含组合外资产 ——
    //    首页顶上那个大数是「总资产」,两个数差着一个 MSFT,
    //    不说的话你会拿 20% 去乘错的那个总额。
    w.appendChild(h('h2', {}, ['目标比例']));
    if (sm) {
      var extSum = Assets.total(snap).sum;
      w.appendChild(h('div', { class: 'hint', style: 'margin-bottom:8px' }, [
        '按**组合** ¥' + money(sm.total) + ' 算' +
        (extSum ? '(不含组合外的 ¥' + money(extSum) + ' —— 那部分不参与再平衡)' : '') + '。',
      ]));
    }
    var tl = h('div', { class: 'list' });
    var sum = 0;
    Object.keys(s.targets || {}).forEach(function (c) {
      sum += s.targets[c];
      tl.appendChild(h('div', {
        class: 'list-row',
        onclick: function () {
          Modal.ask({
            title: c + ' 占多少?', hint: '填百分数,比如 20',
            type: 'number', suffix: '%', value: Math.round(s.targets[c] * 1000) / 10,
          }).then(function (v) {
            if (v == null) return;
            var n = parseFloat(v);
            if (isNaN(n) || n < 0) return;
            var t = Object.assign({}, s.targets); t[c] = n / 100;
            save({ targets: t });
          });
        },
      }, [
        h('div', { class: 'body' }, [h('div', { class: 'ttl' }, [c])]),
        h('div', { class: 'amt' }, [(s.targets[c] * 100).toFixed(0) + '%']),
      ]));
    });
    w.appendChild(tl);
    // ⚠️ 加起来不是 100% 要**当场说**。差几个点的话所有缺口都是错的,
    //    而错的方式很隐蔽:每一类看着都合理,只是总也填不满。
    if (Math.abs(sum - 1) > 0.0001) {
      w.appendChild(h('div', { class: 'note warn', style: 'margin-top:8px' }, [
        '加起来是 **' + (sum * 100).toFixed(1) + '%**,不是 100% —— ' +
        '这样算出来的缺口全是错的,而且每一类看着都合理。',
      ]));
    }
    w.appendChild(h('button', {
      class: 'btn ghost', style: 'margin-top:8px',
      onclick: function () {
        Modal.ask({ title: '加一个类别', hint: '比如「REITs」「商品」' }).then(function (name) {
          if (!name) return;
          var t = Object.assign({}, s.targets); t[name] = 0;
          save({ targets: t });
        });
      },
    }, ['＋ 加一个类别']));

    // ---- 基金清单 ----
    //
    // ⚠️ **清仓的沉到底部并标出来。** 卖光了的基金还留在清单里,
    //    每次加新基金都要从它们中间划过去 —— 而它们已经不参与任何事了。
    //    但也不自动删:今天清零明天买回来是常事,
    //    自动改配置这件事本身会让人不安。点一下就能删。
    var held = (snap || {}).holdings || {};
    var live = [], empty = [];
    funds.forEach(function (f) {
      ((held[f.code] > 0) ? live : empty).push(f);
    });
    // 持仓大的在前 —— 顺序和「谁是主基金」的规则一致,看着不会打架
    live.sort(function (a, b) { return (held[b.code] || 0) - (held[a.code] || 0); });

    // 每类持仓最大的那只 = 买入落点。**算出来的,不是标记出来的**
    var mainOf = {};
    live.forEach(function (f) { if (!mainOf[f.category]) mainOf[f.category] = f.code; });

    w.appendChild(h('h2', {}, ['基金', h('span', { class: 'n' }, [live.length + ' 只'])]));
    var fl = h('div', { class: 'list' });
    live.forEach(function (f) {
      fl.appendChild(h('div', {
        class: 'list-row', onclick: function () { editFund(f, false); },
      }, [
        h('div', { class: 'body' }, [
          h('div', { class: 'ttl' }, [f.name || f.code]),
          h('div', { class: 'sub2' }, [
            f.code + ' · ' + f.category +
            (mainOf[f.category] === f.code ? ' · 买入落这只' : ''),
          ]),
        ]),
        h('div', { class: 'amt dim' }, [
          h('span', { class: 'u' }, ['¥']), money(held[f.code]),
        ]),
        h('span', { class: 'chev' }),
      ]));
    });
    w.appendChild(fl);
    w.appendChild(h('button', {
      class: 'btn ghost', style: 'margin-top:8px',
      onclick: function () { editFund({}, true); },
    }, ['＋ 加一只基金']));

    if (empty.length) {
      w.appendChild(h('h2', {}, ['已清仓', h('span', { class: 'n' }, [empty.length + ' 只'])]));
      w.appendChild(h('div', { class: 'hint', style: 'margin-bottom:8px' }, [
        '持仓是 0 了。删掉之后**历史里的金额一分不动**,归类也留着 —— ' +
        '那几期照样算得对。',
      ]));
      var el0 = h('div', { class: 'list' });
      empty.forEach(function (f) {
        el0.appendChild(h('div', {
          class: 'list-row', onclick: function () { dropEmpty(f); },
        }, [
          h('div', { class: 'body' }, [
            h('div', { class: 'ttl' }, [f.name || f.code]),
            h('div', { class: 'sub2' }, [f.code + ' · ' + f.category + ' · 点一下删掉']),
          ]),
          h('span', { class: 'chev' }),
        ]));
      });
      w.appendChild(el0);
    }

    // ---- 现金 ----
    // ⚠️ 这两项**一起决定「留多少现金不投」**,取更严的那个。
    //    分开写是因为它们管的是不同的事,而只守一个都会出问题:
    //    只守绝对数 → 资产涨上去之后备用金相对越来越薄;
    //    只守比例   → 刚起步时留的钱可能连一次应急都不够。
    w.appendChild(h('h2', {}, ['现金']));
    w.appendChild(h('div', { class: 'list' }, [
      numItem('现金保底', '绝对下限。不管总额多少,至少留这么多', 'cashFloor', s.cashFloor, ''),
      numItem('现金目标占比', '现金也是一个类别。总额涨了,备用金跟着涨',
              'cashTarget', Math.round((s.cashTarget || 0) * 1000) / 10, '%'),
      numItem('偏差带', '偏差超过这么多个百分点,年度再平衡才动手',
              'band', Math.round((s.band || 0) * 1000) / 10, '%'),
    ]));
    // ⚠️ 把两条设置**合起来的结果**算给人看,而且每个数都写清来源。
    //    只摆两个百分比的话,「所以我到底能投多少」得自己在脑子里算 ——
    //    而那正是你打开这一页想知道的唯一一件事。
    if (snap) {
      var byFloor = s.cashFloor || 0;
      var byRatio = (s.cashTarget || 0) * sm.total;
      var keep = Math.max(byFloor, byRatio);
      var which = byRatio >= byFloor
        ? '目标占比更严:' + pct(s.cashTarget) + ' × 组合 ' + money(sm.total)
        : '保底更严:' + money(byFloor) + ' 这个绝对数';
      w.appendChild(h('div', { class: 'hint' }, [
        '你现在有现金 **¥' + money(sm.cash) + '**。按上面两条要留下 ' +
        '**¥' + money(keep) + '** 不投(' + which + '),' +
        '剩下 **¥' + money(Math.max(0, sm.cash - keep)) + '** 拿去买基金。',
      ]));
    }

    // ---- 组合之外 ----
    //
    // ⚠️ 这里只改**名目**(叫什么、算哪一类)。金额在录入页填 ——
    //    和基金持仓同一条路,同一期的数字待在同一条快照里。
    w.appendChild(h('h2', {}, ['组合之外']));
    w.appendChild(h('div', { class: 'hint', style: 'margin-bottom:8px' }, [
      '不参与再平衡,但算进总资产。**金额在录入页填**,这里只管名目。',
    ]));
    var al = h('div', { class: 'list' });
    Assets.all().forEach(function (a) {
      var v = Assets.valueAt(snap, a.id);
      al.appendChild(h('div', {
        class: 'list-row', onclick: function () { editAsset(a); },
      }, [
        h('div', { class: 'body' }, [
          h('div', { class: 'ttl' }, [a.name]),
          h('div', { class: 'sub2' }, [
            Labels.kind(a.kind) + ' · ' +
            (v == null ? '还没填过金额' : '¥' + money(v)),
          ]),
        ]),
        h('span', { class: 'chev' }),
      ]));
    });
    w.appendChild(al);
    w.appendChild(h('button', {
      class: 'btn ghost', style: 'margin-top:8px',
      onclick: function () { editAsset(null); },
    }, ['＋ 加一项']));

    // ---- 买卖记录 ----
    //
    // ⚠️ 平时不用管。放在这儿是因为**万一哪期算得不对,得有地方能改** ——
    //    唯一会出错的情况是「某次对账之后买过东西但没记」,
    //    那笔会被算成「市场涨跌」。把起点往后挪一期,那期就退回「分不出」,
    //    总比留着一个错的数强。
    var since = Actions.since();
    if (since) {
      w.appendChild(h('h2', {}, ['买卖记录']));
      w.appendChild(h('div', { class: 'list' }, [
        h('div', {
          class: 'list-row',
          onclick: function () { editSince(since); },
        }, [
          h('div', { class: 'body' }, [
            h('div', { class: 'ttl' }, ['从 ' + since + ' 起记全了']),
            h('div', { class: 'sub2' }, [
              '这天之后的每一期都能算出涨跌 · 共 ' +
              Actions.all().length + ' 笔记录',
            ]),
          ]),
          h('span', { class: 'chev' }),
        ]),
      ]));
    }

    // ---- 版本 ----
    //
    // ⚠️ 「我改了你怎么还是老样子」这种事,不给版本号就只能靠猜。
    //    显示构建时间(index.html 里的 <meta name="build">)——
    //    你一眼就能知道手机上跑的是不是最新那版。
    var build = null;
    try {
      var m = document.querySelector('meta[name="build"]');
      build = m && m.getAttribute('content');
    } catch (e) {}
    w.appendChild(h('h2', {}, ['版本']));
    w.appendChild(h('div', { class: 'list' }, [
      h('div', { class: 'list-row', onclick: hardReload }, [
        h('div', { class: 'body' }, [
          h('div', { class: 'ttl' }, [build || '(未知)']),
          h('div', { class: 'sub2' }, ['点一下强制拿最新版']),
        ]),
        h('span', { class: 'chev' }),
      ]),
    ]));

    // ---- 备份 ----
    w.appendChild(h('h2', {}, ['备份']));
    w.appendChild(h('div', { class: 'hint', style: 'margin-bottom:8px' }, [
      '数据只存在这台设备的浏览器里。**换手机、清缓存都会丢** —— 这是唯一的兜底。',
    ]));
    w.appendChild(h('button', { class: 'btn ghost', onclick: exportFile }, ['导出备份']));
    w.appendChild(h('button', { class: 'btn ghost', style: 'margin-top:8px',
                                onclick: importFile }, ['导入备份']));

    // ---- 回滚点 ----
    //
    // ⚠️ 只在**真有**回滚点的时候才显示。平时挂一个「回到上一个状态」
    //    但点了说「没有可回滚的」,那比不放还糟 ——
    //    你会以为自己一直有条后路。
    var rb = Store.getRollback();
    if (rb) {
      var rbChk = Store.inspectImport(rb);
      w.appendChild(h('div', { class: 'hint', style: 'margin-top:16px' }, [
        '上一个状态:**' + (rb.reason || '自动存的') + '**' +
        (rb.savedAt ? ' · ' + rb.savedAt.slice(0, 16).replace('T', ' ') : '') +
        (rbChk.ok ? '(' + rbChk.summary.snapshots + ' 期)' : '(坏了,用不了)'),
      ]));
      if (rbChk.ok) {
        w.appendChild(h('button', {
          class: 'btn ghost', style: 'margin-top:8px', onclick: doRollback,
        }, ['退回上一个状态']));
      }
    }

    el.appendChild(w);
  }

  function numItem(label, sub, key, value, suffix) {
    return h('div', {
      class: 'list-row',
      onclick: function () {
        Modal.ask({ title: label, hint: sub, type: 'number', suffix: suffix,
                    value: value }).then(function (v) {
          if (v == null) return;
          var n = parseFloat(v);
          if (isNaN(n)) return;
          var patch = {};
          patch[key] = suffix === '%' ? n / 100 : n;
          save(patch);
        });
      },
    }, [
      h('div', { class: 'body' }, [
        h('div', { class: 'ttl' }, [label]),
        h('div', { class: 'sub2' }, [sub]),
      ]),
      h('div', { class: 'amt' }, [money(value) + suffix]),
    ]);
  }

  /** 处理一只「未分类」的持仓。
   *
   *  ⚠️ 三条路对应三种**当年发生过的事**,而只有你知道是哪种:
   *      打错了代码 → 并进对的那只,总额不变(最安全)
   *      真买过     → 加进基金清单,归个类
   *      记错了     → 从历史里删掉,**总额跟着变**
   *
   *  ⚠️ 最后那条是唯一会改变历史总额的操作,所以要把
   *     「哪几期、各变多少」摆出来让人看清,而不是问一句「确定吗」。
   */
  function fixOrphan(code, amount, dates) {
    Modal.pick({
      title: code,
      hint: '¥' + money(amount) + ' · 出现在 ' + dates.join('、'),
      options: [
        { key: 'merge', label: '并进另一只', hint: '当年打错了代码 —— 总额不变' },
        { key: 'add', label: '加进基金清单', hint: '确实买过这只,给它归个类' },
        { key: 'drop', label: '从历史里删掉', danger: true,
          hint: '当年记错了,那笔钱本来就不存在 —— 总额会跟着减' },
      ],
    }).then(function (v) {
      if (v === 'add') { editFund({ code: code }, true); return; }
      if (v === 'merge') { mergeOrphan(code); return; }
      if (v === 'drop') { dropOrphan(code); return; }
    });
  }

  function mergeOrphan(code) {
    var funds = st().funds || [];
    if (!funds.length) { Modal.note({ title: '清单里还没有基金', body: '先加一只再来并。' }); return; }
    Modal.pick({
      title: '并进哪一只?',
      hint: code + ' 的钱会加到你选的那只上,每一期的总额都不变',
      options: funds.map(function (f) {
        return { key: f.code, label: f.name || f.code, hint: f.code + ' · ' + f.category };
      }),
    }).then(function (to) {
      if (!to) return;
      var r = Ledger.mergeHolding(code, to);
      if (!r.ok) { Modal.note({ title: '并不了', body: r.why }); return; }
      Modal.note({ title: '并好了',
                   body: r.periods + ' 期里的 ¥' + money(r.moved) + ' 已经并进 ' + to +
                         '。\n总额一分没变 —— 只是换了个名字挂着。' });
      if (onChanged) onChanged();
      render();
    });
  }

  function dropOrphan(code) {
    var hist = Ledger.holdingHistory(code);
    var lines = hist.map(function (h) {
      var before = Store.get('snapshots', []).filter(function (s) { return s.date === h.date; })[0];
      var tot = Portfolio.sum(before.holdings) + Portfolio.sum(before.cash);
      return h.date + ':' + money(tot) + ' → ' + money(tot - h.value) +
             '(少 ' + money(h.value) + ')';
    });
    Modal.confirm({
      title: '把 ' + code + ' 从历史里删掉?',
      body: '这几期的**总额会变**:\n\n' + lines.join('\n') +
            '\n\n变完之后,那几期的数字和你当年在基金 app 上看到的就对不上了。\n' +
            '删之前会自动存回滚点,设置页里能退回来。',
      ok: '删掉', danger: true,
    }).then(function (ok) {
      if (!ok) return;
      var r = Ledger.dropHolding(code);
      if (!r.ok) { Modal.note({ title: '删不了', body: r.why }); return; }
      // 清单里那条登记也要跟着去掉,不然设置页还挂着一个指向不存在的东西
      var s = st();
      Config.save({ unclassified: (s.unclassified || []).filter(function (c) { return c !== code; }) });
      if (onChanged) onChanged();
      render();
    });
  }

  /** 加 / 改一只基金 —— **一屏问完,不做多步菜单。**
   *
   *  ⚠️ 早先这里是个菜单:改名字点一次、改类别再点一次、改代码又一次。
   *     要改三项就得进出三轮,而每轮之间还得重新找到这只基金。
   *     录入页早就坚持「一屏滚完不做逐个问答」了,这里却做反了。
   *
   *  ⚠️ 字段**只剩三个**:代码 · 名字 · 类别。
   *     日限额、未启用、退役中都砍了 —— 前者不再有约束,
   *     后两者和「谁是主基金」说的是同一件事,而那件事现在从持仓自动推。
   */
  function editFund(f, isNew) {
    editing = { code: f.code || '', name: f.name || '', category: f.category || '',
                _old: isNew ? null : f.code, isNew: !!isNew };
    render();
  }

  function fundForm() {
    var s = st();
    var cats = Object.keys(s.targets || {});
    var w = h('div', { class: 'wrap' });
    var d = editing;

    w.appendChild(h('h1', {}, [d.isNew ? '加一只基金' : (d.name || d.code)]));

    function textRow(label, key, hint, mode) {
      var row = h('div', { class: 'list-row' }, [
        h('div', { class: 'body' }, [
          h('div', { class: 'ttl' }, [label]),
          hint ? h('div', { class: 'sub2' }, [hint]) : '',
        ].filter(function (x) { return x !== ''; })),
      ]);
      row.appendChild(h('input', {
        type: 'text', inputmode: mode || 'text', value: d[key],
        oninput: function (e) { d[key] = e.target.value; },
        style: 'width:9em;text-align:right',
      }));
      return row;
    }

    w.appendChild(h('div', { class: 'list' }, [
      textRow('基金代码', 'code', '六位数字', 'numeric'),
      textRow('名字', 'name', '你自己认得出就行'),
      h('div', {
        class: 'list-row',
        onclick: function () {
          Modal.pick({
            title: '归到哪一类',
            hint: cats.length ? null : '还没有类别 —— 先在上面「目标比例」加一个',
            options: cats.map(function (c) { return { key: c, label: c }; }),
          }).then(function (c) { if (c) { d.category = c; render(); } });
        },
      }, [
        h('div', { class: 'body' }, [
          h('div', { class: 'ttl' }, ['类别']),
          h('div', { class: 'sub2' }, ['决定它参与哪一档目标比例']),
        ]),
        h('div', { class: 'amt' }, [d.category || '还没选']),
        h('span', { class: 'chev' }),
      ]),
    ]));

    w.appendChild(h('button', {
      class: 'btn', style: 'margin-top:16px', onclick: saveFund,
    }, ['保存']));
    w.appendChild(h('button', {
      class: 'link', style: 'margin-top:8px',
      onclick: function () { editing = null; render(); },
    }, ['不改了']));

    if (!d.isNew) {
      w.appendChild(h('button', {
        class: 'link danger', style: 'margin-top:16px',
        onclick: function () { dropEmpty({ code: d._old, name: d.name, category: d.category }); },
      }, ['从清单里删掉']));
    }
    return w;
  }

  function saveFund() {
    var d = editing;
    if (!/^\d{6}$/.test(String(d.code).trim())) {
      Modal.note({ title: '代码不对', body: '基金代码是六位数字。' });
      return;
    }
    if (!d.category) { Modal.note({ title: '还没选类别', body: '不归类的话它不参与再平衡。' }); return; }
    var payload = { code: String(d.code).trim(), name: (d.name || '').trim() || d.code,
                    category: d.category };
    if (d._old && d._old !== payload.code) payload._oldCode = d._old;
    var r = Config.upsertFund(payload, d.isNew);
    if (!r.ok) { Modal.note({ title: '存不下来', body: r.why }); return; }
    editing = null;
    if (onChanged) onChanged();
    render();
  }

  /** 删掉一只 —— 清仓的清理,或者加错了想撤。
   *  ⚠️ 归类会留在 `retired` 里,所以**历史那几期照样算得对**。 */
  function dropEmpty(f) {
    Modal.confirm({
      title: '把「' + (f.name || f.code) + '」从清单里删掉?',
      body: '历史快照里的金额**一分不动**,归类也留着 —— 那几期照样算得对。' +
            '只是它不再出现在清单和再平衡里。以后又买回来,加回去就行。',
      ok: '删掉', danger: true,
    }).then(function (ok) {
      if (!ok) return;
      Config.removeFund(f.code);
      editing = null;
      if (onChanged) onChanged();
      render();
    });
  }

  // ---- 备份 ----

  function exportFile() {
    var blob = new Blob([JSON.stringify(Store.exportAll(), null, 1)],
                        { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'balance-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /** 强制拿最新版:清掉 Service Worker 的缓存再重载。
   *  ⚠️ **只清缓存,不碰 localStorage** —— 数据一个字节都不动。 */
  function hardReload() {
    var done = function () { location.reload(true); };
    try {
      if (typeof caches === 'undefined') return done();
      caches.keys().then(function (names) {
        return Promise.all(names.filter(function (n) { return n.indexOf('balance-') === 0; })
                               .map(function (n) { return caches.delete(n); }));
      }).then(done, done);
    } catch (e) { done(); }
  }

  /** 退回上一个状态。**当前状态会存成新的回滚点** ——
   *  否则误点一下就再也回不来了,而这个按钮本来是用来救命的。 */
  function doRollback() {
    var rb = Store.getRollback();
    var chk = Store.inspectImport(rb);
    var cur = Store.exportAll().data;
    Modal.confirm({
      title: '退回到「' + (rb.reason || '上一个状态') + '」?',
      body: '那份里:' + chk.summary.snapshots + ' 期(' +
            (chk.summary.first || '?') + ' 到 ' + (chk.summary.last || '?') + ')\n' +
            '现在这份:' + ((cur.snapshots || []).length) + ' 期\n\n' +
            '现在这份会存成新的回滚点,所以退错了还能再退回来。',
      ok: '退回去',
    }).then(function (ok) {
      if (!ok) return;
      var r = Store.rollback();
      if (!r.ok) { Modal.note({ title: '退不回去', body: r.why }); return; }
      if (onChanged) onChanged();
      render();
    });
  }

  function importFile() {    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json,.json';
    inp.addEventListener('change', function () {
      var file = inp.files && inp.files[0];
      if (!file) return;
      var fr = new FileReader();
      fr.onload = function () {
        var obj;
        try { obj = JSON.parse(fr.result); }
        catch (e) { Modal.note({ title: '这个文件读不了', body: '不是合法的 JSON。' }); return; }
        // ⚠️ **先看清要盖掉什么,再决定。** 导入是唯一不可撤销的写操作。
        var chk = Store.inspectImport(obj);
        if (!chk.ok) { Modal.note({ title: '这份备份有问题', body: chk.why }); return; }
        var cur = Store.exportAll().data;
        Modal.confirm({
          title: '用这份备份覆盖?',
          body: '备份里:' + chk.summary.snapshots + ' 期(' +
                (chk.summary.first || '?') + ' 到 ' + (chk.summary.last || '?') + ')\n' +
                '这台设备上:' + ((cur.snapshots || []).length) + ' 期\n\n' +
                '全部会被替换掉,不能撤销。',
          ok: '覆盖', danger: true,
        }).then(function (ok) {
          if (!ok) return;
          try { Store.importAll(obj); } catch (e) {
            Modal.note({ title: '导入失败', body: e.message + '\n\n数据没有被改动。' });
            return;
          }
          if (onChanged) onChanged();
          render();
        });
      };
      fr.readAsText(file);
    });
    inp.click();
  }

  function mount(node, opts) {
    el = node;
    onChanged = (opts || {}).onChanged;
    editing = null;
    render();
  }

  return { mount: mount, exportFile: exportFile };
})();

if (typeof module !== 'undefined') module.exports = SettingsUI;
