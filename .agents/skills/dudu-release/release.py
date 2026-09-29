#!/usr/bin/env python3
# Dudu Badminton 一键发布脚本（两阶段）：build（构建+打包+校验值）/ publish（推送+双端 Release+验证+清理老附件）
# 独立 prune 子命令：双端各保留最近 N 个版本的 APK 附件，删掉更老的（防 Gitee 1 GB 附件配额超限）
# 仅用 Python 标准库，无第三方依赖。用法见 SKILL.md，或 python3 release.py --help

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_JSON = REPO_ROOT / 'package.json'
VERSION_TS = REPO_ROOT / 'assets' / 'scripts' / 'core' / 'version.ts'
BUILD_DIR = REPO_ROOT / 'build'
META_FILE = BUILD_DIR / 'release-meta.json'

GITHUB_OWNER, GITHUB_REPO = 'favoroo', 'Dudu-Badminton'
GITEE_OWNER, GITEE_REPO = 'favo9', 'dudu-badminton'
GITHUB_API = f'https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}'
GITEE_API = f'https://gitee.com/api/v5/repos/{GITEE_OWNER}/{GITEE_REPO}'

T0 = time.time()


def log(msg: str) -> None:
    print(f'[{time.time() - T0:7.1f}s] {msg}', flush=True)


def die(msg: str, code: int = 1) -> None:
    print(f'✗ 错误: {msg}', file=sys.stderr, flush=True)
    sys.exit(code)


def run(cmd: list, **kw) -> subprocess.CompletedProcess:
    kw.setdefault('cwd', REPO_ROOT)
    kw.setdefault('capture_output', True)
    kw.setdefault('text', True)
    return subprocess.run(cmd, **kw)


# ---------------------------------------------------------------- 通用 HTTP

def http_json(url: str, method: str = 'GET', headers: dict = None,
              data=None, timeout: int = 30):
    """返回 (status, 解析后的JSON或None)。HTTPError 不抛出，返回错误码与响应体。"""
    req = urllib.request.Request(url, method=method,
                                 headers=headers or {}, data=data)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
                return r.status, (json.loads(body) if body else None)
        except urllib.error.HTTPError as e:
            body = e.read()
            try:
                return e.code, (json.loads(body) if body else None)
            except json.JSONDecodeError:
                return e.code, None
        except Exception as e:
            if attempt == 2:
                raise
            time.sleep(1 + attempt)


def multipart_body(fields: dict, file_field: str, filename: str,
                   file_bytes: bytes) -> tuple:
    """构造 multipart/form-data 请求体，返回 (body, content_type)。"""
    boundary = uuid.uuid4().hex
    parts = []
    for k, v in fields.items():
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"'
            f'\r\n\r\n{v}\r\n'.encode())
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="{file_field}"'
        f'; filename="{filename}"\r\n'
        f'Content-Type: application/octet-stream\r\n\r\n'.encode())
    parts.append(file_bytes)
    parts.append(f'\r\n--{boundary}--\r\n'.encode())
    return b''.join(parts), f'multipart/form-data; boundary={boundary}'


# ---------------------------------------------------------------- 令牌获取

def git_credential_fill(host: str) -> str | None:
    """从 git 凭据库取 host 的 password；取不到返回 None（禁止交互）。"""
    env = dict(os.environ, GIT_TERMINAL_PROMPT='0', GIT_ASKPASS='echo')
    r = subprocess.run(['git', 'credential', 'fill'],
                       input=f'protocol=https\nhost={host}\n\n',
                       capture_output=True, text=True, env=env, timeout=15)
    m = re.search(r'^password=(.+)$', r.stdout, re.M)
    return m.group(1).strip() if m else None


def get_github_token() -> str:
    token = os.environ.get('GITHUB_TOKEN') or os.environ.get('GH_TOKEN')
    if token:
        log('GitHub 令牌来源: 环境变量')
        return token.strip()
    token = git_credential_fill('github.com')
    if token:
        log('GitHub 令牌来源: git 凭据库')
        return token
    die('拿不到 GitHub 令牌。请: 1) export GITHUB_TOKEN=<PAT> 或 '
        '2) git push 一次让凭据入库(osxkeychain)。')


