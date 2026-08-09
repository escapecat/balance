// 类别色 —— **一个类别一个颜色,全应用只有这一处说了算。**
//
// ⚠️ 改版前每处各自为政:stats.js 里一个写死的 HUES 数组,按**索引**取色,
//    而索引来自当次渲染的排序。于是「黄金」在饼图里是棕色、在柱图里是蓝色 ——
//    同一屏两个颜色指同一样东西,图例反而帮倒忙。
//    这里按**类别名**映射,排序怎么变颜色都不变。
//
// ⚠️ 返回的是 `var(--cat-x)` 而不是 `#rrggbb`,深色模式才跟得上。
//    直接吐 hex 的话,夜里那套低饱和度色压在深底上几乎看不见。
//
// ⚠️ 认不出的类别**不留空、不复用**,按名字 hash 稳定分配一个。
//    你哪天在设置里加一类「REITs」,它立刻有色且每次都是同一个 ——
//    只不过不是我挑的那个。

var Palette = (function () {

  // 按资产性质分色,不是随便挑的:
  //   权益类冷色(蓝 → 青 → 紫)· 黄金金色 · 债券绿色 · 现金中性灰
  //   同族相邻但拉开明度,连着放不会糊成一片。
  var MAP = {
    '标普500':  'a',
    '纳指100':  'b',
    '黄金':     'c',
    '红利低波': 'd',
    '中长债':   'e',
    '中短债':   'f',
    '现金':     'g',
    '未分类':   'h',
    '组合外':   'i',
  };

  var SLOTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];

  /** 名字 → 稳定槽位。同一个名字永远同一个色,和出现顺序无关。 */
  function hashSlot(name) {
    var n = 0;
    for (var i = 0; i < name.length; i++) n = (n * 31 + name.charCodeAt(i)) >>> 0;
    return SLOTS[n % SLOTS.length];
  }

  function slot(category) {
    return MAP[category] || hashSlot(String(category || ''));
  }

  /** 主色 —— 条、点、线、扇形都用它。 */
  function color(category) { return 'var(--cat-' + slot(category) + ')'; }

  /** 同色的浅底 —— 徽章底色、面积图填充。
   *  ⚠️ 不用 opacity 调,那会把底下的分隔线一起透出来。 */
  function soft(category) { return 'var(--cat-' + slot(category) + '-soft)'; }

  return { color: color, soft: soft, slot: slot, MAP: MAP };
})();

if (typeof module !== 'undefined') module.exports = Palette;
