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
import { TAU, rand, randi, lerp } from "../core/utils";
import { withAlpha } from "./palette";

const C = CFG;
const CO = C.court;
const PI = Math.PI;
const { sin, cos } = Math;

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

const CLUT: Color[] = [
  new Color(255, 255, 255, 255),  // 0 white
  new Color(255, 225,  77, 255),  // 1 gold  #ffe14d
  new Color(  0, 240, 255, 255),  // 2 cyan  #00f0ff
  new Color(255, 106,  31, 255),  // 3 orange #ff6a1f
  new Color(255,  77,  77, 255),  // 4 red   #ff4d4d
  new Color(216, 255, 176, 255),  // 5 green #d8ffb0
  new Color(125, 255, 158, 255),  // 6 cgreen #7dff9e
  new Color( 62, 168, 255, 255),  // 7 cblue  #3ea8ff
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
const rr1  = new Float32Array(MAX_R);   // 目标半径
const rlf  = new Int32Array(MAX_R);     // life(递增)
const rmx  = new Int32Array(MAX_R);     // max
const rw   = new Float32Array(MAX_R);   // lineWidth
const rcol = new Uint8Array(MAX_R);
const rflat = new Uint8Array(MAX_R);    // 1 = 扁椭圆
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

  /** 扣杀冲击波:星芒 + 扩散环 + 爆散 + 定向划线 + 速度线 + 火花扇 */
  smash(hx: number, hy: number, angle: number): void {
    const dir = cos(angle) >= 0 ? 1 : -1;

    // 1) 3 颗星芒(sparkle):白/金/青,静止脉动
    this._sparkle(hx, hy, COL_WHITE, 34, 20);
    this._sparkle(hx, hy, COL_GOLD,  50, 24);
    this._sparkle(hx, hy, COL_CYAN,  40, 18);

    // 2) 4 道扩散环
    this._ring(hx, hy, 8,  110, 20, 5,   COL_WHITE,  false);
    this._ring(hx, hy, 16, 160, 26, 4,   COL_GOLD,   false);
    this._ring(hx, hy, 24, 200, 32, 3,   COL_CYAN,   false);
    this._ring(hx, hy, 30, 230, 36, 2.5, COL_ORANGE,  false);

    // 3) 4 组爆散粒子
    this._burst(hx, hy, 44, COL_GOLD,   12, 34);
    this._burst(hx, hy, 26, COL_WHITE,  14, 26);
    this._burst(hx, hy, 22, COL_CYAN,    9, 30);
    this._burst(hx, hy, 18, COL_ORANGE,  8, 28);

    // 4) 20 条定向划线(沿 angle 扇形展开)
    for (let i = 0; i < 20; i++) {
      const a = angle + (i / 20 - 0.5) * 1.1;
      const spd = rand(18, 30);
      const ci = i % 3 === 0 ? COL_CYAN : i % 3 === 1 ? COL_GOLD : COL_WHITE;
      this._particle(hx, hy, cos(a) * dir * spd, sin(a) * rand(9, 20),
        0.03, 0.98, 18, 18, 3, 0, 0, ci, SH_STREAK);
    }

    // 5) 速度线
    this._speedLines(hx, hy, 1.0);

    // 6) 方向火花扇
    this._dirSparks(hx, hy, angle, 1.5);
  }

  /** 甜区光晕:星芒 + 环 + 爆散 + 划线(无速度线/火花扇) */
  sweet(sx: number, sy: number): void {
    // 2 颗星芒
    this._sparkle(sx, sy, COL_WHITE, 20, 15);
    this._sparkle(sx, sy, COL_GOLD,  32, 18);

    // 2 道环
    this._ring(sx, sy, 4, 52, 16, 3.5, COL_WHITE, false);
    this._ring(sx, sy, 8, 82, 22, 2.5, COL_GOLD,  false);

    // 3 组爆散
    this._burst(sx, sy, 24, COL_GOLD,  8, 24);
    this._burst(sx, sy, 16, COL_WHITE, 10, 18);
    this._burst(sx, sy, 10, COL_CYAN,   6, 20);

    // 10 条定向划线(较窄扇形)
    for (let i = 0; i < 10; i++) {
      const a = (i / 10 - 0.5) * 0.8;
      const spd = rand(12, 20);
      const ci = i % 2 === 0 ? COL_WHITE : COL_GOLD;
      this._particle(sx, sy, cos(a) * spd, sin(a) * rand(4, 11),
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
    this._shockwave(lx, ly, 6, maxR, speed, life, 6, COL_ORANGE, 0);
    this._shockwave(lx, ly, 4, maxR * 0.7, speed * 0.8, life - 4, 4, COL_WHITE, 3);
  }

  /** 普通击球接触小火花:一小撮白金粒子,让平抽/高远的对拉每拍都有「打到了」的手感 */
  miniSpark(hx: number, hy: number): void {
    for (let i = 0; i < 6; i++) {
      const a = rand(0, TAU);
      const spd = rand(2.5, 7);
      this._particle(hx, hy, cos(a) * spd, sin(a) * spd,
        0.08, 0.92, randi(7, 12), 12,
        rand(1.2, 2.2), 0, 0, i < 2 ? COL_GOLD : COL_WHITE, SH_SQUARE);
    }
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
  draw(g: Graphics, vp: Viewport): void {
    this._drawMarks(g, vp);
    this._drawShockwaves(g, vp);
    this._drawRings(g, vp);
    this._drawParticles(g, vp);
    this._drawSpeedLines(g, vp);
    this._drawConfetti(g, vp);
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
    this._particle(sx, sy, 0, 0, 0, 1, life, life, size, rand(0, PI / 4), 0, ci, SH_STAR);
  }

  /** 扩散环(老 ring) */
  private _ring(
    rrx: number, rry: number, r0: number, r1: number,
    max: number, w: number, ci: number, flat: boolean,
  ): void {
    if (rN >= MAX_R) return;
    const i = rN;
    rx[i] = rrx; ry[i] = rry;
    rr[i] = r0; rr1[i] = r1;
    rlf[i] = 0; rmx[i] = max;
    rw[i] = w; rcol[i] = ci;
    rflat[i] = flat ? 1 : 0;
    rN++;
  }

  /** 冲击波(老 shockwave) */
  private _shockwave(
    sx: number, sy: number, r0: number, maxR: number,
    speed: number, life: number, w: number, ci: number, delay: number,
  ): void {
    if (swN >= MAX_SW) return;
    const i = swN;
    swx[i] = sx; swy[i] = sy;
    swr[i] = r0; swmr[i] = maxR;
    swspd[i] = speed;
    swlf[i] = life; swmx[i] = life;
    sww[i] = w; swcol[i] = ci;
    swdl[i] = delay;
    swN++;
  }

  /** 速度线(老 speedLines) */
  private _speedLines(cx: number, cy: number, intensity: number): void {
    const n = Math.round((C.fx.speedLineCount || 30) * intensity);
    const life = C.fx.speedLineLife || 8;
    for (let i = 0; i < n; i++) {
      if (slN >= MAX_SL) return;
      const a = rand(0, TAU);
      const startD = rand(150, 320);
      const endD   = rand(20, 60);
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
    for (let i = rN - 1; i >= 0; i--) {
      rlf[i]++;
      rr[i] = lerp(rr[i], rr1[i], 0.28);
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
      rx[i]=rx[last]; ry[i]=ry[last]; rr[i]=rr[last]; rr1[i]=rr1[last];
      rlf[i]=rlf[last]; rmx[i]=rmx[last]; rw[i]=rw[last];
      rcol[i]=rcol[last]; rflat[i]=rflat[last];
    }
    rN--;
  }

  private _popShockwave(i: number): void {
    const last = swN - 1;
    if (i !== last) {
      swx[i]=swx[last]; swy[i]=swy[last]; swr[i]=swr[last]; swmr[i]=swmr[last];
      swspd[i]=swspd[last]; swlf[i]=swlf[last]; swmx[i]=swmx[last];
      sww[i]=sww[last]; swcol[i]=swcol[last]; swdl[i]=swdl[last];
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
    const gy = CO.groundY + 2;
    for (let i = 0; i < mkN; i++) {
      const a = mklf[i] / mkmx[i];
      const alpha = a * 0.8;
      const ci = mkout[i] ? COL_RED : COL_WHITE;
      g.strokeColor = withAlpha(CLUT[ci], alpha);
      g.lineWidth = 2;
      const rx = 16 * (1.25 - a * 0.25);
      g.ellipse(vp.x(mkx[i]), vp.y(gy), rx, 5);
      g.stroke();
    }
  }

  // ---------- 冲击波 ----------
  private _drawShockwaves(g: Graphics, vp: Viewport): void {
    for (let i = 0; i < swN; i++) {
      if (swdl[i] > 0) continue;
      const a = swlf[i] / swmx[i];
      const vx = vp.x(swx[i]);
      const vy = vp.y(swy[i]);
      const r = swr[i];
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
  private _drawRings(g: Graphics, vp: Viewport): void {
    for (let i = 0; i < rN; i++) {
      const a = 1 - rlf[i] / rmx[i];   // 从亮到暗
      const alpha = a * 0.9;
      g.strokeColor = withAlpha(CLUT[rcol[i]], alpha);
      g.lineWidth = rw[i];
      const vx = vp.x(rx[i]);
      const vy = vp.y(ry[i]);
      if (rflat[i]) {
        g.ellipse(vx, vy, rr[i], rr[i] * 0.32);
      } else {
        g.circle(vx, vy, rr[i]);
      }
      g.stroke();
    }
  }

  // ---------- 粒子(方块/星芒/划线) ----------
  private _drawParticles(g: Graphics, vp: Viewport): void {
    for (let i = 0; i < pN; i++) {
      const a = plife[i] / pmax[i];
      const ci = pcol[i];
      const shape = psh[i];

      if (shape === SH_STAR) {
        // 星芒:脉动尺寸
        const sz = psz[i] * (0.4 + 0.6 * sin(a * PI));
        this._drawStar(g, vp, px[i], py[i], sz, prot[i], CLUT[ci], a);
      } else if (shape === SH_STREAK) {
        // 划线:速度反向细长矩形
        const vxP = vp.x(px[i]);
        const vyP = vp.y(py[i]);
        const len = Math.abs(pvx[i]) * 1.6;
        if (len < 0.5) continue;
        g.fillColor = withAlpha(CLUT[ci], a);
        // 在 viewport 空间, streak 向左延伸(与 vx 方向相反)
        const sx = pvx[i] >= 0 ? vxP - len : vxP;
        g.rect(sx, vyP - 1, len, 2);
        g.fill();
      } else {
        // 方块
        const sz = psz[i];
        const vxP = vp.x(px[i]);
        const vyP = vp.y(py[i]);
        g.fillColor = withAlpha(CLUT[ci], a);
        g.rect(vxP - sz * 0.5, vyP - sz * 0.5, sz, sz);
        g.fill();
      }
    }
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
  private _drawSpeedLines(g: Graphics, vp: Viewport): void {
    g.lineWidth = 1.5;
    g.lineCap = Graphics.LineCap.ROUND;
    for (let i = 0; i < slN; i++) {
      const a = (sllf[i] / slmx[i]) * 0.6;
      g.strokeColor = withAlpha(CLUT[slcol[i]], a);
      g.moveTo(vp.x(slx1[i]), vp.y(sly1[i]));
      g.lineTo(vp.x(slx2[i]), vp.y(sly2[i]));
      g.stroke();
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
