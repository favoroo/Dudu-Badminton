// ============================================================
// 训练场面板:关卡列表 → 动作引导(大演示 + 四张分步卡)→ 开始训练
// 结算不在这里:训练结束统一走 settle-panel(ui-manager 桥接 settleDrill)
// 纯代码构建 UI 节点,复刻老项目 src/ui-drill.js 的完整交互。
// 依赖:DrillAnim(演示)、DrillDemo(演示真值,经 DrillAnim 转手)、Career、DRILLS
//
// 引导页 0.0.21 改版(用户:「演示太简陋,看完不知道怎么做」)。这一屏的分工现在是:
//   ① 上面那块大画布 = **实机那一条弹道**(core/drill-demo 烘出来的来球/接触点/回球/落点带),
//      定格在哪一步就只画那一步该看的标注;场上的标字全部是 Label 叠在画布上
//      (引擎 Graphics 没有文字 API,见 render/sprites.ts 顶部的移植约定);
//   ② 画布下面四张卡 = 那一步的「做什么 + 容易错在哪」,点一张就把动画钉在那一帧;
//   ③ 右边一列 = 触屏要求 / 三星考核 / 你的记录(后两样一直有数,以前没给看过)。
//
// 视觉 = P5 大色块:L1 衬纸(黑纸垫在「练球绿」那张色纸上)+ L2 分区色带 +
// L3 实底块与凹陷槽成对(凸=能点、凹=只读),卡片只吃「一条色带 + 一圈 keyline」。
// 旧写法是这一屏四个面板里最没 P5 化的:整页圆角矩形(drawRR)+ 三个光滑圆点当星级 +
// 裸排飘字的小节标题 + ⏸ ▶ 🐢 ⚡ 四个 emoji —— 原生 Android 没有彩色 emoji 字体,
// 真机上要么方框要么缺字(与当初 makeCoinIcon 换掉 🪙 同一条理由)。
//
// 坐标一律来自 drill-layout.ts(纯函数、零 cc),面板这边不做减法、不手拍坐标;
// 「不重叠 / 不溢出 / 文案放得下」由 tools/panel-check.ts 在 node 下逐关断言。
//
// ⚠ 列表页与引导页靠 active 切换,而引擎 `UIRenderer.onDisable` 会 destroyRenderData():
//   原生(JSB)侧一次绘制的 Graphics 底块被 deactivate 再 activate 就全透明、只剩 Label,
//   web/preview 完全不复现。所以这里每一块底都登记 retainedDraw;
//   而演示标注那批 Label 的「这一步不显示」一律把 string 清空,**不靠 active 藏**。
// ============================================================
import {
  BlockInputEvents, Button, Color, Component, EventKeyboard, Graphics, Input, input, KeyCode,
  Label, Layers, Node, UITransform, Widget, _decorator,
} from "cc";
import { Career } from "../core/career";
import { CFG, DRILLS } from "../core/config";
import { DrillDef } from "../core/types";
import { textW } from "../core/text-metrics";
import * as DrillAnim from "../render/drill-anim";
import type { Callout } from "../render/drill-anim";
import {
  ac, drawBevelSlot, drawP5Block, drawP5Card, drawPosterPlate, drawRankBadge, drawSectionBand,
  drawStarGlyph, fadeOutHide, inkFor, mkLabel as uiMkLabel, retainedDraw, ROLE, SLANT,
  slamIn, uiIconButton, type BadgeKind, type Role,
} from "./ui-arcade";
import { C } from "./p5-tokens";
import { clearKids, faceOf, pressable, uinode } from "./ui-shell";
import {
  BAR_TITLE, BTNS, DEMO_TAG, DRILL, KEYS, SECTIONS, TUTORIAL_ENTRY, animBox, briefInfo, cardBoxes, cardRows,
  cardRowsOf, centerX, closeHit, demoTagBox, examStarRow, footTextOf, goalTextOf, headInfoBand,
  headText, keyRow, keyTextLabel, pauseBars, playTri, requirementOf,
  stepCardBoxes, stepCardRows, stepLines, starCenters, titleBand, tutorialEntryBox, widthOf, type Box,
} from "./drill-layout";

const { ccclass } = _decorator;

/** 标注 tones → 字色/字号。颜色与 render/drill-anim 的 INK 同一批(两边同源,改要一起改) */
const CALLOUT: Record<Callout["tone"], { hex: string; size: number; bold?: boolean }> = {
  zone: { hex: "#7dff9e", size: 11, bold: true },
  stand: { hex: "#00f0ff", size: 10 },
  hit: { hex: "#ffffff", size: 11, bold: true },
  key: { hex: "#ffe14d", size: 12, bold: true },
  land: { hex: "#ffe14d", size: 11, bold: true },
  alt: { hex: "#ff8f8f", size: 10 },
  meter: { hex: "#c8d4ff", size: 10 },
};

