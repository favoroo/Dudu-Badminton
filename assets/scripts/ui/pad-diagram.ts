// ============================================================
// 移动方式图示:摇杆 / 滑轨 / 按键 各自「控件长什么样、手指怎么动、人怎么响应」
// 的一格会动的示意图。零 cc —— 出显示列表(Paint[]),画笔在 p5-paint。
//
// 为什么要有它 —— 操控页原来只有三颗字键加一行提示(用户现场:「选择不同的操作方式之后,
// 看能不能有相应的图示出来,只有文字不太好,不太直观」)。而这三档的差别恰恰是**句子说不清**
// 的那种:「推多少走多少」「手指在哪人就在哪」「两键全速」—— 没玩过的人读不出手感,
// 玩过的人不需要读。图示把「手指 + 控件 + 人物」画在同一格里,连手感的差别都看得见:
//   · 摇杆  人物身后的重影由密到疏(有起步与刹车),松手还要多滑一小截再收住(地面摩擦)
//   · 滑轨  滑块与人物在同一条竖线上 —— 手指挪多少像素,人就挪多少像素,一个不多一个不少
//   · 按键  重影等距(按下即满速、松开即钉住)
//
// 三条纪律:
//   1) **几何全部取自真值**,这里不抄第二份数字:底圈圆心与半径 = JOYSTICK_BASE,
//      三颗键的三角摆位与半径 = PAD_BASE,轨的行程与刻度 = railGeo()(它自己从 CFG.court 算),
//      起跳判定线 = CFG.stickJump.upHi,上滑阈值 = CFG.sliderControl.jumpSwipeUpY,
//      腾空曲线 = CFG.player.jumpV / gravity 的真实抛物线(顶点 92、全程 38 帧就是这么来的),
//      配色 = CFG.padSkin。改真值这里跟着动 —— 与 drill-demo / tutorial-demo 同一条老规矩:
//      演示与判据必须同源,否则教一套、干另一套。
//   2) **零 cc 出点列**:tools/panel-preview 能把它出成图、tools/panel-check 能断言几何,
//      屏幕上的与量到的是同一批多边形。(不搬 sprites.drawPlayer 那条真人路径:它 import cc,
//      一进来就出不了图、也断言不了,而这里要的是「一个人站在这儿、他跳起来了」,不是皮肤还原。)
//   3) **只画不算**:逐帧状态由 beatOf(mode, t) 这一个纯函数给 —— 无内部状态、可定格、
//      可倒推重影;绘制只消费它,不写任何字段。
//
// 取景:一块「屏幕底边的裁切」—— 舞台底边就是屏幕底边,横向从屏幕左缘外 8px 到网前 30px,
// 纵向要容下一次完整起跳。缩放 k 由**宽度**定:滑轨那 426 设计像素的行程必须铺满画面,
// 铺不满,1:1 这件事就看不出来。
// ============================================================
import { CFG } from "../core/config";
import { JOYSTICK_BASE, PAD_BASE, SLIDER_BASE, railGeo, type MoveMode } from "../core/settings";
import { C } from "./p5-tokens";
import { slantQuad, type Paint, type Pt } from "./p5-shapes";

const RAIL = railGeo();
const CO = CFG.court;
const SKIN = CFG.padSkin;
const PL = CFG.player;

/** 人物身高(设计像素):与 sprites 同一个 CFG.player.h */
const PERSON_H = PL.h;
/** 地面线离屏幕底边:世界 y 从上往下量,540 - 470 = 70 */
const GROUND_FROM_BOTTOM = CFG.world.h - CO.groundY;
/** 网顶离屏幕底边:地面 + 网高(470 - 390) */
const NET_TOP_FROM_BOTTOM = GROUND_FROM_BOTTOM + (CO.groundY - CO.netTopY);
/** 起跳真实顶点(设计像素)= v²/2g,与 player.ts 的递推同式,不是拍的数 */
export const HOP_APEX = (PL.jumpV * PL.jumpV) / (2 * PL.gravity);
/** 一次满跳的空中帧数 = 2v/g(≈38),图示的腾空段就用它 */
export const AIR_FRAMES = Math.round((2 * -PL.jumpV) / PL.gravity);