def get_gitee_token() -> str:
    token = os.environ.get('GITEE_TOKEN')
    if token:
        log('Gitee 令牌来源: 环境变量')
        return token.strip()
    token = git_credential_fill('gitee.com')
    if token:
        log('Gitee 令牌来源: git 凭据库')
        return token
    die('拿不到 Gitee 令牌。请: 1) export GITEE_TOKEN=<私人令牌> 或 '
        '2) git push 一次让凭据入库。')


# ---------------------------------------------------------------- build 阶段

def read_project_versions() -> tuple[str, str]:
    pkg_ver = ''
    if PACKAGE_JSON.exists():
        d = json.loads(PACKAGE_JSON.read_text())
        pkg_ver = d.get('version', '')

    ts_ver = ''
    if VERSION_TS.exists():
        m = re.search(r'export const APP_VERSION = ["\']([^"\']+)["\'];', VERSION_TS.read_text())
        if m:
            ts_ver = m.group(1)

    return pkg_ver, ts_ver


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def write_meta(meta: dict) -> None:
    META_FILE.parent.mkdir(exist_ok=True)
    tmp = META_FILE.with_suffix('.tmp')
    tmp.write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    os.replace(tmp, META_FILE)


def version_code_from_version(ver: str) -> int:
    try:
        parts = ver.split('.')
        major = int(parts[0]) if len(parts) > 0 else 0
        minor = int(parts[1]) if len(parts) > 1 else 0
        patch = int(parts[2].split('-')[0]) if len(parts) > 2 else 0
        code = major * 10000 + minor * 100 + patch
        return code if code > 0 else 1
    except Exception:
        return 1


def cmd_build(args) -> None:
    pkg_ver, ts_ver = read_project_versions()
    target_ver = args.version.lstrip('vV')
    if pkg_ver and pkg_ver != target_ver:
        die(f'package.json version={pkg_ver} 与 --version {args.version} 不一致')
    if ts_ver and ts_ver != target_ver:
        die(f'assets/scripts/core/version.ts version={ts_ver} 与 --version {args.version} 不一致')
    ver_code = version_code_from_version(target_ver)
    log(f'版本校验通过: v{target_ver} (Android versionCode={ver_code})')

    apk_name = f'dudu-badminton-v{target_ver}-arm64-v8a.apk'
    BUILD_DIR.mkdir(exist_ok=True)
    dst = BUILD_DIR / apk_name

    detail = ''
    try:
        build_script = REPO_ROOT / '.agents' / 'skills' / 'export-apk' / 'scripts' / 'build.sh'
        if not build_script.exists():
            raise RuntimeError(f'构建脚本不存在: {build_script}')

        log(f'开始构建 Release APK (versionName={target_ver}, versionCode={ver_code})...')
        env = dict(os.environ, PROP_VERSION_NAME=target_ver, PROP_VERSION_CODE=str(ver_code))
        r = run(['bash', str(build_script), 'release'], env=env)
        if r.returncode != 0:
            detail = (r.stderr or r.stdout or '')[-3000:]
            raise RuntimeError(f'构建脚本执行失败: {detail}')

        # 查找产物
        candidates = [
            REPO_ROOT / 'build' / 'android' / 'proj' / 'build' / 'dudu-cocos' / 'outputs' / 'apk' / 'release' / 'dudu-cocos-release.apk',
            REPO_ROOT / 'build' / 'android' / 'proj' / 'build' / 'dudu-cocos' / 'outputs' / 'apk' / 'debug' / 'dudu-cocos-debug.apk',
        ]
        src = None
        for c in candidates:
            if c.exists():
                src = c
                break

        if not src:
            raise RuntimeError('未找到生成的 APK 产物')

        shutil.copyfile(src, dst)
        digest = sha256_file(dst)
        meta = {
            'status': 'success',
            'version': target_ver,
            'tag': f'v{target_ver}',
            'apk_name': apk_name,
            'apk_path': str(dst),
            'sha256': digest,
            'size': dst.stat().st_size,
            'timestamp': int(time.time()),
        }
        write_meta(meta)
        log(f'构建完成: {apk_name} ({dst.stat().st_size} 字节)')
        log(f'SHA-256: {digest}')
    except Exception as e:
        detail = detail or str(e)
        write_meta({'status': 'failed', 'version': target_ver, 'error': detail})
        die(f'构建失败: {detail[:2000]}')


# ---------------------------------------------------------------- publish 阶段

