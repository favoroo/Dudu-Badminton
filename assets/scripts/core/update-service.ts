// ============================================================
// 应用内更新检查与 APK 下载服务
// 对标 qnote_flutter 更新系统:国内 Gitee 优先、GitHub 备选、代理镜像兜底
// ============================================================

import { native, sys } from "cc";
import { APP_VERSION, formatBytes, isVersionNewer, REPO_CONFIG } from "./version";

/** 原生流式下载器的 Java 侧入口(native/engine/android/app/src/com/cocos/game/ApkDownloader.java) */
const DOWNLOADER_CLASS = "com/cocos/game/ApkDownloader";
const APK_FILE_NAME = "dudu_badminton_update.apk";
/** 原生下载器轮询间隔:一帧多轮几次足够,又不刷日志 */
const POLL_INTERVAL_MS = 150;
/** 心跳间隔:原生 XHR 不发 progress 事件,只能靠计时让界面知道"还在下" */
const HEARTBEAT_INTERVAL_MS = 250;
/** 45 秒收不到一个新字节 = 连接僵死,主动断开换源 */
const STALL_LIMIT_MS = 45000;
/** 单源总时长上限 */
const TOTAL_LIMIT_MS = 10 * 60 * 1000;

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

/**
 * 下载进度快照。
 *
 * percent:能拿到可信字节时为 0~99(留 100 给"完成"那一刻),
 *          拿不到字节时是 -1 —— 界面据此走不确定态(跑马灯 + 已用时长)。
 */
export interface DownloadProgress {
  state: "connecting" | "downloading" | "done" | "failed" | "cancelled";
  loaded: number;
  total: number;
  percent: number;
  /** true = loaded/total 是真实字节数 */
  determinate: boolean;
  /** 平滑后的速度 bytes/s,不确定时为 0 */
  speed: number;
  elapsedMs: number;
  /** 当前是第几个候选源(0 基),用于"切换下载源 2/4"提示 */
  sourceIndex: number;
  sourceCount: number;
  host: string;
  /** 是否走原生流式下载器 */
  viaNative: boolean;
}

/** 用户主动取消:不当错误处理,界面只复位不弹 toast */
export class DownloadCancelledError extends Error {
  constructor() {
    super("已取消下载");
    this.name = "DownloadCancelledError";
  }
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
  private _pollTimer: number | null = null;
  private _heartbeatTimer: number | null = null;
  private _cancelled = false;
  /** null = 还没探过;探一次失败就永久回退到 XHR,不再反复反射 */
  private _nativeBridge: boolean | null = null;

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
   * 取消当前进行中的下载(原生下载器 + XHR 两条路都掐)
   */
  cancelDownload(): void {
    this._cancelled = true;
    this.clearTimers();
    if (this._activeXhr) {
      try {
        this._activeXhr.abort();
      } catch {
        // 忽略 abort 异常
      }
      this._activeXhr = null;
    }
    if (this._nativeBridge === true) {
      this.callNative("cancel");
    }
  }

  /** 安装包在本机的落地路径(原生下载与 XHR 下载共用同一个名字) */
  apkSavePath(): string {
    let dir = "";
    try {
      dir = native.fileUtils.getWritablePath();
    } catch {
      dir = "";
    }
    return `${dir}${APK_FILE_NAME}`;
  }

  /**
   * 下载 APK 安装包:按候选源顺序逐个尝试,失败自动切下一个源。
   *
   * @param urls       候选直链(单个或数组,顺序即优先级)
   * @param expectedSize API 给的包体大小,服务端不回 Content-Length 时兜底
   * @param onProgress 进度快照回调
   * @returns 本地文件绝对路径(浏览器环境回原链接)
   */
  async downloadApk(
    urls: string | string[],
    expectedSize = 0,
    onProgress?: (p: DownloadProgress) => void
  ): Promise<string> {
    const candidates = this.normalizeCandidates(urls);
    if (!candidates.length) throw new Error("没有可用的下载地址");

    this.clearTimers();
    this._cancelled = false;

    const failures: string[] = [];
    for (let i = 0; i < candidates.length; i++) {
      if (this._cancelled) throw new DownloadCancelledError();
      const url = candidates[i];
      try {
        return this.usingNativeDownloader()
          ? await this.downloadViaNative(url, i, candidates.length, expectedSize, onProgress)
          : await this.downloadViaXhr(url, i, candidates.length, expectedSize, onProgress);
      } catch (err: any) {
        if (err instanceof DownloadCancelledError || this._cancelled) {
          throw new DownloadCancelledError();
        }
        const msg = err?.message || String(err);
        failures.push(`${this.hostOf(url)}: ${msg}`);
        console.warn(`[update] 下载源 ${i + 1}/${candidates.length} 失败: ${msg}`);
      }
    }
    throw new Error(failures.length ? failures.join(" | ") : "下载失败");
  }

