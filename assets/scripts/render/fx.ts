// ============================================================
// 粒子 & 打击特效系统 (FXSystem)
// 1:1 移植自老工程 src/fx.js (~640 行 Canvas 2D)——
//   扣杀冲击波 / 甜区光晕 / 落地扬尘 / 羽毛飘落 / 彩带喷射 / 速度线 / 火花。
// 适配 Cocos Creator 3.8 Graphics API:
//   - 无 save/restore/translate/rotate → 旋转形状手动算顶点
//   - ellipse(cx,cy,rx,ry) 参数为半径
//   - fill()/stroke() 消费自上次 fill/stroke 以来的路径
// 零 GC: struct-of-arrays 预分配 Float32Array/Int32Array/Uint8Array + swap-and-pop。
// 所有位置用世界坐标(canvas 惯例 y-down),绘制时经 Viewport 变换。
// ============================================================
import { Color, Graphics } from "cc";
import { CFG } from "../core/config";
import { TAU, rand, randi, clamp } from "../core/utils";
import { withAlpha } from "./palette";
import { easeOutCubic, easeOutQuart, fadePow } from "./easing";
import { TIER_FIRE, TIER_SMASH, TIER_SWEET_SMASH } from "./shuttle-motion";
import { drawCrossMark, drawSpikeRing, drawTaper, fillSpikes, SPIKE_VERTS } from "./p5kit";

const C = CFG;
const CO = C.court;
const PI = Math.PI;
const { sin, cos, atan2, hypot } = Math;

// ---------- Viewport (重声明,避免与 world.ts 循环导入) ----------
interface Viewport {
  x(wx: number): number;
  y(wy: number): number;
}

// ---------- 颜色查找表 ----------
const COL_WHITE   = 0;
const COL_GOLD    = 1;
const COL_CYAN    = 2;
const COL_ORANGE  = 3;
const COL_RED     = 4;
const COL_GREEN_L = 5;  // #d8ffb0
const COL_CGREEN  = 6;  // confetti green #7dff9e
const COL_CBLUE   = 7;  // confetti blue  #3ea8ff
const COL_PURPLE  = 8;  // #a855f7 引力紫
const COL_TEAL    = 9;  // #06b6d4 时空青
const COL_SLASH   = 10; // #e60012 P5 主红(火热档的爆裂环)

const CLUT: Color[] = [
  new Color(255, 255, 255, 255),  // 0 white
  new Color(255, 225,  77, 255),  // 1 gold  #ffe14d
  new Color(  0, 240, 255, 255),  // 2 cyan  #00f0ff
  new Color(255, 106,  31, 255),  // 3 orange #ff6a1f
  new Color(255,  77,  77, 255),  // 4 red   #ff4d4d
  new Color(216, 255, 176, 255),  // 5 green #d8ffb0
  new Color(125, 255, 158, 255),  // 6 cgreen #7dff9e
  new Color( 62, 168, 255, 255),  // 7 cblue  #3ea8ff
  new Color(168,  85, 247, 255),  // 8 purple #a855f7
  new Color(  6, 182, 212, 255),  // 9 teal   #06b6d4
  new Color(230,   0,  18, 255),  // 10 slash #e60012
];

// ---------- 形状枚举 ----------
const SH_SQUARE = 0;
const SH_STAR   = 1;
const SH_STREAK = 2;

// ---------- 池容量 ----------
const MAX_P  = 500;  // 粒子(dust/burst/sparkle/streak/spark)
const MAX_R  = 24;   // 扩散环
const MAX_SW = 8;    // 冲击波
const MAX_SL = 60;   // 速度线
const MAX_CF = 200;  // 彩带
const MAX_FT = 60;   // 羽毛
const MAX_MK = 16;   // 落点标记

// ================================================================
// 粒子池 — struct-of-arrays
// ================================================================
const px    = new Float32Array(MAX_P);
const py    = new Float32Array(MAX_P);
const pvx   = new Float32Array(MAX_P);
const pvy   = new Float32Array(MAX_P);
const pg    = new Float32Array(MAX_P);
const pdrag = new Float32Array(MAX_P);
const plife = new Int32Array(MAX_P);
const pmax  = new Int32Array(MAX_P);
const psz   = new Float32Array(MAX_P);
const prot  = new Float32Array(MAX_P);
const pvr   = new Float32Array(MAX_P);
const pcol  = new Uint8Array(MAX_P);
const psh   = new Uint8Array(MAX_P);
let pN = 0;

// ================================================================
// 环池
// ================================================================
const rx   = new Float32Array(MAX_R);
const ry   = new Float32Array(MAX_R);
const rr   = new Float32Array(MAX_R);   // 当前半径
const rr0  = new Float32Array(MAX_R);   // 起始半径(缓动基准;老代码只用 lerp 一步到位)
const rr1  = new Float32Array(MAX_R);   // 目标半径
const rlf  = new Int32Array(MAX_R);     // life(递增)
const rmx  = new Int32Array(MAX_R);     // max
const rw   = new Float32Array(MAX_R);   // lineWidth
const rcol = new Uint8Array(MAX_R);
const rflat = new Uint8Array(MAX_R);    // 1 = 扁椭圆
// P5 爆裂锯齿环:尖刺形状出生定死(fillSpikes),逐帧只乘半径与 alpha
const rvert = new Float32Array(MAX_R * SPIKE_VERTS);  // 顶点乘数(外径 1 / 内径 inK × 抖动)
const rcnt  = new Uint8Array(MAX_R);    // 顶点数(2N)
const rrot  = new Float32Array(MAX_R);  // 出生基准角
const rjag  = new Uint8Array(MAX_R);    // 1 = 尖刺多边形,0 = 平滑椭圆(引力/时空专属)
let rN = 0;

// ================================================================
// 冲击波池
// ================================================================
const swx   = new Float32Array(MAX_SW);
const swy   = new Float32Array(MAX_SW);
const swr   = new Float32Array(MAX_SW);
const swmr  = new Float32Array(MAX_SW);  // maxR(未使用,仅记录)
const swspd = new Float32Array(MAX_SW);
const swlf  = new Int32Array(MAX_SW);
const swmx  = new Int32Array(MAX_SW);
const sww   = new Float32Array(MAX_SW);
const swcol = new Uint8Array(MAX_SW);
const swdl  = new Int32Array(MAX_SW);    // delay
// P5 锯齿主波:同环池的出生定形方案(次波仍走平滑椭圆)
const swvert = new Float32Array(MAX_SW * SPIKE_VERTS);
const swcnt  = new Uint8Array(MAX_SW);
const swrot  = new Float32Array(MAX_SW);
const swjag  = new Uint8Array(MAX_SW);
let swN = 0;

// ================================================================
// 速度线池
// ================================================================
const slx1  = new Float32Array(MAX_SL);
const sly1  = new Float32Array(MAX_SL);
const slx2  = new Float32Array(MAX_SL);
const sly2  = new Float32Array(MAX_SL);
const sllf  = new Int32Array(MAX_SL);
const slmx  = new Int32Array(MAX_SL);
const slcol = new Uint8Array(MAX_SL);
let slN = 0;

