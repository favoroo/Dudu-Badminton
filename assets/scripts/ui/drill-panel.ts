// ============================================================
// 训练场面板:关卡列表 → 动作引导(嵌入 DrillAnim)→ 开始训练
// 结算不在这里:训练结束统一走 settle-panel(ui-manager 桥接 settleDrill)
// 纯代码构建 UI 节点,复刻老项目 src/ui-drill.js 的完整交互。
// 依赖:DrillAnim(演示动画)、Career(存档)、DRILLS(关卡配置)
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
//   web/preview 完全不复现。所以这里每一块底都登记 retainedDraw。
//   (显隐机制本身照旧 —— 换成「切页即销毁重建」得上真机验,不在本轮范围。)
// ============================================================
import {
  BlockInputEvents, Button, Color, Component, EventKeyboard, Graphics, Input, input, KeyCode,
  Label, Layers, Node, UITransform, Widget, _decorator,
} from "cc";
import { Career } from "../core/career";
import { CFG, DRILLS } from "../core/config";
import { DrillDef } from "../core/types";
import * as DrillAnim from "../render/drill-anim";
import {
  ac, drawBevelSlot, drawP5Block, drawP5Card, drawPosterPlate, drawRankBadge, drawSectionBand,
  drawStarGlyph, drawVeil, fadeOutHide, inkFor, mkLabel as uiMkLabel, retainedDraw, ROLE, SLANT,
  slamIn, uiIconButton, type BadgeKind, type Role,
} from "./ui-arcade";
import { C } from "./p5-tokens";
import { faceOf, pressable, uinode } from "./ui-shell";
import {
  BAR_TITLE, BTNS, DEMO_TAG, DRILL, KEYS, SECTIONS, animBox, briefInfo, cardBoxes, cardRows,
  centerX, closeHit, ctrlRow, demoTagBox, examStarRow, footTextOf, goalTextOf, headInfoBand,
  headText, keyTextLabel, playTri, pauseBars, requirementOf, stageLines, starCenters, titleBand,
  widthOf, type Box,
} from "./drill-layout";

const { ccclass } = _decorator;

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
    // 逐帧变的演示读数走 SHRINK(阶段说明长短不一,裁尾巴比缩号更难发现)。
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

/**
 * 容器整树清空:children 先 slice 再逐个 destroy —— `removeAllChildren()` 只是**摘下来**
 * 不打断销毁,那些画过一次的 Graphics 会飘在场景外占着渲染数据(切页重建两轮就翻一倍)。
 */
