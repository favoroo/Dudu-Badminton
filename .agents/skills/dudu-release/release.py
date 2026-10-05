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


def bump_version(ver: str) -> str:
    """X.Y.Z → X.Y.(Z+1)。patch 永远 +1,minor/major 不动(Dudu 约定)。"""
    parts = ver.split('.')
    if len(parts) != 3:
        die(f'版本号格式异常: {ver}(期望 X.Y.Z)')
    try:
        parts[2] = str(int(parts[2]) + 1)
    except ValueError:
        die(f'版本号 patch 段不是整数: {ver}')
    return '.'.join(parts)


def write_version_files(ver: str) -> None:
    """写回 package.json 与 version.ts,格式保持(indent=2 + 末尾换行)。"""
    # package.json —— 解析后重写,保持 2 空格缩进
    pkg = json.loads(PACKAGE_JSON.read_text())
    if pkg.get('version') == ver:
        log(f'package.json 已是 {ver},无需写回')
    else:
        pkg['version'] = ver
        PACKAGE_JSON.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + '\n')
        log(f'package.json version 已写回: {ver}')
    # version.ts —— 正则替换 APP_VERSION 字符串字面量
    ts_text = VERSION_TS.read_text()
    new_ts = re.sub(
        r'export const APP_VERSION = ["\'][^"\']+["\'];',
        f'export const APP_VERSION = "{ver}";',
        ts_text
    )
    if new_ts == ts_text:
        log(f'version.ts APP_VERSION 已是 {ver},无需写回')
    else:
        VERSION_TS.write_text(new_ts)
        log(f'version.ts APP_VERSION 已写回: {ver}')


def cmd_bump(args) -> None:
    """自动算下一个要发的版本号,可选写回 package.json 与 version.ts。

    决策真值表(agent 不用再自己判断):
      version.ts=X, tag vX 不存在 → 用 X(预升未发布例外)
      version.ts=X, tag vX 已存在 → +1 到 X+1
    """
    pkg_ver, ts_ver = read_project_versions()
    if pkg_ver != ts_ver:
        die(f'package.json version={pkg_ver} 与 version.ts APP_VERSION={ts_ver} 不一致,先手动对齐再 bump')
    current = pkg_ver
    tag = f'v{current}'

    r = run(['git', 'rev-parse', '--verify', f'refs/tags/{tag}'])
    tag_exists = (r.returncode == 0)

    if not tag_exists:
        target = current
        log(f'当前版本 {current} 的 tag {tag} 不存在(预升未发布例外),直接用 {target}')
    else:
        target = bump_version(current)
        log(f'当前版本 {current} 的 tag {tag} 已存在,递增到 {target}')

    if args.write and not tag_exists:
        # 预升未发布:version.ts 已是 X,无需写回
        log(f'--write 指定但当前版本已是 {target},文件无需改动')
    elif args.write and tag_exists:
        write_version_files(target)
    elif not args.write and tag_exists:
        log('--dry-run 模式(默认),未写回文件;加 --write 写回 package.json 与 version.ts')

    # 标准输出仅一行版本号,便于 agent 捕获后传给 build/publish
    print(target)


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


# ---------------------------------------------------------------- 签名与新鲜度

def keytool_bin() -> str:
    for cand in (os.environ.get('JAVA_HOME'),
                 '/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home'):
        if cand and (Path(cand) / 'bin' / 'keytool').exists():
            return str(Path(cand) / 'bin' / 'keytool')
    return 'keytool'


def android_build_cfg() -> dict:
    cfg = json.loads((REPO_ROOT / 'build-android.json').read_text())
    return cfg.get('packages', {}).get('android', {})


def _sha256_fingerprint(text: str) -> str:
    m = re.search(r'SHA256:\s*([0-9A-F]{2}(?::[0-9A-F]{2}){31})', text)
    return m.group(1) if m else ''


def latest_apksigner() -> str | None:
    bt = Path(os.environ.get('ANDROID_HOME') or Path.home() / 'Library/Android/sdk') / 'build-tools'
    if not bt.exists():
        return None
    best, best_key = None, None
    for d in bt.iterdir():
        cand = d / 'apksigner'
        if d.is_dir() and cand.exists():
            key = [int(x) if x.isdigit() else 0 for x in d.name.split('.')]
            if best_key is None or key > best_key:
                best, best_key = str(cand), key
    return best


def keystore_cert_sha256() -> str:
    """正式 keystore 的证书指纹(路径/口令/别名都从 build-android.json 读,单一事实来源)"""
    ks = android_build_cfg()
    path = Path(ks.get('keystorePath') or REPO_ROOT / 'keystore' / 'release.keystore')
    if not path.exists():
        raise RuntimeError(
            f'正式 keystore 不存在: {path}\n'
            '  (签名文件与口令在本地 keystore/ 目录保管,不入库;丢了它老用户永远收不到更新)')
    r = run([keytool_bin(), '-list', '-v', '-keystore', str(path),
             '-alias', ks.get('keystoreAlias') or 'dudu',
             '-storepass', ks.get('keystorePassword') or ''])
    if r.returncode != 0:
        raise RuntimeError(f'读 keystore 失败(口令/别名不对?): {(r.stderr or r.stdout)[-300:]}')
    return _sha256_fingerprint(r.stdout)


