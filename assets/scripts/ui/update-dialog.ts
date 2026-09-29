// ============================================================
// 应用内更新提示弹窗:版本号、更新说明、大小、进度条、下载与安装
//
// 进度显示为什么要分两态:
// Cocos 3.8 原生端的 XMLHttpRequest 是 jsb.XMLHttpRequest,底层一次性收完
// 整个响应才回调 JS,从不派发 progress 事件 —— 所以 Android 上的字节进度
// 来自 update-service 里的原生流式下载器(Java 线程 + 150ms 轮询)。
// 万一设备上的旧包没有这套原生下载器(反射失败回退 XHR),那时拿不到字节,
// 界面就诚实进入"不确定态":呼吸条 + 已用时长,绝不编一个百分比糊人。
// ============================================================
import { Button, Color, Graphics, Label, Node, sys, UITransform, Vec2 } from "cc";
import { col } from "./ui-manager";
import type { UiKit } from "./ui-manager";
import { cancelFade, drawArcadePanel, drawHardShadow, fadeOutHide, slamIn, textW } from "./ui-arcade";
import { DownloadProgress, UpdateInfo, UpdateService } from "../core/update-service";

/** 进度条轨道几何(与 ui-arcade 面板宽度配套) */
const TRACK_X = -190;
const TRACK_W = 380;
const TRACK_H = 14;

/** 更新日志框:白名单式精简 + 按字宽精确折行,行数即框高,绝不溢出 */
const NOTE_W = 390;
const NOTE_LINE_H = 16;
const NOTE_MAX_LINES = 6;
const NOTE_BOX_MIN = 96;
const NOTE_BOX_MAX = 112;

