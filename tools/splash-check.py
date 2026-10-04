#!/usr/bin/env python3
# ============
# 启动画面(splash)无缝性与底色纯度闸门
#
# 断言:
#   1. tools/splash-source.png 存在且为 1024x1024
#   2. 四角与四周 120px 纯平原区色差绝对为 0.0(杜绝任何方块贴片感与切线)
#   3. 统一背景色与规范一致: (13, 17, 21 / #0d1115)
#   4. 发光主体居中度误差 < 30px, 主体跨度在 [500, 750] 内
#   5. --selftest: 喂入旧版带圆角方块的坏图, 必须被报警拦下
# ============
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SPLASH_IMG = ROOT / 'tools' / 'splash-source.png'
TARGET_BG = np.array([13, 17, 21], dtype=np.float32)


def check_splash_image(img_path: Path, expect_bg: np.ndarray = TARGET_BG) -> tuple[bool, str]:
    if not img_path.exists():
        return False, f'文件不存在: {img_path}'

    img = Image.open(img_path).convert('RGB')
    if img.size != (1024, 1024):
        return False, f'尺寸不是 1024x1024: {img.size}'

    arr = np.array(img, dtype=np.float32)

    # 1. 四角颜色必须精确等于目标底色
    corners = [arr[0, 0], arr[0, -1], arr[-1, 0], arr[-1, -1]]
    for c in corners:
        if not np.array_equal(c, expect_bg):
            return False, f'四角底色不符合规范: {c} != {expect_bg}'

    # 2. 边缘 120px 纯平原区色差必须绝对为 0.0
    diff = np.abs(arr - expect_bg).max(axis=2)
    margin = 120
    edge_diff = max(
        diff[:margin, :].max(), diff[-margin:, :].max(),
        diff[:, :margin].max(), diff[:, -margin:].max()
    )
    if edge_diff > 0.0:
        return False, f'边缘 {margin}px 内存在色差 (max diff = {edge_diff}), 会在手机上形成方块切线'

    # 3. 发光主体居中与尺寸检查
    ys, xs = np.where(diff > 1.0)
    if len(xs) == 0:
        return False, '画面全黑, 未找到发光羽毛球主体'

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

    return True, f'✓ 启动图纯度完美: 底色 {tuple(int(v) for v in expect_bg)}, 边缘 {margin}px 绝对零色差, 主体 {w}x{h}px 居中'


def run_selftest() -> int:
    print('跑 splash-check 反例自测:')
    # 造一个带方块贴片的坏图反例 (模拟修改前的真实情况: 边缘有亮斑/方块)
    bad_arr = np.zeros((1024, 1024, 3), dtype=np.float32)
    bad_arr[:, :] = TARGET_BG
    # 在边缘 50px 处画一条方框线 (模拟方块贴片)
    bad_arr[50:974, 50] = [28, 27, 23]
    bad_img = Image.fromarray(bad_arr.astype(np.uint8))
    tmp_path = ROOT / '.tools-build' / 'test_bad_splash.png'
    tmp_path.parent.mkdir(parents=True, exist_ok=True)
    bad_img.save(tmp_path)

    passed, msg = check_splash_image(tmp_path)
    tmp_path.unlink(missing_ok=True)

    if passed:
        print('  ❌ 自测失败: 未能拦下方块贴片反例')
        return 1
    print(f'  ✓ 成功拦截方块反例: {msg}')
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description='Splash screen seamless check')
    parser.add_argument('--selftest', action='store_true', help='Run negative test cases')
    args = parser.parse_args()

    if args.selftest:
        return run_selftest()

    passed, msg = check_splash_image(SPLASH_IMG)
    if not passed:
        print(f'❌ 启动图闸门未通过: {msg}', file=sys.stderr)
        return 1

    print(msg)
    return 0


if __name__ == '__main__':
    sys.exit(main())
