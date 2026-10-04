// ============================================================
// 应用内更新提示弹窗:版本号、更新说明、大小、进度条、下载与安装
//
// 三条出口,不是一条:「立即更新」= 应用内下完直接调系统安装器;
// 「浏览器下载」= 把安装包交给系统浏览器(代理源全挂、下载被墙时的第二条路);
// 「稍后再说」= 收窗,下次启动或再去设置「关于」页手动查。
//
// 进度显示为什么要分两态:
// Cocos 3.8 原生端的 XMLHttpRequest 是 jsb.XMLHttpRequest,底层一次性收完
// 整个响应才回调 JS,从不派发 progress 事件 —— 所以 Android 上的字节进度
// 来自 update-service 里的原生流式下载器(Java 线程 + 150ms 轮询)。
// 万一设备上的旧包没有这套原生下载器(反射失败回退 XHR),那时拿不到字节,
// 界面就诚实进入"不确定态":呼吸条 + 已用时长,绝不编一个百分比糊人。
//
// 更新说明为什么不能"一个 Label 塞整段":
// Release 正文是 markdown,原样进 Label 就是 v0.0.7 那次事故 —— `##`、`**SHA-256**:**`
// 连同 64 位哈希一起糊在标题和进度条上。现在改成:release-notes.ts 先把语法清洗成
// 带样式的物理行(折行宽度、行高、缩进都在那边算死),这里逐行摆独立 Label,
// 卡片高度跟着内容伸缩;内容超过可视高度时日志框开 Mask 裁切 + 拖动滚动。
// 于是「溢出」在结构上不再可能发生:要么框变高,要么内容可滚动,没有第三种。
// ============================================================
import { Button, Color, EventTouch, Graphics, Label, Mask, Node, sys, UIOpacity, UITransform, Vec2 } from "cc";
import { col } from "./ui-manager";
import type { UiKit } from "./ui-manager";
import {
  cancelFade, drawBevelSlot, drawChevron, drawPosterPlate, fadeOutHide, paintP5, progressDL,
  retainedDraw, ROLE, SLANT, slamIn, textW,
} from "./ui-arcade";
import { buildNotes, fitNotesBox, NOTE, NOTE_BOX } from "./release-notes";
import type { NoteLine } from "./release-notes";
import { browserDownloadUrl, DownloadProgress, UpdateInfo, UpdateService } from "../game/update-service";

/** 进度条轨道几何(与 ui-arcade 面板宽度配套);轨道与填充都以节点中心对称 */
const TRACK_W = 380;
const TRACK_H = 14;

/** 卡片宽度 */
const CARD_W = 480;
/** 卡顶 → 日志框顶缘:标题 40 / 版本 66 / 大小 86 + 13 间隙 */
const HEAD_H = 99;
/** 「安装包大小」行高;大小取不到(Gitee latest 不带 assets.size)时整行隐藏,头部按此收缩 */
const SIZE_ROW_H = 20;
/** 日志框底缘 → 卡底:进度条区 + 按钮区 */
const FOOT_H = 149;
/**
 * 按钮排布:三颗同宽 140、间距 10,中心排在 ±150 / 0(卡宽 480,左右各留 20)。
 * 为什么不给「藏一颗、两颗居中」的第二种排法:子节点 active=false 在原生侧会清掉
 * Graphics 的渲染数据(见 GraphicsKeepAlive),下次点亮就是块透明空壳 ——
 * 而 uiButton 的底是一次画死的,改宽就得重画。三颗常驻最省事也最不会骗人。
 */
const BTN_W = 140;
const BTN_H = 50;
const BTN_Y_OFF = 48;
const BTN_X = [-150, 0, 150];
/** 日志框可视高区间(与折行同一把尺,见 release-notes.NOTE_BOX) */
const BOX_MIN_H = NOTE_BOX.minH;
const BOX_W = NOTE.boxW;
/** 裁切窗比框再缩一点,斜切框缘里不贴字 */
const VIEW_INSET = 5;

/** 小节标记条 / 列表圆点的落点 */
const MARK_W = 3;
const DOT_R = 2;

