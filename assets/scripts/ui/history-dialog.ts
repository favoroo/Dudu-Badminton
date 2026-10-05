// ============================================================
// 「更新记录」弹窗:设置「关于」页进来,把两端 Releases 的**全部历史版本说明**
// 一屏读完。
//
// 数据从哪来:发布脚本把每一版的更新说明写进 Release 正文,老版本只清 APK 附件、
// 说明永久保留 —— 真话源就是 Releases 列表 API(update-service.fetchReleaseHistory,
// Gitee 优先、GitHub 备选、代理兜底,与「检查更新」同一条候选顺序)。拉取失败给
// 「重试」,绝不编一条假历史糊人;拉到的在进程内缓存,本次启动内再开不重取。
//
// 版式完全复用更新弹窗那套「说明井」:release-notes 算折行(同一把尺),
// notes-paint 照单摆字,notes-scroll 管裁切/拖动/触摸卫生。每个版本 =
// 版号表头(色条 + v 号 + 日期;当前版本以「当前版本」替代日期)+ 该版说明行,
// 自上而下新→旧叠。井固定高,几十个版本的说明几乎必然超窗 —— 滚动是常态,不是降级。
// ============================================================
import { Button, Color, Graphics, Label, Mask, Node, UITransform, Vec2 } from "cc";
import { col } from "./ui-manager";
import type { UiKit } from "./ui-manager";
import { cancelFade, drawBevelSlot, fadeOutHide, ROLE, SLANT, slamIn, textW } from "./ui-arcade";
import { buildNotes, NOTE } from "./release-notes";
import { clearNotePaint, paintNoteLine } from "./notes-paint";
import type { NotePaintDeps } from "./notes-paint";
import { NotesScroller } from "./notes-scroll";
import { UpdateService } from "../game/update-service";
import { formatHistoryDate, type ReleaseEntry } from "../core/release-history";
import { APP_VERSION_NAME } from "../core/version";

/** 卡片几何:固定高 —— 头 78 + 井 316 + 尾 76 = 470,设计高 540 上下各留 35 */
const CARD_W = 480;
const CARD_H = 470;
/** 卡顶 → 井顶缘:标题 40 / 副题 64 + 14 间隙 */
const HEAD_H = 78;
/** 井高(固定;内容超窗走滚动) */
const BOX_H = 316;
/** 井底缘 → 卡底:按钮区 */
const FOOT_H = 76;
/** 井宽沿用 release-notes 的折行尺(说明行宽、缩进都按它算) */
const BOX_W = NOTE.boxW;
/** 裁切窗比框再缩一点,斜切框缘里不贴字(与更新弹窗同一取值) */
const VIEW_INSET = 5;
/** 底部两颗按钮(左「重试/刷新」右「关闭」),中心对称 */
const BTN_W = 140;
const BTN_H = 44;
const BTN_Y = -CARD_H / 2 + FOOT_H / 2;
const BTN_X = [-78, 78];
/** 每个版本的表头行高(色条 + v 号 + 日期) */
const HEAD_ROW_H = 24;
/** 版本块之间的缝 */
const BLOCK_GAP = 8;

export class HistoryDialog {
  readonly root: Node;
  private kit: UiKit;
  private card: Graphics;
  private sub: Label;
  /** 载入中/失败的读数(挂在井中央;就绪态藏起 —— Label 的 active 开关没有
   *  Graphics 那条「重显隐身」的坑,见 ui-hide-check 文件头) */
  private stateLabel: Label;
  private stateSub: Label;
  private notesBoxNode: Node;
  private viewport: Node;
  private content: Node;
  private contentG: Graphics;
  private scroll: NotesScroller;
  private refreshBtn: Node;
  private refreshLabel: Label;
  /** 每轮显示/载入自增:在途的请求回来时靠它判断自己是否已过期 */
  private session = 0;
  private state: "loading" | "error" | "ready" = "loading";