/** 取景范围(设计像素:x 从屏幕左边缘量,y 从屏幕底边量) */
export const CROP = {
  /** 让开左簇最左那颗键:它的圆要画完整,不能被画面切掉一半 */
  x0: -8,
  /** 网前留一点:那道竖线是「再往右也过不去」的墙 */
  x1: RAIL.maxX + 30,
  get w(): number { return this.x1 - this.x0; },
  /** 纵向要装下:地面 + 人物 + 一次满跳 + 落地余量 */
  get h(): number { return GROUND_FROM_BOTTOM + PERSON_H + HOP_APEX + 14; },
};

export const DIAG = {
  /** 图示盒内边距:凹陷槽底与画面之间那圈留白 */
  pad: 9,
  /** 画面离槽底再抬一点:控件圆贴到槽的下缘会被读成「被切掉一块」 */
  lift: 5,
  /** 一个循环的帧数(60fps 下 5 秒):三趟位移 + 一次起跳 + 收势 */
  loop: 300,
  /** 重影:倒推这几帧的人物位置 —— 间距的形状就是手感的形状 */
  ghost: [10, 21, 33] as const,
  /** 手指半径(图示像素,不随 k 缩:它是「手」,不是屏幕上的东西) */
  fingerR: 9,
  /** 摇杆 knob 半径比例 = input/touchpad.ts 的 KNOB_RATIO(那边没导出,改要一起改) */
  knobRatio: 0.42,
  /** 摇杆推程上限(占底圈半径的比例):松手刹车用的就是这一档 */
  knobTilt: 0.82,
  /** 摇杆松手后多滑的那一小截(设计像素) */
  glidePx: 5,
};

/**
 * 节拍(帧)。三段位移 + 一次起跳,首尾都回到中场 —— 循环接缝看不出来。
 * prep1 是**越过起跳判定那一帧**:摇杆推过 upHi、轨上滑过 jumpSwipeUpY、跳键按下,
 * 三档都在这一帧兑现,腾空段也从这一帧起算。
 * 导出给判据用:panel-check 要核「离地」与「越过判定」这两件事是不是同一帧(不同源就是假演示)。
 */
export const SEG = {
  enter: 16,
  goL0: 16, goL1: 66, holdL: 80,
  goR0: 80, goR1: 146, holdR: 160,
  back0: 160, back1: 214, settle: 228,
  prep0: 228, prep1: 244,
  end: 300,
};

// ---------- 舞台(设计像素 → 图示盒) ----------

export interface Stage {
  sw: number; sh: number;
  /** 设计像素 → 图示像素。横竖同一个数,否则「1:1」是假的 */
  k: number;
  /** 舞台底边 = 屏幕底边 */
  by: number;
  /** 地面线的舞台 y */
  groundY: number;
}

/** 由图示盒尺寸算舞台:k 由宽度定,内容自底边往上长 */
export function stageOf(w: number, h: number): Stage {
  const sw = w - DIAG.pad * 2, sh = h - DIAG.pad * 2;
  const k = sw / CROP.w;
  const by = -sh / 2 + DIAG.lift;
  return { sw, sh, k, by, groundY: by + GROUND_FROM_BOTTOM * k };
}

/** 这块取景折算成图示像素要多高 —— panel-check 拿它量「盒子装不装得下一次满跳」 */
export function cropHeightPx(w: number, h: number): number {
  return CROP.h * stageOf(w, h).k;
}

/** 设计 x(从屏幕左边缘)→ 舞台 x(取景中心为 0) */
export function sxOf(st: Stage, worldX: number): number {
  return (worldX - (CROP.x0 + CROP.x1) / 2) * st.k;
}
/** 设计 y(从屏幕底边)→ 舞台 y */
export function syOf(st: Stage, fromBottom: number): number {
  return st.by + fromBottom * st.k;
}

// ---------- 节拍(纯函数:模式 + 帧号 → 这一帧谁在哪儿) ----------

