// ============================================================
// 新手教学面板:讲解页(演示画布 + ①②③)→ 实操页(顶部横幅,场上可操作)→ 完成页。
//
// 双形态是这一屏的命门:讲解页要占住视线(整页暗底 + 大卡),实操页要**把场地
// 完全让出来** —— 滑轨与击球键都住在屏幕下半,大卡收成顶部横幅,横幅只在自己
// 那块节点上挂 BlockInputEvents,绝不全屏遮罩(挡了滑轨,「把人拖进圈」就练不了)。
//
// 页面切换一律整树销毁重建(与 settings-panel「切页即重建」同一条路,规避
// UIRenderer.onDisable destroyRenderData 的原生坑);每帧只有演示画布在重画。
// 状态推进的真话在 core/tutorial.ts:面板只轮询门控快照做转场,自己不判「练没练成」。
//
// 视觉 = P5 大色块:整页墨底 + 衬纸(L1)+ 分区色带(L2)+ 凸键/凹槽成对。
// 面板插在暂停面板之下(ui-manager 传 below):教学里按暂停,暂停页要盖得住讲解卡。
// ============================================================
import {
  BlockInputEvents, Button, Color, Component, Graphics, Label, Layers, Node, UITransform, Widget, _decorator,
} from "cc";
import { Career } from "../core/career";
import { CFG, TUTORIAL_TOPICS } from "../core/config";
import { textW } from "../core/text-metrics";
import { Tutorial } from "../core/tutorial";
import type { TutTopic } from "../core/types";
import * as TutorialAnim from "../render/tutorial-anim";
import type { Callout } from "../render/tutorial-anim";
import {
  ac, drawBevelSlot, drawP5Block, drawPosterPlate, drawSectionBand, drawStarGlyph,
  fadeOutHide, inkFor, mkLabel as uiMkLabel, retainedDraw, ROLE, SLANT, slamIn, skewOf, slantPath, uiIconButton,
} from "./ui-arcade";
import type { UiKit } from "./ui-manager";
import { C } from "./p5-tokens";
import { clearKids, faceOf, pressable, uinode } from "./ui-shell";
import {
  BAR_TITLE, DONE, KEYS, SECTIONS, TUT, bannerBadge, bannerLayout, bottomRow, briefInfo, closeHit,
  demoBox, doneLayout, headInfoBand, titleBand, widthOf, centerX, type Box,
} from "./tutorial-layout";

const { ccclass } = _decorator;

/** 叠在演示画布上的标字上限(三段演示最多同时 1 条,留富余) */
const CALLOUT_MAX = 3;

function mkLabel(
  parent: Node, name: string, text: string,
  size: number, color: string | Color = C.paper,
  opts: { x?: number; y?: number; w?: number; align?: 0 | 1 | 2; lines?: number; disp?: boolean; shrink?: boolean } = {},
): Label {
  const lines = opts.lines ?? 1;
  return uiMkLabel(parent, name, text, size, color, {
    x: opts.x, y: opts.y, w: opts.w ?? 200, lines,
    lineH: Math.round(size * 1.3),
    contentH: Math.round(size * 1.4) * lines,
    align: opts.align ?? 0,
    anchor: "center",
    overflow: opts.shrink ? Label.Overflow.SHRINK : Label.Overflow.CLAMP,
    disp: opts.disp,
  });
}

/** 照 Box 摆一段文字(中心锚;左对齐时文字从 box.left 起) */
function txt(
  parent: Node, name: string, text: string, size: number, color: string | Color, b: Box,
  align: 0 | 1 | 2 = 0, o: { lines?: number; disp?: boolean; shrink?: boolean } = {},
): Label {
  return mkLabel(parent, name, text, size, color, {
    x: centerX(b), y: b.cy, w: widthOf(b), align, lines: o.lines, disp: o.disp, shrink: o.shrink,
  });
}