def wait_for_build(target_ver: str, timeout: int) -> dict:
    log(f'等待构建元数据 {META_FILE.name}（最长 {timeout}s）...')
    deadline = time.time() + timeout
    while time.time() < deadline:
        if META_FILE.exists():
            try:
                meta = json.loads(META_FILE.read_text())
                if meta.get('status') == 'failed':
                    die(f"构建阶段已失败: {meta.get('error', '')[:1500]}")
                if meta.get('status') == 'success':
                    if meta.get('version') != target_ver:
                        die(f"元数据版本 {meta.get('version')} 与目标版本 {target_ver} 不一致")
                    log(f"构建产物就绪: {meta['apk_path']}")
                    return meta
            except json.JSONDecodeError:
                pass
        time.sleep(2)
    die(f'等待构建超时（{timeout}s）。检查 build 进程是否完成。')


def preflight(tag: str) -> None:
    r = run(['git', 'status', '--porcelain'])
    if r.stdout.strip():
        # 如果只有 release-meta.json 变动则放行，否则警告工作树不干净
        lines = [ln for ln in r.stdout.strip().splitlines() if 'release-meta.json' not in ln]
        if lines:
            die('工作树不干净，先提交全部改动再 publish:\n' + '\n'.join(lines[:10]))

    r = run(['git', 'rev-parse', '--verify', f'refs/tags/{tag}'])
    if r.returncode == 0:
        log(f'本地 tag {tag} 已存在，将复用该 tag')
    else:
        log(f'创建本地 annotated tag: {tag}')
        r = run(['git', 'tag', '-a', tag, '-m', f'Dudu Badminton {tag}'])
        if r.returncode != 0:
            die(f'创建 tag 失败: {r.stderr}')


def current_branch() -> str:
    r = run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'])
    return r.stdout.strip() or 'main'


def git_push(remote: str, branch: str, tag: str) -> None:
    r = run(['git', 'push', remote, branch, tag])
    if r.returncode != 0:
        if 'already exists' in r.stderr or 'up-to-date' in r.stderr:
            log(f'git push {remote}: {branch} / {tag} 已同步，视为成功')
            return
        raise RuntimeError(f'git push {remote} 失败: {r.stderr[-500:]}')


def push_both(branch: str, tag: str) -> None:
    log('并行推送分支+标签到 origin(GitHub) / gitee(Gitee)...')
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
        futs = {ex.submit(git_push, rm, branch, tag): rm for rm in ('origin', 'gitee')}
        for f in concurrent.futures.as_completed(futs):
            f.result()
            log(f'git push {futs[f]} 完成 ({branch} + {tag})')


def gh_headers(token: str) -> dict:
    return {
        'Authorization': f'token {token}',
        'User-Agent': 'dudu-release-script',
        'Accept': 'application/vnd.github+json'
    }


def gh_release_id_by_tag(tag: str, token: str) -> int | None:
    st, d = http_json(f'{GITHUB_API}/releases/tags/{tag}', headers=gh_headers(token))
    return d['id'] if st == 200 and d else None


def gitee_release_id_by_tag(tag: str, token: str) -> int | None:
    url = f'{GITEE_API}/releases/tags/{tag}?{urllib.parse.urlencode({"access_token": token})}'
    st, d = http_json(url)
    return d['id'] if st == 200 and d else None


def create_release(tag: str, name: str, notes: str, tokens: dict) -> dict:
    gh_id = gh_release_id_by_tag(tag, tokens['gh'])
    gitee_id = gitee_release_id_by_tag(tag, tokens['gitee'])
    results = {}

    def create_gh():
        if gh_id:
            results['gh'] = gh_id
            log('GitHub Release 已存在，跳过创建（幂等复用）')
            return
        payload = json.dumps({
            'tag_name': tag,
            'name': name,
            'body': notes,
            'draft': False,
            'prerelease': False
        }).encode('utf-8')
        st, d = http_json(f'{GITHUB_API}/releases', 'POST',
                          headers={**gh_headers(tokens['gh']), 'Content-Type': 'application/json'},
                          data=payload)
        if st != 201 or not d:
            raise RuntimeError(f'GitHub 创建 Release 失败({st}): {d}')
        results['gh'] = d['id']
        log(f'GitHub Release 创建成功 (id={d["id"]})')

    def create_gitee():
        if gitee_id:
            results['gitee'] = gitee_id
            log('Gitee Release 已存在，跳过创建（幂等复用）')
            return
        data = urllib.parse.urlencode({
            'tag_name': tag,
            'name': name,
            'body': notes,
            'prerelease': 'false',
            'target_commitish': 'main'
        }).encode('utf-8')
        st, d = http_json(f'{GITEE_API}/releases', 'POST',
                          headers={'Authorization': f"token {tokens['gitee']}",
                                   'Content-Type': 'application/x-www-form-urlencoded'},
                          data=data)
        if st not in (200, 201) or not d:
            raise RuntimeError(f'Gitee 创建 Release 失败({st}): {d}')
        results['gitee'] = d['id']
        log(f'Gitee Release 创建成功 (id={d["id"]})')

    log('并行创建双端 Release...')
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
        f1, f2 = ex.submit(create_gh), ex.submit(create_gitee)
        f1.result()
        f2.result()
    return results