  /** 去重去空,保持优先级顺序 */
  private normalizeCandidates(urls: string | string[]): string[] {
    const list = Array.isArray(urls) ? urls : [urls];
    const seen: string[] = [];
    for (const raw of list) {
      const url = (raw || "").trim();
      if (url && seen.indexOf(url) < 0) seen.push(url);
    }
    return seen;
  }

  private hostOf(url: string): string {
    return url.replace(/^https?:\/\//, "").split("/")[0] || url;
  }

  private clearTimers(): void {
    if (this._pollTimer !== null) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._heartbeatTimer !== null) {
      clearTimeout(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  /**
   * 进度上报器:算平滑速度 + 百分比,并把"字节是否可信"透出去。
   * 下载中最多报到 99%,100% 留给真正拿到文件那一刻,避免条满了却在写盘。
   */
  private createReporter(
    expectedSize: number,
    sourceIndex: number,
    sourceCount: number,
    url: string,
    viaNative: boolean,
    onProgress?: (p: DownloadProgress) => void
  ): (loaded: number, total: number, determinate: boolean, state?: DownloadProgress["state"]) => void {
    const startedAt = Date.now();
    let speed = 0;
    let sampleAt = startedAt;
    let sampleLoaded = 0;

    return (loaded, total, determinate, state = "downloading") => {
      if (this._cancelled) return;
      const now = Date.now();
      if (determinate) {
        const dt = (now - sampleAt) / 1000;
        if (dt >= 0.25 && loaded >= sampleLoaded) {
          const instant = (loaded - sampleLoaded) / dt;
          speed = speed > 0 ? speed * 0.65 + instant * 0.35 : instant;
          sampleAt = now;
          sampleLoaded = loaded;
        }
      }
      const knownTotal = total > 0 ? total : expectedSize;
      const usable = determinate && knownTotal > 0 && loaded > 0;
      const percent = state === "done"
        ? 100
        : usable
          ? Math.max(0, Math.min(99, Math.round((loaded / knownTotal) * 100)))
          : -1;

      onProgress?.({
        state,
        loaded: determinate ? loaded : 0,
        total: knownTotal,
        percent,
        determinate: usable,
        speed: determinate ? Math.max(0, Math.round(speed)) : 0,
        elapsedMs: now - startedAt,
        sourceIndex,
        sourceCount,
        host: this.hostOf(url),
        viaNative,
      });
    };
  }

  /** 反射调原生下载器;类/方法不存在(旧包模板)时返回 null 而不抛 */
  private callNative(method: "start" | "state" | "cancel", ...args: string[]): string | null {
    try {
      const signature = method === "start"
        ? "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;"
        : "()Ljava/lang/String;";
      const out = native.reflection.callStaticMethod(DOWNLOADER_CLASS, method, signature, ...args);
      return typeof out === "string" ? out : "";
    } catch (err) {
      console.warn(`[update] 原生下载器 ${method} 调用失败:`, err);
      return null;
    }
  }

  /** 探一次:能不能用原生流式下载器(只有 Android 原生 + Java 类在位才行) */
  private usingNativeDownloader(): boolean {
    if (this._nativeBridge === null) {
      const android = sys.isNative && sys.os === sys.OS.ANDROID;
      const probe = android ? this.callNative("state") : null;
      this._nativeBridge = typeof probe === "string" && probe.charAt(0) === "{";
      if (!this._nativeBridge) {
        console.warn("[update] 原生下载器不可用,回退 XHR(无字节进度,进度条走计时心跳)");
      }
    }
    return this._nativeBridge;
  }

  private readNativeState(): { state: string; loaded: number; total: number; path: string; error: string } | null {
    const raw = this.callNative("state");
    if (typeof raw !== "string" || raw.charAt(0) !== "{") return null;
    try {
      const parsed = JSON.parse(raw) as { state?: string; loaded?: number; total?: number; path?: string; error?: string };
      return {
        state: String(parsed.state || "idle"),
        loaded: Number(parsed.loaded) || 0,
        total: Number(parsed.total) || 0,
        path: String(parsed.path || ""),
        error: String(parsed.error || ""),
      };
    } catch {
      return null;
    }
  }

  /**
   * 原生路:Java 后台线程流式写 .part,JS 每 150ms 轮询真实字节。
   * 带停滞检测(僵死不报字节就断开换源)与总时长上限。
   */
  private downloadViaNative(
    url: string,
    sourceIndex: number,
    sourceCount: number,
    expectedSize: number,
    onProgress?: (p: DownloadProgress) => void
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const savePath = this.apkSavePath();
      const report = this.createReporter(expectedSize, sourceIndex, sourceCount, url, true, onProgress);

      const started = this.callNative("start", url, savePath, String(expectedSize > 0 ? expectedSize : 0));
      if (started === null) {
        this._nativeBridge = false;
        reject(new Error("原生下载器不可用"));
        return;
      }
      if (started) {
        reject(new Error(started));
        return;
      }

      report(0, expectedSize, true, "connecting");

      const beganAt = Date.now();
      let lastChangeAt = beganAt;
      let lastLoaded = 0;

      const tick = (): void => {
        if (this._cancelled) {
          this.callNative("cancel");
          reject(new DownloadCancelledError());
          return;
        }
        const s = this.readNativeState();
        if (!s) {
          this.callNative("cancel");
          reject(new Error("读取下载状态失败"));
          return;
        }

        if (s.state === "done") {
          report(s.loaded || s.total, s.total || s.loaded, true, "done");
          resolve(s.path || savePath);
          return;
        }
        if (s.state === "failed" || s.state === "cancelled") {
          reject(new Error(s.error || (s.state === "cancelled" ? "已取消下载" : "下载失败")));
          return;
        }

        const now = Date.now();
        if (s.loaded > lastLoaded) {
          lastLoaded = s.loaded;
          lastChangeAt = now;
        }
        if (now - beganAt > TOTAL_LIMIT_MS) {
          this.callNative("cancel");
          reject(new Error("下载超时"));
          return;
        }
        if (now - lastChangeAt > STALL_LIMIT_MS) {
          this.callNative("cancel");
          reject(new Error("连接已中断"));
          return;
        }

        report(s.loaded, s.total, true);
        this._pollTimer = setTimeout(tick, POLL_INTERVAL_MS) as unknown as number;
      };

      tick();
    });
  }

  /**
   * XHR 路:浏览器里 onprogress 有真实字节;Cocos 原生只一次性回包,
   * 所以那边靠 250ms 心跳报"不确定进度"(界面走跑马灯 + 已用时长),
   * 不拿假百分比糊人。整包读完后再落盘。
   */
  private downloadViaXhr(
    url: string,
    sourceIndex: number,
    sourceCount: number,
    expectedSize: number,
    onProgress?: (p: DownloadProgress) => void
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const viaNative = sys.isNative;
      const report = this.createReporter(expectedSize, sourceIndex, sourceCount, url, viaNative, onProgress);

      const xhr = new XMLHttpRequest();
      this._activeXhr = xhr;
      xhr.open("GET", url, true);
      xhr.responseType = "arraybuffer";
      xhr.timeout = TOTAL_LIMIT_MS;

      let bytesSeen = false;
      let lastEventLoaded = 0;
      let lastEventTotal = expectedSize;

      xhr.onprogress = (e) => {
        bytesSeen = true;
        lastEventLoaded = e.loaded;
        lastEventTotal = e.lengthComputable ? e.total : expectedSize;
        report(lastEventLoaded, lastEventTotal, true);
      };

      // 心跳:原生端永远不进 onprogress,靠它让界面知道还在跑
      const beat = (): void => {
        if (this._cancelled) return;
        if (bytesSeen) {
          report(lastEventLoaded, lastEventTotal, true);
        } else {
          report(0, expectedSize, false);
        }
        this._heartbeatTimer = setTimeout(beat, HEARTBEAT_INTERVAL_MS) as unknown as number;
      };

      xhr.onload = () => {
        this._activeXhr = null;
        this.clearTimers();

        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(`下载失败，HTTP 状态码: ${xhr.status}`));
          return;
        }
        const buffer = xhr.response as ArrayBuffer | null;
        if (!buffer || buffer.byteLength === 0) {
          reject(new Error("下载的内容为空"));
          return;
        }
        if (!sys.isNative) {
          // 浏览器环境交给系统下载器
          resolve(url);
          return;
        }
        try {
          const savePath = this.apkSavePath();
          const ok = native.fileUtils.writeDataToFile(new Uint8Array(buffer), savePath);
          if (ok) {
            report(buffer.byteLength, buffer.byteLength, true, "done");
            resolve(savePath);
          } else {
            reject(new Error("写入本地存储失败"));
          }
        } catch (err: any) {
          reject(new Error(`保存安装包异常: ${err?.message || err}`));
        }
      };

      xhr.onerror = () => {
        this._activeXhr = null;
        this.clearTimers();
        reject(new Error("下载网络异常"));
      };

      xhr.ontimeout = () => {
        this._activeXhr = null;
        this.clearTimers();
        reject(new Error("下载超时，请重试"));
      };

      report(0, expectedSize, bytesSeen, "connecting");
      beat();
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
