// ============================================================
// 世界渲染层:视口变换 + 每帧重绘(角色/羽毛球/飞行丝带/打击粒子/飘字) + 镜头。
// Cocos Graphics 是保留式几何,这里采用「每帧 clear + 全量重绘」——
// 与老 canvas 全帧重绘同构,元素量级(两人一球)毫无压力。
// 渲染层只读游戏状态,不改任何逻辑字段。
// 两个"只住这里"的状态:球体运动学外观(shuttle-motion:滞后角/翻滚/裙摆颤动)
// 与飞行丝带(ribbon:按距离采样的锥形带)—— 都不回写 ball,关掉它们游戏照样跑。
// ============================================================
import { Color, Graphics, Label, Layers, Node, UIOpacity, UITransform } from "cc";
import { CFG } from "../core/config";
import { Settings } from "../core/settings";
import { clamp, lerp, rand } from "../core/utils";
import { Ball, GameEvent, Player, SkinDef } from "../core/types";
import type { StageDef } from "../core/campaign";
import { Rules } from "../core/rules";
import { Physics } from "../core/physics";
import { drawPlayer, drawShuttle, setSwingArcSink, drawSwingArcGhost, SwingArcFx, LungeGhost, drawLungeGhost, FlashGhost, drawFlashGhost } from "./sprites";
import { pal, withAlpha } from "./palette";
import { courtRenderer, CourtThemeItem } from "./court";
import { mulberry32, drawStarburst, drawCrossMark } from "./p5kit";
import { FXSystem } from "./fx";
import { HudOverlay } from "./hud-overlay";
import { Ribbon } from "./ribbon";
import { advanceShuttle, makeShuttleMotion, shuttleImpact } from "./shuttle-motion";
import { easeOutBack, fadePow } from "./easing";
import { drawFloatPlate, FloatPlateStyle, measureTextW } from "./p5kit";
import { applyFont } from "../game/fonts";

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

// ---------- 模块级常量色(帧循环里不再 new Color;引擎赋值时内部 .set() 拷贝,共享实例安全) ----------
/** 名牌身份色(与 sprites.ts drawPlayerTag 的用色约定同源) */
const TAG_MAIN_L = new Color().fromHEX("#ffe14d");
const TAG_MAIN_R = new Color().fromHEX("#3ea8ff");
/** 溜冰滑行冰雾:常量色提为模块级(球员循环每帧 new 曾是纯垃圾) */
const ICE_FOG_COL = new Color(220, 240, 255, 60);

/**
 * 一条上下沿都带锯齿的水墨横带(第 6 关的网前雾)。
 * 为什么要自己铺锯齿而不是 ellipse:P5 这套语言拒绝光滑圆圈(见 AGENTS「视觉语言」条),
 * 而"撕开的纸"这种边缘才读得出"这是一层挡着你的东西",不是一个光斑。
 * 牙的位置由齿数等分 + 一个随时间缓慢推移的相位给出 —— 逐帧只平移,不每帧 rand。
 */
function drawInkBand(
  g: Graphics, cx: number, cy: number, w: number, h: number,
  teeth: number, color: Color, alpha: number, t: number,
): void {
  if (alpha <= 0.01 || w < 2 || h < 2 || teeth < 2) return;
  const half = w / 2;
  const step = w / teeth;
  const bite = h * 0.22;                    // 牙深
  const shift = (t * 0.35) % step;          // 整层缓慢横移
  g.fillColor = withAlpha(color, alpha);
  g.moveTo(cx - half, cy);
  for (let i = 0; i <= teeth; i++) {        // 上沿锯齿
    const x = cx - half + i * step + shift * 0; // 相位只挪牙尖,不挪边界(否则带子会缩)
    g.lineTo(x, cy + h / 2 - (i % 2 === 0 ? 0 : bite));
  }
  g.lineTo(cx + half, cy);
  for (let i = teeth; i >= 0; i--) {        // 下沿锯齿(反向闭合)
    const x = cx - half + i * step;
    g.lineTo(x, cy - h / 2 + (i % 2 === 0 ? 0 : bite));
  }
  g.close();
  g.fill();
}
/** 流沙关(第 2 关)的颗粒与沙窝色阶 —— 见下面 SAND_* 的说明 */
const SAND_RND = mulberry32(0x5a4d);
/**
 * 沙窝/扬沙的 9 档不透明度阶梯:预先算好,帧循环里只按下标取。
 * (不每帧 new Color,也不用 Color.set —— 后者在 cc-shim 的类型里没有,拿到引擎里
 *  才存在;走阶梯表两边都成立,还省掉每球员每帧十几次分配。)
 */
const SAND_TROUGH_STEPS: Color[] = [];
const SAND_GRAIN_STEPS: Color[] = [];
for (let i = 0; i < 9; i++) {
  SAND_TROUGH_STEPS.push(new Color(96, 58, 16, Math.round(CFG.env.sand.troughA * (i / 8) * 255)));
  SAND_GRAIN_STEPS.push(new Color(246, 226, 176, Math.round(CFG.env.sand.grainA * (i / 8) * 255)));
}
const SAND_GRAINS: { dx: number; dy: number; sz: number; k: number }[] = [];
for (let i = 0; i < CFG.env.sand.count; i++) {
  SAND_GRAINS.push({
    dx: (SAND_RND() * 2 - 1) * CFG.env.sand.spread,
    dy: -SAND_RND() * CFG.env.sand.rise,
    sz: 1.4 + SAND_RND() * 1.8,
    k: 0.45 + SAND_RND() * 0.8,
  });
}
const TAG_PARTNER = new Color().fromHEX("#6ee7b7");
const TAG_P2 = new Color().fromHEX("#7fd0ff");
const TAG_DEFAULT = new Color(255, 255, 255, 173);
/** 体力条(绿/黄/红闪两相/底槽) */
const STAMINA_GREEN = new Color(50, 220, 120, 230);
const STAMINA_YELLOW = new Color(255, 200, 40, 230);
const STAMINA_RED_HI = new Color(255, 50, 60, 255);
const STAMINA_RED_LO = new Color(255, 50, 60, 80);
const STAMINA_BG = new Color(10, 14, 24, 180);
/** 禁区警示(闯关 forbiddenNetZone) */
const ZONE_GRID = new Color(255, 30, 60, 42);
const ZONE_HATCH = new Color(255, 60, 80, 150);
const ZONE_EDGE = new Color(255, 40, 60, 220);

/** 绘制排序比较器:离网远的先画,近网压前(模块级,别在帧循环里新建闭包) */
function byNetDist(a: Player, b: Player): number {
  return Math.abs(C.court.netX - b.x) - Math.abs(C.court.netX - a.x);
}

/** 残影队列的原地寿命压缩:递减 + 淘汰一步完成,不再每步 filter 出新数组(四组 × 60Hz) */
function compactGhosts<T extends { life: number }>(arr: T[]): T[] {
  let alive = 0;
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i];
    if (--e.life > 0) arr[alive++] = e;
  }
  arr.length = alive;
  return arr;
}

interface FloatText {
  node: Node;
  label: Label;
  /** P5 底板(斜切黑片/星芒):独立 Graphics 子节点,spawn 时重画一次(retained) */
  plateG: Graphics;
  /** 当前底板样式;none = 裸字(系统信息/轻量提示防刷屏) */
  plate: FloatPlateStyle;
  /** 出生点世界 x:场边底板字靠它记边,同侧后到的字向下错行不叠成一块 */
  wx: number;
  opacity: UIOpacity;
  life: number;
  maxLife: number;
  vy: number;
  /** 系统信息字(下网/出界/DEUCE 等):不受「飘字提示」开关影响 */
  sys?: boolean;
  /** 已进行帧数(弹入曲线用;与 life 同源,由 stepFx 递增) */
  age: number;
}

