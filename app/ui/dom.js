// 文案里的 **重点** 要真的变粗。
//
// ⚠️ 这是个一直存在、而且用户一直看得见的 bug:
//    每个 UI 模块的 h() 都是 `document.createTextNode(c)`,
//    于是文案里写的 `**两天内到期**` 在页面上就是字面的星号。
//    五个文件三十多处,全都在最该强调的那句话上。
//
// 不做完整 markdown —— 只认 **粗体** 一种,因为文案里只用到这一种。
// 认得越多,越容易在食材名(比如「5*5cm」)上误伤。

var Dom = (function () {

  /** 把一段文字变成节点。含 **x** 就拆成若干段,其余原样。 */
  function text(s) {
    if (typeof s !== 'string' || s.indexOf('**') < 0) {
      return document.createTextNode(s == null ? '' : String(s));
    }
    var frag = document.createDocumentFragment();
    // 成对匹配;落单的星号原样留着,不吞字
    var parts = s.split(/\*\*([^*]+)\*\*/g);
    parts.forEach(function (chunk, i) {
      if (chunk === '') return;
      if (i % 2 === 1) {
        var b = document.createElement('strong');
        b.appendChild(document.createTextNode(chunk));
        frag.appendChild(b);
      } else {
        frag.appendChild(document.createTextNode(chunk));
      }
    });
    return frag;
  }

  /**
   * 存储里的枚举值 → 给人看的中文。
   *
   * ⚠️ **界面上不许出现存储层的字面值。**
   *    真出过:排除原因那行直接写 `v.prepLevel + ':' + 原因`,
   *    渲染出来是「**scratch:太辣(中辣)**」—— 中英夹杂,
   *    而且 scratch 是数据库里的词,不是人话。
   *    同一个映射当时写死在 recipes.js 里,别处就照不到。
   *
   * ⚠️ 放这儿是因为**三个页面都要用**(菜谱详情、排除原因、菜卡)。
   *    各写各的必然漏 —— 已经漏过两处了。
   */
  var LABEL = {
    prepLevel: { scratch: '从头做', assembled: '半成品', readymade: '买现成的' },
    tier:      { fresh: '生鲜', buffer: '可存', staple: '常备' },
    location:  { fridge: '冷藏', freezer: '冷冻', pantry: '常温' },
  };

  /** @return 中文;查不到就原样返回(不然界面上会冒出 undefined) */
  function label(kind, value) {
    var m = LABEL[kind];
    return (m && m[value]) || value || '';
  }

  /** 回到顶部 —— **换了一屏就该从头看起。**
   *
   *  ⚠️ 浏览器会保留滚动位置。从一个长页面切到短页面时,那个位置还留着,
   *     浏览器一夹紧滚动范围,整页就跳一下 —— 表现是「点来点去上下跳」。
   *     内容越短跳得越明显,所以底部那片空白看着像元凶,
   *     其实它只是让这一下变得显眼。
   *
   *  ⚠️ 只在**视图真的变了**的时候调。每次 render 都调的话,
   *     勾一条待办、改一个数字都会把你弹回顶部 —— 那更烦。
   */
  function toTop() {
    try {
      if (typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, 0);
      if (typeof document !== 'undefined') {
        var page = document.querySelector && document.querySelector('.page');
        if (page) page.scrollTop = 0;
        if (document.documentElement) document.documentElement.scrollTop = 0;
        if (document.body) document.body.scrollTop = 0;
      }
    } catch (e) {}
  }

  function h(tag, attrs, kids) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) node.appendChild(typeof c === 'string' ? text(c) : c); });
    return node;
  }
  function money(n) {
    if (n == null || !isFinite(n)) return '—';
    return (n < 0 ? '−' : '') + String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function signed(n) { return n == null ? '—' : (n > 0 ? '+' : '') + money(n); }
  function hero(total, external, title, compact) {
    var box = h('div', { class: 'hero' }, [h('div', { class: 'hero-cap' }, [title || '总资产']),
      h('div', { class: 'hero-num amount' }, ['¥' + money(total + external)])]);
    var split = h('div', { class: 'hero-split' });
    [['投资组合', total], ['组合外估值', external]].forEach(function (r) {
      if (r[0] === '组合外估值' && !external) return;
      split.appendChild(h('div', {}, [h('span', { class: 'k' }, [r[0]]), h('span', { class: 'v amount' }, ['¥' + money(r[1])])]));
    });
    if (external && !compact) box.appendChild(split);
    return box;
  }
  function icon(name) {
    var paths = {
      now: ['M3 11 12 3l9 8', 'M5 10v10h5v-6h4v6h5V10'],
      history: ['M3 10a9 9 0 1 1 2 8', 'M3 4v6h6', 'M12 7v5l3 2'],
      stats: ['M4 20V12', 'M12 20V4', 'M20 20V8'],
      settings: ['M4 6h16M4 12h16M4 18h16', 'M8 3v6M16 9v6M10 15v6'],
      back: ['m14 5-7 7 7 7'], close: ['m6 6 12 12M18 6 6 18'], plus: ['M12 5v14M5 12h14']
    };
    var node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    var attrs = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'ui-icon', 'aria-hidden': 'true', focusable: 'false' };
    Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    (paths[name] || paths.back).forEach(function (d) { var p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); node.appendChild(p); });
    return node;
  }
  function backBar(title, onBack) {
    return h('header', { class: 'subpage-bar' }, [
      h('button', { type: 'button', class: 'icon-button', 'aria-label': '返回', title: '返回上一页', onclick: onBack }, [icon('back')]),
      h('h1', {}, [title]),
    ]);
  }
  function scrollPosition() { var page = document.querySelector('.page'); return page ? page.scrollTop : 0; }
  function restoreScroll(value) { var page = document.querySelector('.page'); if (page) page.scrollTop = value; }
  function menuRow(title, detail, onClick) {
    return h('button', { type: 'button', class: 'menu-row', onclick: onClick }, [
      h('span', { class: 'body' }, [h('b', {}, [title]), detail ? h('small', {}, [detail]) : '']),
      h('span', { class: 'menu-chevron', 'aria-hidden': 'true' }, ['›']),
    ]);
  }
  function pager(page, count, size, onChange) {
    var pages = Math.max(1, Math.ceil(count / size));
    return h('nav', { class: 'pager', 'aria-label': '分页' }, [
      h('button', { type: 'button', disabled: page <= 0 ? '' : null, onclick: function () { onChange(page - 1); } }, ['上一页']),
      h('span', { 'aria-live': 'polite' }, [(page + 1) + ' / ' + pages]),
      h('button', { type: 'button', disabled: page >= pages - 1 ? '' : null, onclick: function () { onChange(page + 1); } }, ['下一页']),
    ]);
  }
  return { text: text, label: label, LABEL: LABEL, toTop: toTop, h: h, money: money, signed: signed, hero: hero,
    icon: icon, backBar: backBar, scrollPosition: scrollPosition, restoreScroll: restoreScroll, menuRow: menuRow, pager: pager };
})();

if (typeof module !== 'undefined') module.exports = Dom;