export type DiagKey = "left" | "right" | "jump";

export interface Beat {
  t: number;
  /** 人物世界 x:恒在 [railGeo.minX, railGeo.maxX] 内 —— 那就是人站得到的地方 */
  personX: number;
  /** 起跳高度(设计像素,0 = 站在地上),真实抛物线 */
  hop: number;
  /** 手指:世界 x + 离屏幕底边的 y(设计像素) */
  fingerX: number;
  fingerY: number;
  /** 手指按在控件上(涟漪的节奏开关) */
  pressed: boolean;
  /** 手指不透明度:入场与收势各淡出一次 */
  fingerA: number;
  /** 摇杆 knob 相对底圈心的偏移(设计像素) */
  knobX: number;
  knobY: number;
  /** 滑轨滑块中心的世界 x:slider 档恒等于 personX —— 这一条等式就是「1:1」的承诺本身 */
  thumbX: number;
  /** 按键档当前按下的是哪颗 */
  key: DiagKey | null;
  /** 上滑的抬起量(设计像素,滑轨档) */
  swipe: number;
  /** 起跳判定是否已被越过(三档都在 t == SEG.prep1 这一帧翻) */
  jumpCue: boolean;
}

const clamp01 = (u: number): number => (u < 0 ? 0 : u > 1 ? 1 : u);
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
/** 起步与刹车都有 = 模拟量的形状(摇杆) */
const smooth = (u: number): number => { const c = clamp01(u); return c * c * (3 - 2 * c); };
/** 手指自己挪动的形状(滑轨:人被手指带着走,所以跟人一样) */
const fingerCurve = (u: number): number => { const c = clamp01(u); return 1 - Math.pow(1 - c, 2.2); };
/** 循环内帧号:允许负数与超界(重影要倒推) */
const wrap = (t: number): number => ((Math.round(t) % DIAG.loop) + DIAG.loop) % DIAG.loop;

/** 真实抛物线:u = 起跳后第几帧 → 离地多高(设计像素) */
function hopAt(u: number): number {
  if (u < 0 || u > AIR_FRAMES) return 0;
  const h = (-PL.jumpV) * u - 0.5 * PL.gravity * u * u;
  return h > 0 ? h : 0;
}

/** 三段位移的端点:中场 → 自己这侧底线 → 网前 → 回中场 */
const HOME = (RAIL.minX + RAIL.maxX) / 2;
const NEAR = CO.left + 10;
const FAR = RAIL.maxX - 40;

/** 这一趟往哪个方向走(摇杆余势与按键箭头都要它) */
function leg(t: number): { from: number; to: number; a: number; b: number } | null {
  if (t < SEG.goL0) return null;
  if (t < SEG.goL1) return { from: HOME, to: NEAR, a: SEG.goL0, b: SEG.goL1 };
  if (t < SEG.goR0) return null;
  if (t < SEG.goR1) return { from: NEAR, to: FAR, a: SEG.goR0, b: SEG.goR1 };
  if (t < SEG.back0) return null;
  if (t < SEG.back1) return { from: FAR, to: HOME, a: SEG.back0, b: SEG.back1 };
  return null;
}

/**
 * 人物站位。三档读同一段位移,但曲线不同:
 *   滑轨 = 手指曲线(位置锁死,松开就停)
 *   按键 = 线性(按下即满速,松开即钉住)
 *   摇杆 = 缓入缓出 + 松手后多滑一小截再收住(地面摩擦的余势)
 */
