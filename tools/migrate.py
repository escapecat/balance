#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把旧 portfolio 的历史搬进 Balance。

用法:
    python tools/migrate.py <旧的 data.db> <旧的 config.yaml> [-o backup.json]

输出一个 backup.json,在 Balance 的设置页「导入备份」。

⚠️ **这个脚本只跑一次,而跑错了当场看不出来** —— 金额都是合理的数字,
   要等几个月后对不上账才发现。所以:
     · 四期总额进回归测试,精确钉死
     · 遇到对不上的东西**停下来问**,不静默处理

⚠️ 净投入(netInflow)老库里没有,**一律留 null,不填 0**。
   填 0 的话「这期涨了这么多」会被当成真的涨跌,而实际上那是你又投进去的钱。
   界面上会显示「涨跌未知」—— 宁可没有,不要假的。
"""

import io
import json
import os
import re
import sqlite3
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass


def load_config(path):
    """只挑我们要的几段。不引 yaml —— 零依赖是这个项目的硬要求。"""
    txt = io.open(path, encoding='utf-8').read()
    cfg = {'targets': {}, 'funds': [], 'locked': []}

    m = re.search(r'asset_targets:(.*?)\n\s*\n', txt, re.S)
    if m:
        for line in m.group(1).strip().split('\n'):
            mm = re.match(r'\s*(\S+):\s*([0-9.]+)', line)
            if mm:
                cfg['targets'][mm.group(1)] = float(mm.group(2))

    for blk in re.finditer(
            r'- code: "(\d+)"\s*\n\s*name: "([^"]+)"\s*\n\s*category: "([^"]+)"'
            r'(?:\s*\n\s*is_primary: (\w+))?'
            r'(?:\s*\n\s*is_active: (\w+))?'
            r'(?:\s*\n\s*daily_limit: (\S+))?'
            r'(?:\s*\n\s*note: "[^"]*")?'
            r'(?:\s*\n\s*status: "(\w+)")?', txt):
        code, name, cat, prim, act, lim, status = blk.groups()
        f = {'code': code, 'name': name, 'category': cat}
        if prim == 'true':
            f['primary'] = True
        if act == 'false':
            f['active'] = False
        if lim and lim not in ('null', 'None'):
            f['dailyLimit'] = int(lim)
        if status:
            f['status'] = status
        cfg['funds'].append(f)

    m = re.search(r'locked_positions:(.*?)(\n#|\n\w)', txt, re.S)
    if m:
        for b in re.finditer(r'fund_code: "(\d+)"\s*\n\s*amount: (\d+)'
                             r'\s*\n\s*unlock_date: "([\d-]+)"', m.group(1)):
            cfg['locked'].append({'fundCode': b.group(1), 'amount': int(b.group(2)),
                                  'unlockDate': b.group(3)})

    m = re.search(r'cash_floor:\s*(\d+)', txt)
    cfg['cashFloor'] = int(m.group(1)) if m else 0
    return cfg


def main(db_path, cfg_path, out_path):
    cfg = load_config(cfg_path)
    known = set(f['code'] for f in cfg['funds'])

    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row

    snaps = []
    for s in con.execute('select id, date from snapshots order by date'):
        holdings = {}
        for h in con.execute(
                'select fund_code, value from snapshot_holdings where snapshot_id=?', (s['id'],)):
            holdings[h['fund_code']] = h['value']
        cash = {}
        row = con.execute('select * from snapshot_cash where snapshot_id=?', (s['id'],)).fetchone()
        if row:
            for k in row.keys():
                if k in ('id', 'snapshot_id'):
                    continue
                if isinstance(row[k], (int, float)):
                    cash[k] = row[k]
        snaps.append({'date': s['date'], 'holdings': holdings, 'cash': cash,
                      'external': {}, 'netInflow': None})   # ⚠️ 老库没有,留 null

    # ⚠️ 悬空引用必须停下来问。静默丢掉的话那笔钱人间蒸发,
    #    静默并进去的话又可能并错 —— 两种都会让账目从此对不上,而你查不出原因。
    decisions = []
    dangling = {}
    for sn in snaps:
        for code, v in sn['holdings'].items():
            if code not in known:
                dangling.setdefault(code, []).append((sn['date'], v))

    for code, hits in dangling.items():
        # ⚠️ **不在这儿问。** 一次性的命令行提问过了就没了,而且迁移是深夜跑的
        #    ——那时候你未必记得三个月前买的是什么。
        #    改成原样留着 + 登记进 unclassified,界面上会一直挂着
        #    「未分类 <代码> ¥<金额> [归到哪一类]」,什么时候想起来什么时候点。
        #    **可修复 > 当场决断**:后者会逼人在信息最少的时候做决定。
        cfg.setdefault('unclassified', []).append(code)
        near = [c for c in known if sorted(c) == sorted(code)]
        print('')
        print('  ⚠️  基金清单里没有 %s,快照里有:' % code)
        for d, v in hits:
            print('        %s   ¥%s' % (d, format(int(v), ',')))
        if near:
            print('      看着像 %s 的笔误(数字一样,顺序不同)。' % near[0])
        print('      先原样留着,界面上会显示成「未分类」—— 到设置页点一下就能归类。')
        decisions.append('%s 留作未分类,待界面上归类' % code)

    # 组合外资产:**只带元数据过来,金额进快照**。
    # 金额和基金持仓走同一条路(snapshot.external),
    # 两处各存一份的话,总有一处没人喂 —— 而不同步的两个数字都会被当真。
    ext = []
    by_date = {s['date']: s for s in snaps}
    orphan_ext = []
    for e in con.execute('select * from external_holdings'):
        d = dict(e)
        code = d.get('code')
        ext.append({'id': code, 'name': d.get('name') or code,
                    'kind': d.get('kind') or 'other'})
        # ⚠️ 字段叫 **value_cny**,不是 value。
        #    第一版读的是 `d.get('value')` —— 取到 None,于是 MSFT 的 23.1 万
        #    静默变成「从来没填过金额」,而界面上还煞有介事地提示你去补。
        #    **这正是迁移最典型的失败方式:不报错,只是少了一笔。**
        #    所以下面用 `or` 兜两种列名,并且**取不到值就喊出来**。
        def val(row):
            for k in ('value_cny', 'value'):
                try:
                    if row[k] is not None:
                        return row[k]
                except (KeyError, IndexError):
                    pass
            return None

        rows = []
        try:
            for h in con.execute(
                    'select * from external_holdings_history where code=? order by date',
                    (code,)):
                rows.append({'date': h['date'], 'value': val(h)})
        except Exception:
            pass
        # 当前值也算一条:旧库把「最新」和「历史」分开存,这里合并
        cur = val(e)
        if cur is not None and snaps:
            rows.append({'date': snaps[-1]['date'], 'value': cur})
        if not rows:
            print('')
            print('  ⚠️  %s 一条金额都没读到 —— 是不是列名又变了?' % code)
            decisions.append('%s 没有任何金额记录' % code)
        for h in rows:
            if h['value'] is None:
                orphan_ext.append('%s %s(值是空的)' % (code, h['date']))
                continue
            snap = by_date.get(h['date'])
            if snap is None:
                # ⚠️ 没有同日快照的,**归到之后最近的那一期** ——
                #    直接丢掉的话那笔钱人间蒸发,而总额少一块你只会以为是市场跌了。
                later = [x for x in snaps if x['date'] >= h['date']]
                if not later:
                    orphan_ext.append('%s %s(比所有快照都晚)' % (code, h['date']))
                    continue
                snap = later[0]
            snap.setdefault('external', {})[code] = h['value']

    # ⚠️ 组合外资产**逐期沿用最后已知值** —— 和录入页「留空 = 沿用上次」一致。
    #    旧库只在你更新估值那天记一笔,不沿用的话就变成
    #    「5 月有 23 万、6 月凭空消失、7 月又没有」——
    #    而总额少一块,你只会以为是市场跌了。
    last_ext = {}
    for sn in snaps:
        cur = dict(last_ext)
        cur.update(sn.get('external') or {})
        sn['external'] = cur
        last_ext = cur

    if orphan_ext:
        print('')
        print('  ⚠️  这几笔组合外金额没有对应日期的快照,没有搬:')
        print('        ' + '、'.join(orphan_ext))
        decisions.append('%d 笔组合外金额因为没有同日快照而未搬入' % len(orphan_ext))

    con.close()

    data = {
        'settings': {
            'targets': cfg['targets'],
            'funds': cfg['funds'],
            'locked': cfg['locked'],
            'cashFloor': cfg['cashFloor'],
            # ⚠️ **不编现金目标。** 旧库根本没有这个概念,
            #    第一版这里硬编码 0.05,而 asset_targets 六类已经和为 100% ——
            #    于是总目标变成 105%,缺口合计永远比钱多 5%,
            #    表现是「现金填不满,还差 10 万」**永远填不满**,
            #    而每一类的数字看着都合理,根本查不到问题在总和上。
            #    没有的东西就是 0,现金靠 cash_floor 那个绝对下限守。
            'cashTarget': 0,
            'band': 0.05,
            'minBuy': 1000,
            'unclassified': cfg.get('unclassified', []),
        },
        'snapshots': snaps,
        'assets': ext,
        'todos': [],
        'flows': [],
        'prefs': {},
    }
    out = {'version': 1, 'exportedAt': None, 'migratedFrom': os.path.basename(db_path),
           'decisions': decisions, 'data': data}
    io.open(out_path, 'w', encoding='utf-8').write(
        json.dumps(out, ensure_ascii=False, indent=1))

    print('')
    print('  写好了:%s' % out_path)
    print('')
    for sn in snaps:
        tot = sum(sn['holdings'].values()) + sum(sn['cash'].values())
        print('    %s   ¥%s' % (sn['date'], format(int(round(tot)), ',')))
    print('')
    print('  ⚠️ 净投入(netInflow)全是 null —— 老库没记。')
    print('     所以这几期的「涨跌」算不出来,界面上会写「未知」。')
    print('     从下一期开始录,收益率就有了。')


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    o = 'backup.json'
    if '-o' in sys.argv:
        o = sys.argv[sys.argv.index('-o') + 1]
    main(sys.argv[1], sys.argv[2], o)
