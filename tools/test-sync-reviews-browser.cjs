// Isolated phone context. GitHub replies are mocked; no user's credentials or remote writes.
const assert = require('assert/strict');
const { playwright, localServer, putSeed, tab } = require('./test-insights-browser.cjs');
const seed = require('./jstest/_strategyseed');
async function main() {
  const args = process.argv.slice(2), remoteURL = args.find(a => /^https?:/.test(a));
  const local = remoteURL ? null : await localServer(), engine = args.includes('--webkit') ? 'webkit' : 'chromium';
  const browser = await playwright()[engine].launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Asia/Shanghai', serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [], externalWrites = [];
  let cloud, cloudSha = 'fixture1', gets = 0, puts = 0, editDuringPut = false;
  page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(15000);
  page.on('request', r => { if (!['GET', 'HEAD'].includes(r.method()) && !r.url().startsWith('https://api.github.com/repos/fixture/')) externalWrites.push(r.url()); });
  await page.route('https://api.github.com/repos/fixture/**', async route => {
    const request = route.request();
    if (request.method() === 'GET') {
      gets++;
      await route.fulfill({ json: { sha: cloudSha, content: Buffer.from(JSON.stringify(cloud), 'utf8').toString('base64') } });
    } else {
      assert.equal(request.method(), 'PUT'); puts++;
      cloud = JSON.parse(Buffer.from(request.postDataJSON().content, 'base64').toString('utf8')); cloudSha = 'fixture2';
      if (editDuringPut) await page.evaluate(() => Actions.add({ date: Trading.today(), kind: 'buy', code: '111111', amount: 3 }));
      await route.fulfill({ json: { content: { sha: cloudSha } } });
    }
  });
  const dialog = () => page.locator('.modal-mask:not(.closing)');
  const closeWait = () => page.locator('.modal-mask').waitFor({ state: 'detached' });
  const plan = async () => { await tab(page, '现在'); await page.getByRole('button', { name: /新钱补仓/ }).click(); };
  const syncPage = async () => {
    await tab(page, '设置'); await page.getByRole('button', { name: /数据与备份/ }).click();
    await page.getByRole('button', { name: /云端同步/ }).click();
  };
  try {
    await page.goto(remoteURL || local.url); await page.waitForFunction(() => typeof Sync !== 'undefined');
    const date = await page.evaluate(() => Trading.today()), initial = seed(date); initial.__meta.schema = 5;
    initial.settings.reviewPolicy.startDate = date;
    await putSeed(page, initial, 5); await plan();
    cloud = await page.evaluate(() => Store.exportAll());
    await page.evaluate(() => Sync.saveCfg({ owner: 'fixture', repo: 'private-fixture', token: 'test', sha: 'fixture1', dirty: false }));
    const baseline = await page.evaluate(() => JSON.stringify(Store.exportAll().data));
    for (let i = 0; i < 3; i++) { await plan(); assert.equal(await page.evaluate(() => Sync.cfg().dirty), false); }
    await tab(page, '设置'); await page.getByRole('button', { name: /现金保留/ }).click();
    await page.locator('.list-row').filter({ hasText: '日常补仓门槛' }).click();
    await dialog().getByRole('button', { name: '记下', exact: true }).click(); await closeWait();
    assert.equal(await page.evaluate(() => Sync.cfg().dirty), false);
    await tab(page, '设置'); await page.getByRole('button', { name: /基金与限额/ }).click();
    await page.locator('.settings-detail .list-row').filter({ hasText: '111111' }).click();
    await page.getByRole('button', { name: '保存', exact: true }).click(); await page.locator('.fund-editor').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => Sync.cfg().dirty), false);
    assert.equal(await page.evaluate(() => JSON.stringify(Store.exportAll().data)), baseline);
    await page.evaluate(() => Sync.markDirty()); const priorGets = gets;
    await page.reload(); await page.waitForFunction(() => Sync.cfg().dirty === false);
    assert(gets > priorGets); assert.equal(puts, 0);
    assert.doesNotMatch(await page.locator('.now-overview').textContent(), /有改动未推云端/);
    assert.equal(await page.evaluate(() => JSON.stringify(Store.exportAll().data)), baseline);
    await syncPage(); await page.getByRole('button', { name: '推到云端', exact: true }).click();
    await dialog().getByText('已是最新', { exact: true }).waitFor();
    assert.equal(puts, 0); await dialog().getByRole('button', { name: '知道了', exact: true }).click(); await closeWait();
    await page.evaluate(() => Config.save({ minBuy: 1100 })); editDuringPut = true;
    await syncPage(); await page.getByRole('button', { name: '推到云端(有改动)', exact: true }).click();
    await dialog().getByText('推上去了', { exact: true }).waitFor();
    assert.match(await dialog().textContent(), /另有本机改动/);
    assert.equal(await page.evaluate(() => Sync.cfg().dirty), true); assert.equal(puts, 1);
    assert.equal(cloud.data.flows.length, 0); assert.equal(await page.evaluate(() => Store.get('flows').length), 1);
    await dialog().getByRole('button', { name: '知道了', exact: true }).click(); await closeWait();
    for (const kind of ['half', 'annual']) {
      const fixture = seed(date); fixture.__meta.schema = 5;
      fixture.settings.reviewPolicy.startDate = await page.evaluate(({ date, months }) => Strategy.addMonths(date, months), { date, months: kind === 'half' ? -6 : -12 });
      fixture.snapshots[0].date = await page.evaluate(date => Strategy.addMonths(date, -2), date);
      fixture.flows = [{ id: 'monthly-buy', date, kind: 'buy', code: '111111', category: '纳指', amount: 10, afterSnapshot: fixture.snapshots[0].date }];
      await putSeed(page, fixture, 5);
      const books = await page.evaluate(() => JSON.stringify([Store.get('snapshots'), Store.get('flows'), Store.get('todos'), Store.get('settings')]));
      await page.getByRole('button', { name: /年度检查待处理|半年检查待处理/ }).click();
      await page.getByRole('button', { name: kind === 'half' ? '开始半年检查 ›' : '开始年度检查 ›', exact: true }).click();
      assert.match(await page.locator('.review-reference').textContent(), /不用再抄一次余额/);
      assert.equal(await page.locator('.entry-step').count(), 0);
      if (kind === 'half') {
        for (const checkbox of await page.locator('.review-check input').all()) await checkbox.check();
        await page.getByRole('button', { name: '本次已检查，不交易', exact: true }).click();
      } else {
        assert.equal(await page.getByRole('button', { name: '预览确认后，生成卖出计划', exact: true }).count(), 0);
        await page.getByRole('button', { name: '检查完成，暂不交易', exact: true }).click();
        await dialog().getByRole('button', { name: '确认检查完成', exact: true }).click(); await closeWait();
      }
      await page.getByRole('heading', { name: '现在', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => Strategy.reviews().length), 1);
      assert.equal(await page.evaluate(() => JSON.stringify([Store.get('snapshots'), Store.get('flows'), Store.get('todos'), Store.get('settings')])), books);
      assert.equal(await page.evaluate(() => Strategy.pending(Ledger.latest(Store.get('snapshots'))).length), 1);
      assert.equal(await page.evaluate(() => Sync.cfg().dirty), true, 'An actual saved check must still be syncable');
    }
    assert.deepEqual(errors, []); assert.deepEqual(externalWrites, []);
    console.log(JSON.stringify({ browser: engine, status: 'pass', tests: ['reopen-same-plan-clean', 'unchanged-settings-clean', 'unchanged-fund-form-clean', 'repair-old-dirty-with-get-only', 'same-push-no-commit', 'push-during-edit-retains-dirty', 'half-stale-pending-no-second-entry', 'annual-stale-pending-no-second-entry', 'check-is-not-settlement', 'real-review-stays-dirty'], mockedPuts: puts, externalWrites: 0, pageErrors: errors }, null, 2));
  } finally { await context.close(); await browser.close(); if (local) await new Promise(resolve => local.server.close(resolve)); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