function walkX(mode: MoveMode, t: number): number {
  const L = leg(t);
  if (L) {
    const u = (t - L.a) / (L.b - L.a);
    return lerp(L.from, L.to, mode === "slider" ? fingerCurve(u) : mode === "joystick" ? smooth(u) : clamp01(u));
  }
  // 停在某一头:摇杆在这里补那段余势(其余两档没有)。dir 是刚走完那一趟的方向,
  // 余势朝它继续滑一小截再收 —— 拿「离哪个端点近」当方向会算出 0,那是死支。
  const rest = (segEnd: number, holdEnd: number, at: number, dir: number): number =>
    (mode === "joystick" && t >= segEnd && t < holdEnd)
      ? at + dir * DIAG.glidePx * Math.sin(Math.PI * clamp01((t - segEnd) / (holdEnd - segEnd)))
      : at;
  if (t >= SEG.goL1 && t < SEG.goR0) return rest(SEG.goL1, SEG.goR0, NEAR, Math.sign(NEAR - HOME));
  if (t >= SEG.goR1 && t < SEG.back0) return rest(SEG.goR1, SEG.back0, FAR, Math.sign(FAR - NEAR));
  if (t >= SEG.back1) return rest(SEG.back1, SEG.settle, HOME, Math.sign(HOME - FAR));
  return HOME;
}

/** 这一帧的完整状态。任意帧号都吃得(内部取模),所以重影直接 beatOf(mode, t-10) 就行。 */
export function beatOf(mode: MoveMode, tRaw: number): Beat {
  const t = wrap(tRaw);
  const personX = Math.min(RAIL.maxX, Math.max(RAIL.minX, walkX(mode, t)));
  const hop = hopAt(t - SEG.prep1);
  /** 起跳兑现的那一帧到落地:三档共用同一个窗(prep1 = 越过判定的那一帧,见 SEG 注释) */
  const airing = t >= SEG.prep1 && t <= SEG.prep1 + AIR_FRAMES;
  const inPrep = t >= SEG.prep0 && t < SEG.prep1;
  const L = leg(t);
  const moving = L !== null;

  const baseR = JOYSTICK_BASE.r;
  let knobX = 0, knobY = 0, swipe = 0, key: DiagKey | null = null;
  if (mode === "joystick") {
    if (moving) {
      const dir = Math.sign(L.to - L.from);
      const u = (t - L.a) / (L.b - L.a);
      knobX = dir * baseR * DIAG.knobTilt * Math.min(1, Math.min(u, 1 - u) / 0.14);
    }
    if (inPrep) knobY = baseR * CFG.stickJump.upHi * smooth((t - SEG.prep0) / (SEG.prep1 - SEG.prep0));
    else if (airing) knobY = baseR * (CFG.stickJump.upHi + 0.12);
  } else if (mode === "slider") {
    if (inPrep) swipe = CFG.sliderControl.jumpSwipeUpY * smooth((t - SEG.prep0) / (SEG.prep1 - SEG.prep0));
    else if (airing) swipe = CFG.sliderControl.jumpSwipeUpY + 12 * Math.max(0, 1 - (t - SEG.prep1) / 12);
  } else {
    if (moving) key = L.to > L.from ? "right" : "left";
    else if (airing) key = "jump";
  }

  const jumpCue = airing;
  const fingerA = t < SEG.enter ? clamp01((t - (SEG.enter - 12)) / 12)
    : t > SEG.end - 16 ? clamp01((SEG.end - t) / 16) : 1;

  // 手指位置:摇杆跟着 knob 走、滑轨压在滑块上(上滑时抬起)、按键压在当前那颗键上
  const restX = (PAD_BASE.left.x + PAD_BASE.right.x) / 2;
  const fingerX = mode === "joystick" ? JOYSTICK_BASE.x + knobX
    : mode === "slider" ? personX
      : key ? PAD_BASE[key].x : restX;
  const fingerY = mode === "joystick" ? JOYSTICK_BASE.y + knobY
    : mode === "slider" ? SLIDER_BASE.y + swipe
      : key ? PAD_BASE[key].y
        : inPrep ? lerp(PAD_BASE.left.y, PAD_BASE.jump.y, smooth((t - SEG.prep0) / (SEG.prep1 - SEG.prep0)))
          : PAD_BASE.left.y;

  return {
    t, personX, hop, fingerX, fingerY,
    pressed: fingerA > 0.6, fingerA, knobX, knobY, thumbX: personX, key, swipe, jumpCue,
  };
}

// ---------- 出点列 ----------