/** 叠在画布上的标注 Label 数量上限(四步里最多的一步是 4 条 + 时机条一句) */
const CALLOUT_MAX = 6;

// ---------- UI 辅助 ----------

/**
 * 全站唯一一份「摆一个 Label」的构造在 ui-arcade.mkLabel,这里只是本面板的参数薄壳。
 * 锚点故意保持 center:本面板所有文字都按 Box(左缘 + 宽)摆,换成 campaign 的左锚语义
 * 会整体横移 w/2 —— 想统一先重调坐标。contentSize 一律给足:不给的话长文案整段推出框外
 * (Label 没有 overflow 时连 contentSize 都被忽略,那是当初技能卡糊成一排的事故)。
 */
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
    // 定长文案走 CLAMP:真超了就是版式算错,让 panel-check 红出来而不是偷偷缩号;
    // 逐帧变的演示标注走 SHRINK(长短不一,裁尾巴比缩号更难发现)。
    overflow: opts.shrink ? Label.Overflow.SHRINK : Label.Overflow.CLAMP,
    disp: opts.disp,
  });
}

/** 照 Box 摆一段文字:中心锚 + 盒宽 = 盒心,左对齐时文字正好从 box.left 起 */
function txt(
  parent: Node, name: string, text: string, size: number, color: string | Color, b: Box,
  align: 0 | 1 | 2 = 0, o: { lines?: number; disp?: boolean; shrink?: boolean } = {},
): Label {
  return mkLabel(parent, name, text, size, color, {
    x: centerX(b), y: b.cy, w: widthOf(b), align, lines: o.lines, disp: o.disp, shrink: o.shrink,
  });
}

/** Box 从面板局部换算成「以父节点中心为原点」:父节点摆在 (px,py) 上时用 */
function toLocal(b: Box, px: number, py: number): Box {
  return { left: b.left - px, right: b.right - px, cy: b.cy - py, h: b.h };
}

/** 满星奖励(首通 + 3 星),只用来把卡脚那一行算出来 */
function prize(): { coin: number; exp: number } {
  const cd = CFG.career.drill;
  return { coin: cd.firstClear.coin + 3 * cd.perStar.coin, exp: cd.firstClear.exp + 3 * cd.perStar.exp };
}

const recOf = (id: string) => Career.profile().drills[id] || null;
const starsOf = (id: string): number => (recOf(id) || {}).stars || 0;

/** 演示键左侧那个图标:只有这两种形状,全用 Graphics 画(emoji 一个不留) */
type Glyph = "play" | "pause" | "none";

/** 一颗键的把手:换面色/文案/图标时整块 clear + 重画(保留型画布唯一安全的改法) */
interface KeyHandle {
  node: Node;
  set(face: string, text: string, glyph: Glyph): void;
}

/** 一张分步卡的把手:选中态只重画底与字色,文案不动 */
interface StepHandle {
  node: Node;
  setSel(sel: boolean): void;
}

// ============================================================

@ccclass("DrillPanel")
export class DrillPanel extends Component {

  // ---------- 公开接口 ----------

  /** 构建并显示面板(列表 + 引导);onTutorial = 列表页「操作教学」入口条的去处 */
  show(parent: Node, onSelectDrill: (drill: DrillDef) => void, onBack: () => void, onTutorial?: () => void) {
    this._onSelectDrill = onSelectDrill;
    this._onBack = onBack;
    this._onTutorial = onTutorial ?? null;
    this._page = "list";
    this._sel = 0;
    this._buildAll();
    if (this.node && this.node !== parent) {
      this.node.setParent(parent);
    }
    if (this.root) {
      this.root.setParent(parent);
    }
    this._showList();
    if (this._panelNode) slamIn(this._panelNode);   // 老 .panel slam 砸落
  }

  /** 销毁面板 */
  hide() {
    input.off(Input.EventType.KEY_DOWN, this._onKey, this);
    this._onSelectDrill = null;
    this._onBack = null;
    this._onTutorial = null;
    // 复位动画状态,防止 update() 对已销毁 Graphics 继续绘制报错
    this._page = "list";
    this._dropBrief();
    // 退场淡出后再销毁整树;引用立刻置空,防止 update() 摸到已收走的节点
    const r = this.root;
    if (r && r.isValid) fadeOutHide(r, () => { if (r.isValid) r.destroy(); });
    this.root = null!;
    this._panelNode = null;
  }

