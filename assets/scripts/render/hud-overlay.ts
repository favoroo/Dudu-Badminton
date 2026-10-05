// ============================================================
// 画布内世界提示:落点预测圈、时机环(球上收缩环)、量化时机条、
// 热手火苗刻度、训练头顶时机条、赛点霓虹旗标。
// 自老版 canvas 工程 src/render/hud.js 逐行移植 —— 比分/发球权等 DOM 层信息
// 在 ui/hud.ts,这里只画「长在球场上」的东西。
//
// Graphics 无 globalAlpha,原版的 ctx.globalAlpha 全部折算进颜色 alpha;
// 文字(Graphics 画不了)用挂在世界层的小 Label,每帧同步位置。
// 渲染层只读游戏状态,不改任何逻辑字段。
// ============================================================
import { Color, Graphics, Label, Layers, Node, Tween, tween, UIOpacity, UITransform, Vec3 } from "cc";
import { CFG } from "../core/config";
import { clamp } from "../core/utils";
import type { Ball } from "../core/types";
import { Physics } from "../core/physics";
import { Settings } from "../core/settings";
import { Rules } from "../core/rules";
import { Drill } from "../core/drill";
import { Tutorial } from "../core/tutorial";
import { meter, winU, targetZoneFor } from "./drill-anim";
import { DrillDemo } from "../core/drill-demo";
import type { Viewport } from "./world";
import { pal, withAlpha } from "./palette";
import { drawCrossMark, drawCutinBands, drawTaper } from "./p5kit";
import { applyFont } from "../game/fonts";

const C = CFG;
const CO = C.court;
/** 赛点横幅文字的两态颜色(模块级常量;旧版每帧 new 两个 Color) */
const MP_COL_A = new Color().fromHEX("#fff5f2");
const MP_COL_B = new Color().fromHEX("#ffd9d9");
/** 怒气满管斩劈的带色(fire 红橙金,与怒气技能 accent 同族):模块级常量,帧循环里不再 map */
const RAGE_CUTIN_COLS = (C.fx.slashCutinColorsFire ?? ["#e60012", "#ff6a1f", "#ffe14d"]).map((h) => pal(h));

function txt(parent: Node, name: string, size: number): Label {
  const n = new Node(name);
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform);
  n.setParent(parent);
  const l = n.addComponent(Label);
  l.string = "";          // Label 默认串是 "label",不清掉会漏出调试浮字
  l.fontSize = size;
  l.lineHeight = Math.round(size * 1.15);
  applyFont(l, true);
  return l;
}

export class HudOverlay {
  private g: Graphics;
  /** 落点提示的独立缓存层(兄弟节点,序在主 hud 之前 → 压在时机环/旗标底下,与旧单层次序一致)。
   *  落点整块只随积分帧(每 2 帧/换拍)变化,重画进这里,主 g 每帧只剩小件 */
  private lg: Graphics;
  /** 落点缓存层当前是否有内容(球消失/开关关闭时清一次,不逐帧 clear) */
  private landingShown = false;
  private vp: Viewport;
  /** 赛点横幅的内容缓存(raw label → 拼好的展示串;label 不变不重拼) */
  private mpLastRaw = "";
  private mpContent = "★ MATCH POINT ★";
  // 赛点旗标(拍数由 HUD 的连击大字负责,训练进度由 HUD 的状态行负责)
  private mpLabel: Label;
  private mpShown = false;
  // ---------- 力竭斩劈演出(AI 体力血条见底的那一瞬) ----------
  // 触发只在 game-root(syncPressureCue 的上升沿),这里只管把演出播完 ——
  // 渲染层不自己判压力,避免出现第二份「什么叫力竭」的真话。
  private exhaustT = 0;
  private exLabel: Label;
  // ---------- 怒气满管斩劈演出(按下满管怒气重击的那一瞬) ----------
  // 同一条时钟模式:触发只在 game-root(onSkillCast 的 rage 满管分支),这里只管播完。
  // 画法用 p5kit.drawCutinBands 吃 fx.slashCutin* 那套休眠配置(fire 带色)——
  // 配置、形状、时序全在,此前一直没有游戏内消费点,这里就是它的第一个。
  private rageCutinT = 0;
  private rageLabel: Label;
  private rageOp: UIOpacity;
  // ---------- 轨迹预测虚线的预分配缓冲(每帧复用,零 GC)----------
  // predictPath 写世界坐标点 → px/py 存换算后的 Graphics 坐标 → dashBuf 存切好的虚线段
  // (每段 5 个 float:x0,y0,x1,y1,透明度档)。虚线段数上限 ≈ 弧长/(dash+gap),
  // 800/5=160 段足够最远的那条弧,写满就提前收笔,不会越界。
  private pathBuf = new Float32Array((C.landing.pathHorizonMax + 2) * 2);
  private px = new Float32Array(C.landing.pathHorizonMax + 2);
  private py = new Float32Array(C.landing.pathHorizonMax + 2);
  private dashBuf = new Float32Array(1400);
  /** 每帧只积分**一次**真弧,落点圈与虚线共用(从前一个 linear 外推、一条 90 步前瞻,
   *  两套口径算出的"落点"能差出半个半场 —— 那正是第 1 关"风把球吹走"完全读不出来的原因) */
  private pathN = 0;
  private pathEnd = 3;          // 0 落地 / 1 撞网 / 2 出海侧 / 3 被截断(未知)
  private pathLandX = 0;
  private endBuf = new Int8Array(1);
  /** 隔帧积分的去重标记:上一次积分对应的 shot 引用(换拍立即重算,不显示旧弧) */
  private pathShot: Ball["shot"] | null = null;
  // ---------- 时机环状态(game-root.updateSwingCue 每帧喂;null = 无来球不画)----------
  // progress: 收缩进度 0..1(1 = 收满贴球);locked: fc ≤ 最佳按拍帧的白闪档
  private ring: { progress: number; locked: boolean } | null = null;
  // ---------- 量化时机条(真人每拍命中后短暂显示;grade 带符号,-=早 +=晚)----------
  private timingBars: { x: number; y: number; grade: number; life: number; max: number }[] = [];