def upload_apks(release_ids: dict, apk_path: Path, apk_name: str, tokens: dict) -> None:
    file_bytes = apk_path.read_bytes()

    def upload_gh():
        st, d = http_json(
            f'https://uploads.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}'
            f'/releases/{release_ids["gh"]}/assets?'
            f'{urllib.parse.urlencode({"name": apk_name})}',
            'POST',
            headers={**gh_headers(tokens['gh']), 'Content-Type': 'application/octet-stream'},
            data=file_bytes, timeout=600)
        if st != 201 or not d:
            # 若已存在同名资产，检查是否已上传
            if st == 422:
                log('GitHub 附件已存在，跳过重复上传')
                return
            raise RuntimeError(f'GitHub 上传 APK 失败({st}): {d}')
        log(f"GitHub 上传完成: {d['name']} ({d['size']} 字节)")

    def upload_gitee():
        body, ctype = multipart_body({'name': apk_name}, 'file', apk_name, file_bytes)
        st, d = http_json(
            f'{GITEE_API}/releases/{release_ids["gitee"]}/attach_files',
            'POST', headers={'Authorization': f"token {tokens['gitee']}",
                             'Content-Type': ctype},
            data=body, timeout=600)
        if st not in (200, 201) or not d:
            if st == 400 and 'already exists' in str(d):
                log('Gitee 附件已存在，跳过重复上传')
                return
            raise RuntimeError(f'Gitee 上传 APK 失败({st}): {d}')
        log(f"Gitee 上传完成: {apk_name}")

    log(f'并行上传 APK ({apk_name}, {len(file_bytes)} 字节)...')
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
        f1, f2 = ex.submit(upload_gh), ex.submit(upload_gitee)
        f1.result()
        f2.result()


def verify_releases(tag: str, apk_name: str, tokens: dict) -> None:
    log('开始发布后双端验证...')
    # 验证 GitHub
    st_gh, d_gh = http_json(f'{GITHUB_API}/releases/tags/{tag}', headers=gh_headers(tokens['gh']))
    if st_gh != 200 or not d_gh:
        die(f'GitHub 验证失败({st_gh})')
    gh_assets = [a['name'] for a in d_gh.get('assets', [])]
    if apk_name not in gh_assets:
        die(f'GitHub Release 缺少附件 {apk_name}，现有: {gh_assets}')
    log(f'✓ GitHub Release 校验通过: {d_gh.get("html_url")}')

    # 验证 Gitee
    st_gt, d_gt = http_json(f'{GITEE_API}/releases/tags/{tag}?access_token={tokens["gitee"]}')
    if st_gt != 200 or not d_gt:
        die(f'Gitee 验证失败({st_gt})')
    gt_assets = [a['name'] for a in d_gt.get('assets', [])]
    if apk_name not in gt_assets:
        die(f'Gitee Release 缺少附件 {apk_name}，现有: {gt_assets}')
    log(f'✓ Gitee Release 校验通过: {d_gt.get("html_url")}')


