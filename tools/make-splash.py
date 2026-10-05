#!/usr/bin/env python3
# ============
# 启动画面(splash)源图生成器 —— 纯净发光羽毛球,彻底消除方块贴片与圆角轮廓。
#
# 动机与历史痛点修复:
#   1. 旧版启动画面直接使用桌面 App 图标(Squircle 圆角方块),导致游戏启动时屏幕正中央
#      突兀地贴着一个带有圆角边框、微弱阴影和方块切线的小卡片,一眼就是贴图。
#   2. 旧版图内部底色(约 #1c1b17)与全屏背景底色(约 #0d1114)存在近 2 倍亮度差,
#      进入游戏时「方块底色」和「全屏底色」黑白分明。
#   3. 以前的最外圈 border_mask 仅仅处理最外 140px,但在 1024 缩小到屏幕小尺寸时,
#      原图标 586x586 的圆角外框和亮暗色阶被完整保留在正中间。
#
# 本脚本解决方案:
#   1. 从母版直接提取羽毛球发光主体(球头、网线、折纸羽翼、三道动感速度拖尾),
#      完全剔除桌面图标的圆角矩形外框与灰底残余。
#   2. 顺应羽毛球与速度流线外形构建多尺度羽化光晕场(Multi-tier Streamlined Glow),
#      让金色辉光以自然光滑曲线平滑消散,并在距离边缘前 100% 衰减为完全透明。
#   3. 输出 1024x1024 高分辨率 RGBA PNG,四周至少 180px 绝对纯净:
#      - Alpha 通道严格为 0(完全透明);
#      - RGB 通道严格等于统一背景色 TARGET_BG(10, 13, 24 / #0a0d18);
#      双重绝对保险:无论引擎是否开启 Alpha 混合,屏幕上都只有金色羽毛球悬浮发光,
#      绝对没有任何方框、切边或色差!
#
#   4. 为什么必须是真透明(0.0.29 现场):引擎 util/splash-screen 特效的淡入是
#      `color.xyz *= percent` 且 alpha 不变 —— 不透明底图的整个方块会跟着一起被乘暗,
#      而整屏 clearColor 不淡入,于是 2 秒淡入期间方块边界始终可见(实测暗 ~22%)。
#      只有把非主体区域做成 alpha=0,混合结果才在任何 percent 下恒等于整屏底色。
#
# 用法: python3 tools/make-splash.py        # → tools/splash-source.png
#       生成后联动运行 python3 tools/apply-splash.py 注入各端构建。
# ============
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
RAW_MASTER = ROOT / 'tools' / 'app-icon-source-raw.png'
ICON_MASTER = ROOT / 'tools' / 'app-icon-source.png'
OUT = ROOT / 'tools' / 'splash-source.png'

SIZE = 1024
# 统一标准背景底色: 深邃蓝黑 #0a0d18 —— 必须与游戏首帧相机清屏色一致
# (assets/scenes/main.scene 相机 _color 与 config.ts colors.ink),splash-check.py 会对照校验。
TARGET_BG = np.array([10, 13, 24], dtype=np.float32)
TARGET_BG_HEX = '#0a0d18'

# 原桌面图标内部深色底基准 (用于消除原图底色差)
RAW_BG = np.array([21.0, 25.0, 29.0], dtype=np.float32)


def extract_shuttle_artwork(raw_img: Image.Image) -> tuple[np.ndarray, np.ndarray]:
    """从母版中提取羽毛球主体与流线羽化遮罩。

    返回 (rgb, mask):
      rgb   — 满能量发光色(TARGET_BG + 置换差),供引擎 straight-alpha 混合用:
              out = rgb*alpha*percent + 屏底*(1-alpha),屏底==TARGET_BG 时
              恰好还原 TARGET_BG + diff*mask 的传统合成结果。
      mask  — 羽化遮罩,直接作为 PNG 的 alpha 通道。
    """
    w_raw, h_raw = raw_img.size
    if w_raw == 1024 and h_raw == 1024:
        # 裁剪出包含图标的主体区域 (219, 219, 805, 805)
        icon = np.array(raw_img.crop((219, 219, 805, 805)), dtype=np.float32)
    else:
        icon = np.array(raw_img, dtype=np.float32)

    h, w, _ = icon.shape

    # 1. 精确提取发光体(实体金色羽毛球 + 动感速度拖尾)
    r, g, b = icon[:, :, 0], icon[:, :, 1], icon[:, :, 2]
    core = (r > 60) & (g > 50) & (r > b + 15)
    trail = (r > 32) & (r > b + 4) & (g >= b) & (r > 28)
    emitter = (core | trail).astype(np.float32)

    # 强制抹除可能触及 585 方块边缘的区域(至少保留 45px 安全留白,防止裁切原图圆角)
    emitter[:45, :] = 0
    emitter[-45:, :] = 0
    emitter[:, :45] = 0
    emitter[:, -45:] = 0

    # 2. 多尺度形态学与高斯羽化,顺应羽毛球外形生成流线型辉光场
    emitter_img = Image.fromarray((emitter * 255).astype(np.uint8))
    core_dilated = emitter_img.filter(ImageFilter.MaxFilter(25))
    glow_mask_img = core_dilated.filter(ImageFilter.GaussianBlur(18))
    glow_mask = np.array(glow_mask_img, dtype=np.float32) / 255.0

    # Smoothstep 自然衰减,外围微弱值归零
    mask = np.clip((glow_mask - 0.03) / 0.85, 0.0, 1.0)
    mask = mask * mask * (3.0 - 2.0 * mask)

    # 3. 颜色置换与基底平移: 满能量前景色 + 底色基底
    #    rgb 里携带的是「满能量」色(TARGET_BG + diff),亮度由 alpha 通道负责,
    #    引擎按 straight-alpha 混合后与旧版「diff*mask 直接画在底色上」逐像素等价。
    #    lift 窄带(0→0.06)把远场噪声收回纯底色,兼顾 PNG 体积与边缘绝对纯净。
    diff = icon - RAW_BG
    lift = np.clip(mask / 0.06, 0.0, 1.0)
    lift = lift * lift * (3.0 - 2.0 * lift)
    energy = TARGET_BG + diff * lift[..., None]
    energy = np.clip(energy, 0, 255)

    return energy, mask


