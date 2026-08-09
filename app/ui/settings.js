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
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function st() { return Store.get('settings', {}) || {}; }
  function save(patch) { Config.save(patch); if (onChanged) onChanged(); render(); }

  function render() {
    el.innerHTML = '';
    var w = h('div', { class: 'wrap' });
    var s = st();
    var snaps = Store.get('snapshots', []) || [];
    var snap = Ledger.latest(snaps);

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
          class: 'list-row', onclick: function () { editFund({ code: code }, true); },
        }, [
          h('div', { class: 'body' }, [
            h('div', { class: 'ttl' }, [code]),
            h('div', { class: 'sub2' }, [
              '¥' + money(amount) +
              (stillHeld ? '' : ' · 只在 ' + dates.join('、') + ' 出现过') +
              ' · 点一下归类',
            ]),
          ]),
          h('span', { class: 'dim' }, ['▸']),
        ]));
      });
      w.appendChild(ol);
    }

    // ---- 目标比例 ----
    w.appendChild(h('h2', {}, ['目标比例']));
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
        h('div', { class: 'num', style: 'font-weight:600' },
          [(s.targets[c] * 100).toFixed(0) + '%']),
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
    w.appendChild(h('h2', {}, ['基金 · ' + funds.length + ' 只']));
    var fl = h('div', { class: 'list' });
    funds.forEach(function (f) {
      var bits = [f.code, f.category];
      if (f.dailyLimit) bits.push('日限额 ' + money(f.dailyLimit));
      if (f.primary) bits.push('主');
      if (f.active === false) bits.push('未启用');
      if (f.status === 'phasing_out') bits.push('退役中');
      fl.appendChild(h('div', {
        class: 'list-row', onclick: function () { editFund(f, false); },
      }, [
        h('div', { class: 'body' }, [
          h('div', { class: 'ttl' }, [f.name || f.code]),
          h('div', { class: 'sub2' }, [bits.join(' · ')]),
        ]),
        h('span', { class: 'dim' }, ['▸']),
      ]));
    });
    w.appendChild(fl);
    w.appendChild(h('button', {
      class: 'btn ghost', style: 'margin-top:8px',
      onclick: function () { editFund({}, true); },
    }, ['＋ 加一只基金']));

    // ---- 现金 ----
    w.appendChild(h('h2', {}, ['现金']));
    w.appendChild(h('div', { class: 'list' }, [
      numItem('现金保底', '低于这个数就不再拿去买东西', 'cashFloor', s.cashFloor, ''),
      numItem('现金目标占比', '现金也是一个类别,它常常是最大的偏离项',
              'cashTarget', Math.round((s.cashTarget || 0) * 1000) / 10, '%'),
      numItem('偏差带', '偏差超过这么多个百分点,年度再平衡才动手',
              'band', Math.round((s.band || 0) * 1000) / 10, '%'),
    ]));

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
        h('span', { class: 'dim' }, ['▸']),
      ]));
    });
    w.appendChild(al);
    w.appendChild(h('button', {
      class: 'btn ghost', style: 'margin-top:8px',
      onclick: function () { editAsset(null); },
    }, ['＋ 加一项']));

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
      h('div', { class: 'num', style: 'font-weight:600' }, [money(value) + suffix]),
    ]);
  }

  /** 加 / 改 / 删一只基金 —— 一个弹层问完,不做多步向导 */
  function editFund(f, isNew) {
    var s = st();
    var cats = Object.keys(s.targets || {});
    Modal.pick({
      title: isNew ? '加一只基金' : (f.name || f.code),
      hint: isNew ? null : (f.code + ' · ' + (f.category || '未分类')),
      options: [
        { key: 'cat', label: '归到哪一类', hint: f.category || '还没归类' },
        { key: 'name', label: '改名字', hint: f.name || '(没填)' },
        { key: 'code', label: '改代码', hint: f.code || '(没填)' },
        { key: 'limit', label: '日限额',
          hint: f.dailyLimit ? money(f.dailyLimit) + '/日' : '无限额 —— 可以一次买完' },
        { key: 'flags', label: '主基金 / 启用 / 退役',
          hint: [f.primary ? '主' : '', f.active === false ? '未启用' : '启用中',
                 f.status === 'phasing_out' ? '退役中' : ''].filter(Boolean).join(' · ') },
      ].concat(isNew ? [] : [{ key: 'del', label: '删掉这只', danger: true,
                              hint: '历史快照里的数字不动,只是不再参与再平衡' }]),
    }).then(function (v) {
      if (!v) return;
      if (v === 'del') {
        Modal.confirm({
          title: '把 ' + (f.name || f.code) + ' 从清单里删掉?',
          body: '历史快照里的金额**不会动**,只是它从此不参与再平衡,' +
                '并且会显示成「未分类」。',
          ok: '删掉', danger: true,
        }).then(function (ok) { if (ok) { Config.removeFund(f.code); render(); } });
        return;
      }
      if (v === 'cat') {
        Modal.pick({
          title: '归到哪一类', options: cats.map(function (c) { return { key: c, label: c }; }),
        }).then(function (c) {
          if (!c) return;
          Config.upsertFund(Object.assign({}, f, { category: c }), isNew);
          render();
        });
        return;
      }
      if (v === 'flags') { editFlags(f); return; }
      var spec = {
        name: { title: '叫什么名字', type: 'text', value: f.name },
        code: { title: '基金代码', type: 'text', value: f.code },
        limit: { title: '每日最多能买多少', type: 'number', suffix: '元',
                 value: f.dailyLimit, allowEmpty: true, emptyLabel: '没有限额' },
      }[v];
      Modal.ask(spec).then(function (val) {
        if (val == null) return;
        var patch = {};
        if (v === 'limit') patch.dailyLimit = val === '' ? null : parseFloat(val);
        else patch[v] = val;
        Config.upsertFund(Object.assign({}, f, patch), isNew);
        render();
      });
    });
  }

  function editFlags(f) {
    Modal.pick({
      title: (f.name || f.code) + ' 的状态',
      options: [
        { key: 'primary', label: f.primary ? '取消「主基金」' : '设为主基金',
          hint: '再平衡时买入落到主基金上' },
        { key: 'active', label: f.active === false ? '启用' : '停用',
          hint: '停用的不再买入,但持仓照样算进总额' },
        { key: 'phasing', label: f.status === 'phasing_out' ? '取消「退役中」' : '标为退役中',
          hint: '年度再平衡卖出时优先从它出货' },
      ],
    }).then(function (v) {
      if (!v) return;
      var patch = {};
      if (v === 'primary') patch.primary = !f.primary;
      if (v === 'active') patch.active = f.active === false;
      if (v === 'phasing') patch.status = f.status === 'phasing_out' ? null : 'phasing_out';
      Config.upsertFund(Object.assign({}, f, patch), false);
      render();
    });
  }

  /** 加 / 改 / 删一项组合外资产。传 null 表示新加。 */
  function editAsset(a) {
    if (!a) {
      Modal.ask({ title: '加一项', hint: '比如「MSFT」「自住房」' }).then(function (name) {
        if (!name) return;
        pickKind(function (k) { Assets.upsert({ name: name, kind: k }); render(); });
      });
      return;
    }
    Modal.pick({
      title: a.name,
      hint: Labels.kind(a.kind) + ' · 金额在录入页填',
      options: [
        { key: 'name', label: '改名字', hint: a.name },
        { key: 'kind', label: '算哪一类', hint: Labels.kind(a.kind) },
        { key: 'del', label: '删掉这项', danger: true,
          hint: '历史快照里的金额不动,只是不再出现在录入页' },
      ],
    }).then(function (v) {
      if (!v) return;
      if (v === 'name') {
        Modal.ask({ title: '叫什么名字', type: 'text', value: a.name }).then(function (n) {
          if (!n) return;
          Assets.upsert(Object.assign({}, a, { name: n })); render();
        });
      } else if (v === 'kind') {
        pickKind(function (k) { Assets.upsert(Object.assign({}, a, { kind: k })); render(); });
      } else {
        Modal.confirm({
          title: '把「' + a.name + '」删掉?',
          body: '历史快照里那几个金额**不会动** —— 和删基金一样,' +
                '那是你当时真实看到的数。\n只是它不再出现在录入页和总额里。',
          ok: '删掉', danger: true,
        }).then(function (ok) { if (ok) { Assets.remove(a.id); render(); } });
      }
    });
  }

  function pickKind(cb) {
    Modal.pick({
      title: '算哪一类',
      options: Object.keys(Labels.KIND).map(function (k) {
        return { key: k, label: Labels.KIND[k] };
      }),
    }).then(function (k) { if (k) cb(k); });
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
    render();
  }

  return { mount: mount, exportFile: exportFile };
})();

if (typeof module !== 'undefined') module.exports = SettingsUI;