/** 字节数 → 人话;小于 1 MB 用 KB,免得显示 0.0 MB */
function fmtSize(bytes: number): string {
  const b = Math.max(0, bytes || 0);
  if (b < 1024) return `${Math.round(b)} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
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
  private title: Label;
  private notesBoxG: Graphics;
  private notesBoxNode: Node;
  /** 日志可视窗:挂 Mask,只在需要滚动时启用 */
  private viewport: Node;
  private mask: Mask;
  /** 日志内容:标记(色条/圆点)画在这层的 Graphics 上,文字是它的子 Label */
  private content: Node;
  private contentG: Graphics;
  private hintUp: Node;
  private hintDown: Node;
  private verLabel: Label;
  private sizeLabel: Label;
  /** 本次弹窗是否显示大小行(false = 大小取不到,整行隐藏、头部收缩) */
  private sizeLineShown = true;
  private progressNode: Node;
  private progressFill: Graphics;
  /** 呼吸条靠它调 alpha(填充的显示列表是固定不透明度,不能逐帧改色) */
  private progressFillOp: UIOpacity;
  private progressLabel: Label;
  private progressSub: Label;
  private updateBtn: Node;
  private updateBtnLabel: Label;
  /** 「交给浏览器下」:应用内下载走不通(GitHub 直连被墙、代理源全挂)时的第二条路 */
  private browserBtn: Node;
  private cancelBtn: Node;
  private cancelBtnLabel: Label;
  private currentInfo: UpdateInfo | null = null;
  private isDownloading = false;
  private downloadedPath = "";
  /** 每轮下载/关窗都自增:在途的进度回调靠它判断自己是否已经过期 */
  private session = 0;
  /** 滚动状态:内容比可视窗高才有意义 */
  private scrollable = false;
  /** 可视窗的裸拖动手势是否挂在身上(只允许在弹窗亮着时挂,理由见 setDragLive) */
  private dragLive = false;
  private scrollMin = 0;
  private scrollMax = 0;
  private dragFromY: number | null = null;
  private dragBaseY = 0;

  constructor(parent: Node, kit: UiKit) {
    this.kit = kit;
    const P = kit.pal;
    this.root = kit.root(parent, "update-dialog");
    this.root.active = false;

    // 半透明全屏暗底
    kit.dim(this.root, 0.4, 0.74);

    // 居中卡片(高度随更新说明伸缩,show 时重绘)
    this.card = kit.panel(this.root, CARD_W, BOX_MIN_H + HEAD_H + FOOT_H, {
      r: 16, bandHex: ROLE.primary.face,
    });
    this.card.node.setPosition(0, 0, 0);

    // 标题
    this.title = kit.label(this.card.node, "发现新版本", 24, P.accent, { outline: P.ink, outlineW: 2 });
    this.title.enableShadow = true;
    this.title.shadowColor = new Color(0, 0, 0, 130);
    this.title.shadowOffset = new Vec2(0, -4);

    // 版本标签
    this.verLabel = kit.label(this.card.node, "v0.0.0", 14, P.cyan);

    // 安装包大小
    this.sizeLabel = kit.label(this.card.node, "大小: -- MB", 12, P.dim);

    // 更新日志底框(高度随公告行数自适应,show 时重绘)
    // plate:false —— 这是嵌在衬纸里的小框,再走一遍衬纸会叠出第二层撕口与第二道硬阴影
    const notesBox = kit.panel(this.card.node, BOX_W, BOX_MIN_H, { r: 8, plate: false, noShadow: true });
    this.notesBoxG = notesBox;
    this.notesBoxNode = notesBox.node;

    // 可视窗 + 内容层:内容高于窗口时由 Mask 裁切,拖动 content 滚动
    this.viewport = new Node("notes-view");
    this.viewport.layer = this.root.layer;
    this.viewport.addComponent(UITransform).setContentSize(BOX_W - VIEW_INSET * 2, BOX_MIN_H - VIEW_INSET * 2);
    this.mask = this.viewport.addComponent(Mask);
    this.mask.type = Mask.Type.GRAPHICS_RECT;
    this.mask.enabled = false;
    this.viewport.setParent(this.notesBoxNode);

    this.content = new Node("notes-content");
    this.content.layer = this.root.layer;
    this.content.addComponent(UITransform).setContentSize(BOX_W, BOX_MIN_H);
    this.contentG = this.content.addComponent(Graphics);
    this.content.setParent(this.viewport);

    // 滚动提示箭头:挂在框上而不是可视窗里,免得跟着内容一起被裁掉
    this.hintUp = this.makeHint(90);
    this.hintDown = this.makeHint(-90);
    this.hintUp.setParent(this.notesBoxNode);
    this.hintDown.setParent(this.notesBoxNode);
    this.setDragLive(true);

    // 进度条容器
    this.progressNode = new Node("progress-box");
    this.progressNode.layer = this.root.layer;
    this.progressNode.setParent(this.card.node);

    // 进度条底框:凹陷槽(与设置页滑杆轨道同一件,斜切 block 档)
    const progBg = new Node("progress-bg");
    progBg.layer = this.root.layer;
    const bgG = progBg.addComponent(Graphics);
    // progressNode 会在「待下载 / 下载中」之间整块开关,底框得能重放(见 ui-arcade.retainedDraw)
    retainedDraw(bgG, () => {
      paintP5(bgG, progressDL(TRACK_W, TRACK_H, 0, P.cyan).track);
    });
    progBg.setParent(this.progressNode);

    // 进度条填充
    const progFillNode = new Node("progress-fill");
    progFillNode.layer = this.root.layer;
    this.progressFill = progFillNode.addComponent(Graphics);
    this.progressFillOp = progFillNode.addComponent(UIOpacity);
    progFillNode.setParent(this.progressNode);

    // 进度主文字(百分比 / 已下载量)
    this.progressLabel = kit.label(this.progressNode, "准备下载...", 13, P.cyan);
    this.progressLabel.node.setPosition(0, -20, 0);

    // 进度副文字(速度 / 剩余时间 / 下载源)
    this.progressSub = kit.label(this.progressNode, "", 11, P.dim);
    this.progressSub.node.setPosition(0, -38, 0);

    // 按钮组(50 高:弹窗主行动键也过触控下限)。三颗同宽一排摆满卡底,理由见 BTN_* 那段。
    this.updateBtn = kit.button(this.card.node, "立即更新", BTN_W, BTN_H, {
      bg: P.accent,
      fg: P.ink,
      size: 16,
    });
    this.updateBtnLabel = this.updateBtn.children[0].getComponent(Label)!;

    this.browserBtn = kit.button(this.card.node, "浏览器下载", BTN_W, BTN_H, { size: 15 });
    this.cancelBtn = kit.button(this.card.node, "稍后再说", BTN_W, BTN_H, { size: 16 });
    this.cancelBtnLabel = this.cancelBtn.children[0].getComponent(Label)!;

    this.updateBtn.on(Button.EventType.CLICK, () => {
      kit.sfx.play("ui");
      this.onUpdateClicked();
    });

    this.browserBtn.on(Button.EventType.CLICK, () => {
      kit.sfx.play("ui");
      this.onBrowserClicked();
    });

    this.cancelBtn.on(Button.EventType.CLICK, () => {
      kit.sfx.play("ui");
      this.onCancelClicked();
    });
  }

  /** 滚动提示:一个旋转过的箭标节点(90 = 朝上,-90 = 朝下) */
  private makeHint(angle: number): Node {
    const n = new Node("scroll-hint");
    n.layer = this.root.layer;
    n.addComponent(UITransform).setContentSize(20, 20);
    const g = n.addComponent(Graphics);
    drawChevron(g, 7, this.kit.pal.dim, 0.85, 2);
    n.angle = angle;
    n.active = false;
    return n;
  }

  // ---------- 排版 ----------

  /** 卡片底:斜切衬纸,与 kit.panel(uiPanel)的默认画法同一配方,只是高度每次重算 */
  private paintCard(h: number): void {
    const g = this.card;
    this.card.node.getComponent(UITransform)!.setContentSize(CARD_W, h);
    g.clear();
    drawPosterPlate(g, CARD_W, h, { bandHex: ROLE.primary.face });
  }

  /** 更新日志底框重绘:凹陷槽(嵌在衬纸里的「挖进去」的内容井,不再走圆角渐变) */
  private paintNotesBox(h: number): void {
    const g = this.notesBoxG;
    this.notesBoxNode.getComponent(UITransform)!.setContentSize(BOX_W, h);
    g.clear();
    drawBevelSlot(g, BOX_W, h, SLANT.block);
  }

  /** 清空内容层(每次 show 重建 Label:更新说明一轮对话最多看几次,不值得做对象池) */
  private clearNotes(): void {
    for (const child of this.content.children.slice()) {
      child.removeFromParent();
      child.destroy();
    }
    this.contentG.clear();
  }

  /** 一行文字:按 span 从左往右排,anchor 压到 (0, .5) 才和 textW 量出来的宽度对得上 */
  private addNoteLine(line: NoteLine, cy: number): void {
    const P = this.kit.pal;
    const isHead = line.kind === "section";
    const size = isHead ? NOTE.headSize : NOTE.size;
    let x = -BOX_W / 2 + NOTE.padX + line.indent;
    const g = this.contentG;
    if (isHead) {
      g.fillColor = col(P.accent, 0.9);
      g.rect(-BOX_W / 2 + NOTE.padX, cy - 6, MARK_W, 12);
      g.fill();
    } else if (line.kind === "item") {
      g.fillColor = col(P.dim, 0.9);
      g.circle(-BOX_W / 2 + NOTE.padX + DOT_R, cy, DOT_R);
      g.fill();
    }
    for (const span of line.spans) {
      const label = this.kit.label(this.content, span.text, size, this.spanColor(span.strong, isHead), { align: 0 });
      label.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
      label.node.setPosition(x, cy, 0);
      x += textW(span.text, size);
    }
  }

  /** 小节 = 强调色;正文 = 纸白;md 的 **加粗** 用强调色顶上(原生无粗体字面,靠颜色分层) */
  private spanColor(strong: boolean, isHead: boolean): string {
    const P = this.kit.pal;
    if (isHead) return P.accent;
    return strong ? P.accent : P.text;
  }

  /**
   * 按更新说明重排整张卡:内容高 → 框高 → 卡高 → 各元素锚位。
   * 框高封顶后还剩内容 = 可滚动,封顶前 = 卡片变高,两条路都不允许文字出框。
   */
  private renderNotes(md: string): void {
    const layout = buildNotes(md, textW);
    const fit = fitNotesBox(layout.height);
    const boxH = fit.boxH;
    // 大小行隐藏时头部少一行,卡与框整体上提,不留空洞
    const headH = this.sizeLineShown ? HEAD_H : HEAD_H - SIZE_ROW_H;
    const cardH = boxH + headH + FOOT_H;
    const top = cardH / 2;
    const bottom = -cardH / 2;
    const boxCY = top - headH - boxH / 2;

    this.paintCard(cardH);
    this.title.node.setPosition(0, top - 40, 0);
    this.verLabel.node.setPosition(0, top - (this.sizeLineShown ? 66 : 62), 0);
    this.sizeLabel.node.setPosition(0, top - 86, 0);
    this.paintNotesBox(boxH);
    this.notesBoxNode.setPosition(0, boxCY, 0);
    this.progressNode.setPosition(0, bottom + 124, 0);
    this.updateBtn.setPosition(BTN_X[0], bottom + BTN_Y_OFF, 0);
    this.browserBtn.setPosition(BTN_X[1], bottom + BTN_Y_OFF, 0);
    this.cancelBtn.setPosition(BTN_X[2], bottom + BTN_Y_OFF, 0);

    // 可视窗与裁切
    const viewH = boxH - VIEW_INSET * 2;
    this.viewport.getComponent(UITransform)!.setContentSize(BOX_W - VIEW_INSET * 2, viewH);
    this.scrollable = fit.scrollable;
    this.mask.enabled = this.scrollable;

    // 内容层:比窗口高就按窗口顶部对齐往下排;框被撑到最小高以上时整块垂直居中
    const contentH = Math.max(boxH, layout.height);
    const blockH = Math.min(contentH, layout.height);
    this.content.getComponent(UITransform)!.setContentSize(BOX_W, contentH);
    this.clearNotes();
    let y = contentH / 2 - (contentH - blockH) / 2 - NOTE.padY;
    for (const line of layout.lines) {
      y -= line.lead;
      this.addNoteLine(line, y - line.h / 2);
      y -= line.h;
    }

    this.scrollMax = this.scrollable ? (contentH - viewH) / 2 : 0;
    this.scrollMin = -this.scrollMax;
    this.setScrollY(this.scrollMax);   // 打开时从第一条说明看起
  }

  /** 设滚动位并刷新箭头:钳到 [min, max],到顶/到底就把对应箭头收掉 */
  private setScrollY(v: number): void {
    const y = Math.max(this.scrollMin, Math.min(this.scrollMax, v));
    this.content.setPosition(0, y, 0);
    const boxH = this.notesBoxNode.getComponent(UITransform)!.height;
    this.hintUp.setPosition(BOX_W / 2 - 16, boxH / 2 - 12, 0);
    this.hintDown.setPosition(BOX_W / 2 - 16, -boxH / 2 + 12, 0);
    this.hintUp.active = this.scrollable && y < this.scrollMax - 1;
    this.hintDown.active = this.scrollable && y > this.scrollMin + 1;
  }

  private onDragStart(e: EventTouch): void {
    if (!this.scrollable) return;
    this.dragFromY = e.getUILocation().y;
    this.dragBaseY = this.content.position.y;
  }

  private onDragMove(e: EventTouch): void {
    if (!this.scrollable || this.dragFromY === null) return;
    this.setScrollY(this.dragBaseY + (e.getUILocation().y - this.dragFromY));
  }

  private onDragEnd(): void {
    this.dragFromY = null;
  }

  // ---------- 进度 ----------

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
      // 与旧胶囊同款:再空也露一颗 14 宽的斜切头(progressDL 内部对过窄填充不画)
      const t = Math.max(pct / 100, TRACK_H / TRACK_W);
      this.progressFillOp.opacity = 255;
      paintP5(g, progressDL(TRACK_W, TRACK_H, t, P.cyan).fill);

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
    // 呼吸条:1.2s 一个来回,靠填充节点的透明度表示活着,不假装百分比
    const pulse = 0.45 + 0.35 * Math.abs(Math.sin((p.elapsedMs / 1200) * Math.PI));
    this.progressFillOp.opacity = Math.round(255 * pulse);
    paintP5(g, progressDL(TRACK_W, TRACK_H, 1, P.cyan).fill);

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

  /**
   * 日志可视窗的拖动手势随弹窗亮/关挂卸。
   *
   * 与无限练习弹窗同一件事:`fadeOutHide` 的隐藏不 deactivate,只关掉子树里的
   * Button / BlockInputEvents 组件,而裸 `Node.EventType.TOUCH_*` 监听照旧接活;
   * 引擎派发默认吞噬触摸(见 UIEvent.preventSwallow 注释),所以关掉的弹窗会在屏幕
   * 正中留一块隐形的「日志窗」挡板,把落在它范围内的按键全吃掉。
   */
  private setDragLive(on: boolean): void {
    if (this.dragLive === on) return;
    this.dragLive = on;
    const T = Node.EventType;
    if (on) {
      this.viewport.on(T.TOUCH_START, this.onDragStart, this);
      this.viewport.on(T.TOUCH_MOVE, this.onDragMove, this);
      this.viewport.on(T.TOUCH_END, this.onDragEnd, this);
      this.viewport.on(T.TOUCH_CANCEL, this.onDragEnd, this);
    } else {
      this.viewport.off(T.TOUCH_START, this.onDragStart, this);
      this.viewport.off(T.TOUCH_MOVE, this.onDragMove, this);
      this.viewport.off(T.TOUCH_END, this.onDragEnd, this);
      this.viewport.off(T.TOUCH_CANCEL, this.onDragEnd, this);
    }
  }

  show(info: UpdateInfo): void {
    cancelFade(this.root);
    // 抬到 Canvas 的最上层:设置 / 商店 / 训练场是随开随建的晚到兄弟,各自带一块
    // 盖满屏的暗底(BlockInputEvents)。不抬,从设置「关于」页查出来的弹窗就压在
    // 那块暗底底下 —— 看不见也点不着,症状和"检查更新没反应"一模一样。
    const p = this.root.parent;
    if (p) this.root.setSiblingIndex(p.children.length - 1);
    this.setDragLive(true);
    this.session++;
    this.currentInfo = info;
    this.isDownloading = false;
    this.downloadedPath = "";

    this.verLabel.string = `新版本: ${info.tagName}`;
    this.sizeLineShown = Boolean(info.fileSizeText);
    this.sizeLabel.node.active = this.sizeLineShown;
    this.sizeLabel.string = info.fileSizeText ? `安装包大小: ${info.fileSizeText}` : "";
    this.renderNotes(info.releaseNotes || "");

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
    // 拖动手势先卸干净:淡出期间那块隐形日志窗不该还拦着触摸
    this.setDragLive(false);
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
      this.progressFillOp.opacity = 255;
      paintP5(this.progressFill, progressDL(TRACK_W, TRACK_H, 1, this.kit.pal.cyan).fill);
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

  /**
   * 把安装包交给浏览器下:系统浏览器自己处理重定向、断点续传和「下载完点安装」的通知,
   * 应用内那条路(原生流式下载器 / XHR)被墙或被代理源拖死时,这是能走通的第二条路。
   * 落点算法与设置「关于」页共用 `browserDownloadUrl()`,两边不许各拼一份。
   */
  private onBrowserClicked(): void {
    const info = this.currentInfo;
    if (!info) return;
    sys.openURL(browserDownloadUrl(info));
    this.kit.toast("已交给浏览器打开发布页");
  }
}
