#!/usr/bin/env python3
# ============================================================
# 介绍站 + Web 版一键部署到 GitHub Pages。
#
# 产物布局(gh-pages 分支):
#   根路径  /               ← Cocos web-mobile 可玩版
#   /site/                  ← 介绍站(site/dist/ 原样)
#
# 为什么用独立 worktree 重建孤儿分支(而不是 checkout --orphan):
#   t-1 那边踩过一次真事故 —— 在主工作树上 `git rm -rf .` 轮换分支,把 keystore 之类的
#   机密文件一起提交推上了公开仓库,中途崩溃还会让主分支工作树停在 gh-pages。
#   这里沿用修好之后的做法:worktree 独立、脏树直接拒绝、每次部署重建(单提交不累积历史,
#   几十 MB 的 Cocos 导出产物不该在仓库里存 40 份)。
#
# 用法(仓库根目录):
#   python3 tools/deploy-site.py                  # 全量:同步数据 → 构建 Web → 部署
#   python3 tools/deploy-site.py --skip-build     # 跳过 Cocos 构建(用已有 build/web-mobile)
#   python3 tools/deploy-site.py --site-only      # 只更介绍站,不动 Web 版
#   python3 tools/deploy-site.py --dry-run        # 只做检查与数据同步,不提交推送
#
# 依赖:Cocos Creator CLI 在 /Applications/CocosCreator.app(可用 COCOS_CREATOR 覆盖)、
#       git、python3、node/npx(编译 tools/)。零第三方 Python 包。
# ============================================================
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE_SRC = ROOT / "site" / "dist"
WEB_BUILD = ROOT / "build" / "web-mobile"
BUILD_CFG = ROOT / "build-web-mobile.json"
WORKTREE = ROOT / ".gh-pages-work"

COCOS = os.environ.get("COCOS_CREATOR", "/Applications/CocosCreator.app/Contents/MacOS/CocosCreator")

# GitHub Pages 项目页地址(owner 小写)
OWNER, REPO = "favoroo", "Dudu-Badminton"
PAGES_URL = f"https://{OWNER.lower()}.github.io/{REPO}/"
SITE_URL = f"{PAGES_URL}site/"

T0 = time.time()


def log(msg: str) -> None:
    print(f"[{time.time() - T0:6.1f}s] {msg}", flush=True)


def die(msg: str, code: int = 1) -> None:
    print(f"✗ {msg}", file=sys.stderr, flush=True)
    sys.exit(code)


def run(cmd: list, cwd: Path | None = None, check: bool = False) -> subprocess.CompletedProcess:
    r = subprocess.run(cmd, cwd=str(cwd or ROOT), capture_output=True, text=True)
    if check and r.returncode != 0:
        die(f"命令失败: {' '.join(cmd)}\n{(r.stderr or r.stdout)[-2000:]}")
    return r


# ---------- 1. 站点数据 ----------

def sync_site_data() -> None:
    """编译 tools/ 并跑 export-site-data,把 config 里的数字与预览图同步进 site/dist"""
    log("编译 tools/ 并同步站点数据…")
    run(["npx", "tsc", "-p", "tools/tsconfig.json"], check=True)
    r = run(["node", ".tools-build/tools/export-site-data.js"])
    out = (r.stdout or "").strip()
    for line in out.splitlines():
        if line.startswith(("✓", "⚠", "统计")):
            log("  " + line)
    if r.returncode != 0:
        die(f"导出站点数据失败:\n{(r.stderr or out)[-2000:]}")

    # 字体子集:页面文案变了就要重裁(否则新字掉回系统字体)
    subset = ROOT / "tools" / "subset-site-fonts.py"
    if subset.exists():
        r = run([sys.executable, str(subset)])
        if r.returncode != 0:
            log(f"  ⚠ 字体子集化告警:{(r.stderr or '')[-600:]}")
        else:
            for line in (r.stdout or "").splitlines():
                if line.startswith(("✓", "⚠")):
                    log("  " + line)

    for must in ["index.html", "styles.css", "app.js", "data.js", "tokens.css"]:
        if not (SITE_SRC / must).exists():
            die(f"site/dist 缺 {must}")


# ---------- 2. Web 构建 ----------

def build_web() -> None:
    """Cocos CLI 构建 web-mobile。

    退出码不可靠(登录服务超时、启动期 layout.json 解析报错都会让退出码非零,即使
    build task 已 success)—— 与 .agents/skills/export-apk/scripts/build.sh 同一条口径:
    放行退出码,改判「产物新鲜度」。
    """
    if not Path(COCOS).exists():
        die(f"Cocos Creator 不存在: {COCOS}(可用 COCOS_CREATOR 环境变量覆盖)")
    if not BUILD_CFG.exists():
        die(f"缺构建配置: {BUILD_CFG}")

    marker = time.time()
    log("Cocos CLI 构建 web-mobile(约 1~3 分钟)…")
    r = run([COCOS, "--project", str(ROOT), "--build", f"configPath={BUILD_CFG}"])
    if r.returncode != 0:
        log(f"  ⚠ Cocos 退出码 {r.returncode}(已知不可靠,改判产物)")

    index = WEB_BUILD / "index.html"
    if not index.exists():
        die(f"未找到构建产物 {index}\n{(r.stderr or r.stdout)[-2000:]}")

    fresh = [p for p in WEB_BUILD.rglob("*") if p.is_file() and p.stat().st_mtime >= marker - 5]
    if not fresh:
        die("build/web-mobile 里没有本次构建新写的文件 —— Cocos 实际没产出(别把旧包推上去)")
    total = sum(p.stat().st_size for p in WEB_BUILD.rglob("*") if p.is_file())
    log(f"  产物 {len(fresh)} 个新文件 / 共 {total / 1024 / 1024:.1f} MB")


