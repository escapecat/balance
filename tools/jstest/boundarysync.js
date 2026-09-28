// 真实 Store + Sync 的跨设备边界,HTTP 在内存中模拟,不触碰私有仓库。
var assert = require('assert'), mem = {}, remote, put = null;
global.localStorage = {
  getItem: function (k) { return mem[k] === undefined ? null : mem[k]; },
  setItem: function (k, v) { mem[k] = String(v); },
  removeItem: function (k) { delete mem[k]; },
  key: function (i) { return Object.keys(mem)[i] || null; },
  get length() { return Object.keys(mem).length; },
};
global.Store = require('../../app/lib/store.js');
global.Sync = require('../../app/lib/sync.js');
global.Portfolio = require('../../app/core/portfolio.js');
global.Actions = require('../../app/core/actions.js');
var Ledger = require('../../app/core/ledger.js');
var original = { version: 1, data: {
  snapshots: [
    { date: '2020-01-01', holdings: { A: 100000 }, cash: { c: 100000 } },
    { date: '2020-02-01', holdings: { A: 100000 }, cash: { c: 100000 } },
  ],
  flows: [{ id: 'f1', date: '2020-02-01', kind: 'buy', code: 'A', amount: 20000, todoId: 'buy:A' }],
  todos: [{ id: 'buy:A', status: 'done', lastSnap: '2020-02-01', doneAt: '2020-02-01', actual: 20000 }],
  prefs: { actionsSince: '2020-01-01' },
} };
remote = original;
global.fetch = function (url, options) {
  var body;
  if (options.method === 'GET') body = { sha: 'first', content: Sync.toB64(JSON.stringify(remote)) };
  else {
    assert.strictEqual(options.method, 'PUT');
    var request = JSON.parse(options.body);
    assert.strictEqual(request.sha, 'first');
    put = JSON.parse(Sync.fromB64(request.content));
    body = { content: { sha: 'second' } };
  }
  return Promise.resolve({ status: 200, ok: true, text: function () { return Promise.resolve(JSON.stringify(body)); } });
};
assert(Store.boot().ok);
Sync.saveCfg({ owner: 'fixture', repo: 'private-fixture', token: 'test', dirty: false });
Sync.autoPull().then(function (r) {
  assert(r.pulled, '成功的 importAll summary 不是失败,自动拉取必须重新渲染');
  assert.strictEqual(Store.exportAll().version, 2);
  assert.strictEqual(Sync.cfg().dirty, false);
  var s = Store.get('snapshots');
  assert.strictEqual(Actions.between(s[1], null).length, 1);
  assert.strictEqual(Ledger.delta(s[1], s[0]).market, 0);
  return Sync.push({});
}).then(function (r) {
  assert(r.ok);
  assert.strictEqual(put.version, 2);
  assert.deepStrictEqual(put.data.snapshots[1].actionIds, []);
  assert.strictEqual(put.data.flows[0].afterSnapshot, '2020-02-01');
  mem = {}; assert(Store.boot().ok);
  remote = put;
  Sync.saveCfg({ owner: 'fixture', repo: 'private-fixture', token: 'test', dirty: false });
  return Sync.autoPull();
}).then(function (r) {
  assert(r.pulled);
  var s = Store.get('snapshots');
  assert.strictEqual(Actions.between(s[1], null).length, 1);
  assert.strictEqual(Ledger.delta(s[1], s[0]).market, 0);
  assert.deepStrictEqual(Store.exportAll().data, put.data);
  console.log('  对账边界同步 ok(旧云端导入迁移 · 新版推送 · 另一设备拉取 · 归期不变)');
}).catch(function (e) { console.error(e); process.exit(1); });
