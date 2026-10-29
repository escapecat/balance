// 合成账本：完整起点 / 零买卖 / 归类 / 分红 / 读界面不改账 / 多年检索。
var assert = require('assert');
var harness = require('./_dom.js'), El = harness.El;
function clone(v) { return JSON.parse(JSON.stringify(v)); }
var seed = require('./_seed.js');
function all(node) { return [node].concat.apply([node], node.children.map(all)); }
function text(node) { return (node.text || '') + node.children.map(text).join(''); }
function click(node, label) {
  var button = all(node).filter(function (n) { return n.tagName === 'BUTTON' && text(n).indexOf(label) >= 0; })[0];
  assert(button, '找不到按钮 ' + label); button.handlers.click[0]();
}
function near(a, b) { assert(Math.abs(a - b) < 1e-7, '合成数据计算不一致'); }
var c = harness.makeCtx(seed()), snaps = c.Store.get('snapshots'), flows = c.Actions.all(), st = c.Config.get();
var con = c.Stats.contribution(snaps, flows, st);
assert(con.ok); assert.equal(con.from, '2026-07-30');
near(con.rows.reduce(function (a, r) { return a + r.market; }, 0), 5000);
assert.equal(con.rows.length, 2, '流水旧类别按代码归类，不凭空造新类别');
near(con.rows.filter(function (r) { return r.category === '股'; })[0].inflow, 20000);
var sum = c.Stats.summary(snaps); near(sum.market, 5000); near(sum.inflow + sum.market, sum.change);
near(c.Stats.summary(snaps.slice(-2)).market, 3000);
assert.equal(c.Stats.select(snaps, 'latest').snapshots.length, 2);
assert.equal(c.Stats.select(snaps, 'three').snapshots.length, 4);
assert.equal(c.Stats.select(snaps, 'year').limited, true, '今年缺少年初数据必须明示');
var rawSettings = clone(c.Store.get('settings'));
assert.equal(c.Config.allKnown().length, 2); assert.equal(c.Config.get().retired.length, 1);
assert.deepStrictEqual(clone(c.Store.get('settings')), rawSettings, '读取归类不能修改原配置');
assert.equal(c.Store.inspectImport(c.Store.exportAll()).summary.emptyFundEntries, 1);
var bad = clone(c.Store.exportAll()); bad.data.settings.retired.push({});
assert.equal(c.Store.inspectImport(bad).ok, false);
bad.data.settings.retired = 'not-an-array'; assert.equal(c.Store.inspectImport(bad).ok, false);
var composition = c.Stats.composition(snaps, st);
assert.equal(composition[0].by['债'], 50000, '已移除基金仍保留历史归类');
assert(!composition[0].by['未分类']);
composition.forEach(function (r) { near(Object.keys(r.pct).reduce(function (a, k) { return a + r.pct[k]; }, 0), 1); });

// 第一笔买卖不等于声明完整。反之，明确完整而零买卖的区间应能计算。
var noDeclaration = seed(); noDeclaration.prefs = {};
var unknown = harness.makeCtx(noDeclaration);
assert(!unknown.Stats.contribution(unknown.Store.get('snapshots'), unknown.Actions.all(), unknown.Config.get()).ok);
var zero = seed(); zero.flows = []; zero.snapshots = zero.snapshots.slice(0, 2);
var z = harness.makeCtx(zero);
near(z.Stats.contribution(z.Store.get('snapshots'), [], z.Config.get()).rows[0].market, 1000);

// 分红不是净卖出；无持仓但有买卖的类别也不能消失。
var divSeed = seed(); divSeed.snapshots[3].holdings.B = 49000; divSeed.snapshots[3].cash.c += 1000;
divSeed.flows.push({ id: 'f2', date: '2026-10-10', kind: 'dividend', code: 'B', category: '旧债类', amount: 1000 });
var div = harness.makeCtx(divSeed), dc = div.Stats.contribution(div.Store.get('snapshots'), div.Actions.all(), div.Config.get());
var debt = dc.rows.filter(function (r) { return r.category === '债'; })[0];
near(debt.dividend, 1000); near(debt.inflow, 0); near(debt.market, 0);
near(debt.from + debt.inflow + debt.market - debt.dividend, debt.to);
divSeed.flows.push({ id: 'f3', date: '2026-10-11', kind: 'buy', code: 'X', amount: 1000 },
  { id: 'f4', date: '2026-10-20', kind: 'sell', code: 'X', amount: 1100 });
var closed = harness.makeCtx(divSeed), cc = closed.Stats.contribution(closed.Store.get('snapshots'), closed.Actions.all(), closed.Config.get());
near(cc.rows.filter(function (r) { return r.category === '未分类'; })[0].market, 100);

// 真实 DOM 事件路径的轻量版本：每一期都点击，不能只测挂载。
var original = clone(c.Store.exportAll().data), page = new El('div');
snaps.forEach(function (s) {
  c.HistoryUI.mount(page);
  click(page, s.date + ' 盘点');
  assert(text(page).indexOf('当期总资产') >= 0);
  assert(text(page).indexOf('暂时无法') < 0);
});
c.StatsUI.mount(page); click(page, '本期');
assert(text(page).indexOf('2026-09-28 — 2026-10-29') >= 0);
click(page, '查看各类区间盈亏');
assert(text(page).indexOf('各类区间盈亏') >= 0); click(page, '股');
assert(text(page).indexOf('＝ 期末市值') >= 0);
assert.deepStrictEqual(clone(c.Store.exportAll().data), original, '查历史、切区间、展开类别均不能写账');

// 多年列表不先渲染全部；搜索保留输入焦点，仅更新结果容器。
var many = seed(); many.snapshots = []; many.flows = []; many.prefs.actionsSince = '2017-01-01';
for (var i = 0; i < 120; i++) many.snapshots.push({ date: (2017 + Math.floor(i / 12)) + '-' + String(i % 12 + 1).padStart(2, '0') + '-01',
  holdings: { A: 100000 + i, B: 50000 }, cash: { c: 50000 }, actionIds: [] });
var m = harness.makeCtx(many); m.HistoryUI.mount(page);
assert.equal(all(page).filter(function (n) { return n.className === 'history-card'; }).length, 20);
click(page, '再显示 20 条');
assert.equal(all(page).filter(function (n) { return n.className === 'history-card'; }).length, 40);
var search = page.querySelector('#history-search');
search.handlers.input[0]({ target: { value: '2025-03' } });
assert.equal(all(page).filter(function (n) { return n.className === 'history-card'; }).length, 1);
assert.strictEqual(page.querySelector('#history-search'), search, '搜索不能重建输入框');
m.StatsUI.mount(page); click(page, '完整记录'); click(page, '更早的盘点');
assert(text(page).indexOf('较新的盘点') >= 0);

// 基金增删同样容忍旧 null，而不是只有历史详情单点防御。
assert(c.Config.upsertFund({ code: 'C', name: '合成新基金', category: '债' }, true).ok);
c.Config.removeFund('C'); assert(c.Config.allKnown().some(function (f) { return f.code === 'C'; }));
console.log('  区间账本 ok(完整起点与零买卖 · 旧空项 · 已移除基金 · 分红与清仓 · 每期详情点击 · 多年检索分页 · 只读不改账)');
