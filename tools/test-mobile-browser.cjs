// Real phone interaction, isolated synthetic ledger, no network writes.
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const { playwright, localServer, putSeed, tab, statsPeriod, historySearch, entryFinal } = require('./test-insights-browser.cjs');
const seed = require('./jstest/_seed');
async function main() {
  const args = process.argv.slice(2), remote = args.find(a => /^https?:/.test(a));
  const local = remote ? null : await localServer(), engine = args.includes('--webkit') ? 'webkit' : 'chromium';
  const browser = await playwright()[engine].launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    deviceScaleFactor: 2, timezoneId: 'Asia/Shanghai', serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(12000);
  page.on('request', r => { if (!['GET', 'HEAD'].includes(r.method())) writes.push(r.url()); });
  const out = path.resolve(__dirname, '../artifacts/release-2026-10-30-2'); fs.mkdirSync(out, { recursive: true });
  const shot = name => page.screenshot({ path: path.join(out, engine + '-' + name + '.png'), animations: 'disabled' });
  const back = () => page.locator('.subpage-bar').getByRole('button', { name: '返回', exact: true });
  async function reachable(locator) {
    const r = await locator.boundingBox(), viewport = page.viewportSize();
    assert(r && r.x >= 0 && r.y >= 0 && r.y + r.height <= viewport.height && r.x + r.width <= viewport.width, 'Control outside the phone viewport');
    assert(r.height >= 43.9 && r.width >= 43.9, 'Touch target below 44px: ' + JSON.stringify(r));
  }
  async function fits(label) {
    const box = await page.locator('.page').evaluate(n => ({ width: n.clientWidth, scrollWidth: n.scrollWidth, height: n.clientHeight, scrollHeight: n.scrollHeight }));
    assert(box.scrollWidth <= box.width + 1, 'Horizontal overflow: ' + label);
    assert(box.scrollHeight <= box.height + 1, 'Root needs scrolling: ' + label + ' ' + JSON.stringify(box));
  }
  try {
    await page.goto(remote || local.url); await page.waitForFunction(() => typeof Store !== 'undefined');
    const data = seed(); data.__meta.schema = 4; data.flows = [];
    const date = await page.evaluate(() => Trading.today()); data.snapshots[data.snapshots.length - 1].date = date;
    data.assets = [{ id: 'outside', name: '合成组合外资产', kind: 'stock' }];
    // Many synthetic funds/categories force pagination; amounts are not from a real account.
    for (let i = 0; i < 16; i++) data.settings.funds.push({ code: String(800000 + i), name: '合成持仓 ' + i, category: '股' });
    for (let i = 0; i < 6; i++) {
      const code = String(900000 + i), category = '合成类别 ' + i;
      data.settings.targets[category] = 0;
      data.settings.funds.push({ code, name: category + '基金', category });
      data.snapshots.forEach((s, j) => { s.holdings[code] = 1000 + j * 10; });
    }
    data.snapshots.forEach(s => { s.external = { outside: 12000 }; });
    await putSeed(page, data, 4);
    const before = await page.evaluate(() => JSON.stringify(Store.exportAll().data));
    for (const width of [320, 360, 390, 430]) {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 740 }); await tab(page, '现在');
      await reachable(page.getByRole('button', { name: /新钱补仓/ }));
      assert.equal(await page.locator('.tabbar svg').count(), 4);
      for (const button of await page.locator('.tabbar button').all()) await reachable(button);
      assert.ok(await page.locator('.brand-mark').evaluate(n => n.tagName === 'IMG' && n.complete && n.naturalWidth > 0));
      for (const name of ['现在', '历史', '统计', '设置']) {
        await tab(page, name);
        assert.ok(await page.locator('.app-top').isVisible(), 'Brand header hidden on root: ' + name);
        if (width >= 360) await fits(name + ' at ' + width);
        if (name === '统计') for (const view of ['概览', '走势', '类别']) {
          await page.getByRole('button', { name: view, exact: true }).click();
          if (width >= 360) await fits('stats ' + view + ' at ' + width);
        }
      }
    }
    await page.setViewportSize({ width: 390, height: 844 }); await tab(page, '现在'); await shot('home');
    await page.getByRole('button', { name: /看当前配置/ }).click();
    assert.equal(await page.locator('.allocation-detail').count(), 4);
    await page.getByRole('button', { name: '下一页', exact: true }).click(); await reachable(back()); await back().click();
    await tab(page, '统计'); await page.getByRole('button', { name: '概览', exact: true }).click(); await shot('stats');
    await page.getByRole('button', { name: '类别', exact: true }).click();
    assert.equal(await page.locator('.category-row').count(), 4);
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    const secondPage = await page.locator('.category-list').textContent();
    await page.locator('.category-row').first().click(); assert.equal(await page.locator('.category-row').count(), 0);
    await page.locator('.page').evaluate(n => { n.scrollTop = n.scrollHeight; }); await reachable(back()); await shot('category');
    await back().click(); assert.equal(await page.locator('.category-list').textContent(), secondPage);
    await statsPeriod(page, '本期'); assert.equal(await page.getByRole('button', { name: '类别', exact: true }).getAttribute('aria-pressed'), 'true');
    await statsPeriod(page, '完整记录');
    await tab(page, '历史'); assert.equal(await page.locator('.history-card').count(), 3); await shot('history');
    await page.getByRole('button', { name: '下一页', exact: true }).click(); assert.equal(await page.locator('.history-card').count(), 1);
    const historyList = await page.locator('#history-results').textContent();
    await page.locator('.history-card').first().click(); await page.locator('.page').evaluate(n => { n.scrollTop = n.scrollHeight; }); await reachable(back());
    await shot('history-detail'); await back().click(); assert.equal(await page.locator('#history-results').textContent(), historyList);
    await page.locator('.history-filter').click(); await page.getByRole('button', { name: '2026-08', exact: true }).click();
    assert.equal(await page.locator('.history-card').count(), 1); await page.locator('.history-card').click(); await back().click();
    assert.match(await page.locator('.history-filter').textContent(), /2026-08/);
    await historySearch(page, '', '2026');
    await tab(page, '设置'); await shot('settings');
    for (const name of ['策略与检查', '目标配置', '现金保留', '基金与限额', '数据与备份']) {
      await page.locator('.settings-menu .menu-row').filter({ hasText: name }).click(); await reachable(back());
      assert.equal(await page.locator('.settings-menu').count(), 0); await back().click();
    }
    await page.getByRole('button', { name: /数据与备份/ }).click(); await fits('data menu'); await shot('data-menu');
    for (const name of ['云端同步', '备份文件', '恢复与回滚', '买卖记录起点', '组合外资产', '版本与显示']) {
      await page.getByRole('button', { name: new RegExp(name) }).click(); await reachable(back());
      await page.getByRole('heading', { name, exact: true }).waitFor();
      if (name !== '组合外资产') assert.equal(await page.getByRole('button', { name: /组合外资产/ }).count(), 0, 'Data sections should not stack on one page');
      if (name === '恢复与回滚') {
        await page.getByRole('button', { name: '退回上一个状态', exact: true }).click();
        await page.locator('.modal-mask:not(.closing)').getByRole('button', { name: '取消', exact: true }).click();
        await page.locator('.modal-mask').waitFor({ state: 'detached' });
      }
      await back().click(); await page.getByRole('heading', { name: '数据与备份', exact: true }).waitFor();
    }
    await back().click();
    await page.getByRole('button', { name: /目标配置/ }).click();
    const targetRows = page.locator('.settings-detail .list-row'); assert.equal(await targetRows.count(), 4);
    await page.getByRole('button', { name: '下一页', exact: true }).click(); const targetPage = await targetRows.allTextContents();
    await back().click(); await page.getByRole('button', { name: /基金与限额/ }).click();
    assert.doesNotMatch(await page.locator('.page').textContent(), /买入通道|补仓落点/);
    assert.equal(await page.locator('.settings-detail .list-row').count(), 4);
    await page.getByRole('button', { name: /已清仓基金/ }).click();
    assert.equal(await page.locator('.settings-detail .list-row').count(), 4);
    await page.getByRole('button', { name: '下一页', exact: true }).click(); const clearedPage = await page.locator('.settings-detail .list-row').allTextContents();
    await page.locator('.settings-detail .list-row').first().click();
    assert.equal(await page.locator('.fund-editor input:focus').count(), 0, 'Phone form should not force the keyboard open');
    assert.equal(await page.getByLabel('购买平台（选填）', { exact: true }).count(), 0);
    await reachable(back()); await shot('fund-form');
    await page.getByLabel('每日总限额', { exact: true }).fill('73');
    await page.getByRole('button', { name: /更多选项/ }).click(); await page.getByLabel('购买平台（选填）', { exact: true }).fill('合成草稿');
    await back().click(); assert.equal(await page.getByLabel('每日总限额', { exact: true }).inputValue(), '73');
    await page.getByRole('button', { name: /更多选项/ }).click(); assert.equal(await page.getByLabel('购买平台（选填）', { exact: true }).inputValue(), '合成草稿');
    await back().click(); await back().click();
    assert.deepEqual(await page.locator('.settings-detail .list-row').allTextContents(), clearedPage, 'Fund cancel lost page');
    assert.ok(targetPage.length);
    await tab(page, '现在'); await page.getByRole('button', { name: /录入余额/ }).click();
    await reachable(back()); await reachable(page.getByRole('button', { name: '下一步', exact: true }));
    assert.ok(await page.locator('input').count() <= 3);
    const first = page.locator('.entry-fields input').first(); await first.fill('123456');
    const originalPlaceholder = await first.getAttribute('placeholder');
    await page.getByRole('button', { name: '下一步', exact: true }).click(); await back().click();
    assert.equal(await page.locator('.entry-fields input').first().inputValue(), '123456');
    assert.equal(await page.locator('.entry-fields input').first().getAttribute('placeholder'), originalPlaceholder);
    const font = await page.locator('input').first().evaluate(n => parseFloat(getComputedStyle(n).fontSize)); assert(font >= 16, 'iOS input text would trigger zoom');
    await shot('entry'); await page.getByRole('button', { name: '稍后继续', exact: true }).click();
    await page.getByRole('button', { name: /录入余额/ }).click(); assert.equal(await page.locator('.entry-fields input').first().inputValue(), '123456');
    await entryFinal(page); await reachable(page.getByRole('button', { name: '保存这一期', exact: true }));
    assert.equal(await page.locator('.entry-actions').count(), 1); await shot('entry-review');
    await page.getByRole('button', { name: '稍后继续', exact: true }).click();
    assert.equal(await page.evaluate(() => JSON.stringify(Store.exportAll().data)), before, 'Navigation/draft/cancel must not change financial data');
    const long = seed(); long.__meta.schema = 4; long.snapshots = []; long.flows = []; long.prefs.actionsSince = '2017-01-01';
    for (let i = 0; i < 120; i++) long.snapshots.push({ date: (2017 + Math.floor(i / 12)) + '-' + String(i % 12 + 1).padStart(2, '0') + '-01', holdings: { A: 100000 + i, B: 50000 }, cash: { c: 50000 }, actionIds: [] });
    await putSeed(page, long, 4); await page.setViewportSize({ width: 360, height: 740 });
    await tab(page, '历史'); await fits('120-month history');
    for (let i = 0; i < 39; i++) await page.getByRole('button', { name: '下一页', exact: true }).click();
    assert.match(await page.locator('#history-results').textContent(), /40 \/ 40/);
    await page.getByRole('button').filter({ hasText: '2017-01-01 盘点' }).click(); await back().click();
    assert.match(await page.locator('#history-results').textContent(), /40 \/ 40/);
    await tab(page, '统计'); await page.getByRole('button', { name: '走势', exact: true }).click(); await statsPeriod(page, '完整记录'); await fits('120-month trend');
    await page.getByRole('button', { name: '更早的盘点', exact: true }).click(); await fits('earlier trend page');
    await page.getByRole('button', { name: '概览', exact: true }).click(); await page.getByRole('button', { name: /每期明细/ }).click();
    assert.equal(await page.locator('.period-cell').count(), 6);
    await page.getByRole('button', { name: '下一页', exact: true }).click(); await back().click();
    await page.getByRole('button', { name: /每期明细/ }).click(); assert.match(await page.locator('.pager').textContent(), /2 \/ 20/);
    await tab(page, '历史'); await page.locator('.history-filter').click();
    assert.equal(await page.locator('.month-grid button').count(), 9);
    await page.getByRole('button', { name: '下一页', exact: true }).click(); assert.match(await page.locator('.pager').textContent(), /2 \/ 14/);
    await back().click();
    // Large type may scroll: controls remain reachable rather than clipped.
    await page.addStyleTag({ content: 'body {font-size:21px} :root {--t-xs:16px; --t-sm:18px; --t-base:21px}' });
    await tab(page, '历史'); await page.locator('.page').evaluate(n => { n.scrollTop = n.scrollHeight; });
    await reachable(page.getByRole('button', { name: '下一页', exact: true }));
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' }); await tab(page, '现在'); await shot('dark-home');
    assert.deepEqual(errors, []); assert.deepEqual(writes, []);
    console.log(JSON.stringify({ browser: engine, status: 'pass', tests: ['phone-320-360-390-430', 'four-roots-one-screen-360+', 'all-stats-views-one-screen', '44px-touch-targets', 'svg-navigation', 'brand-asset-loaded', 'sticky-return', 'category-page-preserved', 'history-page-month-preserved', 'settings-separate-routes', 'targets-funds-pagination', 'fund-draft-preserved-on-subpage', 'entry-three-fields', 'entry-draft-preserved-back-next-cancel', 'final-save-visible', 'no-auto-zoom', 'no-forced-keyboard', 'large-type-scroll-fallback', 'read-only-navigation'], externalWrites: 0, pageErrors: errors }, null, 2));
  } finally { await context.close(); await browser.close(); if (local) await new Promise(resolve => local.server.close(resolve)); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
