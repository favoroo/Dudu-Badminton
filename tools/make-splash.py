#!/usr/bin/env python3
# ============
# 启动画面(splash)源图生成器 —— 从 app 图标母版派生,不再另画一张。
#
# 动机:splash 与桌面图标原本是两条独立素材线。图标是 make-app-icons.py 那套
# 「扁平金色羽毛球 + #16191C 深底」,而 splash 用的是另一张 AI 生成的写实球
# (四周大片暗蓝渐变、右下角还带「AI 生成」水印),两者放一起完全不像同一个应用。
# 本脚本直接把图标母版转成 splash 源图,启动画面与应用图标从此同一张画。
#
# 为什么不能「直接把 app-icon-source.png 当 splash 用」——引擎侧的三条硬约束
# (对着 build/web-mobile/cocos-js 里的 splash 实现算过):
#   1. logo 的显示高度 = 0.185 × 屏高 × displayRatio,与图片像素尺寸无关。
#      旧配置 displayRatio=0.8 → 整张图只占屏高 14.8%,里面的球实际不到 8% 屏高,
#      1080p 手机上约 90px —— 这就是「启动 logo 又小又没人看见」的根因。
#      现在按「球占屏高 ~45%」反推 displayRatio(写进 splash-config.json)。
#   2. logo 中心固定在屏高 58.3%(logoYTrans = 1/6+2.5/6),不是正中心。偏上本来就是
#      光学中心,美术层不抵消。
#   3. 整屏底色由 background.color 平铺,而 apply-splash.py 是**取 logo 图四角均色**
#      当底色。图标母版的辉光被画布边界硬裁过:四角是 14,但边中点亮到 41 ——
#      直接拿去用,屏幕上会出现一圈「亮边方块」,一眼就是贴图糊了张图。
#      所以这里做一次 fade-to-bg:把最外圈 BAND 像素平滑压回母版角色,
#      图边缘与全屏底色严格同色 → 无缝,看起来像球浮在整片黑里。
#      带宽 140px 是量出来的:球体(羽尖/球头)离画布边最近 150px,一圈压不到主体。
#
# 用法: python3 tools/make-splash.py        # → tools/splash-source.png
#       改过图标母版(make-app-icons.py)后重跑一次,再跑 apply-splash.py 注入构建。
# ============
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MASTER = ROOT / 'tools' / 'app-icon-source.png'      # make-app-icons.py 的 1024 全出血母版
OUT = ROOT / 'tools' / 'splash-source.png'
SIZE = 1024
BAND = 140                                            # 最外圈压回底色的带宽(px)


def corner_bg(a: np.ndarray) -> np.ndarray:
    """取四角均色作为画布底色 —— 必须与 apply-splash.py 采样的口径一致。"""
    n = 6
    pts = np.concatenate([
        a[:n, :n].reshape(-1, 3), a[:n, -n:].reshape(-1, 3),
        a[-n:, :n].reshape(-1, 3), a[-n:, -n:].reshape(-1, 3),
    ], axis=0)
    return pts.mean(axis=0)


def border_mask(shape: tuple[int, ...], band: int) -> np.ndarray:
    """1 = 原样保留,0 = 完全压成底色;最外 band 像素内 smoothstep 收敛到 0。"""
    h, w = shape[:2]
    dy = np.minimum(np.arange(h), h - 1 - np.arange(h)).astype(np.float32)
    dx = np.minimum(np.arange(w), w - 1 - np.arange(w)).astype(np.float32)
    d = np.minimum(dy[:, None], dx[None, :])
    m = np.clip(d / float(band), 0.0, 1.0)
    return m * m * (3.0 - 2.0 * m)                    # smoothstep,避免一圈硬折线


def main() -> int:
    if not MASTER.exists():
        print(f'缺少图标母版: {MASTER.relative_to(ROOT)}\n先跑 python3 tools/make-app-icons.py')
        return 1

    src = Image.open(MASTER).convert('RGB')
    if src.size != (SIZE, SIZE):
        src = src.resize((SIZE, SIZE), Image.LANCZOS)

    a = np.array(src, dtype=np.float32)
    bg = corner_bg(a)
    out = bg + (a - bg) * border_mask(a.shape, BAND)[..., None]
    img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
    img.save(OUT, optimize=True)

    edge = np.array(img, dtype=np.int16)
    rim = np.concatenate([edge[0, :, 0], edge[-1, :, 0], edge[:, 0, 0], edge[:, -1, 0]])
    lum = np.array(img, dtype=np.float32).mean(axis=2)
    ys, xs = np.where(lum > 90)
    print(f'  ✓ {OUT.relative_to(ROOT)} ({SIZE}x{SIZE})')
    print(f'  底色 {tuple(int(round(v)) for v in bg)} | 最外圈亮度 {rim.min()}~{rim.max()} (压平前母版到 41)')
    print(f'  主体占图 {round((xs.max()-xs.min()+1)/SIZE, 2)} x {round((ys.max()-ys.min()+1)/SIZE, 2)}')
    print('  displayRatio 见 tools/splash-config.json(改完记得跑 apply-splash.py 注入构建)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