  constructor(parent: Node, kit: UiKit) {
    this.kit = kit;
    const P = kit.pal;
    this.root = kit.root(parent, "history-dialog");
    this.root.active = false;

    // 半透明全屏暗底(与更新弹窗同款)
    kit.dim(this.root, 0.4, 0.74);

    // 居中卡片(固定高,show 不重绘 —— 本弹窗从不 active=false,无重传问题)
    this.card = kit.panel(this.root, CARD_W, CARD_H, {
      r: 16, bandHex: ROLE.primary.face,
    });
    this.card.node.setPosition(0, 0, 0);

    // 标题 + 副题(副题就绪后报「共 N 个版本」)
    const title = kit.label(this.card.node, "更新记录", 22, P.accent, { outline: P.ink, outlineW: 2 });
    title.enableShadow = true;
    title.shadowColor = new Color(0, 0, 0, 130);
    title.shadowOffset = new Vec2(0, -4);
    title.node.setPosition(0, CARD_H / 2 - 40, 0);
    this.sub = kit.label(this.card.node, "", 11, P.dim);
    this.sub.node.setPosition(0, CARD_H / 2 - 64, 0);

    // 说明井:凹陷槽(嵌在衬纸里的「挖进去」的内容井,不再叠第二层衬纸)
    const notesBox = kit.panel(this.card.node, BOX_W, BOX_H, { r: 8, plate: false, noShadow: true });
    this.notesBoxNode = notesBox.node;
    this.notesBoxNode.setPosition(0, CARD_H / 2 - HEAD_H - BOX_H / 2, 0);
    drawBevelSlot(notesBox, BOX_W, BOX_H, SLANT.block);

    // 可视窗 + 内容层:内容高于窗口时由 Mask 裁切,拖动 content 滚动(同更新弹窗)
    this.viewport = new Node("history-view");
    this.viewport.layer = this.root.layer;
    this.viewport.addComponent(UITransform).setContentSize(BOX_W - VIEW_INSET * 2, BOX_H - VIEW_INSET * 2);
    const mask = this.viewport.addComponent(Mask);
    mask.type = Mask.Type.GRAPHICS_RECT;
    mask.enabled = false;
    this.viewport.setParent(this.notesBoxNode);

    this.content = new Node("history-content");
    this.content.layer = this.root.layer;
    this.content.addComponent(UITransform).setContentSize(BOX_W, BOX_H);
    this.contentG = this.content.addComponent(Graphics);
    this.content.setParent(this.viewport);

    // 载入/失败读数:井中央两行,状态落成文字,不转假进度圈
    this.stateLabel = kit.label(this.notesBoxNode, "正在获取更新记录…", 13, P.dim);
    this.stateLabel.node.setPosition(0, 8, 0);
    this.stateSub = kit.label(this.notesBoxNode, "", 11, P.dim);
    this.stateSub.node.setPosition(0, -14, 0);

    // 滚动(裁切/拖动/箭头/触摸卫生)整体交给 NotesScroller,与更新弹窗同一份
    this.scroll = new NotesScroller({
      viewport: this.viewport, mask, content: this.content,
      hintParent: this.notesBoxNode, color: P.dim, layer: this.root.layer,
    });
    this.scroll.placeHints(BOX_W / 2 - 16, BOX_H / 2);

    // 底部按钮:两颗常驻(原生侧 active=false 会清 Graphics 渲染数据,重显就是空壳,
    // 见 update-dialog BTN_* 那段)—— 字随状态换:失败「重试」/ 就绪「刷新」
    this.refreshBtn = kit.button(this.card.node, "重试", BTN_W, BTN_H, { size: 15 });
    this.refreshBtn.setPosition(BTN_X[0], BTN_Y, 0);
    this.refreshLabel = this.refreshBtn.children[0].getComponent(Label)!;
    const closeBtn = kit.button(this.card.node, "关闭", BTN_W, BTN_H, { size: 16 });
    closeBtn.setPosition(BTN_X[1], BTN_Y, 0);

    this.refreshBtn.on(Button.EventType.CLICK, () => {
      kit.sfx.play("ui");
      if (this.state === "loading") return;   // 载入中再点不重复发请求
      this.load(true);                        // 重试/刷新都强制重取:可能有刚发布的版本
    });
    closeBtn.on(Button.EventType.CLICK, () => {
      kit.sfx.play("ui");
      this.hide();
    });
  }

  /** 画笔注入面:角色色从 pal 现取,Label 走 kit 工厂 */
  private get paint(): NotePaintDeps {
    const P = this.kit.pal;
    return { label: this.kit.label, accent: P.accent, dim: P.dim, text: P.text };
  }

