#!/usr/bin/env python3
# ============
# 启动画面(splash)无缝性与底色纯度闸门
#
# 断言:
#   1. tools/splash-source.png 存在且为 1024x1024 RGBA
#   2. 四角与四周 120px:alpha 严格为 0 且 rgb 严格等于统一底色(双重保险,
#      杜绝任何方块贴片感与切线 —— 引擎淡入只乘 RGB,不透明底图会整块跟着变暗)
#   3. 统一底色与规范一致: (10, 13, 24 / #0a0d18),且与 splash-config.json 的
#      bgColor、assets/scripts/core/config.ts 的 colors.ink 三方一致
#      (启动 → splash → 游戏首帧全程同色)
#   4. 发光主体居中度误差 < 30px, 主体跨度在 [500, 750] 内
#   5. --selftest: 喂入旧版不透明底图 / 边缘渗色 / 方块线三种坏图必须拦下,
#      合成的标准透明底好图必须放行(防闸门悄悄全绿或误杀)
# ============
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SPLASH_IMG = ROOT / 'tools' / 'splash-source.png'
CONFIG_FILE = ROOT / 'tools' / 'splash-config.json'
GAME_CONFIG_TS = ROOT / 'assets' / 'scripts' / 'core' / 'config.ts'
TARGET_BG = np.array([10, 13, 24], dtype=np.float32)
TARGET_BG_HEX = '#0a0d18'


def check_splash_image(img_path: Path, expect_bg: np.ndarray = TARGET_BG) -> tuple[bool, str]:
    if not img_path.exists():
        return False, f'文件不存在: {img_path}'

    img = Image.open(img_path).convert('RGBA')
    if img.size != (1024, 1024):
        return False, f'尺寸不是 1024x1024: {img.size}'

    arr = np.array(img, dtype=np.float32)
    rgb = arr[:, :, :3]
    alpha = arr[:, :, 3]

    # 1. 四角必须 alpha==0 且 rgb 精确等于目标底色
    corners = [arr[0, 0], arr[0, -1], arr[-1, 0], arr[-1, -1]]
    for c in corners:
        if c[3] != 0:
            return False, f'四角 alpha 不为 0(不透明底图会让淡入全程露出方块): {c}'
        if not np.array_equal(c[:3], expect_bg):
            return False, f'四角底色不符合规范: {c[:3]} != {expect_bg}'

    # 2. 边缘 120px 纯平原区: alpha 绝对为 0 且色差绝对为 0.0
    margin = 120
    diff = np.abs(rgb - expect_bg).max(axis=2)
    edge_alpha = max(
        alpha[:margin, :].max(), alpha[-margin:, :].max(),
        alpha[:, :margin].max(), alpha[:, -margin:].max()
    )
    edge_diff = max(
        diff[:margin, :].max(), diff[-margin:, :].max(),
        diff[:, :margin].max(), diff[:, -margin:].max()
    )
    if edge_alpha > 0.0 or edge_diff > 0.0:
        return False, (
            f'边缘 {margin}px 内不纯净 (max alpha = {edge_alpha}, max diff = {edge_diff}),'
            f'会在淡入期间形成方块切线'
        )

    # 3. 发光主体居中与尺寸检查(色差或 alpha 任一可见即算主体)
    visible = (diff > 2.0) | (alpha > 8.0)
    ys, xs = np.where(visible)
    if len(xs) == 0:
        return False, '画面全空, 未找到发光羽毛球主体'

    w = xs.max() - xs.min() + 1
    h = ys.max() - ys.min() + 1
    span = max(w, h)
    if not (500 <= span <= 750):
        return False, f'发光主体尺寸异常: {w}x{h} (跨度 {span} 不在 [500, 750] 内)'

    cx = (xs.min() + xs.max()) / 2.0
    cy = (ys.min() + ys.max()) / 2.0
    dx = abs(cx - 512.0)
    dy = abs(cy - 512.0)
    if dx > 30.0 or dy > 30.0:
        return False, f'发光主体未居中: 偏离 ({dx:.1f}, {dy:.1f}) px'

    return True, (
        f'✓ 启动图纯净: 底色 {tuple(int(v) for v in expect_bg)}, 边缘 {margin}px '
        f'alpha=0 且零色差, 主体 {w}x{h}px 居中'
    )


