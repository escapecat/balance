// Real persistence/sync; all HTTP replies and account values are synthetic and in memory.
var assert = require('assert/strict'), mem = {}, failedKey = '', writes = 0;
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
  setItem: function (k, v) { if (k === failedKey) throw new Error('simulated write failure'); writes++; mem[k] = String(v); },
  removeItem: function (k) { delete mem[k]; }, key: function (i) { return Object.keys(mem)[i] || null; },
  get length() { return Object.keys(mem).length; },
};
var Store = global.Store = require('../../app/lib/store'), Sync = global.Sync = require('../../app/lib/sync');
global.Trading = require('../../app/core/trading');
var data = require('./_strategyseed')(), clone = function (v) { return JSON.parse(JSON.stringify(v)); };
var remote, sha, calls, onGet, onPut, getStatus;
function logical(p) { return { version: p.version, data: p.data }; }
function response(status, body) { return { ok: status === 200, status: status, text: function () { return Promise.resolve(JSON.stringify(body)); } }; }
function reset() {
  mem = {}; Store.boot(); Store.importAll({ version: 4, data: data });
  Sync.saveCfg({ owner: 'fixture', repo: 'private-fixture', token: 'test', sha: 'remote1', dirty: false });
  remote = clone(Store.exportAll()); sha = 'remote1'; calls = []; onGet = null; onPut = null; getStatus = 200;
}
global.fetch = function (url, opts) {
  calls.push(opts.method);
  if (opts.method === 'GET') {
    if (onGet) { var fn = onGet; onGet = null; fn(); }
    return Promise.resolve(response(getStatus, { sha: sha, content: Sync.toB64(JSON.stringify(remote)) }));
  }
  assert.equal(opts.method, 'PUT');
  remote = JSON.parse(Sync.fromB64(JSON.parse(opts.body).content)); sha = 'remote2';
  if (onPut) onPut();
  return Promise.resolve(response(200, { content: { sha: sha } }));
};
(async function () {
  reset(); var original = clone(Store.exportAll()), count = writes;
  assert(Store.set('settings', clone(Store.get('settings')))); assert.equal(writes, count); assert.equal(Sync.cfg().dirty, false);
  var reordered = {}, settings = Store.get('settings'); Object.keys(settings).reverse().forEach(function (k) { reordered[k] = settings[k]; });
  assert(Store.set('settings', reordered)); assert.equal(writes, count); assert.equal(Sync.cfg().dirty, false);
  Store.set('flows', [{ id: 'synthetic', amount: 10 }]); assert.equal(Sync.cfg().dirty, true);
  Store.set('settings', reordered); assert.equal(Sync.cfg().dirty, true, 'An unchanged write never clears a real change');
  reset(); Store.remove('prefs'); assert.equal(Sync.cfg().dirty, true); Sync.clearDirty(); Store.remove('prefs'); assert.equal(Sync.cfg().dirty, false);
  reset(); Sync.markDirty(); remote.exportedAt = '2000-01-01T00:00:00Z';
  var before = logical(Store.exportAll()), result = await Sync.autoPull();
  assert(result.same && result.reconciled); assert.equal(Sync.cfg().dirty, false); assert.deepEqual(calls, ['GET']);
  assert.deepEqual(logical(Store.exportAll()), before, 'Repairing a stale flag must not import or rewrite the ledger');
  reset(); Store.set('flows', [{ id: 'local', amount: 20 }]); before = logical(Store.exportAll());
  result = await Sync.autoPull(); assert(result.skipped); assert.equal(Sync.cfg().dirty, true); assert.deepEqual(logical(Store.exportAll()), before); assert.deepEqual(calls, ['GET']);
  reset(); Sync.markDirty(); Sync.saveCfg({ sha: 'old-cache' });
  result = await Sync.push({}); assert(result.ok && result.skipped && result.clean); assert.deepEqual(calls, ['GET']); assert.equal(Sync.cfg().dirty, false);
  reset(); Store.set('flows', [{ id: 'local', amount: 20 }]); Sync.saveCfg({ sha: 'old-cache' });
  result = await Sync.push({}); assert(result.conflict); assert.deepEqual(calls, ['GET']); assert.equal(Sync.cfg().dirty, true);
  reset(); Store.set('flows', [{ id: 'local', amount: 20 }]); getStatus = 503;
  result = await Sync.push({}); assert.equal(result.ok, false); assert.deepEqual(calls, ['GET']); assert.equal(Sync.cfg().dirty, true);
  reset(); Store.set('flows', [{ id: 'captured', amount: 20 }]);
  onPut = function () { Store.set('flows', [{ id: 'newer', amount: 30 }]); };
  result = await Sync.flush(); assert(result.ok && result.clean === false); assert.equal(Sync.cfg().dirty, true);
  assert.equal(remote.data.flows[0].id, 'captured'); assert.equal(Store.get('flows')[0].id, 'newer');
  reset(); remote.data.flows = [{ id: 'cloud-new', amount: 20 }]; sha = 'remote-new';
  onGet = function () { Store.set('flows', [{ id: 'during-get', amount: 30 }]); };
  result = await Sync.autoPull(); assert(result.skipped); assert.equal(Store.get('flows')[0].id, 'during-get'); assert.equal(Sync.cfg().dirty, true);
  reset(); onGet = function () { Sync.saveCfg({ repo: 'different-target' }); }; Store.set('flows', [{ id: 'local', amount: 20 }]);
  result = await Sync.push({}); assert.equal(result.ok, false); assert.deepEqual(calls, ['GET']); assert.equal(Sync.cfg().repo, 'different-target');
  reset(); count = writes; failedKey = 'balance:flows'; assert.equal(Store.set('flows', [{ id: 'failed' }]), false); failedKey = '';
  assert.equal(Sync.cfg().dirty, false); assert.deepEqual(logical(Store.exportAll()), logical(original));
  reset(); Sync.silently(function () { Sync.silently(function () { Store.set('flows', [{ id: 'import-inner' }]); }); Store.set('prefs', { imported: true }); });
  assert.equal(Sync.cfg().dirty, false, 'Nested imports must stay quiet until their outer operation ends');
  var h = require('./_dom'), ctx = h.makeCtx(data), snap = ctx.Ledger.latest(ctx.Store.get('snapshots')), st = ctx.Config.get();
  var plan = ctx.Allocate.planMonthly(snap, st, snap.date); ctx.Todos.sync(plan, snap.date, snap.date); ctx.Sync.clearDirty();
  before = JSON.stringify(ctx.Store.exportAll().data); ctx.Todos.sync(plan, snap.date, snap.date);
  assert.equal(JSON.stringify(ctx.Store.exportAll().data), before); assert.equal(ctx.Sync.cfg().dirty, false);
  ctx.Config.save({ minBuy: ctx.Config.get().minBuy }); assert.equal(ctx.Sync.cfg().dirty, false);
  console.log('  Sync state ok: no-op content, stale flags, GET-only reconciliation, real dirty changes, conflict/error fences and concurrent writes');
})().catch(function (e) { console.error(e); process.exitCode = 1; });