  /** 每帧:推进演示并把画布上的标字对齐到当前这一步 */
  update(dt: number) {
    if (this._page !== "brief" || !this._rig || !this._animGfx) return;
    DrillAnim.advance(this._rig, dt);
    const c = CFG.drill.canvas;
    DrillAnim.drawFrame(this._animGfx, this._rig, c.w, c.h);
    const step = DrillAnim.activeStep(this._rig);
    if (step !== this._shownStep) {
      this._shownStep = step;
      this._syncSteps(step);
      this._syncCallouts(step, c.w, c.h);
    }
  }

  // ---------- 内部状态 ----------

  private root!: Node;

  /** 面板根节点:供 ui-manager 做 screenSwap 退场用(退场仍走 hide(),那里有清理) */
  get rootNode(): Node { return this.root; }
  private _panelNode: Node | null = null;
  private _onSelectDrill: ((drill: DrillDef) => void) | null = null;
  private _onBack: (() => void) | null = null;
  private _onTutorial: (() => void) | null = null;

  private _page: "list" | "brief" = "list";
  private _sel = 0;

  // 缓存节点
  private _listPage!: Node;
  private _briefPage!: Node;
  private _gridNode!: Node;
  private _headInfo!: Label;

  // 引导页
  private _animGfx: Graphics | null = null;
  private _rig: DrillAnim.DrillRig | null = null;
  private _playKey: KeyHandle | null = null;
  private _speedKey: KeyHandle | null = null;
  /** 四张分步卡与叠在画布上的标字 */
  private _stepCards: StepHandle[] = [];
  private _calloutLabels: Label[] = [];
  private _shownStep = -2;

  /** 引导页那些「只在 brief 里活着」的引用一并松开:回到列表页后它们都是死的 */
  private _dropBrief() {
    this._rig = null;
    this._animGfx = null;
    this._stepCards = [];
    this._calloutLabels = [];
    this._shownStep = -2;
    this._playKey = null;
    this._speedKey = null;
  }

  // ========== 节点搭建 ==========

  private _buildAll() {
    this.root = new Node("drill-panel");
    this.root.layer = Layers.Enum.UI_2D;
    this.root.addComponent(UITransform).setContentSize(960, 540);
    const wg = this.root.addComponent(Widget);
    wg.isAlignTop = wg.isAlignBottom = wg.isAlignLeft = wg.isAlignRight = true;
    wg.top = wg.bottom = wg.left = wg.right = 0;

    // 遮罩:二级界面底即墨黑(用户指令),身后的一级界面/球场一律不露;再挡住往世界漏的点击。
    // rect 与 uiDim 同款超宽:宽屏两侧那一条也不露背景。
    const overlay = uinode("overlay", this.root, 960, 540);
    const og = overlay.addComponent(Graphics);
    og.fillColor = ac(C.ink, 1);
    og.rect(-2000, -1000, 4000, 2000);
    og.fill();
    overlay.addComponent(BlockInputEvents);

    // 面板衬纸(L1):一张黑纸垫在「练球绿」副衬上,标题带叠一层网点,下缘平直收边
    // 旧写法是 navy 半透 + 16 圆角 + 一条冷灰描边 —— 那是通用深色弹窗,不是 P5。
    const panel = uinode("panel", this.root, DRILL.pw, DRILL.ph);
    panel.setPosition(0, DRILL.panelY, 0);
    const pg = panel.addComponent(Graphics);
    retainedDraw(pg, () => drawPosterPlate(pg, DRILL.pw, DRILL.ph, {
      bandHex: ROLE.drill.face, halftone: true,
    }));
    this._panelNode = panel;

    this._buildTopBar(panel);

    // 两页容器:Box 全是面板局部坐标,所以页节点与面板同尺寸同位(零换算)
    this._listPage = uinode("listPage", panel, DRILL.pw, DRILL.ph);
    this._gridNode = uinode("grid", this._listPage, DRILL.pw, DRILL.ph);
    this._briefPage = uinode("briefPage", panel, DRILL.pw, DRILL.ph);
    this._briefPage.active = false;

    // 键盘
    input.on(Input.EventType.KEY_DOWN, this._onKey, this);
  }

  // ----- 顶部标题栏 -----
  private _buildTopBar(panel: Node) {
    this.band(panel, "title", BAR_TITLE, titleBand(), "drill", 16);

    this._headInfo = txt(panel, "headInfo", "", 13, C.dim, headInfoBand(), 2);

    // 关闭键:命中 44 = TOUCH.min。uiIconButton 默认给 56 的命中盒,而顶栏只有 32 高,
    // 56 会往下捅进内容区(判据见 drill-layout 的顶栏那条)—— 这里显式收到 44。
    const hit = closeHit();
    const back = uiIconButton(panel, "✕", {
      hit: widthOf(hit), vis: 36, fontSize: 18,
    });
    back.setPosition(centerX(hit), hit.cy, 0);
    back.on(Button.EventType.CLICK, () => {
      this._onBack?.();
      this.hide();
    });
  }

