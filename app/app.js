// 装配 —— tab 切换和挂载。这个文件不做业务。
//
// ⚠️ 「录入」不占 tab:它是一个**动作**不是一个地方。
//    单开一个 tab 的话,每个月你都要纠结「我该点哪个」——
//    而实际上从「现在」进去、录完出来,是唯一的路径。

(function () {

  var root = document.getElementById('app');
  var current = 'now';
  var entering = false;

  // ⚠️ **开机第一件事:核对数据版本。** 在任何页面挂载之前。
  //    挂完再检查就晚了 —— 页面一渲染就可能顺手写了存储
  //    (比如「现在」页会把计划同步进待办),而那时候数据已经被
  //    按错误的假设改过一遍了。
  var booted = Store.boot();

  var TABS = [
    { id: 'now', label: '现在', icon: '◎' },
    { id: 'history', label: '历史', icon: '≡' },
    { id: 'stats', label: '统计', icon: '⌗' },
    { id: 'me', label: '设置', icon: '⚙' },
  ];

  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) {
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  function tabbar() {
    var nav = h('nav', { class: 'tabbar' });
    TABS.forEach(function (t) {
      nav.appendChild(h('button', {
        'aria-current': current === t.id ? 'page' : null,
        onclick: function () {
          current = t.id; entering = false;
          render();
          toTop();
        },
      }, [h('span', { class: 'ic' }, [t.icon]), h('span', {}, [t.label])]));
    });
    return nav;
  }

  /** 切页之后回到顶部。
   *
   *  ⚠️ **这才是「点 tab 上下跳」的真正原因。**
   *     浏览器会保留滚动位置:你在设置页滚到基金列表中间,切到历史页,
   *     那个位置还留着 —— 而历史页没那么长,浏览器一夹紧滚动范围,
   *     整页就跳一下。内容越短跳得越明显,所以「空白」看着像元凶,
   *     其实它只是让这一下变得显眼。
   *
   *  ⚠️ 每个页面进去都该从头看起。没有哪一次切 tab 是想接着上一页的位置读的。
   */
  function toTop() {
    try {
      if (typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, 0);
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
    } catch (e) {}
  }

  function render() {
    root.innerHTML = '';

    // ⚠️ **数据版本对不上就到此为止,一个字节都不写。**
    //    「尽力而为地跑」的后果是数据被新代码按错误的假设改写一遍,
    //    而那时候连回滚点都被覆盖了。宁可这一屏什么都干不了。
    if (booted && !booted.ok) {
      var stop = h('div', { class: 'wrap' });
      stop.appendChild(h('h1', {}, ['先别动']));
      stop.appendChild(h('div', { class: 'note danger' }, [booted.why]));
      stop.appendChild(h('div', { class: 'hint', style: 'margin-top:12px' }, [
        '数据**没有被改动**。下面这个按钮只读不写,导出来存一份最保险。',
      ]));
      stop.appendChild(h('button', {
        class: 'btn', style: 'margin-top:16px',
        onclick: function () { SettingsUI.exportFile(); },
      }, ['导出备份(只读)']));
      root.appendChild(stop);
      return;
    }

    var page = h('div');

    // 录入是全屏接管 —— 抄数字的时候底下不该还挂着 tab 栏勾着你的注意力
    if (entering) {
      EntryUI.mount(page, {
        // ⚠️ **存成功就直接进方案屏**,不回主界面。
        //    再平衡建议依附于「刚录完一期」这个事件 —— 那一刻你手里
        //    正好有最新的数、也正好在想「那我该买什么」。
        //    让人自己去点第二下的话,大部分时候就不点了。
        //    取消(saved=false)不跳,那时候什么都没变。
        onDone: function (saved) {
          entering = false;
          if (saved) { current = 'now'; NowUI.showPlan(); }
          render();
        },
      });
      root.appendChild(page);
      return;
    }

    if (current === 'me') {
      SettingsUI.mount(page, { onChanged: function () {} });
    } else if (current === 'history') {
      HistoryUI.mount(page, { onChanged: function () {} });
    } else if (current === 'stats') {
      StatsUI.mount(page);
    } else {
      NowUI.mount(page, { onEntry: function () { entering = true; render(); } });
    }
    var canFill = fillRest(page);
    root.appendChild(page);
    root.appendChild(tabbar());
    if (canFill) fitHeight(page);
  }

  /** 把内容区**正好**撑到 tab 栏顶边。
   *
   *  ⚠️ **用实测值，不用 CSS 单位去猜。**
   *     上一版写的是 `min-height: calc(100svh - 53px - env(...))` ——
   *     `100svh` 含底部安全区而实际可视高度不含，差 34px，
   *     于是每个短页面都多出 34px 可以滑动，滑一下弹回来，
   *     切 tab 时有的页能滑有的不能，手上就是「上下跳」。
   *     那一串 calc 里的每一项都是我假设的，而假设错一项就是这个结果。
   *
   *     现在只做一件事：量 tab 栏顶边在哪，把内容区撑到那儿。
   *     元素已经插进文档了，量出来的是真实渲染位置，没有假设。
   *
   *  ⚠️ 先清空再量 —— 上一次设的 min-height 会把这次的测量顶大，
   *     几次切换下来页面越来越长。
   */
  function fitHeight(page) {
    var wrap = page.querySelector && page.querySelector('.wrap');
    var bar = document.querySelector && document.querySelector('.tabbar');
    if (!wrap || !bar || !wrap.getBoundingClientRect) return;
    try {
      wrap.style.minHeight = '';
      var barTop = bar.getBoundingClientRect().top;
      var wrapTop = wrap.getBoundingClientRect().top;
      var h = Math.floor(barTop - wrapTop);
      if (h > 0) wrap.style.minHeight = h + 'px';
    } catch (e) {}
  }

  /** 让最后一块内容容器吃掉撑出来的空间。
   *  ⚠️ 只拉伸**真正排在最后**的那一块 —— 后面还有按钮的话拉它，
   *     等于把按钮推到屏幕最底下，中间空一大块。
   *  ⚠️ 空状态那一屏不拉（它自己居中）。
   *  @return true = 找到了能拉伸的东西
   *  ⚠️ 返回值**必须被 fitHeight 用上**：找不到可拉伸的容器时撑高页面，
   *     只是撑出一片空的内边距 —— 比不撑还空。两件事得绑在一起。 */
  function fillRest(page) {
    var wrap = page.querySelector && page.querySelector('.wrap');
    if (!wrap || (wrap.className || '').indexOf('wrap-fill') >= 0) return false;
    var kids = wrap.children || [];
    var last = kids[kids.length - 1];
    if (!last) return false;
    var c = (last.className || '');
    if (c.indexOf('list') >= 0 || c.indexOf('card') >= 0 || c.indexOf('chart') >= 0) {
      last.className = c + ' fill-rest';
      return true;
    }
    return false;
  }



  render();

  // 转屏、键盘收起、窗口缩放 —— 高度变了就重新量一次。
  // ⚠️ 不重量的话，横屏转回竖屏时内容区还停在横屏那个高度。
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('resize', function () {
      var page = root.children && root.children[0];
      if (page) fitHeight(page);
    });
  }

  // ⚠️ **开机拉一次。** 不然同步就只有「推」没有「拉」——
  //    手机上录完推上去,电脑打开还是旧数据,你在旧数据上一改就冲突,
  //    然后每次换设备都得手动进设置点一次「立刻同步」。那不叫自动同步。
  //
  //    只在**本机没有未推送改动**时才拉(见 Sync.autoPull 里的判断)——
  //    两边都有对方没有的东西时,谁覆盖谁需要你看着数字决定。
  if (typeof Sync !== 'undefined' && Sync.ready()) {
    Sync.autoPull().then(function (r) {
      if (!r || !r.pulled) return;
      render();
      Modal.note({
        title: '拉到了新数据',
        body: '云端有更新的版本(' + r.summary.snapshots + ' 期,到 ' +
              (r.summary.last || '?') + '),已经换成那份。' +
              '不对的话去「数据与备份 → 退回」。',
      });
    });
  }

  // ⚠️ 这里**没有「切后台就自动推」**,去掉了。
  //    推送会写另一台设备也在读的那份文件,冲突了要人来判断;
  //    而它发生在你切走的那一瞬间,失败了弹窗打断你、不弹窗又等于吞掉。
  //    这个 app 一个月开几次,「顺手点一下推送」的成本几乎为零 ——
  //    自动化在这里买到的东西,不值它带来的不确定性。
  //    有改动没推的话,主界面会有一行提示。

  // 升级过就说一声 —— 静默升级和静默出错长得一模一样,
  // 而你需要知道「今天这个数不对」和「昨天我升过级」有没有关系。
  if (booted.ok && booted.migrated && booted.migrated.length) {
    Modal.note({ title: '数据升级了',
                 body: '结构从 ' + booted.migrated.join('、') +
                       '。升级前那份存成了回滚点,设置页里能退回去。' });
  }

  // 离线缓存 —— 只在 https / localhost 上装得起来,
  // 所以局域网 http 开发时它不会注册,改一行刷新就见效。
  if (typeof navigator !== 'undefined' && navigator.serviceWorker &&
      typeof location !== 'undefined' && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