def main() -> int:
    src_file = RAW_MASTER if RAW_MASTER.exists() else ICON_MASTER
    if not src_file.exists():
        print(f'缺少源图素材: {src_file.relative_to(ROOT)}')
        return 1

    src = Image.open(src_file).convert('RGB')
    sub_art, sub_mask = extract_shuttle_artwork(src)

    # 找到发光体的有效包围盒
    ys, xs = np.where(sub_mask > 0.001)
    if len(xs) == 0:
        print('错误: 未能识别到有效的羽毛球发光区域')
        return 1

    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())

    cropped_art = sub_art[y0:y1 + 1, x0:x1 + 1]
    cropped_mask = sub_mask[y0:y1 + 1, x0:x1 + 1]

    # 将发光主体按比例缩放到 1024 画布 (主体宽/高跨度约 640px,四周留有约 190px 绝对平原)
    target_span = 640
    src_span = max(x1 - x0, y1 - y0)
    scale = target_span / float(src_span)
    new_w = int(round((x1 - x0 + 1) * scale))
    new_h = int(round((y1 - y0 + 1) * scale))

    art_img = Image.fromarray(cropped_art.astype(np.uint8)).resize((new_w, new_h), Image.LANCZOS)
    mask_img = Image.fromarray((cropped_mask * 255).astype(np.uint8)).resize((new_w, new_h), Image.LANCZOS)

    canvas_rgb = np.zeros((SIZE, SIZE, 3), dtype=np.float32)
    canvas_rgb[:, :] = TARGET_BG

    canvas_alpha = np.zeros((SIZE, SIZE), dtype=np.float32)

    off_x = (SIZE - new_w) // 2
    off_y = (SIZE - new_h) // 2

    canvas_rgb[off_y:off_y + new_h, off_x:off_x + new_w] = np.array(art_img, dtype=np.float32)
    canvas_alpha[off_y:off_y + new_h, off_x:off_x + new_w] = np.array(mask_img, dtype=np.float32)

    # 保存为高质量无损 RGBA PNG (避免 JPEG 宏块伪影;非主体区域 alpha=0,淡入不产生方块)
    out_img = Image.fromarray(
        np.dstack([
            np.clip(canvas_rgb, 0, 255),
            np.clip(canvas_alpha, 0, 255),
        ]).astype(np.uint8),
    )
    out_img.save(OUT, optimize=True)

    # 严苛自检断言: 边缘 120px 必须 alpha==0 且 rgb==TARGET_BG 双重纯净
    arr_out = np.array(out_img, dtype=np.float32)
    rgb_diff = np.abs(arr_out[:, :, :3] - TARGET_BG).max(axis=2)
    alpha_band = arr_out[:, :, 3]

    m = 120
    edge_rgb = max(
        rgb_diff[:m, :].max(), rgb_diff[-m:, :].max(),
        rgb_diff[:, :m].max(), rgb_diff[:, -m:].max()
    )
    edge_a = max(
        alpha_band[:m, :].max(), alpha_band[-m:, :].max(),
        alpha_band[:, :m].max(), alpha_band[:, -m:].max()
    )

    if edge_rgb > 0.0 or edge_a > 0.0:
        print(f'❌ 纯度自检失败: 边缘存在色差或非透明 (rgb diff={edge_rgb}, alpha={edge_a})')
        return 1

    print(f'  ✓ {OUT.relative_to(ROOT)} ({SIZE}x{SIZE} RGBA PNG)')
    print(f'  统一背景色: {tuple(int(v) for v in TARGET_BG)} ({TARGET_BG_HEX}) | 边缘 {m}px alpha=0 且色差 0.0')
    print(f'  主体缩放跨度: {new_w}x{new_h}px (画布占比 ~{round(target_span/SIZE, 2)}), 四周透明留白: {min(off_x, off_y)}px')
    print('  ✓ 纯净发光羽毛球已生成,透明底保证淡入全程无方块贴片')
    return 0


if __name__ == '__main__':
    sys.exit(main())
