#!/usr/bin/env python3
# ============
# App 启动图标生成器
# 动机:AI 生成的源图四周留了大片灰底还带水印,直接缩放会得到「小图标浮在大灰底」的启动器效果。
# 本脚本把源图中的图标方块裁出、四角灰底修复成深色底(受限洪泛,不伤内部金色)、
# 放大为全出血 1024 母版,再轻微辉光增强/暖色提纯/暗角,最后输出:
#   - mipmap-*dpi/ic_launcher.png           传统图标(API<26 或不支持蒙版的启动器)
#   - mipmap-*dpi/ic_launcher_foreground.png 自适应图标前景层(108dp,内容缩入 66dp 安全区)
#   - mipmap-*dpi/ic_launcher_monochrome.png 单色层(Android 13+ 主题图标)
#   - mipmap-anydpi-v26/ic_launcher.xml      自适应图标声明
# 用法: python3 tools/make-app-icons.py
# ============
from __future__ import annotations
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageEnhance

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'tools' / 'app-icon-source.png'
RAW_BACKUP = ROOT / 'tools' / 'app-icon-source-raw.png'
RES = ROOT / 'native' / 'engine' / 'android' / 'res'

MASTER = 1024
# 图标方块底色(源图采样),用于修复圆角外的灰底 / 自适应图标背景层
BG = np.array([22, 25, 28], dtype=np.float32)
BG_HEX = '#16191C'
# 前景层内容占画布比例:确保羽毛球主体落在 66/108 安全区圆内,拖尾允许被蒙版裁切
FG_SCALE = 0.88
# 传统图标与前景/单色层各密度尺寸;前景与单色按 108dp 计算
MIPMAPS = {
    'mdpi': (48, 108),
    'hdpi': (72, 162),
    'xhdpi': (96, 216),
    'xxhdpi': (144, 324),
    'xxxhdpi': (192, 432),
}


def find_icon_bbox(a: np.ndarray) -> tuple[int, int, int, int]:
    """定位深色图标方块的包围盒(灰底亮度 ~75,方块 ~23,阈值取中间)。"""
    lum = a.mean(axis=2)
    ys, xs = np.where(lum < 50)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def repair_gray(img: Image.Image) -> Image.Image:
    """把圆角外残留的灰底替换为方块深色底。

    灰底只在方块四角与外界连通,因此从四角种子做受限洪泛(阈值内且与角连通),
    不会波及方块内部的金色羽毛球与其辉光。
    """
    a = np.array(img, dtype=np.float32)
    lum = a.mean(axis=2)
    cand = lum > 55
    h, w = cand.shape
    region = np.zeros_like(cand)
    for cy, cx in ((0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)):
        if cand[cy, cx]:
            region[cy, cx] = True
    while True:
        grow = region.copy()
        grow[1:, :] |= region[:-1, :]
        grow[:-1, :] |= region[1:, :]
        grow[:, 1:] |= region[:, :-1]
        grow[:, :-1] |= region[:, 1:]
        grow &= cand
        if (grow == region).all():
            break
        region = grow
    print(f'  gray corners repaired: {int(region.sum())} px')
    a[region] = BG
    out = Image.fromarray(a.astype(np.uint8))
    # 仅对修复边缘做一次局部柔化:整体轻微 blur 后按修复区膨胀混合
    ring = Image.fromarray((region * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))
    ring = ring.filter(ImageFilter.GaussianBlur(2))
    soft = out.filter(ImageFilter.GaussianBlur(3))
    return Image.composite(soft, out, ring)


def add_bloom(img: Image.Image) -> Image.Image:
    """提亮金色高光并加一圈柔光,让羽毛球更亮更聚焦。"""
    a = np.array(img, dtype=np.float32)
    lum = a.mean(axis=2)
    bright = np.clip((lum - 120) / 135.0, 0, 1)  # 高光遮罩
    bloom = Image.fromarray((a * bright[..., None]).astype(np.uint8))
    bloom = bloom.filter(ImageFilter.GaussianBlur(18))
    b = np.array(bloom, dtype=np.float32)
    out = np.clip(a + b * 0.55, 0, 255)  # 线性叠加柔光
    return Image.fromarray(out.astype(np.uint8))


