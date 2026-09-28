// ============================================================
// 应用内更新提示弹窗:版本号、更新说明、大小、进度条、下载与安装
// ============================================================
import { Button, Color, Graphics, Label, Node, sys, UITransform, Vec2 } from "cc";
import { col } from "./ui-manager";
import type { UiKit } from "./ui-manager";
import { formatBytes } from "../core/version";
import { UpdateInfo, UpdateService } from "../core/update-service";

export class UpdateDialog {
  readonly root: Node;
  private kit: UiKit;
  private card: Graphics;
  private verLabel: Label;
  private sizeLabel: Label;
  private notesLabel: Label;
  private progressNode: Node;
  private progressFill: Graphics;
  private progressLabel: Label;
  private updateBtn: Node;
  private updateBtnLabel: Label;
  private cancelBtn: Node;
  private currentInfo: UpdateInfo | null = null;
  private isDownloading = false;
  private downloadedPath = "";

  constructor(parent: Node, kit: UiKit) {
    this.kit = kit;
    const P = kit.pal;
    this.root = kit.root(parent, "update-dialog");
    this.root.active = false;

    // 半透明全屏暗底
    kit.dim(this.root, 0.75);

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

    // 更新日志背景底框
    const notesBox = kit.panel(this.card.node, 420, 110, {
      r: 8,
      bg: P.panelLight,
      bgAlpha: 0.6,
      stroke: P.line,
      strokeAlpha: 0.15,
    });
    notesBox.node.setPosition(0, 24, 0);

    // 更新日志文本
    this.notesLabel = kit.label(notesBox.node, "更新内容", 13, P.text, { align: 0 });
    this.notesLabel.overflow = Label.Overflow.CLAMP;
    this.notesLabel.node.getComponent(UITransform)?.setContentSize(390, 96);
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
    bgG.roundRect(-190, -7, 380, 14, 7);
    bgG.fill();
    bgG.stroke();
    progBg.setParent(this.progressNode);

    // 进度条填充
    const progFillNode = new Node("progress-fill");
    progFillNode.layer = this.root.layer;
    this.progressFill = progFillNode.addComponent(Graphics);
    progFillNode.setParent(this.progressNode);

    // 进度文字
    this.progressLabel = kit.label(this.progressNode, "准备下载...", 12, P.cyan);
    this.progressLabel.node.setPosition(0, -22, 0);

    // 按钮组
    this.updateBtn = kit.button(this.card.node, "立即更新", 180, 46, {
      bg: P.accent,
      fg: P.ink,
      size: 16,
    });
    this.updateBtn.setPosition(-104, -132, 0);
    this.updateBtnLabel = this.updateBtn.children[0].getComponent(Label)!;

    this.cancelBtn = kit.button(this.card.node, "稍后再说", 180, 46, { size: 16 });
    this.cancelBtn.setPosition(104, -132, 0);

    this.updateBtn.on(Button.EventType.CLICK, () => {
      kit.sfx.play("ui");
      this.onUpdateClicked();
    });

    this.cancelBtn.on(Button.EventType.CLICK, () => {
      kit.sfx.play("ui");
      this.onCancelClicked();
    });
  }

  private setProgress(percent: number, loadedText = "", totalText = ""): void {
    const P = this.kit.pal;
    const pct = Math.max(0, Math.min(100, percent));
    this.progressFill.clear();
    if (pct > 0) {
      const fillW = Math.max(14, (380 * pct) / 100);
      this.progressFill.fillColor = col(P.cyan, 0.95);
      this.progressFill.roundRect(-190, -7, fillW, 14, 7);
      this.progressFill.fill();
    }
    if (loadedText && totalText) {
      this.progressLabel.string = `下载中: ${pct}% (${loadedText} / ${totalText})`;
    } else {
      this.progressLabel.string = `下载中: ${pct}%`;
    }
  }

  show(info: UpdateInfo): void {
    this.currentInfo = info;
    this.isDownloading = false;
    this.downloadedPath = "";

    this.verLabel.string = `新版本: ${info.tagName}`;
    this.sizeLabel.string = info.fileSizeText ? `安装包大小: ${info.fileSizeText}` : "安装包大小: 未知";
    this.notesLabel.string = info.releaseNotes || "修复已知问题，优化游戏体验。";

    this.progressNode.active = false;
    this.updateBtn.active = true;
    this.cancelBtn.active = true;
    this.updateBtnLabel.string = "立即更新";

    this.root.active = true;
  }

  hide(): void {
    if (this.isDownloading) {
      UpdateService.instance.cancelDownload();
      this.isDownloading = false;
    }
    this.root.active = false;
  }

  private async onUpdateClicked(): Promise<void> {
    if (!this.currentInfo) return;

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
      sys.openURL(this.currentInfo.downloadUrl);
      this.kit.toast("已打开下载链接");
      this.hide();
      return;
    }

    // Android 原生环境执行应用内下载
    this.isDownloading = true;
    this.progressNode.active = true;
    this.setProgress(0);
    this.updateBtnLabel.string = "正在下载...";

    try {
      const info = this.currentInfo;
      const filePath = await UpdateService.instance.downloadApk(
        info.downloadUrl,
        info.fileSize,
        (loaded, total, pct) => {
          const lText = formatBytes(loaded);
          const tText = formatBytes(total);
          this.setProgress(pct, lText, tText);
        }
      );

      this.isDownloading = false;
      this.downloadedPath = filePath;
      this.progressLabel.string = "下载完成，正在调起安装...";
      this.updateBtnLabel.string = "重新安装";
      this.kit.toast("下载完成，正在安装...");

      const installOk = UpdateService.instance.installApk(filePath);
      if (!installOk) {
        this.kit.toast("请点击「重新安装」授权并安装应用");
      }
    } catch (err: any) {
      this.isDownloading = false;
      this.progressNode.active = false;
      this.updateBtnLabel.string = "重试下载";
      const msg = err?.message || String(err);
      this.kit.toast(`更新下载失败: ${msg}`);
    }
  }

  private onCancelClicked(): void {
    this.hide();
  }
}