/** 氛围暗角的输入(渲染层不 import Rules,由 game-root 每帧喂入只读快照) */
export interface AtmoState { state: string; rally: number; matchPoint: boolean }

/** 挥拍弧光残影:sprites 经 sink 推入,这里补寿命做衰减(老 fx.js addSwingArc) */
interface SwingArcGhost extends SwingArcFx { life: number; max: number }

export class WorldView {
  readonly root: Node;          // 受震屏/镜头冲击影响的容器
  private courtGfx: Graphics;   // 球场静态层:只在主题切换时画一次
  private courtSlowGfx!: Graphics; // 球场慢速层:观众/LED 跑马,每 3 渲染帧
  private courtDynGfx!: Graphics;  // 球场动态层:球网/光束/微尘,每帧
  private g: Graphics;
  private vp: Viewport;
  private floatLayer: Node;
  private tagLayer: Node;
  private floats: FloatText[] = [];
  private floatPool: FloatText[] = [];
  /** 头顶名牌池(YOU/CPU/搭档…);胸前球衣号已去掉,人物身上不再有数字 */
  private tags: Label[] = [];
  /** 飞行轨迹:按距离采样的锥形丝带(取代老 fx.js 的"每点叠同心圆") */
  private ribbon = new Ribbon();
  /** 球体运动学外观(滞后角/翻滚/裙摆颤动)—— 只住渲染层,不回写 ball */
  private shuttleMot = makeShuttleMotion();
  /** drawShuttle 的入参副本:每帧 Object.assign 复用同一对象,不再 spread 出垃圾。
   *  sqR 是渲染层算的形变插值值(Ball 上没有,drawShuttle 按内部 RBall 读) */
  private ballView = {} as Ball & { sqR?: number };
  /** drawPlayer 的入参副本:同 ballView 手法(旧版每帧每人 spread 一个完整 Player) */
  private playerView = {} as Player;
  /** 帧内持久数组:绘制排序与插值坐标(旧版每帧 slice()+sort()+两个新数组) */
  private readonly drawOrder: Player[] = [];
  private readonly rxs: number[] = [];
  private readonly rys: number[] = [];
  private swingArcs: SwingArcGhost[] = [];
  readonly fx = new FXSystem(); // 完整打击特效与粒子系统
  /** 画布内世界提示层(老 hud.js:落点圈/训练时机条/拍数徽标/赛点旗标) */
  readonly hudOverlay: HudOverlay;
  shakeX = 0;
  shakeY = 0;
  private shakeAmt = 0;
  private shakeAmtV = 0;
  /** 震屏振荡相位:纯随机噪声读起来像电视雪花,阻尼正弦才像"被顶了一下" */
  private shakePhase = 0;
  private shakeDirX = 1;
  private shakeDirY = 0.6;
  frameT = 0;

  // ---------- 镜头状态(老 fx.js 的 camZ/slowT;衰减全按模拟步走) ----------
  private camZ = 1;             // 镜头缩放:只放大不缩小,指数回弹到 1
  private camX = 0;             // punch 焦点(击球点,世界坐标)
  private camY = 0;
  private slowT = 0;            // 慢动作剩余模拟帧
  private slowFac = 1;          // 慢动作时间缩放
  private screenG!: Graphics;   // 屏幕特效层:关卡环境特效(不随镜头缩放)
  private atmo: AtmoState = { state: "", rally: 0, matchPoint: false };
  /** 按拍预告辉光级别(game 层 updateSwingCue 每帧喂;羽毛球本体发光,见 sprites.drawShuttle) */
  private swingCue = 0;
  /** 跨步高速突进流风残影队列 */
  private lungeGhosts: LungeGhost[] = [];
  /** 闪现折跃起点电离消散残影队列 */
  private flashGhosts: FlashGhost[] = [];
  /** 时空领域中羽毛球的慢放幽灵残影队列 */
  private ballChronoGhosts: { x: number; y: number; life: number; maxLife: number; vx: number; vy: number }[] = [];

  // 闯关模式关卡专属动态视觉缓存
  private sandstormParticles: { x: number; y: number; len: number; spd: number; alpha: number }[] = [];
  /** 落樱(第 8 关):出生定形的花瓣表,逐帧只平移 + 摆动,横向吃**真风符号** */
  private sakuraPetals: { x: number; y: number; ph: number; sz: number; spd: number }[] = [];
  /** 磁轨过冲(第 13 关):球被电离加速那一拍的余辉倒计时 */
  private railHot = 0;
  /** 机制事件的上一条计数(居合/禁区/力竭/电浆…只在**上升沿**飘一次字) */
  private mechSeen = { iai: -1, zone: -1, exhausted: -1, laser: -1, focus: -1, zen: -1 };
  /** 上面那组底数属于哪一关的哪一分:换关或换分都重打底数,免得跨局误报 */
  private mechStage = "";
  private decoyBall: { x: number; y: number; vx: number; vy: number; t: number } | null = null;
  private lastDecoyOwner: unknown = null;

  constructor(parent: Node) {
    this.vp = makeViewport();
    this.root = new Node("world");
    this.root.layer = Layers.Enum.UI_2D;
    this.root.addComponent(UITransform);
    this.root.setPosition(0, C.view.offsetY, 0);   // 整体抬高:地面线上移,底部让出虚拟按键带
    this.root.setParent(parent);

    // 球场多主题层 —— 性能分层(见 court.ts「分层绘制总调度」注释):
    //   court-bg   静态(穹顶/看台/地板/广告板):主题切换时才画一次,旧版每帧全量重画是最大卡顿源;
    //   court-slow 慢速(观众 bob/LED 跑马/荧光棒):动得慢但人多,每 3 渲染帧;
    //   court-dyn  动态(球网/光束/微尘/闪光灯):每渲染帧。
    // 节点序即叠放序,与旧版单层内的绘制顺序对发生重叠的图元保持一致。
    const bg = new Node("court-bg");
    bg.layer = Layers.Enum.UI_2D;
    bg.addComponent(UITransform);
    bg.setParent(this.root);
    this.courtGfx = bg.addComponent(Graphics);
    const bgSlow = new Node("court-slow");
    bgSlow.layer = Layers.Enum.UI_2D;
    bgSlow.addComponent(UITransform);
    bgSlow.setParent(this.root);
    this.courtSlowGfx = bgSlow.addComponent(Graphics);
    const bgDyn = new Node("court-dyn");
    bgDyn.layer = Layers.Enum.UI_2D;
    bgDyn.addComponent(UITransform);
    bgDyn.setParent(this.root);
    this.courtDynGfx = bgDyn.addComponent(Graphics);
    courtRenderer.drawStaticTo(this.courtGfx, this.vp);
    courtRenderer.consumeStaticDirty();   // 构造期已画好静态层,清掉脏标记

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

    for (let i = 0; i < 36; i++) {
      this.sandstormParticles.push({
        x: Math.random() * C.world.w,
        y: Math.random() * C.world.h,
        len: 16 + Math.random() * 26,
        spd: 6 + Math.random() * 7,
        alpha: 0.25 + Math.random() * 0.45,
      });
    }
    // 落樱花瓣(第 8 关):构造期定形(与 court.ts 的风丝同一条规矩 —— 之后逐帧只走位,
    // 每帧 rand 会抖成噪点),此后横向漂移吃**真风符号**,让"花瓣往哪飘 = 球往哪偏"同源。
    for (let i = 0; i < C.env.sakura.count; i++) {
      this.sakuraPetals.push({
        x: Math.random() * C.world.w,
        y: Math.random() * C.world.h,
        ph: Math.random() * Math.PI * 2,
        sz: C.env.sakura.size * (0.6 + Math.random() * 0.8),
        spd: 0.55 + Math.random() * 0.9,
      });
    }

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
      applyFont(l, false);
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
      // 身份色为模块级常量(Label.color 赋值时引擎内部拷贝,共享实例安全)
      tag.color = isMainUser
        ? (p.side === "left" ? TAG_MAIN_L : TAG_MAIN_R)
        : isPartner ? TAG_PARTNER
        : isP2 ? TAG_P2
        : TAG_DEFAULT;
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
    courtRenderer.drawStaticTo(this.courtGfx, this.vp);
    this.courtSlowGfx.clear();
    courtRenderer.drawSlowTo(this.courtSlowGfx, this.vp, rallyCount);
    this.courtDynGfx.clear();
    courtRenderer.drawDynTo(this.courtDynGfx, this.vp, rallyCount);
    courtRenderer.consumeStaticDirty();
  }