def prune_old_apks(keep: int, tokens: dict, dry_run: bool = False) -> None:
    """双端只保留最近 keep 个版本的 APK 附件，防止 Gitee 1GB 仓库附件配额超限。"""
    log(f'检查并清理老版本 APK 附件（保留最近 {keep} 个版本）...')
    # Gitee 清理
    st, rels = http_json(f'{GITEE_API}/releases?access_token={tokens["gitee"]}&per_page=100')
    if st == 200 and isinstance(rels, list):
        releases_with_apk = []
        for r in rels:
            assets = r.get('assets', [])
            apk_assets = [a for a in assets if str(a.get('name', '')).endswith('.apk')]
            if apk_assets:
                releases_with_apk.append(r)
        
        if len(releases_with_apk) > keep:
            for old in releases_with_apk[keep:]:
                rid = old['id']
                st_att, atts = http_json(f'{GITEE_API}/releases/{rid}/attach_files?access_token={tokens["gitee"]}')
                if st_att == 200 and isinstance(atts, list):
                    for a in atts:
                        if str(a.get('name', '')).endswith('.apk'):
                            aid = a['id']
                            log(f'{"[Dry-run] " if dry_run else ""}清理 Gitee 老附件: {old.get("tag_name")} / {a.get("name")}')
                            if not dry_run:
                                http_json(f'{GITEE_API}/releases/{rid}/attach_files/{aid}?access_token={tokens["gitee"]}',
                                          method='DELETE')


def cmd_publish(args) -> None:
    target_ver = args.version.lstrip('vV')
    tag = f'v{target_ver}'
    rel_name = f'Dudu Badminton {tag}'

    tokens = {
        'gh': get_github_token(),
        'gitee': get_gitee_token(),
    }

    if args.dry_run:
        log('【Dry-Run】执行预检与令牌验证通过，不执行实际发布操作。')
        return

    meta = wait_for_build(target_ver, args.timeout)
    apk_path = Path(meta['apk_path'])
    apk_name = meta['apk_name']

    preflight(tag)
    branch = current_branch()
    push_both(branch, tag)

    notes = ''
    if args.notes_file:
        notes_p = Path(args.notes_file)
        if notes_p.exists():
            notes = notes_p.read_text(encoding='utf-8')
    if not notes:
        notes = f'## {rel_name}\n\n嘟嘟羽毛球发布版本 {tag}。\n\n**SHA-256**: `{meta["sha256"]}`'

    rel_ids = create_release(tag, rel_name, notes, tokens)
    upload_apks(rel_ids, apk_path, apk_name, tokens)
    verify_releases(tag, apk_name, tokens)
    prune_old_apks(args.keep, tokens, args.dry_run)

    print('\n' + '=' * 60)
    print(f'🎉 发布成功！{rel_name}')
    print(f'• GitHub Release: https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}/releases/tag/{tag}')
    print(f'• Gitee Release:  https://gitee.com/{GITEE_OWNER}/{GITEE_REPO}/releases/tag/{tag}')
    print(f'• APK 文件名:     {apk_name}')
    print(f'• SHA-256:        {meta["sha256"]}')
    print('=' * 60 + '\n')


def main():
    parser = argparse.ArgumentParser(description='Dudu Badminton 两阶段一键发布工具')
    sub = parser.add_subparsers(dest='subcmd', required=True)

    p_build = sub.add_parser('build', help='第一阶段：构建 Release APK 并写入元数据')
    p_build.add_argument('--version', required=True, help='版本号，如 0.0.1')

    p_pub = sub.add_parser('publish', help='第二阶段：推送代码并双端发布 Release')
    p_pub.add_argument('--version', required=True, help='版本号，如 0.0.1')
    p_pub.add_argument('--notes-file', help='Release 说明 Markdown 文件路径')
    p_pub.add_argument('--timeout', type=int, default=900, help='等待构建元数据超时（秒）')
    p_pub.add_argument('--keep', type=int, default=20, help='保留最近 N 个版本的 APK 附件')
    p_pub.add_argument('--dry-run', action='store_true', help='预检与令牌测试，不做实际变更')

    p_prune = sub.add_parser('prune', help='独立清理老版本 APK 附件')
    p_prune.add_argument('--keep', type=int, default=20, help='保留最近 N 个版本')
    p_prune.add_argument('--dry-run', action='store_true', help='仅打印待清理列表')

    args = parser.parse_args()
    if args.subcmd == 'build':
        cmd_build(args)
    elif args.subcmd == 'publish':
        cmd_publish(args)
    elif args.subcmd == 'prune':
        tokens = {'gh': get_github_token(), 'gitee': get_gitee_token()}
        prune_old_apks(args.keep, tokens, args.dry_run)


if __name__ == '__main__':
    main()