/** 分区色带(整面 accent 实底 + 由面色亮度算字色;底块登记重放防原生清渲染数据) */
function band(parent: Node, name: string, text: string, b: Box, role: Parameters<typeof faceOf>[0], size = 13): void {
  const w = widthOf(b);
  const n = uinode(name, parent, w, b.h);
  n.setPosition(centerX(b), b.cy, 0);
  const face = faceOf(role);
  const g = n.addComponent(Graphics);
  retainedDraw(g, () => drawSectionBand(g, w, b.h, face));
  mkLabel(n, "txt", text, size, inkFor(face), { x: -w / 2 + 12, y: 0, w: w - 20, align: 0 });
}

interface ChipHandle { node: Node; paint(cur: boolean, done: boolean): void }

export interface TutorialOpts {
  /** 收摊(✕ / 跳过 / 完成-回主菜单):ui-manager 负责 screenSwap 回菜单 */
  onExit: () => void;
  /** 完成-「去打一局」:ui-manager 负责收教学局并切对练屏 */
  onGoPlay: () => void;
  /** 教学根节点插到这个节点之下(暂停页要盖得住讲解卡) */
  below?: Node;
}

@ccclass("TutorialPanel")
export class TutorialPanel extends Component {

  // ---------- 公开接口 ----------

  show(parent: Node, kit: UiKit, opts: TutorialOpts): void {
    this._kit = kit;
    this._opts = opts;
    this._mode = "brief";
    this._topic = Math.min(Tutorial.curTopic(), TUTORIAL_TOPICS.length - 1);
    this._buildAll();
    if (this.root && this.root !== parent) this.root.setParent(parent);
    if (opts.below && this.root) this.root.setSiblingIndex(opts.below.getSiblingIndex());
    this._buildPage();
    if (this._panelNode) slamIn(this._panelNode);
  }

  /** markSeen=true 时落「看过了」存档(✕/跳过/完成都是明确意图;暂停-退出不算) */
  hide(markSeen: boolean): void {
    if (markSeen) Career.setTutorialDone();
    Tutorial.end();                       // 恢复教学前临时切掉的操作方式(幂等)
    this._kit = null;
    this._opts = null;
    this._mode = "brief";
    const r = this.root;
    if (r && r.isValid) fadeOutHide(r, () => { if (r.isValid) r.destroy(); });
    this.root = null!;
    this._panelNode = null;
    this._page = null;
    this._bannerLayer = null;
    this._headInfo = null;
  }

  // ---------- 内部状态 ----------

  private root!: Node;
  private _panelNode: Node | null = null;
  private _page: Node | null = null;
  private _overlay: Node | null = null;
  private _kit: UiKit | null = null;
  private _opts: TutorialOpts | null = null;
  private _headInfo: Label | null = null;

  private _mode: "brief" | "practice" | "done" = "brief";
  private _topic = 0;

  // 讲解页缓存
  private _animGfx: Graphics | null = null;
  private _rig: TutorialAnim.TutRig | null = null;
  private _calloutLabels: Label[] = [];
  private _chips: ChipHandle[] = [];

  // 实操横幅缓存(每帧按变化刷新提示行)
  private _bannerHint: Label | null = null;
  private _bannerHintText = "\u0000";
  private _celebrated = false;
  private _celebrateT = 0;

  // ========== 节点搭建 ==========

