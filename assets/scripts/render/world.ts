// ============================================================
// 世界渲染层:视口变换 + 每帧重绘(角色/羽毛球/拖尾/飘字) + 镜头震动。
// Cocos Graphics 是保留式几何,这里采用「每帧 clear + 全量重绘」——
// 与老 canvas 全帧重绘同构,元素量级(两人一球)毫无压力。
// 渲染层只读游戏状态,不改任何逻辑字段。
// ============================================================
import { Color, Graphics, Label, Layers, Node, UIOpacity, UITransform } from "cc";
import { CFG } from "../core/config";
import { Settings } from "../core/settings";
import { lerp } from "../core/utils";
import { Ball, GameEvent, Player, SkinDef } from "../core/types";
import { drawPlayer, drawShuttle, setSwingArcSink, drawSwingArcGhost, hueColor, SwingArcFx } from "./sprites";
import { courtRenderer, CourtThemeItem } from "./court";
import { FXSystem } from "./fx";
import { HudOverlay } from "./hud-overlay";

const C = CFG;

/** 世界坐标(canvas,y 向下,0..960/540)→ Graphics 本地坐标(居中原点,y 向上) */
export interface Viewport {
  x(wx: number): number;
  y(wy: number): number;
}

function makeViewport(): Viewport {
  return {
    x: (wx: number) => wx - C.world.w / 2,
    y: (wy: number) => C.world.h / 2 - wy,
  };
}

interface FloatText {
  node: Node;
  label: Label;
  opacity: UIOpacity;
  life: number;
  maxLife: number;
  vy: number;
  /** 系统信息字(下网/出界/DEUCE 等):不受「飘字提示」开关影响 */
  sys?: boolean;
}

/** 氛围暗角的输入(渲染层不 import Rules,由 game-root 每帧喂入只读快照) */
export interface AtmoState { state: string; rally: number; matchPoint: boolean }

/** 球残影点(老 fx.js trails:按击球档位分风格渲染) */
interface TrailDot { x: number; y: number; life: number; max: number; isSmash: boolean; isSweet: boolean; isFire?: boolean }

/** 挥拍弧光残影:sprites 经 sink 推入,这里补寿命做衰减(老 fx.js addSwingArc) */
interface SwingArcGhost extends SwingArcFx { life: number; max: number }

export class WorldView {
  readonly root: Node;          // 受震屏/镜头冲击影响的容器
  private courtGfx: Graphics;
  private g: Graphics;
  private vp: Viewport;
  private floatLayer: Node;
  private tagLayer: Node;
  private floats: FloatText[] = [];
  private floatPool: FloatText[] = [];
  /** 头顶名牌池(YOU/CPU/搭档…);胸前球衣号已去掉,人物身上不再有数字 */
  private tags: Label[] = [];
  private trail: TrailDot[] = [];
  private swingArcs: SwingArcGhost[] = [];
  readonly fx = new FXSystem(); // 完整打击特效与粒子系统
  /** 画布内世界提示层(老 hud.js:落点圈/训练时机条/拍数徽标/赛点旗标) */
  readonly hudOverlay: HudOverlay;
  shakeX = 0;
  shakeY = 0;
  private shakeAmt = 0;
  private shakeAmtV = 0;
  frameT = 0;

  // ---------- 镜头四件套状态(老 fx.js 的 camZ/slowT/flash;衰减全按模拟步走) ----------
  private camZ = 1;             // 镜头缩放:只放大不缩小,指数回弹到 1
  private camX = 0;             // punch 焦点(击球点,世界坐标)
  private camY = 0;
  private flash = 0;            // 白闪强度 0..1
  private slowT = 0;            // 慢动作剩余模拟帧
  private slowFac = 1;          // 慢动作时间缩放
  private screenG!: Graphics;   // 屏幕特效层:白闪 + 氛围暗角(不随镜头缩放)
  private atmo: AtmoState = { state: "", rally: 0, matchPoint: false };
  /** 按拍预告辉光级别(game 层 updateSwingCue 每帧喂;羽毛球本体发光,见 sprites.drawShuttle) */
  private swingCue = 0;
  private replayAlpha = 0;      // 回放转播氛围渐入度(水印/暗角共用)
  private replayTag!: Label;    // "PERFECT REPLAY" 水印(Graphics 画不了字,Label 补)
  private replayOpacity!: UIOpacity;

