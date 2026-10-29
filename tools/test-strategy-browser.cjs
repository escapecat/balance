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
  const shot = name => page.screenshot({ path: path.join(artifacts, engine + '-' + name + '.png') });
  const dialog = () => page.locator('.modal-mask:not(.closing)');
  const closeWait = () => page.locator('.modal-mask').waitFor({ state: 'detached' });
  const planView = async () => { await tab(page, '现在'); await page.getByRole('button', { name: /这个月该做什么/ }).click(); };
  async function editFund(status, cap) {
    await tab(page, '设置');
    await page.locator('summary').filter({ hasText: '基金与交易限制' }).click();
    await page.locator('.settings-section .list-row').filter({ hasText: '111111' }).click();
    await dialog().getByLabel('申购状态', { exact: true }).selectOption(status);
    if (cap !== undefined) await dialog().getByLabel('每日总限额', { exact: true }).fill(String(cap));
    await dialog().getByRole('button', { name: '保存', exact: true }).click(); await closeWait();
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
    await tab(page, '设置'); await shot('settings');
    for (const title of ['目标配置', '现金保护', '基金与交易限制', '数据与同步']) assert.equal(await page.locator('summary').filter({ hasText: title }).count(), 1);
    await page.locator('summary').filter({ hasText: '基金与交易限制' }).click();
    await page.locator('.settings-section .list-row').filter({ hasText: '111111' }).click();
    await shot('limit-editor');
    await dialog().getByLabel('每日总限额', { exact: true }).fill('-1');
    await dialog().getByRole('button', { name: '保存', exact: true }).click();
    assert.match(await dialog().textContent(), /非负/);
    await dialog().getByRole('button', { name: '取消', exact: true }).click(); await closeWait();
    for (const [status, cap, total] of [['paused', undefined, 4000], ['unknown', undefined, 4000], ['limited', 0, 4000], ['open', undefined, 20000], ['limited', 100, 4100]]) {
      await editFund(status, cap); await planView();
      const actual = await page.locator('.strategy-amount').textContent();
      assert.equal(Number(actual.replace(/[^\d]/g, '')), total);
    }
    // Same-plan execution stays stable and records only actual money, never the budget.
    await page.locator('.equation-card .list-row').filter({ hasText: '今天买 纳指' }).click();
    await dialog().getByRole('button', { name: /^做了 / }).click();
    await dialog().locator('input').fill('50');
    await dialog().getByRole('button', { name: '记下', exact: true }).click(); await closeWait();
    assert.equal(await page.evaluate(() => Store.get('flows')[0].amount), 50);
    assert.equal(await page.evaluate(() => Ledger.latest(Store.get('snapshots')).cash.c), 70000);
    assert.match(await page.locator('.page').textContent(), /本次盘点的同一份计划/);
    await page.locator('.equation-card .list-row').filter({ hasText: '今天买 长债' }).click();
    await dialog().getByRole('button', { name: /^做了 / }).click();
    await dialog().locator('input').fill('4000');
    await dialog().getByRole('button', { name: '记下', exact: true }).click(); await closeWait();
    assert.equal(await page.evaluate(() => Store.get('flows').length), 2);
    // An intervening manual transaction fences the frozen plan.
    await page.evaluate(() => Actions.add({ date: Trading.today(), kind: 'buy', code: '111111', amount: 5 }));
    await planView();
    assert.match(await page.locator('.page').textContent(), /先录入已包含这些交易的真实余额/);
    assert.equal(await page.locator('.page .list-row').count(), 0);
    // Cash settlement is an explicit balance update, not a calendar countdown.
    const wait = seed(date); wait.settings.cashBuckets = { c: { role: 'investable', settleDays: 2 } };
    await putSeed(page, wait, 3); await planView();
    assert.equal(Number((await page.locator('.strategy-amount').textContent()).replace(/[^\d]/g, '')), 0);
    assert.match(await page.locator('.page').textContent(), /赎回并实际到账后更新余额/);
    assert.equal(await page.evaluate(() => Store.get('todos').length), 0);
    await shot('waiting-cash');
    // Set a calendar through actual settings controls; half review does not trade.
    await putSeed(page, seed(date), 3); await tab(page, '设置');
    await page.locator('.settings-strategy .settings-route').click();
    const annualDate = await page.evaluate(d => Strategy.addMonths(d, 6), date);
    await dialog().getByLabel('年度检查锚点日期', { exact: true }).fill(annualDate);
    await dialog().getByRole('button', { name: '保存', exact: true }).click(); await closeWait();
    await tab(page, '现在'); await page.getByRole('button', { name: '开始半年检查 ›', exact: true }).click();
    const checked = page.getByRole('button', { name: '本次已检查，不交易', exact: true });
    assert.equal(await checked.isDisabled(), true);
    for (const input of await page.locator('.review-check input').all()) await input.check();
    await shot('half-check'); await checked.click();
    assert.equal(await page.evaluate(() => Strategy.reviews().length), 1);
    assert.equal(await page.evaluate(() => Store.get('flows').length), 0);
    // Annual preview -> cancel -> confirm -> sells only -> actual sell recorded.
    const annual = seed(date); annual.settings.reviewPolicy.annualDate = date;
    annual.snapshots[0].holdings = { '111111': 300000, '222222': 250000, '333333': 400000 };
    annual.snapshots[0].cash.c = 50000;
    await putSeed(page, annual, 3);
    await page.getByRole('button', { name: '开始年度检查 ›', exact: true }).click();
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
    const funded = seed(date); funded.settings.reviewPolicy.annualDate = date;
    await putSeed(page, funded, 3); await page.getByRole('button', { name: '开始年度检查 ›', exact: true }).click();
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
        if (name === '设置') for (const title of ['目标配置', '现金保护', '基金与交易限制', '数据与同步']) await page.locator('summary').filter({ hasText: title }).click();
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
    console.log(JSON.stringify({ browser: engine, status: 'pass', tests: ['settings-edit', 'four-subscription-states', 'zero-limit', 'actuals-not-budget', 'same-plan-multiple-funds', 'manual-pending-fence', 'settlement', 'calendar-edit', 'half-check-no-trade', 'annual-confirm-cancel', 'annual-sells-only', 'new-money-first', 'responsive', 'dark-theme'], externalWrites: 0, pageErrors: errors }, null, 2));
  } finally { await context.close(); await browser.close(); if (local) await new Promise(resolve => local.server.close(resolve)); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