const fill = (hex: string, a: number, pts: Pt[]): Paint => ({ kind: "fill", hex, a, pts });
const line = (hex: string, a: number, lw: number, pts: Pt[]): Paint => ({ kind: "stroke", hex, a, lw, close: false, pts });
const outline = (hex: string, a: number, lw: number, pts: Pt[]): Paint => ({ kind: "stroke", hex, a, lw, close: true, pts });

/**
 * 圆/椭圆折成多边形(引擎的 Graphics 能画圆,但点列要能在 node 里出图与断言,
 * 所以一律 24 边 —— 在这个尺寸下肉眼分不出,而笔画仍是一次 stroke)。
 */
export function ringPts(cx: number, cy: number, r: number, squash = 1, n = 24, rot = 0): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const th = rot + (Math.PI * 2 * i) / n;
    pts.push([cx + Math.cos(th) * r, cy + Math.sin(th) * r * squash]);
  }
  return pts;
}

/** 胶囊:两端半圆 + 上下两条直边(滑轨底轨的真形) */
function capsule(x0: number, x1: number, cy: number, r: number, n = 8): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const th = Math.PI / 2 + (Math.PI * i) / n;
    pts.push([x0 + Math.cos(th) * r, cy + Math.sin(th) * r]);
  }
  for (let i = 0; i <= n; i++) {
    const th = -Math.PI / 2 + (Math.PI * i) / n;
    pts.push([x1 + Math.cos(th) * r, cy + Math.sin(th) * r]);
  }
  return pts;
}

function arrowDL(out: Paint[], hex: string, a: number, lw: number,
  x: number, y: number, dx: number, dy: number, len: number, head: number): void {
  const n = Math.hypot(dx, dy) || 1;
  const ux = dx / n, uy = dy / n;
  const tip: Pt = [x + ux * len, y + uy * len];
  const px = -uy, py = ux;
  out.push(
    line(hex, a, lw, [[x, y], tip]),
    line(hex, a, lw, [
      [tip[0] - ux * head + px * head * 0.62, tip[1] - uy * head + py * head * 0.62],
      tip,
      [tip[0] - ux * head - px * head * 0.62, tip[1] - uy * head - py * head * 0.62],
    ]),
  );
}

/** 场地与背景:地面线、可达区间、场地线刻度、球网 —— 图示里「哪里是哪里」 */
function courtDL(out: Paint[], st: Stage): void {
  const gy = st.groundY;
  const far = st.sw / 2;
  // 地板:地面线以下一条极淡的暖色带,只说明「这是地面」而不是「这是空白」。
  // 再淡就要和槽底糊成一片,再浓就会跟控件抢眼睛 —— 出图肉眼定的这一档。
  out.push(fill(C.wood, 0.085, [[-far, gy], [far, gy], [far, st.by], [-far, st.by]]));
  // 地面线:可达段亮、够不着的两端暗 —— 与真滑轨端点那两档同一读法
  out.push(line(C.paper, 0.20, 1.6, [[-far, gy], [sxOf(st, RAIL.minX), gy]]));
  out.push(line(C.paper, 0.20, 1.6, [[sxOf(st, RAIL.maxX), gy], [far, gy]]));
  out.push(line(C.paper, 0.62, 2.2, [[sxOf(st, RAIL.minX), gy], [sxOf(st, RAIL.maxX), gy]]));
  for (const wx of [RAIL.minX, RAIL.maxX]) {
    const x = sxOf(st, wx);
    out.push(line(C.paper, 0.5, 2, [[x, gy - 6], [x, gy - 1]]));
    out.push(line(C.paper, 0.5, 2, [[x, gy + 1], [x, gy + 6]]));
  }
  // 场地线刻度:底线与前发球线 —— 与下面轨上的刻度是**同一批世界 x**
  for (const wx of [CO.left, CO.shortServeL]) {
    const x = sxOf(st, wx);
    out.push(line(C.paper, 0.26, 1.4, [[x, gy], [x, gy + 7]]));
  }
  // 球网:再往右也过不去的那道墙
  const nx = sxOf(st, CO.netX), nt = syOf(st, NET_TOP_FROM_BOTTOM);
  out.push(line(C.paper, 0.55, 2.4, [[nx, gy], [nx, nt]]));
  out.push(line(C.paper, 0.75, 2.4, [[nx - 5, nt], [nx + 5, nt]]));
  for (let i = 1; i <= 3; i++) {
    const y = gy + (nt - gy) * (i / 4);
    out.push(line(C.paper, 0.16, 1, [[nx - 4, y], [nx + 4, y]]));
  }
}