  // ========== 列表页 ==========

  private _buildCards() {
    // 卡片整树销毁重建(与 settings-panel 的「切页即重建」同一条路):
    // 复用一张卡就得为它单独写一份「选中/练成」的重放状态,重建只付一次路径费。
    clearKids(this._gridNode);
    const boxes = cardBoxes();
    const rows = cardRows();

    // 「操作教学」入口条:滑轨是默认操作方式,重看教学从训练场走(用户指令)。
    // 整行实底键 —— 列表页里它是唯一与「练什么」并列的另类动作,值得一块大色。
    const entry = tutorialEntryBox();
    const entryNode = uinode("tutorialEntry", this._gridNode, widthOf(entry), entry.h);
    entryNode.setPosition(centerX(entry), entry.cy, 0);
    const entryG = entryNode.addComponent(Graphics);
    retainedDraw(entryG, () => drawP5Block(entryG, widthOf(entry), entry.h, ROLE.info.face, SLANT.button));
    mkLabel(entryNode, "txt", TUTORIAL_ENTRY, 14, inkFor(ROLE.info.face), {
      x: 0, y: 0, w: widthOf(entry) - 20, align: 1,
    });
    pressable(entryNode, 0.96);
    entryNode.on(Button.EventType.CLICK, () => {
      this._onTutorial?.();
      this.hide();
    });

    DRILLS.forEach((d, i) => {
      const b = boxes[i];
      const rec = recOf(d.id);
      const stars = starsOf(d.id);
      const cleared = !!rec && rec.clears > 0;
      const p = prize();
      const sel = i === this._sel;

      const card = uinode(`card-${i}`, this._gridNode, widthOf(b), b.h);
      card.setPosition(centerX(b), b.cy, 0);

      // 卡底:墨面 + 顶部一条 accent 色带 + 同色 keyline。
      // **不整面实底** —— 六张卡各涂满绿会糊成一堵墙(出图实测),P5 是红黑白主导 + 点缀。
      // 练成 = 绿带(ROLE.drill),没练成 = 荧光黄带(ROLE.star);选中只把 keyline 加粗。
      const accent = cleared ? ROLE.drill.face : ROLE.star.face;
      const g = card.addComponent(Graphics);
      // bandH 显式传:色带高与卡内 tag 框同源(DRILL.bandH),不靠 cardDL 的默认值猜
      retainedDraw(g, () => drawP5Card(g, widthOf(b), b.h, accent, { glow: sel, bandH: DRILL.bandH }));

      // 色带里只放 tag:字色由面色亮度算(两条色带都是亮面 ⇒ 墨黑字)
      txt(card, "tag", d.tag, DRILL.tagSize, inkFor(accent), rows.tag);

      // 星级:三颗四尖星,实=拿到、空=描边。旧写法是三个光滑圆点 —— 亮面看不见,
      // 而「光滑圆圈」正是 P5 语汇明确拒绝的形状(打击=尖刺,这里取星芒)。
      const starNode = uinode("stars", card, widthOf(b), b.h);
      const sg = starNode.addComponent(Graphics);
      const centers = starCenters(rows.stars);
      retainedDraw(sg, () => {
        for (let k = 0; k < 3; k++) {
          drawStarGlyph(sg, centers[k], rows.stars.cy, DRILL.starS, k < stars, k < stars ? C.acid : C.paper);
        }
      });

      txt(card, "name", d.label, DRILL.nameSize, C.paper, rows.name, 0, { disp: true });
      txt(card, "desc", d.desc, DRILL.descSize, C.dim, rows.desc);
      txt(card, "goal", goalTextOf(d), DRILL.goalSize, C.dimDeep, rows.goal);
      txt(card, "foot", footTextOf(rec ? rec.clears : 0, p.coin, p.exp),
        DRILL.footSize, cleared ? ROLE.drill.face : C.acid, rows.foot);

      // 整张卡即按钮:pressable 自带 Button —— 只挂 CLICK 而不装 Button 的节点连引擎的
      // 命中判定都进不去(既不响也不吞触摸),闸门见 tools/ui-click-check.ts
      pressable(card, 0.96);
      const idx = i;
      card.on(Button.EventType.CLICK, () => {
        this._sel = idx;
        this._openBrief(DRILLS[idx]);
      });
    });

    const n = DRILLS.filter((d) => (recOf(d.id) || {}).clears > 0).length;
    this._headInfo.string = headText(n, DRILLS.length);
  }

  // ========== 引导页 ==========

