// 装配 —— tab 切换和挂载。这个文件不做业务。
//
// ⚠️ 「录入」不占 tab:它是一个**动作**不是一个地方。
//    单开一个 tab 的话,每个月你都要纠结「我该点哪个」——
//    而实际上从「现在」进去、录完出来,是唯一的路径。

(function () {

  var root = document.getElementById('app');
  var current = 'now';
  var entering = false;

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

  function placeholder(title, body) {
    var w = h('div', { class: 'wrap' });
    w.appendChild(h('h1', {}, [title]));
    w.appendChild(h('div', { class: 'empty' }, [
      h('div', { class: 'big' }, ['🚧']),
      h('div', { class: 'hint', style: 'margin-top:8px' }, [body]),
    ]));
    return w;
  }

  function render() {
    root.innerHTML = '';
    var page = h('div');

    // 录入是全屏接管 —— 抄数字的时候底下不该还挂着 tab 栏勾着你的注意力
    if (entering) {
      EntryUI.mount(page, {
        onDone: function () { entering = false; render(); },
      });
      root.appendChild(page);
      return;
    }

    if (current === 'me') {
      SettingsUI.mount(page, { onChanged: function () {} });
    } else if (current === 'history') {
      HistoryUI.mount(page, { onChanged: function () {} });
    } else if (current === 'stats') {
      page.appendChild(placeholder('统计', '收益率和结构变化 —— 还没做'));
    } else {
      NowUI.mount(page, { onEntry: function () { entering = true; render(); } });
    }
    root.appendChild(page);
    root.appendChild(tabbar());
  }

  render();

  // 离线缓存 —— 只在 https / localhost 上装得起来,
  // 所以局域网 http 开发时它不会注册,改一行刷新就见效。
  if (typeof navigator !== 'undefined' && navigator.serviceWorker &&
      typeof location !== 'undefined' && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