  private _buildAll(): void {
    this.root = new Node("tutorial-panel");
    this.root.layer = Layers.Enum.UI_2D;
    this.root.addComponent(UITransform).setContentSize(960, 540);
    const wg = this.root.addComponent(Widget);
    wg.isAlignTop = wg.isAlignBottom = wg.isAlignLeft = wg.isAlignRight = true;
    wg.top = wg.bottom = wg.left = wg.right = 0;

    // 讲解/完成页整页墨底(挡住球场与虚拟按键:读讲解时不吃触摸);
    // 实操页销毁这层,只剩横幅自己带 BlockInputEvents。
    const overlay = uinode("overlay", this.root, 960, 540);
    const og = overlay.addComponent(Graphics);
    og.fillColor = ac(C.ink, 1);
    og.rect(-2000, -1000, 4000, 2000);
    og.fill();
    overlay.addComponent(BlockInputEvents);
    this._overlay = overlay;

    const panel = uinode("panel", this.root, TUT.pw, TUT.ph);
    panel.setPosition(0, TUT.panelY, 0);
    const pg = panel.addComponent(Graphics);
    retainedDraw(pg, () => drawPosterPlate(pg, TUT.pw, TUT.ph, {
      bandHex: ROLE.info.face, halftone: true,
    }));
    this._panelNode = panel;

    this._page = uinode("page", panel, TUT.pw, TUT.ph);
    this._buildTopBar(panel);

    // 实操横幅的独立层:实操态把**整张讲解卡**(衬纸+顶栏+暗底)都收掉,只留横幅 ——
    // 卡留在场上就是一堵黑板,挡住目标圈和人,「把人拖进圆圈」根本没法练。
    this._bannerLayer = uinode("bannerLayer", this.root, 960, 540);
  }

  private _bannerLayer: Node | null = null;

  private _buildTopBar(panel: Node): void {
    band(panel, "title", BAR_TITLE, titleBand(), "info", 16);
    this._headInfo = txt(panel, "headInfo", "", 13, C.dim, headInfoBand(), 2);
    const hit = closeHit();
    const back = uiIconButton(panel, "✕", { hit: widthOf(hit), vis: 36, fontSize: 18 });
    back.setPosition(centerX(hit), hit.cy, 0);
    back.on(Button.EventType.CLICK, () => {
      this._kit?.sfx.play("back");
      const onExit = this._opts?.onExit;
      this.hide(true);                  // ✕ = 明确收下:落「看过了」,下次不再自动弹
      onExit?.();
    });
  }

  // ========== 页面切换(整树销毁重建) ==========

  private _buildPage(): void {
    const page = this._page;
    if (!page) return;
    clearKids(page);
    this._animGfx = null;
    this._rig = null;
    this._calloutLabels = [];
    this._chips = [];
    this._bannerHint = null;
    this._celebrated = false;
    this._celebrateT = 0;
    this._bannerHintText = "\u0000";

    const practicing = this._mode === "practice";
    if (this._overlay) this._overlay.active = !practicing;
    if (this._panelNode) this._panelNode.active = !practicing;
    clearKids(this._bannerLayer!);
    if (practicing) {
      this._buildBanner(TUTORIAL_TOPICS[this._topic]);
    } else {
      if (this._mode === "brief") this._buildBrief(TUTORIAL_TOPICS[this._topic]);
      else this._buildDone();
      this._syncHeadInfo();
    }
  }

  private _syncHeadInfo(): void {
    if (this._headInfo) {
      this._headInfo.string = `已完成 ${Tutorial.doneCount()} / ${TUTORIAL_TOPICS.length}`;
    }
  }

  // ========== 讲解页 ==========

