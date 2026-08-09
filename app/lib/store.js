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

  // ⚠️ **数据结构的版本号。改了字段含义就 +1,并在 MIGRATE 里加一条。**
  //
  //    没有它的话,新代码读旧数据是**静默出错**的:字段改名之后
  //    读到 undefined,当成「这项没填」照样往下算,数字全变但一个错都不报。
  //    而代码是自动更新的(GitHub Pages + Service Worker)——
  //    你某天打开发现总额不对,根本想不到是三天前我改了个字段名。
  var SCHEMA = 1;

  // 版本 n → n+1 的升级函数。**只往前,不回退。**
  // 每条都要能重复跑而结果不变(万一中途失败重来一次)。
  var MIGRATE = {
    // 1: function (data) { ... return data; },
  };

  // 所有会被导出/导入的键。加了新键**必须加进来**,
  // 否则备份里悄悄少一样,而你只有在换手机之后才发现。
  var KEYS = ['settings', 'snapshots', 'assets', 'todos', 'flows', 'prefs'];
  // 这些是数组,导入时形状对不上就整份拒绝
  var MUST_ARRAY = ['snapshots', 'assets', 'todos', 'flows'];

  var META = '__meta';        // 版本号存这儿,不参与导出的 KEYS
  var ROLLBACK = '__rollback';   // 上一个好状态,单份滚动覆盖

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
    // ⚠️ 导入是唯一不可撤销的写操作 —— **动手之前先留一个回滚点**。
    //    界面上已经会问一遍「确定要覆盖吗」,但那问的是意图,
    //    答不了「导进来才发现是三个月前那份」。
    saveRollback('导入备份之前');
    KEYS.forEach(function (k) {
      if (obj.data[k] !== undefined) set(k, obj.data[k]);
    });
    set(META, { schema: SCHEMA });
    return chk.summary;
  }

  function clearAll() { keys().forEach(remove); }

  // ---------------- 版本与回滚 ----------------

  function raw(key) {
    try { return localStorage.getItem(NS + key); } catch (e) { return null; }
  }
  function isEmpty() {
    return KEYS.every(function (k) { return raw(k) === null; });
  }

  /** 开机时跑一次。**返回结果,不自己弹窗** —— 这一层不碰 DOM。
   *
   *  @return {ok:true, migrated:[...]}  正常(可能升级过)
   *          {ok:false, why, found, expect}  认不出的版本 —— 界面必须拦住,
   *                                          **一个字节都不许写**
   *
   *  ⚠️ 认不出版本时的正确反应是**停下来**,不是「尽力而为地跑」。
   *     尽力而为的后果是数据被新代码按错误的假设改写一遍,
   *     而那时候连回滚点都被覆盖了。
   */
  function boot() {
    if (isEmpty()) {                       // 全新的设备,直接盖章
      set(META, { schema: SCHEMA });
      return { ok: true, migrated: [], fresh: true };
    }
    var meta = get(META, null);
    // ⚠️ **没有 __meta 但有数据 = 版本号出现之前存的,那就是 v1。**
    //    这里默认成 0 的话,现有用户一打开就会走「需要 0→1 升级」,
    //    而 MIGRATE[0] 不存在 → 拒绝启动 → **数据被自己锁住了**,
    //    页面上只剩一句「不敢往下走」。
    //    v1 的定义就是「加版本号那一刻的结构」,所以老数据天然合规。
    var found = meta && typeof meta.schema === 'number' ? meta.schema : 1;

    if (found > SCHEMA) {
      // 别的设备上跑着更新的版本,而这台还是旧代码(缓存没刷新)。
      // 让旧代码去读新数据 = 静默算错,所以拦住。
      return { ok: false, found: found, expect: SCHEMA,
               why: '这台设备上的数据是更新版本(v' + found + ')写的,' +
                    '而当前代码只认到 v' + SCHEMA + '。' +
                    '刷新一下页面拿最新代码;还不行就先别录,免得写坏。' };
    }
    if (found === SCHEMA) {
      if (!meta) set(META, { schema: SCHEMA });   // 老数据补盖个章,只写这一个键
      return { ok: true, migrated: [] };
    }

    // 要升级 —— **先留回滚点**,再动数据
    saveRollback('升级到 v' + SCHEMA + ' 之前');
    var done = [];
    for (var v = found; v < SCHEMA; v++) {
      var fn = MIGRATE[v];
      if (!fn) {
        return { ok: false, found: found, expect: SCHEMA,
                 why: '缺 v' + v + ' → v' + (v + 1) + ' 的升级步骤,不敢往下走。' +
                      '你的数据没有被改动。' };
      }
      var data = {};
      KEYS.forEach(function (k) { data[k] = get(k, undefined); });
      var next;
      try { next = fn(data); } catch (e) {
        return { ok: false, found: found, expect: SCHEMA,
                 why: '升级到 v' + (v + 1) + ' 时出错:' + e.message +
                      '。你的数据没有被改动。' };
      }
      KEYS.forEach(function (k) { if (next[k] !== undefined) set(k, next[k]); });
      done.push(v + '→' + (v + 1));
    }
    set(META, { schema: SCHEMA });
    return { ok: true, migrated: done };
  }

  /** 存一份「上一个好状态」。**单份滚动覆盖** —— 留一串历史版本的话,
   *  localStorage 那 5MB 很快就满了,而满了之后是**写入静默失败**。 */
  function saveRollback(reason) {
    var snap = exportAll();
    snap.reason = reason || null;
    snap.savedAt = new Date().toISOString();
    return set(ROLLBACK, snap);
  }

  function getRollback() { return get(ROLLBACK, null); }

  /** 回到上一个好状态。回滚之前**先把当前状态也存成回滚点** ——
   *  否则误点一下就再也回不来了,而「回滚」这个按钮本来是用来救命的。 */
  function rollback() {
    var prev = getRollback();
    if (!prev) return { ok: false, why: '没有可回滚的状态' };
    var chk = inspectImport(prev);
    if (!chk.ok) return { ok: false, why: '回滚点本身坏了:' + chk.why };
    var current = exportAll();
    current.reason = '回滚之前的状态';
    current.savedAt = new Date().toISOString();
    KEYS.forEach(function (k) {
      if (prev.data[k] !== undefined) set(k, prev.data[k]);
    });
    set(ROLLBACK, current);
    return { ok: true, summary: chk.summary };
  }

  return { NS: NS, KEYS: KEYS, SCHEMA: SCHEMA, get: get, set: set, remove: remove, keys: keys,
           exportAll: exportAll, inspectImport: inspectImport, importAll: importAll,
           clearAll: clearAll, boot: boot,
           saveRollback: saveRollback, getRollback: getRollback, rollback: rollback };
})();

if (typeof module !== 'undefined') module.exports = Store;
