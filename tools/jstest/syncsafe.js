// 同步的安全边界 —— **这几条防的是「一步操作毁掉全部历史」。**
//
// ⚠️ 不打网络。同步的网络部分单独实测过(GET/PUT/sha/冲突),
//    这里测的是**决定要不要写**的那几个判断 —— 而它们才是会毁数据的地方。
//    网络失败最多是「没同步上」,判断错了是「数据没了」。

var path = require('path');
var A = path.join(__dirname, '..', '..', 'app');

var mem = {};
var pushed = [];          // 记录每次「真的发出去了」的内容

global.Store = {
  get: function (k, d) { return mem[k] === undefined ? d : mem[k]; },
  set: function (k, v) { mem[k] = v; },
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

var Sync = require(path.join(A, 'lib', 'sync.js'));

var fail = 0;
function ok(c, m) { if (!c) { console.log('  FAIL ' + m); fail++; } }

function reset(localSnaps, remoteSnaps) {
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

  console.log(fail ? '  同步安全 ' + fail + ' 条没过'
                   : '  同步安全 ok(空的不推 · 冲突不盖 · 自动推不 force)');
  process.exit(fail ? 1 : 0);
});