  constructor(parent: Node) {
    this.vp = makeViewport();
    this.root = new Node("world");
    this.root.layer = Layers.Enum.UI_2D;
    this.root.addComponent(UITransform);
    this.root.setPosition(0, C.view.offsetY, 0);   // 整体抬高:地面线上移,底部让出虚拟按键带
    this.root.setParent(parent);

    // 球场多主题层(支持动态元素与晃网重绘)
    const bg = new Node("court-bg");
    bg.layer = Layers.Enum.UI_2D;
    bg.addComponent(UITransform);
    bg.setParent(this.root);
    this.courtGfx = bg.addComponent(Graphics);
    courtRenderer.draw(this.courtGfx, this.vp);

    // 动态层:每帧重绘(球员、羽毛球、特效粒子)
    const dyn = new Node("dyn");
    dyn.layer = Layers.Enum.UI_2D;
    dyn.addComponent(UITransform);
    dyn.setParent(this.root);
    this.g = dyn.addComponent(Graphics);

    // 画布内世界提示层(落点圈/训练时机条/拍数徽标/赛点旗标,老 hud.js)
    this.hudOverlay = new HudOverlay(this.root, this.vp);

    // 角色名牌/球衣号文字层(sprites 画不了字,Label 补)
    this.tagLayer = new Node("tags");
    this.tagLayer.layer = Layers.Enum.UI_2D;
    this.tagLayer.addComponent(UITransform);
    this.tagLayer.setParent(this.root);

    // 飘字层:位于最上,不参与 clear
    this.floatLayer = new Node("floats");
    this.floatLayer.layer = Layers.Enum.UI_2D;
    this.floatLayer.addComponent(UITransform);
    this.floatLayer.setParent(this.root);

    // 屏幕特效层:白闪/氛围暗角(老 FX.drawTop)。挂在 world root 之外(不随镜头缩放)、
    // UIManager 面板之下(AFTER_SCENE_LAUNCH 才装,节点序天然在本层之后)
    const screenFx = new Node("screen-fx");
    screenFx.layer = Layers.Enum.UI_2D;
    screenFx.addComponent(UITransform);
    screenFx.setParent(parent);
    this.screenG = screenFx.addComponent(Graphics);

    // "PERFECT REPLAY" 转播水印:金边白字(老 replay.drawOverlay 的 strokeText/fillText)
    const tagNode = new Node("replay-tag");
    tagNode.layer = Layers.Enum.UI_2D;
    tagNode.addComponent(UITransform);
    tagNode.setParent(screenFx);
    tagNode.setPosition(0, this.vp.y(50), 0);
    this.replayOpacity = tagNode.addComponent(UIOpacity);
    this.replayOpacity.opacity = 0;
    this.replayTag = tagNode.addComponent(Label);
    this.replayTag.string = "PERFECT REPLAY";
    this.replayTag.fontSize = 28;
    this.replayTag.lineHeight = Math.round(28 * 1.2);
    this.replayTag.isBold = true;
    this.replayTag.horizontalAlign = Label.HorizontalAlign.CENTER;
    this.replayTag.enableOutline = true;
    this.replayTag.outlineColor = new Color().fromHEX("#ffe14d");
    this.replayTag.outlineWidth = 3;
    this.replayTag.color = new Color(255, 255, 255, 255);

    // 跳过提示小字:告知玩家轻触即跳,绝不死机
    const hintNode = new Node("replay-hint");
    hintNode.layer = Layers.Enum.UI_2D;
    hintNode.addComponent(UITransform);
    hintNode.setParent(tagNode);
    hintNode.setPosition(0, -26, 0);
    const hintLabel = hintNode.addComponent(Label);
    hintLabel.string = "点击任意处跳过 · TAP TO SKIP";
    hintLabel.fontSize = 12;
    hintLabel.lineHeight = 16;
    hintLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
    hintLabel.enableOutline = true;
    hintLabel.outlineColor = new Color(0, 0, 0, 220);
    hintLabel.outlineWidth = 2;
    hintLabel.color = new Color().fromHEX("#d8e2ff");

    // 挥拍弧光残影接线:sprites 在挥拍 active 窗口每帧推入,这里负责衰减与渲染
    // (老 fx.js addSwingArc 的职责;上限 30 条与老版一致)
    setSwingArcSink((fx) => {
      const e: SwingArcGhost = { ...fx, life: C.fx.swingArcTrail || 4, max: C.fx.swingArcTrail || 4 };
      this.swingArcs.push(e);
      if (this.swingArcs.length > 30) this.swingArcs.shift();
    });
  }

