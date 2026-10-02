// ============================================================
// 应用版本定义与语义化版本比较工具
// ============================================================

export const APP_VERSION = "0.0.20";
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
 * 格式化字节大小为 MB 可读文本
 */
export function formatBytes(bytes?: number | null): string {
  if (bytes == null || bytes <= 0) return "";
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
