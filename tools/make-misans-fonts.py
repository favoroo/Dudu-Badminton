#!/usr/bin/env python3
# ============================================================
# make-misans-fonts.py —— 为「嘟嘟羽毛球」生成 MiSans 多字重游戏字体
#
# 设计动机:
#   用户提供了一整套 MiSans (.woff2) 字体文件,并明确提出:
#   1. "合理运用到这个游戏中去"
#   2. "整体字体可以稍微粗一点（粗一点感觉有质感一点那）"
#
# 字重分工策略:
#   - 主字体 / 正文 / 按钮 / 标签 (Body Font):
#     选用 MiSans-Semibold(650 粗度),字形饱满挺拔,在深色街机面板与渐变卡片上
#     有绝佳的厚实感与现代高级质感,彻底告别系统默认细字体的寡淡与单薄。
#   - 标题 / 比分 / 击打高光 / 关卡名 (Display Font):
#     选用 MiSans-Heavy(900 粗度),力量感拉满,爆发力强,契合 P5 街机斩劈风格。
#
# 产物输出:
#   assets/resources/fonts/dudu-body.ttf
#   assets/resources/fonts/dudu-display.ttf
#   以及对应的 .meta 描述文件,供 Cocos Creator resources.load 加载。
# ============================================================
import argparse
import hashlib
import json
import os
import pathlib
import sys
import uuid
from typing import Set

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONTS_SRC_DIR = ROOT / "fonts"
RES_FONTS_DIR = ROOT / "assets/resources/fonts"

# 基础必备字符: 数字、字母、ASCII 标点、全角标点、P5/街机符号
BASE_CHARS = (
    "0123456789"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "abcdefghijklmnopqrstuvwxyz"
    " `~!@#$%^&*()-_=+[{]}\\|;:'\",<.>/?"
    "·、，。：；！？%+-—-*/=（）［］【】《》「」『』…★☆✦∞◎✓↑↓→←▶◀"
)

# 现代汉语高频常用字拓展(覆盖日常交互、更新说明、玩家昵称、系统提示等常用字)
COMMON_CHINESE = (
    "的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得"
    "经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义"
    "事平形相全表间样想向道命此位新氏但关各即几运门常光做走身日已月公次情明见并活设选代流直比保话心料变造结调强命思先老西提文"
    "总目规报感建受解清打意空文声各受转信算海张线研统界便亲传极求受最反题任建更受带安神料解接应美立规展数名风认目转叫放题利展"
    "快慢强弱轻重高低多少前后左右上下内外好坏长短粗细深浅进退胜败攻防胜负击杀扣跳落点球网拍挥动跑位步法移速力量敏捷耐力精神"
    "新手入门初级进阶中级高级宗师传奇挑战赛锦标大师终极关卡章节大厅成就奖励金币钻石积分排行商城皮肤装备技能道具配置调整设置"
    "声音音效背景音乐震动触感反馈重力球速难度辅助操作按键摇杆滑轨透明度大小布局恢复默认重置确定取消完成返回退出暂停继续重来"
    "甜蜜击球完美重扣闪现位移吸球引力时空迟缓跨步救球体力充沛力竭疲劳赛点平分胜出晋级再接再厉恭喜获得未解锁已装备前往开启"
    "更新说明版本日志优化修复已知问题提升游戏体验流畅稳定欢迎反馈"
)

def collect_project_chars() -> Set[str]:
    """从整个项目 assets/scripts/**/*.ts 中收集实际出现的全部字符"""
    chars = set()
    scripts_dir = ROOT / "assets/scripts"
    for p in scripts_dir.rglob("*.ts"):
        try:
            content = p.read_text(encoding="utf-8", errors="ignore")
            for ch in content:
                if ord(ch) >= 32 or ch == '\t':
                    chars.add(ch)
        except Exception as e:
            print(f"读取文件失败 {p}: {e}")
    return chars

def stable_uuid(name: str) -> str:
    """基于相对路径稳定生成 UUID,避免重复生成导致 Cocos meta uuid 抖动"""
    h = hashlib.md5(f"dudu-badminton-font:{name}".encode("utf-8")).hexdigest()
    # 格式化为 8-4-4-4-12 的标准 UUID 字符串
    return str(uuid.UUID(h))

def write_meta(meta_path: pathlib.Path, importer: str, filename: str = ""):
    rel_name = meta_path.name.replace(".meta", "")
    data = {
        "ver": "1.0.1" if importer == "ttf-font" else "1.2.0",
        "importer": importer,
        "imported": True,
        "uuid": stable_uuid(rel_name),
        "files": [".json", filename] if filename else [],
        "subMetas": {},
        "userData": {}
    }
    meta_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"已生成 meta: {meta_path.name}")

def subset_font(src_path: pathlib.Path, dst_path: pathlib.Path, char_set: Set[str], full: bool = False):
    from fontTools import subset
    from fontTools.ttLib import TTFont

    font = TTFont(str(src_path))
    if not full:
        # 子集化
        text = "".join(sorted(char_set - set("\n\r\t")))
        options = subset.Options()
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(text=text)
        subsetter.subset(font)

    # 移除 woff2 包装,存为标准 ttf/otf
    font.flavor = None
    dst_path.parent.mkdir(parents=True, exist_ok=True)
    font.save(str(dst_path))

    size_kb = dst_path.stat().st_size / 1024
    print(f"已生成字体: {dst_path.name} ({size_kb:.1f} KB)")

def main():
    parser = argparse.ArgumentParser(description="生成 MiSans 游戏字体资源")
    parser.add_argument("--full", action="store_true", help="生成全量未裁切字库(约 6MB/个)")
    parser.add_argument("--body-weight", default="MiSans-Semibold.woff2", help="主字体字重文件名")
    parser.add_argument("--display-weight", default="MiSans-Heavy.woff2", help="标题字重大字文件名")
    args = parser.parse_args()

    try:
        from fontTools import subset  # noqa: F401
    except ImportError:
        print("错误: 缺少 fontTools 库, 请先执行 pip3 install fonttools")
        return 1

    body_src = FONTS_SRC_DIR / args.body_weight
    display_src = FONTS_SRC_DIR / args.display_weight

    if not body_src.exists() or not display_src.exists():
        print(f"错误: 找不到源字体文件 {body_src} 或 {display_src}")
        return 1

    RES_FONTS_DIR.mkdir(parents=True, exist_ok=True)

    # 生成 fonts 目录自身的 meta
    dir_meta = ROOT / "assets/resources/fonts.meta"
    if not dir_meta.exists():
        write_meta(dir_meta, "directory")

    # 准备字符集
    chars = set(BASE_CHARS) | set(COMMON_CHINESE) | collect_project_chars()
    print(f"收集到总字符数: {len(chars)} 个")

    # 1. 生成主字体 dudu-body.ttf (MiSans-Semibold, 稍粗质感)
    body_dst = RES_FONTS_DIR / "dudu-body.ttf"
    subset_font(body_src, body_dst, chars, full=args.full)
    write_meta(RES_FONTS_DIR / "dudu-body.ttf.meta", "ttf-font", "dudu-body.ttf")

    # 2. 生成标题字体 dudu-display.ttf (MiSans-Heavy, 街机力量感)
    display_dst = RES_FONTS_DIR / "dudu-display.ttf"
    subset_font(display_src, display_dst, chars, full=args.full)
    write_meta(RES_FONTS_DIR / "dudu-display.ttf.meta", "ttf-font", "dudu-display.ttf")

    print("\nMiSans 游戏字体资源生成完毕！")
    return 0

if __name__ == "__main__":
    sys.exit(main())