  /** 名牌文字池:按需增长,标签样式对齐 sprites.ts 的 fillText 约定 */
  private ensureTags(count: number): void {
    while (this.tags.length < count) {
      const n = new Node("tag");
      n.layer = Layers.Enum.UI_2D;
      n.addComponent(UITransform);
      n.setParent(this.tagLayer);
      const l = n.addComponent(Label);
      l.fontSize = 10;
      l.lineHeight = 12;
      l.isBold = true;
      l.horizontalAlign = Label.HorizontalAlign.CENTER;
      this.tags.push(l);
    }
  }

  /** 每帧同步名牌(颜色/文字规则 = sprites.ts drawPlayerTag 注释) */
  private syncTags(players: Player[], rxs: number[], rys: number[]): void {
    let i = 0;
    for (let k = 0; k < players.length; k++) {
      const p = players[k];
      if (p.hideTag) continue;
      this.ensureTags(i + 1);
      const tag = this.tags[i++];
      const label = p.label || (p.isAI ? "AI" : "YOU");
      const name = label === "你" ? "YOU" : label;
      const isMainUser = !p.isAI && (label === "你" || label === "P1" || label === "YOU");
      const isPartner = label === "搭档";
      const isP2 = label === "P2";
      tag.node.active = true;
      tag.node.setPosition(Math.round(this.vp.x(rxs[k])), Math.round(this.vp.y(rys[k] - C.player.h - 18 + 0.5)), 0);
      tag.string = name;
      tag.color = isMainUser
        ? new Color().fromHEX(p.side === "left" ? "#ffe14d" : "#3ea8ff")
        : isPartner ? new Color().fromHEX("#6ee7b7")
        : isP2 ? new Color().fromHEX("#7fd0ff")
        : new Color(255, 255, 255, 173);
    }
    for (let k = i; k < this.tags.length; k++) this.tags[k].node.active = false;
  }

  // ---------- 球场主题与触网物理 ----------
  hitNet(hitY?: number, power = 1.0): void {
    courtRenderer.hitNet(hitY, power);
  }

  cycleCourtTheme(): CourtThemeItem {
    const t = courtRenderer.cycleTheme();
    this.redrawCourt();
    return t;
  }

  setCourtTheme(themeId: string): boolean {
    const ok = courtRenderer.setTheme(themeId);
    if (ok) this.redrawCourt();
    return ok;
  }

  getCourtTheme(): CourtThemeItem {
    return courtRenderer.getTheme();
  }

  private redrawCourt(rallyCount = 0): void {
    this.courtGfx.clear();
    courtRenderer.draw(this.courtGfx, this.vp, rallyCount);
  }

  // ---------- rules.setTrailHook 的落点 ----------
  pushTrail(b: Ball): void {
    const shot = b.shot;
    const isSmash = !!(shot && shot.kind === "smash");
    const isSweet = !!(shot && (shot.sweet || shot.perfect));
    // 连击热手:本分内连到 fireAt 拍好球,残影换成「火热」风格(寿命最长)
    const isFire = !!shot && (shot.heat ?? 0) >= (C.heat.fireAt || 3);
    // 档位越长寿命越长(老 ballTrail:甜蜜重扣 +6,甜蜜 +sweetLen,扣杀 +6)
    const len = isFire ? (C.fx.trailSweetLen || 24) + 8
      : (isSmash && isSweet) ? (C.fx.trailSweetLen || 24) + 6
      : isSweet ? (C.fx.trailSweetLen || 24)
      : isSmash ? C.fx.trailLen + 6
      : C.fx.trailLen;
    this.trail.push({ x: b.x, y: b.y, life: len, max: len, isSmash, isSweet, isFire });
    if (this.trail.length > 70) this.trail.shift();
  }

