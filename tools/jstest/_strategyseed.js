// Entirely synthetic. Deliberately round figures, never loaded from a private account.
function seed(date) {
  date = date || '2026-10-30';
  function fund(code, category, status, limit) { return { code: code, name: '合成基金 ' + code,
    category: category, trade: { status: status, platform: '合成测试平台', checkedOn: date, dailyLimit: limit } }; }
  return { __meta: { schema: 3 },
    settings: { targets: { 纳指: 0.15, 长债: 0.25, 其他: 0.55 }, cashTarget: 0.05, cashFloor: 50000, minBuy: 1000, band: 0.05,
      funds: [fund('111111', '纳指', 'limited', 100), fund('222222', '长债', 'open'), fund('333333', '其他', 'open')],
      retired: [], locked: [], buyFundByCategory: {}, reviewPolicy: { annualDate: '', halfEnabled: true } },
    snapshots: [{ date: date, holdings: { '111111': 110000, '222222': 240000, '333333': 580000 }, cash: { c: 70000 }, actionIds: [] }],
    todos: [], flows: [], assets: [], prefs: { actionsSince: date } };
}
module.exports = seed;
