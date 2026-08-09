#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成主屏幕图标。

为什么要有它:「添加到主屏幕」之后,图标就是这个 app 在你手机上的样子。
没有图标的话 iOS 会拿页面截图当图标 —— 一块糊的白底灰字,认不出来是什么。

⚠️ 图标是**生成物**,不是手工二进制。
   仓库里躺着几个来路不明的 png,以后想调个颜色都不知道从哪儿改起。
   这个脚本用 zlib 直接写 PNG,不引任何库(项目零依赖是硬要求)。

用法:python tools/gen_icon.py
"""

import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, '..', 'app')

ACCENT = (0x1d, 0x3f, 0x63)      # 深蓝,和 style.css 的 --accent 一致
# ⚠️ 三根柱子的颜色必须**拉开**。第一版用同一档白,48px 下糊成一个方块 ——
#    图标是在很小的时候被认出来的,对比度比配色协调重要。
BAR_LO = (0x7f, 0x9c, 0xc0)
BAR_MI = (0xbc, 0xd2, 0xe6)
BAR_HI = (0xff, 0xff, 0xff)


def png(path, size, pixels):
    """pixels: 一个 (x, y) -> (r,g,b) 的函数。写成不透明 RGB PNG。"""
    raw = bytearray()
    for y in range(size):
        raw.append(0)                       # 每行的 filter type:0 = None
        for x in range(size):
            raw.extend(pixels(x, y))

    def chunk(tag, data):
        out = struct.pack('>I', len(data)) + tag + data
        return out + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)   # 8bit, truecolor
    blob = (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
            + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(blob)
    return len(blob)


def make(size):
    """三根越来越高的柱子 + 一条底线。够简单才在 48px 下还认得出来。

    ⚠️ 不留圆角、不留透明边:iOS 会自己切圆角,Android 的 maskable
       要求四周有安全边距 —— 所以图形缩在中间 62% 里。

    ⚠️ 全部用**归一化坐标**(0..1)判断,不要混着用像素值。
       第一版底线那行混了 fy 和 y+0.5,于是整块变成白的 ——
       而这种错在 512px 下和 48px 下长得完全不一样,只有真看一眼才发现。
    """
    bars = [(0.22, 0.46, BAR_LO), (0.42, 0.34, BAR_MI), (0.62, 0.20, BAR_HI)]
    bottom = 0.74
    base_h = 0.045

    def px(x, y):
        fx, fy = (x + 0.5) / size, (y + 0.5) / size
        for left, top, color in bars:
            if left <= fx < left + 0.16 and top <= fy < bottom:
                return color
        # 底线,把三根柱子连起来 —— 没有它像三个悬空的方块
        if bottom <= fy < bottom + base_h and 0.20 <= fx <= 0.80:
            return BAR_HI
        return ACCENT

    return px


if __name__ == '__main__':
    for name, size in [('icon-192.png', 192), ('icon-512.png', 512),
                       ('apple-touch-icon.png', 180)]:
        p = os.path.join(APP, name)
        n = png(p, size, make(size))
        print('%-22s %d x %d  %d bytes' % (name, size, size, n))