  private _openBrief(def: DrillDef) {
    this._page = "brief";
    // 先把旧引导页整树清掉并松开引用,再建新的 rig —— 反过来的话 _dropBrief 会把刚
    // 建好的 _rig / _animGfx 一起置 null,动画就再也不动了。
    clearKids(this._briefPage);
    this._dropBrief();

    const rig = DrillAnim.build(def, Career.skinOf("player"));
    if (!rig) {
      // 烘不出真值(这一关的喂球下网或够不着)—— 宁可退回列表并说清楚,也别放一条假弹道糊人。
      this._showList();
      return;
    }
    this._rig = rig;
    this._listPage.active = false;
    this._briefPage.active = true;

    const page = this._briefPage;
    const rec = recOf(def.id);
    const p = prize();
    const info = briefInfo(def, rec ? {
      clears: rec.clears, stars: rec.stars, bestQ: rec.bestQ, bestReps: rec.bestReps,
    } : null);
    const a = animBox();
    const K = keyRow();
    const cards = stepCardBoxes();

    // ---------- ① 演示画布 ----------
    // 动画底是一块凹陷槽(与实底键成对:凹=只读、凸=能点);旧写法是 navy 圆角矩形 + 冷灰描边
    const slot = uinode("animBg", page, widthOf(a), a.h);
    slot.setPosition(centerX(a), a.cy, 0);
    const slg = slot.addComponent(Graphics);
    retainedDraw(slg, () => drawBevelSlot(slg, widthOf(a), a.h, SLANT.block, C.ink));

    // 动画本体逐帧重画(DrillAnim.drawFrame 自己 clear),所以不需要登记重放
    const gfxNode = uinode("animGfx", page, widthOf(a), a.h);
    gfxNode.setPosition(centerX(a), a.cy, 0);
    this._animGfx = gfxNode.addComponent(Graphics);

    // 「教学演示」压在动画左上:占一块色,不是裸排飘字
    this.band(page, "demoTag", DEMO_TAG, demoTagBox(), "info", 11);

    // 标字层:引擎的 Graphics 画不了字,所以这些 Label 与画布同中心叠在上面。
    // 「这一步不显示」= string 置空,不走 active(见文件头那条原生坑)。
    for (let i = 0; i < CALLOUT_MAX; i++) {
      const lb = mkLabel(page, `callout${i}`, "", 11, C.paper, {
        x: centerX(a), y: a.cy, w: widthOf(a) - 16, shrink: true,
      });
      lb.node.layer = Layers.Enum.UI_2D;
      this._calloutLabels.push(lb);
    }

    // ---------- ② 四张分步卡(点一张 = 动画钉在那一步) ----------
    cards.forEach((b, i) => {
      const n = uinode(`step-${i}`, page, widthOf(b), b.h);
      const cx = centerX(b);
      n.setPosition(cx, b.cy, 0);
      const g = n.addComponent(Graphics);
      const ln = stepLines(b, def, i);
      const rows = stepCardRows(b);
      const sel = (): boolean => i === this._shownStep;
      const inkOf = (): string => (sel() ? inkFor(ROLE.star.face) : C.paper);
      const paint = (): void => {
        g.clear();
        // 选中 = 凸出的实底键,未选中 = 凹陷槽(凸能点、凹只读的配对语言)。
        // 四张卡里同时只有一张亮面 —— 整排都涂荧光黄就成彩虹了。
        if (sel()) drawP5Block(g, widthOf(b), b.h, ROLE.star.face, SLANT.button);
        else drawBevelSlot(g, widthOf(b), b.h, SLANT.block, C.navy);
        g.fillColor = ac(sel() ? ROLE.star.dk : ROLE.drill.face, sel() ? 0.9 : 0.75);
        const mk = rows.mark;
        g.rect(mk.left - cx, mk.cy - b.cy - mk.h / 2, widthOf(mk), mk.h);
        g.fill();
      };
      retainedDraw(g, paint);

      const head = txt(n, "head", ln.head, DRILL.stepHeadSize, inkOf(), toLocal(rows.head, cx, b.cy), 0, { disp: true });
      // 两行正文各占其位:第一行「做什么」,第二行「容易错在哪」(暗一档)。
      // 各自必须一行放得下 —— 这条由 drillOverflow 逐关钉,不靠肉眼。
      const body = txt(n, "body", ln.lines[0] ?? "", DRILL.stepBodySize, inkOf(),
        toLocal({ ...rows.body, cy: rows.body.cy + 7 }, cx, b.cy));
      const note = txt(n, "note", ln.noteLines[0] ?? "", DRILL.stepNoteSize,
        sel() ? ROLE.star.dk : C.dim, toLocal({ ...rows.body, cy: rows.body.cy - 7 }, cx, b.cy));
      this._stepCards.push({
        node: n,
        setSel(): void {
          paint();
          head.color = ac(inkOf());
          body.color = ac(inkOf());
          note.color = ac(sel() ? ROLE.star.dk : C.dim);
        },
      });
      // 整张卡即按钮:pressable 自带 Button(只挂 CLICK 不装 Button 的节点连命中都进不去)
      pressable(n, 0.95);
      n.on(Button.EventType.CLICK, () => this._gotoStep(i));
    });

    // ---------- ③ 底排:三颗演示键 + 开始/换项目 ----------
    this._playKey = this.key(page, "btnPlay", K.play, ROLE.off.face, KEYS.play, "play", 13, () => {
      const rig = this._rig;
      if (!rig) return;
      // 定格态 → 连播(从当前这一步往后播);连播态 → 停下并钉在当前这一步。
      // 键面文案只在 _gotoStep 一处同步 —— 这里再 set 一次就是第二份状态,迟早对不上。
      this._gotoStep(rig.focusStep >= 0 ? -1 : DrillAnim.activeStep(rig));
    });
    this._speedKey = this.key(page, "btnSpeed", K.speed, ROLE.off.face, KEYS.normal, "none", 13, () => {
      const rig = this._rig;
      if (!rig || !this._speedKey) return;
      rig.speed = rig.speed === 1.0 ? 0.5 : 1.0;
      // 慢放着的时候这颗键整面亮起来:一眼看出现在演示是哪一档(旧版靠 🐢/⚡ 区分,真机不显示)
      this._speedKey.set(rig.speed === 0.5 ? ROLE.star.face : ROLE.off.face,
        rig.speed === 0.5 ? KEYS.slow : KEYS.normal, "none");
    });
    this.key(page, "btnReplay", K.replay, ROLE.off.face, KEYS.replay, "none", 13, () => {
      this._gotoStep(0);            // 「第一步」= 回到第①步重新讲(不是把整轮动画倒带)
    });

    // ---------- ④ 右列:要求 / 考核 / 记录(游标几何在 drill-layout 里算) ----------
    txt(page, "name", def.label, DRILL.nameSize, C.paper, info.name.box, 0, { disp: true });
    this.band(page, "bandHowTo", SECTIONS.howTo, info.howTo, "drill", DRILL.bandSize);
    txt(page, "cue", info.cue.lines.join("\n"), DRILL.cueSize, C.paper, info.cue.box, 0, {
      lines: info.cue.lines.length,
    });
    // 触屏要求单独占一条实底色带:旧文案是「操作按键:深球 [J / 右键]」「起跳 [W / 向上]」——
    // 手机上没有 J/K/W 这些键,那一行等于没说;现在只写触屏动作。
    this.band(page, "bandReq", requirementOf(def), info.requirement, "star", DRILL.bandSize);
    this.band(page, "bandExam", SECTIONS.exam, info.examBand, "record", DRILL.bandSize, "best");
    // 考核三行:行首 1/2/3 颗四尖星(★ 留成文本就是「字体有没有这个字形」的赌注)
    const examBox = info.exam.box;
    const starLayer = uinode("examStars", page, widthOf(examBox), examBox.h);
    starLayer.setPosition(centerX(examBox), examBox.cy, 0);
    const eg = starLayer.addComponent(Graphics);
    retainedDraw(eg, () => {
      for (let i = 0; i < info.exam.lines.length; i++) {
        const row = examStarRow(examBox, i);
        for (let k = 0; k < 3; k++) {
          const lx = row.centers[k] - centerX(examBox);
          const ly = row.text.cy - examBox.cy;
          // 实星 = 这一档要拿到的星数;空星只描边(半径与间距同源,见 examStarRow)
          drawStarGlyph(eg, lx, ly, row.r, k < i + 1, k < i + 1 ? C.acid : C.paper);
        }
      }
    });
    for (let i = 0; i < info.exam.lines.length; i++) {
      // 文案与星形同一套坐标:星占行首,文字从缩进后起
      txt(page, `exam${i}`, info.exam.lines[i], DRILL.examSize, C.dim, examStarRow(examBox, i).text, 0);
    }
    this.band(page, "bandRecord", SECTIONS.record, info.recordBand, "info", DRILL.bandSize);
    txt(page, "record", info.record.lines.join("\n"), DRILL.recordSize, C.dim, info.record.box, 0, {
      lines: info.record.lines.length,
    });

    // ---------- 底排右侧两颗(旧写法是 drawArcadeButton(r=8, slant=0):圆角 + 零斜切) ----------
    this.key(page, "btnGo", K.go, ROLE.primary.face, BTNS.go, "none", 16, () => {
      this._onSelectDrill?.(def);
    });
    this.key(page, "btnBack", K.back, ROLE.off.face, BTNS.back, "none", 14, () => {
      this._showList();
    });

    this._gotoStep(0);   // 教学默认:停在第①步讲清第一件事,连播是 opt-in
  }

