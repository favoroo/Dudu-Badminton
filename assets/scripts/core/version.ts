// ============================================================
// 应用版本定义与语义化版本比较工具
// ============================================================

export const APP_VERSION = "0.0.30";
export const APP_VERSION_NAME = `v${APP_VERSION}`;

export const REPO_CONFIG = {
  githubOwner: "favoroo",
  githubRepo: "Dudu-Badminton",
  giteeOwner: "favo9",
  giteeRepo: "dudu-badminton",
};

/**
 * 解析语义化版本字符串为数字数组。
 * 剥离前导 'v'/'V'、以及 '+build' 或 '-prerelease' 等后缀。
 * 例如: "v0.1.2-beta+4" -> [0, 1, 2]
 */
export function parseVersion(versionStr: string): number[] {
  if (!versionStr) return [0, 0, 0];
  const clean = versionStr.trim().replace(/^[vV]/, "").split(/[+-]/)[0];
  return clean.split(".").map((part) => {
    const n = parseInt(part, 10);
    return isNaN(n) ? 0 : n;
  });
}

/**
 * 判断候选版本 candidate 是否高于当前版本 current。
 */
export function isVersionNewer(candidate: string, current: string = APP_VERSION): boolean {
  const v1 = parseVersion(candidate);
  const v2 = parseVersion(current);
  const maxLen = Math.max(v1.length, v2.length);

  for (let i = 0; i < maxLen; i++) {
    const num1 = i < v1.length ? v1[i] : 0;
    const num2 = i < v2.length ? v2[i] : 0;
    if (num1 > num2) return true;
    if (num1 < num2) return false;
  }
  return false;
}

/**
 * Releases **列表** API(分页,按时间新→旧)—— 「更新记录」弹窗的数据源。
 * 与 checkForUpdate 同一条候选顺序:Gitee 优先、GitHub 备选、代理镜像兜底
 * (兜底拼接在 update-service,这里只出两端的原始地址)。
 */
export function releasesListUrl(platform: "gitee" | "github", perPage = 50): string {
  return platform === "gitee"
    ? `https://gitee.com/api/v5/repos/${REPO_CONFIG.giteeOwner}/${REPO_CONFIG.giteeRepo}/releases?per_page=${perPage}&page=1`
    : `https://api.github.com/repos/${REPO_CONFIG.githubOwner}/${REPO_CONFIG.githubRepo}/releases?per_page=${perPage}`;
}

/**
 * 发布页直链 —— 交给浏览器下载安装包时的去向。
 *
 * 为什么要自己拼:Gitee 的 releases API **不返回 html_url**(GitHub 才有),
 * 于是「拿不到 APK 就去开发布页」那条路会拿到空串。这里按仓库配置兜底,
 * 国内优先 Gitee,与 checkForUpdate 的候选源顺序保持一致。
 */
export function releasePageUrl(tagName = ""): string {
  const base = `https://gitee.com/${REPO_CONFIG.giteeOwner}/${REPO_CONFIG.giteeRepo}/releases`;
  return tagName ? `${base}/tag/${tagName}` : `${base}/latest`;
}

/**
 * 格式化字节大小为 MB 可读文本
 */
export function formatBytes(bytes?: number | null): string {
  if (bytes == null || bytes <= 0) return "";
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