  // ---------- rules.setTrailHook 的落点 ----------
  /**
   * 老实现在这里往 trail 数组塞一个圆点;现在改成**只打档位戳** ——
   * 真正的入点由 render() 按距离采样(才不会再出现扣杀点稀疏、搓球点扎堆),
   * rules 侧的采样节拍(每 2 模拟帧)一行没动。
   */
  pushTrail(b: Ball): void {
    this.ribbon.stamp(b.shot);
  }

  /** 清掉飞行轨迹(换局/重发球:上一分的尾迹绝不能带进下一分) */
  clearTrail(): void {
    this.ribbon.clear();
  }

  /**
   * 击球瞬间喂给球体运动学(与震屏/白闪同一入口):
   * tier 决定 pop 强度与档位辉光,strength≈这一拍有多狠(0..1)。
   */
  shuttleHit(tier: number, strength: number, heat = 0): void {
    shuttleImpact(this.shuttleMot, tier, clamp(strength, 0, 1), heat);
  }

  /** 震屏总量:调用方只管「这次多狠」,是否生效由设置里的开关决定;vert = 纵向分量(落地冲击用) */
  shake(amt: number, vert = 0, dirAng?: number): void {
    if (!Settings.hintShake) return;
    this.shakeAmt = Math.max(this.shakeAmt, amt);
    this.shakeAmtV = Math.max(this.shakeAmtV, vert);
    // 冲击方向:主轴沿来球速度,读起来是"被这一下顶开",不是整屏均匀发抖
    if (dirAng !== undefined && Number.isFinite(dirAng)) {
      this.shakeDirX = Math.cos(dirAng);
      this.shakeDirY = Math.sin(dirAng);
    } else {
      this.shakeDirX = 1;
      this.shakeDirY = vert > 0 ? 0.6 : 1;
    }
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

  /** 氛围暗角输入(每帧喂一次;渲染层只读) */
  setAtmo(state: string, rally: number, matchPoint: boolean): void {
    this.atmo.state = state;
    this.atmo.rally = rally;
    this.atmo.matchPoint = matchPoint;
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
  float(wx: number, wy: number, text: string, color: string, size: number, life: number, vy = -1, plate: FloatPlateStyle = "none"): void {
    if (!Settings.hintFloat) return;
    this.floatSpawn(wx, wy, text, color, size, life, vy, false, plate);
  }

  /** 系统信息飘字:下网/出界/擦网/平分/训练结果等,关掉「飘字提示」也照常显示 */
  floatSys(wx: number, wy: number, text: string, color: string, size: number, life: number, vy = -1, plate: FloatPlateStyle = "none"): void {
    this.floatSpawn(wx, wy, text, color, size, life, vy, true, plate);
  }

  private floatSpawn(wx: number, wy: number, text: string, color: string, size: number, life: number, vy: number, sys: boolean, plate: FloatPlateStyle = "none"): void {
    let item = this.floatPool.pop();
    if (!item) {
      // 结构:根节点(UITransform+UIOpacity)下挂 plate(Graphics,先加 = 垫底)
      // 与 text(Label,后加 = 盖在底板上)。Label 必须下沉为子节点,否则被底板盖住。
      const node = new Node("float");
      node.layer = Layers.Enum.UI_2D;
      node.addComponent(UITransform);
      const opacity = node.addComponent(UIOpacity);
      const plateNode = new Node("plate");
      plateNode.layer = Layers.Enum.UI_2D;
      plateNode.addComponent(UITransform);
      const plateG = plateNode.addComponent(Graphics);
      plateNode.setParent(node);
      const labelNode = new Node("text");
      labelNode.layer = Layers.Enum.UI_2D;
      labelNode.addComponent(UITransform);
      const label = labelNode.addComponent(Label);
      applyFont(label, true);
      labelNode.setParent(node);
      node.setParent(this.floatLayer);
      item = { node, label, plateG, plate: "none", wx: 0, opacity, life: 0, maxLife: 0, vy: -1, age: 0 };
    }
    item.life = life;
    item.maxLife = life;
    item.age = 0;
    item.vy = vy || -1;
    item.sys = sys;
    // 场边底板字(评价/技能)同侧堆叠:数一下还活着的同侧底板字,新字向下错行
    // (行高 size*1.9,封顶两行),连打好球也不会两条 PERFECT 叠成一坨
    let sy = wy;
    if (plate !== "none") {
      const mySide = wx < C.court.netX ? 0 : 1;
      let n = 0;
      for (const o of this.floats) {
        if (o.plate === "none" || !o.node.active) continue;
        if ((o.wx < C.court.netX ? 0 : 1) === mySide) n++;
      }
      sy += Math.min(n, 2) * size * 1.9;
    }
    item.wx = wx;
    item.node.setPosition(this.vp.x(wx), this.vp.y(sy), 0);
    item.node.setScale(1, 1, 0);
    item.label.string = text;
    item.label.fontSize = size;
    item.label.lineHeight = Math.round(size * 1.15);
    item.label.color = color.startsWith("#") ? pal(color) : pal("#ffffff");
    item.opacity.opacity = 255;
    // P5 底板:每次 spawn 重画一次(天然规避原生 GraphicsKeepAlive 掉数据,
    // 也比 retainedDraw 少一个坑);带底板的字给 ±3° 随机倾斜,system 字保持正
    item.plate = plate;
    item.plateG.node.active = plate !== "none";
    item.node.angle = 0;
    if (plate !== "none") {
      // 底板强度/外扩都由 config.fx 下发(floatPlateDim/floatPlatePadScale):
      // 衬底只保 P5 骨架感,不让黑片/星芒盖过球
      const pad = (plate === "star" ? 44 : 24) * (C.fx.floatPlatePadScale ?? 1);
      const w = measureTextW(text, size) + pad;
      const h = size * 1.7;
      item.plateG.clear();
      drawFloatPlate(item.plateG, w, h, plate, pal(color), rand(-0.05, 0.05), C.fx.floatPlateDim ?? 1);
      item.node.angle = rand(-3, 3);
    }
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
   * 飘字照走:信息反馈要可读。
   * ball 只读不写:球体运动学与丝带老化都按模拟步走,120Hz 屏不会比 60Hz 快一倍。
   */
  stepFx(dt = 1 / 60, frozen = false, ball: Ball | null = null): void {
    if (!frozen) {
      // 震屏:振幅几何衰减 × 阻尼正弦 = "来回几下就定住"的一顶。
      // 老实现是纯随机噪声,读起来像电视雪花;余量很小时掺一点碎抖,
      // 免得大震完突然完全静止留个台阶。
      const F = C.fx;
      this.shakePhase += F.shakeFreq || 0.8;
      this.shakeAmt *= 0.85;
      this.shakeAmtV *= 0.85;
      const base = Math.sin(this.shakePhase) * this.shakeAmt;
      const vert = Math.sin(this.shakePhase * 0.8 + 1.1) * this.shakeAmtV;
      const micro = this.shakeAmt < 1.5 ? (Math.random() * 2 - 1) * this.shakeAmt * 0.25 : 0;
      this.shakeX = base * this.shakeDirX + micro;
      // 世界 y 向下、Graphics y 向上 → 方向分量取负
      this.shakeY = -(base * this.shakeDirY) - vert;

      // 镜头指数回弹;慢动作里步进变慢,回弹自然放慢,镜头会「停在」重扣上
      this.camZ = 1 + (this.camZ - 1) * (C.fx.punchDecay || 0.85);
      if (this.camZ < 1.001) this.camZ = 1;
      if (this.slowT > 0) this.slowT--;

      // 推进打击特效粒子(冲击波/火花/羽毛/彩带)与弧光残影/球残影寿命
      // (老 FX.update 同体:hitstop 早退时这些一起冻住)
      this.fx.step(dt);
      compactGhosts(this.swingArcs);
      compactGhosts(this.lungeGhosts);
      compactGhosts(this.flashGhosts);
      compactGhosts(this.ballChronoGhosts);
      this.ribbon.step();
      // 球体运动学:步长归一到 60Hz(本步 dt=1/60 → 1)
      advanceShuttle(this.shuttleMot, ball ? ball.vx : 0, ball ? ball.vy : 0,
        ball ? ball.sq : 1, dt * 60);
    }

    let alive = 0;
    for (let i = 0; i < this.floats.length; i++) {
      const f = this.floats[i];
      f.life--;
      f.age++;                       // 弹入曲线的进度(与 life 同源,按模拟步走)
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

    // 关卡侧风接进球场:椰树叶簇、浪花、网头彩带、漂浮粒子从此与球受到的那一下**同源同向**。
    // 从前 court.ts 里只有一条自己编的 sin×cos 装饰风,和 EnvModifier 半点关系都没有 ——
    // 第 1 关的风把球横推一百多像素,海滩照样按自己的节奏摆,玩家看到的动画和挨的那一下
    // 不是同一件事,机制因此等于隐形(用户原话:"完全没有动画效果提示")。
    // 有风时把装饰项压到 ambience.idle,免得两个符号打架读成"动画在随机动"。
    const envMod = Physics.getEnvModifier();
    const windNow = envMod ? Physics.windAt(Physics.envPhase()) : 0;
    courtRenderer.setWind(windNow * C.env.ambience.k, windNow !== 0 ? C.env.ambience.idle : 1);

    // 球场分层重绘:静态层仅在主题切换时重画;慢速层(观众/跑马)每 3 渲染帧;
    // 动态层(球网/光束/微尘)每帧。旧版这里每帧全量重画整个球场(~900 个图元)。
    if (courtRenderer.consumeStaticDirty()) {
      this.courtGfx.clear();
      courtRenderer.drawStaticTo(this.courtGfx, this.vp);
    }
    if (this.frameT % 3 === 0) {
      this.courtSlowGfx.clear();
      courtRenderer.drawSlowTo(this.courtSlowGfx, this.vp, rallyCount);
    }
    this.courtDynGfx.clear();
    courtRenderer.drawDynTo(this.courtDynGfx, this.vp, rallyCount);

    const stage = Rules.R.mode === "campaign" ? Rules.R.activeStage : null;
    // 这一关是不是"软沙地":判据只看关卡表声明的移动惩罚,不在渲染里写字面量
    const softSand = !!stage?.modifiers.player
      && ((stage.modifiers.player.accelMul ?? 1) < 1 || (stage.modifiers.player.vmaxMul ?? 1) < 1);
    if (stage?.modifiers.player?.forbiddenNetZone) {
      this.drawForbiddenZone(g, stage.modifiers.player.forbiddenNetZone);
    }
    // 关卡机制的"看得见"三件套(第 13/8 关的轨与落樱)与事件飘字。
    // 画在球场层之后、人物之前:轨与花瓣是环境,不该糊在球员身上。
    if (this.railHot > 0) this.railHot--;
    this.drawLaserRail(g, stage);
    this.drawSakura(g, stage);
    if (ball) this.watchMechEvents(Rules.R.players, ball, stage);

    // 跨步高速突进与时空超速移动流风残影采样
    for (const p of players) {
      if (p.lungeT >= 0 && (p.lungeT % (C.lunge.ghostInterval || 2) === 0)) {
        this.lungeGhosts.push({
          x: p.x,
          y: p.y,
          facing: p.facing,
          life: C.lunge.ghostFrames || 14,
          maxLife: C.lunge.ghostFrames || 14,
          lungeLegExt: 0.9,
          lungeDirRel: p.lungeDir ? p.lungeDir * p.facing : 1,
          color: "#38bdf8",
        });
      } else if (p.focusT && p.focusT > 0 && Math.abs(p.vx) > 2.5 && (p.focusT % 3 === 0)) {
        this.lungeGhosts.push({
          x: p.x,
          y: p.y,
          facing: p.facing,
          life: 12,
          maxLife: 12,
          lungeLegExt: 0.5,
          lungeDirRel: p.vx > 0 ? p.facing : -p.facing,
          color: "#06b6d4",
        });
      }
    }

    // 绘制所有跨步流风残影(在实体球员下层,衬托高速位移感)
    for (const lg of this.lungeGhosts) {
      drawLungeGhost(g, this.vp, lg);
    }

    // 闪现折跃起点电离消散残影采样
    for (const p of players) {
      if (p.flashFrom && p.flashT === C.skills.flash.ghostFrames) {
        this.flashGhosts.push({
          x: p.flashFrom.x,
          y: p.flashFrom.y,
          facing: p.facing,
          life: 14,
          maxLife: 14,
        });
      }
    }

    // 绘制折跃起点电离消散残影
    for (const fg of this.flashGhosts) {
      drawFlashGhost(g, this.vp, fg);
    }

    // 插值:120Hz 屏也不见阶梯;离网远的先画,近网压前(与老 render 同序)
    // order/rxs/rys/playerView 全部持久复用,不再每帧 slice/sort/spread 出垃圾
    const order = this.drawOrder;
    order.length = 0;
    for (const p of players) order.push(p);
    order.sort(byNetDist);
    const rxs = this.rxs, rys = this.rys;
    rxs.length = 0; rys.length = 0;
    const pv = this.playerView;
    for (const p of order) {
      const rx = lerp(p.px, p.x, alpha);
      const ry = lerp(p.py, p.y, alpha);
      rxs.push(rx); rys.push(ry);
      Object.assign(pv, p);
      pv.x = rx; pv.y = ry;
      drawPlayer(g, this.vp, pv, animT, alpha, ball);
      if (p.stamina !== undefined) {
        this.drawStaminaBar(g, p);
      }
      // 流沙关(第 2 关):脚下沙窝 + 起步扬沙。这一关只改了 accelMul/vmaxMul/jumpMul/reachMul,
      // 画面从前一帧都不变 —— 玩家读出的是"手感差",不是"这关是沙地"。
      if (softSand && Math.abs(p.vx) > 0.6) this.drawSandSink(g, p, alpha);
      if (p.sliding && Math.abs(p.sliding) > 1.2) {
        // 溜冰滑行冰雾轨迹(常量色提为模块级:球员循环里每帧 new 曾是纯垃圾)
        g.fillColor = ICE_FOG_COL;
        g.ellipse(this.vp.x(rx - (p.sliding > 0 ? 16 : -16)), this.vp.y(C.court.groundY - 2), 12, 3);
        g.fill();
      }
    }
    // 名牌文字与球衣号(与角色同层叠加)
    this.syncTags(order, rxs, rys);

    // 引力吸球:球与球拍之间高频跃动的电离子引力光索
    if (ball && ball.magnetPull) {
      const mp = ball.magnetPull;
      const bx = lerp(ball.px, ball.x, alpha);
      const by = lerp(ball.py, ball.y, alpha);
      this.drawMagnetTether(g, bx, by, mp.targetX, mp.targetY);
    }

    // 时空减速:羽毛球飞行中留下慢放幽灵残影
    const inFocus = players.some((p) => (p.focusT ?? 0) > 0);
    if (inFocus && ball && ball.live && !ball.held && this.frameT % 2 === 0) {
      this.ballChronoGhosts.push({
        x: ball.x,
        y: ball.y,
        vx: ball.vx,
        vy: ball.vy,
        life: 14,
        maxLife: 14,
      });
    }

    // 绘制羽毛球慢动作时空残影
    for (const bg of this.ballChronoGhosts) {
      const bA = (bg.life / bg.maxLife) * 0.42;
      const dbx = this.vp.x(bg.x), dby = this.vp.y(bg.y);
      g.fillColor = withAlpha(pal("#06b6d4"), bA * 0.7);
      g.ellipse(dbx, dby, 7.5, 7.5);
      g.fill();
      g.strokeColor = withAlpha(pal("#ffffff"), bA * 0.85);
      g.lineWidth = 1.2;
      g.ellipse(dbx, dby, 9.5, 9.5);
      g.stroke();
    }

    // ---------- 飞行轨迹(锥形丝带)+ 羽毛球本体 ----------
    // 丝带画在球**之前**:尾迹从球头后面长出来,不再像老版那样把球糊在一片白雾底下。
    // 入点用**渲染插值后的位置**按距离采样 —— 与 rules 的每 2 帧节流解耦,
    // 于是扣杀的尾迹绵密连续、搓球的尾巴短到几乎没有(旧的圆点堆反过来:扣杀稀疏、搓球扎堆)。
    const trailStyle = skin?.trailStyle ?? null;
    if (ball && ball.live && !ball.held) {
      const svx = ball.vx, svy = ball.vy;
      this.ribbon.sample(lerp(ball.px, ball.x, alpha), lerp(ball.py, ball.y, alpha),
        Math.hypot(svx, svy));
    }
    this.ribbon.tick = this.frameT;
    this.ribbon.draw(g, this.vp, trailStyle);

    // 羽毛球:运动学状态(滞后角/翻滚/裙摆炸开)由 stepFx 按模拟步推进,这里只读
    if (ball && (ball.live || ball.held || ball.flying)) {
      const bx = ball.held ? ball.x : lerp(ball.px, ball.x, alpha);
      const by = ball.held ? ball.y : lerp(ball.py, ball.y, alpha);
      // 烈日刺目关卡:进入高空盲区时球隐入强光中。
      // 盒子的范围从前写死在这一行(400/560/130/240),界面读不到、回归钉不住 —— 现在吃
      // CFG.env.sun(与耀斑画的是同一个盒,「看不见」与「亮在哪」必然对得上)。
      // 另外不再让球**凭空消失**:留一枚淡十字,玩家仍知道球在强光里的位置。
      // 「什么都不知道」不是难度,是 bug(记忆:看不见的控件就是 bug)。
      const SU = CFG.env.sun;
      const inSunGlare = !!(stage?.modifiers.environment?.blindingSun
        && bx > SU.x0 && bx < SU.x1 && by > SU.y0 && by < SU.y1);
      // 网前迷雾同理:关卡文案说"球穿过网前时完全隐形",从前只糊了一层白、球照旧看得见
      // —— 机制其实没生效,还靠它给 AI 算了减免。现在按**画出来的那个盒**真藏球,并同样留十字。
      const FG = CFG.env.fog;
      const inFog = !!(stage?.modifiers.environment?.fog
        && Math.abs(bx - CFG.court.netX) < FG.w / 2
        && Math.abs(by - (CFG.court.netTopY + 25)) < FG.h / 2);
      if (inSunGlare || inFog) {
        drawCrossMark(g, this.vp.x(bx), this.vp.y(by), 13, 2.2, 0,
          pal(inFog && !inSunGlare ? "#e8f0ff" : "#fff6d0"), inFog && !inSunGlare ? 0.42 : 0.5);
      }
      if (!inSunGlare && !inFog) {
        // sqR:形变的帧间插值(drawShuttle 无 alpha 参数,渲染前补进副本)
        const sqR = lerp(ball.sqPrev ?? ball.sq, ball.sq ?? 1, alpha);
        // 复用同一个视图对象(老写法每次 spread 一个新 Ball,每帧一个垃圾)
        const bv = this.ballView;
        Object.assign(bv, ball);
        bv.x = bx; bv.y = by; bv.sqR = sqR;
        drawShuttle(g, this.vp, bv, skin, this.swingCue, this.shuttleMot);
        // 破损球(第 8/19 关):抖的是 physics 真实施加的那一下,失速段再补一道撕口
        if (stage?.modifiers.physics?.erratic && ball.live && !ball.held) {
          this.drawErraticCue(g, ball, bx, by);
        }
      }
    }

    // 全息双生假球绘制
    if (stage?.modifiers.environment?.hologramDecoy && ball && ball.live && !ball.held) {
      if (ball.lastHitter === "right" && this.lastDecoyOwner !== ball.shot) {
        this.lastDecoyOwner = ball.shot;
        this.decoyBall = {
          x: ball.x,
          y: ball.y,
          vx: ball.vx * 0.96,
          vy: ball.vy - 1.1,
          t: 46,
        };
      }
      if (this.decoyBall && this.decoyBall.t > 0) {
        this.decoyBall.t--;
        this.decoyBall.x += this.decoyBall.vx;
        this.decoyBall.y += this.decoyBall.vy;
        this.decoyBall.vy += 0.36;
        const dbx = this.vp.x(this.decoyBall.x);
        const dby = this.vp.y(this.decoyBall.y);
        const decoyA = Math.min(1, this.decoyBall.t / 18) * 0.72;
        g.fillColor = new Color(190, 60, 255, Math.round(decoyA * 255));
        g.ellipse(dbx, dby, 6.5, 6.5);
        g.fill();
        g.strokeColor = new Color(240, 160, 255, Math.round(decoyA * 220));
        g.lineWidth = 1.5;
        g.ellipse(dbx, dby, 9, 9);
        g.stroke();
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

    // 飘字:弹入 → 减速上浮 → 曲线淡出(老实现是匀速上升 + 只在最后 35% 线性淡,
    // 字像被"贴"上去又"抽"走的,没有任何存在感)
    const FF = C.fx;
    const popFrames = FF.floatPopFrames || 6;
    const fadeK = FF.floatFadeK ?? 0.5;
    for (let i = 0; i < this.floats.length; i++) {
      const f = this.floats[i];
      const pos = f.node.position;
      const remain = Math.max(0, f.life / f.maxLife);
      const rise = 0.35 + 0.65 * Math.pow(remain, FF.floatRiseEase || 1.8);
      f.node.setPosition(pos.x, pos.y + f.vy * rise, 0);
      const p = Math.min(1, f.age / popFrames);
      const sc = 0.55 + 0.45 * easeOutBack(p, FF.floatPopBack || 1.7);
      f.node.setScale(sc, sc, 1);
      const a = p * (remain < fadeK ? fadePow(remain / fadeK, 0.75) : 1);
      f.opacity.opacity = Math.round(255 * clamp(a, 0, 1));
    }

    // 屏幕特效(白闪/氛围暗角):屏幕空间,画在 world 之上、UI 面板之下
    this.drawScreenFx();
  }

  private drawForbiddenZone(g: Graphics, zoneW: number): void {
    const netX = C.court.netX;
    const startX = netX - zoneW;
    const groundY = C.court.groundY;
    const x0 = this.vp.x(startX);
    const x1 = this.vp.x(netX);
    const y0 = this.vp.y(groundY + 8);
    const h = 26;

    // 红色半透明警示网格(模块级常量色)
    g.fillColor = ZONE_GRID;
    g.rect(x0, y0 - h, x1 - x0, h);
    g.fill();

    // 警示斜线
    g.strokeColor = ZONE_HATCH;
    g.lineWidth = 1.5;
    for (let x = startX; x <= netX; x += 14) {
      g.moveTo(this.vp.x(x), y0);
      g.lineTo(this.vp.x(Math.min(netX, x + 10)), y0 - h);
      g.stroke();
    }

    // 激光警戒边缘
    g.strokeColor = ZONE_EDGE;
    g.lineWidth = 2.5;
    g.moveTo(x0, y0);
    g.lineTo(x0, y0 - h);
    g.stroke();
  }

  /**
   * 贴网电浆磁轨(第 13 关「激光加速轨」)。
   * 这一关的机制是"球掠过网顶那段带会被抽到 1.75 倍速",可场上一条轨都不画:
   * 玩家只看见球忽然变向变快,像 bug。`env-check §7` 从前就是把它记在豁免表里的
   * ("生效却没人画 —— 机制隐形")。现在画出来,并且带宽**直接吃 CFG.env.laser 的
   * above/below** —— 画在能触发的那一段上,而不是"贴着网顶画一条好看的线"。
   */
  private drawLaserRail(g: Graphics, stage: StageDef | null | undefined): void {
    if (!stage?.modifiers.physics?.laserRail) return;
    const CO = CFG.court;
    const L = CFG.env.laser;
    const R = CFG.env.rail;
    const x = this.vp.x(CO.netX);
    const yTop = this.vp.y(CO.netTopY - L.below);
    const yBot = this.vp.y(CO.netTopY + L.above);        // Graphics 里 y 向上:网顶往上的那段
    const h = Math.max(6, yBot - yTop);
    const cy = yTop + h / 2;
    const pulse = 0.5 + 0.5 * Math.sin(this.frameT * R.pulseHz);
    const hot = Math.max(0, this.railHot) / Math.max(1, R.hotFrames);
    // 轨体:一条斜切亮条(不用圆头),越靠近网带越实
    g.fillColor = withAlpha(pal("#00f0ff"), R.glowA * (0.5 + 0.5 * pulse) * (1 - hot * 0.3) + hot * 0.4);
    g.rect(x - 5, yTop, 10, h);
    g.fill();
    // 过冲余辉:球被电离那一拍,轨整条炸亮并往下坠一格
    if (hot > 0) {
      g.fillColor = withAlpha(pal("#ffffff"), R.hotA * hot * 0.85);
      g.rect(x - 3 - 8 * hot, yTop, 6 + 16 * hot, h);
      g.fill();
    }
    // 刻度:读成"这是一条有窗口的轨",不是一根无意义的亮条
    g.strokeColor = withAlpha(pal("#9ff6ff"), 0.5 + 0.4 * pulse);
    g.lineWidth = 1.4;
    for (let i = 0; i < R.tick; i++) {
      const ty = yTop + h * ((i + 0.5) / R.tick);
      const tw = i % 2 === 0 ? 9 : 5;
      g.moveTo(x - tw, ty);
      g.lineTo(x + tw, ty);
    }
    g.stroke();
    g.lineWidth = 1;
  }

  /**
   * 落樱狂风(第 8 关):花瓣往下飘 + 横向吃**真风**。
   * 这一关从前是**死配置** —— `sakuraFlurry: true` 被关卡表启用,渲染里一个读者都没有,
   * 于是玩家的"这关有风"完全靠简报文案。花瓣的横向漂移读 `Physics.windAt(envPhase())`,
   * 与球被推走同源(这一关其实开的是 `erratic`,没有 windX 时退化成自身摆动)。
   */
  private drawSakura(g: Graphics, stage: StageDef | null | undefined): void {
    if (!stage?.modifiers.environment?.sakuraFlurry) return;
    const S = CFG.env.sakura;
    const W = CFG.world.w, H = CFG.world.h;
    const wind = Physics.windAt(Physics.envPhase()) * S.k;
    const petal = pal("#ffc7dd");
    for (const p of this.sakuraPetals) {
      p.y += S.fall * p.spd;
      p.x += wind + Math.sin(this.frameT * 0.03 + p.ph) * 0.6;
      if (p.y > H + 20) { p.y = -20; }
      if (p.x > W + 20) p.x = -20;
      else if (p.x < -20) p.x = W + 20;
      // 三瓣撕纸:两片错开的小三角读成"翻转的花瓣",逐帧只改偏移
      const gx = this.vp.x(p.x) + Math.sin(this.frameT * 0.05 + p.ph) * S.sway * 0.15;
      const gy = this.vp.y(p.y);
      const w = p.sz * (0.55 + 0.45 * Math.abs(Math.sin(this.frameT * 0.04 + p.ph)));
      g.fillColor = withAlpha(petal, S.a);
      g.moveTo(gx - w, gy);
      g.lineTo(gx, gy + p.sz * 0.7);
      g.lineTo(gx + w, gy);
      g.lineTo(gx, gy - p.sz * 0.4);
      g.close();
      g.fill();
    }
  }

  /**
   * 破损球的"不对劲"标记(第 8/19 关)。
   * `erratic` 只在 physics 里给球加横向/纵向冲量,画面一帧都不提示 —— 玩家读成
   * "我手滑了"或"游戏随机",而不是"这颗球是坏的"。这里画两样真实存在的东西:
   *   · 残影:偏移量**直接取 physics 那两条 sin 的相位**(envPhase),所以它抖的
   *     就是球真的在抖的那一下,不是另编一层动画;
   *   · 失速撕裂:下降段(b.vy>0,即 physics 里的 descRamp 生效段)在球尾加一道
   *     琥珀撕口 —— 那才是要给容错的时刻,文案里"后半程随机急坠"第一次被兑现。
   */
  private drawErraticCue(g: Graphics, ball: Ball, bx: number, by: number): void {
    const E = CFG.env.erratic;
    const M = CFG.env.erraticMark;
    const sp = Math.hypot(ball.vx, ball.vy);
    if (sp <= E.speedGate) return;
    const ph = Physics.envPhase();
    // 残影偏移:与 physics 施加的抖动力同相位(同一个 sin,不是第二次随机)
    const ox = Math.cos(ph * E.freqX) * E.ampX * M.ghost * 6;
    const oy = Math.sin(ph * E.freqY) * E.ampY * M.ghost * 6;
    const x = this.vp.x(bx), y = this.vp.y(by);
    g.strokeColor = withAlpha(pal("#ffffff"), M.ghostA);
    g.lineWidth = 1.3;
    g.rect(x + ox - 5, y + oy - 5, 10, 10);
    g.stroke();
    // 下降段:球尾一道斜口,读成"这球要打坠了"
    if (ball.vy > 0) {
      const back = ball.vx > 0 ? -1 : 1;
      g.strokeColor = withAlpha(pal("#ff9f1c"), M.stallA);
      g.lineWidth = 2;
      g.moveTo(x + back * 9, y - 4);
      g.lineTo(x + back * 16, y + 2);
      g.lineTo(x + back * 21, y - 3);
      g.stroke();
    }
    g.lineWidth = 1;
  }

  /**
   * 机制事件的上升沿飘字:这一关**刚**发生了什么,当场说出来。
   * 判星条件本来就靠这些计数(居合/禁区/力竭/电浆…),可场内的目标条只给数字 ——
   * "第 2 次居合打出去了"这种时刻要有一下,否则玩家不知道数字为什么涨了。
   * 只在计数**变化那一帧**飘一次(mechSeen 打底),不刷屏。
   */
  private watchMechEvents(players: Player[], ball: Ball, stage: StageDef | null | undefined): void {
    if (!stage) return;
    const me = players.find((p) => !p.isAI) ?? players[0];
    if (!me) return;
    const M = this.mechSeen;
    // 换关(或重开本关)先把底数清空:否则上一关攒下的计数会在这一关第一帧被当成"刚刚发生"
    const key = `${stage.id}:${Rules.R.pointNo}`;
    if (key !== this.mechStage) {
      this.mechStage = key;
      M.iai = me.stats.iaiStrikes; M.zone = me.stats.zonePenalties;
      M.exhausted = me.isExhausted ? 1 : 0; M.laser = ball.laserBoosted ? 1 : 0;
      M.focus = (me.focusT ?? 0) > 0 ? 1 : 0; M.zen = Math.round((me.zenMeter ?? 0) * 100);
    }
    const mods = stage.modifiers;
    // 居合一闪(第 7 关)
    if (M.iai < 0) M.iai = me.stats.iaiStrikes;
    else if (me.stats.iaiStrikes > M.iai) {
      this.floatSys(me.x, me.y - 96, "居合!", "#ff6a1f", 22, 40);
      M.iai = me.stats.iaiStrikes;
    }
    // 网前禁区触电(第 10 关)
    if (mods.player?.forbiddenNetZone) {
      if (M.zone < 0) M.zone = me.stats.zonePenalties;
      else if (me.stats.zonePenalties > M.zone) {
        this.floatSys(me.x, me.y - 96, "禁区! 硬直", "#e60012", 18, 44);
        M.zone = me.stats.zonePenalties;
      }
    }
    // 体力枯竭(第 17 关):力竭那一下必须看得见 —— 这一关的★就是"全程未力竭"
    if (me.stamina !== undefined) {
      const ex = me.isExhausted ? 1 : 0;
      if (M.exhausted < 0) M.exhausted = ex;
      else if (ex > M.exhausted) {
        this.floatSys(me.x, me.y - 96, "力竭! 拉高远回气", "#9fb4d6", 18, 60);
        M.exhausted = ex;
      } else if (ex < M.exhausted) M.exhausted = ex;
    }
    // 心流进入 / 破功(第 9 关):focusT 上升沿 = 进了子弹时间;zenMeter 被清零 = 破功
    if (mods.player?.zenFocus) {
      const fz = (me.focusT ?? 0) > 0 ? 1 : 0;
      if (M.focus < 0) M.focus = fz;
      else if (fz > M.focus) {
        this.floatSys(me.x, me.y - 110, "心流!", "#00f0ff", 24, 52);
        M.focus = fz;
      } else if (fz < M.focus) M.focus = fz;
      const zen = Math.round((me.zenMeter ?? 0) * 100);
      if (M.zen < 0) M.zen = zen;
      else if (zen < M.zen && M.zen >= 60) {
        this.floatSys(me.x, me.y - 96, "破功!", "#e60012", 18, 40);
      }
      M.zen = zen;
    }
    // 电浆球触发(第 13 关):上升沿一次 —— 轨炸亮 + 报一声,两件事对得上。
    // 从前写成"等 boost 结束再报",那句话要晚一整段飞行才出现,玩家早打完下一拍了。
    const boosted = !!ball.laserBoosted;
    if (M.laser < 0) M.laser = boosted ? 1 : 0;
    else if (boosted && M.laser === 0) {
      this.railHot = CFG.env.rail.hotFrames;
      this.floatSys(ball.x, ball.y - 30, "电浆加速!", "#00f0ff", 18, 34);
      M.laser = 1;
    } else if (!boosted && M.laser === 1) M.laser = 0;
  }

  /**
   * 流沙关脚下的沙窝 + 起步扬沙(第 2 关「深陷流沙」)。
   * 这一关从前**只有一组倍率、画面一帧都不变**,所以玩家把"跑不动"读成手感差/掉帧,
   * 而不是"这关是沙地"。这里给的是最便宜但确实对得上身体的两笔:
   *   · 沙窝 = 脚下一条扁锯齿槽,跑得越快陷得越深(alpha 吃 |vx|);
   *   · 扬沙 = 往运动反方向喷几粒,颗粒出生定形、逐帧只平移(不许每帧 rand)。
   * 数值都在 CFG.env.sand(渲染层不写字面量,与「数值只进 config」同一条铁律)。
   */
  private drawSandSink(g: Graphics, p: Player, alpha: number): void {
    const S = CFG.env.sand;
    const CO = CFG.court;
    const x = this.vp.x(lerp(p.px, p.x, alpha));
    const gy = this.vp.y(CO.groundY);
    const sp = Math.min(1, Math.abs(p.vx) / (CFG.player.vmax || 1));
    const dir = p.vx > 0 ? 1 : -1;
    const w = S.troughW * (0.7 + 0.5 * sp);
    const step = Math.max(0, Math.min(8, Math.round(sp * 8)));
    // 沙窝:五尖锯齿的扁槽(不用光滑椭圆 —— P5 拒绝光滑圆圈)
    g.fillColor = SAND_TROUGH_STEPS[step];
    g.moveTo(x - w, gy - 1);
    for (let i = 0; i < 5; i++) {
      const t = (i + 0.5) / 5;
      g.lineTo(x - w + 2 * w * t, gy - 1 - (i % 2 === 0 ? 0 : S.troughD * (0.5 + 0.5 * sp)));
    }
    g.lineTo(x + w, gy - 1);
    g.lineTo(x + w, gy + 3);
    g.lineTo(x - w, gy + 3);
    g.close();
    g.fill();
    // 扬沙:身后一小片,颗粒出生定形、逐帧只按下标取色与平移
    for (const gr of SAND_GRAINS) {
      const gs = Math.max(0, Math.min(8, Math.round(sp * gr.k * 8)));
      if (gs === 0) continue;
      g.fillColor = SAND_GRAIN_STEPS[gs];
      const gx = x - dir * (6 + Math.abs(gr.dx) * (0.6 + sp));
      g.rect(gx + gr.dx * 0.35, gy + gr.dy * (0.5 + sp), gr.sz, gr.sz);
      g.fill();
    }
  }

  private drawStaminaBar(g: Graphics, p: Player): void {
    if (p.stamina === undefined) return;
    const st = clamp(p.stamina, 0, 100);
    const px = this.vp.x(p.x);
    const py = this.vp.y(p.y - 78);
    const barW = 44;
    const barH = 5;

    // 背景底槽
    g.fillColor = STAMINA_BG;
    g.roundRect(px - barW / 2 - 1, py - barH / 2 - 1, barW + 2, barH + 2, 2.5);
    g.fill();

    // 体力颜色 (绿 > 黄 > 闪烁红;全部为模块级常量色)
    let col = STAMINA_GREEN;
    if (st < 25) {
      col = Math.sin(this.frameT * 0.4) > 0 ? STAMINA_RED_HI : STAMINA_RED_LO;
    } else if (st < 55) {
      col = STAMINA_YELLOW;
    }
    g.fillColor = col;
    const fillW = Math.max(2, (barW * st) / 100);
    g.roundRect(px - barW / 2, py - barH / 2, fillW, barH, 2);
    g.fill();
  }

  /** 引力吸球:球与球拍之间高频跃动的电离子引力光索 */
  private drawMagnetTether(g: Graphics, bx: number, by: number, tx: number, ty: number): void {
    const p0 = { x: this.vp.x(bx), y: this.vp.y(by) };
    const p1 = { x: this.vp.x(tx), y: this.vp.y(ty) };
    const dx = p1.x - p0.x, dy = p1.y - p0.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = -dy / dist, ny = dx / dist;

    // 2 条曲折跳动的紫白色引力电弧
    for (let b = 0; b < 2; b++) {
      const segs = 6;
      g.lineWidth = b === 0 ? 3.0 : 1.4;
      g.strokeColor = withAlpha(pal(b === 0 ? "#a855f7" : "#ffffff"), b === 0 ? 0.75 : 0.95);
      g.moveTo(p0.x, p0.y);
      for (let i = 1; i < segs; i++) {
        const u = i / segs;
        const jolt = Math.sin(this.frameT * 0.45 + i * 2.1 + b * 3) * (1 - Math.abs(u - 0.5) * 2) * 12;
        const mx = p0.x + dx * u + nx * jolt;
        const my = p0.y + dy * u + ny * jolt;
        g.lineTo(mx, my);
      }
      g.lineTo(p1.x, p1.y);
      g.stroke();
    }
    // 羽毛球引力光晕球
    g.fillColor = withAlpha(pal("#a855f7"), 0.35);
    g.ellipse(p0.x, p0.y, 14, 14);
    g.fill();
    g.strokeColor = withAlpha(pal("#00f0ff"), 0.6);
    g.lineWidth = 1.6;
    g.ellipse(p0.x, p0.y, 17, 17);
    g.stroke();
  }

  // ---------- 屏幕特效层(只画闯关关卡专属视觉环境特效) ----------
  /** 上一帧是否画过特效:无特效帧连 clear 都不做(clear 本身就是一次空缓冲 dirty) */
  private screenFxDrawn = false;

  private drawScreenFx(): void {
    const g = this.screenG;

    const stage = Rules.R.activeStage;
    const env = stage && Rules.R.mode === "campaign" ? stage.modifiers.environment : null;
    // 阈值只这一处:从前 3 与 5 写死在这里,而 rules 判「EMP 期间成功回球」吃的是
    // CFG.star.empRally —— 两份数一旦有人改一边,画面在闪、判据却没算,玩家就莫名其妙丢星。
    const empActive = !!(env?.empGlitch && this.atmo.rally >= C.star.empRally);
    const flashActive = !!(env?.spectatorFlash && this.atmo.rally >= C.star.flashRally);
    const any = !!(env && (env.sandstorm || env.fog || env.blindingSun || empActive || flashActive));
    if (!any) {
      // 非闯关局/无环境特效:旧版每帧无条件 clear 一次;现在只在「上一帧画过」时补一次清屏
      if (this.screenFxDrawn) { g.clear(); this.screenFxDrawn = false; }
      return;
    }
    g.clear();
    this.screenFxDrawn = true;

    const W = C.world.w, H = C.world.h;
    const cx = this.vp.x(W / 2), cy = this.vp.y(H / 2);
    const t = this.frameT;

    {
      // 1. 沙尘暴滤镜与狂风飞沙
      //    颗粒方向从前写死 +x(无条件往右跑),而这一关第 4 关还带阻力惩罚 —— 画面与球
      //    受推的方向各说各话,玩家读出的是"动画在随机动"。现在吃同一个 windAt:
      //    关卡没给 windX 时退化成原来的右行(不为不存在的机制凭空造方向)。
      if (env!.sandstorm) {
        g.fillColor = new Color(220, 160, 60, 38);
        g.rect(-1600, -1000, 3200, 2000);
        g.fill();

        const sw = Physics.windAt(Physics.envPhase());
        const sgn = sw === 0 ? 1 : Math.sign(sw);
        g.strokeColor = new Color(245, 205, 115, 140);
        g.lineWidth = 1.8;
        for (const sp of this.sandstormParticles) {
          sp.x += sp.spd * sgn;
          sp.y += sp.spd * 0.22;
          if (sgn > 0 ? sp.x > W + 60 : sp.x < -60) sp.x = sgn > 0 ? -60 : W + 60;
          if (sp.y > H + 60) sp.y = -60;
          g.moveTo(this.vp.x(sp.x), this.vp.y(sp.y));
          g.lineTo(this.vp.x(sp.x + sp.len * sgn), this.vp.y(sp.y + sp.len * 0.22));
          g.stroke();
        }
      }
      // 2. 网前水墨雾(第 6 关「晨雾隐踪」)
      //    从前是两团 g.ellipse:光滑圆圈既不是这套视觉语言(AGENTS「拒绝光滑圆圈」),
      //    盒尺寸又写死在渲染里 —— 玩家看不出雾的边界,回归也钉不住这个盒。
      //    现在画成上下带锯齿的水墨条,并且**同一个盒**拿去把球藏起来(见 draw 里的 inFog):
      //    关卡文案说"球穿过网前时完全隐形",从前它只是糊了一层白,机制其实没生效。
      if (env!.fog) {
        const F = C.env.fog;
        const nx = this.vp.x(C.court.netX);
        const ny = this.vp.y(C.court.netTopY + 25);
        drawInkBand(g, nx, ny, F.w, F.h, F.teeth, pal("#f0f5ff"), F.a, t);
        drawInkBand(g, nx, ny + 15, F.w * 0.66, F.h * 0.66, Math.max(6, F.teeth - 4), pal("#ffffff"), F.coreA, t * 0.7);
      }
      // 3. 烈日致盲高空耀斑(第 3 关)
      //    从前是两团 g.ellipse:光滑圆圈既不像"光"也不像"刺眼",而且盒坐标/中心/α
      //    全写死在这一段里,界面读不到、回归也钉不住。现在换成 p5kit 的尖刺星芒
      //    (打击感=尖刺这套性格),再加一道斜切光栅带把"哪一段会看不见"划出来。
      if (env!.blindingSun) {
        const SU = C.env.sun;
        const sx = this.vp.x(SU.cx);
        const sy = this.vp.y(SU.cy);
        const flareA = SU.flareA + Math.sin(t * 0.08) * SU.flarePulse;
        drawStarburst(g, sx, sy, SU.rOut, SU.rIn, SU.rays, pal("#fff3c4"), flareA * 0.9);
        drawStarburst(g, sx, sy, SU.rIn * 1.5, SU.rIn * 0.55, SU.rays, pal("#ffffff"), flareA * 0.7);
        // 致盲盒:斜切亮带标出"球进这一段会消失",玩家据此决定要不要打高球
        const bx0 = this.vp.x(SU.x0), bx1 = this.vp.x(SU.x1);
        const by0 = this.vp.y(SU.y0), by1 = this.vp.y(SU.y1);
        g.fillColor = withAlpha(pal("#fff0b4"), SU.bandA * (0.7 + 0.3 * Math.sin(t * 0.05)));
        g.moveTo(bx0, by0);
        g.lineTo(bx1, by0 + 8);
        g.lineTo(bx1, by1 + 8);
        g.lineTo(bx0, by1);
        g.close();
        g.fill();
      }
      // 4. EMP 故障闪烁条纹 (多拍时触发)
      if (empActive) {
        const glitchT = t % 160;
        if (glitchT > 138) {
          g.fillColor = new Color(0, 240, 255, 34);
          g.rect(-1600, -1000, 3200, 2000);
          g.fill();
          g.strokeColor = new Color(255, 0, 128, 120);
          g.lineWidth = 3;
          for (let y = -360; y < 360; y += 42) {
            const shiftX = Math.sin(y + t) * 25;
            g.moveTo(-750, y);
            g.lineTo(750 + shiftX, y);
            g.stroke();
          }
        }
      }
      // 5. 看台闪光灯爆闪
      if (flashActive) {
        if (Math.sin(t * 0.42) > 0.86) {
          g.fillColor = new Color(255, 255, 255, 60);
          g.ellipse(cx + Math.sin(t * 1.3) * 220, cy - 60, 150, 85);
          g.fill();
        }
      }
    }
  }
}

