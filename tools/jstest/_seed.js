function seed() { return {
  __meta: { schema: 2 }, settings: { targets: { 股: 0.5, 债: 0.45 }, cashTarget: 0.05,
    cashFloor: 0, minBuy: 100, funds: [{ code: 'A', name: '合成股票基金', category: '股' }],
    retired: [null, { code: 'B', name: '合成已移除债基', category: '债' }] },
  snapshots: [
    { date: '2026-07-30', holdings: { A: 100000, B: 50000 }, cash: { c: 50000 }, actionIds: [] },
    { date: '2026-08-27', holdings: { A: 101000, B: 50000 }, cash: { c: 55000 }, actionIds: [] },
    { date: '2026-09-28', holdings: { A: 102000, B: 50000 }, cash: { c: 60000 }, actionIds: [] },
    { date: '2026-10-29', holdings: { A: 125000, B: 50000 }, cash: { c: 42000 }, actionIds: [] },
  ], flows: [{ id: 'f1', date: '2026-09-28', afterSnapshot: '2026-09-28', kind: 'buy', code: 'A', category: '旧分类', amount: 20000 }],
  prefs: { actionsSince: '2026-07-30' }, todos: [], assets: [],
}; }

module.exports = seed;
