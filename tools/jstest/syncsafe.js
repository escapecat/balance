// 同步的安全边界 —— **这几条防的是「一步操作毁掉全部历史」。**
//
// ⚠️ 不打网络。同步的网络部分单独实测过(GET/PUT/sha/冲突),
//    这里测的是**决定要不要写**的那几个判断 —— 而它们才是会毁数据的地方。
//    网络失败最多是「没同步上」,判断错了是「数据没了」。

var path = require('path');
var A = path.join(__dirname, '..', '..', 'app');

var mem = {};
var pushed = [];          // 记录每次「真的发出去了」的内容

// ⚠️ 和 lib/store.js 里那份**必须一致**。对不上的话，
//    要么漏测某个 key，要么测到一个线上不存在的路径。
var SYNCED = { settings: 1, snapshots: 1, assets: 1, todos: 1, flows: 1, prefs: 1 };

global.Store = {
  get: function (k, d) { return mem[k] === undefined ? d : mem[k]; },
  // ⚠️ **桩必须复刻真实 Store.set 的行为**,包括那句 markDirty。
  //    少了它,「拉完会不会反手推」这条测的就是个空气 ——
  //    把 sync.js 里的 quiet 判断整行删掉,测试照样全绿。
  //    桩和实现行为不一致的时候,测试不是没测到,是**在证明一件假事**。
  set: function (k, v) {
    mem[k] = v;
    if (SYNCED[k] && typeof Sync !== 'undefined') Sync.markDirty();
  },
  exportAll: function () {
    return { version: 1, exportedAt: '2026-08-10T00:00:00Z',
             data: { snapshots: mem.snapshots || [] } };
  },
  inspectImport: function (o) {
    if (!o || o.version !== 1 || !o.data) return { ok: false, why: '格式不对' };
    var s = o.data.snapshots || [];
    return { ok: true, summary: { snapshots: s.length,
             first: s.length ? s[0].date : null,
             last: s.length ? s[s.length - 1].date : null } };
  },
  saveRollback: function (reason) { mem.__rollback = reason; },
  // ⚠️ 桩里也要**真的走 Store.set** —— 那正是会触发 markDirty 的路径。
  //    如果这里直接改 mem,「拉完反手推回去」这个 bug 就测不出来,
  //    而它恰恰是自动同步最容易长出来的一个。
  importAll: function (o) {
    var self = global.Store;
    Object.keys(o.data || {}).forEach(function (k) { self.set(k, o.data[k]); });
    return { ok: true };
  },
};

// ⚠️ 假的 fetch —— 记下每一次请求。**不许真的打网络**:
//    测试要能离线跑,而且不能因为 GitHub 抽风就变红。
var remote = null;        // 云端那份(null = 还没有文件)
global.fetch = function (url, opt) {
  var method = (opt || {}).method || 'GET';
  if (method === 'GET' && url.indexOf('/contents/') >= 0) {
    if (!remote) return Promise.resolve(mkRes(404, { message: 'Not Found' }));
    return Promise.resolve(mkRes(200, { content: b64(remote.text), sha: remote.sha }));
  }
  if (method === 'PUT') {
    var body = JSON.parse(opt.body);
    pushed.push(unb64(body.content));
    remote = { text: unb64(body.content), sha: 'sha' + pushed.length };
    return Promise.resolve(mkRes(200, { content: { sha: remote.sha } }));
  }
  return Promise.resolve(mkRes(200, {}));
};
function mkRes(status, obj) {
  return { status: status, ok: status >= 200 && status < 300,
           text: function () { return Promise.resolve(JSON.stringify(obj)); } };
}
function b64(s) { return Buffer.from(s, 'utf8').toString('base64'); }
function unb64(s) { return Buffer.from(s, 'base64').toString('utf8'); }
global.TextEncoder = require('util').TextEncoder;
global.TextDecoder = require('util').TextDecoder;
global.btoa = function (s) { return Buffer.from(s, 'binary').toString('base64'); };
global.atob = function (s) { return Buffer.from(s, 'base64').toString('binary'); };

// ⚠️ 拦下 setTimeout —— 自动推是**延迟 4 秒**发生的,测试早就 exit 了。
//    只看 pushed 的话,「有没有安排推送」这件事根本测不到。
var scheduled = 0;
var realTimeout = global.setTimeout;
global.setTimeout = function (fn, ms) {
  if (ms === 4000) { scheduled++; return 0; }   // 那是自动推的防抖
  return realTimeout(fn, ms);
};

var Sync = require(path.join(A, 'lib', 'sync.js'));

var fail = 0;
function ok(c, m) { if (!c) { console.log('  FAIL ' + m); fail++; } }

function reset(localSnaps, remoteSnaps) {
  scheduled = 0;
  mem = { sync: { owner: 'me', repo: 'data', token: 't' } };
  mem.snapshots = localSnaps;
  pushed = [];
  remote = remoteSnaps
    ? { text: JSON.stringify({ version: 1, data: { snapshots: remoteSnaps } }), sha: 'sha0' }
    : null;
}