def apk_cert_sha256(apk: Path) -> str:
    """APK 主签名证书指纹。keytool 走 JAR(v1)签名;v2-only 时退 apksigner"""
    r = run([keytool_bin(), '-printcert', '-jarfile', str(apk)])
    if r.returncode == 0:
        fp = _sha256_fingerprint(r.stdout)
        if fp:
            return fp
    signer = latest_apksigner()
    if signer:
        r = run([signer, 'verify', '--print-certs', str(apk)])
        m = re.search(r'SHA-256 digest:\s*([0-9a-f]{64})', r.stdout, re.I)
        if m:
            h = m.group(1).upper()
            return ':'.join(h[i:i + 2] for i in range(0, 64, 2))
    return ''


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
            # 合并 stderr+stdout(否则 Cocos 警告走 stderr 非空时会盖掉 Gradle 的 stdout 真因)。
            # stdout 放末尾:build.sh 先跑 Cocos(stderr 警告)再跑 Gradle(stdout 真因),
            # 失败原因多在 stdout 末尾,放末尾的 [-N:] 才切到它。
            detail = ((r.stderr or '') + '\n--- stdout ---\n' + (r.stdout or ''))[-4000:]
            raise RuntimeError(f'构建脚本执行失败: {detail}')

        # 查找产物:只认 release 包。debug 包(debuggable=true、无 minify)性能与
        # 正式包不可比,拿去发布会把调试桥带给用户 —— 找不到 release 就直接失败。
        src = (
            REPO_ROOT / 'build' / 'android' / 'proj' / 'build' / 'dudu-cocos' / 'outputs' / 'apk' / 'release' / 'dudu-cocos-release.apk'
        )
        if not src.exists():
            src = None

        if not src:
            raise RuntimeError('未找到 release APK 产物(debug 包不再作为回退发布)')

        # ---- 产物新鲜度:APK 必须比 build/android/data 新(build.sh 已有一道,双保险)。
        # 从前 Cocos 构建失败也继续走 Gradle,拿上一次的旧 JS 资源打出「新版本号+旧内容」的包。
        data_dir = REPO_ROOT / 'build' / 'android' / 'data'
        if data_dir.exists() and src.stat().st_mtime < data_dir.stat().st_mtime:
            raise RuntimeError('release APK 比 build/android/data 还旧 —— 疑似陈旧产物,拒绝交付')

        # ---- 签名校验:必须与 keystore/release.keystore 同证书。
        # 从前 release 包一直用 Cocos 自带 debug.keystore 签:换机器构建 → 签名变化 →
        # 用户只能卸载重装(存档全没)。现在发布前在这里核指纹,谁把 useDebugKeystore
        # 改回去、或换了 keystore,都会被当场拦下而不是发出去之后才发现。
        expect = keystore_cert_sha256()
        actual = apk_cert_sha256(src)
        if not expect or not actual:
            raise RuntimeError('读不到证书指纹(keystore 或 APK 侧),拒绝盲发')
        if expect != actual:
            raise RuntimeError(
                f'APK 签名与正式 keystore 不一致,拒绝发布!\n'
                f'  APK:      {actual}\n  keystore: {expect}')
        log(f'签名校验通过: SHA256 {actual[:35]}…')

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


def preflight(tag: str, tokens: dict) -> None:
    r = run(['git', 'status', '--porcelain'])
    if r.stdout.strip():
        # 如果只有 release-meta.json 变动则放行，否则警告工作树不干净
        lines = [ln for ln in r.stdout.strip().splitlines() if 'release-meta.json' not in ln]
        if lines:
            die('工作树不干净，先提交全部改动再 publish:\n' + '\n'.join(lines[:10]))

    r = run(['git', 'rev-parse', '--verify', f'refs/tags/{tag}'])
    if r.returncode == 0:
        # 本地 tag 已存在 —— 区分「重试场景」与「覆盖发布」:
        #   双端远端 Release 都已存在 = 该版本已发过,禁止覆盖,die
        #   任一端 Release 不存在 = build 后 publish 失败重跑的重试,放行复用
        gh_id = gh_release_id_by_tag(tag, tokens['gh'])
        gitee_id = gitee_release_id_by_tag(tag, tokens['gitee'])
        if gh_id and gitee_id:
            die(f'tag {tag} 已在双端发布过 Release(GitHub id={gh_id}, Gitee id={gitee_id}),'
                f'禁止同版本覆盖发布。请先 `python3 release.py bump --write` 递增版本号。')
        log(f'本地 tag {tag} 已存在,远端 Release 未发布完,将复用该 tag(重试场景)')
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


def _ver_key(tag: str):
    """v0.0.21 -> (0, 0, 21) 用于版本降序排序。"""
    nums = re.findall(r'\d+', tag or '')
    return tuple(int(n) for n in nums) or (0,)


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
        # Gitee /releases 默认按 id 升序(旧→新)返回,直接 [keep:] 会把刚发布的最新版
        # 切进待删区(v0.0.21 首次踩中)。先按 tag 降序排,确保 [keep:] 取到的是老版本。
        releases_with_apk.sort(key=lambda r: _ver_key(str(r.get('tag_name', ''))), reverse=True)
        
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

    preflight(tag, tokens)
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

    p_bump = sub.add_parser('bump', help='自动算下一个版本号(读 version.ts,查 tag,已存在则 +1)')
    p_bump.add_argument('--write', action='store_true', help='写回 package.json 与 version.ts')
    p_bump.add_argument('--dry-run', action='store_true', help='只打印,不动文件(默认即 dry-run)')

    args = parser.parse_args()
    if args.subcmd == 'build':
        cmd_build(args)
    elif args.subcmd == 'publish':
        cmd_publish(args)
    elif args.subcmd == 'prune':
        tokens = {'gh': get_github_token(), 'gitee': get_gitee_token()}
        prune_old_apks(args.keep, tokens, args.dry_run)
    elif args.subcmd == 'bump':
        cmd_bump(args)


if __name__ == '__main__':
    main()