  private _buildBrief(topic: TutTopic): void {
    const page = this._page;
    if (!page) return;
    Tutorial.setTopic(this._topic);
    Tutorial.setPracticing(false);

    const info = briefInfo(topic);
    const demo = demoBox();
    const row = bottomRow();

    // ---------- ① 演示画布(凹槽底 + 每帧重画的动画) ----------
    const slot = uinode("demoBg", page, widthOf(demo), demo.h);
    slot.setPosition(centerX(demo), demo.cy, 0);
    const slg = slot.addComponent(Graphics);
    retainedDraw(slg, () => drawBevelSlot(slg, widthOf(demo), demo.h, SLANT.block, C.ink));

    const gfxNode = uinode("demoGfx", page, widthOf(demo), demo.h);
    gfxNode.setPosition(centerX(demo), demo.cy, 0);
    this._animGfx = gfxNode.addComponent(Graphics);
    this._rig = TutorialAnim.build(this._topic);

    // 标字层:「这一条不显示」= string 置空,不走 active(原生坑)
    for (let i = 0; i < CALLOUT_MAX; i++) {
      const lb = mkLabel(page, `callout${i}`, "", 12, C.paper, {
        x: centerX(demo), y: demo.cy, w: widthOf(demo) - 16, shrink: true,
      });
      lb.node.layer = Layers.Enum.UI_2D;
      this._calloutLabels.push(lb);
    }

    // ---------- ② 右列:名称 / 怎么玩 / 编号行 / 练一练带 / 提示 ----------
    txt(page, "name", `${this._topic + 1} · ${topic.label}`, TUT.nameSize, C.paper, info.name, 0, { disp: true });
    band(page, "howTo", SECTIONS.howTo, info.howTo, "info", TUT.bandSize);
    // 编号行:折行结果一格一行(layout 判据钉死两边一致)
    const flat: string[] = [];
    for (let i = 0; i < topic.lines.length; i++) flat.push(`${i + 1}  ${topic.lines[i]}`);
    info.lineRows.forEach((b, i) => {
      txt(page, `row${i}`, flat[i] ?? "", TUT.lineSize, C.paper, b, 0);
    });
    band(page, "practice", topic.practice, info.practice, "star", TUT.bandSize);
    txt(page, "hint", topic.hint, TUT.hintSize, C.dim, info.hint, 0);

    // ---------- ③ 底排:‹ › + 三个主题 chip + 跳过/去练一练 ----------
    this.chev(page, "chevL", row.chevL, -1, () => this._gotoTopic(this._topic - 1));
    this.chev(page, "chevR", row.chevR, 1, () => this._gotoTopic(this._topic + 1));
    row.chips.forEach((b, i) => {
      const chip = this.chip(page, `chip${i}`, b, i);
      this._chips.push(chip);
      chip.node.on(Button.EventType.CLICK, () => this._gotoTopic(i));
    });
    this.key(page, "skip", row.skip, ROLE.off.face, KEYS.skip, () => {
      this._kit?.sfx.play("back");
      const onExit = this._opts?.onExit;
      this.hide(true);
      onExit?.();
    });
    this.key(page, "go", row.go, ROLE.primary.face, KEYS.go, () => {
      this._kit?.sfx.play("ui");
      this._mode = "practice";
      this._buildPage();
    });

    this._syncChips();
    this._syncCallouts(widthOf(demo), demo.h);
  }

  private _gotoTopic(i: number): void {
    const next = Math.max(0, Math.min(TUTORIAL_TOPICS.length - 1, i));
    if (next === this._topic && this._mode === "brief") return;
    this._kit?.sfx.play("ui");
    this._topic = next;
    this._mode = "brief";
    this._buildPage();
  }

  private _syncChips(): void {
    this._chips.forEach((chip, i) => {
      chip.paint(i === this._topic, Tutorial.gateDone(i));
    });
  }

  // ========== 实操横幅 ==========

