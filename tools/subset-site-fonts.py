#!/usr/bin/env python3
# ============================================================
# 介绍站字体子集化 —— 全量 MiSans(两款字重)→ site/dist/fonts/ 的子集。
#
# 为什么要这一步:全量 MiSans 一款 640 KB,两款就是 1.25 MB,而网页正文只用到其中几百个
# 汉字。按页面现用字符集裁到 ~120 KB/款,改了文案重跑一遍即可。
#
# 为什么要两份字源(别把这条删了):
#   site/fonts/MiSans-*.woff2      4630 字,有「勇/协/遁/扮/磨/秩/绍/宣」
#   assets/resources/fonts/dudu-*  1937 字,有「嘟/岚/榻/痣」
#   —— 两个子集互有缺口,而游戏名「嘟嘟羽毛球」的「嘟」只有游戏字体有。
#   两份都是 MiSans(family 名一致),所以按 unicode-range 逐字回退,视觉上无缝。
#   fontTools 的 Merger 不支持 CID-keyed CFF 合并(实测 NotImplementedError),
#   所以走 CSS 多源回退,不做二进制合并。
#
# 用法(仓库根目录):
#   python3 tools/subset-site-fonts.py
# ============================================================
import pathlib
import subprocess
import sys

from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parents[1]
SITE = ROOT / "site" / "dist"

# (输出名, 主字源, 兜底字源) —— 兜底只补主源缺的那几个码位
FONTS = [
    ("display", ROOT / "site" / "fonts" / "MiSans-Heavy.woff2",
     ROOT / "assets" / "resources" / "fonts" / "dudu-display.ttf"),
    ("body", ROOT / "site" / "fonts" / "MiSans-Semibold.woff2",
     ROOT / "assets" / "resources" / "fonts" / "dudu-body.ttf"),
]

# 页面上出现的全部字符 = 手写文案(html/css)+ 运行时渲染文案(app.js/data.js)
PAGES = [SITE / "index.html", SITE / "styles.css", SITE / "app.js", SITE / "data.js"]


def collect() -> set:
    chars = set()
    for p in PAGES:
        if p.exists():
            chars |= set(p.read_text(encoding="utf-8"))
    chars = {c for c in chars if c.isprintable() or c == " "}
    # ASCII 全量 + 常用中文标点兜底:以后加一句文案不必为了一个字重跑
    chars |= {chr(c) for c in range(0x20, 0x7F)}
    chars |= set("　、。〃〈〉《》「」『』【】〔〕〖〗“”‘’—―…·•‰°±×÷→←↑↓★☆◆◇●○■□※◎⊙")
    return chars


def hex_range(cps) -> str:
    """码位集合 → CSS unicode-range 值(合并连续段)"""
    parts, start, prev = [], None, None
    for cp in sorted(cps):
        if start is None:
            start = prev = cp
        elif cp == prev + 1:
            prev = cp
        else:
            parts.append((start, prev))
            start = prev = cp
    if start is not None:
        parts.append((start, prev))
    return ",".join(f"U+{a:X}" if a == b else f"U+{a:X}-{b:X}" for a, b in parts)


def main() -> int:
    chars = collect()
    out_dir = SITE / "fonts"
    out_dir.mkdir(parents=True, exist_ok=True)

    main_txt = pathlib.Path("/tmp/dudu-site-subset.txt")
    main_txt.write_text("".join(sorted(chars)), encoding="utf-8")

    fallback_ranges = {}
    for name, src, fallback in FONTS:
        if not src.exists():
            print(f"✗ 缺字源 {src}", file=sys.stderr)
            return 1

        main_cmap = TTFont(str(src)).getBestCmap()
        fb_cmap = TTFont(str(fallback)).getBestCmap() if fallback.exists() else {}

        # 主源负责它有的字,兜底负责它缺、而兜底有的字
        main_set = {c for c in chars if ord(c) in main_cmap}
        fb_set = {c for c in chars if ord(c) not in main_cmap and ord(c) in fb_cmap}
        lost = sorted({c for c in chars if ord(c) not in main_cmap and ord(c) not in fb_cmap})

        # 只出 woff2:源本身就是 woff2,pyftsubset 会沿用输入 flavor,再写一份 .ttf
        # 实际还是 woff2 字节(白占一倍体积)。woff2 覆盖全部目标浏览器。
        subprocess.run(
            ["pyftsubset", str(src), f"--text-file={main_txt}",
             f"--output-file={out_dir / f'{name}.woff2'}",
             "--flavor=woff2",
             "--layout-features=*", "--name-IDs=*", "--name-legacy", "--name-languages=*",
             "--notdef-glyph", "--notdef-outline", "--recommended-glyphs"],
            check=True,
        )

        if fb_set:
            fb_txt = pathlib.Path(f"/tmp/dudu-site-subset-{name}-fb.txt")
            fb_txt.write_text("".join(sorted(fb_set)), encoding="utf-8")
            fb_out = out_dir / f"{name}-fallback.woff2"
            subprocess.run(
                ["pyftsubset", str(fallback), f"--text-file={fb_txt}", f"--output-file={fb_out}",
                 "--flavor=woff2", "--layout-features=*", "--name-IDs=*", "--name-legacy",
                 "--name-languages=*", "--notdef-glyph", "--notdef-outline"],
                check=True,
            )
            fallback_ranges[name] = hex_range({ord(c) for c in fb_set})
            print(f"  兜底 {name}: {' '.join(sorted(fb_set))}")

        kb = (out_dir / f"{name}.woff2").stat().st_size // 1024
        print(f"✓ {name}.woff2  {kb} KB  ({len(main_set)} 字)")

        if lost:
            print(f"⚠ {name} 两源都缺(会掉回系统字体): {''.join(lost)}", file=sys.stderr)

    # 兜底码位写成一份 CSS 片段:styles.css 的 @font-face 之后引入它,
    # 同名 family + unicode-range ⇒ 浏览器只在那几个码位上换字源,视觉无缝
    css = []
    for name, rng in fallback_ranges.items():
        css.append(
            "@font-face {\n"
            f'  font-family: "Dudu{name.capitalize()}";\n'
            f'  src: url("{name}-fallback.woff2") format("woff2");\n'
            f"  unicode-range: {rng};\n"
            "  font-display: swap;\n"
            "}"
        )
    (out_dir / "fallback.css").write_text("\n".join(css) + "\n", encoding="utf-8")
    print(f"✓ 写 fonts/fallback.css({len(fallback_ranges)} 条 unicode-range)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