  /** 震屏总量:调用方只管「这次多狠」,是否生效由设置里的开关决定;vert = 纵向分量(落地冲击用) */
  shake(amt: number, vert = 0): void {
    if (!Settings.hintShake) return;
    this.shakeAmt = Math.max(this.shakeAmt, amt);
    this.shakeAmtV = Math.max(this.shakeAmtV, vert);
  }

  // ---------- 镜头四件套(老 FX.punch/slowmo/flash 同名同义) ----------
  /** 镜头冲击:整块世界向击球点推近一瞬。只放大不缩小,画面边缘只会裁进世界,不会露底 */
  punch(wx: number, wy: number, z: number): void {
    if (!z || z <= this.camZ || !Number.isFinite(wx) || !Number.isFinite(wy)) return;
    this.camZ = z; this.camX = wx; this.camY = wy;
  }

  /** 赛点慢动作:timeScale 由主循环乘进累加器;BGM 跑在音频时钟上,节奏不被拖慢 */
  slowmo(frames: number, fac: number): void {
    this.slowT = Math.max(this.slowT, frames);
    this.slowFac = fac || 0.34;
  }

  /** 主循环每帧取时间缩放(慢动作 <1,平时 1) */
  timeScale(): number { return this.slowT > 0 ? this.slowFac : 1; }

  /** 击球白闪(全屏白光一闪即逝,强度衰减在 stepFx) */
  whiteFlash(a: number): void {
    if (a > this.flash) this.flash = a;
  }

  /** 氛围暗角输入(每帧喂一次;渲染层只读) */
  setAtmo(state: string, rally: number, matchPoint: boolean): void {
    this.atmo.state = state;
    this.atmo.rally = rally;
    this.atmo.matchPoint = matchPoint;
  }

  /** 回放转播氛围渐入度 0..1(0 = 隐藏;game 层每帧喂 Replay.overlayAlpha 与标题) */
  setReplayOverlay(alpha: number, title?: string): void {
    this.replayAlpha = alpha;
    this.replayOpacity.opacity = Math.round(255 * alpha * 0.85);
    if (title && this.replayTag) {
      this.replayTag.string = title;
    }
  }

  /** 按拍预告辉光级别 0..1(0 = 无;与击球按钮的 setSwingGlow 同源同值) */
  setSwingCue(level: number): void {
    this.swingCue = level;
  }

  /**
   * 事件驱动的飘字(老 FX.float 的精简版:上浮 + 淡出)。
   * 「飘字提示」开关掐在夸奖/教学类入口 —— 关掉时连「早了!晚了!」这类评价字一起静音。
   * 系统信息字(下网/出界/平分等)走 floatSys,不受开关影响。
   * 采用节点对象池(floatPool),寿命耗尽时隐藏并回收入池,杜绝节点泄露与幽灵残留
   */
  float(wx: number, wy: number, text: string, color: string, size: number, life: number, vy = -1): void {
    if (!Settings.hintFloat) return;
    this.floatSpawn(wx, wy, text, color, size, life, vy, false);
  }

  /** 系统信息飘字:下网/出界/擦网/平分/训练结果等,关掉「飘字提示」也照常显示 */
  floatSys(wx: number, wy: number, text: string, color: string, size: number, life: number, vy = -1): void {
    this.floatSpawn(wx, wy, text, color, size, life, vy, true);
  }

  private floatSpawn(wx: number, wy: number, text: string, color: string, size: number, life: number, vy: number, sys: boolean): void {
    let item = this.floatPool.pop();
    if (!item) {
      const node = new Node("float");
      node.layer = Layers.Enum.UI_2D;
      node.addComponent(UITransform);
      const label = node.addComponent(Label);
      const opacity = node.addComponent(UIOpacity);
      node.setParent(this.floatLayer);
      item = { node, label, opacity, life: 0, maxLife: 0, vy: -1 };
    }
    item.life = life;
    item.maxLife = life;
    item.vy = vy || -1;
    item.sys = sys;
    item.node.setPosition(this.vp.x(wx), this.vp.y(wy), 0);
    item.label.string = text;
    item.label.fontSize = size;
    item.label.lineHeight = Math.round(size * 1.15);
    item.label.color = color.startsWith("#") ? new Color().fromHEX(color) : new Color(255, 255, 255, 255);
    item.opacity.opacity = 255;
    item.node.active = true;
    this.floats.push(item);
  }