function clearKids(n: Node): void {
  for (const c of n.children.slice()) c.destroy();
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

// ============================================================

@ccclass("DrillPanel")
export class DrillPanel extends Component {

  // ---------- 公开接口 ----------

  /** 构建并显示面板(列表 + 引导) */
  show(parent: Node, onSelectDrill: (drill: DrillDef) => void, onBack: () => void) {
    this._onSelectDrill = onSelectDrill;
    this._onBack = onBack;
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
    // 复位动画状态,防止 update() 对已销毁 Graphics 继续绘制报错
    this._page = "list";
    this._dropBrief();
    // 退场淡出后再销毁整树;引用立刻置空,防止 update() 摸到已收走的节点
    const r = this.root;
    if (r && r.isValid) fadeOutHide(r, () => { if (r.isValid) r.destroy(); });
    this.root = null!;
    this._panelNode = null;
  }

  /** 每帧:驱动引导页动画 */
  update(dt: number) {
    if (this._page !== "brief" || !this._rig || !this._animGfx) return;
    if (!this._rig.paused) {
      this._animMs += dt * 1000 * this._rig.speed;
    }
    const c = CFG.drill.canvas;
    DrillAnim.draw(this._animGfx, this._rig, this._animMs, c.w, c.h);
    const st = DrillAnim.stageOfFrame(this._rig.currentFrame);
    if (this._stageName) this._stageName.string = `${st.index + 1}. ${st.name}`;
    if (this._stageDesc) this._stageDesc.string = st.desc;
  }

  // ---------- 内部状态 ----------

  private root!: Node;

  /** 面板根节点:供 ui-manager 做 screenSwap 退场用(退场仍走 hide(),那里有清理) */
  get rootNode(): Node { return this.root; }
  private _panelNode: Node | null = null;
  private _onSelectDrill: ((drill: DrillDef) => void) | null = null;
  private _onBack: (() => void) | null = null;

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
  private _animMs = 0;
  private _stageName: Label | null = null;
  private _stageDesc: Label | null = null;
  private _playKey: KeyHandle | null = null;
  private _speedKey: KeyHandle | null = null;

  /** 引导页那些「只在 brief 里活着」的引用一并松开:回到列表页后它们都是死的 */
  private _dropBrief() {
    this._rig = null;
    this._animGfx = null;
    this._animMs = 0;
    this._stageName = null;
    this._stageDesc = null;
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

    // 遮罩:中心 0.4、四周 0.72 的渐变(老 .screen),再挡住往世界漏的点击
    const overlay = uinode("overlay", this.root, 960, 540);
    const og = overlay.addComponent(Graphics);
    og.fillColor = ac(C.ink, 0.4);
    og.rect(-480, -270, 960, 540);
    og.fill();
    drawVeil(og, 960, 540, 0, 0.53);   // 四周最终收到 ~0.72
    overlay.addComponent(BlockInputEvents);

    // 面板衬纸(L1):一张撕下来的黑纸垫在「练球绿」上,标题带叠一层网点
    // 旧写法是 navy 半透 + 16 圆角 + 一条冷灰描边 —— 那是通用深色弹窗,不是 P5。
    const panel = uinode("panel", this.root, DRILL.pw, DRILL.ph);
    panel.setPosition(0, DRILL.panelY, 0);
    const pg = panel.addComponent(Graphics);
    retainedDraw(pg, () => drawPosterPlate(pg, DRILL.pw, DRILL.ph, {
      bandHex: ROLE.drill.face, teeth: 20, halftone: true,
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
      hit: widthOf(hit), vis: 36, bg: ROLE.primary.dk, edge: ROLE.primary.edge, fontSize: 18,
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
      retainedDraw(g, () => drawP5Card(g, widthOf(b), b.h, accent, { glow: sel, teeth: 6, bandH: DRILL.bandH }));

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

    this._rig = DrillAnim.build(def, Career.skinOf("player"));
    this._animMs = 0;
    this._listPage.active = false;
    this._briefPage.active = true;

    const page = this._briefPage;
    const info = briefInfo(def);
    const a = animBox();
    const K = ctrlRow();

    // ---------- 左列:演示动画 ----------
    // 动画底是一块凹陷槽(与实底键成对:凹=只读、凸=能点);旧写法是 navy 圆角矩形 + 冷灰描边
    const slot = uinode("animBg", page, widthOf(a), a.h);
    slot.setPosition(centerX(a), a.cy, 0);
    const slg = slot.addComponent(Graphics);
    retainedDraw(slg, () => drawBevelSlot(slg, widthOf(a), a.h, SLANT.block, C.ink));

    // 动画本体逐帧重画(DrillAnim.draw 自己 clear),所以不需要登记重放
    const gfxNode = uinode("animGfx", page, widthOf(a), a.h);
    gfxNode.setPosition(centerX(a), a.cy, 0);
    this._animGfx = gfxNode.addComponent(Graphics);

    // 「教学演示」压在动画左上:占一块色,不是裸排飘字
    this.band(page, "demoTag", DEMO_TAG, demoTagBox(), "info", 11);

    // ---------- 左列下方:演示控制条 ----------
    // 三颗键高一律 TOUCH.min=44(旧版 32:手机上按不准还看不出),图标全用 Graphics 画
    this._playKey = this.key(page, "btnPlay", K.play, ROLE.off.face, KEYS.pause, "pause", 12, () => {
      const rig = this._rig;
      if (!rig || !this._playKey) return;
      rig.paused = !rig.paused;
      this._playKey.set(ROLE.off.face, rig.paused ? KEYS.play : KEYS.pause, rig.paused ? "play" : "pause");
    });
    this._speedKey = this.key(page, "btnSpeed", K.speed, ROLE.off.face, KEYS.normal, "none", 12, () => {
      const rig = this._rig;
      if (!rig || !this._speedKey) return;
      rig.speed = rig.speed === 1.0 ? 0.5 : 1.0;
      // 慢放着的时候这颗键整面亮起来:一眼看出现在演示是哪一档(旧版靠 🐢/⚡ 区分,真机不显示)
      this._speedKey.set(rig.speed === 0.5 ? ROLE.star.face : ROLE.off.face,
        rig.speed === 0.5 ? KEYS.slow : KEYS.normal, "none");
    });
    this.key(page, "btnReplay", K.replay, ROLE.off.face, KEYS.replay, "none", 12, () => {
      this._animMs = 0;
      if (this._rig) {
        this._rig.paused = false;
        this._playKey?.set(ROLE.off.face, KEYS.pause, "pause");
      }
    });

    // 步骤读数:凹槽 + 两行(阶段名 / 说明)。逐帧只改文案,底块一次画完
    const stageBg = uinode("stageBg", page, widthOf(K.stage), K.stage.h);
    stageBg.setPosition(centerX(K.stage), K.stage.cy, 0);
    const stag = stageBg.addComponent(Graphics);
    retainedDraw(stag, () => drawBevelSlot(stag, widthOf(K.stage), K.stage.h, SLANT.block, C.navy));
    const lines = stageLines(K.stage);
    const stageLocal = (bx: Box): Box => toLocal(bx, centerX(K.stage), K.stage.cy);
    this._stageName = txt(stageBg, "stName", "", 12, C.paper, stageLocal(lines.name), 0, { shrink: true });
    this._stageDesc = txt(stageBg, "stDesc", "", 10, C.dim, stageLocal(lines.desc), 0, { shrink: true });

    // ---------- 右列:信息列(竖排游标在 drill-layout 里算,这里只照坐标摆) ----------
    txt(page, "name", def.label, DRILL.nameSize, C.paper, info.name.box, 0, { disp: true });
    this.band(page, "bandHowTo", SECTIONS.howTo, info.howTo, "drill", DRILL.bandSize);
    txt(page, "cue", info.cue.lines.join("\n"), DRILL.cueSize, C.paper, info.cue.box, 0, {
      lines: info.cue.lines.length,
    });
    // 触屏要求单独占一条实底色带:旧文案是「操作按键:深球 [J / 右键]」「起跳 [W / 向上]」——
    // 手机上没有 J/K/W 这些键,那一行等于没说;现在只写触屏动作。
    this.band(page, "bandReq", requirementOf(def), info.requirement, "star", DRILL.bandSize);
    this.band(page, "bandPoints", SECTIONS.points, info.pointsBand, "info", DRILL.bandSize);
    txt(page, "points", info.points.lines.join("\n"), DRILL.pointSize, C.dim, info.points.box, 0, {
      lines: info.points.lines.length,
    });
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
      // 文案与星形同一套坐标:星占行首 50 宽,文字从缩进后起
      const rowBox = examStarRow(examBox, i).text;
      txt(page, `exam${i}`, info.exam.lines[i], DRILL.examSize, C.dim, rowBox, 0);
    }

    // ---------- 底部两颗 ----------
    // 旧写法是 drawArcadeButton(r=8, slant=0):圆角 + 零斜切,与全站大色块无关
    this.key(page, "btnGo", info.go, ROLE.primary.face, BTNS.go, "none", 17, () => {
      this._onSelectDrill?.(def);
    });
    this.key(page, "btnBack", info.back, ROLE.off.face, BTNS.back, "none", 15, () => {
      this._showList();
    });
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
      }
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