/**
 * 人物剪影:h = 图示像素身高。头 + 斜切身 + 两条腿 + 一柄拍。
 * 落地影子随腾空又小又淡 —— 在没离开地面之前,这一眼就能判「他跳了」。
 *
 * `tint` 是给 ui/skill-diagram 复用留的口子(影分身要三色);本模块自己恒用默认值。
 * 同一个人形两处共用一份,不允许可可再画一个"差不多的人"—— 那是第二把尺子。
 */
export function personDL(
  out: Paint[], x: number, groundY: number, h: number, alpha: number, hopPx: number,
  tint: string = C.paper,
): void {
  if (alpha <= 0.02) return;
  const feet = groundY + hopPx;
  const shrink = 1 - Math.min(0.55, hopPx / (h * 1.6));
  const detail = alpha > 0.5;
  // 脚下那圈"站位印":暗槽底上画墨色影子等于没画,所以反过来用一层淡白 ——
  // 腾空时它又小又淡,这一眼就是"他离开地面了"(重影不画,三份叠成一排只会糊)。
  if (detail) out.push(fill(C.paper, 0.17 * shrink, ringPts(x, groundY - 1, h * 0.20 * shrink, 0.20, 14)));
  const hipY = feet + h * 0.42, shY = feet + h * 0.74, headY = feet + h * 0.88;
  const spread = hopPx > 0 ? 0.20 : 0.13;
  const lw = Math.max(2, h * 0.075);
  out.push(line(tint, 0.85 * alpha, lw, [[x - h * spread, feet], [x - h * 0.03, hipY]]));
  out.push(line(tint, 0.85 * alpha, lw, [[x + h * spread, feet], [x + h * 0.03, hipY]]));
  out.push(fill(tint, 0.92 * alpha, slantQuad(h * 0.24, h * 0.36, h * 0.05, x, (hipY + shY) / 2)));
  out.push(fill(tint, 0.95 * alpha, ringPts(x, headY, h * 0.115, 1, 14)));
  // 持拍手朝网那一侧;拍杆的延长线正好接到拍头环的边缘(差一点就像脱手)。
  // 重影不画拍:荧光黄的环在暗底上最扎眼,三份叠成一排"圈圈"就把"这是刚才那个人"
  // 读成了"这儿有三个球"—— 出图肉眼判定的这一档。
  if (detail) {
    out.push(line(tint, 0.8 * alpha, Math.max(1.6, h * 0.055), [[x + h * 0.06, shY - h * 0.02], [x + h * 0.19, shY + h * 0.11]]));
    out.push(outline(C.acid, 0.9 * alpha, Math.max(1.6, h * 0.05), ringPts(x + h * 0.25, shY + h * 0.17, h * 0.085, 1, 12)));
  }
}