  /** 清空当前所有飘字(换局/重新发球/重置时调用) */
  clearFloats(): void {
    for (let i = 0; i < this.floats.length; i++) {
      const f = this.floats[i];
      f.node.active = false;
      f.opacity.opacity = 0;
      this.floatPool.push(f);
    }
    this.floats.length = 0;
  }

  /**
   * 每模拟步推进(寿命计数,帧率无关)。
   * frozen = hitstop 定格:镜头/白闪/慢动作计时/震屏/粒子全部冻住
   * (老 FX.update 的早退语义——「先定格再慢放」,冲击粒子也一起冻);
   * 飘字/拖尾/球场动态照走:前者是信息反馈要可读,后者老版 hitstop 分支也在走。
   */
  stepFx(dt = 1 / 60, frozen = false): void {
    if (!frozen) {
      this.shakeAmt *= 0.85;
      this.shakeX = this.shakeAmt > 0.3 ? (Math.random() * 2 - 1) * this.shakeAmt : 0;
      this.shakeAmtV *= 0.85;
      this.shakeY = this.shakeAmtV > 0.3 ? (Math.random() * 2 - 1) * this.shakeAmtV : 0;

      if (this.flash > 0.002) this.flash *= C.fx.flashDecay || 0.82;
      else this.flash = 0;
      // 镜头指数回弹;慢动作里步进变慢,回弹自然放慢,镜头会「停在」重扣上
      this.camZ = 1 + (this.camZ - 1) * (C.fx.punchDecay || 0.85);
      if (this.camZ < 1.001) this.camZ = 1;
      if (this.slowT > 0) this.slowT--;

      // 推进打击特效粒子(冲击波/火花/羽毛/彩带)与弧光残影/球残影寿命
      // (老 FX.update 同体:hitstop 早退时这些一起冻住)
      this.fx.step(dt);
      for (const s of this.swingArcs) s.life--;
      this.swingArcs = this.swingArcs.filter((s) => s.life > 0);
      for (const t of this.trail) t.life--;
      this.trail = this.trail.filter((t) => t.life > 0);
    }

    let alive = 0;
    for (let i = 0; i < this.floats.length; i++) {
      const f = this.floats[i];
      f.life--;
      if (f.life > 0) {
        this.floats[alive++] = f;
      } else {
        f.node.active = false;
        f.opacity.opacity = 0;
        this.floatPool.push(f);
      }
    }
    this.floats.length = alive;

    // 推进球场动态(海浪、观众微动、落花、晃网)
    courtRenderer.step(dt);
  }