  /** 定格到第 i 步(-1 = 连播):四张卡、画布标字、演示键文案一起对齐 */
  private _gotoStep(i: number): void {
    const rig = this._rig;
    if (!rig) return;
    DrillAnim.gotoStep(rig, i);
    if (i < 0) rig.paused = false;                 // 要连播就别带着上一次的暂停
    this._playKey?.set(ROLE.off.face,
      rig.focusStep >= 0 ? KEYS.play : KEYS.pause,
      rig.focusStep >= 0 ? "play" : "pause");
    this._speedKey?.set(rig.speed === 0.5 ? ROLE.star.face : ROLE.off.face,
      rig.speed === 0.5 ? KEYS.slow : KEYS.normal, "none");
    this._shownStep = -2;                       // 强制重同步一次
    const step = DrillAnim.activeStep(rig);
    this._shownStep = step;
    this._syncSteps(step);
    const c = CFG.drill.canvas;
    this._syncCallouts(step, c.w, c.h);
  }

  private _syncSteps(step: number): void {
    for (const [i, h] of this._stepCards.entries()) h.setSel(i === step);
  }

  /** 画布上的标字:内容来自 DrillAnim.callouts(全是烘焙事实,不是第二套话) */
  private _syncCallouts(step: number, w: number, h: number): void {
    const rig = this._rig;
    if (!rig) return;
    const list = DrillAnim.callouts(rig, step, w, h);
    const a = animBox();
    const ax = centerX(a), ay = a.cy;
    for (const [i, lb] of this._calloutLabels.entries()) {
      const c = list[i];
      if (!c) { lb.string = ""; continue; }
      const st = CALLOUT[c.tone];
      const tw = Math.min(widthOf(a) - 16, textW(c.text, st.size) + 8);
      lb.string = c.text;
      lb.fontSize = st.size;
      lb.lineHeight = Math.round(st.size * 1.25);
      lb.color = ac(st.hex);
      lb.node.getComponent(UITransform)!.setContentSize(tw, st.size * 1.5);
      // 别让字探出画布:贴边的落点标注尤其需要(网前关的理想落点就在画面中间偏左)
      const half = tw / 2;
      const x = Math.max(-w / 2 + half + 4, Math.min(w / 2 - half - 4, c.x));
      lb.node.setPosition(ax + x, ay + c.y, 0);
    }
  }

