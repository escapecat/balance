// 配置的读写 —— 纯逻辑,不碰 DOM。
//
// ⚠️ 放在 core 而不是 ui,是因为 tools/check.sh 有一条守卫:
//    **ui/ 里不许出现 Store.set**。写存储就是业务。
//
// ⚠️ 这一层最要紧的是**改配置不许动历史**。
//    删一只基金、改一个类别,历史快照里的金额一个都不许变 ——
//    那些是你当时真实看到的数,改了就再也对不回去了。
//    所以删基金只是从清单里去掉,快照里那笔钱还在,只是变成「未分类」。

var Config = (function () {

  var DEFAULTS = {
    targets: {}, funds: [], locked: [],
    cashFloor: 0, cashTarget: 0.05, band: 0.05, minBuy: 1000,
  };

  function get() {
    var s = Store.get('settings', null);
    if (!s) return JSON.parse(JSON.stringify(DEFAULTS));
    Object.keys(DEFAULTS).forEach(function (k) {
      if (s[k] === undefined) s[k] = DEFAULTS[k];
    });
    return s;
  }

  function save(patch) {
    var s = Object.assign(get(), patch);
    Store.set('settings', s);
    return s;
  }

  /** 加一只 / 改一只。按 code 认人。
   *  @param isNew 新加的时候 code 不能和已有的撞 */
  function upsertFund(f, isNew) {
    var s = get();
    var list = (s.funds || []).slice();
    if (!f.code) return { ok: false, why: '没有基金代码' };

    var i = list.findIndex(function (x) { return x.code === f.code; });
    if (isNew && i >= 0) return { ok: false, why: '代码 ' + f.code + ' 已经在清单里了' };

    // 改代码的情况:老的那条要挪走,不能留下两条
    if (!isNew && f._oldCode && f._oldCode !== f.code) {
      var j = list.findIndex(function (x) { return x.code === f._oldCode; });
      if (j >= 0) list.splice(j, 1);
      i = -1;
    }
    var clean = {};
    ['code', 'name', 'category', 'dailyLimit', 'primary', 'active', 'status']
      .forEach(function (k) { if (f[k] !== undefined && f[k] !== null) clean[k] = f[k]; });
    if (i >= 0) list[i] = clean; else list.push(clean);
    save({ funds: list });
    return { ok: true };
  }

  /** ⚠️ 只从清单里去掉,**历史快照一个字不动**。
   *     那笔钱还在总额里,只是从此显示成「未分类」、不参与再平衡。
   *     真去改历史的话,你就再也对不回当时基金 app 上看到的数了。 */
  function removeFund(code) {
    var s = get();
    save({ funds: (s.funds || []).filter(function (f) { return f.code !== code; }) });
  }

  function addCategory(name, ratio) {
    var s = get();
    var t = Object.assign({}, s.targets);
    t[name] = ratio || 0;
    save({ targets: t });
  }

  function removeCategory(name) {
    var s = get();
    var t = Object.assign({}, s.targets);
    delete t[name];
    // 归在这一类下的基金变成没有类别 —— 它们会出现在「未分类」里等你处理,
    // 而不是静默跟着类别一起消失
    var funds = (s.funds || []).map(function (f) {
      if (f.category !== name) return f;
      var c = Object.assign({}, f); delete c.category; return c;
    });
    save({ targets: t, funds: funds });
  }

  /** 目标比例加起来是不是 100% —— 不是的话所有缺口都是错的,
   *  而错法很隐蔽:每一类看着都合理,只是总也填不满。 */
  function targetSum(s) {
    s = s || get();
    return Object.keys(s.targets || {}).reduce(function (a, k) { return a + s.targets[k]; }, 0);
  }

  return { DEFAULTS: DEFAULTS, get: get, save: save,
           upsertFund: upsertFund, removeFund: removeFund,
           addCategory: addCategory, removeCategory: removeCategory,
           targetSum: targetSum };
})();

if (typeof module !== 'undefined') module.exports = Config;
