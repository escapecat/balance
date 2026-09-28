"""Optional Playwright check: real clicks, synthetic amounts, isolated browser storage.

Run against a local server or a published app URL. Never uses a user's browser profile.
"""
import argparse
import json
import re

from playwright.sync_api import sync_playwright, expect


def check(browser, url):
    context = browser.new_context(viewport={"width": 390, "height": 844}, timezone_id="Asia/Shanghai")
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(url)
    page.wait_for_function("typeof Store !== 'undefined' && typeof Todos !== 'undefined'")
    dates = page.evaluate("""() => {
      Store.clearAll(); Store.boot();
      const now = new Date();
      const day = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
      const prior = new Date(now); prior.setDate(prior.getDate()-30);
      const before = prior.getFullYear() + '-' + String(prior.getMonth()+1).padStart(2,'0') + '-' + String(prior.getDate()).padStart(2,'0');
      Store.set('settings', {targets:{stock:0.5,bond:0.45},cashTarget:0.05,cashFloor:0,minBuy:100,band:0.05,
        funds:[{code:'A',name:'Synthetic stock',category:'stock',primary:true},{code:'B',name:'Synthetic bond',category:'bond',primary:true}]});
      Actions.startFrom(before);
      Ledger.commit({date:before,holdings:{A:80000,B:80000},cash:{c:40000},external:{}});
      Ledger.commit({date:day,holdings:{A:80000,B:80000},cash:{c:40000},external:{}});
      return {day,before};
    }""")
    page.reload()
    page.get_by_role("button", name="该做什么", exact=False).click()
    page.locator(".list-row").filter(has_text="Synthetic stock").first.click()
    page.get_by_role("button", name=re.compile(r"^做了 ")).click()
    page.locator(".modal-mask:not(.closing) input").fill("20000")
    page.get_by_role("button", name="记下", exact=True).click()
    page.get_by_role("button", name="知道了", exact=True).click()
    expect(page.get_by_text("盘点后已记 1 笔,待下次对账", exact=False)).to_be_visible()
    expect(page.get_by_text("基金申购要 T+1", exact=False)).to_have_count(0)
    checks = page.evaluate("""() => {
      const s=Store.get('snapshots'),d=Ledger.delta(s[1],s[0]);
      return {market:d.market,inflow:d.inflow,pending:Actions.between(s[1],null).length};
    }""")
    assert checks == {"market": 0, "inflow": 0, "pending": 1}, checks

    # Same-day edit: actual EntryUI save dialog must explicitly choose a boundary.
    page.evaluate("""day => {
      Ledger.saveDraft({date:day,holdings:{A:'100000',B:'80000'},cash:{c:'20000'},external:{}});
      EntryUI.mount(document.querySelector('.page'),{onDone:()=>{}});
    }""", dates["day"])
    page.get_by_role("button", name="保存这一期", exact=True).click()
    expect(page.get_by_text("这次余额包含今天盘点后的买卖吗?", exact=True)).to_be_visible()
    page.get_by_role("button", name="只有部分到账,先不保存", exact=False).click()
    assert page.evaluate("Store.get('snapshots')[1].holdings.A") == 80000
    page.get_by_role("button", name="保存这一期", exact=True).click()
    page.locator(".modal-mask:not(.closing)").get_by_role("button", name="已包含全部买卖", exact=False).click()
    page.wait_for_function("Store.get('snapshots')[1].holdings.A === 100000")
    checks = page.evaluate("""() => {
      const s=Store.get('snapshots'),d=Ledger.delta(s[1],s[0]);
      return {count:s.length,market:d.market,inflow:d.inflow,pending:Actions.between(s[1],null).length};
    }""")
    assert checks == {"count": 2, "market": 0, "inflow": 0, "pending": 0}, checks
    page.reload()
    expect(page.get_by_text("待下次对账", exact=False)).to_have_count(0)
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")

    # Reload an old-format installation: migration must happen before rendering.
    page.evaluate("""dates => {
      Store.set('snapshots', [
        {date:dates.before,holdings:{A:80000,B:80000},cash:{c:40000}},
        {date:dates.day,holdings:{A:80000,B:80000},cash:{c:40000}}]);
      Store.set('flows',[{id:'legacy1',date:dates.day,kind:'buy',code:'A',category:'stock',amount:20000,todoId:'buy:A'}]);
      Store.set('todos',[{id:'buy:A',lastSnap:dates.day,doneAt:dates.day,status:'done',actual:20000,target:20000,kind:'buy',code:'A',category:'stock'}]);
      Store.set('__meta',{schema:1});
    }""", dates)
    page.reload()
    expect(page.get_by_text("同日买卖归期已修复", exact=True)).to_be_visible()
    assert page.evaluate("Store.get('__meta').schema") == 2
    assert page.evaluate("Store.getRollback().version") == 1
    assert page.evaluate("Actions.between(Store.get('snapshots')[1],null).length") == 1
    assert page.evaluate("Ledger.delta(Store.get('snapshots')[1],Store.get('snapshots')[0]).market") == 0
    assert not errors, errors
    print(json.dumps({"browser": browser.browser_type.name, "mobile": True, "todo_clicks": "pass",
                      "same_day_confirm": "pass", "no_false_returns": "pass", "page_errors": errors}))
    context.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("--browser", choices=["chromium", "webkit"], default="chromium")
    args = parser.parse_args()
    with sync_playwright() as p:
        browser = getattr(p, args.browser).launch(headless=True)
        try:
            check(browser, args.url)
        finally:
            browser.close()