  constructor(parent: Node, vp: Viewport) {
    this.vp = vp;
    // 落点缓存层:兄弟节点且创建序在主 hud 之前 —— Cocos 2D 按兄弟序渲染,
    // 这与旧版「落点块先画、其余提示压其上」的次序逐件对齐
    const ln = new Node("hud-landing");
    ln.layer = Layers.Enum.UI_2D;
    ln.addComponent(UITransform);
    ln.setParent(parent);
    this.lg = ln.addComponent(Graphics);
    const n = new Node("hud-overlay");
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform);
    n.setParent(parent);
    this.g = n.addComponent(Graphics);
    this.mpLabel = txt(n, "mp", 15);
    this.mpLabel.enableOutline = true;
    this.mpLabel.outlineColor = new Color().fromHEX("#07070d");
    this.mpLabel.outlineWidth = 2;
    this.mpLabel.node.active = false;
    // 力竭大字:随斩劈带一起横扫,平时不占屏
    this.exLabel = txt(n, "exhaust", 26);
    this.exLabel.enableOutline = true;
    this.exLabel.outlineColor = new Color().fromHEX("#07070d");
    this.exLabel.outlineWidth = 3;
    this.exLabel.string = "对手力竭!";
    this.exLabel.color = new Color().fromHEX("#ffe14d");
    this.exLabel.node.active = false;
    // 怒气满管大字:居中(带子扫过屏心的位置),文案/颜色/字号在 playRageCutin 里随档位表喂
    this.rageLabel = txt(n, "rage-cast", 30);
    this.rageLabel.enableOutline = true;
    this.rageLabel.outlineColor = new Color().fromHEX("#07070d");
    this.rageLabel.outlineWidth = 3;
    this.rageLabel.node.setPosition(0, this.vp.y(C.world.h / 2 - 46), 0);
    this.rageLabel.node.angle = -3;
    this.rageOp = this.rageLabel.node.addComponent(UIOpacity);
    this.rageOp.opacity = 0;
    this.rageLabel.node.active = false;
  }

  draw(R: typeof Rules.R, t: number): void {
    const g = this.g;
    g.clear();
    const b = R.ball;

    // ---------- 落点预测(六层叠画,见 config.landing 的注释)----------
    // 设置页的「落点预测圈」开关掐这一处:只关预测圈,拍数徽标与训练时机条不受影响
    if (b && b.live && !b.held && b.shot && Settings.hintLanding) {
      // 每 2 渲染帧才真积分一次,隔帧复用上一条弧(缓冲原地保留,零 GC):
      // 球一帧只挪几个像素,虚线滞后一帧不可辨,90~240 步积分成本直接砍半。
      // 换了新拍(shot 引用变化)则立即重算,不给上一拍留下残影。
      if (t % 2 === 0 || this.pathShot !== b.shot) {
        this.integrateOnce(b.x, b.y, b.vx, b.vy);
        this.pathShot = b.shot;
        // 整块落点提示(对照十字/虚线/列光/光斑/准星环/主圈)重画进独立缓存层:
        // 落点位置与各档透明度全由积分帧的真值决定,隔帧根本不会变,不必重描。
        // 脉冲准星环也一并 30fps 采样(收缩周期 ~50 帧的慢脉动,无感) ——
        // 换来主 g 每帧只剩时机环/旗标这些小件。
        this.lg.clear();
        this.landingMarker(R, t);
        this.landingShown = true;
      }
    } else if (this.landingShown) {
      // 球落地/被接住/开关关掉:缓存层清一次即可,不逐帧空 clear
      this.lg.clear();
      this.landingShown = false;
    }

    // ---------- 训练场:把引导页那根时机条搬到球员头顶 + 目标落点与迎击位 ----------
    if (R.mode === "drill") {
      this.drillFieldGuides(R, t);
      this.drillMeter(R);
    }

    // ---------- 新手教学:移动实操的目标圈 ----------
    if (R.mode === "tutorial") {
      this.tutorialGuides(t);
    }

    // ---------- 赛点霓虹旗标 ----------
    this.matchPointFlag(R, t);

    // ---------- 力竭斩劈(game-root 触发,这里只管播) ----------
    this.exhaustDraw();

    // ---------- 怒气满管斩劈(game-root 触发,这里只管播) ----------
    this.rageCutinDraw();

    // ---------- 时机环(球上收缩环;game-root 喂了状态才画)----------
    // 与落点圈共用「落点预测圈」开关:都是操作引导,设置里关掉就一起收
    if (b && b.live && !b.held && this.ring && Settings.hintLanding) {
      this.timingRingDraw(b);
    }
    // ---------- 量化时机条(真人命中后短暂显示,自带寿命)----------
    this.timingBarDraw();
    // ---------- 热手火苗刻度(左上角,点火才出现)----------
    this.heatGauge(R);
  }

  /** game-root.updateSwingCue 每帧喂时机环状态;null = 无来球 */
  setTimingRing(s: { progress: number; locked: boolean } | null): void {
    this.ring = s;
  }

  /** 真人命中后在击球点上方画一拍量化时机条(grade ∈ [-1,1],负=早 正=晚) */
  showTimingBar(wx: number, wy: number, grade: number): void {
    this.timingBars.push({ x: wx, y: wy, grade, life: 40, max: 40 });
    if (this.timingBars.length > 4) this.timingBars.shift();
  }

  // ---------- 时机环:球上收缩环(该什么时候按)----------
  // 判定区随人走、圈不出新信息,用户拍板去掉;按拍预告全靠球上这只收缩环:
  // 玩家视角里「圈套着球收进来 = 按拍」,收满白闪 =「就是现在」。
  private timingRingDraw(b: NonNullable<typeof Rules.R.ball>): void {
    const s = this.ring!;
    const TR = C.timingRing;
    const g = this.g;
    // 球上收缩环:从 fromMul×球半径收到贴球;收满(fc ≤ lead)换白闪 =「就是现在」
    const cx = this.vp.x(b.x);
    const cy = this.vp.y(b.y);
    const br = C.shuttle.radius;
    if (s.locked) {
      g.strokeColor = withAlpha("#ffffff", TR.lockA);
      g.lineWidth = TR.lockW;
      g.circle(cx, cy, br + 3);
      g.stroke();
    } else {
      const r = br * TR.fromMul - br * (TR.fromMul - 1.25) * s.progress;
      g.strokeColor = withAlpha(pal("#00f0ff"), TR.a);
      g.lineWidth = TR.ringW;
      g.circle(cx, cy, r);
      g.stroke();
    }
  }

  // ---------- 量化时机条:左右 = 早/晚,中央白段 = 完美,金段 = 甜蜜 ----------
  // 命中后挂在击球点上方淡出 —— 「这一拍差在哪」用位置说话,不用读字。
  private timingBarDraw(): void {
    if (!this.timingBars.length) return;
    const g = this.g;
    const w = 64;
    const h = 7;
    const goldHalf = C.sweet.coreRatio / 2;   // 甜蜜段半宽(条的比例坐标,1 = 半条)
    const whiteHalf = C.perfect.coreRatio / 2; // 完美段半宽
    for (const tb of this.timingBars) {
      tb.life--;
      const a = Math.min(1, tb.life / (tb.max * 0.4));
      const cx = this.vp.x(tb.x);
      const cy = this.vp.y(tb.y);
      g.fillColor = withAlpha("#000000", 0.55 * a);
      g.rect(cx - w / 2 - 2, cy - h / 2 - 2, w + 4, h + 4);
      g.fill();
      g.fillColor = withAlpha(pal("#ffe14d"), 0.5 * a);
      g.rect(cx - w * goldHalf, cy - h / 2, w * goldHalf * 2, h);
      g.fill();
      g.fillColor = withAlpha("#ffffff", 0.78 * a);
      g.rect(cx - w * whiteHalf, cy - h / 2, w * whiteHalf * 2, h);
      g.fill();
      g.strokeColor = withAlpha("#ffffff", 0.5 * a);
      g.lineWidth = 1;
      g.rect(cx - w / 2, cy - h / 2, w, h);
      g.stroke();
      const mx = cx + w / 2 * clamp(tb.grade, -1, 1);
      const inSweet = Math.abs(tb.grade) <= C.sweet.coreRatio;
      g.fillColor = withAlpha(inSweet ? "#00f0ff" : "#ff8a8a", 0.95 * a);
      g.rect(mx - 1.6, cy - h / 2 - 3, 3.2, h + 6);
      g.fill();
    }
    // 过期条原地压缩(同 world.compactGhosts 的写法):这行曾在有存活条时每帧 filter 出新数组
    let alive = 0;
    for (let i = 0; i < this.timingBars.length; i++) {
      const tb = this.timingBars[i];
      if (tb.life > 0) this.timingBars[alive++] = tb;
    }
    this.timingBars.length = alive;
  }

  // ---------- 热手火苗刻度:左上角一排锯齿小火苗,亮格数 = 当前连击热度 ----------
  // heat < fireAt(还没点火热档)不画;出现后 8 格总槽常驻 —— 离火力全开还差几格一眼可读。
  // 固定三角形,P5 小火苗语义(锯齿,出生定形,无逐帧 rand)。
  private heatGauge(R: typeof Rules.R): void {
    const p = R.players[0];
    if (!p || p.isAI || p.heat <= 0) return;
    const G = C.heat.gauge;
    const fireAt = C.heat.fireAt;
    const g = this.g;
    const x0 = this.vp.x(G.x);
    const y0 = this.vp.y(G.y);
    for (let i = 0; i < C.heat.maxStreak; i++) {
      const cx = x0 + i * (G.cellW + G.gap);
      const lit = i < p.heat;
      const a = lit ? G.litA : G.emberA;
      const hex = lit ? (i < fireAt ? "#ff6a1f" : "#ffe14d") : "#3a2a1a";
      g.fillColor = withAlpha(pal(hex), a);
      g.moveTo(cx, y0);
      g.lineTo(cx + G.cellW * 0.5, y0 - G.cellH);
      g.lineTo(cx + G.cellW, y0);
      g.close();
      g.fill();
    }
  }

  // ---------- 落点预测:衬底 / 光斑 / 收缩准星环 / 双描边主圈 / 列光 / 下箭头 ----------
  // 三档强度是这条提示线的核心判断:
  //   落在真人守的一侧 → 满档(这是唯一需要玩家改动作的信息);
  //   落在纯 AI 一侧(自己刚打出去的那拍)→ 收一档,只当瞄准反馈,不催;
  //   预计出界 / 撞网 → 压暗、收缩放慢、不挂列光 —— 这类球正确做法是不去够,
  //     提示再亮反而是在教人失误。
  private landingMarker(R: typeof Rules.R, t: number): void {
    const L = C.landing;
    const g = this.lg;   // 画进落点缓存层(见 draw() 的落点块),不再逐帧重描主 g
    const b = R.ball;
    if (!b || !b.shot) return;
    // ⚠ 落点取自真弧(truth 口径),不再读 b.shot.landX。
    //   shot.landX 是**意图** —— 反解出来的、不含侧风与颤抖的那个落点(双打分工 ai.ts 的
    //   claimX、训练场"你瞄没瞄进目标区"都靠它保持稳定,不能改成逐帧变动的真值)。
    //   从前落点圈就画在这个意图上,于是风关里"圈在 A、球落 B":提示比没提示更误导。
    const land = this.pathLandX;
    if (this.pathEnd === 3) return;   // 前瞻被截断 = 不知道落在哪,宁可不画也不画个假的
    if (land <= CO.left - 60 || land >= CO.right + 60) return;   // 飞出镜头外就不画

    const shot = b.shot;
    const isSmash = shot.kind === "smash";
    const willOut = land < CO.left || land > CO.right;
    const willNet = this.pathEnd === 1;      // 撞网也按真弧判(shot.intoNet 只是出球那一刻的意图)
    const real = !willOut && !willNet;        // 这拍真会落在这儿(值得催)

    // 这一侧有没有真人守(2p 两边都是真人 → 两边都满档)
    const side = land < CO.netX ? "left" : "right";
    const mine = R.players.some((p) => !p.isAI && p.side === side);

    // 距落地还剩几帧:前瞻本来就是按真积分一步步推到落地的,步数即帧数 ——
    // 从前这里用 y/vy、x/vx 各做一次线性外推再取 min,在风/低重力/颤抖关会系统性估偏
    // (阻力与横推都不是线性的),现在直接吃 pathN。
    const remain = this.pathEnd === 0 || this.pathEnd === 1 ? this.pathN - 1 : -1;
    // urgentFrames 与 remain 都是「剩余帧」量,故意不随球速档位折算:
    // 不折 = 落点圈在真实时间里同样提前催(见 core/pace.ts 头注释的「不缩放清单」)
    const urg = real ? Math.max(0, Math.min(1, 1 - Math.max(0, remain) / L.urgentFrames)) : 0;
    const u = urg * (mine ? 1 : 0.55);
    const dim = (mine ? 1 : 0.8) * (real ? 1 : 0.62);

    const hex = willNet ? "#ff6b6b" : willOut ? "#9fb4d6" : isSmash ? "#ff5500" : "#ffe14d";
    const rx = willOut ? L.outRx : isSmash ? L.smashRx : L.rx;
    const ry = willOut ? L.outRy : isSmash ? L.smashRy : L.ry;

    const cx = this.vp.x(land);
    const lineY = this.vp.y(CO.groundY + 2);   // 地面线(Graphics 里向上为正)
    const cy = lineY - ry;                     // 光斑顶边贴线,主体画在近景地胶上

    // 意图对照:你瞄的那点画一枚暗十字,再用一根 taper 把它拉到风真正送它去的地方。
    // 这一对字形是整套"风能不能玩起来"的核心 —— 玩家一眼看见「我打的是这里,
    // 风把它搬到了那里」,顺风收力/逆风发力这种决策才有落点可依据,而不是靠猜。
    const intentX = shot.landX;
    const drift = land - intentX;
    if (intentX != null && Math.abs(drift) >= L.driftArrowMin
      && intentX > CO.left - 60 && intentX < CO.right + 60) {
      const ix = this.vp.x(intentX);
      const gy = this.vp.y(CO.groundY + 2);
      drawCrossMark(g, ix, gy - 5, L.intentCrossLen, L.intentCrossW, 0.34,
        pal("#e9e4d6"), L.intentCrossAlpha * dim);
      drawTaper(g, ix, gy - 5, this.vp.x(land), gy - 5, L.driftArrowW,
        pal(drift > 0 ? "#8fe3ff" : "#ffd28f"), 0.62 * dim);
    }

    // ⓪ 轨迹预测虚线:先画,让地面那几层压在它之上(线头收在落点圈里,不越过它喊话)
    this.landingPath(dim);

    // ① 落点列光:盯球时不必移开视线就能读出落点 x(三段叠近似垂直渐隐)
    if (real) {
      const seg = 3;
      const baseA = L.beamA * dim * (0.72 + 0.28 * u);
      for (let i = 0; i < seg; i++) {
        const f0 = i / seg, f1 = (i + 1) / seg;
        const y0 = lineY + L.beamH * f0, y1 = lineY + L.beamH * f1;
        const w0 = L.beamW * (1 + f0 * 0.9) * 0.5, w1 = L.beamW * (1 + f1 * 0.9) * 0.5;
        g.fillColor = withAlpha(pal(hex), baseA * (1 - f0 * 0.75));
        g.moveTo(cx - w0, y0);
        g.lineTo(cx + w0, y0);
        g.lineTo(cx + w1, y1);
        g.lineTo(cx - w1, y1);
        g.close();
        g.fill();
      }
    }

    // ② 暗衬底:不指望「颜色够亮」,先垫一块暗底 —— 沙滩金沙、球馆暖白线、道场榻榻米
    //    三套亮底主题上原来的金圈糊成一片,这一步是显眼与否的地基
    g.fillColor = withAlpha("#000000", L.backingA);
    g.ellipse(cx, cy, rx * L.backing, ry * L.backing + 2);
    g.fill();

    // ③ 地贴光斑:Graphics 没有径向渐变,由外向内叠层近似(外圈几乎透明)。恒定亮度。
    const spotA = L.spotA * dim;
    for (let i = L.glowLayers; i >= 1; i--) {
      const f = i / L.glowLayers;
      g.fillColor = withAlpha(pal(hex), spotA * (1 - f * f));
      g.ellipse(cx, cy, rx * f, ry * f);
      g.fill();
    }

    // ④ 收缩准星环:只留一道,而且透明度用 sin(π·ph) 两端 ease ——
    //    原来是「收到最亮那一帧突然跳回 0.1 消失」,那个 pop 加两道错峰就是「一直在闪」。
    //    现在它从透明里慢慢浮出来、收进主圈时又慢慢化掉,一圈 50 帧,不催也不跳。
    const period = L.ringPeriodSlow + (L.ringPeriodFast - L.ringPeriodSlow) * u;
    const ringA = L.ringA * dim * (real ? 1 : 0.6);
    g.lineWidth = L.ringW;
    for (let i = 0; i < L.rings; i++) {
      const ph = (t / period + i / L.rings) % 1;
      const k = L.ringFrom + (1 - L.ringFrom) * ph;
      g.strokeColor = withAlpha(pal(hex), ringA * Math.sin(ph * Math.PI));
      g.ellipse(cx, cy, rx * k, ry * k);
      g.stroke();
    }

    // ⑤ 主圈双描边:主题色外描压形状,白芯内描提轮廓(单描边在亮底上照样糊)。恒定亮度。
    const edgeA = 0.95 * dim;
    g.strokeColor = withAlpha(pal(hex), edgeA);
    g.lineWidth = isSmash ? 4.5 : 3.6;
    g.ellipse(cx, cy, rx, ry);
    g.stroke();
    g.strokeColor = withAlpha("#ffffff", edgeA * 0.85);
    g.lineWidth = 1.5;
    g.ellipse(cx, cy, rx - 2, Math.max(1.5, ry - 1.5));
    g.stroke();

    // ⑥ 精确落点:白芯点(画在暗衬底上,不是画在那条白色地面线上)
    g.fillColor = withAlpha("#ffffff", 0.92 * dim);
    g.ellipse(cx, cy, 3.4, 2.2);
    g.fill();

    // ⑦ 下箭头:钉在光斑上方不晃(原来 4px 上下浮动 + 亮度随紧迫度涨落,也是「闪」的一部分)
    if (real) {
      const ay = lineY + ry + 17;
      g.strokeColor = withAlpha(pal(hex), 0.8 * dim);
      g.lineWidth = 3;
      g.moveTo(cx - 7, ay + 8);
      g.lineTo(cx, ay);
      g.lineTo(cx + 7, ay + 8);
      g.stroke();
    }
  }

  // ---------- 轨迹预测虚线 ----------
  // 弹道由 Physics.predictPath 沿**同一套积分**往前推(与 trace 共用落地/撞网判据),
  // 所以这条弧就是球真正会走的那条;渲染层绝不另抄一份积分,否则改一次手感要同步两处。
  // cc Graphics 没有 setLineDash → 按累计弧长自己切段;整条线沿弧长分三档降透明度,
  // 靠球那端最实、往落点方向淡出,末端交给落点圈喊,这条线只负责「读出这条弧的形状」。
  /** 真弧积分一次(truth 口径),把终点/终止原因留给落点圈用 */
  private integrateOnce(bx: number, by: number, vx: number, vy: number): void {
    const steps = Physics.pathStepsFor(Physics.getEnvModifier());
    this.pathN = Physics.predictPath(bx, by, vx, vy, steps, this.pathBuf, this.endBuf);
    this.pathEnd = this.endBuf[0];
    this.pathLandX = this.pathBuf[(this.pathN - 1) * 2];
  }

  private landingPath(dim: number): void {
    const L = C.landing;
    const g = this.lg;
    const n = this.pathN;
    if (n < 2) return;
    const fade = L.pathFade;

    for (let i = 0; i < n; i++) {                 // 世界坐标 → Graphics 坐标,一次换算
      this.px[i] = this.vp.x(this.pathBuf[i * 2]);
      this.py[i] = this.vp.y(this.pathBuf[i * 2 + 1]);
    }
    let total = 0;
    for (let i = 1; i < n; i++) total += Math.hypot(this.px[i] - this.px[i - 1], this.py[i] - this.py[i - 1]);
    if (total < 8) return;

    const D = L.dashOn, CYC = L.dashOn + L.dashOff, bandLen = total / fade.length;
    let acc = 0, travel = 0, cnt = 0;
    for (let i = 1; i < n; i++) {
      const x0 = this.px[i - 1], y0 = this.py[i - 1], x1 = this.px[i], y1 = this.py[i];
      const seg = Math.hypot(x1 - x0, y1 - y0);
      if (seg > 0) {
        const ux = (x1 - x0) / seg, uy = (y1 - y0) / seg;
        let pos = 0;
        while (pos < seg) {
          const phase = acc % CYC;
          const drawing = phase < D;
          const room = drawing ? D - phase : CYC - phase;   // 当前这一截(实或空)还剩多长
          const take = room < seg - pos ? room : seg - pos;
          if (drawing && cnt + 5 <= this.dashBuf.length) {
            let bi = Math.floor((travel + pos) / bandLen);
            if (bi < 0) bi = 0; else if (bi >= fade.length) bi = fade.length - 1;
            this.dashBuf[cnt++] = x0 + ux * pos;
            this.dashBuf[cnt++] = y0 + uy * pos;
            this.dashBuf[cnt++] = x0 + ux * (pos + take);
            this.dashBuf[cnt++] = y0 + uy * (pos + take);
            this.dashBuf[cnt++] = bi;
          }
          pos += take; acc += take;
        }
        travel += seg;
      }
    }

    g.lineWidth = L.pathW;
    for (let bi = 0; bi < fade.length; bi++) {
      let any = false;
      g.strokeColor = withAlpha(pal("#bfe6ff"), L.pathA * dim * fade[bi]);
      for (let k = 0; k + 4 < cnt; k += 5) {
        if (this.dashBuf[k + 4] !== bi) continue;
        g.moveTo(this.dashBuf[k], this.dashBuf[k + 1]);
        g.lineTo(this.dashBuf[k + 2], this.dashBuf[k + 3]);
        any = true;
      }
      if (any) g.stroke();
    }
  }

  // ---------- 训练场:目标落点区与接球站位指引 ----------
  private drillFieldGuides(R: typeof Rules.R, t: number): void {
    const def = Drill.cur();
    if (!def) return;
    const tgt = targetZoneFor(def);
    const tx1 = this.vp.x(tgt.x1);
    const tx2 = this.vp.x(tgt.x2);
    const tw = Math.max(24, tx2 - tx1);
    const gy = this.vp.y(CO.groundY);
    const b = R.ball;
    const isMyBall = b && b.live && b.lastHitter === "left";
    const isTargeting = isMyBall && b.shot && b.shot.landX >= tgt.x1 && b.shot.landX <= tgt.x2;

    const pulse = 0.5 + 0.5 * Math.sin(t * 0.15);
    const bgA = isTargeting ? 0.38 + 0.15 * pulse : 0.18 + 0.08 * pulse;
    const strokeCol = isTargeting ? "#ffe14d" : "#7dff9e";

    // 1. 对方半场目标落点高亮带
    this.g.fillColor = withAlpha(pal(strokeCol), bgA);
    this.g.rect(tx1, gy - 8, tw, 10);
    this.g.fill();

    this.g.strokeColor = withAlpha(pal(strokeCol), isTargeting ? 0.95 : 0.65);
    this.g.lineWidth = isTargeting ? 2.5 : 1.6;
    this.g.rect(tx1, gy - 8, tw, 10);
    this.g.stroke();

    // 中心微型准星
    const tcx = (tx1 + tx2) / 2;
    this.g.strokeColor = withAlpha(pal(strokeCol), 0.7);
    this.g.lineWidth = 1.2;
    this.g.circle(tcx, gy - 3, 5);
    this.g.stroke();

    // 2. 玩家半场最佳迎击站位指示
    const isIncoming = b && b.live && (b.lastHitter === "right" || (b.held && b.owner?.side === "right"));
    // 站位读数与引导演示同一个来源(core/drill-demo 沿真实喂球弧线反解),不再各摆一套:
    // 旧写法读 config 里手拍的 def.contactX,而那个数只喂给过一条假抛物线。
    const stand = DrillDemo.bake(def)?.stand.x;
    if (isIncoming && stand != null) {
      const cx = this.vp.x(stand);
      const inPulse = 0.5 + 0.5 * Math.sin(t * 0.2);
      this.g.strokeColor = withAlpha(pal("#00f0ff"), 0.5 + 0.3 * inPulse);
      this.g.lineWidth = 1.8;
      this.g.ellipse(cx, gy - 2, 18, 6);
      this.g.stroke();

      if (def.pose?.jump) {
        // 向上箭头暗示起跳
        this.g.strokeColor = withAlpha(pal("#ffe14d"), 0.8 * inPulse);
        this.g.lineWidth = 2.0;
        this.g.moveTo(cx, gy + 12);
        this.g.lineTo(cx, gy + 22);
        this.g.moveTo(cx - 4, gy + 17);
        this.g.lineTo(cx, gy + 22);
        this.g.lineTo(cx + 4, gy + 17);
        this.g.stroke();
      }
    }
  }

  // ---------- 新手教学:移动实操的目标圈 ----------
  // 只在「移动」实操未完成时画:地面上一只虚线椭圆 + 脉冲,与训练场站位圈同一套语言。
  // 教学状态读 Tutorial(core)的快照 —— 本模块只画不算,门控判定在 core/tutorial.ts。
  private tutorialGuides(t: number): void {
    if (!Tutorial.isPracticing() || Tutorial.curTopic() !== 0 || Tutorial.gateDone(0)) return;
    const T = C.tutorial;
    const cx = this.vp.x(T.moveTargetX);
    const gy = this.vp.y(CO.groundY);
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.2);
    // 完成前的呼吸感:站进圈里时(门控累计过半)提亮,玩家能读出「就差停稳这一下」
    const inZone = Tutorial.dwellProgress() > 0.35;
    const col = inZone ? "#ffe14d" : "#00f0ff";
    // 亮沙地上一条细描边会整个溶掉(用户现场「都看不到」):底层先铺同色低α填充
    // 把圈的形状立起来,再叠高α粗描边 + 四向刻度,「钉在这里」的靶一眼可读。
    // 同一形状画两遍(fill 后 stroke),与 cc-stub 预览语义对齐(见 AGENTS 坑 8)。
    const rx = T.moveEps, ry = T.moveEps * 0.32;
    this.g.fillColor = withAlpha(pal(col), (inZone ? 0.36 : 0.24) + 0.10 * pulse);
    this.g.ellipse(cx, gy - 2, rx, ry);
    this.g.fill();
    this.g.strokeColor = withAlpha(pal(col), Math.min(1, (inZone ? 0.98 : 0.9) + 0.06 * pulse));
    this.g.lineWidth = inZone ? 3.4 : 2.8;
    this.g.ellipse(cx, gy - 2, rx, ry);
    this.g.stroke();
    // 四向刻度:外环上下左右各一截短线,穿环而出
    this.g.lineWidth = 2.0;
    const tick = 5;
    this.g.moveTo(cx - rx - tick, gy - 2); this.g.lineTo(cx - rx + tick, gy - 2);
    this.g.moveTo(cx + rx - tick, gy - 2); this.g.lineTo(cx + rx + tick, gy - 2);
    this.g.moveTo(cx, gy - 2 - ry - tick); this.g.lineTo(cx, gy - 2 - ry + tick);
    this.g.moveTo(cx, gy - 2 + ry - tick); this.g.lineTo(cx, gy - 2 + ry + tick);
    this.g.stroke();
    // 圈心小准星
    this.g.lineWidth = 1.8;
    this.g.circle(cx, gy - 2, 4);
    this.g.stroke();
  }

  // ---------- 训练场:头顶挥拍时机条 ----------
  // 复用引导页同一个 meter 原语 ——「教的」和「场上看到的」必须是一套视觉语言
  private drillMeter(R: typeof Rules.R): void {
    const def = Drill.cur();
    if (!def) return;
    const p = R.players[0];
    if (!p || p.isAI) return;
    const b = R.ball;
    const mine = !b || b.lastHitter === "left";
    const swinging = p.swingT >= 0;
    const w = 132;
    // 世界坐标(原版画布坐标=屏幕坐标):条左上角
    const wx = p.x - w / 2, wy = p.y - C.player.h - 96;
    const x0 = this.vp.x(wx), y0 = this.vp.y(wy + 12);   // +12 = 条高,转成 Graphics 的下缘
    const u = swinging ? winU(p.swingT) : null;
    const a = swinging ? 1 : mine ? 0.34 : 0.8;
    meter(this.g, x0, y0, w, u, { h: 12, a });
  }

  /** game-root 在 AI 力竭上升沿调用;这里只管把演出播完(帧数走 config.fx) */
  playExhaust(): void {
    this.exhaustT = C.fx.exhaustCueFrames || 55;
  }

  /**
   * 力竭斩劈:三道火色斜带 + 中央大字,左进右出横扫一遍。
   * 视觉语言与赛点斩劈横幅(matchPointFlag)同族 —— 「大事发生」在这套 HUD 里
   * 就长这个样子;带色用 fire 档(红橙),与连击 epic/里程碑的金红一脉相承。
   */
  private exhaustDraw(): void {
    const g = this.g;
    if (this.exhaustT <= 0) {
      this.exLabel.node.active = false;
      return;
    }
    this.exhaustT--;
    const total = C.fx.exhaustCueFrames || 55;
    const p = 1 - this.exhaustT / total;          // 0..1 演出进度
    const a = Math.sin(Math.PI * p);              // 进场渐显 → 屏心最亮 → 出场渐隐
    const cy = this.vp.y(96);
    const w = C.world.w + 120;
    const slide = (p - 0.5) * 110;                // 整组左进右出
    const band = (bh: number, hex: string, al: number, skew: number): void => {
      g.fillColor = withAlpha(pal(hex), al);
      const s = skew / 2;
      g.moveTo(-w / 2 + s + slide, -bh / 2 + cy);
      g.lineTo(w / 2 + s + slide, -bh / 2 + cy);
      g.lineTo(w / 2 - s + slide, bh / 2 + cy);
      g.lineTo(-w / 2 - s + slide, bh / 2 + cy);
      g.close();
      g.fill();
    };
    band(44, "#07070d", 0.82 * a, 24);
    band(30, "#ff6a1f", 0.5 * a, 18);
    band(12, "#e60012", 0.85 * a, 18);
    this.exLabel.node.active = true;
    this.exLabel.node.setPosition(this.vp.x(C.world.w / 2) + slide * 0.4, cy, 0);
    this.exLabel.node.angle = -4;
  }

  /** game-root 在满管怒气重击起手那一帧调用;文案/颜色/字号随档位表的 castLab 喂进来 */
  playRageCutin(text: string, hex: string, size: number): void {
    this.rageCutinT = C.fx.slashCutinFramesRage || 40;
    this.rageLabel.string = text;
    this.rageLabel.color = new Color().fromHEX(hex);
    this.rageLabel.fontSize = Math.max(20, Math.round(size * 1.2));
    this.rageLabel.lineHeight = Math.round(this.rageLabel.fontSize * 1.15);
    this.rageLabel.node.active = true;
  }

  /**
   * 怒气满管斩劈:fire 带色三道斜带错相位横扫全屏(p5kit.drawCutinBands,居中原点直接可用)
   * + 中央大字(castLab 的「怒极·满溢!!」同文案,只在屏心停一瞬)。
   * 与力竭斩劈同一条视觉语汇 —— 「大事发生」在这套 HUD 里就长这个样子。
   */
  private rageCutinDraw(): void {
    if (this.rageCutinT <= 0) {
      this.rageLabel.node.active = false;
      return;
    }
    this.rageCutinT--;
    const total = C.fx.slashCutinFramesRage || 40;
    const p = 1 - this.rageCutinT / total;        // 0..1 演出进度
    drawCutinBands(this.g, C.world.w, C.world.h, p,
      C.fx.slashCutinAng ?? 14, C.fx.slashCutinBandW ?? 0.30, RAGE_CUTIN_COLS,
      C.fx.slashCutinAlpha ?? 0.55, C.fx.slashCutinStagger ?? 0.22, 1);
    // 大字走同一根 alpha 包络:进场渐显 → 屏心最亮 → 出场渐隐,不与带子抢戏
    this.rageOp.opacity = Math.round(255 * Math.min(1, Math.sin(Math.PI * p) * 1.25));
  }

  // ---------- 赛点斩劈横幅(原 hud.js 旗标的 P5 化:全宽斜切红带 + 锯齿撕边) ----------
  // 拍数不在这里重复:RALLY 计数由 HUD 的「x N 连击」大字负责
  private matchPointFlag(R: typeof Rules.R, t: number): void {
    const g = this.g;
    const isMP = (R.state === "SERVE" || R.state === "RALLY") && Rules.isMatchPoint();

    this.mpLabel.node.active = isMP;
    if (!isMP) {
      this.mpShown = false;
      return;
    }
    const mp = Rules.matchPointInfo();
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.12);
    const cy = this.vp.y(25);
    // rules 的 label 里自带 ★,这里只补两侧装饰 —— 直接拼会出现「★ ★ 赛末点 ★」
    // 内容只在 rules 的 label 变化时重拼(赛点期间旧版每帧 replace + 模板串)
    if (mp.label !== this.mpLastRaw) {
      this.mpLastRaw = mp.label;
      const raw = mp.label.replace(/★/g, "").trim();
      this.mpContent = raw ? `★ ${raw} ★` : "★ MATCH POINT ★";
    }
    const content = this.mpContent;
    // P5 斩劈横幅:近黑衬带 + 全宽主红带(微仰切)+ 下缘锯齿撕边
    const w = C.world.w + 120;
    const h = 30;
    const band = (bh: number, hex: string, a: number, skew: number): void => {
      g.fillColor = withAlpha(pal(hex), a);
      const s = skew / 2;
      g.moveTo(-w / 2 + s, -bh / 2 + cy);
      g.lineTo(w / 2 + s, -bh / 2 + cy);
      g.lineTo(w / 2 - s, bh / 2 + cy);
      g.lineTo(-w / 2 - s, bh / 2 + cy);
      g.close();
      g.fill();
    };
    band(h + 10, "#07070d", 0.88, 24);
    band(h, "#e60012", 0.9 + 0.1 * pulse, 18);
    g.fillColor = withAlpha(pal("#07070d"), 0.9);
    const teeth = 26;
    const tw = w / teeth;
    for (let i = 0; i < teeth; i++) {
      const x0 = -w / 2 + i * tw;
      g.moveTo(x0, -h / 2 + cy);
      g.lineTo(x0 + tw / 2, -h / 2 - 5 + cy);
      g.lineTo(x0 + tw, -h / 2 + cy);
    }
    g.fill();
    if (!this.mpShown) {
      // 一次性侧向斩入(渲染层不 import ui 构件,内联同款动画);之后只做颜色脉动
      this.mpShown = true;
      const n = this.mpLabel.node;
      Tween.stopAllByTarget(n);
      const x0 = this.vp.x(C.world.w / 2);
      n.setPosition(x0 - 60, cy, 0);
      n.angle = -5;
      tween(n)
        .to(0.3, { position: new Vec3(x0, cy, 0), angle: 0 }, { easing: "backOut" })
        .start();
    }
    this.mpLabel.string = content;
    // 颜色两态轮换(模块级常量,引擎赋值时内部 .set() 拷贝;旧版每帧 new 两个 Color)
    this.mpLabel.color = pulse > 0.4 ? MP_COL_A : MP_COL_B;
  }
}
