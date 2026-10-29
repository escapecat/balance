// Phone UX checks: reachability, sticky return controls, scroll restoration and icon rendering.
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const { playwright, localServer, putSeed, tab } = require('./test-insights-browser.cjs');
const seed = require('./jstest/_seed');
async function main() {
  const args = process.argv.slice(2), remote = args.find(a => /^https?:/.test(a));
  const local = remote ? null : await localServer(), engine = args.includes('--webkit') ? 'webkit' : 'chromium';
  const browser = await playwright()[engine].launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    deviceScaleFactor: 2, timezoneId: 'Asia/Shanghai', serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(12000);
  const out = path.resolve(__dirname, '../artifacts/release-2026-10-30-1'); fs.mkdirSync(out, { recursive: true });
  const shot = name => page.screenshot({ path: path.join(out, engine + '-' + name + '.png'), animations: 'disabled' });
  const back = () => page.locator('.subpage-bar').getByRole('button', { name: '返回', exact: true });
  async function reachable(locator) {
    const r = await locator.boundingBox(), viewport = page.viewportSize();
    assert(r && r.x >= 0 && r.y >= 0 && r.y + r.height <= viewport.height && r.x + r.width <= viewport.width, 'Control outside the phone viewport');
    assert(r.height >= 43.9 && r.width >= 43.9, 'Touch target below 44px: ' + JSON.stringify(r));
  }
  try {
    await page.goto(remote || local.url); await page.waitForFunction(() => typeof Store !== 'undefined');
    const data = seed(); data.__meta.schema = 4; data.flows = [];
    data.snapshots[data.snapshots.length - 1].date = await page.evaluate(() => Trading.today());
    // Many synthetic funds force a long entry page; no real portfolio is used.
    for (let i = 0; i < 16; i++) data.settings.funds.push({ code: String(800000 + i), name: '合成持仓 ' + i, category: '股' });
    await putSeed(page, data, 4);
    const before = await page.evaluate(() => JSON.stringify(Store.exportAll().data));
    for (const width of [320, 360, 390, 430]) {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 740 }); await tab(page, '现在');
      await reachable(page.getByRole('button', { name: /这个月该做什么/ }));
      assert.equal(await page.locator('.tabbar svg').count(), 4);
      for (const button of await page.locator('.tabbar button').all()) await reachable(button);
      assert.ok(await page.locator('.brand-mark').evaluate(n => n.tagName === 'IMG' && n.complete && n.naturalWidth > 0));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.setViewportSize({ width: 390, height: 844 }); await tab(page, '现在'); await shot('home');
    await tab(page, '统计'); await reachable(page.getByRole('button', { name: '查看各类区间盈亏 ›', exact: true })); await shot('stats');
    await page.getByRole('button', { name: '查看各类区间盈亏 ›', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: /返回统计/ }).count(), 0);
    await page.locator('.category-row').first().click();
    assert.ok(await page.locator('.category-row.selected').evaluate(n => n.nextElementSibling.classList.contains('category-detail')));
    await page.locator('.page').evaluate(n => { n.scrollTop = n.scrollHeight; }); await reachable(back()); await shot('category');
    await back().click(); await page.getByRole('heading', { name: '统计', exact: true }).waitFor();
    await tab(page, '历史');
    const card = page.getByRole('button').filter({ hasText: data.snapshots[0].date + ' 盘点' }); await card.scrollIntoViewIfNeeded();
    const listScroll = await page.locator('.page').evaluate(n => n.scrollTop);
    await card.click(); await page.locator('.page').evaluate(n => { n.scrollTop = n.scrollHeight; }); await reachable(back());
    await shot('history-detail'); await back().click();
    assert(Math.abs(await page.locator('.page').evaluate(n => n.scrollTop) - listScroll) < 3, 'History return lost list position');
    await tab(page, '设置'); await page.locator('summary').filter({ hasText: '数据与同步' }).click();
    await page.locator('.list-row').filter({ hasText: '数据与备份' }).click();
    await page.locator('.page').evaluate(n => { n.scrollTop = n.scrollHeight; }); await reachable(back()); await back().click();
    await page.getByRole('heading', { name: '设置', exact: true }).waitFor();
    assert.equal(await page.locator('details[data-section="数据与同步"]').getAttribute('open'), '');
    await tab(page, '现在'); await page.getByRole('button', { name: '录入最新余额', exact: true }).click();
    await reachable(back()); await reachable(page.getByRole('button', { name: '保存这一期', exact: true }));
    const font = await page.locator('input').first().evaluate(n => parseFloat(getComputedStyle(n).fontSize)); assert(font >= 16, 'iOS input text would trigger zoom');
    await shot('entry'); await page.locator('.page').evaluate(n => { n.scrollTop = n.scrollHeight; }); await reachable(back());
    await back().click();
    // Shared close affordance stays accessible even in a long fund form.
    await tab(page, '设置'); await page.locator('summary').filter({ hasText: '基金与交易限制' }).click();
    await page.locator('.settings-section .list-row').filter({ hasText: '合成股票基金' }).click();
    const dialog = page.locator('.modal-mask:not(.closing)');
    await reachable(dialog.getByRole('button', { name: '关闭', exact: true }));
    assert.equal(await dialog.locator('.form-advanced').getAttribute('open'), null);
    assert.equal(await page.locator('input:focus').count(), 0, 'Phone form should not force the keyboard open');
    await shot('fund-form'); await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await page.locator('.modal-mask').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => JSON.stringify(Store.exportAll().data)), before, 'Navigation must not change financial data');
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' }); await tab(page, '现在'); await shot('dark-home');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ browser: engine, status: 'pass', tests: ['phone-320-360-390-430', 'primary-actions-first-screen', '44px-touch-targets', 'svg-navigation', 'brand-asset-loaded', 'sticky-return', 'history-scroll-restored', 'inline-category-detail', 'settings-open-preserved', 'entry-save-visible', 'no-input-auto-zoom', 'optional-fields-collapsed', 'no-forced-keyboard', 'read-only-navigation'], pageErrors: errors }, null, 2));
  } finally { await context.close(); await browser.close(); if (local) await new Promise(resolve => local.server.close(resolve)); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