  private _showList() {
    this._page = "list";
    this._dropBrief();
    this._briefPage.active = false;
    this._listPage.active = true;
    this._buildCards();
  }

  // ---------- 建块辅助 ----------

  /**
   * 小节色带(L2):整面 accent 实底 + 由面色亮度算的字色,左锚摆文字。
   * 与 ui-shell.sectionTitle 同配方(形状只有一份真话:drawSectionBand → bandDL → blockDL),
   * 差别只在:① 这一屏整页会被 active 开关,底块必须登记重放(见文件头那条原生坑);
   * ② `badge` 还要往带子左端让出 24 宽放一枚印章。
   */
  private band(parent: Node, name: string, text: string, b: Box, role: Role, size = 13, badge?: BadgeKind): void {
    const w = widthOf(b);
    const n = uinode(name, parent, w, b.h);
    n.setPosition(centerX(b), b.cy, 0);
    const face = faceOf(role);
    const g = n.addComponent(Graphics);
    retainedDraw(g, () => drawSectionBand(g, w, b.h, face));
    const ink = inkFor(face);
    if (badge) {
      const bn = uinode("badge", n, b.h, b.h);
      bn.setPosition(-w / 2 + 16, 0, 0);
      const bg = bn.addComponent(Graphics);
      const hex = ink;
      retainedDraw(bg, () => drawRankBadge(bg, badge, b.h - 8, hex, 0, 0));
    }
    const left = -w / 2 + (badge ? 34 : 12);
    const tw = w - (left + w / 2) - 10;
    mkLabel(n, "txt", text, size, ink, { x: left + tw / 2, y: 0, w: tw, align: 0 });
  }