/** 字节数 → 人话;小于 1 MB 用 KB,免得显示 0.0 MB */
function fmtSize(bytes: number): string {
  const b = Math.max(0, bytes || 0);
  if (b < 1024) return `${Math.round(b)} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Release 正文(markdown)→ 弹窗友好的纯文本行:
 * 跳过一级标题与 SHA-256 行;`### 小节` → 「小节」;`- 项` → `· 项`;
 * 剥掉 **加粗** / `代码` 标记。弹窗里只留干货,语法噪音一概不出现。
 */
function notesToLines(md: string): string[] {
  const out: string[] = [];
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // 一级/二级标题里带版本号的当文档标题,跳过(版本号弹窗上方已有)
    if (/^#{1,2}\s+.*\d+\.\d+\.\d+/.test(line)) continue;
    if (/^SHA-256/i.test(line.replace(/[*`\s]/g, ""))) continue;
    const head = line.match(/^#{2,6}\s+(.+)$/);
    if (head) {
      out.push(`「${head[1].replace(/[*`_]/g, "").trim()}」`);
      continue;
    }
    const item = line.match(/^[-*+]\s+(.+)$/);
    const text = (item ? item[1] : line).replace(/[*`_]/g, "").trim();
    if (text) out.push(item ? `· ${text}` : text);
  }
  return out;
}

/**
 * 按字宽逐字折行 —— 与 textW 同一把尺,行数即所见,
 * 折行宽度留 6px 安全边,估值宁早勿晚,保证 Label 不横向溢出。
 */
function wrapNoteLine(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let w = 0;
  for (const ch of s) {
    const cw = textW(ch, 13);
    if (w + cw > NOTE_W - 6) {
      out.push(cur);
      cur = ch;
      w = cw;
    } else {
      cur += ch;
      w += cw;
    }
  }
  out.push(cur);
  return out;
}

/** 精简 → 折行 → 最多 NOTE_MAX_LINES 行,超限末行补省略号;返回带 \n 的最终文案 */
function noteFit(md: string): string {
  const lines: string[] = [];
  for (const seg of notesToLines(md)) lines.push(...wrapNoteLine(seg));
  const shown = lines.slice(0, NOTE_MAX_LINES);
  if (lines.length > NOTE_MAX_LINES && shown.length > 0) {
    let last = shown[shown.length - 1];
    while (textW(`${last}…`, 13) > NOTE_W && last.length > 1) last = last.slice(0, -1);
    shown[shown.length - 1] = `${last}…`;
  }
  return shown.join("\n");
}

/** 剩余时间 → 人话 */
function fmtEta(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return "计算中";
  if (seconds < 60) return `约 ${Math.ceil(seconds)} 秒`;
  if (seconds < 3600) return `约 ${Math.ceil(seconds / 60)} 分钟`;
  return "较久";
}

export class UpdateDialog {
  readonly root: Node;
  private kit: UiKit;
  private card: Graphics;
  private notesBoxG: Graphics;
  private notesBoxNode: Node;
  private verLabel: Label;
  private sizeLabel: Label;
  private notesLabel: Label;
  private progressNode: Node;
  private progressFill: Graphics;
  private progressLabel: Label;
  private progressSub: Label;
  private updateBtn: Node;
  private updateBtnLabel: Label;
  private cancelBtn: Node;
  private cancelBtnLabel: Label;
  private currentInfo: UpdateInfo | null = null;
  private isDownloading = false;
  private downloadedPath = "";
  /** 每轮下载/关窗都自增:在途的进度回调靠它判断自己是否已经过期 */
  private session = 0;

  constructor(parent: Node, kit: UiKit) {
    this.kit = kit;
    const P = kit.pal;
    this.root = kit.root(parent, "update-dialog");
    this.root.active = false;

    // 半透明全屏暗底
    kit.dim(this.root, 0.4, 0.74);

    // 居中卡片
    this.card = kit.panel(this.root, 480, 360, {
      r: 16,
      bg: P.panel,
      bgAlpha: 0.98,
      stroke: P.accent,
      strokeAlpha: 0.5,
    });
    this.card.node.setPosition(0, 0, 0);

    // 标题
    const title = kit.label(this.card.node, "发现新版本", 24, P.accent, { outline: P.ink, outlineW: 2 });
    title.enableShadow = true;
    title.shadowColor = new Color(0, 0, 0, 130);
    title.shadowOffset = new Vec2(0, -4);
    title.node.setPosition(0, 140, 0);

    // 版本标签
    this.verLabel = kit.label(this.card.node, "v0.0.0", 14, P.cyan);
    this.verLabel.node.setPosition(0, 114, 0);

    // 安装包大小
    this.sizeLabel = kit.label(this.card.node, "大小: -- MB", 12, P.dim);
    this.sizeLabel.node.setPosition(0, 94, 0);

    // 更新日志背景底框(高度随公告行数自适应,show 时重绘)
    const notesBox = kit.panel(this.card.node, 420, NOTE_BOX_MIN, {
      r: 8,
      bg: P.panelLight,
      bgAlpha: 0.6,
      stroke: P.line,
      strokeAlpha: 0.15,
    });
    notesBox.node.setPosition(0, 24, 0);
    this.notesBoxG = notesBox;
    this.notesBoxNode = notesBox.node;

    // 更新日志文本:RESIZE_HEIGHT + 显式 \n 折行(行高锁 NOTE_LINE_H,行数即框高)
    this.notesLabel = kit.label(notesBox.node, "更新内容", 13, P.text, { align: 0 });
    this.notesLabel.overflow = Label.Overflow.RESIZE_HEIGHT;
    this.notesLabel.lineHeight = NOTE_LINE_H;
    this.notesLabel.node.getComponent(UITransform)?.setContentSize(NOTE_W, NOTE_BOX_MIN - 14);
    this.notesLabel.node.setPosition(0, 0, 0);

    // 进度条容器
    this.progressNode = new Node("progress-box");
    this.progressNode.layer = this.root.layer;
    this.progressNode.setParent(this.card.node);
    this.progressNode.setPosition(0, -56, 0);
    this.progressNode.active = false;

    // 进度条底框
    const progBg = new Node("progress-bg");
    progBg.layer = this.root.layer;
    const bgG = progBg.addComponent(Graphics);
    bgG.fillColor = col(P.panelLight, 0.9);
    bgG.strokeColor = col(P.line, 0.3);
    bgG.lineWidth = 1;
    bgG.roundRect(TRACK_X, -TRACK_H / 2, TRACK_W, TRACK_H, TRACK_H / 2);
    bgG.fill();
    bgG.stroke();
    progBg.setParent(this.progressNode);

    // 进度条填充
    const progFillNode = new Node("progress-fill");
    progFillNode.layer = this.root.layer;
    this.progressFill = progFillNode.addComponent(Graphics);
    progFillNode.setParent(this.progressNode);

    // 进度主文字(百分比 / 已下载量)
    this.progressLabel = kit.label(this.progressNode, "准备下载...", 13, P.cyan);
    this.progressLabel.node.setPosition(0, -20, 0);

    // 进度副文字(速度 / 剩余时间 / 下载源)
    this.progressSub = kit.label(this.progressNode, "", 11, P.dim);
    this.progressSub.node.setPosition(0, -38, 0);

    // 按钮组(50 高:弹窗主行动键也过触控线)
    this.updateBtn = kit.button(this.card.node, "立即更新", 190, 50, {
      bg: P.accent,
      fg: P.ink,
      size: 16,
    });
    this.updateBtn.setPosition(-106, -132, 0);
    this.updateBtnLabel = this.updateBtn.children[0].getComponent(Label)!;

    this.cancelBtn = kit.button(this.card.node, "稍后再说", 190, 50, { size: 16 });
    this.cancelBtn.setPosition(106, -132, 0);
    this.cancelBtnLabel = this.cancelBtn.children[0].getComponent(Label)!;

    this.updateBtn.on(Button.EventType.CLICK, () => {
      kit.sfx.play("ui");
      this.onUpdateClicked();
    });

    this.cancelBtn.on(Button.EventType.CLICK, () => {
      kit.sfx.play("ui");
      this.onCancelClicked();
    });
  }

  /**
   * 唯一进度入口:原生下载器每 150ms 回一次真实字节,XHR 心跳每 250ms 回一次。
   */
  private renderProgress(p: DownloadProgress): void {
    const P = this.kit.pal;
    const g = this.progressFill;
    const sourceTag = p.sourceCount > 1 && p.sourceIndex > 0
      ? `源 ${p.sourceIndex + 1}/${p.sourceCount} · `
      : "";
    // 已经切过源就别再报首个源的失败感,提示当前走的域名
    const hostTag = p.sourceCount > 1 && p.sourceIndex > 0 ? `${p.host} · ` : "";

    g.clear();

    if (p.determinate) {
      const pct = Math.max(0, Math.min(100, p.percent));
      const fillW = Math.max(TRACK_H, (TRACK_W * pct) / 100);
      g.fillColor = col(P.cyan, 0.95);
      g.roundRect(TRACK_X, -TRACK_H / 2, fillW, TRACK_H, TRACK_H / 2);
      g.fill();

      const done = p.state === "done";
      this.progressLabel.string = done
        ? `下载完成 100% · ${fmtSize(p.total || p.loaded)}`
        : `${sourceTag}${pct}%  ${fmtSize(p.loaded)} / ${fmtSize(p.total)}`;

      if (done) {
        this.progressSub.string = "正在调起系统安装器…";
      } else if (p.state === "connecting") {
        this.progressSub.string = `${hostTag}正在连接 ${p.host}…`;
      } else {
        const remain = p.speed > 0 ? (p.total - p.loaded) / p.speed : 0;
        this.progressSub.string = `${hostTag}${fmtSize(p.speed)}/s · 剩余 ${fmtEta(remain)}`;
      }
      return;
    }

    // —— 不确定态:拿不到字节,只证明"还在下" ——
    // 呼吸条:1.2s 一个来回,靠 alpha 变化表示活着,不假装百分比
    const pulse = 0.45 + 0.35 * Math.abs(Math.sin((p.elapsedMs / 1200) * Math.PI));
    g.fillColor = col(P.cyan, pulse);
    g.roundRect(TRACK_X, -TRACK_H / 2, TRACK_W, TRACK_H, TRACK_H / 2);
    g.fill();

    const secs = Math.max(0, Math.round(p.elapsedMs / 1000));
    const totalText = p.total > 0 ? ` / ${fmtSize(p.total)}` : "";
    this.progressLabel.string = `${sourceTag}正在下载${totalText}`;
    this.progressSub.string = `${hostTag}已用 ${secs} 秒 · 完成后会自动弹出安装`;
  }

  /** 复位成"可以点立即更新"的样子 */
  private resetActions(primaryLabel: string): void {
    this.updateBtn.active = true;
    this.cancelBtn.active = true;
    this.updateBtnLabel.string = primaryLabel;
    this.cancelBtnLabel.string = "稍后再说";
  }

  /** 更新日志底框重绘:高度跟行数走,底缘固定在 -31(进度条 -56 之上留 18) */
  private paintNotesBox(lines: number): void {
    const P = this.kit.pal;
    const h = Math.min(NOTE_BOX_MAX, Math.max(NOTE_BOX_MIN, lines * NOTE_LINE_H + 18));
    const g = this.notesBoxG;
    this.notesBoxNode.getComponent(UITransform)!.setContentSize(420, h);
    this.notesBoxNode.setPosition(0, -31 + h / 2, 0);
    g.clear();
    drawHardShadow(g, 420, h, 8, 6, 6, 0.45);
    drawArcadePanel(g, 420, h, 8, 0.93);
    g.fillColor = col(P.panelLight, 0.6);
    g.roundRect(-210, -h / 2, 420, h, 8);
    g.fill();
    g.strokeColor = col(P.line, 0.15);
    g.lineWidth = 1;
    g.roundRect(-210, -h / 2, 420, h, 8);
    g.stroke();
  }

  show(info: UpdateInfo): void {
    cancelFade(this.root);
    this.session++;
    this.currentInfo = info;
    this.isDownloading = false;
    this.downloadedPath = "";

    this.verLabel.string = `新版本: ${info.tagName}`;
    this.sizeLabel.string = info.fileSizeText ? `安装包大小: ${info.fileSizeText}` : "安装包大小: 未知";
    const fitted = noteFit(info.releaseNotes || "修复已知问题，优化游戏体验。");
    this.notesLabel.string = fitted;
    this.paintNotesBox(fitted.split("\n").length);

    this.progressFill.clear();
    this.progressNode.active = false;
    this.resetActions("立即更新");

    this.root.active = true;
    slamIn(this.card.node);   // 入场与其它弹窗统一:slam 砸落(此前是干巴的瞬间出现)
  }

  hide(): void {
    if (this.isDownloading) {
      this.session++;
      UpdateService.instance.cancelDownload();
      this.isDownloading = false;
    }
    fadeOutHide(this.root);
  }

  /** 停止下载并把界面交回用户,不报错误 */
  private abortDownload(): void {
    this.session++;
    this.isDownloading = false;
    UpdateService.instance.cancelDownload();
    this.progressNode.active = false;
    this.progressFill.clear();
    this.resetActions("重新下载");
  }

  private async onUpdateClicked(): Promise<void> {
    const info = this.currentInfo;
    if (!info) return;

    if (this.downloadedPath) {
      // 已经下载完成，重新触发系统安装器
      const ok = UpdateService.instance.installApk(this.downloadedPath);
      if (!ok) {
        this.kit.toast("调起安装失败，请检查应用安装权限");
      }
      return;
    }

    if (this.isDownloading) return;

    // Web 浏览器环境直接打开下载链接
    if (!sys.isNative) {
      sys.openURL(info.downloadUrl);
      this.kit.toast("已打开下载链接");
      this.hide();
      return;
    }

    // 没有 APK 附件(只有 Release 页面)时别把网页当安装包下下来
    if (!info.hasApk) {
      sys.openURL(info.releaseUrl);
      this.kit.toast("已打开下载页面");
      return;
    }

    // Android 原生环境执行应用内下载
    const session = ++this.session;
    this.isDownloading = true;
    this.progressNode.active = true;
    this.progressFill.clear();
    this.progressLabel.string = "准备下载...";
    this.progressSub.string = "";
    this.updateBtnLabel.string = "正在下载...";
    this.cancelBtnLabel.string = "取消下载";

    const urls = info.candidateDownloadUrls.length
      ? info.candidateDownloadUrls
      : [info.downloadUrl];

    try {
      const filePath = await UpdateService.instance.downloadApk(
        urls,
        info.fileSize,
        (p) => {
          if (session !== this.session) return;
          this.renderProgress(p);
        }
      );

      if (session !== this.session) return;
      this.isDownloading = false;
      this.downloadedPath = filePath;
      this.progressLabel.string = "下载完成，正在调起安装...";
      this.progressSub.string = `安装包已存到: ${filePath.split("/").pop() || filePath}`;
      this.progressFill.clear();
      this.progressFill.fillColor = col(this.kit.pal.cyan, 0.95);
      this.progressFill.roundRect(TRACK_X, -TRACK_H / 2, TRACK_W, TRACK_H, TRACK_H / 2);
      this.progressFill.fill();
      this.resetActions("重新安装");
      this.kit.toast("下载完成，正在安装...");

      const installOk = UpdateService.instance.installApk(filePath);
      if (!installOk) {
        this.kit.toast("请点击「重新安装」授权并安装应用");
      }
    } catch (err: any) {
      if (session !== this.session) return;
      this.isDownloading = false;
      this.progressNode.active = false;
      this.progressFill.clear();
      this.resetActions("重试下载");
      const msg = err?.message || String(err);
      if (err?.name !== "DownloadCancelledError" && msg !== "已取消下载") {
        this.kit.toast(`更新下载失败: ${msg}`);
      }
    }
  }

  private onCancelClicked(): void {
    if (this.isDownloading) {
      this.abortDownload();
      this.kit.toast("已取消下载");
      return;
    }
    this.hide();
  }
}