  /**
   * 每渲染帧:插值 + 全量重绘。
   * animT 由胶水层决定:比赛进行中用世界时钟(hitstop 时身体彻底不动),
   * 面板/暂停态用帧时钟兜底维持呼吸 —— 与老 game.js render() 同一约定。
   */
  render(players: Player[], ball: Ball | null, alpha: number, animT: number, skin: SkinDef | null, rallyCount = 0): void {
    this.frameT++;
    const g = this.g;
    g.clear();

    // ---------- 镜头合成:绕击球点缩放(只放大)+ 震屏位移 ----------
    // 焦点在 root 本地坐标的位置缩放前后必须重合 → pos' = base + (1-z)×pivot
    let px = 0, py = C.view.offsetY;
    if (this.camZ > 1.001) {
      const k = 1 - this.camZ;
      px = k * this.vp.x(this.camX);
      py = C.view.offsetY + k * this.vp.y(this.camY);
    }
    this.root.setScale(this.camZ, this.camZ, 1);
    this.root.setPosition(px + this.shakeX, py + this.shakeY, 0);

    // 动态球场重绘(包含球网弹性晃动、看台荧光棒、海浪、霓虹粒子等)
    this.redrawCourt(rallyCount);

    // 插值:120Hz 屏也不见阶梯;离网远的先画,近网压前(与老 render 同序)
    const order = players.slice().sort(
      (a, b) => Math.abs(C.court.netX - b.x) - Math.abs(C.court.netX - a.x));
    const rxs: number[] = [], rys: number[] = [];
    for (const p of order) {
      const rx = lerp(p.px, p.x, alpha);
      const ry = lerp(p.py, p.y, alpha);
      rxs.push(rx); rys.push(ry);
      drawPlayer(g, this.vp, { ...p, x: rx, y: ry }, animT, alpha, ball);
    }
    // 名牌文字与球衣号(与角色同层叠加)
    this.syncTags(order, rxs, rys);

    // 羽毛球(甜蜜/完美时残影由下方 trail 层接力)
    if (ball && (ball.live || ball.held)) {
      const bx = ball.held ? ball.x : lerp(ball.px, ball.x, alpha);
      const by = ball.held ? ball.y : lerp(ball.py, ball.y, alpha);
      // sqR:形变的帧间插值(drawShuttle 无 alpha 参数,渲染前补进副本)
      const sqR = lerp(ball.sqPrev ?? ball.sq, ball.sq ?? 1, alpha);
      drawShuttle(g, this.vp, { ...ball, x: bx, y: by, sqR } as Ball, skin, this.swingCue);
    }

    // 球残影(设计款专属拖尾优先:star/flame/petal/rainbow;未装备或纯色款走老风格:
    // 普通白雾/甜蜜青紫霓虹彗尾/扣杀金焰流星/甜蜜重扣四层焰核/连击火热红金焰)。
    // 画在球之后(老 drawWorld 在 shuttle 之后),残影罩住球形成拖尾
    const trailStyle = skin?.trailStyle ?? null;
    for (let i = 0; i < this.trail.length; i++) {
      const s = this.trail[i];
      const a = s.life / s.max;
      const tx = this.vp.x(s.x), ty = this.vp.y(s.y);
      if (trailStyle) {
        this.trailStyledDot(g, tx, ty, s, a, trailStyle, i);
        continue;
      }
      if (s.isFire) {
        this.trailDot(g, tx, ty, 5.5 + a * 7.5, "#ff4d4d", 0.55 * a);
        this.trailDot(g, tx, ty, 3.8 + a * 5, "#ff6a1f", 0.75 * a);
        this.trailDot(g, tx, ty, 2.2 + a * 2.6, "#ffe14d", 0.92 * a);
        this.trailDot(g, tx, ty, 1.1 + a * 1.3, "#ffffff", 0.97 * a);
      } else if (s.isSmash && s.isSweet) {
        this.trailDot(g, tx, ty, 6 + a * 8, "#ff6a1f", 0.75 * a);
        this.trailDot(g, tx, ty, 4.5 + a * 6, "#00f0ff", 0.85 * a);
        this.trailDot(g, tx, ty, 3 + a * 4, "#ffe14d", 0.95 * a);
        this.trailDot(g, tx, ty, 1.8 + a * 2, "#ffffff", 0.98 * a);
      } else if (s.isSmash) {
        this.trailDot(g, tx, ty, 4 + a * 6, "#ff6a1f", 0.7 * a);
        this.trailDot(g, tx, ty, 2.5 + a * 3.5, "#ffe14d", 0.9 * a);
        this.trailDot(g, tx, ty, 1.2 + a * 1.5, "#ffffff", 0.95 * a);
      } else if (s.isSweet) {
        this.trailDot(g, tx, ty, 4 + a * 5.5, "#00f0ff", 0.65 * a);
        this.trailDot(g, tx, ty, 2.8 + a * 3.5, "#ffe14d", 0.8 * a);
        this.trailDot(g, tx, ty, 1.5 + a * 1.8, "#ffffff", 0.92 * a);
      } else {
        this.trailDot(g, tx, ty, 3 + a * 3, "#ffffff", 0.4 * a);
      }
    }

    // 绘制粒子与打击特效(冲击波/火花/羽毛/彩带等)
    this.fx.draw(g, this.vp);

    // 挥拍弧光残影(老 fx.js swingArcs):画在粒子之上,当帧弧光的余晖
    for (const sa of this.swingArcs) {
      drawSwingArcGhost(g, this.vp, sa, (sa.life / sa.max) * (C.fx.swingArcAlpha || 0.35));
    }

    // 若设置中关闭了飘字提示,只清夸奖/教学类飘字;系统信息字(下网/出界/DEUCE)保留
    if (!Settings.hintFloat && this.floats.length > 0) {
      let alive = 0;
      for (let i = 0; i < this.floats.length; i++) {
        const f = this.floats[i];
        if (!f.sys) {
          f.node.active = false;
          f.opacity.opacity = 0;
          this.floatPool.push(f);
        } else {
          this.floats[alive++] = f;
        }
      }
      this.floats.length = alive;
    }

    // 飘字:上浮 + 末段淡出
    for (let i = 0; i < this.floats.length; i++) {
      const f = this.floats[i];
      const pos = f.node.position;
      f.node.setPosition(pos.x, pos.y + f.vy, 0);
      const remain = Math.max(0, f.life / f.maxLife);
      f.opacity.opacity = remain < 0.35 ? Math.round(255 * (remain / 0.35)) : 255;
    }

    // 屏幕特效(白闪/氛围暗角):屏幕空间,画在 world 之上、UI 面板之下
    this.drawScreenFx();
  }

