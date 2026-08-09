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
  var sub = null;          // null | 'data' —— 二级屏


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
    if (sub === 'data') { dataScreen(); return; }
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
    // ⚠️ **现金和其他类别列在一起,一起凑 100%。**
    //    早先现金的目标是单独一个设置(在下面「现金」那一段),
    //    于是六类 100% + 现金 5% = 105% —— 目标超发了,
    //    表现是「现金填不满全部缺口,还差 10 万」**永远填不满**,
    //    而每一类的数字看着都合理,根本查不出问题在总和上。
    //
    // ⚠️ 说清分母。首页顶上是**总资产**(含组合外),
    //    而这些比例按**组合**算 —— 不说的话会拿 20% 去乘错的那个总额。
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
    function targetRow(name, value, onSave) {
      sum += value;
      return h('div', {
        class: 'list-row',
        onclick: function () {
          Modal.ask({
            title: name + ' 占多少?', hint: '填百分数,比如 20',
            type: 'number', suffix: '%', value: Math.round(value * 1000) / 10,
          }).then(function (v) {
            if (v == null) return;
            var n = parseFloat(v);
            if (isNaN(n) || n < 0) return;
            onSave(n / 100);
          });
        },
      }, [
        h('div', { class: 'body' }, [h('div', { class: 'ttl' }, [name])]),
        h('div', { class: 'amt' }, [(value * 100).toFixed(0) + '%']),
      ]);
    }
    // ⚠️ **超过 100% 直接拒绝,不足 100% 只警告。**
    //    这两个不对称,是有理由的:
    //      超发 → 缺口合计比你的钱还多,表现是**永远填不满**,而且
    //             每一类看着都合理,根本查不出问题出在总和上。没有任何
    //             一种情况下你会想要它,所以硬拦。
    //      不足 → 是合法的中间状态。把标普从 20 降到 10、再把黄金从 10 升到 20,
    //             中间必然经过 90% —— 严格锁死 100% 的话这个编辑做不下去。
    //             而且「留一部分不分配」本身也可能是你想要的。
    function saveTargets(nextTargets, nextCash) {
      var t = nextTargets || s.targets || {};
      var cash = nextCash != null ? nextCash : (s.cashTarget || 0);
      var total = cash;
      Object.keys(t).forEach(function (k) { total += t[k]; });
      if (total > 1.0001) {
        var over = (total - 1) * 100;
        Modal.note({
          title: '加起来超过 100% 了',
          body: '会超 **' + over.toFixed(1) + ' 个点**。' +
                '目标超发的后果是缺口合计比你的钱还多 —— ' +
                '清单上永远填不满,而每一类看着都正常。',
        });
        return false;
      }
      save(nextCash != null ? { targets: t, cashTarget: cash } : { targets: t });
      return true;
    }

    Object.keys(s.targets || {}).forEach(function (c) {
      tl.appendChild(targetRow(c, s.targets[c], function (v) {
        var t = Object.assign({}, s.targets); t[c] = v;
        saveTargets(t, null);
      }));
    });
    // 现金就在这儿,和别的类一样一行 —— 它本来就是一个类别
    tl.appendChild(targetRow('现金', s.cashTarget || 0, function (v) {
      saveTargets(null, v);
    }));
    w.appendChild(tl);

    // ⚠️ 加起来不是 100% 要**当场说清差多少、以及后果**。
    //    差几个点的话所有缺口都是错的,而错法很隐蔽:
    //    超发就是「永远填不满」,少发就是「早早说没事可做」。
    if (Math.abs(sum - 1) > 0.0001) {
      var over = sum > 1;
      var gapPct = Math.abs(sum - 1);
      w.appendChild(h('div', { class: 'note warn', style: 'margin-top:8px' }, [
        '加起来是 **' + (sum * 100).toFixed(1) + '%**,不是 100%。' +
        (over
          ? '目标超发了 ' + (gapPct * 100).toFixed(1) + ' 个点 —— ' +
            '缺口合计会比你的钱多 ¥' + money(gapPct * (sm ? sm.total : 0)) +
            ',表现是**永远填不满**。'
          : '还有 ' + (gapPct * 100).toFixed(1) + ' 个点没分配 —— ' +
            '那部分钱会一直闲着,而工具会说「各类都到位了」。'),
      ]));
      // 不足的时候给一条出路 —— 光说「差 5 个点」而不给按钮,
      // 你得自己算该给谁加多少,而那正是最容易再算错一次的地方。
      if (!over) {
        w.appendChild(h('button', {
          class: 'btn ghost', style: 'margin-top:8px',
          onclick: function () {
            var cats = Object.keys(s.targets || {}).concat(['现金']);
            Modal.pick({
              title: '把剩下的 ' + (gapPct * 100).toFixed(1) + ' 个点给谁?',
              options: cats.map(function (c) {
                var cur = c === '现金' ? (s.cashTarget || 0) : s.targets[c];
                return { key: c, label: c,
                         hint: (cur * 100).toFixed(0) + '% → ' +
                               ((cur + gapPct) * 100).toFixed(1) + '%' };
              }),
            }).then(function (c) {
              if (!c) return;
              if (c === '现金') { saveTargets(null, (s.cashTarget || 0) + gapPct); return; }
              var t = Object.assign({}, s.targets); t[c] = t[c] + gapPct;
              saveTargets(t, null);
            });
          },
        }, ['把剩下的 ' + (gapPct * 100).toFixed(1) + ' 个点分配掉']));
      }
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
    // ⚠️ 现金的**目标占比在上面「目标比例」里**(它是第七个类别)。
    //    这儿只剩「绝对下限」和「偏差带」——
    //    前者管的是「不管比例算出来多少,至少留这么多」,
    //    资产还小的时候比例算出来那点钱不够应急。
    w.appendChild(h('h2', {}, ['现金']));
    w.appendChild(h('div', { class: 'list' }, [
      numItem('现金保底', '绝对下限。不管总额多少,至少留这么多', 'cashFloor', s.cashFloor, ''),
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

    // ---- 数据与备份 ----
    //
    // ⚠️ 版本号、导出导入、回滚点、买卖记录起点 —— 这四样**都是低频的**，
    //    有的一年用一次，有的一次都不用。可它们原先各占一个板块摊在一级页上，
    //    把设置页拖到九个板块长。
    //    常用的（比例、基金、现金、组合外）被挤到需要滚动才看得全，
    //    而那几个才是你真正会来改的。
    //
    //    所以低频的收进一个子屏。⚠️ **不是折叠**：折叠起来的东西
    //    仍然占着一行标题和一次判断（「这个要不要点开」），
    //    而这几样根本不该出现在你要改现金保底的时候。
    w.appendChild(h('div', { class: 'list', style: 'margin-top:24px' }, [
      h('div', { class: 'list-row', onclick: function () { sub = 'data'; render(); } }, [
        h('div', { class: 'body' }, [
          h('div', { class: 'ttl' }, ['数据与备份']),
          h('div', { class: 'sub2' }, ['导出导入 · 回滚 · 版本号']),
        ]),
        h('span', { class: 'chev' }),
      ]),
    ]));

    el.appendChild(w);
  }

  /** 配同步 —— **token 必须你自己去生成**,我没法替你点那几下。 */
  function syncSetup() {
    var c = Sync.cfg();
    Modal.form({
      title: '同步到 private 仓库',
      hint: '数据推到一个**私有**仓库,一次保存一个 commit,于是版本历史免费得到。' +
            'token 去 GitHub → Settings → Developer settings → ' +
            'Fine-grained tokens 生成,**只授权这一个仓库的 Contents 读写**。',
      fields: [
        { key: 'owner', label: 'GitHub 用户名' },
        { key: 'repo', label: '仓库名', hint: '必须是 private' },
        { key: 'token', label: 'token', hint: 'github_pat_… 只存在这台设备上' },
      ],
      values: { owner: c.owner || 'escapecat', repo: c.repo || 'balance-data',
                token: c.token || '' },
      validate: function (v) {
        if (!v.owner || !v.repo) return '用户名和仓库名都得填。';
        if (!v.token) return 'token 不能空 —— 没有它连不上。';
        return null;
      },
      ok: '存下来并测一次',
    }).then(function (v) {
      if (!v) return;
      Sync.saveCfg({ owner: v.owner.trim(), repo: v.repo.trim(),
                     token: v.token.trim(), sha: null });
      // ⚠️ **存完立刻测**,不能等到某天发现三个月没同步过。
      return Sync.check().then(function (r) {
        if (!r.ok) {
          Modal.note({ title: '连不上', body: r.why });
          render();
          return;
        }
        Modal.note({ title: '通了', body: r.repo + ' 可读可写,而且是 private。' });
        render();
      });
    });
  }

  /** 立刻同步。
   *
   *  ⚠️ **第一次要问方向。** 云端有数据、本地也有数据的时候,
   *     谁覆盖谁是个不能替用户决定的问题 —— 猜错就是丢一边的数据,
   *     而且丢得静悄悄。所以:云端空 → 直接推;云端有 → 摆出两边的
   *     期数和日期让你选。
   */
  /** 推到云端 —— 明确的方向,不问。
   *
   *  ⚠️ 只有一种情况会停下来问:**云端有别人推的新东西**。
   *     那时候直接盖就是把另一台设备的改动扔掉,而且扔得没有痕迹。
   */
  function syncPush() {
    Modal.note({ title: '正在推…', body: '连 GitHub 中。' });
    Sync.push({}).then(function (r) {
      Modal.close();
      if (r.ok) {
        Sync.clearDirty();
        Modal.note({ title: '推上去了', body: '云端多了一个版本,随时能翻回来。' });
        render();
        return;
      }
      if (!r.conflict) { Modal.note({ title: '推不上去', body: r.why }); return; }

      // 冲突:云端比我们上次推的新 —— 摆出两边让人选
      Sync.pull().then(function (g) {
        var mine = Store.inspectImport(Store.exportAll());
        Modal.pick({
          title: '云端有更新的版本',
          hint: '云端 ' + (g.ok ? g.summary.snapshots + ' 期(到 ' + (g.summary.last || '?') + ')' : '读不出来') +
                ' · 本机 ' + mine.summary.snapshots + ' 期(到 ' + (mine.summary.last || '?') + ')',
          options: [
            { key: 'pull', label: '先看云端那份(取下来)',
              hint: '会先存回滚点 —— 推荐,别把另一台设备改的东西扔了' },
            { key: 'force', label: '就用本机的盖掉云端', danger: true,
              hint: '云端那边的改动会没有,而且找不回来' },
          ],
        }).then(function (v) {
          if (v === 'pull' && g.ok) return doPull(g.data);
          if (v === 'force') return doPush(true);
        });
      });
    });
  }

  /** 从云端取下来。 */
  function syncPullNow() {
    Modal.note({ title: '正在取…', body: '连 GitHub 中。' });
    Sync.pull().then(function (r) {
      Modal.close();
      if (r.empty) {
        Modal.note({ title: '云端还是空的',
                     body: '还没推过。先点「推到云端」把这台机器上的数据传上去。' });
        return;
      }
      if (!r.ok) { Modal.note({ title: '取不下来', body: r.why }); return; }

      var mine = Store.inspectImport(Store.exportAll());
      // 本机空着 → 直接拉,没什么好问的
      if (!mine.summary.snapshots) return doPull(r.data);

      Modal.confirm({
        title: '用云端那份盖掉本机?',
        body: '云端 ' + r.summary.snapshots + ' 期(到 ' + (r.summary.last || '?') + ')' +
              ' · 本机 ' + mine.summary.snapshots + ' 期(到 ' + (mine.summary.last || '?') + ')。' +
              (mine.summary.last > r.summary.last
                 ? ' ⚠️ **本机这份比云端新**,盖了会丢东西。'
                 : '') +
              ' 会先存一个回滚点。',
        ok: '取下来', danger: mine.summary.last > r.summary.last,
      }).then(function (yes) { if (yes) doPull(r.data); });
    });
  }

  function doPush(force) {
    return Sync.push({ force: force }).then(function (r) {
      if (!r.ok) {
        Modal.note({ title: r.conflict ? '有冲突' : '推不上去', body: r.why });
        return;
      }
      Sync.clearDirty();
      Modal.note({ title: '推上去了', body: '这一版在 GitHub 上留了一个 commit。' });
      render();
    });
  }

  function doPull(data) {
    // ⚠️ 覆盖本机之前**先存回滚点**。这是唯一一个会一次性
    //    抹掉全部本地数据的操作,没有后路是不行的。
    Store.saveRollback('从云端拉取之前');
    var r = Store.importAll(data);
    if (!r.ok) { Modal.note({ title: '导入失败', body: r.why }); return; }
    Sync.clearDirty();
    if (onChanged) onChanged();
    Modal.note({ title: '拉下来了', body: '本机已经换成云端那份。后悔了去「退回」。' });
    render();
  }

  /** 从历史版本恢复 —— 「改坏了怎么办」的正经答案。 */
  function syncHistory() {
    Modal.note({ title: '读历史中…', body: '' });
    Sync.history(20).then(function (r) {
      Modal.close();
      if (!r.ok) { Modal.note({ title: '读不到历史', body: r.why }); return; }
      if (!r.list.length) { Modal.note({ title: '还没有历史', body: '同步一次就有了。' }); return; }
      Modal.pick({
        title: '恢复到哪一版',
        hint: '选一版先看看内容,确认之后才会覆盖本机。',
        options: r.list.slice(0, 12).map(function (x) {
          return { key: x.sha,
                   label: (x.date || '').slice(0, 16).replace('T', ' '),
                   hint: x.message };
        }),
      }).then(function (sha) {
        if (!sha) return;
        Sync.at(sha).then(function (v) {
          if (!v.ok) { Modal.note({ title: '取不到那一版', body: v.why }); return; }
          Modal.confirm({
            title: '换成这一版?',
            body: '这一版有 ' + v.summary.snapshots + ' 期,最后一期 ' +
                  (v.summary.last || '?') + '。' +
                  '会先存一个回滚点,后悔了能退回来。',
            ok: '换', danger: true,
          }).then(function (yes) { if (yes) doPull(v.data); });
        });
      });
    });
  }

  /** 二级屏:数据与备份。低频操作全在这儿。 */
  function dataScreen() {
    var w = h('div', { class: 'wrap' });
    w.appendChild(h('h1', {}, ['数据与备份']));

    // ---- 同步 ----
    //
    // ⚠️ 放在最上面,因为它一旦配好,下面那个「唯一的兜底」就不再是唯一的。
    var sy = Sync.status();
    w.appendChild(h('h2', {}, ['同步']));
    w.appendChild(h('div', { class: 'list' }, [
      h('div', { class: 'list-row', onclick: syncSetup }, [
        h('div', { class: 'body' }, [
          h('div', { class: 'ttl' }, [
            Sync.ready() ? (Sync.cfg().owner + '/' + Sync.cfg().repo) : '还没开',
          ]),
          h('div', { class: 'sub2' }, [
            Sync.ready() ? sy.text : '推到一个 private 仓库,换设备也能用',
          ]),
        ]),
        h('span', { class: 'chev' }),
      ]),
    ]));
    if (Sync.ready()) {
      // ⚠️ **推和拉分成两个按钮,不合并成一个「同步」。**
      //    合并的话每次都得先探一次云端再问你方向,而你心里本来就清楚
      //    这次是「把我改的传上去」还是「把那边的取下来」。
      //    按钮上直接写方向,少一次问答,也少一次选错的机会。
      var sy0 = Sync.cfg();
      w.appendChild(h('button', {
        class: 'btn', style: 'margin-top:8px', onclick: syncPush,
      }, [sy0.dirty ? '推到云端(有改动)' : '推到云端']));
      w.appendChild(h('button', {
        class: 'btn ghost', style: 'margin-top:8px', onclick: syncPullNow,
      }, ['从云端取下来']));
      w.appendChild(h('button', {
        class: 'btn ghost', style: 'margin-top:8px', onclick: syncHistory,
      }, ['从历史版本恢复']));
      w.appendChild(h('div', { class: 'hint' }, [
        '**不会自动推** —— 改完记得回来点一下。每推一次在云端留一个版本,' +
        '「从历史版本恢复」能翻回任何一次。',
      ]));
    }

    w.appendChild(h('h2', {}, ['备份文件']));
    w.appendChild(h('div', { class: 'hint', style: 'margin-bottom:8px' }, [
      Sync.ready()
        ? '同步之外再存一份 —— 两处都坏的概率比一处小得多。'
        : '数据只存在这台设备的浏览器里。**换手机、清缓存都会丢** —— 这是唯一的兜底。',
    ]));
    w.appendChild(h('button', { class: 'btn ghost', onclick: exportFile }, ['导出备份']));
    w.appendChild(h('button', { class: 'btn ghost', style: 'margin-top:8px',
                                onclick: importFile }, ['导入备份']));

    // ⚠️ 只在**真有**回滚点的时候才显示。平时挂一个「回到上一个状态」
    //    但点了说「没有可回滚的」,比不放还糟 —— 你会以为自己一直有条后路。
    var rb = Store.getRollback();
    if (rb) {
      var rbChk = Store.inspectImport(rb);
      w.appendChild(h('h2', {}, ['退回']));
      w.appendChild(h('div', { class: 'hint' }, [
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

    // ⚠️ 平时不用管。唯一会用到的情况是「某次对账之后买过东西但没记」——
    //    那笔会被算成「市场涨跌」。把起点往后挪一期,那期就退回「分不出」,
    //    总比留着一个错的数强。
    var since = Actions.since();
    if (since) {
      w.appendChild(h('h2', {}, ['买卖记录起点']));
      w.appendChild(h('div', { class: 'list' }, [
        h('div', { class: 'list-row', onclick: function () { editSince(since); } }, [
          h('div', { class: 'body' }, [
            h('div', { class: 'ttl' }, ['从 ' + since + ' 起记全了']),
            h('div', { class: 'sub2' }, ['这天之后的每一期都能算出涨跌']),
          ]),
          h('span', { class: 'chev' }),
        ]),
      ]));
    }

    // ⚠️ 「我改了你怎么还是老样子」这种事,不给版本号就只能靠猜。
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

    w.appendChild(h('button', {
      class: 'btn', style: 'margin-top:24px',
      onclick: function () { sub = null; render(); },
    }, ['返回设置']));
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
  /** 改一只基金 —— **弹窗,不是整页**。
   *
   *  ⚠️ 早先是整屏接管的表单。三个字段而已,却要离开设置页、
   *     改完再退回来,滚动位置还得自己找 —— 和旁边「目标比例」
   *     点一行就地改完的体验完全是两套。
   *     一个页面里两种交互模式,每次都得先想「这个是点开还是跳走」。
   */
  function editFund(f, isNew) {
    var s = st();
    var cats = Object.keys(s.targets || {});
    if (!cats.length) {
      Modal.note({ title: '还没有类别',
                   body: '先在「目标比例」里加一个 —— 不归类的话它不参与再平衡。' });
      return;
    }
    var oldCode = isNew ? null : f.code;
    Modal.form({
      title: isNew ? '加一只基金' : (f.name || f.code),
      fields: [
        { key: 'code', label: '基金代码', hint: '六位数字', mode: 'numeric' },
        { key: 'name', label: '名字', hint: '自己认得出就行' },
        { key: 'category', label: '类别', hint: '决定它参与哪一档目标比例',
          type: 'select', options: cats.map(function (c) { return { key: c, label: c }; }) },
      ],
      values: { code: f.code || '', name: f.name || '', category: f.category || '' },
      validate: function (v) {
        if (!/^\d{6}$/.test(String(v.code).trim())) return '基金代码是六位数字。';
        if (!v.category) return '还没选类别 —— 不归类的话它不参与再平衡。';
        return null;
      },
      // ⚠️ 删除入口跟着一起放进来。原先在整页表单底部,改成弹窗后
      //    如果不带过来,清仓的基金就再也删不掉了。
      extra: isNew ? null : {
        label: '从清单里删掉', danger: true,
        onClick: function (done) {
          done(null);
          dropEmpty({ code: oldCode, name: f.name, category: f.category });
        },
      },
    }).then(function (v) {
      if (!v) return;
      var payload = { code: String(v.code).trim(),
                      name: (v.name || '').trim() || String(v.code).trim(),
                      category: v.category };
      if (oldCode && oldCode !== payload.code) payload._oldCode = oldCode;
      var r = Config.upsertFund(payload, !!isNew);
      if (!r.ok) { Modal.note({ title: '存不下来', body: r.why }); return; }
      if (onChanged) onChanged();
      render();
    });
  }

  // ⚠️ fundForm() / saveFund() 已删 —— 那是整页表单那一版的东西。
  //    留着的话下次会有人以为基金编辑还有两条路径。

  /** 改一项组合外资产(MSFT、房产…)—— 名字和类别。
   *
   *  ⚠️ 这个函数**以前根本不存在**,而设置页里两处 onclick 都在调它:
   *     点 MSFT 那一行直接抛 ReferenceError,表现是「点了没反应」——
   *     不报错、不闪烁,就是死的。
   *     调用写了、实现没写,而 JS 不会在加载时告诉你这件事。
   *
   *  ⚠️ 这里**只改名目,不改金额**。金额在录入页填,和基金持仓走同一条路 ——
   *     同一期的数字待在同一条快照里,才对得上账。
   *     在这儿改金额的话,改的是哪一期?改完历史还对不对?两个问题都没有好答案。
   *
   *  @param a  null = 新加一项
   */
  function editAsset(a) {
    var isNew = !a;
    Modal.form({
      title: isNew ? '加一项组合外资产' : a.name,
      hint: '不参与再平衡,但算进总资产。**金额在录入页填**。',
      fields: [
        { key: 'name', label: '名字', hint: '比如 MSFT、自住房' },
        { key: 'kind', label: '算哪一类', type: 'select',
          options: Object.keys(Labels.KIND).map(function (k) {
            return { key: k, label: Labels.KIND[k] };
          }) },
      ],
      values: { name: (a && a.name) || '', kind: (a && a.kind) || 'stock' },
      validate: function (v) {
        if (!String(v.name || '').trim()) return '得有个名字。';
        return null;
      },
      extra: isNew ? null : {
        label: '删掉这一项', danger: true,
        onClick: function (done) { done(null); dropAsset(a); },
      },
    }).then(function (v) {
      if (!v) return;
      var r = Assets.upsert({ id: a ? a.id : null,
                              name: String(v.name).trim(), kind: v.kind });
      if (!r.ok) { Modal.note({ title: '存不下来', body: r.why }); return; }
      if (onChanged) onChanged();
      render();
    });
  }

  /** 删一项组合外资产。
   *  ⚠️ 历史快照里那几个金额**一个字不动** —— 那是你当时真实看到的数。
   *     代价是它会变成一条没人认领的 external 金额,所以要说清楚。 */
  function dropAsset(a) {
    var snaps = Store.get('snapshots', []) || [];
    var had = snaps.filter(function (s0) {
      return s0.external && s0.external[a.id] != null;
    }).length;
    Modal.confirm({
      title: '把「' + a.name + '」删掉?',
      body: had
        ? '有 ' + had + ' 期记过它的金额。**那些数字一个字不动** —— ' +
          '但它们会变成没人认领的一笔,历史里的总资产照旧,只是不再显示名字。'
        : '还没记过金额,删了什么也不影响。',
      ok: '删掉', danger: true,
    }).then(function (yes) {
      if (!yes) return;
      Assets.remove(a.id);
      if (onChanged) onChanged();
      render();
    });
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
    sub = null;      // 每次挂载都回一级页 —— 切走再切回来还停在子屏会莫名其妙
    render();
  }

  return { mount: mount, exportFile: exportFile };
})();

if (typeof module !== 'undefined') module.exports = SettingsUI;