def add_vignette(img: Image.Image, strength: float = 0.16) -> Image.Image:
    """轻微暗角,把视线收向中心;贴着画布边缘应用,保证与背景色无缝。"""
    w, h = img.size
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = (w - 1) / 2, (h - 1) / 2
    r = np.sqrt(((xx - cx) / cx) ** 2 + ((yy - cy) / cy) ** 2)
    fall = np.clip(1.0 - strength * np.clip(r - 0.55, 0, None) / 0.45, 0.75, 1.0)
    a = np.array(img, dtype=np.float32) * fall[..., None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def compose(scale: float) -> Image.Image:
    """全流程合成:裁剪→修角→按 scale 居中落到 1024 画布→提色→辉光→暗角。"""
    if not RAW_BACKUP.exists():
        RAW_BACKUP.write_bytes(SRC.read_bytes())  # 保留带水印原图,便于回溯

    src = Image.open(RAW_BACKUP).convert('RGB')
    a = np.array(src)
    x0, y0, x1, y1 = find_icon_bbox(a)
    icon = src.crop((x0, y0, x1, y1))
    icon = repair_gray(icon)

    size = int(MASTER * scale)
    art = icon.resize((size, size), Image.LANCZOS)
    canvas = Image.new('RGB', (MASTER, MASTER), tuple(int(v) for v in BG))
    canvas.paste(art, ((MASTER - size) // 2, (MASTER - size) // 2))

    canvas = ImageEnhance.Color(canvas).enhance(1.10)   # 金色更暖
    canvas = ImageEnhance.Contrast(canvas).enhance(1.04)
    canvas = add_bloom(canvas)
    canvas = add_vignette(canvas)
    return canvas


def monochrome(fg: Image.Image) -> Image.Image:
    """从前景层按亮度提取白色剪影+柔光 alpha,供 Android 13 主题图标着色。"""
    a = np.array(fg.convert('RGB'), dtype=np.float32)
    lum = a.mean(axis=2)
    alpha = np.clip((lum - 35.0) / (130.0 - 35.0), 0.0, 1.0)
    rgba = np.zeros((*lum.shape, 4), dtype=np.uint8)
    rgba[..., :3] = 255
    rgba[..., 3] = (alpha * 255).astype(np.uint8)
    return Image.fromarray(rgba)


def write_xml() -> None:
    anydpi = RES / 'mipmap-anydpi-v26'
    anydpi.mkdir(parents=True, exist_ok=True)
    (anydpi / 'ic_launcher.xml').write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@color/ic_launcher_background"/>\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
        '    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>\n'
        '</adaptive-icon>\n',
        encoding='utf-8')
    values = RES / 'values'
    values.mkdir(parents=True, exist_ok=True)
    (values / 'ic_launcher_background.xml').write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<resources>\n'
        f'    <color name="ic_launcher_background">{BG_HEX}</color>\n'
        '</resources>\n',
        encoding='utf-8')


def main() -> None:
    master = compose(1.0)
    master.save(SRC)
    print(f'master -> {SRC.relative_to(ROOT)} ({MASTER}x{MASTER}, full-bleed)')

    fg = compose(FG_SCALE)

    for dpi, (icon_size, fg_size) in MIPMAPS.items():
        d = RES / f'mipmap-{dpi}'
        d.mkdir(parents=True, exist_ok=True)
        master.resize((icon_size, icon_size), Image.LANCZOS).save(d / 'ic_launcher.png')
        fg.resize((fg_size, fg_size), Image.LANCZOS).save(d / 'ic_launcher_foreground.png')
        mono = monochrome(fg).resize((fg_size, fg_size), Image.LANCZOS)
        mono.save(d / 'ic_launcher_monochrome.png')
        print(f'  mipmap-{dpi}: icon {icon_size}px, fg/mono {fg_size}px')

    write_xml()
    print(f'  {RES.relative_to(ROOT)}/mipmap-anydpi-v26/ic_launcher.xml (adaptive)')
    print(f'  {RES.relative_to(ROOT)}/values/ic_launcher_background.xml ({BG_HEX})')


if __name__ == '__main__':
    main()
