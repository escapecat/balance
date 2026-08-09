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

  return { text: text, label: label, LABEL: LABEL };
})();

if (typeof module !== 'undefined') module.exports = Dom;
