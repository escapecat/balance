// Isolated browser checks. Fixtures are synthetic; private verification stays in memory.
// node tools/test-insights-browser.cjs [https://.../app/] [--webkit] [--private]
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert/strict');
const cp = require('child_process');
const seed = require('./jstest/_seed.js');
function playwright() {
  if (process.env.BALANCE_PLAYWRIGHT_PATH) return require(process.env.BALANCE_PLAYWRIGHT_PATH);
  for (const name of ['playwright', 'playwright-core']) { try { return require(name); } catch {} }
  const links = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', '.links');
  if (fs.existsSync(links)) for (const file of fs.readdirSync(links)) {
    try { return require(fs.readFileSync(path.join(links, file), 'utf8').trim()); } catch {}
  }
  throw new Error('Set BALANCE_PLAYWRIGHT_PATH to an installed Playwright package.');
}
async function localServer() {
  const root = path.resolve(__dirname, '../app');
  const server = http.createServer((req, res) => {
    const requestPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + requestPath + (requestPath.endsWith('/') ? 'index.html' : ''));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
    fs.readFile(file, (err, body) => {
      res.writeHead(err ? 404 : 200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(err ? '' : body);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: 'http://127.0.0.1:' + server.address().port + '/' };
}
async function putSeed(page, data, version) {
  await page.evaluate(({ data, version }) => {
    Store.clearAll(); Object.keys(data).forEach(k => { if (k !== '__meta') Store.set(k, data[k]); });
    Store.set('__meta', { schema: version });
  }, { data, version });
  await page.reload();
  const migration = page.locator('.modal-mask:not(.closing)');
  if (await migration.count()) {
    assert.match(await migration.locator('.modal-title').textContent(), /升级|修复|已简化|已修正/);
    await migration.getByRole('button', { name: '知道了', exact: true }).click();
    await page.locator('.modal-mask').waitFor({ state: 'detached' });
  }
  await page.getByRole('heading', { name: '现在', exact: true }).waitFor();
}
async function tab(page, name) { await page.locator('.tabbar button').filter({ hasText: name }).click(); }
async function statsPeriod(page, name) {
  await page.locator('.stats-screen > .range-picker').click();
  await page.getByRole('button', { name, exact: true }).click();
}
async function historySearch(page, query, year) {
  await page.locator('.history-filter').click();
  await page.locator('#history-search').fill(query);
  if (year !== undefined) await page.locator('#history-year').selectOption(year);
  await page.getByRole('button', { name: '查看结果', exact: true }).click();
}
async function historySnapshot(page, date) {
  await historySearch(page, date, '');
  await page.getByRole('button').filter({ hasText: date + ' 盘点' }).click();
}
async function entryFinal(page) {
  for (let i = 0; i < 100; i++) {
    const next = page.getByRole('button', { name: '下一步', exact: true });
    if (!await next.count()) return;
    await next.click();
  }
  throw new Error('Entry step did not terminate');
}
async function main() {
  const args = process.argv.slice(2), remote = args.find(a => /^https?:/.test(a));
  let local;
  if (!remote) local = await localServer();
  const url = remote || local.url, pw = playwright(), browserName = args.includes('--webkit') ? 'webkit' : 'chromium';
  let browser, context;
  const errors = [], warnings = [];
  try {
    browser = await pw[browserName].launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 430, height: 1000 }, timezoneId: 'Asia/Shanghai', serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', msg => { if (msg.type() === 'error') warnings.push(msg.text()); });
    await page.goto(url); await page.waitForFunction(() => typeof Store !== 'undefined');
    const data = seed(); await putSeed(page, data, 2);
    const before = await page.evaluate(() => JSON.stringify(Store.exportAll().data));
    const artifacts = path.resolve(__dirname, '../artifacts/release-2026-10');
    fs.mkdirSync(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, browserName + '-now.png') });
    await tab(page, '统计');
    assert.ok((await page.locator('.profit-number').textContent()).includes((5000).toLocaleString('zh-CN')));
    await statsPeriod(page, '本期');
    assert.ok((await page.locator('.profit-number').textContent()).includes((3000).toLocaleString('zh-CN')));
    await statsPeriod(page, '完整记录');
    await page.screenshot({ path: path.join(artifacts, browserName + '-stats.png') });
    await page.getByRole('button', { name: '类别', exact: true }).click();
    await page.locator('.category-row').filter({ hasText: '股' }).click();
    assert.match(await page.locator('.equation-card').textContent(), /期初市值.*期末市值/);
    await page.screenshot({ path: path.join(artifacts, browserName + '-category.png') });
    await tab(page, '历史');
    await historySearch(page, '09-28');
    assert.equal(await page.locator('.history-card').count(), 1);
    await historySearch(page, '', '2026');
    for (const s of data.snapshots) {
      await page.locator('.page').evaluate(n => { n.scrollTop = n.scrollHeight; });
      await historySnapshot(page, s.date);
      await page.getByRole('heading', { name: s.date, exact: true }).waitFor();
      assert.equal(await page.locator('.page').evaluate(n => n.scrollTop), 0);
      await page.getByRole('button', { name: '返回', exact: true }).click();
    }
    await page.screenshot({ path: path.join(artifacts, browserName + '-history.png') });
    await page.getByRole('button', { name: '买卖', exact: true }).click();
    await historySearch(page, '合成股票基金');
    assert.equal(await page.locator('.history-flow').count(), 1);
    assert.equal(await page.evaluate(() => JSON.stringify(Store.exportAll().data)), before, 'Browsing must not change stored ledger');

    for (const width of [360, 390, 430, 768]) {
      await page.setViewportSize({ width, height: 844 });
      for (const name of ['现在', '历史', '统计', '设置']) {
        await tab(page, name);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('.page').scrollWidth <= innerWidth), 'Horizontal overflow: ' + name + ' at ' + width);
      }
    }
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await tab(page, '统计');
    await page.screenshot({ path: path.join(artifacts, browserName + '-dark.png') });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.evaluate(() => Actions.add({ date: '2026-10-29', code: 'A', category: '股', kind: 'buy', amount: 5000 }));
    await tab(page, '现在');
    assert.match(await page.locator('.pending-note').textContent(), /1 笔已记，待下次对账/);
    await page.getByRole('button', { name: /新钱补仓/ }).click();
    assert.match(await page.locator('.page').textContent(), /先录入已包含这些交易的真实余额/);
    assert.equal(await page.locator('.page .list-row').count(), 0, 'Unreconciled manual trades must not generate a fresh executable plan');
    assert.equal(await page.evaluate(() => Store.get('todos', []).length), 0);

    let privateResult = 'not-requested';
    if (args.includes('--private')) {
      const meta = JSON.parse(cp.execFileSync('gh', ['api', 'repos/escapecat/balance-data/contents/data.json'], { encoding: 'utf8' }));
      const backup = JSON.parse(Buffer.from(meta.content, 'base64').toString('utf8'));
      const privateContext = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Shanghai', serviceWorkers: 'block' });
      try {
        const privatePage = await privateContext.newPage();
        privatePage.on('pageerror', e => errors.push(e.message));
        await privatePage.goto(url); await privatePage.waitForFunction(() => typeof Store !== 'undefined');
        await putSeed(privatePage, backup.data, backup.version);
        const original = await privatePage.evaluate(() => JSON.stringify(Store.exportAll().data));
        for (const key of ['snapshots', 'flows', 'assets', 'prefs']) {
          assert.ok(await privatePage.evaluate(({ key, expected }) => JSON.stringify(Store.get(key)) === expected,
            { key, expected: JSON.stringify(backup.data[key]) }), 'Private ledger migration changed ' + key + ' (amounts suppressed)');
        }
        assert.ok(await privatePage.evaluate(expected => {
          const settings = Store.get('settings'), policy = settings.reviewPolicy;
          const raw = JSON.parse(expected);
          if (raw.reviewPolicy && raw.reviewPolicy.startDate === undefined) delete policy.startDate;
          if (!raw.reviewPolicy || raw.reviewPolicy.source === undefined) delete policy.source;
          return JSON.stringify(settings) === expected;
        }, JSON.stringify(backup.data.settings)), 'Private settings changed beyond the automatic calendar fields (amounts suppressed)');
        const calendar = await privatePage.evaluate(() => {
          const snaps = Store.get('snapshots'), sc = Strategy.schedule(Config.get(), Trading.today());
          return { startsAtFirstSnapshot: sc.startDate === Store.firstSnapshotDate(snaps),
            firstAnnualNotStart: Strategy.policy(Config.get()).annualDate === Strategy.addMonths(sc.startDate, 12) };
        });
        assert.ok(Object.values(calendar).every(Boolean), 'Private auto calendar failed');
        // Check real-data layout without logging amounts, capturing images or connecting Sync.
        for (const width of [360, 390, 430]) {
          await privatePage.setViewportSize({ width, height: 740 });
          for (const name of ['现在', '历史', '统计', '设置']) {
            await tab(privatePage, name);
            assert.ok(await privatePage.locator('.page').evaluate(n => n.scrollHeight <= n.clientHeight + 1), 'Private root needs scrolling: ' + name + ' at ' + width + ' (amounts suppressed)');
            if (name === '统计') for (const view of ['概览', '走势', '类别']) {
              await privatePage.getByRole('button', { name: view, exact: true }).click();
              assert.ok(await privatePage.locator('.page').evaluate(n => n.scrollHeight <= n.clientHeight + 1), 'Private stats needs scrolling: ' + view + ' at ' + width + ' (amounts suppressed)');
            }
          }
        }
        for (const s of backup.data.snapshots) {
          await privatePage.evaluate(() => HistoryUI.mount(document.querySelector('.page')));
          await historySnapshot(privatePage, s.date);
          await privatePage.getByRole('heading', { name: s.date, exact: true }).waitFor();
        }
        const integrity = await privatePage.evaluate(() => {
          const ss = Store.get('snapshots'), range = Stats.select(ss, 'all'), sum = Stats.summary(range.covered);
          const con = Stats.contribution(range.covered, Actions.all(), Config.get());
          const last = Ledger.delta(ss[ss.length - 1], ss[ss.length - 2]);
          const pf = Ledger.perFund(ss[ss.length - 1], ss[ss.length - 2]);
          return { categoryMatches: con.ok && Math.abs(con.rows.reduce((a, r) => a + r.market, 0) - sum.market) < 0.01,
            sameStart: con.from === sum.from && con.from === Actions.since(),
            latestMatches: Math.abs(pf.reduce((a, r) => a + r.market, 0) - last.market) < 0.01,
            wealthIdentity: Math.abs(sum.change - sum.inflow - sum.market) < 0.01 };
        });
        assert.ok(Object.values(integrity).every(Boolean), 'Private ledger reconciliation failed (amounts suppressed)');
        assert.ok(await privatePage.evaluate(expected => JSON.stringify(Store.exportAll().data) === expected, original), 'Private balances, flows and settings must stay byte-equivalent (amounts suppressed)');
        privateResult = { snapshotsChecked: backup.data.snapshots.length, flowsChecked: backup.data.flows.length, integrity, changed: false };
        // Never capture screenshots or write a file containing private values.
      } finally { await privateContext.close(); }
    }
    let offlineResult = 'not-supported-by-test-engine';
    if (browserName === 'chromium') {
      const offlineContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
      try {
        const offlinePage = await offlineContext.newPage();
        offlinePage.on('pageerror', e => errors.push(e.message));
        await offlinePage.goto(url); await offlinePage.waitForFunction(() => typeof Store !== 'undefined');
        await putSeed(offlinePage, seed(), 2);
        await offlinePage.evaluate(() => navigator.serviceWorker.ready);
        await offlinePage.waitForFunction(() => !!navigator.serviceWorker.controller);
        await offlinePage.reload(); await offlinePage.getByRole('heading', { name: '现在', exact: true }).waitFor();
        await offlinePage.waitForFunction(async () => {
          const urls = [location.href, ...Array.from(document.scripts).map(s => s.src).filter(Boolean), ...Array.from(document.querySelectorAll('link[rel=stylesheet]')).map(s => s.href)];
          return (await Promise.all(urls.map(u => caches.match(u)))).every(Boolean);
        });
        const original = await offlinePage.evaluate(() => JSON.stringify(Store.exportAll().data));
        await offlineContext.setOffline(true);
        await offlinePage.reload(); await offlinePage.getByRole('heading', { name: '现在', exact: true }).waitFor();
        await tab(offlinePage, '统计'); await offlinePage.locator('.profit-number').waitFor();
        await tab(offlinePage, '历史'); assert.equal(await offlinePage.locator('.history-card').count(), 3);
        await offlinePage.getByRole('button', { name: '下一页', exact: true }).click(); assert.equal(await offlinePage.locator('.history-card').count(), 1);
        assert.equal(await offlinePage.evaluate(() => JSON.stringify(Store.exportAll().data)), original);
        offlineResult = 'pass';
      } finally { await offlineContext.close(); }
    }
    if (args.includes('--boundary')) {
      await new Promise((resolve, reject) => {
        const python = process.env.BALANCE_PYTHON || 'python';
        const child = cp.spawn(python, [path.join(__dirname, 'test-boundary-browser.py'), url, '--browser', browserName], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() : reject(new Error('Existing boundary browser suite failed: ' + output)));
      });
    }
    assert.deepEqual(errors, [], 'Browser page errors');
    assert.equal(warnings.filter(s => /历史显示失败|TypeError|ReferenceError/.test(s)).length, 0);
    console.log(JSON.stringify({ browser: browserName, status: 'pass', widths: [360, 390, 430, 768],
      tests: ['period-selection', 'category-breakdown', 'all-history-details', 'scroll-reset', 'history-search', 'year-filter', 'fund-search', 'read-only-integrity', 'dark-mode', 'pending-plan-guard'],
      privateResult, offlineResult, existingBoundarySuite: args.includes('--boundary') ? 'pass' : 'not-requested', pageErrors: errors }, null, 2));
  } finally {
    if (context) await context.close();
    if (browser) await browser.close();
    if (local) await new Promise(resolve => local.server.close(resolve));
  }
}
module.exports = { playwright, localServer, putSeed, tab, statsPeriod, historySearch, historySnapshot, entryFinal };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
