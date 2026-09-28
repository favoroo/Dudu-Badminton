// ============================================================
// 应用内更新检查与 APK 下载服务
// 对标 qnote_flutter 更新系统:国内 Gitee 优先、GitHub 备选、代理镜像兜底
// ============================================================

import { native, sys } from "cc";
import { APP_VERSION, formatBytes, isVersionNewer, REPO_CONFIG } from "./version";

export interface UpdateInfo {
  version: string;
  tagName: string;
  releaseName: string;
  releaseNotes: string;
  downloadUrl: string;
  originalDownloadUrl: string;
  candidateDownloadUrls: string[];
  releaseUrl: string;
  fileSize: number;
  fileSizeText: string;
  hasApk: boolean;
}

export type UpdateCheckStatus = "up_to_date" | "available" | "failed";

export interface UpdateCheckResult {
  status: UpdateCheckStatus;
  info?: UpdateInfo;
  error?: string;
}

const GH_PROXIES = [
  "https://ghfast.top/",
  "https://ghproxy.net/",
  "https://gh-proxy.com/",
];

const LAST_CHECK_KEY = "dudu_last_update_check_time";
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export class UpdateService {
  private static _instance: UpdateService | null = null;
  static get instance(): UpdateService {
    if (!this._instance) this._instance = new UpdateService();
    return this._instance;
  }

  private _activeXhr: XMLHttpRequest | null = null;

  /**
   * 判断冷启动是否需要自动检查更新(节流 24 小时)
   */
  shouldRunStartupCheck(): boolean {
    try {
      const lastStr = sys.localStorage.getItem(LAST_CHECK_KEY);
      if (!lastStr) return true;
      const lastTime = parseInt(lastStr, 10);
      if (isNaN(lastTime)) return true;
      return Date.now() - lastTime >= TWENTY_FOUR_HOURS_MS;
    } catch {
      return true;
    }
  }

  /**
   * 记录检查时间
   */
  recordCheckTime(): void {
    try {
      sys.localStorage.setItem(LAST_CHECK_KEY, Date.now().toString());
    } catch {
      // 忽略存储异常
    }
  }

  /**
   * 发起 HTTP GET 请求并解析 JSON(带超时)
   */
  private async fetchJson(url: string, timeoutMs = 8000): Promise<any> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.timeout = timeoutMs;
      xhr.setRequestHeader("Accept", "application/vnd.github+json, application/json");

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (e) {
            reject(new Error(`JSON 解析失败: ${e}`));
          }
        } else {
          reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
        }
      };
      xhr.ontimeout = () => reject(new Error("请求超时"));
      xhr.onerror = () => reject(new Error("网络错误"));
      xhr.send();
    });
  }

  /**
   * 从 Release 对象的 assets 中查找首个 APK
   */
  private extractApkAsset(releaseData: any): { url: string; size: number } | null {
    if (!releaseData || !Array.isArray(releaseData.assets)) return null;
    for (const item of releaseData.assets) {
      if (!item) continue;
      const name = String(item.name || "").toLowerCase();
      if (name.endsWith(".apk")) {
        const url = String(item.browser_download_url || "");
        if (url) {
          const size = typeof item.size === "number" ? item.size : 0;
          return { url, size };
        }
      }
    }
    return null;
  }

  /**
   * 检查新版本(手动或自动触发)
   */
  async checkForUpdate(): Promise<UpdateCheckResult> {
    const giteeUrl = `https://gitee.com/api/v5/repos/${REPO_CONFIG.giteeOwner}/${REPO_CONFIG.giteeRepo}/releases/latest`;
    const githubUrl = `https://api.github.com/repos/${REPO_CONFIG.githubOwner}/${REPO_CONFIG.githubRepo}/releases/latest`;

    // 组合候选 API 地址:Gitee 优先，其次 GitHub，再次国内代理镜像
    const candidateEndpoints = [
      giteeUrl,
      githubUrl,
      ...GH_PROXIES.map((p) => `${p}${githubUrl}`),
    ];

    let releaseData: any = null;
    let lastError: string = "";

    for (const endpoint of candidateEndpoints) {
      try {
        releaseData = await this.fetchJson(endpoint);
        if (releaseData && (releaseData.tag_name || releaseData.name)) {
          break;
        }
      } catch (e: any) {
        lastError = e?.message || String(e);
      }
    }

    if (!releaseData) {
      return { status: "failed", error: lastError || "无法连接到更新服务器" };
    }

    this.recordCheckTime();

    if (releaseData.draft === true || releaseData.prerelease === true) {
      return { status: "up_to_date" };
    }

    const tagName = String(releaseData.tag_name || "").trim();
    if (!tagName) {
      return { status: "failed", error: "Release 数据缺少版本号" };
    }

    // 语义化对比版本号
    if (!isVersionNewer(tagName, APP_VERSION)) {
      return { status: "up_to_date" };
    }

    // 提取 APK 下载地址
    let rawApkUrl = "";
    let apkSize = 0;
    const primaryApk = this.extractApkAsset(releaseData);
    if (primaryApk) {
      rawApkUrl = primaryApk.url;
      apkSize = primaryApk.size;
    }

    const releaseUrl = String(releaseData.html_url || "");

    // 若首选源无 APK 附件，向另一端根据 tagName 补查
    if (!rawApkUrl) {
      const isGitee = releaseUrl.indexOf("gitee.com") >= 0;
      const fallbackBase = isGitee
        ? `https://api.github.com/repos/${REPO_CONFIG.githubOwner}/${REPO_CONFIG.githubRepo}/releases/tags/${tagName}`
        : `https://gitee.com/api/v5/repos/${REPO_CONFIG.giteeOwner}/${REPO_CONFIG.giteeRepo}/releases/tags/${tagName}`;

      const fallbackList = [fallbackBase, ...GH_PROXIES.map((p) => `${p}${fallbackBase}`)];
      for (const ep of fallbackList) {
        try {
          const fbData = await this.fetchJson(ep);
          const fbApk = this.extractApkAsset(fbData);
          if (fbApk) {
            rawApkUrl = fbApk.url;
            apkSize = fbApk.size;
            break;
          }
        } catch {
          // 继续尝试下一个备选
        }
      }
    }

    const hasApk = Boolean(rawApkUrl);
    const candidateDownloadUrls: string[] = [];

    if (hasApk) {
      if (rawApkUrl.indexOf("gitee.com") >= 0) {
        candidateDownloadUrls.push(rawApkUrl);
        const fileName = rawApkUrl.split("/").pop() || "dudu-badminton.apk";
        const ghDirect = `https://github.com/${REPO_CONFIG.githubOwner}/${REPO_CONFIG.githubRepo}/releases/download/${tagName}/${fileName}`;
        for (const proxy of GH_PROXIES) {
          candidateDownloadUrls.push(`${proxy}${ghDirect}`);
        }
        candidateDownloadUrls.push(ghDirect);
      } else if (rawApkUrl.startsWith("https://github.com/")) {
        for (const proxy of GH_PROXIES) {
          candidateDownloadUrls.push(`${proxy}${rawApkUrl}`);
        }
        candidateDownloadUrls.push(rawApkUrl);
      } else {
        candidateDownloadUrls.push(rawApkUrl);
      }
    } else {
      candidateDownloadUrls.push(releaseUrl);
    }

    const info: UpdateInfo = {
      version: tagName.replace(/^[vV]/, ""),
      tagName,
      releaseName: String(releaseData.name || tagName),
      releaseNotes: String(releaseData.body || "暂无更新说明"),
      downloadUrl: candidateDownloadUrls[0] || releaseUrl,
      originalDownloadUrl: rawApkUrl || releaseUrl,
      candidateDownloadUrls,
      releaseUrl,
      fileSize: apkSize,
      fileSizeText: formatBytes(apkSize),
      hasApk,
    };

    return { status: "available", info };
  }

  /**
   * 取消当前进行中的下载
   */
  cancelDownload(): void {
    if (this._activeXhr) {
      this._activeXhr.abort();
      this._activeXhr = null;
    }
  }

  /**
   * 下载 APK 安装包
   * @param url 下载直链
   * @param onProgress 进度回调 (loaded, total, percent 0~100)
   * @returns 本地文件绝对路径
   */
  async downloadApk(
    url: string,
    expectedSize = 0,
    onProgress?: (loaded: number, total: number, percent: number) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      this.cancelDownload();

      const xhr = new XMLHttpRequest();
      this._activeXhr = xhr;
      xhr.open("GET", url, true);
      xhr.responseType = "arraybuffer";
      xhr.timeout = 600000; // 10分钟超时

      xhr.onprogress = (e) => {
        const total = e.lengthComputable ? e.total : expectedSize;
        const loaded = e.loaded;
        const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
        if (onProgress) onProgress(loaded, total, pct);
      };

      xhr.onload = () => {
        this._activeXhr = null;
        if (xhr.status >= 200 && xhr.status < 300) {
          const buffer = xhr.response;
          if (!buffer || buffer.byteLength === 0) {
            reject(new Error("下载的内容为空"));
            return;
          }

          if (sys.isNative) {
            try {
              const writableDir = native.fileUtils.getWritablePath();
              const savePath = `${writableDir}dudu_badminton_update.apk`;
              const success = native.fileUtils.writeDataToFile(new Uint8Array(buffer), savePath);
              if (success) {
                resolve(savePath);
              } else {
                reject(new Error("写入本地存储失败"));
              }
            } catch (err: any) {
              reject(new Error(`保存安装包异常: ${err?.message || err}`));
            }
          } else {
            // 浏览器环境触发下载
            resolve(url);
          }
        } else {
          reject(new Error(`下载失败，HTTP 状态码: ${xhr.status}`));
        }
      };

      xhr.onerror = () => {
        this._activeXhr = null;
        reject(new Error("下载网络异常"));
      };

      xhr.ontimeout = () => {
        this._activeXhr = null;
        reject(new Error("下载超时，请重试"));
      };

      xhr.send();
    });
  }

  /**
   * 唤起系统应用安装器安装 APK
   */
  installApk(filePath: string): boolean {
    if (sys.isNative && sys.os === sys.OS.ANDROID) {
      try {
        const result = native.reflection.callStaticMethod(
          "com/cocos/game/AppActivity",
          "installApk",
          "(Ljava/lang/String;)Z",
          filePath
        );
        return Boolean(result);
      } catch (err) {
        console.error("调用原生 installApk 失败:", err);
        return false;
      }
    }
    return false;
  }
}