  private _buildBanner(topic: TutTopic): void {
    const layer = this._bannerLayer;
    if (!layer) return;
    Tutorial.setTopic(this._topic);
    Tutorial.setPracticing(true);

    const bn = bannerLayout(topic);
    const W = TUT.bannerW, H = TUT.bannerH;

    const node = uinode("banner", layer, W, H);
    node.setPosition(0, TUT.bannerY, 0);
    // 横幅底:墨面实底 + 青色 keyline,斜切平行四边形(与对局内 DEUCE 横幅同语汇);**只在这里**挂 BlockInputEvents
    const g = node.addComponent(Graphics);
    retainedDraw(g, () => {
      const skew = skewOf(H, SLANT.block);
      g.fillColor = ac(C.ink, 0.92);
      slantPath(g, W, H, skew);
      g.fill();
      g.strokeColor = ac(ROLE.info.face, 0.9);
      g.lineWidth = 2;
      slantPath(g, W, H, skew);
      g.stroke();
    });
    node.addComponent(BlockInputEvents);

    // badge 色带(定宽槽,文案「实操 i/3」/「完成」都在里面居中)
    band(node, "badge", bannerBadge(this._topic), bn.badge, "info", TUT.bandSize);

    txt(node, "main", topic.practice, 17, C.paper, bn.main, 0, { disp: true });
    this._bannerHint = txt(node, "hint", topic.hint, TUT.hintSize, C.dim, bn.hint, 0, { disp: true });

    this.key(node, "see", bn.see, ROLE.off.face, KEYS.back, () => {
      this._kit?.sfx.play("ui");
      this._mode = "brief";
      this._buildPage();
    });

    this._syncBanner(true);
  }

  /** 横幅的动态提示行:完成 → 「完成!」;击球实操 → 有效计数与失败原因;其余 → 静态提示 */
  private _syncBanner(force: boolean): void {
    if (!this._bannerHint) return;
    const topic = TUTORIAL_TOPICS[this._topic];
    const done = Tutorial.gateDone(this._topic);
    let hintText: string;
    if (done) hintText = "完成!就是这样";
    else if (this._topic === 1) {
      const p = Tutorial.hitProgress();
      const fail = Tutorial.curFail();
      hintText = `有效 ${p.done}/${p.goal}${fail ? " · " + fail : ""}`;
    } else hintText = topic.hint;

    if (force || hintText !== this._bannerHintText) {
      this._bannerHintText = hintText;
      this._bannerHint.string = hintText;
      this._bannerHint.color = ac(done ? C.good : Tutorial.curFail() ? "#ffaaa0" : C.dim);
    }
  }

  // ========== 完成页 ==========

  private _buildDone(): void {
    const page = this._page;
    if (!page) return;
    Career.setTutorialDone();
    this._kit?.sfx.play("win");

    const D = doneLayout();
    txt(page, "done", DONE.title, TUT.doneSize, C.acid, D.title, 1, { disp: true });
    txt(page, "sub", DONE.sub, TUT.doneSubSize, C.dim, D.sub, 1);
    this.key(page, "goPlay", D.go, ROLE.primary.face, KEYS.done, () => {
      this._kit?.sfx.play("ui");
      const onGoPlay = this._opts?.onGoPlay;
      this.hide(true);
      onGoPlay?.();
    });
    this.key(page, "menu", D.menu, ROLE.off.face, KEYS.menu, () => {
      this._kit?.sfx.play("back");
      const onExit = this._opts?.onExit;
      this.hide(true);
      onExit?.();
    });
    this._syncHeadInfo();
  }

  // ========== 每帧 ==========

  update(dt: number): void {
    if (!this.root || !this.root.isValid) return;
    if (this._mode === "brief" && this._rig && this._animGfx) {
      TutorialAnim.advance(this._rig, dt);
      const demo = demoBox();
      TutorialAnim.drawFrame(this._animGfx, this._rig, widthOf(demo), demo.h);
      this._syncCallouts(widthOf(demo), demo.h);
    } else if (this._mode === "practice") {
      this._syncBanner(false);
      if (Tutorial.gateDone(this._topic)) {
        if (!this._celebrated) {
          this._celebrated = true;
          this._celebrateT = 0;
          this._kit?.sfx.play("score");
        } else {
          this._celebrateT += dt;
          if (this._celebrateT >= 1.0) {
            // 完成一个主题:下一项的讲解页;全完成 → 完成页
            if (this._topic < TUTORIAL_TOPICS.length - 1) {
              this._topic++;
              this._mode = "brief";
              this._buildPage();
            } else {
              this._mode = "done";
              this._buildPage();
            }
          }
        }
      }
    }
  }

