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
        onclick: function () { current = t.id; entering = false; render(); },
      }, [h('span', { class: 'ic' }, [t.icon]), h('span', {}, [t.label])]));
    });
    return nav;
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
    root.appendChild(page);
    root.appendChild(tabbar());
  }

  render();

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
