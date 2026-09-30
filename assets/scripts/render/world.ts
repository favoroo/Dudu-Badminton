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
import { clamp, lerp } from "../core/utils";
import { Ball, GameEvent, Player, SkinDef } from "../core/types";
import { drawPlayer, drawShuttle, setSwingArcSink, drawSwingArcGhost, SwingArcFx } from "./sprites";
import { pal, withAlpha } from "./palette";
import { courtRenderer, CourtThemeItem } from "./court";
import { FXSystem } from "./fx";
import { HudOverlay } from "./hud-overlay";
import { Ribbon } from "./ribbon";
import { advanceShuttle, makeShuttleMotion, shuttleImpact, TIER_FIRE, TIER_SMASH, TIER_SWEET, TIER_SWEET_SMASH } from "./shuttle-motion";
import { easeOutBack, fadePow } from "./easing";

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
  /** 已进行帧数(弹入曲线用;与 life 同源,由 stepFx 递增) */
  age: number;
}

/** 氛围暗角的输入(渲染层不 import Rules,由 game-root 每帧喂入只读快照) */
export interface AtmoState { state: string; rally: number; matchPoint: boolean }

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
  /** 飞行轨迹:按距离采样的锥形丝带(取代老 fx.js 的"每点叠同心圆") */
  private ribbon = new Ribbon();
  /** 球体运动学外观(滞后角/翻滚/裙摆颤动)—— 只住渲染层,不回写 ball */
  private shuttleMot = makeShuttleMotion();
  /** drawShuttle 的入参副本:每帧 Object.assign 复用同一对象,不再 spread 出垃圾。
   *  sqR 是渲染层算的形变插值值(Ball 上没有,drawShuttle 按内部 RBall 读) */
  private ballView = {} as Ball & { sqR?: number };
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

  /** 击球白闪(全屏白光一闪即逝,强度衰减在 stepFx) */
  whiteFlash(a: number): void {
    if (a > this.flash) this.flash = a;
  }

  /**
   * 白闪取色跟着刚才那一拍的档位走(与球体辉光、丝带同源,不新造状态):
   * 普通拍是纯白,甜区偏青,扣烧金,甜蜜重扣/火热烧橙 —— 一眼能分出"这下的闪光是哪档"。
   */
  private flashHex(): string {
    const tier = this.shuttleMot.tier;
    return tier >= TIER_FIRE ? C.colors.smash.flame
      : tier >= TIER_SWEET_SMASH ? C.colors.sweet.gold
        : tier >= TIER_SMASH ? C.colors.smash.glow
          : tier >= TIER_SWEET ? C.colors.sweet.neonCyan
            : "#ffffff";
  }

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
      item = { node, label, opacity, life: 0, maxLife: 0, vy: -1, age: 0 };
    }
    item.life = life;
    item.maxLife = life;
    item.age = 0;
    item.vy = vy || -1;
    item.sys = sys;
    item.node.setPosition(this.vp.x(wx), this.vp.y(wy), 0);
    item.node.setScale(1, 1, 0);
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
    if (ball && (ball.live || ball.held)) {
      const bx = ball.held ? ball.x : lerp(ball.px, ball.x, alpha);
      const by = ball.held ? ball.y : lerp(ball.py, ball.y, alpha);
      // sqR:形变的帧间插值(drawShuttle 无 alpha 参数,渲染前补进副本)
      const sqR = lerp(ball.sqPrev ?? ball.sq, ball.sq ?? 1, alpha);
      // 复用同一个视图对象(老写法每次 spread 一个新 Ball,每帧一个垃圾)
      const bv = this.ballView;
      Object.assign(bv, ball);
      bv.x = bx; bv.y = by; bv.sqR = sqR;
      drawShuttle(g, this.vp, bv, skin, this.swingCue, this.shuttleMot);
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

  // ---------- 屏幕特效层(老 FX.drawTop 的白闪 + 三种氛围暗角) ----------
  /** 白闪与慢动作/长回合/赛点三种暗角;Cocos 无径向渐变,用描边环近似(court.drawVignette 同手法) */
  private drawScreenFx(): void {
    const g = this.screenG;
    g.clear();

    const W = C.world.w, H = C.world.h;
    const cx = this.vp.x(W / 2), cy = this.vp.y(H / 2);
    const t = this.frameT;

    // 白闪:老实现是一整块全屏纯白矩形(alpha = flash×0.5),重扣那一下连球带人一起糊没。
    // 现在改成「边缘亮、中心透」的径向(复用 strokeVignette 的描边环近似,Cocos 无渐变),
    // 再叠一层很低的整体提亮保住"啪"的一下;色随档位由 game 层 whiteFlash(a, hex) 传入。
    if (this.flash > 0.02) {
      const F = C.fx;
      const hex = this.flashHex();
      this.strokeVignette(g, cx, cy, H * 1.05, H * 0.34, hex,
        this.flash * (F.flashRadial || 0.6), F.flashRings || 16);
      g.fillColor = withAlpha(pal(hex), this.flash * 0.14);
      g.rect(-1600, -1000, 3200, 2000);
      g.fill();
    }

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
  }

  /**
   * 径向渐变的描边环近似:外缘 alpha 峰值,向内 smoothstep 淡出到 0。
   * rings 可传(Cocos 无渐变,环数就是"平滑度/成本"的旋钮;白闪用 fx.flashRings,
   * 氛围暗角沿用 18)。
   */
  private strokeVignette(g: Graphics, cx: number, cy: number, rOuter: number, rInner: number, hex: string, alphaMax: number,
    rings = 18): void {
    if (alphaMax <= 0.004) return;
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

