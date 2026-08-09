// 应用内弹层 —— 替掉 prompt / confirm / alert。
//
// 为什么必须自己做:
//   1. **样式割裂** —— 系统弹窗不认 --bg / --accent,深色模式下白花花一片,
//      而且 Windows / iOS / 安卓各长各的样。
//   2. **prompt 只能收字符串** —— 于是「改买入日期」变成让人手打 YYYY-MM-DD,
//      「选一个动作」变成让人在列表里输数字(「1 = 改买入日期,输入数字:」)。
//      输入法都不一定跳出来。选择题就该给按钮。
//   3. **小程序里根本没有** —— window.prompt 不存在,迁移时这些调用全得重写。
//      现在这一层挡着,到时候只换 modal.js 一个文件。
//
// 用 Promise:调用点读起来还是顺的一行,不用回调套回调。

var Modal = (function () {

  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) {
      if (c == null) return;
      n.appendChild(typeof c === 'string' ? Dom.text(c) : c);
    });
    return n;
  }

  var host = null, escHandler = null;

  function close() {
    if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null; }
    if (!host) return;
    var gone = host;
    host = null;
    gone.className = 'modal-mask closing';
    setTimeout(function () { if (gone.parentNode) gone.parentNode.removeChild(gone); }, 140);
  }

  /**
   * @param build(box, done)  往 box 里塞内容;调 done(value) 关闭并返回
   * 点遮罩、按 Esc、点取消 → 一律 done(null),表示「什么也没做」。
   */
  function open(build) {
    return new Promise(function (resolve) {
      close();
      var done = function (v) { close(); resolve(v); };
      host = h('div', {
        class: 'modal-mask',
        onclick: function (e) { if (e.target === host) done(null); },
      });
      var box = h('div', { class: 'modal-sheet', role: 'dialog', 'aria-modal': 'true' });
      build(box, done);
      host.appendChild(box);
      document.body.appendChild(host);

      escHandler = function (e) { if (e.key === 'Escape') done(null); };
      document.addEventListener('keydown', escHandler);

      // 有输入框就自动聚焦并全选 —— 少一次点击
      var inp = box.querySelector('input');
      if (inp) setTimeout(function () { inp.focus(); inp.select && inp.select(); }, 30);
    });
  }

  function head(box, title, hint) {
    box.appendChild(h('div', { class: 'modal-title' }, [title]));
    if (hint) box.appendChild(h('div', { class: 'modal-hint' }, [hint]));
  }

  function cancelBtn(done, label) {
    return h('button', { class: 'btn ghost', style: 'margin-top:8px',
                         onclick: function () { done(null); } }, [label || '取消']);
  }

  /** 多层菜单里的「返回上一层」。
   *
   * ⚠️ 第一版根本没有这个概念 —— 我只想着「选完就走」,
   *    可 菜名 → 食材 → 某一样 → 改用量 是四层,中途想退一步只能点「取消」,
   *    而取消是把整串关掉、回到页面。改错一个选项就得从头点四次。
   *
   * 约定:返回 resolve 成 Modal.BACK,调用方自己决定回哪一层。
   * 不做成弹层内部的历史栈 —— 那样每个调用方都得按同一种结构组织,
   * 反而更难写;交给调用方一句 if 判断更直白。
   */
  var BACK = '__modal_back__';
  function backBtn(done, label) {
    return h('button', {
      class: 'btn ghost',
      style: 'margin-top:8px;color:var(--text-dim)',
      onclick: function () { done(BACK); },
    }, ['‹ ' + (label || '返回')]);
  }

  /**
   * 选择题 —— 一个动作一个按钮。
   * @param o.options [{key, label, hint, danger}]
   * 返回选中的 key,取消返回 null。
   *
   * ⚠️ **选中一项永远不许 resolve 出 undefined。**
   *    2026-08-09:冰箱那个「···」菜单的选项写成了 `value:` 而不是 `key:`,
   *    于是三个动作(吃完了 / 扔了 / 记错了)点下去全部 resolve 成 undefined,
   *    调用方 `if (v === 'eaten') ... else if ...` 一个分支都不进 ——
   *    **菜单静静地什么也不做**,没有报错、没有关不掉、没有任何迹象。
   *    连带后果是 wasteLog 一条都写不进去,而它是「什么东西总是剩」
   *    那条统计的唯一数据源:那条洞察从上线起就不可能触发过。
   *
   *    一个词写错就让三个功能和一条统计全哑掉,说明这里不该那么脆。
   *    所以 value 当 key 的别名收下 —— 但调用方还是统一写 key,
   *    一个仓库里两种叫法,迟早会错第二次。
   */
  function pick(o) {
    return open(function (box, done) {
      head(box, o.title, o.hint);
      var list = h('div', { class: 'modal-opts' });
      (o.options || []).forEach(function (op) {
        var key = op.key !== undefined ? op.key : op.value;
        if (key === undefined && typeof console !== 'undefined') {
          console.error('Modal.pick:选项「' + op.label + '」没有 key,点了会什么都不做');
        }
        list.appendChild(h('button', {
          class: 'modal-opt' + (op.danger ? ' danger' : ''),
          onclick: function () { done(key); },
        }, [
          h('div', { class: 'modal-opt-label' }, [op.label]),
          op.hint ? h('div', { class: 'modal-opt-hint' }, [op.hint]) : null,
        ]));
      });
      box.appendChild(list);
      if (o.back) box.appendChild(backBtn(done, o.backLabel));
      box.appendChild(cancelBtn(done));
    });
  }

  /**
   * 单个输入 —— 数字 / 文字 / 日期。
   * @param o.presets [{label, value}]  常用值做成一排芯片,免得动键盘
   * @param o.allowEmpty  允许留空(留空返回 '',不是 null —— null 是「取消」)
   * 返回字符串,取消返回 null。
   */
  function ask(o) {
    return open(function (box, done) {
      head(box, o.title, o.hint);

      var wrap = h('div', { style: 'display:flex;align-items:center;gap:8px' });
      var inp = h('input', {
        type: o.type || 'text',
        inputmode: o.type === 'number' ? 'decimal' : null,
        value: o.value == null ? '' : String(o.value),
        placeholder: o.placeholder || '',
        onkeydown: function (e) { if (e.key === 'Enter') submit(); },
      });
      wrap.appendChild(inp);
      if (o.suffix) {
        wrap.appendChild(h('span', { style: 'color:var(--text-dim);flex:0 0 auto' }, [o.suffix]));
      }
      box.appendChild(wrap);

      if (o.presets && o.presets.length) {
        box.appendChild(h('div', { class: 'chips', style: 'margin-top:12px' },
          o.presets.map(function (p) {
            return h('button', {
              type: 'button',
              onclick: function () { inp.value = p.value; inp.focus(); },
            }, [p.label]);
          })));
      }

      function submit() {
        var v = inp.value.trim();
        if (!v && !o.allowEmpty) return;                 // 空值直接不响应,不弹二次警告
        if (o.type === 'number' && v && isNaN(parseFloat(v))) return;
        done(v);
      }

      box.appendChild(h('button', { class: 'btn', style: 'margin-top:16px', onclick: submit },
                       [o.ok || '记下']));
      if (o.allowEmpty) {
        box.appendChild(h('button', {
          class: 'btn ghost', style: 'margin-top:8px',
          onclick: function () { done(''); },
        }, [o.emptyLabel || '留空']));
      }
      if (o.back) box.appendChild(backBtn(done, o.backLabel));
      box.appendChild(cancelBtn(done));
    });
  }

  /** 确认 —— 返回 true / false */
  function confirm(o) {
    return open(function (box, done) {
      head(box, o.title, o.body);
      box.appendChild(h('button', {
        class: 'btn' + (o.danger ? ' danger' : ''), style: 'margin-top:16px',
        onclick: function () { done(true); },
      }, [o.ok || '确定']));
      box.appendChild(h('button', {
        class: 'btn ghost', style: 'margin-top:8px',
        onclick: function () { done(false); },
      }, [o.cancel || '取消']));
    }).then(function (v) { return v === true; });
  }

  /** 只是告诉你一件事 */
  function note(o) {
    return open(function (box, done) {
      head(box, o.title, o.body);
      box.appendChild(h('button', { class: 'btn', style: 'margin-top:16px',
                                    onclick: function () { done(true); } }, [o.ok || '知道了']));
    });
  }

  return { pick: pick, ask: ask, confirm: confirm, note: note, close: close,
           BACK: BACK };
})();

if (typeof module !== 'undefined') module.exports = Modal;
