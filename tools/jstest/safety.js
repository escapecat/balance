// 数据保护 —— **代码会一直改,而你的数据只有一份。**
//
// ⚠️ 这个文件守的是三件「出了事就找不回来」的事:
//
//    1. 版本对不上时**拒绝启动**。不是「尽力而为地跑」——
//       尽力而为的后果是数据被新代码按错误的假设改写一遍,
//       而那时候连回滚点都被覆盖了。
//
//    2. 不可撤销的写操作(导入 / 删除一期 / 结构升级)之前**先留回滚点**。
//
//    3. 回滚**本身也留一个回滚点**。否则误点一下就再也回不来了,
//       而这个按钮本来是用来救命的。

var path = require('path');
var A = path.join(__dirname, '..', '..', 'app');

var mem = {};
global.localStorage = {
  getItem: function (k) { return mem[k] === undefined ? null : mem[k]; },
  setItem: function (k, v) { mem[k] = String(v); },
  removeItem: function (k) { delete mem[k]; },
  key: function (i) { return Object.keys(mem)[i] || null; },
  get length() { return Object.keys(mem).length; },
};
var Store = require(path.join(A, 'lib', 'store.js'));
global.Store = Store;
global.Portfolio = require(path.join(A, 'core', 'portfolio.js'));
var Ledger = require(path.join(A, 'core', 'ledger.js'));

var fail = 0;
function ok(c, m) { if (!c) { console.log('  FAIL ' + m); fail++; } }
function reset() { mem = {}; }
function seed(dates) {
  Store.set('snapshots', dates.map(function (d, i) {
    return { date: d, holdings: { A: 1000000 + i * 10000 }, cash: {}, netInflow: null };
  }));
  Store.set('settings', { targets: {}, funds: [] });
}

// ---- 1. 全新设备:直接盖章,不当成「旧版本」 ----
reset();
var b = Store.boot();
ok(b.ok && b.fresh, '空设备应该正常开机(实得 ' + JSON.stringify(b) + ')');
ok(Store.get('__meta').schema === Store.SCHEMA, '盖上了当前版本号');

// ---- 1b. ★ 已有数据但没有版本号 = 版本号出现之前存的,必须能正常打开 ----
//
// 这条抓到过一个真 bug:默认版本写成 0 的话,现有用户一打开就走
// 「需要 0→1 升级」,而没有对应的升级步骤 → 拒绝启动 →
// **数据被自己锁住**,页面上只剩一句「不敢往下走」。
// 加版本号这件事本身,绝不能把加之前的数据挡在外面。
reset();
seed(['2026-05-11', '2026-06-11']);
var b1b = Store.boot();
ok(b1b.ok, '★ 老数据(没有 __meta)被挡住了:' + (b1b.why || ''));
ok(Store.get('snapshots').length === 2, '老数据还在');
ok(Store.get('__meta').schema === Store.SCHEMA, '顺手补盖了版本号');
ok(!Store.getRollback(), '这种情况不该留回滚点 —— 什么都没改');

// ---- 2. ★ 数据比代码新 → 拒绝启动 ----
//
// 场景:另一台设备上跑着新代码写了数据,这台的 Service Worker 还缓存着旧代码。
// 让旧代码去读新数据 = 静默算错。
reset();
seed(['2026-05-11', '2026-06-11']);
Store.set('__meta', { schema: Store.SCHEMA + 5 });
var b2 = Store.boot();
ok(!b2.ok, '★ 数据比代码新却照常启动了 —— 旧代码读新数据会静默算错');
ok(/更新版本|v/.test(b2.why || ''), '要说清是版本问题:' + b2.why);
ok(Store.get('snapshots').length === 2, '★ 拒绝启动时不许动数据');

// ---- 3. ★ 缺升级步骤 → 拒绝,且不动数据 ----
reset();
seed(['2026-05-11']);
Store.set('__meta', { schema: -1 });     // 假装是个远古版本,没有对应的 MIGRATE
var b3 = Store.boot();
ok(!b3.ok, '★ 缺升级步骤却照常往下走了');
ok(Store.get('snapshots').length === 1, '★ 数据必须原封不动');

// ---- 4. 导入前自动留回滚点 ----
reset();
seed(['2026-05-11', '2026-06-11', '2026-07-11']);
Store.boot();
ok(!Store.getRollback(), '一开始没有回滚点');

var incoming = { version: 1, data: {
  snapshots: [{ date: '2020-01-01', holdings: { A: 1 }, cash: {} }],
  settings: { targets: {}, funds: [] },
} };
Store.importAll(incoming);
ok(Store.get('snapshots').length === 1, '导入生效了');
var rb = Store.getRollback();
ok(rb && rb.data.snapshots.length === 3,
   '★ 导入之前没留回滚点 —— 导错了就再也回不来(实得 ' +
   (rb ? rb.data.snapshots.length : 'null') + ' 期)');
ok(/导入/.test(rb.reason || ''), '回滚点要说清是什么时候留的:' + rb.reason);

// ---- 5. 回滚,且回滚本身也能撤 ----
var r = Store.rollback();
ok(r.ok && Store.get('snapshots').length === 3, '退回去了');
var rb2 = Store.getRollback();
ok(rb2 && rb2.data.snapshots.length === 1,
   '★ 回滚之后没留下「回滚前」的状态 —— 误点一下就再也回不来了');
Store.rollback();
ok(Store.get('snapshots').length === 1, '再退一次能回到刚才那份 —— 来回都走得通');

// ---- 6. 删掉某一期:先留回滚点,并报出受影响的那一期 ----
reset();
seed(['2026-05-11', '2026-06-11', '2026-07-11']);
Store.boot();
var del = Ledger.removeSnapshot('2026-06-11');
ok(del.ok, '删得掉');
ok(del.affects === '2026-07-11',
   '★ 没报出「下一期的涨跌会跟着重算」—— 基准变了,而你会以为是市场动了');
ok(Store.get('snapshots').length === 2, '确实少了一期');
ok(Store.get('snapshots').every(function (s) { return s.date !== '2026-06-11'; }),
   '删掉的是指定那一期');

var rb3 = Store.getRollback();
ok(rb3 && rb3.data.snapshots.length === 3,
   '★ 删除之前没留回滚点 —— 删除比导入更容易误触,只要点两下');
Store.rollback();
ok(Store.get('snapshots').length === 3, '删错了能退回来');

// ---- 7. 删不存在的一期:说清楚,不静默成功 ----
var bad = Ledger.removeSnapshot('1999-01-01');
ok(!bad.ok, '★ 删一个不存在的日期却报了成功');
ok(Store.get('snapshots').length === 3, '也不许动数据');

// ---- 8. 回滚点坏了要说出来,不能拿它去覆盖好数据 ----
reset();
seed(['2026-05-11']);
Store.boot();
Store.set('__rollback', { version: 1, data: { snapshots: '这不是数组' } });
var r2 = Store.rollback();
ok(!r2.ok, '★ 拿一份坏掉的回滚点覆盖了好数据');
ok(Array.isArray(Store.get('snapshots')) && Store.get('snapshots').length === 1,
   '好数据必须还在');

if (fail) { console.log('  ' + fail + ' 条没过'); process.exit(1); }
console.log('  数据保护 ok(版本对不上就拒绝启动 · 不可撤销操作前留回滚点 · 回滚本身也能撤)');