# ---------- 3. 部署 ----------

def deploy(site_only: bool, allow_dirty: bool) -> None:
    status = run(["git", "status", "--porcelain"]).stdout.strip()
    if status and not allow_dirty:
        die("工作树有未提交改动,先 commit 或 stash。\n" + status[:1200])

    branch = run(["git", "rev-parse", "--abbrev-ref", "HEAD"]).stdout.strip()
    log(f"当前分支: {branch}")

    if WORKTREE.exists():
        run(["git", "worktree", "remove", "--force", str(WORKTREE)])

    # 每次重建孤儿分支:单提交,不累积几十 MB 的构建历史
    if run(["git", "rev-parse", "--verify", "refs/heads/gh-pages"]).returncode == 0:
        run(["git", "branch", "-D", "gh-pages"])
    run(["git", "worktree", "add", "--orphan", "-b", "gh-pages", str(WORKTREE)], check=True)

    try:
        if not site_only:
            log("复制 Web 产物 → gh-pages 根")
            for item in WEB_BUILD.iterdir():
                dest = WORKTREE / item.name
                if item.is_dir():
                    shutil.copytree(item, dest)
                else:
                    shutil.copy2(item, dest)

        log("复制介绍站 → gh-pages/site")
        dest_site = WORKTREE / "site"
        if dest_site.exists():
            shutil.rmtree(dest_site)
        shutil.copytree(SITE_SRC, dest_site)

        # Jekyll 会吞掉下划线开头的目录(Cocos 产物里有 assets/ 之类),关掉它
        (WORKTREE / ".nojekyll").write_text("", encoding="utf-8")

        run(["git", "add", "-A"], cwd=WORKTREE, check=True)
        msg = f"deploy: 介绍站{f'' if site_only else ' + Web 版'} {time.strftime('%Y-%m-%d %H:%M')}"
        r = run(["git", "commit", "-m", msg, "--allow-empty"], cwd=WORKTREE)
        if r.returncode != 0 and "nothing to commit" not in (r.stdout or ""):
            log(f"  git commit: {(r.stdout or '')[:300]}")

        log("推送到 origin gh-pages…")
        r = run(["git", "push", "origin", "gh-pages", "--force-with-lease"])
        if r.returncode != 0:
            if "up-to-date" in (r.stderr or "") or "up to date" in (r.stderr or ""):
                log("  已是最新,无需推送")
            else:
                die(f"git push 失败:\n{(r.stderr or '')[-1500:]}")
    finally:
        run(["git", "worktree", "remove", "--force", str(WORKTREE)])
        run(["git", "worktree", "prune"])
        log(f"清理 worktree,主分支保持 {branch}")


def enable_pages() -> None:
    """首次部署后把 Pages 源指到 gh-pages 分支(幂等;gh 不可用就打印手动步骤)"""
    if shutil.which("gh") is None:
        log("⚠ 未安装 gh CLI,请手动设置:仓库 Settings → Pages → Source = gh-pages / root")
        return
    r = run(["gh", "api", f"repos/{OWNER}/{REPO}/pages"])
    if r.returncode == 0:
        log("GitHub Pages 已启用")
        return
    r = run(["gh", "api", "-X", "POST", f"repos/{OWNER}/{REPO}/pages",
             "-f", "source[branch]=gh-pages", "-f", "source[path]=/"])
    if r.returncode == 0:
        log("已启用 GitHub Pages(gh-pages / root)")
    else:
        log(f"⚠ 自动启用失败,请手动设置 Pages 源。\n  {(r.stderr or '')[-500:]}")


def main() -> None:
    ap = argparse.ArgumentParser(description="嘟嘟羽毛球介绍站 / Web 版部署")
    ap.add_argument("--skip-build", action="store_true", help="跳过 Cocos 构建,用已有 build/web-mobile")
    ap.add_argument("--site-only", action="store_true", help="只更新介绍站,不动 Web 版")
    ap.add_argument("--dry-run", action="store_true", help="只同步数据与检查,不提交推送")
    ap.add_argument("--allow-dirty", action="store_true", help="允许脏树部署")
    args = ap.parse_args()

    sync_site_data()

    if not args.site_only and not args.skip_build:
        build_web()
    if not args.site_only and not WEB_BUILD.exists():
        die("没有 build/web-mobile —— 先跑构建,或加 --site-only")

    if args.dry_run:
        log("--dry-run:数据已同步,跳过部署")
        return

    deploy(args.site_only, args.allow_dirty)
    enable_pages()

    print("\n" + "=" * 62)
    print("🎉 部署完成")
    if not args.site_only:
        print(f"  可玩 Web 版: {PAGES_URL}")
    print(f"  介绍站:      {SITE_URL}")
    print("  首次生效约 1~2 分钟(GitHub Pages 缓存刷新),之后重跑本脚本即可")
    print("=" * 62 + "\n")


if __name__ == "__main__":
    main()