  // ---------- 屏幕特效层(老 FX.drawTop 的白闪 + 三种氛围暗角) ----------
  /** 白闪与慢动作/长回合/赛点三种暗角;Cocos 无径向渐变,用描边环近似(court.drawVignette 同手法) */
  private drawScreenFx(): void {
    const g = this.screenG;
    g.clear();

    // 白闪:全屏白光一闪,强度 ×0.5(老 flash*0.5),衰减到近零就不再画
    if (this.flash > 0.02) {
      g.fillColor = new Color(255, 255, 255, Math.round(255 * this.flash * 0.5));
      g.rect(-1600, -1000, 3200, 2000);
      g.fill();
    }

    const W = C.world.w, H = C.world.h;
    const cx = this.vp.x(W / 2), cy = this.vp.y(H / 2);
    const t = this.frameT;

    // 慢动作转播暗角:像转播镜头的特写氛围,把注意力聚到球场中央;结尾随 slowT 自然淡出
    if (this.slowT > 0) {
      const a = Math.min(1, this.slowT / 10) * 0.42;
      this.strokeVignette(g, cx, cy, H * 0.78, H * 0.32, "#04060e", a);
    }
    // 长回合金色边缘暗晕:8 拍以上四角微泛金光,呼吸脉动
    if (this.atmo.state === "RALLY" && this.atmo.rally >= 8) {
      const fac = Math.min(1, (this.atmo.rally - 7) / 6);
      const pulse = 0.85 + Math.sin(t * 0.14) * 0.15;
      this.strokeVignette(g, cx, cy, W * 0.58, H * 0.36, "#ffbe28", 0.11 * fac * pulse);
    }
    // 赛点暗红张力暗角:纯边缘呼吸,不遮挡核心打球区
    if ((this.atmo.state === "SERVE" || this.atmo.state === "RALLY") && this.atmo.matchPoint) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.08);
      this.strokeVignette(g, cx, cy, W * 0.58, H * 0.36, "#6e0a14", 0.07 + 0.05 * pulse);
    }

    // 回放转播氛围:暗角 + 半透明灰压暗近似去饱和(Cocos 2D 无 saturation 合成模式)。
    // 画在最后压过上面一切,对应老 game.js 里 Replay.drawOverlay 在 render 之后的调用序
    if (this.replayAlpha > 0) {
      this.strokeVignette(g, cx, cy, H * 0.8, H * 0.3, "#000000", this.replayAlpha * 0.5);
      g.fillColor = new Color(128, 128, 128, Math.round(255 * this.replayAlpha * 0.15));
      g.rect(-1600, -1000, 3200, 2000);
      g.fill();
    }
  }

  /** 球残影单层圆点(老 fx.js trails 的 fillStyle+globalAlpha+arc 组合) */
  private trailDot(g: Graphics, x: number, y: number, r: number, hex: string, alpha: number): void {
    if (alpha <= 0.004) return;
    const c = new Color();
    c.fromHEX(hex);
    c.a = Math.round(255 * alpha);
    g.fillColor = c;
    g.circle(x, y, r);
    g.fill();
  }

  /** 设计款专属拖尾(皮肤 trailStyle):颜色/形状按风格走,大小保留击球档位的层级感 */
  private trailStyledDot(g: Graphics, x: number, y: number, s: TrailDot, a: number,
    style: NonNullable<SkinDef["trailStyle"]>, idx: number): void {
    const tierK = (s.isSmash && s.isSweet) ? 1.5 : (s.isSmash || s.isSweet) ? 1.2 : 0.85;
    const t = this.frameT;
    if (style === "star") {
      // 彗星羽:蓝白星芒 —— 辉核 + 白心 + 十字星辉(随相位闪烁)
      const r = (2.2 + a * 3.4) * tierK;
      const tw = 0.6 + 0.4 * Math.sin(t * 0.25 + idx * 1.7);
      this.trailDot(g, x, y, r * 1.15, "#7ecbff", 0.5 * a);
      this.trailDot(g, x, y, r * 0.55, "#ffffff", 0.95 * a);
      if (a > 0.25) {
        g.strokeColor = new Color(234, 246, 255, Math.round(255 * 0.7 * a * tw));
        g.lineWidth = 1.2;
        g.moveTo(x - r * 1.9, y);
        g.lineTo(x + r * 1.9, y);
        g.moveTo(x, y - r * 1.9);
        g.lineTo(x, y + r * 1.9);
        g.stroke();
      }
    } else if (style === "flame") {
      // 凤凰羽:橙红余烬三层焰核 + 一粒上飘火星
      this.trailDot(g, x, y, (3.5 + a * 5) * tierK, "#ff4d26", 0.45 * a);
      this.trailDot(g, x, y, (2.2 + a * 3.4) * tierK, "#ff9a3d", 0.7 * a);
      this.trailDot(g, x, y, (1.1 + a * 1.8) * tierK, "#ffe14d", 0.95 * a);
      const sparkX = x + Math.sin(t * 0.2 + idx * 2.3) * 3;
      const sparkY = y - (s.max - s.life) * 0.55;
      this.trailDot(g, sparkX, sparkY, 1.1 * tierK, "#ffd24d", 0.6 * a);
    } else if (style === "petal") {
      // 花语羽:粉色花瓣错落三层,飘落感靠中层的相位摆动
      this.trailDot(g, x, y, (3 + a * 4.5) * tierK, "#ffb7d0", 0.4 * a);
      this.trailDot(g, x + Math.sin(t * 0.15 + idx) * 2, y, (1.8 + a * 2.6) * tierK, "#ff8fb8", 0.75 * a);
      this.trailDot(g, x, y, (0.9 + a * 1.2) * tierK, "#ffe0ec", 0.95 * a);
    } else {
      // 星河羽:虹色星云 —— 每颗残影按存活进度转色相,白心收焦
      const hue = ((s.max - s.life) * 16 + t * 5) % 360;
      const r = (2.6 + a * 4.2) * tierK;
      this.trailDot(g, x, y, r * 1.35, hueColor(hue, 0.9, 0.55), 0.35 * a);
      this.trailDot(g, x, y, r, hueColor((hue + 40) % 360, 0.85, 0.68), 0.8 * a);
      this.trailDot(g, x, y, r * 0.45, "#ffffff", 0.95 * a);
    }
  }

  /** 径向渐变的描边环近似:外缘 alpha 峰值,向内 smoothstep 淡出到 0 */
  private strokeVignette(g: Graphics, cx: number, cy: number, rOuter: number, rInner: number, hex: string, alphaMax: number): void {
    if (alphaMax <= 0.004) return;
    const rings = 18;
    const w = Math.max(2, (rOuter - rInner) / rings);
    const col = new Color();
    col.fromHEX(hex);
    for (let i = 0; i < rings; i++) {
      const u = 1 - i / rings;               // 1=外缘 → 0=内缘
      const a = alphaMax * (u * u * (3 - 2 * u));
      if (a <= 0.004) continue;
      g.strokeColor = new Color(col.r, col.g, col.b, Math.round(a * 255));
      g.lineWidth = w;
      const r = rOuter - i * w;
      g.ellipse(cx, cy, r, r);
      g.stroke();
    }
  }
}

