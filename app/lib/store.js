// 存储 —— **全项目唯一碰 localStorage 和网络的文件。**
//
// 业务代码一律走 Store.get / Store.set。这条纪律的价值在换壳的时候才兑现:
// 换到别的运行时(小程序、Electron、别的同步后端)只用改这一个文件。
//
// ⚠️ 数据只存本地。仓库是公开的,**一分钱都不进仓库** ——
//    tools/check.sh 有一条 grep 守着 *.db / backup*.json / token。
//
// ⚠️ 导入是这个 app 里唯一**不可撤销**的写操作,所以规矩是
//    **先全验完,再一次性写**。边验边写的话,验到一半抛异常你的数据
//    就是半新半旧的 —— 那比彻底失败还糟,因为你不知道坏在哪儿。

var Store = (function () {

  var NS = 'balance:';

  // 所有会被导出/导入的键。加了新键**必须加进来**,
  // 否则备份里悄悄少一样,而你只有在换手机之后才发现。
  var KEYS = ['settings', 'snapshots', 'assets', 'todos', 'flows', 'prefs'];
  // 这些是数组,导入时形状对不上就整份拒绝
  var MUST_ARRAY = ['snapshots', 'assets', 'todos', 'flows'];

  function get(key, fallback) {
    var raw;
    try { raw = localStorage.getItem(NS + key); } catch (e) { return fallback; }
    if (raw === null || raw === undefined) return fallback === undefined ? null : fallback;
    try { return JSON.parse(raw); } catch (e) {
      // ⚠️ 坏 JSON 返回兜底值,不抛 —— 一个键坏掉不该让整个页面白屏。
      //    但要在控制台留个痕,不然它会永远静默地当成「没有数据」。
      if (typeof console !== 'undefined') console.error('Store: ' + key + ' 解析失败,当成空的了');
      return fallback === undefined ? null : fallback;
    }
  }

  function set(key, value) {
    try {
      localStorage.setItem(NS + key, JSON.stringify(value));
      return true;
    } catch (e) {
      // 配额满 / 隐私模式。这里必须让调用方知道 —— 静默失败会让你
      // 以为存下来了,下次打开发现白填。
      if (typeof console !== 'undefined') console.error('Store: 写 ' + key + ' 失败', e);
      return false;
    }
  }

  function remove(key) {
    try { localStorage.removeItem(NS + key); } catch (e) {}
  }

  function keys() {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(NS) === 0) out.push(k.slice(NS.length));
      }
    } catch (e) {}
    return out;
  }

  // ---------------- 备份 ----------------

  function exportAll() {
    var data = {};
    KEYS.forEach(function (k) {
      var v = get(k, undefined);
      if (v !== null && v !== undefined) data[k] = v;
    });
    return { version: 1, exportedAt: new Date().toISOString(), data: data };
  }

  /** 只看不写 —— 覆盖之前得先让人看清要盖掉什么。
   *  @return {ok:true, summary} | {ok:false, why} */
  function inspectImport(obj) {
    if (!obj || typeof obj !== 'object') return { ok: false, why: '这不是一份备份文件' };
    if (typeof obj.version !== 'number') return { ok: false, why: '缺 version,认不出是哪个版本的备份' };
    if (obj.version > 1) return { ok: false, why: '这份备份比当前版本还新(v' + obj.version + ')' };
    if (!obj.data || typeof obj.data !== 'object') return { ok: false, why: '缺 data' };

    for (var i = 0; i < MUST_ARRAY.length; i++) {
      var k = MUST_ARRAY[i];
      if (obj.data[k] !== undefined && !Array.isArray(obj.data[k])) {
        return { ok: false, why: k + ' 应该是个数组,实际是 ' + typeof obj.data[k] };
      }
    }
    var snaps = obj.data.snapshots || [];
    return {
      ok: true,
      summary: {
        snapshots: snaps.length,
        first: snaps.length ? snaps[0].date : null,
        last: snaps.length ? snaps[snaps.length - 1].date : null,
        assets: (obj.data.assets || []).length,
        todos: (obj.data.todos || []).length,
        flows: (obj.data.flows || []).length,
        exportedAt: obj.exportedAt || null,
      },
    };
  }

  /** 覆盖式导入。**先全验完再一次性写**,验不过一个字节都不动。 */
  function importAll(obj) {
    var chk = inspectImport(obj);
    if (!chk.ok) throw new Error(chk.why);
    KEYS.forEach(function (k) {
      if (obj.data[k] !== undefined) set(k, obj.data[k]);
    });
    return chk.summary;
  }

  function clearAll() { keys().forEach(remove); }

  return { NS: NS, KEYS: KEYS, get: get, set: set, remove: remove, keys: keys,
           exportAll: exportAll, inspectImport: inspectImport, importAll: importAll,
           clearAll: clearAll };
})();

if (typeof module !== 'undefined') module.exports = Store;