/** 摇杆:底圈 + 内圈参考 + 起跳分界弦 + knob + 三向箭头 */
function joystickDL(out: Paint[], st: Stage, b: Beat): void {
  const cx = sxOf(st, JOYSTICK_BASE.x), cy = syOf(st, JOYSTICK_BASE.y);
  const R = JOYSTICK_BASE.r * st.k;
  const pushed = b.knobX !== 0 || b.knobY !== 0;
  out.push(fill(SKIN.idleFill, 0.9, ringPts(cx, cy, R)));
  out.push(outline(SKIN.idleEdge, 0.55, 2, ringPts(cx, cy, R)));
  out.push(outline(SKIN.idleEdge, 0.22, 1.6, ringPts(cx, cy, R * 0.6)));
  // 起跳分界弦:与真摇杆同一条线(y = R × upHi)。推过它才跳 —— 不画出来没人学得会
  const jy = cy + R * CFG.stickJump.upHi;
  const jw = Math.sqrt(Math.max(0, R * R - (R * CFG.stickJump.upHi) ** 2));
  out.push(line(SKIN.downEdge, b.jumpCue ? 0.95 : 0.34, b.jumpCue ? 3.4 : 1.8, [[cx - jw, jy], [cx + jw, jy]]));
  arrowDL(out, SKIN.downEdge, b.knobX < -1 ? 1 : 0.3, 2.4, cx - R - 4, cy, -1, 0, 11, 6);
  arrowDL(out, SKIN.downEdge, b.knobX > 1 ? 1 : 0.3, 2.4, cx + R + 4, cy, 1, 0, 11, 6);
  // 注意单位:knobY 是设计像素、R 是图示像素 —— 判定要拿设计半径去比(与真摇杆同一个阈值)
  arrowDL(out, SKIN.downEdge, b.knobY >= JOYSTICK_BASE.r * CFG.stickJump.upHi ? 1 : 0.32,
    2.4, cx, cy + R + 4, 0, 1, 12, 6);
  const kx = cx + b.knobX * st.k, ky = cy + b.knobY * st.k, kr = R * DIAG.knobRatio;
  out.push(fill(pushed ? SKIN.downFill : SKIN.idleFill, 0.96, ringPts(kx, ky, kr)));
  out.push(outline(pushed ? SKIN.downEdge : SKIN.idleEdge, 0.9, 2.6, ringPts(kx, ky, kr)));
  out.push(fill(SKIN.icon, 0.6, ringPts(kx, ky, kr * 0.24)));
}

/** 滑轨:底轨 + 与地面同源的刻度 + 滑块 + 对位竖线(1:1 的那一眼) */
function sliderDL(out: Paint[], st: Stage, b: Beat): void {
  const cy = syOf(st, SLIDER_BASE.y);
  const r = SLIDER_BASE.r * st.k;
  const x0 = sxOf(st, RAIL.minX), x1 = sxOf(st, RAIL.maxX);
  out.push(fill(SKIN.idleFill, 0.9, capsule(x0, x1, cy, r)));
  out.push(outline(SKIN.idleEdge, b.pressed ? 0.8 : 0.5, 2, capsule(x0, x1, cy, r)));
  // 刻度:与上面那条地面线同一批世界 x —— 轨与场 1:1 的证据就在这几笔上
  for (const [wx, lw, a] of [[CO.left, 1.4, 0.3], [CO.shortServeL, 1.4, 0.3], [CO.netX, 2.6, 0.6]] as const) {
    const x = sxOf(st, wx);
    if (x > x1 + r) continue;
    out.push(line(SKIN.idleEdge, a, lw, [[x, cy - r * 0.5], [x, cy + r * 0.5]]));
  }
  const tx = sxOf(st, b.thumbX);
  out.push(fill(SKIN.downFill, 0.96, ringPts(tx, cy, r * 0.78)));
  out.push(outline(SKIN.downEdge, 0.9, 2.4, ringPts(tx, cy, r * 0.78)));
  // 对位竖线:滑块正上方一条虚线一直落到人脚下 —— 「手指在哪人就在哪」的点睛。
  // 这是滑轨档最该被看懂的一笔,浓度单独给足(淡到看不见就等于没画)。
  let pen = true;
  for (let y = cy + r + 3; y < st.groundY - 2; y += 6) {
    if (pen) out.push(line(C.paper, 0.5, 1.6, [[tx, y], [tx, Math.min(y + 3.2, st.groundY - 2)]]));
    pen = !pen;
  }
  arrowDL(out, SKIN.downEdge, b.swipe >= CFG.sliderControl.jumpSwipeUpY ? 0.98 : 0.4,
    b.swipe >= CFG.sliderControl.jumpSwipeUpY ? 3.2 : 2, tx, cy + r + 6, 0, 1, 13, 6.5);
}