// ================================================================
// 彩带池
// ================================================================
const cfx   = new Float32Array(MAX_CF);
const cfy   = new Float32Array(MAX_CF);
const cfvx  = new Float32Array(MAX_CF);
const cfvy  = new Float32Array(MAX_CF);
const cfrot = new Float32Array(MAX_CF);
const cfvr  = new Float32Array(MAX_CF);
const cfw   = new Float32Array(MAX_CF);
const cfh   = new Float32Array(MAX_CF);
const cflf  = new Int32Array(MAX_CF);
const cfmx  = new Int32Array(MAX_CF);
const cfcol = new Uint8Array(MAX_CF);
let cfN = 0;

// ================================================================
// 羽毛池
// ================================================================
const ftx   = new Float32Array(MAX_FT);
const fty   = new Float32Array(MAX_FT);
const ftvx  = new Float32Array(MAX_FT);
const ftvy  = new Float32Array(MAX_FT);
const ftrot = new Float32Array(MAX_FT);
const ftvr  = new Float32Array(MAX_FT);
const ftlf  = new Int32Array(MAX_FT);
const ftmx  = new Int32Array(MAX_FT);
const ftsz  = new Float32Array(MAX_FT);
let ftN = 0;

// ================================================================
// 落点标记池
// ================================================================
const mkx   = new Float32Array(MAX_MK);
const mklf  = new Int32Array(MAX_MK);
const mkmx  = new Int32Array(MAX_MK);
const mkout = new Uint8Array(MAX_MK);
let mkN = 0;

// ================================================================
// FXSystem
// ================================================================
export class FXSystem {

  constructor() { this.clear(); }

  // ==============================================================
  // 公开接口
  // ==============================================================

  /**
   * 扣杀冲击波:星芒 + 扩散环 + 爆散 + 定向划线 + 速度线 + 火花扇。
   *
   * 老实现一上来就是 4 道彩环(白/金/青/橙)+ 4 组爆散 + 30 条放射速度线 ——
   * 在 960×540 的画面里那四环直接铺成一面"靶子",把球本身盖掉,而且每一档都是
   * 同一面靶子,读不出"这拍更狠"。现在:环收到 2 道(高潮档才 3 道)、星芒 2~3 颗、
   * 速度线按档位给强度并统一收短,把"狠"让给粒子形态与丝带,而不是数量。
   */
  smash(hx: number, hy: number, angle: number, tier = TIER_SMASH): void {
    const dir = cos(angle) >= 0 ? 1 : -1;
    const big = tier >= TIER_SWEET_SMASH;        // 甜蜜重扣 / 连击火热
    // 粒子总量下调(分级炫技要的是"每粒更精"):倍率进 config,
    // 换来同屏峰值离 MAX_P=500 更远 —— 不需要靠"特效档次"开关保帧。
    const bc = (n: number) => Math.max(3, Math.round(n * (C.fx.burstSmashK ?? 0.5)));

    // 1) 星芒:白 + 金,顶档再加一颗青
    this._sparkle(hx, hy, COL_WHITE, 34, 20);
    this._sparkle(hx, hy, COL_GOLD,  50, 24);
    if (big) this._sparkle(hx, hy, COL_CYAN, 40, 18);

    // 2) 扩散环:起始半径错开 = 一层层往外推的波纹(顶档多一道;火热档金环换 P5 斩劈红)
    this._ring(hx, hy, 6,  92,  18, 4.5, COL_WHITE, false);
    this._ring(hx, hy, 14, 142, 26, 3.2, tier >= TIER_FIRE ? COL_SLASH : COL_GOLD, false);
    if (big) this._ring(hx, hy, 22, 196, 32, 2.6, COL_CYAN, false);

    // 3) 爆散粒子(顶档多一组橙)
    this._burst(hx, hy, bc(44), COL_GOLD,   12, 34);
    this._burst(hx, hy, bc(26), COL_WHITE,  14, 26);
    this._burst(hx, hy, bc(22), COL_CYAN,    9, 30);
    if (big) this._burst(hx, hy, bc(18), COL_ORANGE, 8, 28);

    // 4) 定向划线(沿 angle 扇形展开;20 → 14,每片改成刀形比多撒几颗更值钱)
    for (let i = 0; i < 14; i++) {
      const a = angle + (i / 14 - 0.5) * 1.1;
      const spd = rand(18, 30);
      const ci = i % 3 === 0 ? COL_CYAN : i % 3 === 1 ? COL_GOLD : COL_WHITE;
      this._particle(hx, hy, cos(a) * dir * spd, sin(a) * rand(9, 20),
        0.03, 0.98, 18, 18, 3, 0, 0, ci, SH_STREAK);
    }

    // 5) 速度线:按出球方向收带,强度随档位(普通扣杀不再和完美重扣一样满屏)
    this._speedLines(hx, hy, big ? 1.0 : 0.6, angle);

    // 6) 方向火花扇
    this._dirSparks(hx, hy, angle, big ? 1.5 : 1.1);
  }

  /** 甜区光晕:星芒 + 环 + 爆散 + 划线(无速度线/火花扇)。angle = 出球方向,缺省右向 */
  sweet(sx: number, sy: number, angle = 0): void {
    const bc = (n: number) => Math.max(2, Math.round(n * (C.fx.burstSmashK ?? 0.5)));
    // 2 颗星芒
    this._sparkle(sx, sy, COL_WHITE, 20, 15);
    this._sparkle(sx, sy, COL_GOLD,  32, 18);

    // 2 道环
    this._ring(sx, sy, 4, 52, 16, 3.5, COL_WHITE, false);
    this._ring(sx, sy, 8, 82, 22, 2.5, COL_GOLD,  false);

    // 3 组爆散
    this._burst(sx, sy, bc(24), COL_GOLD,  8, 24);
    this._burst(sx, sy, bc(16), COL_WHITE, 10, 18);
    this._burst(sx, sy, bc(10), COL_CYAN,   6, 20);

    // 10 条定向划线(较窄扇形,跟着出球方向走 —— 原来是固定朝右的扇)
    for (let i = 0; i < 10; i++) {
      const a = angle + (i / 10 - 0.5) * 0.8;
      const spd = rand(12, 20);
      const ci = i % 2 === 0 ? COL_WHITE : COL_GOLD;
      this._particle(sx, sy, cos(a) * spd, sin(a) * spd,
        0.02, 0.98, 12, 12, 2.2, 0, 0, ci, SH_STREAK);
    }
  }

  /** 落地扬尘 + 落点标记(去除花哨的扩散光圈与冲击波波纹) */
  land(lx: number, ly: number, inCourt: boolean): void {
    const col = inCourt ? COL_GREEN_L : COL_RED;
    const groundY = CO.groundY;

    if (inCourt) {
      // 场内自然落地扬尘
      this._dust(lx, groundY, 14, COL_GOLD, 3.0);
      this._dust(lx, groundY, 8, COL_WHITE, 2.0);
    } else {
      // 场外微弱扬尘
      this._dust(lx, groundY, 6, col, 1.6);
    }

    // 落点标记
    this._mark(lx, inCourt);
  }

