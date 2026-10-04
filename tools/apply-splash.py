#!/usr/bin/env python3
"""
apply-splash.py — 将自定义启动画面注入 Cocos 构建输出的 settings.json。

用法:
  python3 tools/apply-splash.py [source_image]

默认使用 tools/splash-source.png —— 那张图由 `python3 tools/make-splash.py`
从 app 图标母版派生,改图标后要重新生成,别手动画。
在每次 Cocos 构建后运行此脚本，确保 splash 不被引擎默认值覆盖。
"""

import sys, os, json, base64, io, glob
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("需要 Pillow: pip3 install Pillow")
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SRC = ROOT / "tools" / "splash-source.png"
CONFIG_FILE = ROOT / "tools" / "splash-config.json"
LOGO_PX = 768          # logo 编码边长;1080p 屏上显示约 880px 高,接近 1:1
LOGO_QUALITY = 92      # 再往上(95+)体积翻倍、暗部台阶却几乎没差

# 读取配置
config = {"displayRatio": 4.4, "totalTime": 2000, "autoFit": True}
if CONFIG_FILE.exists():
    with open(CONFIG_FILE) as f:
        saved = json.load(f)
        config.update(saved.get("config", {}))
    if not DEFAULT_SRC.exists():
        alt = ROOT / saved.get("splashSource", "")
        if alt.exists():
            DEFAULT_SRC = alt

src_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SRC
if not src_path.exists():
    print(f"源图不存在: {src_path}")
    sys.exit(1)

# 生成 base64 logo
# 尺寸/质量见上面两个常量。这里必须**保持长宽比**缩放:引擎按图片宽高比反算
# logoWidth/logoHeight,拉成方的会把球压扁。
# 采用无损 PNG 格式保存(消除 JPEG 宏块失真与量化阶跃)。
img = Image.open(src_path).convert("RGB")
img.thumbnail((LOGO_PX, LOGO_PX), Image.LANCZOS)
buf = io.BytesIO()
img.save(buf, "PNG", optimize=True)
b64 = base64.b64encode(buf.getvalue()).decode("ascii")
data_uri = f"data:image/png;base64,{b64}"

# 采样边缘色作为背景 —— 从**编码后的字节**取,确保绝对零色差:
# 底色是整屏平铺的,logo 图边缘与它完全同色,
# 彻底杜绝手机屏幕上的方框贴片与边缘切线。
shown = Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
w, h = shown.size
pad = max(1, min(w, h) // 128)
corners = [shown.getpixel((x, y)) for x, y in
           [(pad, pad), (w - 1 - pad, pad), (pad, h - 1 - pad), (w - 1 - pad, h - 1 - pad)]]
avg = tuple(sum(c[i] for c in corners) / 4 / 255 for i in range(3))

# 注意: background.type 只能是 "custom"(必须带 base64 图片)或其它(用 color 纯色填充)。
# 引擎启动链对 splash 图片加载失败没有任何兜底, Promise 会 reject 且永不恢复 → 游戏永久黑屏。
# 纯色背景绝不能写 type:"custom", 否则引擎拿 undefined 当图片 URL 加载必然失败。
splash = {
    "displayRatio": config["displayRatio"],
    "totalTime": config["totalTime"],
    "logo": {"type": "custom", "base64": data_uri},
    "background": {
        "type": "default",
        "color": {"x": round(avg[0], 6), "y": round(avg[1], 6), "z": round(avg[2], 6), "w": 1.0}
    },
    "watermarkLocation": config.get("watermarkLocation", "default"),
    "autoFit": config["autoFit"],
}

# 注入所有 settings.json
patterns = [
    "build/android/data/src/settings.json",
    "build/web-mobile/src/settings.json",
    "build/android/proj/build/*/intermediates/assets/*/merge*Assets/src/settings.json",
]

updated = 0
for pattern in patterns:
    for path in glob.glob(str(ROOT / pattern)):
        with open(path) as f:
            data = json.load(f)
        data["splashScreen"] = splash
        with open(path, "w") as f:
            json.dump(data, f, ensure_ascii=False)
        updated += 1
        print(f"  ✓ {Path(path).relative_to(ROOT)}")

print(f"\n完成: {updated} 个 settings.json 已注入自定义 splash (logo {len(buf.getvalue())} bytes)")
