#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""在局域网上开一个口子,手机连同一个 WiFi 就能打开。

为什么要有它:双击 index.html 只能在电脑上看,而这个 app 有一半的价值
发生在**超市里和灶台前** —— 那时候你手上只有手机。

用法:python tools/serve.py       然后照着打印出来的地址在手机上打开

⚠️ 这不是部署,是「今晚就想用一下」。电脑关了就没了。
   真要随时能用,还是得放到 Pages 上(那边还能装 Service Worker 离线用,
   局域网 http 装不了 —— 见 app/sw.js 开头那段)。
"""

import os
import socket
import sys

# ⚠️ Windows 的控制台默认不是 UTF-8(实测是 cp1252),print 中文直接抛
#    UnicodeEncodeError —— 服务器还没起来就崩了,而报错信息里全是转义码,
#    看着像脚本写错了。这三行必须在任何 print 之前。
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, '..', 'app')
PORT = int(os.environ.get('PORT', '8000'))

try:
    from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
except ImportError:                                   # python 2
    sys.stderr.write('需要 python 3\n')
    sys.exit(1)


def lan_ip():
    """本机在局域网里的地址。

    ⚠️ 不能用 gethostbyname(hostname) —— 多网卡/WSL/虚拟机环境下它经常
       返回 127.0.0.1 或者一个手机根本连不上的虚拟网段地址。
       连一下外网(不真发包)让系统自己选出口网卡,才是手机能到的那个。
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('223.5.5.5', 80))
        return s.getsockname()[0]
    except Exception:
        return '127.0.0.1'
    finally:
        s.close()


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        SimpleHTTPRequestHandler.__init__(self, *a, directory=APP, **kw)

    def end_headers(self):
        # ⚠️ 开发期一律不缓存。不然改了代码刷新没反应,你会去查代码,
        #    而问题在浏览器缓存里 —— 这种时间最不值得花。
        self.send_header('Cache-Control', 'no-store')
        SimpleHTTPRequestHandler.end_headers(self)

    def log_message(self, fmt, *args):
        pass                                          # 安静点,刷屏没用


if __name__ == '__main__':
    ip = lan_ip()
    print('')
    print('  手机上打开(要连同一个 WiFi):')
    print('    http://%s:%d/' % (ip, PORT))
    print('')
    print('  iPhone:Safari 打开 → 分享 → 添加到主屏幕')
    print('  安卓  :浏览器打开 → 菜单 → 添加到主屏幕')
    print('')
    print('  Ctrl-C 停止。电脑关了就没了 —— 想随时能用得放到 Pages 上。')
    print('')
    # ⚠️ 重定向到文件时 stdout 是块缓冲的,不 flush 的话上面这些**一个字都看不到**,
    #    而服务器已经在跑了 —— 表现成「运行了没反应」。
    sys.stdout.flush()
    ThreadingHTTPServer(('0.0.0.0', PORT), H).serve_forever()