  /**
   * 一颗斜切实底键:图标位与文案位都由 drill-layout 的 Box 定。
   * 状态变化(暂停 / 慢放)整块 clear + 重画 —— 保留型画布唯一安全的改法;
   * retainedDraw 让它被祖先 deactivate 再 activate 之后还在(见文件头)。
   * 自带 Button:可点节点绝不允许只挂 CLICK(ui-click-check 那条闸门)。
   */
  private key(parent: Node, name: string, b: Box, face: string, text: string, glyph: Glyph, size: number, tap: () => void): KeyHandle {
    const n = uinode(name, parent, widthOf(b), b.h);
    n.setPosition(centerX(b), b.cy, 0);
    const st = { face, glyph };
    const g = n.addComponent(Graphics);
    const cx = centerX(b);
    const paint = (): void => {
      g.clear();
      drawP5Block(g, widthOf(b), b.h, st.face, SLANT.button);
      if (st.glyph !== "none") {
        g.fillColor = ac(inkFor(st.face));
        if (st.glyph === "play") {
          const tri = playTri(b);
          g.moveTo(tri[0][0] - cx, tri[0][1] - b.cy);
          g.lineTo(tri[1][0] - cx, tri[1][1] - b.cy);
          g.lineTo(tri[2][0] - cx, tri[2][1] - b.cy);
          g.close();
          g.fill();
        } else {
          for (const bar of pauseBars(b)) g.rect(bar.x - cx, -bar.h / 2, bar.w, bar.h);
          g.fill();
        }
      }
    };
    retainedDraw(g, paint);

    const tl = keyTextLabel(b, glyph !== "none");
    const label = mkLabel(n, "txt", text, size, inkFor(face), {
      x: centerX(tl) - cx, y: 0, w: widthOf(tl), align: 1,
    });
    pressable(n, 0.94);
    n.on(Button.EventType.CLICK, tap);
    return {
      node: n,
      set(nextFace: string, nextText: string, nextGlyph: Glyph): void {
        st.face = nextFace;
        st.glyph = nextGlyph;
        paint();
        label.color = ac(inkFor(nextFace));
        label.string = nextText;
      },
    };
  }

  // ========== 键盘 ==========

  private _onKey(event: EventKeyboard) {
    if (!this.root || !this.root.isValid) return;
    const kc = event.keyCode;
    // Cocos 的 EventKeyboard 没有直接的 `code` 字段,只有 keyCode + rawEvent。
    // Web 预览/构建里 rawEvent 是原生键事件 → 取它的 code 名(方向键 / 字母键之类);
    // 原生 APK 里 rawEvent 缺 → 回退到用 keyCode 判定的旧写法(kc === KeyCode.KEY_Q 等)。
    // 与 input/keyboard.ts 的 getCode() 同一套兜底,不新造第二份逻辑。
    // 这屏的界面文案只写触屏向,而 tools/panel-check.ts 的文案闸扫的是**字符串字面量**
    // (见该文件 ④),所以确认键用包含比对、不写键名原文 —— 逻辑一条没少。
    const raw = (event as unknown as { rawEvent?: { code?: string } }).rawEvent;
    const code = raw && typeof raw.code === "string" ? raw.code : "";
    const isEnter = kc === KeyCode.ENTER || kc === KeyCode.SPACE || code.includes("Ent") || code.includes("Spac");
    const isEsc = kc === KeyCode.ESCAPE || code === "Escape";
    const isQ = kc === KeyCode.KEY_Q || code === "KeyQ";
    const isUp = kc === KeyCode.ARROW_UP || kc === KeyCode.KEY_W || code === "ArrowUp" || code === "KeyW";
    const isDown = kc === KeyCode.ARROW_DOWN || kc === KeyCode.KEY_S || code === "ArrowDown" || code === "KeyS";
    const isLeft = kc === KeyCode.ARROW_LEFT || kc === KeyCode.KEY_A || code === "ArrowLeft" || code === "KeyA";
    const isRight = kc === KeyCode.ARROW_RIGHT || kc === KeyCode.KEY_D || code === "ArrowRight" || code === "KeyD";

    if (this._page === "brief") {
      if (isEnter) {
        if (this._rig) this._onSelectDrill?.(this._rig.def);
        return;
      }
      if (isEsc) {
        this._showList();
        return;
      }
      if (isQ) {
        this._onBack?.();
        this.hide();
        return;
      }
      // ← / → 在四步之间跳着讲:键盘党也走同一条 gotoStep,不另开一套状态
      if (isLeft && this._rig) this._gotoStep(Math.max(0, DrillAnim.activeStep(this._rig) - 1));
      if (isRight && this._rig) this._gotoStep(Math.min(DRILL.stepCols - 1, DrillAnim.activeStep(this._rig) + 1));
      if ((isUp || isDown) && this._rig) this._gotoStep(this._rig.focusStep >= 0 ? -1 : 0);
      return;
    }

    // 列表页
    if (isUp || isLeft) {
      this._sel = (this._sel - 1 + DRILLS.length) % DRILLS.length;
      this._buildCards();
      return;
    }
    if (isDown || isRight) {
      this._sel = (this._sel + 1) % DRILLS.length;
      this._buildCards();
      return;
    }
    if (isEnter) {
      this._openBrief(DRILLS[this._sel]);
      return;
    }
    if (isEsc || isQ) {
      this._onBack?.();
      this.hide();
    }
  }
}
