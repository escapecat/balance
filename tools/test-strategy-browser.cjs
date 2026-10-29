// Real clicks, synthetic accounts, isolated storage. No production financial writes.
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const { playwright, localServer, putSeed, tab } = require('./test-insights-browser.cjs');
const seed = require('./jstest/_strategyseed.js');
async function main() {
  const args = process.argv.slice(2), remote = args.find(a => /^https?:/.test(a));
  const local = remote ? null : await localServer(), engine = args.includes('--webkit') ? 'webkit' : 'chromium';
  const browser = await playwright()[engine].launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 430, height: 1000 }, timezoneId: 'Asia/Shanghai', serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (!['GET', 'HEAD'].includes(r.method())) writes.push(r.url()); });
  page.setDefaultTimeout(10000);
  const artifacts = path.resolve(__dirname, '../artifacts/release-2026-10-30');
  fs.mkdirSync(artifacts, { recursive: true });
  const shot = name => page.screenshot({ path: path.join(artifacts, engine + '-' + name + '.png'), animations: 'disabled' });
  const dialog = () => page.locator('.modal-mask:not(.closing)');
  const closeWait = () => page.locator('.modal-mask').waitFor({ state: 'detached' });
  const planView = async () => { await tab(page, '现在'); await page.getByRole('button', { name: /新钱补仓/ }).click(); };
  const editor = () => page.locator('.fund-editor');
  const saveFund = async () => { await editor().getByRole('button', { name: '保存', exact: true }).click(); await editor().waitFor({ state: 'detached' }); };
  const review = async name => { await page.getByRole('button', { name: /年度检查待处理|半年检查待处理|下次年度检查/ }).click(); await page.getByRole('button', { name, exact: true }).click(); };
  async function openSection(title) {
    const names = { '基金与交易限制': '基金与限额', '现金保护': '现金保留' };
    await page.locator('.settings-menu .menu-row').filter({ hasText: names[title] || title }).click();
  }
  async function editFund(status, cap) {
    await tab(page, '设置');
    await openSection('基金与交易限制');
    await page.locator('.settings-detail .list-row').filter({ hasText: '111111' }).click();
    await editor().getByLabel('申购状态', { exact: true }).selectOption(status);
    if (cap !== undefined) await editor().getByLabel('每日总限额', { exact: true }).fill(String(cap));
    await saveFund();
  }
  try {
    await page.goto(remote || local.url); await page.waitForFunction(() => typeof Strategy !== 'undefined');
    const date = await page.evaluate(() => Trading.today());
    const data = seed(date); await putSeed(page, data, 3);
    await planView();
    assert.match(await page.locator('.strategy-amount').textContent(), /4,100/); // check:money-ok
    assert.match(await page.locator('.strategy-summary').textContent(), /15,900/); // check:money-ok
    assert.equal(await page.evaluate(() => Store.get('flows').length), 0);
    assert.equal(await page.evaluate(() => Store.get('todos').length), 2);
    await shot('limited-buy');
    // Choose the actual fund in the plan, not a prerequisite settings page.
    const choices = seed(date);
    choices.settings.funds.push({ code: '444444', name: '合成可选基金', category: '纳指', trade: { status: 'open' } });
    await putSeed(page, choices, 4); await planView();
    await page.locator('.choose-plan-fund').click();
    await dialog().getByRole('button').filter({ hasText: '合成可选基金' }).click(); await closeWait();
    assert.equal(await page.evaluate(() => Config.get().buyFundByCategory['纳指']), '444444');
    assert.equal(await page.evaluate(() => Store.get('flows').length), 0);
    assert.equal(await page.evaluate(() => JSON.stringify(Store.get('snapshots'))), JSON.stringify(choices.snapshots));
    assert.equal(Number((await page.locator('.strategy-amount').textContent()).replace(/[^\d]/g, '')), 20000);
    await page.evaluate(() => Actions.add({ date: Trading.today(), kind: 'buy', code: '444444', amount: 5 }));
    await page.locator('.choose-plan-fund').click();
    assert.match(await dialog().textContent(), /不能中途更换基金/);
    await dialog().getByRole('button', { name: '知道了', exact: true }).click(); await closeWait();
    await putSeed(page, data, 3);
    await tab(page, '设置'); await shot('settings');
    for (const title of ['策略与检查', '目标配置', '现金保留', '基金与限额', '数据与备份']) assert.equal(await page.locator('.settings-menu .menu-row').filter({ hasText: title }).count(), 1);
    await openSection('基金与交易限制');
    await page.locator('.settings-detail .list-row').filter({ hasText: '111111' }).click();
    await shot('limit-editor');
    await editor().getByLabel('每日总限额', { exact: true }).fill('-1');
    await editor().getByRole('button', { name: '保存', exact: true }).click();
    assert.match(await editor().textContent(), /非负/);
    await editor().getByRole('button', { name: '返回', exact: true }).click();
    for (const [status, cap, total] of [['paused', undefined, 4000], ['unknown', undefined, 4000], ['limited', 0, 4000], ['open', undefined, 20000], ['limited', 100, 4100]]) {
      await editFund(status, cap); await planView();
      const actual = await page.locator('.strategy-amount').textContent();
      assert.equal(Number(actual.replace(/[^\d]/g, '')), total);
    }
    // Same-plan execution stays stable and records only actual money, never the budget.
    await page.locator('.equation-card .list-row').filter({ hasText: '建议买 纳指' }).click();
    await dialog().getByRole('button', { name: /^做了 / }).click();
    await dialog().locator('input').fill('50');
    await dialog().getByRole('button', { name: '记下', exact: true }).click(); await closeWait();
    assert.equal(await page.evaluate(() => Store.get('flows')[0].amount), 50);
    assert.equal(await page.evaluate(() => Ledger.latest(Store.get('snapshots')).cash.c), 70000);
    assert.match(await page.locator('.page').textContent(), /本次盘点的同一份计划/);
    await page.locator('.equation-card .list-row').filter({ hasText: '建议买 长债' }).click();
    await dialog().getByRole('button', { name: /^做了 / }).click();
    await dialog().locator('input').fill('4000');
    await dialog().getByRole('button', { name: '记下', exact: true }).click(); await closeWait();
    assert.equal(await page.evaluate(() => Store.get('flows').length), 2);
    // An intervening manual transaction fences the frozen plan.
    await page.evaluate(() => Actions.add({ date: Trading.today(), kind: 'buy', code: '111111', amount: 5 }));
    await planView();
    assert.match(await page.locator('.page').textContent(), /先录入已包含这些交易的真实余额/);
    assert.equal(await page.locator('.page .list-row').count(), 0);
    // Legacy account roles/delays must be ignored, not merely hidden.
    const legacy = seed(date); legacy.settings.cashBuckets = { c: { role: 'buffer', settleDays: 365 } };
    await putSeed(page, legacy, 3); await planView();
    assert.equal(Number((await page.locator('.strategy-amount').textContent()).replace(/[^\d]/g, '')), 4100);
    assert.doesNotMatch(await page.locator('.page').textContent(), /待到账|今天可用/);
    const labeled = seed(date);
    labeled.snapshots[0].cash = { cash: 10000, instant_buffer: 20000, moneymarket: 40000 };
    labeled.settings.cashBuckets = { cash: { role: 'buffer', settleDays: 99 }, instant_buffer: { role: 'buffer', settleDays: 0 }, moneymarket: { role: 'investable', settleDays: 2 } };
    await putSeed(page, labeled, 3); await tab(page, '设置');
    await openSection('现金保护');
    assert.doesNotMatch(await page.locator('.page').textContent(), /现金用途|到账等待|instant_buffer|moneymarket|\bcash\b|日日宝|月月宝/);
    assert.equal(await page.locator('.settings-route').filter({ hasText: /现金账户|日日宝|月月宝/ }).count(), 0);
    assert.equal(await page.evaluate(() => JSON.stringify(Config.get().cashBuckets)), JSON.stringify(labeled.settings.cashBuckets));
    await shot('cash-simplified');
    await tab(page, '现在'); await page.getByRole('button', { name: /录入余额/ }).click();
    while (!await page.getByText('日日宝', { exact: true }).count()) await page.getByRole('button', { name: '下一步', exact: true }).click();
    for (const name of ['现金账户', '日日宝', '月月宝']) await page.getByText(name, { exact: true }).waitFor();
    assert.doesNotMatch(await page.locator('.page').textContent(), /instant_buffer|moneymarket|\bcash\b/);
    assert.equal(await page.evaluate(() => JSON.stringify(Store.get('snapshots'))), JSON.stringify(labeled.snapshots));
    await page.getByRole('button', { name: '稍后继续', exact: true }).click();
    // Metadata is optional in the real form and remains optional after reload/import.
    await putSeed(page, seed(date), 4); await tab(page, '设置');
    await openSection('基金与交易限制');
    await page.locator('.settings-detail .list-row').filter({ hasText: '111111' }).click();
    await editor().getByRole('button', { name: /更多选项/ }).click();
    await editor().getByLabel('购买平台（选填）', { exact: true }).fill('');
    await editor().getByLabel('核实日期（选填）', { exact: true }).fill('');
    await editor().getByLabel('今日其他订单已用额度（选填）', { exact: true }).fill('');
    await editor().getByRole('button', { name: '完成', exact: true }).click(); await saveFund();
    await planView();
    assert.equal(Number((await page.locator('.strategy-amount').textContent()).replace(/[^\d]/g, '')), 4100);
    await tab(page, '设置'); await openSection('基金与交易限制');
    await page.locator('.settings-detail .list-row').filter({ hasText: '111111' }).click();
    await editor().getByRole('button', { name: /更多选项/ }).click();
    await editor().getByLabel('核实日期（选填）', { exact: true }).fill('2000-01-01');
    await editor().getByRole('button', { name: '完成', exact: true }).click(); await saveFund();
    await planView();
    assert.equal(Number((await page.locator('.strategy-amount').textContent()).replace(/[^\d]/g, '')), 4100);
    // Calendar comes from the first snapshot; no date needs to be entered again.
    const halfSeed = seed(date);
    const halfStart = await page.evaluate(d => Strategy.addMonths(d, -6), date);
    halfSeed.snapshots.unshift(Object.assign({}, halfSeed.snapshots[0], { date: halfStart, actionIds: [] }));
    await putSeed(page, halfSeed, 4); await tab(page, '设置');
    await openSection('策略与检查');
    assert.equal(await page.locator('.settings-strategy input[type=date]').count(), 0);
    assert.match(await page.locator('.settings-strategy').textContent(), new RegExp(halfStart));
    await page.getByLabel('半年中途检查', { exact: true }).uncheck();
    assert.equal(await page.evaluate(() => Strategy.schedule(Config.get(), Trading.today()).halfDue), false);
    await page.getByLabel('半年中途检查', { exact: true }).check();
    await tab(page, '现在'); await review('开始半年检查 ›');
    const checked = page.getByRole('button', { name: '本次已检查，不交易', exact: true });
    assert.equal(await checked.isDisabled(), true);
    for (const input of await page.locator('.review-check input').all()) await input.check();
    await shot('half-check'); await checked.click();
    assert.equal(await page.evaluate(() => Strategy.reviews().length), 1);
    assert.equal(await page.evaluate(() => Store.get('flows').length), 0);
    // Annual preview -> cancel -> confirm -> sells only -> actual sell recorded.
    const annual = seed(date); annual.settings.reviewPolicy.startDate = await page.evaluate(d => Strategy.addMonths(d, -12), date);
    annual.snapshots[0].holdings = { '111111': 300000, '222222': 250000, '333333': 400000 };
    annual.snapshots[0].cash.c = 50000;
    await putSeed(page, annual, 3);
    await review('开始年度检查 ›');
    assert.equal(await page.evaluate(() => Store.get('todos').length), 0);
    await shot('annual-preview');
    await page.getByRole('button', { name: '预览确认后，生成卖出计划', exact: true }).click();
    await dialog().getByRole('button', { name: '取消', exact: true }).click(); await closeWait();
    assert.equal(await page.evaluate(() => Store.get('todos').length), 0);
    await page.getByRole('button', { name: '预览确认后，生成卖出计划', exact: true }).click();
    await dialog().getByRole('button', { name: '确认生成卖出计划', exact: true }).click(); await closeWait();
    assert.equal(await page.evaluate(() => Store.get('todos').length), 1);
    assert.equal(await page.evaluate(() => Store.get('todos')[0].kind), 'sell');
    assert.equal(await page.evaluate(() => Store.get('flows').length), 0);
    await shot('annual-approved');
    await page.locator('.list-row').filter({ hasText: '卖 纳指' }).first().click();
    await dialog().getByRole('button', { name: /^做了 / }).click();
    await dialog().locator('input').fill('150000');
    await dialog().getByRole('button', { name: '记下', exact: true }).click(); await closeWait();
    assert.equal(await page.evaluate(() => Store.get('flows').length), 1);
    assert.equal(await page.evaluate(() => Store.get('todos').some(t => t.kind === 'buy')), false);
    // New money still comes first, even on an annual due date.
    const funded = seed(date); funded.settings.reviewPolicy.startDate = await page.evaluate(d => Strategy.addMonths(d, -12), date);
    await putSeed(page, funded, 3); await review('开始年度检查 ›');
    assert.match(await page.locator('.page').textContent(), /先投新钱，暂不卖旧仓/);
    assert.equal(await page.getByRole('button', { name: '预览确认后，生成卖出计划', exact: true }).count(), 0);
    await page.getByRole('button', { name: '检查完成，暂不交易', exact: true }).click();
    await dialog().getByRole('button', { name: '确认检查完成', exact: true }).click(); await closeWait();
    assert.equal(await page.evaluate(() => Store.get('flows').length), 0);
    assert.equal(await page.evaluate(() => Strategy.schedule(Config.get(), Trading.today()).annualDue), false);
    // Layout and true dark-theme hero colors, not just CSS class toggles.
    await putSeed(page, seed(date), 3);
    for (const width of [360, 390, 430, 768]) {
      await page.setViewportSize({ width, height: 844 });
      for (const name of ['现在', '历史', '统计', '设置']) {
        await tab(page, name);
        if (name === '设置') for (const title of ['目标配置', '现金保护', '基金与交易限制', '数据与备份']) { await tab(page, '设置'); await openSection(title); }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('.page').scrollWidth <= innerWidth), 'Overflow at ' + width + ' ' + name);
      }
      await planView();
      assert.ok(await page.evaluate(() => document.querySelector('.page').scrollWidth <= innerWidth));
    }
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    const hero = await page.locator('.strategy-summary').evaluate(n => ({ color: getComputedStyle(n).color, bg: getComputedStyle(n).backgroundImage }));
    assert.notEqual(hero.bg, 'none'); assert.match(hero.bg, /gradient/);
    await shot('dark-buy');
    assert.deepEqual(errors, []); assert.deepEqual(writes, []);
    console.log(JSON.stringify({ browser: engine, status: 'pass', tests: ['settings-edit', 'plan-fund-choice', 'no-mid-plan-switch', 'no-account-cash-controls', 'legacy-cash-rules-ignored', 'chinese-balance-entry', 'optional-fund-metadata', 'four-subscription-states', 'zero-limit', 'actuals-not-budget', 'same-plan-multiple-funds', 'manual-pending-fence', 'automatic-calendar-no-date-input', 'half-check-no-trade', 'annual-confirm-cancel', 'annual-sells-only', 'new-money-first', 'responsive', 'dark-theme'], externalWrites: 0, pageErrors: errors }, null, 2));
  } finally { await context.close(); await browser.close(); if (local) await new Promise(resolve => local.server.close(resolve)); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