/** 按键:左右并排在底、跳键居中在上 —— 三角摆位与半径全部来自 PAD_BASE */
function buttonsDL(out: Paint[], st: Stage, b: Beat): void {
  for (const id of ["left", "right", "jump"] as const) {
    const cx = sxOf(st, PAD_BASE[id].x), cy = syOf(st, PAD_BASE[id].y);
    const on = b.key === id;
    const R = PAD_BASE[id].r * st.k * (on ? SKIN.pressScale : 1);
    out.push(fill(on ? SKIN.downFill : SKIN.idleFill, 0.9, ringPts(cx, cy, R)));
    out.push(outline(on ? SKIN.downEdge : SKIN.idleEdge, on ? 0.95 : 0.5, on ? 3 : 2, ringPts(cx, cy, R)));
    if (id === "jump") arrowDL(out, SKIN.downEdge, on ? 0.98 : 0.45, on ? 3 : 2.2, cx, cy - 3, 0, 1, 12, 6.5);
    else arrowDL(out, SKIN.downEdge, on ? 0.98 : 0.45, on ? 3 : 2.2, cx, cy, id === "right" ? 1 : -1, 0, 11, 6);
  }
}

/** 手指:纸白圆 + 墨描边 + 一弯指甲;按下时一圈涟漪(节奏吃 t,不逐帧 rand) */
function fingerDL(out: Paint[], st: Stage, b: Beat): void {
  const al = b.fingerA;
  if (al <= 0.02) return;
  const x = sxOf(st, b.fingerX), y = syOf(st, b.fingerY), R = DIAG.fingerR;
  if (b.pressed) {
    const k = (b.t % 34) / 34;
    out.push(outline(C.paper, 0.5 * al * (1 - k), 1.6, ringPts(x, y, R + 2 + k * 11, 1, 18)));
  }
  out.push(fill(C.paper, 0.97 * al, ringPts(x, y, R, 1, 18)));
  out.push(outline(C.ink, 0.9 * al, 2, ringPts(x, y, R, 1, 18)));
  const arc: Pt[] = [];
  for (let i = 0; i <= 6; i++) {
    const th = Math.PI * 0.95 + (Math.PI * 0.75 * i) / 6;
    arc.push([x + 2.4 + Math.cos(th) * 3.8, y + 2.4 + Math.sin(th) * 3.8]);
  }
  out.push(line(C.dim, 0.95 * al, 2, arc));
}

/** 重影:倒推几帧的人物位置。全速 → 等距;模拟量 → 由密到疏 */
function ghostsDL(out: Paint[], st: Stage, mode: MoveMode, cur: Beat, h: number): void {
  const al = [0.26, 0.17, 0.10];
  DIAG.ghost.forEach((d, i) => {
    const g = beatOf(mode, cur.t - d);
    if (Math.abs(g.personX - cur.personX) < 1.5 && g.hop <= 0 && cur.hop <= 0) return;
    personDL(out, sxOf(st, g.personX), st.groundY, h, al[i], g.hop * st.k);
  });
}

/**
 * 一帧的完整显示列表。w/h = 图示盒宽高(面板照 layout 的盒传,别在这儿拍数)。
 * 层序:场地 → 控件 → 重影 → 人物 → 手指。
 */
export function padDiagramDL(mode: MoveMode, t: number, w: number, h: number): Paint[] {
  const st = stageOf(w, h);
  const b = beatOf(mode, t);
  const out: Paint[] = [];
  courtDL(out, st);
  if (mode === "joystick") joystickDL(out, st, b);
  else if (mode === "slider") sliderDL(out, st, b);
  else buttonsDL(out, st, b);
  ghostsDL(out, st, mode, b, PERSON_H * st.k);
  personDL(out, sxOf(st, b.personX), st.groundY, PERSON_H * st.k, 1, b.hop * st.k);
  fingerDL(out, st, b);
  return out;
}

/** 一帧画多少笔(重影最密的那帧就是上限;panel-check 拿它核每帧成本) */
export function padDiagramStrokeCount(mode: MoveMode, t: number, w: number, h: number): number {
  return padDiagramDL(mode, t, w, h).length;
}