  /** 人物跑动落脚轻微扬尘(自然微粒，无任何光圈波纹) */
  stepDust(x: number, y: number): void {
    this._dust(x, y, 3, COL_WHITE, 1.2);
  }

  /**
   * 扣杀落地冲击波:地面椭圆扩张波纹(主波 + 延迟次波)。
   * 管线(池/步进/绘制)老工程就有,此前一直没有公开入口 —— 这次把落地瞬间接上。
   * 参数全部来自 config.fx.shockwave*。
   */
  shockwave(lx: number, ly: number): void {
    const maxR = C.fx.shockwaveMaxR || 80;
    const speed = C.fx.shockwaveSpeed || 5.5;
    const life = C.fx.shockwaveLife || 18;
    this._shockwave(lx, ly, 6, maxR, speed, life, 6, COL_ORANGE, 0, true);   // 主波:P5 锯齿
    this._shockwave(lx, ly, 4, maxR * 0.7, speed * 0.8, life - 4, 4, COL_WHITE, 3);  // 次波:平滑椭圆
  }

  /** 普通击球接触小火花:一小撮白金粒子,让平抽/高远的对拉每拍都有「打到了」的手感 */
  miniSpark(hx: number, hy: number, angle = 0): void {
    const n = C.fx.miniSparkCount ?? 4;
    for (let i = 0; i < n; i++) {
      // 朝出球方向的窄扇(而不是全向撒):普通拍也读得出"这拍往哪去了"
      const a = angle + rand(-1.1, 1.1);
      const spd = rand(2.5, 7);
      this._particle(hx, hy, cos(a) * spd, sin(a) * spd,
        0.08, 0.92, randi(7, 12), 12,
        rand(1.4, 2.6), rand(0, PI / 4), rand(-0.08, 0.08), i < 2 ? COL_GOLD : COL_WHITE, SH_SQUARE);
    }
    // 一道极小的环:普通档不再是"只有几粒灰"(分级炫技的地板抬高半格)
    this._ring(hx, hy, 3, 26, 10, 1.6, COL_WHITE, false);
  }

  /**
   * 闪现折跃:从 (fx0,fy0) 到 (tx,ty) 拉一道雷光。
   * 全部复用既有池(星芒 / 环 / 爆散 / 速度线),不新增管线 —— 雷本来就不是一块连续多边形,
   * 而是一串炸开的亮斑,贝珠串成的折线读起来正是"闪电"。两端各补一圈涟漪:起点是"人从这
   * 里消失",终点是"人从这里出现并且已经把拍举起来了"。
   */
  blink(fx0: number, fy0: number, tx: number, ty: number): void {
    const dx = tx - fx0, dy = ty - fy0;
    const len = hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;            // 路径法向,用来甩出锯齿
    for (let i = 0; i < 14; i++) {
      const t = i / 13;
      const swing = sin(t * PI) * rand(6, 20) * (i % 2 === 0 ? 1 : -1);
      const x = fx0 + dx * t + nx * swing;
      const y = fy0 + dy * t + ny * swing;
      // 中间最亮最粗,两头收细:视线会跟着这条串走到新位置
      this._sparkle(x, y, i % 4 === 0 ? COL_CYAN : COL_GOLD, 12 + (1 - Math.abs(t - 0.5) * 2) * 14, randi(10, 18));
    }
    this._ring(fx0, fy0 - 40, 6, 46, 14, 2.4, COL_CYAN, false);
    this._burst(fx0, fy0 - 40, 8, COL_WHITE, 7, 16);
    // 落点两道环刻意比扣杀冲击环小一号、寿命短一半:这几圈是"人刚到位"的余波,
    // 真正的主角是下一帧那记劈扣 —— 环活太久会把人物糊在靶心里(预览图实测过)
    this._ring(tx, ty - 60, 5, 54, 13, 2.6, COL_WHITE, false);
    this._ring(tx, ty - 60, 9, 80, 17, 2.0, COL_GOLD, false);
    this._burst(tx, ty - 60, 10, COL_GOLD, 10, 20);
    // 不再叠速度线:折跃已经有那串雷珠 + 两端涟漪,再加一圈向心线会把人物糊在靶心里
    // (预览图实测:定格那一帧正是全场最安静的一帧,越克制越读得出"时停")
  }