  show(): void {
    cancelFade(this.root);
    // 抬到 Canvas 的最上层:设置页等是随开随建的晚到兄弟,各自带盖满屏的暗底
    // (BlockInputEvents),不抬就被压在底下 —— 看不见也点不着(与更新弹窗同一件事)
    const p = this.root.parent;
    if (p) this.root.setSiblingIndex(p.children.length - 1);
    this.scroll.setLive(true);
    this.session++;
    this.root.active = true;
    slamIn(this.card.node);

    const cached = UpdateService.instance.releaseHistory;
    if (cached && cached.length) {
      this.state = "ready";
      this.refreshLabel.string = "刷新";
      this.renderEntries(cached);
      return;
    }
    this.load(false);
  }

  hide(): void {
    this.session++;              // 在途请求回来不再动界面
    this.scroll.setLive(false);  // 拖动手势先卸干净:淡出期间隐形井不拦触摸
    fadeOutHide(this.root);
  }

  /** 拉取并落界面;force=true 无视进程内缓存(重试/刷新) */
  private async load(force: boolean): Promise<void> {
    const session = ++this.session;
    this.state = "loading";
    this.refreshLabel.string = "刷新";
    this.stateLabel.node.active = true;
    this.stateLabel.string = "正在获取更新记录…";
    this.stateSub.node.active = false;
    this.sub.string = "";
    clearNotePaint(this.content, this.contentG);
    try {
      const list = await UpdateService.instance.fetchReleaseHistory(force);
      if (session !== this.session) return;
      this.state = "ready";
      this.renderEntries(list);
    } catch (err: any) {
      if (session !== this.session) return;
      this.state = "error";
      this.stateLabel.string = `获取失败:${err?.message || String(err)}`;
      this.stateSub.node.active = true;
      this.stateSub.string = "点左下「重试」再试一次";
    }
  }

  /** 版本列表:表头(色条 + v 号 + 日期)+ 该版说明行,自上而下新→旧 */
  private renderEntries(entries: ReleaseEntry[]): void {
    const P = this.kit.pal;
    this.stateLabel.node.active = false;
    this.stateSub.node.active = false;
    this.sub.string = `共 ${entries.length} 个版本 · 上滑看更早的版本`;
    clearNotePaint(this.content, this.contentG);

    const viewH = BOX_H - VIEW_INSET * 2;
    // 内容总高:上下内边距 + Σ(表头 + 该版说明)+ 版本块间距 —— 与逐行 y 累加同一条账
    const blocks = entries.map((e) => buildNotes(e.notes || "", textW));
    let total = NOTE.padY * 2;
    blocks.forEach((b, i) => {
      total += HEAD_ROW_H + b.height + (i < blocks.length - 1 ? BLOCK_GAP : 0);
    });
    const contentH = Math.max(viewH, total);
    this.content.getComponent(UITransform)!.setContentSize(BOX_W, contentH);

    const g = this.contentG;
    let y = contentH / 2 - NOTE.padY;
    entries.forEach((e, i) => {
      // —— 表头:色条 + v 号(当前版本以青色「当前版本」替代日期位) ——
      const hcy = y - HEAD_ROW_H / 2;
      g.fillColor = col(P.accent, 0.9);
      g.rect(-BOX_W / 2 + NOTE.padX, hcy - 7, 3, 14);
      g.fill();
      const tag = this.kit.label(this.content, e.tagName, 14, P.accent, { align: 0 });
      tag.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
      tag.node.setPosition(-BOX_W / 2 + NOTE.padX + 10, hcy, 0);
      const isCur = e.tagName === APP_VERSION_NAME;
      const date = this.kit.label(this.content, isCur ? "当前版本" : formatHistoryDate(e.dateMs), 11, isCur ? P.cyan : P.dim, { align: 0 });
      date.node.getComponent(UITransform)!.setAnchorPoint(1, 0.5);
      date.node.setPosition(BOX_W / 2 - NOTE.padX, hcy, 0);
      y -= HEAD_ROW_H;
      // —— 该版说明:先垫 padY 再逐行(与 buildNotes 的高度账同一条累加式) ——
      const layout = blocks[i];
      let yy = y - NOTE.padY;
      for (const line of layout.lines) {
        yy -= line.lead;
        paintNoteLine(this.paint, g, this.content, line, yy - line.h / 2, BOX_W);
        yy -= line.h;
      }
      y -= layout.height + (i < entries.length - 1 ? BLOCK_GAP : 0);
    });

    this.scroll.setRange(contentH, viewH);
  }
}