  /** 画布标字:内容来自 TutorialAnim.callouts(与动画同一帧的舞台状态) */
  private _syncCallouts(w: number, h: number): void {
    const rig = this._rig;
    if (!rig) return;
    const list = TutorialAnim.callouts(rig, w, h);
    const demo = demoBox();
    const ax = centerX(demo), ay = demo.cy;
    for (const [i, lb] of this._calloutLabels.entries()) {
      const c: Callout | undefined = list[i];
      if (!c) { lb.string = ""; continue; }
      lb.string = c.text;
      lb.fontSize = c.size;
      lb.lineHeight = Math.round(c.size * 1.25);
      lb.color = ac(c.hex);
      lb.node.setPosition(ax + c.x, ay + c.y, 0);
    }
  }

  // ========== 建块辅助(照 drill-panel.key) ==========

  /** 斜切实底键 */
  private key(parent: Node, name: string, b: Box, face: string, text: string, tap: () => void): Node {
    const n = uinode(name, parent, widthOf(b), b.h);
    n.setPosition(centerX(b), b.cy, 0);
    const g = n.addComponent(Graphics);
    retainedDraw(g, () => drawP5Block(g, widthOf(b), b.h, face, SLANT.button));
    mkLabel(n, "txt", text, 14, inkFor(face), { x: 0, y: 0, w: widthOf(b) - 12, align: 1 });
    pressable(n, 0.94);
    n.on(Button.EventType.CLICK, tap);
    return n;
  }

  /** ‹ › 翻题箭头(到头置灰,点了只是不动) */
  private chev(parent: Node, name: string, b: Box, dir: number, tap: () => void): void {
    const n = uinode(name, parent, widthOf(b), b.h);
    n.setPosition(centerX(b), b.cy, 0);
    const g = n.addComponent(Graphics);
    retainedDraw(g, () => {
      drawBevelSlot(g, widthOf(b), b.h, SLANT.block, C.navy);
      g.strokeColor = ac(C.paper, 0.8);
      g.lineWidth = 3;
      const s = 9;
      if (dir < 0) {
        g.moveTo(s * 0.4, -s); g.lineTo(-s * 0.4, 0); g.lineTo(s * 0.4, s);
      } else {
        g.moveTo(-s * 0.4, -s); g.lineTo(s * 0.4, 0); g.lineTo(-s * 0.4, s);
      }
      g.stroke();
    });
    pressable(n, 0.94);
    n.on(Button.EventType.CLICK, tap);
  }

  /** 主题 chip:当前 = 实底荧光黄,练成 = 实底绿,其余 = 凹槽 */
  private chip(parent: Node, name: string, b: Box, i: number): ChipHandle {
    const n = uinode(name, parent, widthOf(b), b.h);
    n.setPosition(centerX(b), b.cy, 0);
    const g = n.addComponent(Graphics);
    const label = mkLabel(n, "txt", `${i + 1} ${TUTORIAL_TOPICS[i].label}`, TUT.bandSize, C.dim, {
      x: 0, y: 0, w: widthOf(b) - 10, align: 1,
    });
    pressable(n, 0.94);
    const paint = (cur: boolean, done: boolean): void => {
      g.clear();
      const face = cur ? C.acid : done ? C.good : "";
      if (face) {
        drawP5Block(g, widthOf(b), b.h, face, SLANT.button);
        label.color = ac(inkFor(face));
      } else {
        drawBevelSlot(g, widthOf(b), b.h, SLANT.block, C.navy);
        label.color = ac(C.dim);
      }
      if (done) {
        // 练成的小星压在 chip 右上:同一枚星形符号,不另立一套「已完成」图标
        drawStarGlyph(g, widthOf(b) / 2 - 14, b.h / 2 - 11, 6, true, cur ? C.ink : C.paper);
      }
    };
    return { node: n, paint };
  }
}
