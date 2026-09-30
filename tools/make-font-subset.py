#!/usr/bin/env python3
# ============================================================
# make-font-subset.py —— 生成「嘟嘟羽毛球」UI 标题黑体子集
#
# 做什么:
#   1. 扫描 assets/scripts/**/*.ts 里所有字符串字面量,收集 UI 实际会用到的
#      汉字/字母/数字/符号(再叠加一份 ASCII + 常用全角符号兜底动态文案);
#   2. 用 fonttools 的 pyftsubset 把源字体(默认「优设标题黑」,免费商用)
#      裁成只含这些字形的小体积 ttf,写到:
#        assets/resources/fonts/dudu-display.ttf
#   3. 游戏侧 ui-arcade.ts 会 resources.load("fonts/dudu-display") 自动挂给
#      标题/比分大字;文件不存在时静默回退系统字体,不报错。
#
# 用法:
#   python3 tools/make-font-subset.py [--src 优设标题黑.ttf] [--out assets/resources/fonts/dudu-display.ttf]
#   不给 --src 时按常见路径自动找;都没有就尝试从 GitHub 镜像下载。
#
# 依赖:pip3 install fonttools
# 换字体:任何免费商用黑体都行(优设标题黑 / 站酷高端黑 / Alibaba PuHuiTi Heavy),
# 授权见各字体官方说明;本脚本只做子集化,不改授权。
# ============================================================
import argparse
import pathlib
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from typing import Optional

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "assets/resources/fonts/dudu-display.ttf"

# 候选源字体路径(按序探测);GitHub 镜像为 wordshub/free-font 收录的优设标题黑
CANDIDATE_FONTS = [
    ROOT / "tools/YouSheBiaoTiHei.ttf",
    ROOT / "tools/fonts/YouSheBiaoTiHei.ttf",
    ROOT / "design/YouSheBiaoTiHei.ttf",
    pathlib.Path.home() / "Downloads/YouSheBiaoTiHei.ttf",
]
FONT_URL = "https://raw.githubusercontent.com/wordshub/free-font/master/assets/font/中文/优设标题黑/YouSheBiaoTiHei.ttf"

# 动态兜底:数字/字母/常用符号必须全量保留(比分、金币、Lv 等随时拼串)
BASE_CHARS = (
    "0123456789"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "abcdefghijklmnopqrstuvwxyz"
    " .,:;!?%+-*/=()[]<>#@&_'\"~^|\\"
    "·、,。:;!?%+—-*/=()[]<>「」『』《》…★☆✦∞◎✓↑↓"
)


def collect_strings() -> str:
    """抓 scripts 下全部 TS 字符串字面量(模板串含 ${} 的部分原样保留,多收不碍事)"""
    chars: set[str] = set()
    for ts in (ROOT / "assets/scripts").rglob("*.ts"):
        text = ts.read_text(encoding="utf-8", errors="ignore")
        for m in re.finditer(r'"((?:[^"\\\n]|\\.)*)"|\'((?:[^\'\\\n]|\\.)*)\'|`((?:[^`\\]|\\.)*)`', text):
            lit = next((g for g in m.groups() if g is not None), "")
            try:
                lit = lit.encode("utf-8").decode("unicode_escape")
            except UnicodeDecodeError:
                pass
            chars.update(lit)
    return "".join(sorted(chars))


def find_source(arg: Optional[str]) -> Optional[pathlib.Path]:
    if arg:
        p = pathlib.Path(arg).expanduser()
        return p if p.exists() else None
    for p in CANDIDATE_FONTS:
        if p.exists():
            return p
    return None


def download(dst: pathlib.Path) -> bool:
    print(f"未找到本地源字体,尝试下载:{FONT_URL}")
    try:
        urllib.request.urlretrieve(urllib.parse.quote(FONT_URL, safe=":/"), dst)
        print(f"已下载 → {dst}")
        return True
    except Exception as e:  # noqa: BLE001 网络环境各异,失败就交给用户手动放
        print(f"下载失败({e});请手动把优设标题黑 ttf 放到 tools/YouSheBiaoTiHei.ttf 后重跑")
        return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", help="源字体 ttf/otf 路径(默认自动探测/下载)")
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    args = ap.parse_args()

    out = pathlib.Path(args.out)
    src = find_source(args.src)
    if src is None:
        src = DEFAULT_OUT.parent / "YouSheBiaoTiHei.ttf"
        if not download(src):
            return 1
    try:
        from fontTools import subset  # noqa: F401
    except ImportError:
        print("缺少 fonttools:先 pip3 install fonttools")
        return 1

    text = BASE_CHARS + collect_strings()
    uniq = "".join(sorted(set(text) - set("\n\r\t")))
    print(f"收集到 {len(uniq)} 个字符")

    out.parent.mkdir(parents=True, exist_ok=True)
    unicodes = ",".join(f"U+{ord(c):04X}" for c in uniq)
    cmd = [
        sys.executable, "-m", "fontTools.subset", str(src),
        f"--unicodes={unicodes}",
        f"--output-file={out}",
        "--layout-features=*", "--glyph-names", "--notdef-outline",
        "--recalc-bounds", "--recalc-average-width", "--name-IDs=*",
    ]
    subprocess.run(cmd, check=True)
    size_kb = out.stat().st_size / 1024
    print(f"完成:{out}({size_kb:.0f} KB)")
    print("下一步:用 Cocos Creator 打开工程导入该资源(自动生成 .meta),真机即可生效;"
          "未导入/加载失败时游戏自动回退系统字体。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