  /** 闪现扣杀命中苍穹天雷:天际直贯击球点的纵向雷光轰击与地面雷暴 */
  skyThunder(x: number, y: number): void {
    const topY = 20;
    const dy = y - topY;
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const jolt = sin(t * PI * 2) * rand(8, 20) * (i % 2 === 0 ? 1 : -1);
      const px = x + jolt;
      const py = topY + dy * t;
      this._sparkle(px, py, i % 2 === 0 ? COL_GOLD : COL_WHITE, 16 + (1 - t) * 12, randi(12, 18));
      if (i % 2 === 1) {
        const branchAng = (jolt > 0 ? 0.35 : PI - 0.35) + rand(-0.25, 0.25);
        const bSpd = rand(10, 16);
        this._particle(px, py, cos(branchAng) * bSpd, sin(branchAng) * bSpd,
          0.04, 0.92, randi(8, 14), 14, 2.0, 0, 0, COL_CYAN, SH_STREAK);
      }
    }
    this.thunderBurst(x, y);
  }

  /** 闪现雷暴冲击波:金白双层雷环与雷离子爆散 */
  thunderBurst(x: number, y: number): void {
    this._sparkle(x, y, COL_WHITE, 26, 16);
    this._sparkle(x, y, COL_GOLD, 34, 20);
    this._ring(x, y, 6, 64, 15, 3.4, COL_WHITE, false);
    this._ring(x, y, 10, 92, 19, 2.6, COL_GOLD, false);
    this._burst(x, y, 12, COL_GOLD, 10, 22);
    this._burst(x, y, 8, COL_CYAN, 8, 18);
  }

  /** 跨步突进爆发:贴地向后喷射的破风气流粒子与扩散气流风环 */
  lungeDash(x: number, y: number, dir: number): void {
    const oppDir = -dir;
    // 6 条贴地向后喷薄的破风流线
    for (let i = 0; i < 6; i++) {
      const a = (oppDir > 0 ? 0 : PI) + rand(-0.25, 0.25);
      const spd = rand(10, 22);
      const col = i % 2 === 0 ? COL_CYAN : COL_WHITE;
      this._particle(x, y - rand(2, 10), cos(a) * spd, sin(a) * spd * 0.3 - rand(0.5, 2.5),
        0.05, 0.90, randi(10, 16), 16, rand(1.8, 2.8), 0, 0, col, SH_STREAK);
    }
    // 地面青白色扁平扩散气流环
    this._ring(x, y - 4, 6, 44, 13, 2.4, COL_CYAN, true);
    this._dust(x, y, 5, COL_WHITE, 1.8);
  }

  /** 重击爆气:炽热烈焰爆散与金红双层冲击波 */
  flameBurst(x: number, y: number): void {
    // 2 颗星芒 (金/红)
    this._sparkle(x, y, COL_WHITE, 20, 14);
    this._sparkle(x, y, COL_RED, 28, 18);
    // 2 道烈焰扩散环 (内金外红)
    this._ring(x, y, 6, 56, 16, 3.2, COL_GOLD, false);
    this._ring(x, y, 10, 84, 20, 2.4, COL_RED, false);
    // 16 颗金红爆散粒子
    this._burst(x, y, 10, COL_GOLD, 8, 22);
    this._burst(x, y, 10, COL_ORANGE, 10, 20);
    this._burst(x, y, 8, COL_RED, 12, 18);
  }

  /** 引力奇点爆发:紫色重力波与向心/离心空间粒子(刻意平滑圆:引力=圆,不跟打击抢尖刺) */
  singularityBurst(x: number, y: number): void {
    // 双层紫色空间波动环
    this._ring(x, y, 4, 48, 14, 2.8, COL_PURPLE, false, false);
    this._ring(x, y, 8, 76, 18, 2.0, COL_WHITE, false, false);
    // 紫白相间爆散粒子
    this._burst(x, y, 12, COL_PURPLE, 7, 20);
    this._burst(x, y, 8, COL_CYAN, 9, 16);
    this._sparkle(x, y, COL_PURPLE, 24, 16);
  }

  /** 时空涟漪展开:青碧色时空领域波纹(同上:时空=平滑圆) */
  timeRupture(x: number, y: number): void {
    // 柔和时空波动双环
    this._ring(x, y, 8, 72, 22, 2.2, COL_TEAL, false, false);
    this._ring(x, y, 14, 110, 26, 1.6, COL_WHITE, false, false);
    // 青白时空光尘
    this._burst(x, y, 14, COL_TEAL, 5, 24);
    this._sparkle(x, y, COL_TEAL, 30, 20);
  }

  /** 羽毛飘落:count 片白羽从 (x,y) 散落,重力+风阻+湍流 */
  feather(fx: number, fy: number, count = 5): void {
    for (let i = 0; i < count; i++) {
      if (ftN >= MAX_FT) return;
      const idx = ftN;
      ftx[idx]   = fx + rand(-4, 4);
      fty[idx]   = fy + rand(-4, 4);
      ftvx[idx]  = rand(-0.8, 0.8);
      ftvy[idx]  = rand(-0.5, 0.5);
      ftrot[idx] = rand(0, TAU);
      ftvr[idx]  = rand(-0.05, 0.05);
      ftlf[idx]  = randi(80, 140);
      ftmx[idx]  = ftlf[idx];
      ftsz[idx]  = rand(3, 6);
      ftN++;
    }
  }

  /** 彩带喷射:五色纸屑从 (x,y) 向世界上方喷射,重力下落 */
  confetti(cx: number, cy: number): void {
    const colors = [COL_GOLD, COL_RED, COL_CBLUE, COL_WHITE, COL_CGREEN];
    for (let i = 0; i < 60; i++) {
      if (cfN >= MAX_CF) return;
      const idx = cfN;
      cfx[idx]   = cx + rand(-60, 60);
      cfy[idx]   = cy + rand(-20, 20);
      cfvx[idx]  = rand(-3, 3);
      cfvy[idx]  = rand(-8, -3);   // 负值 = 世界坐标向上
      cfrot[idx] = rand(0, TAU);
      cfvr[idx]  = rand(-0.2, 0.2);
      cfw[idx]   = rand(4, 9);
      cfh[idx]   = rand(6, 14);
      cflf[idx]  = 260;
      cfmx[idx]  = 260;
      cfcol[idx] = colors[i % 5];
      cfN++;
    }
  }

  // ==============================================================
  // step — 推进所有粒子系统(帧为单位,dt 保留但不使用)
  // ==============================================================
  step(_dt: number): void {
    this._stepParticles();
    this._stepRings();
    this._stepShockwaves();
    this._stepSpeedLines();
    this._stepConfetti();
    this._stepFeathers();
    this._stepMarks();
  }

  // ==============================================================
  // draw — 渲染全部特效(后到前)
  // ==============================================================
  /** 彩带层的重绘节奏(独立 cg 传入时:隔帧重绘,见 draw 内注释) */
  private cfFrame = 0;
  private cfDirty = false;
  draw(g: Graphics, vp: Viewport, cg?: Graphics): void {
    this._drawMarks(g, vp);
    this._drawShockwaves(g, vp);
    this._drawRings(g, vp);
    this._drawParticles(g, vp);
    this._drawSpeedLines(g, vp);
    // 彩带独占一层(可选参数):200 片 × 260 帧寿命的庆祝雨如果跟着动态层每帧
    // 全量重描,得分后 4 秒里每帧都是 200 笔 fill。独立 Graphics 隔帧重绘、
    // 隔帧内容原地保留(与球场三层同一手法),峰值帧省 ~100 笔;飘落是慢速
    // 运动,30fps 无感。没传 cg(预览工具单 g)时照旧画进 g。
    if (cg) {
      this.cfFrame++;
      if (cfN > 0) {
        if (this.cfFrame % 2 === 0 || !this.cfDirty) {
          cg.clear();
          this._drawConfetti(cg, vp);
          this.cfDirty = true;
        }
      } else if (this.cfDirty) {
        cg.clear();
        this.cfDirty = false;
      }
    } else {
      this._drawConfetti(g, vp);
    }
    this._drawFeathers(g, vp);
  }

  // ==============================================================
  // clear — 重置所有池
  // ==============================================================
  clear(): void {
    pN = rN = swN = slN = cfN = ftN = mkN = 0;
  }

  // ==============================================================
  // 内部 — 粒子生成
  // ==============================================================

  private _particle(
    x: number, y: number, vx: number, vy: number,
    grav: number, drag: number, life: number, max: number,
    sz: number, rot: number, vr: number, ci: number, shape: number,
  ): void {
    if (pN >= MAX_P) return;
    const i = pN;
    px[i] = x;  py[i] = y;
    pvx[i] = vx; pvy[i] = vy;
    pg[i] = grav; pdrag[i] = drag;
    plife[i] = life; pmax[i] = max;
    psz[i] = sz; prot[i] = rot; pvr[i] = vr;
    pcol[i] = ci; psh[i] = shape;
    pN++;
  }

  /** 上半扇扬尘(老 dust) */
  private _dust(dx: number, dy: number, n: number, ci: number, spread: number): void {
    for (let i = 0; i < n; i++) {
      const a = rand(-PI, 0);           // 上半扇(canvas 角度)
      const spd = rand(0.6, spread);
      this._particle(dx, dy,
        cos(a) * spd, sin(a) * spd * 0.8,
        0.06, 0.94, randi(18, 34), 34,
        rand(1.5, 3.5), 0, 0, ci, SH_SQUARE);
    }
  }

  /** 全方向爆散(老 burst) */
  private _burst(bx: number, by: number, n: number, ci: number, speed: number, life: number): void {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const spd = rand(speed * 0.35, speed);
      this._particle(bx, by,
        cos(a) * spd, sin(a) * spd,
        0.10, 0.90, randi(Math.round(life * 0.6), life), life,
        rand(1.5, 3.2), 0, 0, ci, SH_SQUARE);
    }
  }

  /** 静止星芒闪光(老 sparkle) */
  private _sparkle(sx: number, sy: number, ci: number, size: number, life: number): void {
    const s = size * (C.fx.sparkleScale ?? 1);
    this._particle(sx, sy, 0, 0, 0, 1, life, life, s, rand(0, PI / 4), 0, ci, SH_STAR);
  }

  /**
   * 扩散环(老 ring)。目标半径统一乘 fx.ringScale —— 见该键注释。
   * jag = true(P5 缺省):出生时用 mulberry32 定形一颗爆裂锯齿环 ——
   * 尖刺数/深度/抖动全部进 config,同一种子终身同形,逐帧只扩张不重掷。
   * 平滑椭圆保留给引力/时空两技能(圆=场控,尖=打击)。
   */
  private _ring(
    rrx: number, rry: number, r0: number, r1: number,
    max: number, w: number, ci: number, flat: boolean, jag = true,
  ): void {
    if (rN >= MAX_R) return;
    const i = rN;
    const k = C.fx.ringScale ?? 1;
    rx[i] = rrx; ry[i] = rry;
    rr[i] = r0 * k; rr0[i] = r0 * k; rr1[i] = r1 * k;
    rlf[i] = 0; rmx[i] = max;
    rw[i] = w; rcol[i] = ci;
    rflat[i] = flat ? 1 : 0;
    rjag[i] = jag ? 1 : 0;
    if (jag) {
      const F = C.fx;
      rcnt[i] = fillSpikes(rvert, i * SPIKE_VERTS, randi(1, 2147483647),
        F.ringSpikesMin ?? 7, F.ringSpikesMax ?? 11,
        F.ringSpikeInK ?? 0.7, F.ringJagK ?? 0.18);
      rrot[i] = rand(0, TAU);
    }
    rN++;
  }

  /** 冲击波(老 shockwave)。jag = true 的主波走 P5 锯齿,次波保持平滑椭圆 */
  private _shockwave(
    sx: number, sy: number, r0: number, maxR: number,
    speed: number, life: number, w: number, ci: number, delay: number, jag = false,
  ): void {
    if (swN >= MAX_SW) return;
    const i = swN;
    swx[i] = sx; swy[i] = sy;
    swr[i] = r0; swmr[i] = maxR;
    swspd[i] = speed;
    swlf[i] = life; swmx[i] = life;
    sww[i] = w; swcol[i] = ci;
    swdl[i] = delay;
    swjag[i] = jag ? 1 : 0;
    if (jag) {
      const F = C.fx;
      swcnt[i] = fillSpikes(swvert, i * SPIKE_VERTS, randi(1, 2147483647),
        F.ringSpikesMin ?? 7, F.ringSpikesMax ?? 11,
        F.ringSpikeInK ?? 0.7, F.ringJagK ?? 0.18);
      swrot[i] = rand(0, TAU);
    }
    swN++;
  }

  /**
   * 速度线(老 speedLines)。
   * 老写法是"从落点向四周均匀放射",跟球实际怎么飞的没关系 —— 重扣明明是斜着砸下来,
   * 四周却同时出现一圈放射线,读起来像爆炸而不像"快"。
   * 现在按传入的 `bias`(出球方向)把 `fx.speedLineBias` 比例的线收到那条轴带附近,
   * 其余仍散布四周保住"全场一紧"的氛围。
   */
  private _speedLines(cx: number, cy: number, intensity: number, bias?: number): void {
    const F = C.fx;
    const n = Math.round((F.speedLineCount || 30) * intensity);
    const life = F.speedLineLife || 8;
    const biasK = F.speedLineBias ?? 0.72;
    const reach = F.speedLineReach ?? 0.5;      // 老值 150~320 会横穿半屏,统一收短
    const hasBias = bias !== undefined && Number.isFinite(bias);
    for (let i = 0; i < n; i++) {
      if (slN >= MAX_SL) return;
      // biased:贴着出球反方向的窄带(线往击球点收 = 球"撞"进来的读感)
      const inBand = hasBias && i < n * biasK;
      const a = inBand
        ? (bias as number) + PI + rand(-0.42, 0.42)
        : rand(0, TAU);
      const startD = (inBand ? rand(170, 360) : rand(150, 320)) * reach;
      const endD   = rand(20, 60) * reach;
      const idx = slN;
      slx1[idx] = cx + cos(a) * startD;
      sly1[idx] = cy + sin(a) * startD;
      slx2[idx] = cx + cos(a) * endD;
      sly2[idx] = cy + sin(a) * endD;
      sllf[idx] = life;
      slmx[idx] = life;
      slcol[idx] = i % 3 === 0 ? COL_GOLD : COL_WHITE;
      slN++;
    }
  }

  /** 方向火花扇(老 directionalSparks):划线 + 星芒 */
  private _dirSparks(hx: number, hy: number, angle: number, intensity: number): void {
    const baseAng = angle;
    const spread  = C.fx.sparkFanSpread || 0.8;
    const count   = Math.round((C.fx.sparkFanCount || 12) * intensity);
    const speed   = (C.fx.sparkFanSpeed || 18) * intensity;

    // 划线粒子
    for (let i = 0; i < count; i++) {
      const a = baseAng + rand(-spread, spread);
      const spd = rand(speed * 0.5, speed);
      const ci = i % 3 === 0 ? COL_GOLD : COL_WHITE;
      this._particle(hx, hy,
        cos(a) * spd, sin(a) * spd,
        0.04, 0.96, randi(8, 14), 14,
        2.2, 0, 0, ci, SH_STREAK);
    }

    // 3 颗星芒(紧贴方向)
    for (let i = 0; i < 3; i++) {
      const a = baseAng + rand(-0.15, 0.15);
      const spd = rand(speed * 0.8, speed * 1.2);
      this._particle(hx, hy,
        cos(a) * spd, sin(a) * spd,
        0, 0.98, 10, 10,
        6, rand(0, PI / 4), 0, COL_GOLD, SH_STAR);
    }
  }

  /** 落点标记 */
  private _mark(mx: number, out: boolean): void {
    if (mkN >= MAX_MK) return;
    const i = mkN;
    mkx[i] = mx;
    mklf[i] = C.fx.markerLife || 70;
    mkmx[i] = C.fx.markerLife || 70;
    mkout[i] = out ? 1 : 0;
    mkN++;
  }

  // ==============================================================
  // 内部 — step 更新
  // ==============================================================

  private _stepParticles(): void {
    for (let i = pN - 1; i >= 0; i--) {
      px[i] += pvx[i];
      py[i] += pvy[i];
      pvy[i] += pg[i];
      pvx[i] *= pdrag[i];
      pvy[i] *= pdrag[i];
      if (pvr[i] !== 0) prot[i] += pvr[i];
      plife[i]--;
      if (plife[i] <= 0 || py[i] > C.world.h + 40) {
        this._popParticle(i);
      }
    }
  }

  private _stepRings(): void {
    const easeK = C.fx.ringEaseK ?? 0.42;
    for (let i = rN - 1; i >= 0; i--) {
      rlf[i]++;
      // 冲击环的形状规律:先"炸"出去、再慢下来。老写法是 lerp 固定 0.28 一步到位,
      // 于是每一道环都是同一种匀速膨胀,层与层之间读不出先后。
      const t = rlf[i] / rmx[i];
      const u = Math.pow(clamp(t, 0, 1), easeK);
      rr[i] = rr0[i] + (rr1[i] - rr0[i]) * easeOutQuart(u);
      if (rlf[i] >= rmx[i]) {
        this._popRing(i);
      }
    }
  }

  private _stepShockwaves(): void {
    for (let i = swN - 1; i >= 0; i--) {
      if (swdl[i] > 0) { swdl[i]--; continue; }
      swr[i] += swspd[i];
      swspd[i] *= 0.94;
      swlf[i]--;
      if (swlf[i] <= 0) {
        this._popShockwave(i);
      }
    }
  }

  private _stepSpeedLines(): void {
    for (let i = slN - 1; i >= 0; i--) {
      sllf[i]--;
      if (sllf[i] <= 0) {
        this._popSpeedLine(i);
      }
    }
  }

  private _stepConfetti(): void {
    for (let i = cfN - 1; i >= 0; i--) {
      cfx[i] += cfvx[i];
      cfy[i] += cfvy[i];
      cfvy[i] += 0.02;           // 重力
      cfrot[i] += cfvr[i];
      cflf[i]--;
      if (cflf[i] <= 0 || cfy[i] > C.world.h + 20) {
        this._popConfetti(i);
      }
    }
  }

  private _stepFeathers(): void {
    for (let i = ftN - 1; i >= 0; i--) {
      ftx[i] += ftvx[i];
      fty[i] += ftvy[i];
      ftvy[i] += 0.04;           // 轻重力
      ftvx[i] *= 0.98;           // 空气阻力
      ftvy[i] *= 0.98;
      ftvx[i] += rand(-0.02, 0.02); // 风湍流
      ftrot[i] += ftvr[i];
      ftlf[i]--;
      if (ftlf[i] <= 0 || fty[i] > C.world.h + 40) {
        this._popFeather(i);
      }
    }
  }

  private _stepMarks(): void {
    for (let i = mkN - 1; i >= 0; i--) {
      mklf[i]--;
      if (mklf[i] <= 0) {
        this._popMark(i);
      }
    }
  }

  // ==============================================================
  // 内部 — swap-and-pop 删除
  // ==============================================================

  private _popParticle(i: number): void {
    const last = pN - 1;
    if (i !== last) {
      px[i]=px[last]; py[i]=py[last]; pvx[i]=pvx[last]; pvy[i]=pvy[last];
      pg[i]=pg[last]; pdrag[i]=pdrag[last]; plife[i]=plife[last]; pmax[i]=pmax[last];
      psz[i]=psz[last]; prot[i]=prot[last]; pvr[i]=pvr[last];
      pcol[i]=pcol[last]; psh[i]=psh[last];
    }
    pN--;
  }

  private _popRing(i: number): void {
    const last = rN - 1;
    if (i !== last) {
      rx[i]=rx[last]; ry[i]=ry[last]; rr[i]=rr[last]; rr0[i]=rr0[last]; rr1[i]=rr1[last];
      rlf[i]=rlf[last]; rmx[i]=rmx[last]; rw[i]=rw[last];
      rcol[i]=rcol[last]; rflat[i]=rflat[last];
      rjag[i]=rjag[last]; rcnt[i]=rcnt[last]; rrot[i]=rrot[last];
      for (let v = 0; v < SPIKE_VERTS; v++) rvert[i * SPIKE_VERTS + v] = rvert[last * SPIKE_VERTS + v];
    }
    rN--;
  }

  private _popShockwave(i: number): void {
    const last = swN - 1;
    if (i !== last) {
      swx[i]=swx[last]; swy[i]=swy[last]; swr[i]=swr[last]; swmr[i]=swmr[last];
      swspd[i]=swspd[last]; swlf[i]=swlf[last]; swmx[i]=swmx[last];
      sww[i]=sww[last]; swcol[i]=swcol[last]; swdl[i]=swdl[last];
      swjag[i]=swjag[last]; swcnt[i]=swcnt[last]; swrot[i]=swrot[last];
      for (let v = 0; v < SPIKE_VERTS; v++) swvert[i * SPIKE_VERTS + v] = swvert[last * SPIKE_VERTS + v];
    }
    swN--;
  }

  private _popSpeedLine(i: number): void {
    const last = slN - 1;
    if (i !== last) {
      slx1[i]=slx1[last]; sly1[i]=sly1[last];
      slx2[i]=slx2[last]; sly2[i]=sly2[last];
      sllf[i]=sllf[last]; slmx[i]=slmx[last]; slcol[i]=slcol[last];
    }
    slN--;
  }

  private _popConfetti(i: number): void {
    const last = cfN - 1;
    if (i !== last) {
      cfx[i]=cfx[last]; cfy[i]=cfy[last]; cfvx[i]=cfvx[last]; cfvy[i]=cfvy[last];
      cfrot[i]=cfrot[last]; cfvr[i]=cfvr[last]; cfw[i]=cfw[last]; cfh[i]=cfh[last];
      cflf[i]=cflf[last]; cfmx[i]=cfmx[last]; cfcol[i]=cfcol[last];
    }
    cfN--;
  }

  private _popFeather(i: number): void {
    const last = ftN - 1;
    if (i !== last) {
      ftx[i]=ftx[last]; fty[i]=fty[last]; ftvx[i]=ftvx[last]; ftvy[i]=ftvy[last];
      ftrot[i]=ftrot[last]; ftvr[i]=ftvr[last];
      ftlf[i]=ftlf[last]; ftmx[i]=ftmx[last]; ftsz[i]=ftsz[last];
    }
    ftN--;
  }

  private _popMark(i: number): void {
    const last = mkN - 1;
    if (i !== last) {
      mkx[i]=mkx[last]; mklf[i]=mklf[last]; mkmx[i]=mkmx[last]; mkout[i]=mkout[last];
    }
    mkN--;
  }

  // ==============================================================
  // 内部 — 渲染
  // ==============================================================

  // ---------- 落点标记 ----------
  private _drawMarks(g: Graphics, vp: Viewport): void {
    const F = C.fx;
    const gy = CO.groundY + 2;
    for (let i = 0; i < mkN; i++) {
      const a = easeOutCubic(mklf[i] / mkmx[i]);
      const alpha = a * 0.8;
      const ci = mkout[i] ? COL_RED : COL_WHITE;
      // P5 落点准星:四向尖刺臂 + 中心菱形(压扁贴地),臂长随寿命微收
      const len = (F.markCrossLen ?? 20) * (1.25 - a * 0.25);
      drawCrossMark(g, vp.x(mkx[i]), vp.y(gy), len, F.markCrossW ?? 2.2, 0.32,
        CLUT[ci], alpha);
    }
  }

  // ---------- 冲击波 ----------
  private _drawShockwaves(g: Graphics, vp: Viewport): void {
    for (let i = 0; i < swN; i++) {
      if (swdl[i] > 0) continue;
      const a = easeOutCubic(swlf[i] / swmx[i]);
      const vx = vp.x(swx[i]);
      const vy = vp.y(swy[i]);
      const r = swr[i];

      if (swjag[i]) {
        // 主波:P5 爆裂锯齿(扁平贴地),双 pass 同 _drawRings 的晕+芯语义
        drawSpikeRing(g, vx, vy, r, 0.3, swvert, i * SPIKE_VERTS, swcnt[i], swrot[i],
          CLUT[swcol[i]], a * 0.8, sww[i] * 0.8, 2.8, 0.24);
        // 地面辉光垫底
        g.fillColor = withAlpha(CLUT[swcol[i]], a * 0.12);
        g.ellipse(vx, vy, r, r * 0.3);
        g.fill();
        continue;
      }

      const ry = r * 0.3;

      // 描边:alpha = a * 0.7, lineWidth 随寿命收缩
      g.strokeColor = withAlpha(CLUT[swcol[i]], a * 0.7);
      g.lineWidth = sww[i] * a;
      g.ellipse(vx, vy, r, ry);
      g.stroke();

      // 填充:地面辉光 alpha = a * 0.12
      g.fillColor = withAlpha(CLUT[swcol[i]], a * 0.12);
      g.ellipse(vx, vy, r, ry);
      g.fill();
    }
  }

  // ---------- 扩散环 ----------
  /**
   * 双道同半径描边:宽而暗的一道当晕 + 窄而亮的一道当芯(sprites.glowStroke 的同款
   * 辉光近似 —— Cocos 2D 没有 additive/blur)。alpha 走 easeOutCubic:
   * 单环硬边读起来像"画了个圈",有晕才像"炸开了一下"。
   * P5 化:打击类环默认走爆裂锯齿多边形(drawSpikeRing,形状出生定死),
   * 椭圆环保留给引力/时空(singularity/timeRupture 显式传 jag=false)。
   */
  private _drawRings(g: Graphics, vp: Viewport): void {
    const F = C.fx;
    const haloK = F.ringHaloK ?? 2.8;
    const haloA = F.ringHaloA ?? 0.24;
    for (let i = 0; i < rN; i++) {
      const t = rlf[i] / rmx[i];
      const a = easeOutCubic(1 - t) * 0.9;
      const vx = vp.x(rx[i]);
      const vy = vp.y(ry[i]);
      const r = rr[i];
      if (rjag[i]) {
        const yK = rflat[i] ? 0.32 : 1;
        drawSpikeRing(g, vx, vy, r, yK, rvert, i * SPIKE_VERTS, rcnt[i], rrot[i],
          CLUT[rcol[i]], a, rw[i], haloK, haloA);
        continue;
      }
      const rY = rflat[i] ? r * 0.32 : r;
      g.lineWidth = rw[i] * haloK * (0.35 + 0.65 * (1 - t));
      g.strokeColor = withAlpha(CLUT[rcol[i]], a * haloA);
      g.ellipse(vx, vy, r, rY);
      g.stroke();
      g.lineWidth = Math.max(0.6, rw[i] * (0.45 + 0.55 * (1 - t)));
      g.strokeColor = withAlpha(CLUT[rcol[i]], a);
      g.ellipse(vx, vy, r, rY);
      g.stroke();
    }
  }

  // ---------- 粒子(方块/星芒/划线) ----------
  /**
   * 粒子成形(分级炫技 P2)。
   * 老实现:每个粒子都是一个**轴对齐的 g.rect 方块**,prot(旋转量)存了却从没用过,
   * 划线更是无视自己的速度方向、永远画成 2px 的水平条 —— 一堆正方形飘在屏幕上,
   * 就是"简单粗暴"最直观的样子。现在:
   *  * 全部按真实运动方向拉成菱形/柳叶形(blade),快的粒子更长,慢下来的自然收圆;
   *  * alpha 走 ease-out 幂曲线(前段亮、尾段散),尺寸随寿命收缩,不再"啪地消失";
   *  * 星芒加一层低透明辉光底,近似 shadowBlur 的那点柔边。
   */
  private _drawParticles(g: Graphics, vp: Viewport): void {
    const F = C.fx;
    const fadeK = F.partFadeK ?? 1.55;
    const shrink = F.partShrink ?? 0.45;
    const lenK = F.streakLenK ?? 1.7;
    const taper = F.streakTaper ?? 0.28;
    for (let i = 0; i < pN; i++) {
      const raw = plife[i] / pmax[i];
      const a = fadePow(raw, fadeK);
      const ci = pcol[i];
      const shape = psh[i];
      const spd = hypot(pvx[i], pvy[i]);

      if (shape === SH_STAR) {
        // 星芒:脉动尺寸 + 辉光底
        const sz = psz[i] * (0.4 + 0.6 * sin(a * PI));
        this._drawGlow(g, vp, px[i], py[i], sz * 0.9, CLUT[ci], a * 0.18);
        this._drawStar(g, vp, px[i], py[i], sz, prot[i], CLUT[ci], a);
      } else if (shape === SH_STREAK) {
        // 划线:沿**真实速度方向**的柳叶形(头宽尾尖),不再是无视角度的水平条
        const ang = spd > 0.01 ? atan2(pvy[i], pvx[i]) : prot[i];
        const len = Math.max(1.2, spd * lenK) * (shrink + (1 - shrink) * raw);
        const hw = psz[i] * 0.5 * (taper + (1 - taper) * raw);
        this._blade(g, vp, px[i], py[i], ang, len, hw, hw * taper, CLUT[ci], a);
      } else {
        // 方块 → 沿速度拉长的菱形;几乎不动的(扬尘)就保持小方片
        const sz = psz[i] * (shrink + (1 - shrink) * raw);
        const ang = spd > 0.05 ? atan2(pvy[i], pvx[i]) : prot[i];
        const stretch = 1 + clamp(spd * 0.16, 0, 2.2);
        this._blade(g, vp, px[i], py[i], ang, sz * stretch, sz * 0.5, sz * 0.3, CLUT[ci], a);
      }
    }
  }

  /**
   * 一片"刀形"粒子:中心 (cx,cy),沿 ang 方向长 len,头半宽 wHead、尾半宽 wTail。
   * Cocos 的 Graphics 没有 rotate,四角在局部算完再逐个过 Viewport(同彩带/羽毛的做法)。
   */
  private _blade(g: Graphics, vp: Viewport, cx: number, cy: number,
    ang: number, len: number, wHead: number, wTail: number, color: Color, alpha: number): void {
    if (alpha <= 0.006 || len < 0.4) return;
    const c = cos(ang), s = sin(ang);
    const hx = cx + c * len * 0.5, hy = cy + s * len * 0.5;     // 头(顺风侧)
    const tx = cx - c * len * 0.5, ty = cy - s * len * 0.5;     // 尾
    // 法向(-s, c)
    g.fillColor = withAlpha(color, alpha);
    g.moveTo(vp.x(hx - s * wHead), vp.y(hy + c * wHead));
    g.lineTo(vp.x(cx - s * wHead * 0.6), vp.y(cy + c * wHead * 0.6));
    g.lineTo(vp.x(tx - s * wTail), vp.y(ty + c * wTail));
    g.lineTo(vp.x(tx + s * wTail), vp.y(ty - c * wTail));
    g.lineTo(vp.x(cx + s * wHead * 0.6), vp.y(cy - c * wHead * 0.6));
    g.lineTo(vp.x(hx + s * wHead), vp.y(hy - c * wHead));
    g.close();
    g.fill();
  }

  /** 极软的辉光底:两层同心圆(近似 shadowBlur;只在星芒上花这点钱) */
  private _drawGlow(g: Graphics, vp: Viewport, cx: number, cy: number, r: number,
    color: Color, alpha: number): void {
    if (alpha <= 0.006 || r < 0.6) return;
    const x = vp.x(cx), y = vp.y(cy);
    g.fillColor = withAlpha(color, alpha * 0.5);
    g.circle(x, y, r * 1.7); g.fill();
    g.fillColor = withAlpha(color, alpha);
    g.circle(x, y, r); g.fill();
  }

  /** 星芒:4 个 quadraticCurveTo 经中心到旋转顶点 */
  private _drawStar(
    g: Graphics, vp: Viewport,
    cx: number, cy: number, sz: number, rot: number,
    color: Color, alpha: number,
  ): void {
    if (sz < 0.5) return;
    const cosR = cos(rot);
    const sinR = sin(rot);
    // 4 个顶点(旋转后)
    const t0x = cx + cosR * sz,       t0y = cy + sinR * sz;
    const t1x = cx + (-sinR) * sz,    t1y = cy + cosR * sz;
    const t2x = cx + (-cosR) * sz,    t2y = cy + (-sinR) * sz;
    const t3x = cx + sinR * sz,       t3y = cy + (-cosR) * sz;
    // 中心
    const ccx = vp.x(cx), ccy = vp.y(cy);

    g.fillColor = withAlpha(color, alpha);
    g.moveTo(vp.x(t0x), vp.y(t0y));
    g.quadraticCurveTo(ccx, ccy, vp.x(t1x), vp.y(t1y));
    g.quadraticCurveTo(ccx, ccy, vp.x(t2x), vp.y(t2y));
    g.quadraticCurveTo(ccx, ccy, vp.x(t3x), vp.y(t3y));
    g.quadraticCurveTo(ccx, ccy, vp.x(t0x), vp.y(t0y));
    g.fill();
  }

  // ---------- 速度线 ----------
  /**
   * 速度线收带:线自己往击球点冲(endD 一侧),而不是原地一条静止的线段;
   * 宽度与 alpha 一起按 ease-out 收,最后一帧不会"啪"地断掉。
   */
  private _drawSpeedLines(g: Graphics, vp: Viewport): void {
    const F = C.fx;
    const baseW = (F.speedLineWidth ?? 2.2) * (F.speedLineHeadK ?? 3);
    for (let i = 0; i < slN; i++) {
      const raw = sllf[i] / slmx[i];
      const a = easeOutCubic(raw) * 0.66;
      if (a <= 0.006) continue;
      const t = (1 - raw) * 0.55;                       // 外端向内收 55%
      const x1 = slx1[i] + (slx2[i] - slx1[i]) * t;
      const y1 = sly1[i] + (sly2[i] - sly1[i]) * t;
      // 漫画集中线:头粗尾尖的锥形填充取代圆帽线段 —— 尖端扎向击球点
      drawTaper(g, vp.x(x1), vp.y(y1), vp.x(slx2[i]), vp.y(sly2[i]),
        Math.max(0.6, baseW * raw), CLUT[slcol[i]], a);
    }
  }

  // ---------- 彩带 ----------
  private _drawConfetti(g: Graphics, vp: Viewport): void {
    for (let i = 0; i < cfN; i++) {
      const a = Math.min(1, cflf[i] / 60);
      const w = cfw[i], h = cfh[i];
      const hw = w * 0.5, hh = h * 0.5;
      const cosR = cos(cfrot[i]);
      const sinR = sin(cfrot[i]);
      const cx = cfx[i], cy = cfy[i];

      // 4 角旋转后的世界坐标
      const corners_x = [
        -hw * cosR - (-hh) * sinR,
         hw * cosR - (-hh) * sinR,
         hw * cosR - ( hh) * sinR,
        -hw * cosR - ( hh) * sinR,
      ];
      const corners_y = [
        -hw * sinR + (-hh) * cosR,
         hw * sinR + (-hh) * cosR,
         hw * sinR + ( hh) * cosR,
        -hw * sinR + ( hh) * cosR,
      ];

      g.fillColor = withAlpha(CLUT[cfcol[i]], a);
      g.moveTo(vp.x(cx + corners_x[0]), vp.y(cy + corners_y[0]));
      g.lineTo(vp.x(cx + corners_x[1]), vp.y(cy + corners_y[1]));
      g.lineTo(vp.x(cx + corners_x[2]), vp.y(cy + corners_y[2]));
      g.lineTo(vp.x(cx + corners_x[3]), vp.y(cy + corners_y[3]));
      g.close();
      g.fill();
    }
  }

  // ---------- 羽毛 ----------
  private _drawFeathers(g: Graphics, vp: Viewport): void {
    for (let i = 0; i < ftN; i++) {
      const a = ftlf[i] / ftmx[i];
      const sz = ftsz[i];
      const cosR = cos(ftrot[i]);
      const sinR = sin(ftrot[i]);
      const cx = ftx[i], cy = fty[i];

      // 细长菱形:长轴 = sz*2.5, 短轴 = sz*0.6
      const hl = sz * 2.5;   // half-length
      const hw = sz * 0.6;   // half-width

      // 4 个关键点的局部坐标(沿旋转方向)
      // tip0 = (hl, 0), tip1 = (0, hw), tip2 = (-hl, 0), tip3 = (0, -hw)
      const t0lx = hl * cosR,            t0ly = hl * sinR;
      const t1lx = -hw * sinR,           t1ly = hw * cosR;
      const t2lx = -hl * cosR,           t2ly = -hl * sinR;
      const t3lx = hw * sinR,            t3ly = -hw * cosR;

      g.fillColor = withAlpha(CLUT[COL_WHITE], a * 0.85);
      g.moveTo(vp.x(cx + t0lx), vp.y(cy + t0ly));
      g.lineTo(vp.x(cx + t1lx), vp.y(cy + t1ly));
      g.lineTo(vp.x(cx + t2lx), vp.y(cy + t2ly));
      g.lineTo(vp.x(cx + t3lx), vp.y(cy + t3ly));
      g.close();
      g.fill();
    }
  }
}