var SNAP = [{ date: '2026-07-30' }, { date: '2026-08-31' }];

// ---- 1. ★ 本机空着的时候,绝不推 ----
//
// 这条防的是一个会当场毁数据的场景:在新设备(手机)上填完 token,
// **保存配置本身就是一次 Store.set** → 打脏标记 → 4 秒后自动推 ——
// 而这时本机还是空的,云端那几年的历史被 0 期覆盖,
// 在你还没来得及点「立刻同步」之前。
reset([], SNAP);
Sync.push({}).then(function (r) {
  ok(!r.ok && r.empty, '★ 本机 0 期时必须拒绝推送(否则填完 token 就丢数据)');
  ok(pushed.length === 0, '★ 而且**一个字节都不许发出去**');

  // 明确 force 才允许 —— 那是「我就是想清空重来」
  return Sync.push({ force: true });
}).then(function (r2) {
  ok(r2.ok && pushed.length === 1, '明确 force 时可以推空的(那是主动选的)');

  // ---- 2. 有数据时正常推 ----
  reset(SNAP, null);
  return Sync.push({});
}).then(function (r3) {
  ok(r3.ok, '本机有数据、云端为空 → 正常推');
  ok(JSON.parse(pushed[0]).data.snapshots.length === 2, '推上去的是本机那两期');

  // ---- 3. ★ sha 过期 = 另一台设备改过 → 拒绝盖 ----
  reset(SNAP, SNAP);
  mem.sync.sha = '早就过期的 sha';
  return Sync.push({});
}).then(function (r4) {
  ok(!r4.ok && r4.conflict, '★ sha 对不上时必须拒绝写');
  ok(pushed.length === 0, '★ 冲突时也不许发出去 —— 静默覆盖查都没法查');

  // ---- 4. 自动推(markDirty 那条路)永远不 force ----
  //
  // ⚠️ 自动推发生在你没看着的时候。它要是能 force,
  //    「另一台设备的数据被悄悄盖掉」就成了日常。
  reset([], SNAP);
  var src = require('fs').readFileSync(path.join(A, 'lib', 'sync.js'), 'utf8');
  var auto = src.slice(src.indexOf('function markDirty'), src.indexOf('function clearDirty'));
  ok(auto.indexOf('force') < 0, '★ 自动推的代码里不许出现 force');

  // ---- 5. ★ 开机自动拉:只在绝对安全时拉 ----
  //
  // ⚠️ 「安全」= 本机没有未推送的改动。那意味着本机每一笔都已经在云端,
  //    云端只可能比本机新或一样新,拉下来不会丢东西。
  //    dirty 时两边都有对方没有的东西 —— 自动选一边就是赌,
  //    而赌输的表现是「我明明录过那一期」。
  reset(SNAP, [{ date: '2026-07-30' }, { date: '2026-08-31' }, { date: '2026-09-30' }]);
  mem.sync.dirty = true;
  return Sync.autoPull();
}).then(function (a1) {
  ok(a1.skipped, '★ 本机有未推送的改动时,绝不自动拉');

  // 本机干净 + 云端更新 → 拉
  reset([{ date: '2026-07-30' }], [{ date: '2026-07-30' }, { date: '2026-08-31' }]);
  return Sync.autoPull();
}).then(function (a2) {
  ok(a2.pulled, '本机干净、云端更新 → 拉下来');
  ok((mem.snapshots || []).length === 2, '拉完本机应该有 2 期,实际 ' +
     (mem.snapshots || []).length);
  ok(mem.sync.dirty === false, '★ 拉进来的写入不算「你改的」,dirty 要是假');
  // ⚠️ **不能只看 pushed 是不是空的。** 自动推有 4 秒防抖,
  //    测试跑完早就 exit 了,`pushed.length === 0` 无论如何都成立 ——
  //    那条断言从写下来就是装饰(把 quiet 那行注释掉,它照样绿)。
  //    要测的是**有没有安排推送**,所以查 setTimeout 被调用了没。
  ok(scheduled === 0,
     '★ 拉完不许安排推送 —— 那是把刚拉下来的原样推回去,白多一个 commit' +
     '(实际安排了 ' + scheduled + ' 次)');

  // ★ 云端比本机旧 → 别拉(推送记录丢了的情况)
  reset([{ date: '2026-07-30' }, { date: '2026-09-30' }], [{ date: '2026-07-30' }]);
  return Sync.autoPull();
}).then(function (a3) {
  ok(a3.skipped, '★ 云端比本机旧时不许拉 —— 那会把新的换成旧的');
  ok((mem.snapshots || []).length === 2, '本机那两期一个都不能少');

  console.log(fail ? '  同步安全 ' + fail + ' 条没过'
                   : '  同步安全 ok(空的不推 · 冲突不盖 · 自动推不 force · ' +
                     '脏了不拉 · 拉完不反手推)');
  process.exit(fail ? 1 : 0);
});