def check_color_chain() -> tuple[bool, str]:
    """splash-config.json 的 bgColor 必须等于 config.ts 的 colors.ink。"""
    if not CONFIG_FILE.exists():
        return False, f'缺少配置: {CONFIG_FILE}'
    if not GAME_CONFIG_TS.exists():
        return False, f'缺少游戏配置: {GAME_CONFIG_TS}'

    cfg = json.loads(CONFIG_FILE.read_text(encoding='utf-8'))
    bg_hex = str(cfg.get('config', {}).get('bgColor', '')).strip().lower()
    if not re.fullmatch(r'#[0-9a-f]{6}', bg_hex):
        return False, f'splash-config.json bgColor 非法: {bg_hex!r}'

    ts = GAME_CONFIG_TS.read_text(encoding='utf-8')
    # 锚定 config.ts 的 colors 段再找 ink(全文裸搜会撞上皮肤表里嵌套的 ink 子键)
    sec = re.search(r'\bcolors\s*:\s*\{', ts)
    if not sec:
        return False, 'config.ts 中找不到 colors 段(无法校验底色链)'
    m = re.search(r'\bink:\s*"#([0-9a-fA-F]{6})"', ts[sec.end():sec.end() + 800])
    if not m:
        return False, 'config.ts 的 colors 段中找不到 ink(无法校验底色链)'

    ink_hex = '#' + m.group(1).lower()
    if bg_hex != ink_hex:
        return False, f'底色链断裂: splash bgColor {bg_hex} != config.ts colors.ink {ink_hex}'
    return True, f'✓ 底色链一致: splash bgColor == colors.ink == {ink_hex}'


def run_selftest() -> int:
    print('跑 splash-check 反例自测:')
    tmp_dir = ROOT / '.tools-build'
    tmp_dir.mkdir(parents=True, exist_ok=True)

    def expect_fail(name: str, img: Image.Image) -> bool:
        tmp_path = tmp_dir / f'test_bad_splash_{name}.png'
        img.save(tmp_path)
        passed, msg = check_splash_image(tmp_path)
        tmp_path.unlink(missing_ok=True)
        if passed:
            print(f'  ❌ 自测失败: 未能拦下反例[{name}]')
            return False
        print(f'  ✓ 拦下反例[{name}]: {msg}')
        return True

    ok = True

    # 反例 1: 旧版带方块线的 RGB 图(读回 alpha 全 255,双料违规)
    bad_arr = np.zeros((1024, 1024, 4), dtype=np.float32)
    bad_arr[:, :, :3] = TARGET_BG
    bad_arr[:, :, 3] = 255
    bad_arr[50:974, 50, :3] = [28, 27, 23]
    ok &= expect_fail('方块线', Image.fromarray(bad_arr.astype(np.uint8)))

    # 反例 2: 0.0.28 现场复刻 —— 不透明底图(rgb==底色但 alpha 全 255)
    bad2 = np.zeros((1024, 1024, 4), dtype=np.float32)
    bad2[:, :, :3] = TARGET_BG
    bad2[:, :, 3] = 255
    ok &= expect_fail('不透明底', Image.fromarray(bad2.astype(np.uint8)))

    # 反例 3: 边缘渗色(rgb==底色但边缘 alpha 未归零)
    bad3 = bad2.copy()
    bad3[:, :, 3] = 0
    bad3[200:824, 200:824, 3] = 255
    bad3[:300, :, 3] = 60
    ok &= expect_fail('边缘渗alpha', Image.fromarray(bad3.astype(np.uint8)))

    # 好图: 合成的标准透明底(居中 600px 不透明金块)必须放行
    good = np.zeros((1024, 1024, 4), dtype=np.float32)
    good[:, :, :3] = TARGET_BG
    good[212:812, 212:812, :3] = [200, 160, 60]
    good[212:812, 212:812, 3] = 255
    tmp_path = tmp_dir / 'test_good_splash.png'
    good_img = Image.fromarray(good.astype(np.uint8))
    good_img.save(tmp_path)
    passed, msg = check_splash_image(tmp_path)
    tmp_path.unlink(missing_ok=True)
    if not passed:
        print(f'  ❌ 自测失败: 标准透明底好图被误杀: {msg}')
        ok = False
    else:
        print(f'  ✓ 放行标准透明底好图: {msg}')

    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description='Splash screen seamless check')
    parser.add_argument('--selftest', action='store_true', help='Run negative test cases')
    args = parser.parse_args()

    if args.selftest:
        return run_selftest()

    chain_ok, chain_msg = check_color_chain()
    if not chain_ok:
        print(f'❌ 底色链校验未通过: {chain_msg}', file=sys.stderr)
        return 1
    print(chain_msg)

    passed, msg = check_splash_image(SPLASH_IMG)
    if not passed:
        print(f'❌ 启动图闸门未通过: {msg}', file=sys.stderr)
        return 1

    print(msg)
    return 0


if __name__ == '__main__':
    sys.exit(main())
