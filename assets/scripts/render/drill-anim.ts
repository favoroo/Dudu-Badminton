// ============================================================
// 训练动作引导:把「正确动作长什么样」按**实机那一条弹道**循环播 / 分步定格讲出来。
//
// 为什么不用图片/视频:项目零资源,而 Cocos Graphics 矢量绘制 + 同一套 sprites 绘制函数,
// 引导里的姿势就是游戏里那一套,皮肤换了它跟着换,永远不会和实机长得不一样。
//
// ⚠ 这一版把弹道**从自己编改成照抄实机**(0.0.21)。旧写法有两处致命糊弄:
//   ① 来球是一条手画抛物线,每关硬写一个 arcLift(60/105/70/42/35) —— 与 core/drill.ts
//      真喂出来的弧线无关,玩家照着假弧线做动作,球根本不来到那一点;
//   ② 回球用随手取的 q=0.72 从演示专用的 contactX/demoH 起算,**从不过 Drill.matches** ——
//      演示里飞出去那一拍,游戏里可能压根不算有效拍。
//   现在全部数值来自 core/drill-demo.ts 的烘焙(沿真实喂球弧线 + 本关判据搜出来的接触点),
//   并由 tools/drill-diagram-check.js 逐关钉住「演的那一拍就是判的那一拍」。
//
// 本模块**只画不算**:接触点、站位、判定区、落点带、错误对照弧线全在 core 里算完,
// 这里连一次 Math.hypot 都不参与判据。要改数字去 config.ts 的 drill 段,别在这儿加常量。
//
// 定格讲解:rig.focusStep ≥ 0 时画面停在某一步的锚帧(教学默认);focusStep = -1 是连播。
// 场上的标字必须走 Label 节点(引擎 Graphics 没有文字 API,见 sprites.ts 顶部移植约定),
// 所以本模块把「该标什么字、标在哪」作为**数据**经 `callouts()` 交出去,由 ui/drill-panel
// 摆 Label —— render 不创建节点,ui 不算几何。
//
// 坐标约定:draw 收到的 Graphics 节点本地空间原点在中心、y 向上;内部 Viewport 把世界坐标
// (canvas 惯例 960×540 y 向下)映射到该空间。callouts 给的已经是这个本地空间,ui 那边零换算。
// ============================================================
import { Graphics } from "cc";
import { CFG } from "../core/config";
import { DrillDemo } from "../core/drill-demo";
import type { DemoBake, TargetZone } from "../core/drill-demo";
import { Ball, DrillDef, Player, SkinDef } from "../core/types";
import { Player as PlayerNS } from "../core/player";
import { drawPlayer, drawShuttle, Viewport } from "./sprites";
import { clamp } from "../core/utils";
import { textW } from "../core/text-metrics";
import { pal, withAlpha } from "./palette";
import { drawTaper, drawCrossMark, drawStarburst, drawSpikeRing, fillSpikes, SPIKE_VERTS } from "./p5kit";

const C = CFG;
const CO = C.court, SW = C.swing, DEMO = C.drill.demo;

/**
 * 演示配色的唯一出处。与 ui 侧的 p5-tokens 是「同形不同源」(render 不许反向 import ui,
 * 见 AGENTS.md),所以这里是一份抄件而不是引用 —— 改色两边都要看。
 */
const INK = {
  bg: "#0c101e", floor: "#c8703a", line: "#fff3e0", net: "#e6f0ff",
  inbound: "#64d8ff",   // 来球:冷青,和场上落点预告同一支色
  ret: "#ffe14d",       // 理想回球:荧光黄 = 「这一拍算」
  alt: "#ff6b6b",       // 错误对照:斩劈红系 = 「按错会怎样」
  zone: "#7dff9e",      // 目标落点带:练球绿
  strike: "#00f0ff",    // 判定区尖刺环:和场上站位圈同一支
  ink: "#080b16", paper: "#ffffff", navy: "#182142",
} as const;

/** 相机:一格世界像素画多大。画布变宽只改缩放,构图不变 */
const VIEW_S = 0.62;

// ---------- 节拍:一记完整演示 = 真实来球 + 引拍 + 定格 + 真实回球 + 收尾 ----------
// in/out 两段**直接吃弹道的真实帧数**(烘焙里一点一模拟帧),所以 1x 播放时
// 这颗球和实机飞得一样快 —— 旧版把来球统一压成 32 帧,看熟了也跟不上真球的节奏。
export const DEMO_STEPS = 4;

export interface Timeline {
  in: number; wind: number; freeze: number; out: number; settle: number;
  /** 触球那一帧(= in + wind):第②步停在它前一刻,第③步停在它之后 */
  hit: number;
  total: number;
}

function timelineOf(b: DemoBake): Timeline {
  const B = DEMO.beats;
  const inF = clamp(b.contact.frame, B.minIn, B.maxPhase);
  const outF = clamp(b.ret.pts.length - 1, B.minOut, B.maxPhase);
  const hit = inF + B.wind;
  return { in: inF, wind: B.wind, freeze: B.freeze, out: outF, settle: B.settle, hit, total: hit + B.freeze + outF + B.settle };
}

/** 第 i 步的锚帧:停在「这一步最该看清」的那一帧上 */
export function stepFrame(tl: Timeline, i: number): number {
  switch (i) {
    case 0: return tl.in * 0.55;                      // 迎球:球飞到弧线中段
    case 1: return tl.hit - 1;                        // 就位:引拍完成、球已到眼前
    case 2: return tl.hit + tl.freeze * 0.45;         // 击球:定格与爆点还在
    default: return tl.total - tl.settle * 0.35;      // 落点:球已落地、波纹走完
  }
}

/** 连播时当前是哪一步(读数与标字跟着动画走,不再各说各话) */
export function stepOfFrame(tl: Timeline, f: number): number {
  if (f < tl.in) return 0;
  if (f < tl.hit) return 1;
  if (f < tl.hit + tl.freeze) return 2;
  return 3;
}

// ---------- 假人:跳跃递推与 Player.update 完全同一套 ----------
const JUMP = (() => {
  const out: number[] = [];
  let vy = C.player.jumpV, y = 0;
  for (let k = 0; k < 60; k++) {
    vy += C.player.gravity; y += vy;
    out.push(Math.max(0, -y));
    if (y > 0) { for (let j = k + 1; j < 60; j++) out.push(0); break; }
  }
  return out;
})();
const JUMP_APEX_FRAME = C.player.jumpApex;

/** 旧导出保留:hud-overlay 的时机条与这里同一套换算 */
export const contactFrame = (): number => SW.windup + (SW.active - 1) / 2;

// ============================================================
// Rig
// ============================================================
export interface DrillRig {
  def: DrillDef;
  /** 演示真值(来球弧 / 接触点 / 站位 / 理想回球 / 错误对照 / 落点带) */
  bake: DemoBake;
  tl: Timeline;
  p: Player;
  /** 逐帧推进的模拟时钟(帧,浮点)。连播时由 ui 那边 advance(),定格时钉在锚帧 */
  frame: number;
  /** ≥ 0 = 停在这一步;-1 = 连播 */
  focusStep: number;
  paused: boolean;
  speed: number;
  /** 锯齿环顶点出生时定形(逐帧只缩放,别逐帧 rand —— 会抖成噪点) */
  seedVerts: Float32Array;
  seedOff: number;
  seedCount: number;
}

export function build(def: DrillDef, skin: SkinDef | null): DrillRig | null {
  const bake = DrillDemo.bake(def);
  if (!bake) return null;
  const ps = C.colors.red;
  const th = skin?.main
    ? { main: skin.main, dark: skin.dark!, glow: skin.glow!, name: skin.name }
    : ps;
  const p = PlayerNS.create("left", { theme: th, jersey: "01" });
  p.x = bake.stand.x; p.y = CO.groundY - bake.stand.jumpH;
  p.swingRadius = C.swing.radiusBase;
  p.swingHit = true;
  const verts = new Float32Array(SPIKE_VERTS);
  // 出生时用 id + 接触点定形(逐帧只缩放,不逐帧 rand —— 会抖成噪点)
  const count = fillSpikes(verts, 0, def.id.length * 7919 + Math.round(bake.contact.x), 8, 11, 0.72, 0.12);
  return {
    def, bake, tl: timelineOf(bake), p,
    frame: stepFrame(timelineOf(bake), 0), focusStep: 0,
    paused: false, speed: 1,
    seedVerts: verts, seedOff: 0, seedCount: count,
  };
}

/** 停到第 i 步(-1 = 连播)。帧直接钉在锚帧上,所以暂停中点卡也立刻见效 */
export function gotoStep(rig: DrillRig, i: number): void {
  rig.focusStep = clamp(i, -1, DEMO_STEPS - 1);
  if (rig.focusStep >= 0) rig.frame = stepFrame(rig.tl, rig.focusStep);
  else rig.frame = rig.frame % rig.tl.total;
}

/** 连播推进一帧(dt 为秒,speed 是演示倍速)。定格/暂停时什么都不做 */
export function advance(rig: DrillRig, dt: number): void {
  if (rig.focusStep >= 0 || rig.paused) return;
  rig.frame = (rig.frame + dt * 60 * rig.speed) % rig.tl.total;
}

export const activeStep = (rig: DrillRig): number =>
  rig.focusStep >= 0 ? rig.focusStep : stepOfFrame(rig.tl, rig.frame % rig.tl.total);

// ============================================================
// 相机与几何
// ============================================================
/** 世界像素 → 画布像素的比例(判定区半径这类「按世界尺寸画的圆」要用它折算) */
const viewScale = (w: number): number => VIEW_S * (w / C.drill.canvas.w);

function demoVp(rig: DrillRig, w: number, h: number): Viewport {
  const s = viewScale(w);
  const camX = rig.bake.stand.x - w * 0.30 / s;
  // 地面钉在画布下方 ~16% 处:按 h 反解相机,而不是写死一个 268 ——
  // 出图脚本会把整页缩着画,写死的数一缩就把球场与落点带整片推出画外(真机看不出来)。
  const camY = CO.groundY - h * 0.84 / s;
  return {
    x: (wx: number) => (wx - camX) * s - w / 2,
    y: (wy: number) => -(wy - camY) * s + h / 2,
  };
}

/** 球在这一帧站在哪儿(世界坐标);返回 null = 还没喂出来 */
function ballAt(rig: DrillRig, f: number): { x: number; y: number } | null {
  const b = rig.bake, tl = rig.tl;
  if (f < tl.in) {
    const i = clamp(Math.floor(f), 0, b.inbound.pts.length - 1);
    return b.inbound.pts[i];
  }
  if (f < tl.hit + tl.freeze) return { x: b.contact.x, y: b.contact.y };
  const i = clamp(Math.floor(f - tl.hit - tl.freeze), 0, b.ret.pts.length - 1);
  return b.ret.pts[i];
}

// ============================================================
// 假人姿势:全部按烘焙出来的站位 / 击球点 / 是否需要起跳来摆
// ============================================================
function pose(rig: DrillRig, f: number): void {
  const p = rig.p, d = rig.def.pose || {}, b = rig.bake, tl = rig.tl;
  const stand = b.stand.x;
  const startX = d.lunge ? stand - d.lunge : stand;

  p.x = startX; p.y = CO.groundY; p.onGround = true;
  p.sq = 1; p.recoverT = 0; p.runAmt = 0; p.vx = 0; p.swingT = -1;

  // ① 迎球:最后一段路跑到位(弓步关是往网前扑,其余是退/等)
  if (f < tl.in) {
    const u = clamp((f - tl.in * (1 - DEMO.beats.runShare)) / (tl.in * DEMO.beats.runShare), 0, 1);
    p.x = startX + (stand - startX) * u;
    p.runAmt = u < 1 ? 1 : 0;
    p.vx = (stand - startX) * 0.02;
    return;
  }
  p.swingStyle = d.style || "over";
  p.lastSwingStyle = p.swingStyle;

  // ② 引拍 / 起跳上升
  if (f < tl.hit) {
    const u = (f - tl.in) / tl.wind;
    p.x = stand;
    p.swingT = Math.floor(u * SW.windup);
    if (d.lunge) { p.runAmt = 1; p.vx = 2.5; }
    if (b.stand.jumpH > 0) {
      const jh = b.stand.jumpH * Math.sin(u * Math.PI / 2);   // 到触球帧正好顶
      p.y = CO.groundY - jh;
      p.onGround = false;
      p.sq = jh > b.stand.jumpH * 0.5 ? C.player.jumpStretch : 1;
    }
    return;
  }

  // ③ 触球定格:姿势钉在最高点,只剩缩放
  if (f < tl.hit + tl.freeze) {
    p.x = stand;
    p.y = CO.groundY - b.stand.jumpH;
    p.onGround = b.stand.jumpH <= 0;
    if (d.crouch) p.sq = C.player.landSquash;
    p.swingT = SW.windup;
    return;
  }

  // ④ 出球与随挥:收拍按 pose.cut 提前掐断(点杀那关就是「不挥满」)
  const relOut = f - tl.hit - tl.freeze;
  if (relOut < tl.out) {
    p.x = stand;
    if (d.cut && relOut > d.cut) {
      p.swingT = -1;
      p.recoverT = Math.max(1, SW.blendOut - relOut + d.cut);
      p.lastSwingStyle = d.style;
    } else {
      p.swingT = SW.windup + Math.round(clamp(relOut / 16, 0, 1) * SW.active);
    }
    if (b.stand.jumpH > 0) {
      const down = clamp((relOut - tl.out * 0.45) / (tl.out * 0.55), 0, 1);
      p.y = CO.groundY - b.stand.jumpH * (1 - down);
      p.onGround = down >= 1;
    }
    return;
  }

  // ⑤ 收尾:落地屈膝后回到准备位
  p.x = stand; p.y = CO.groundY; p.onGround = true;
  p.swingT = -1; p.recoverT = 0;
}

// ============================================================
// 画笔:球场 / 弧线 / 判定环 / 爆点 / 键帽 / 时机条
// ============================================================
function drawCourt(g: Graphics, vp: Viewport, w: number, h: number, rig: DrillRig, landed: boolean): void {
  const X = (x: number): number => vp.x(x);
  const Y = (y: number): number => vp.y(y);

  g.fillColor = withAlpha(pal(INK.bg), 0.88);
  g.rect(-w / 2, -h / 2, w, h);
  g.fill();

  const gy = Y(CO.groundY);
  g.fillColor = withAlpha(pal(INK.floor), 0.32);
  g.rect(-w / 2, -h / 2, w, gy + h / 2);
  g.fill();

  g.strokeColor = withAlpha(pal(INK.line), 0.55);
  g.lineWidth = 2;
  g.moveTo(X(CO.left - 40), gy); g.lineTo(X(CO.right + 40), gy); g.stroke();

  g.strokeColor = withAlpha(pal(INK.line), 0.22);
  g.lineWidth = 1;
  for (const lx of [CO.left, CO.shortServeL, CO.shortServeR, CO.right]) {
    g.moveTo(X(lx), gy); g.lineTo(X(lx), gy - 6); g.stroke();
  }

  g.strokeColor = withAlpha(pal(INK.net), 0.85);
  g.lineWidth = 2.5;
  g.moveTo(X(CO.netX), gy); g.lineTo(X(CO.netX), Y(CO.netTopY)); g.stroke();
  g.strokeColor = withAlpha(pal(INK.net), 0.5);
  g.lineWidth = 1.5;
  const nt = Y(CO.netTopY);
  g.moveTo(X(CO.netX) - 14, nt); g.lineTo(X(CO.netX) + 14, nt); g.stroke();

  // ---------- 目标落点带:宽度就是判据认的那一条 ----------
  const z = rig.bake.zone;
  const x1 = X(z.x1), x2 = X(z.x2);
  const col = landed ? INK.ret : INK.zone;
  g.fillColor = withAlpha(pal(INK.zone), landed ? 0.34 : 0.2);
  g.rect(x1, gy - 9, Math.max(18, x2 - x1), 12);
  g.fill();
  g.strokeColor = withAlpha(pal(col), landed ? 0.95 : 0.65);
  g.lineWidth = landed ? 2.4 : 1.5;
  g.rect(x1, gy - 9, Math.max(18, x2 - x1), 12);
  g.stroke();
  // 两端各立一根小柱:只有一条 12px 的带子时,玩家读成「地上有一块颜色」而不是「一块区域」
  for (const bx of [x1, x2]) {
    g.strokeColor = withAlpha(pal(col), 0.8);
    g.lineWidth = 1.6;
    g.moveTo(bx, gy - 9); g.lineTo(bx, gy - 22); g.stroke();
  }
  // 显式落点门槛(minLandX / maxLandX)单独画一条:高远关「压过这条线」就是它
  const th = rig.def.minLandX != null ? X(rig.def.minLandX) : rig.def.maxLandX != null ? X(rig.def.maxLandX) : null;
  if (th != null) {
    g.strokeColor = withAlpha(pal(INK.paper), 0.75);
    g.lineWidth = 1.8;
    for (let yy = gy + 4; yy > gy - 26; yy -= 6) { g.moveTo(th, yy); g.lineTo(th, yy - 3.4); g.stroke(); }
  }
}

/** 虚线弧:一段画、一段空。dash 参数在 config 的 drill.demo.arcDash(场上预告同源) */
function drawDashed(g: Graphics, vp: Viewport, pts: { x: number; y: number }[], upto: number,
  color: string, alpha: number, width: number): void {
  if (pts.length < 2) return;
  const n = Math.min(pts.length - 1, Math.max(1, Math.floor(upto)));
  const full = upto >= pts.length - 1;
  g.strokeColor = withAlpha(pal(color), alpha);
  g.lineWidth = width;
  let run = 0, on = true;
  g.moveTo(vp.x(pts[0].x), vp.y(pts[0].y));
  for (let i = 1; i <= n; i++) {
    const dx = (pts[i].x - pts[i - 1].x) * (full ? 1 : 1);
    const dy = pts[i].y - pts[i - 1].y;
    run += Math.hypot(dx, dy);
    if (on) g.lineTo(vp.x(pts[i].x), vp.y(pts[i].y));
    else g.moveTo(vp.x(pts[i].x), vp.y(pts[i].y));
    const need = on ? DEMO.arcDash.on : DEMO.arcDash.off;
    if (run >= need) { run = 0; on = !on; }
  }
  g.stroke();
}

/** 判定区:尖刺环 + 中心准星(P5 语汇里「打击」一律是尖的,不许画光滑圆) */
function drawStrike(g: Graphics, vp: Viewport, rig: DrillRig, alpha: number, scale: number): void {
  const s = rig.bake.strike;
  drawSpikeRing(g, vp.x(s.x), vp.y(s.y), s.r * scale, 0.34,
    rig.seedVerts, rig.seedOff, rig.seedCount, 0, pal(INK.strike), alpha, 1.8, 2.6, 0.35);
  drawCrossMark(g, vp.x(s.x), vp.y(s.y), 11, 2.4, 0.62, pal(INK.strike), alpha);
}

/** 触球爆点:星芒 + 尖刺集中线(旧版是三层光滑圆,既不像爆点也不合 P5 语汇) */
function drawHitBurst(g: Graphics, vp: Viewport, rig: DrillRig, f: number): void {
  const tl = rig.tl, b = rig.bake;
  if (f < tl.hit || f > tl.hit + tl.freeze + 4) return;
  const u = clamp((f - tl.hit) / Math.max(1, tl.freeze), 0, 1);
  const cx = vp.x(b.contact.x), cy = vp.y(b.contact.y);
  drawStarburst(g, cx, cy, 20 - u * 6, 7, 9, pal(INK.ret), (1 - u) * 0.9, u * 0.6);
  g.fillColor = withAlpha(pal(INK.paper), (1 - u) * 0.95);
  g.circle(cx, cy, 4.5 * (1 - u * 0.5));
  g.fill();
  const rng = 8 + u * 16;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    drawTaper(g, cx + Math.cos(a) * 6, cy + Math.sin(a) * 6,
      cx + Math.cos(a) * rng, cy + Math.sin(a) * rng, 3.4, pal(INK.ret), (1 - u) * 0.85);
  }
}

/** 键帽:斜切方块 + 方向尖头 + 亮起按下那一帧(文字由 callouts 交出去,Labels 摆) */
function keyChipBox(w: number, h: number, jump: boolean): { x: number; y: number; cw: number; ch: number } {
  const cw = 74, ch = 30;
  const bx = w / 2 - cw - 12;
  const by = -h / 2 + ch / 2 + (jump ? 46 : 12);
  return { x: bx, y: by, cw, ch };
}

function drawChip(g: Graphics, cx: number, cy: number, cw: number, ch: number,
  face: string, active: boolean, dir: number, label: string): void {
  void label;
  const shea = ch * 0.22;
  const l = cx - cw / 2, r = cx + cw / 2, t = cy + ch / 2, bt = cy - ch / 2;
  g.fillColor = withAlpha(pal(INK.ink), 0.6);
  g.moveTo(l + 2, bt - 2); g.lineTo(r + 2, bt - 2); g.lineTo(r + 2 - shea, t - 2); g.lineTo(l + 2 - shea, t - 2);
  g.close(); g.fill();
  g.fillColor = withAlpha(pal(face), active ? 1 : 0.9);
  g.moveTo(l, bt); g.lineTo(r, bt); g.lineTo(r - shea, t); g.lineTo(l - shea, t);
  g.close(); g.fill();
  g.strokeColor = withAlpha(pal(INK.paper), active ? 0.95 : 0.35);
  g.lineWidth = active ? 2.2 : 1.2;
  g.moveTo(l, bt); g.lineTo(r, bt); g.lineTo(r - shea, t); g.lineTo(l - shea, t);
  g.close(); g.stroke();
  // 方向尖头:左滑← / 右滑→,画在键帽里,配合「左滑」那颗字
  const head = pal(active ? INK.ink : INK.paper);
  const mx = cx, my = cy;
  drawTaper(g, mx - dir * 15, my - 7, mx + dir * 15, my, 14, head, active ? 0.95 : 0.6);
  drawTaper(g, mx - dir * 15, my + 7, mx + dir * 15, my, 14, head, active ? 0.95 : 0.6);
}

function drawKeys(g: Graphics, rig: DrillRig, f: number, w: number, h: number, step: number): void {
  const b = rig.bake, tl = rig.tl;
  const near = rig.def.wantKey === "near";
  const shotActive = f >= tl.hit && f <= tl.hit + tl.freeze;
  const jumpNeeded = b.stand.jumpH > 0;
  const jumpActive = f >= tl.in && f < tl.hit + 2;
  // 键帽只在「击球」这一步亮:第④步要看的是落点带与错误对照,再压两块亮面就糊成一片
  const show = step === 2 || (rig.focusStep < 0 && stepOfFrame(tl, f) === 2);
  if (!show && !shotActive) return;

  const shot = keyChipBox(w, h, jumpNeeded);
  drawChip(g, shot.x, shot.y, shot.cw, shot.ch, near ? INK.zone : INK.ret,
    shotActive, near ? -1 : 1, b.keyName);
  if (jumpNeeded) {
    const jmp = { x: shot.x - shot.cw - 12, y: shot.y, cw: shot.cw, ch: shot.ch };
    drawChip(g, jmp.x, jmp.y, jmp.cw, jmp.ch, "#3ea8ff", jumpActive, -1, "起跳");
  }
}

// ---------- 挥拍时机条(hud-overlay 场上共用同一支笔) ----------
export const winU = (elapsed: number): number =>
  clamp((elapsed - SW.windup - 0.5) / (SW.active - 1), 0, 1);

const BANDS = {
  sweet: [0.5 - C.sweet.coreRatio / 2, 0.5 + C.sweet.coreRatio / 2],
  perfect: [0.5 - C.perfect.coreRatio / 2, 0.5 + C.perfect.coreRatio / 2],
};

export function meter(g: Graphics, x: number, y: number, w: number, u: number | null,
  opt?: { h?: number; a?: number }): void {
  const h = opt?.h ?? 14;
  const a = opt?.a ?? 1;

  g.fillColor = withAlpha(pal(INK.ink), 0.78 * a);
  g.rect(x, y, w, h);
  g.fill();
  g.strokeColor = withAlpha(pal(INK.paper), 0.22 * a);
  g.lineWidth = 1;
  g.rect(x, y, w, h);
  g.stroke();

  const band = (rng: number[], col: string): void => {
    g.fillColor = withAlpha(pal(col), (rng === BANDS.sweet ? 0.55 : 0.95) * a);
    g.rect(x + w * rng[0], y + 1, w * (rng[1] - rng[0]), h - 2);
    g.fill();
  };
  band(BANDS.sweet, INK.ret);
  band(BANDS.perfect, INK.paper);

  g.strokeColor = withAlpha(pal(INK.paper), 0.14 * a);
  g.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    const cx = Math.round(x + w * i / 8);
    g.moveTo(cx, y + 2); g.lineTo(cx, y + h - 2); g.stroke();
  }

  if (u != null) {
    const cx = x + w * clamp(u, 0, 1);
    g.strokeColor = withAlpha(pal(INK.paper), a);
    g.lineWidth = 2.2;
    g.moveTo(cx, y - 3); g.lineTo(cx, y + h + 3); g.stroke();
    const inSweet = u >= BANDS.sweet[0] && u <= BANDS.sweet[1];
    g.fillColor = inSweet ? withAlpha(pal(INK.ret), 0.95 * a) : withAlpha(pal(INK.paper), 0.45 * a);
    g.moveTo(cx - 4, y - 5); g.lineTo(cx + 4, y - 5); g.lineTo(cx, y - 1);
    g.close(); g.fill();
  }
}

// ============================================================
// 标字(数据,不是像素):引擎的 Graphics 没有文字 API,字一律由 ui 那边挂 Label
// ============================================================
export interface Callout {
  /** 哪一步才显示(0..3) */
  step: number;
  /** 画布本地坐标(原点在画布中心,y 向上) */
  x: number; y: number;
  text: string;
  /** 谁家的字:决定颜色与字号档(与 ui 侧同一份枚举) */
  tone: "zone" | "stand" | "hit" | "key" | "land" | "alt" | "meter";
}

function keyChipCenter(rig: DrillRig, w: number, h: number): { x: number; y: number } {
  const b = rig.bake;
  return keyChipBox(w, h, b.stand.jumpH > 0);
}

/**
 * 这一步该在场上标什么字。全部来自烘焙事实(分区名、真落点、真击球点、判据报的理由),
 * 所以文字与画面不会各说各话 —— 旧版那四句六关通用的话就是这么糊出来的。
 */
export function callouts(rig: DrillRig, step: number, w?: number, h?: number): Callout[] {
  const W = w ?? C.drill.canvas.w, H = h ?? C.drill.canvas.h;
  const vp = demoVp(rig, W, H);
  const b = rig.bake, tl = rig.tl, gy = vp.y(CO.groundY);
  const out: Callout[] = [];
  // ⚠ 本地 y 朝上:`gy + n` 才是「地面线之上」(球场那一侧)。写成 gy - n 会把字压到
  //   地板条下面去 —— 出图第一版三条落点标注全糊在地板里,真机上同样看不见。
  const zone = (): Callout => ({
    step: -1 as number, x: vp.x(b.zone.x1) + 6, y: gy + 18, text: b.zone.label, tone: "zone",
  });

  if (step === 0) {
    out.push({ step: 0, x: vp.x(b.inbound.feederX), y: vp.y(b.inbound.feederY) + 18, text: "喂球机", tone: "stand" });
    const mid = b.inbound.pts[Math.floor(tl.in * 0.55)] ?? b.contact;
    out.push({ step: 0, x: vp.x(mid.x), y: vp.y(mid.y) + 16, text: "看这条来球弧", tone: "hit" });
    const z = zone(); z.step = 0; out.push(z);
  } else if (step === 1) {
    out.push({ step: 1, x: vp.x(b.stand.x) - 40, y: gy + 14, text: "站这里", tone: "stand" });
    out.push({
      step: 1, x: vp.x(b.contact.x) + 44, y: vp.y(b.contact.y) + 16,
      text: b.stand.jumpH > 0 ? "起跳才够到" : "站着就够到", tone: "hit",
    });
    const z = zone(); z.step = 1; out.push(z);
  } else if (step === 2) {
    const chip = keyChipCenter(rig, W, H);
    out.push({ step: 2, x: chip.x, y: chip.y + 26, text: b.keyName, tone: "key" });
    if (b.stand.jumpH > 0) out.push({ step: 2, x: chip.x - 86, y: chip.y + 26, text: "起跳", tone: "key" });
    out.push({ step: 2, x: vp.x(b.contact.x) + 44, y: Math.max(vp.y(b.contact.y) + 16, -H / 2 + 62), text: "就在这一点打", tone: "hit" });
  } else {
    const z = zone(); z.step = 3; out.push(z);
    out.push({ step: 3, x: vp.x(b.ret.landX), y: gy + 30, text: "这一拍算", tone: "land" });
    if (b.alt) {
      out.push({
        step: 3, x: vp.x(b.alt.landX), y: gy + 52,
        text: `${rig.def.wantKey === "near" ? "右滑" : "左滑"} → ${b.alt.verdict}`, tone: "alt",
      });
    }
  }
  // 时机条那一句:贴着条子放(第③步才标,免得连播时满屏字)
  if (step === 2) {
    out.push({
      step: 2, x: -W / 2 + 16 + (W - 130) / 2, y: -H / 2 + 30 + 15 + 10,
      text: "黄区按下去 = 甜蜜点", tone: "meter",
    });
  }
  return deOverlap(out, W, H);
}

/**
 * 标字防压字:两行的 y 差不到一行高、x 又重叠时,把后一条抬高一档。
 * 为什么在 render 里做而不是在 ui 里做 —— 只有这里同时知道**世界坐标投出来的位置**与
 * 文案宽度;ui 那边只会照 callouts 摆 Label,让它再判一次重叠就是第二套尺子。
 */
function deOverlap(list: Callout[], W: number, H: number): Callout[] {
  const LINE = 16;   // 一档行高:14 时贴边的两条正好差 14 不触发,低球关会压字
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b2 = list[j];
        const wa = textW(a.text, CALLOUT_SIZE[a.tone]) / 2 + 4;
        const wb = textW(b2.text, CALLOUT_SIZE[b2.tone]) / 2 + 4;
        if (Math.abs(a.y - b2.y) < LINE && Math.abs(a.x - b2.x) < wa + wb) {
          b2.y = Math.min(H / 2 - 10, b2.y + LINE);
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  for (const c of list) {
    const half = textW(c.text, CALLOUT_SIZE[c.tone]) / 2 + 4;
    c.x = clamp(c.x, -W / 2 + half, W / 2 - half);
  }
  return list;
}

/** 与 ui/drill-panel 的 CALLOUT 同一批字号(两边同源,改要一起改) */
const CALLOUT_SIZE: Record<Callout["tone"], number> = {
  zone: 11, stand: 10, hit: 11, key: 12, land: 11, alt: 10, meter: 10,
};

// ============================================================
// 主绘制:一帧画一次,帧号是唯一时间输入(定格 = 帧不动)
// ============================================================
export function drawFrame(g: Graphics, rig: DrillRig, w?: number, h?: number): void {
  const W = w ?? C.drill.canvas.w, H = h ?? C.drill.canvas.h;
  const f = rig.frame % rig.tl.total;
  const tl = rig.tl, b = rig.bake;
  const step = activeStep(rig);
  const vp = demoVp(rig, W, H);

  pose(rig, f);
  g.clear();

  const flown = f >= tl.hit + tl.freeze + tl.out * 0.86;
  drawCourt(g, vp, W, H, rig, flown);

  // 来球弧:整条先淡淡画出来(让玩家看见「要跑到哪儿等」),飞过的部分提亮
  drawDashed(g, vp, b.inbound.pts.slice(0, Math.max(2, tl.in + 1)), f, INK.inbound, 0.28, 1.6);
  drawDashed(g, vp, b.inbound.pts.slice(0, Math.max(2, tl.in + 1)), Math.max(1, f), INK.inbound, f < tl.in ? 0.85 : 0.4, 2);
  // 回球弧:出球之后逐帧长出来;定格到第④步时整条画满
  if (f >= tl.hit) {
    drawDashed(g, vp, b.ret.pts, f - tl.hit - tl.freeze, INK.ret, 0.8, 2.2);
  }
  // 错误对照:只在第④步画,红色细虚线 + 它自己的落点准星
  if (step === 3 && b.alt) {
    drawDashed(g, vp, b.alt.pts, b.alt.pts.length - 1, INK.alt, 0.6, 1.8);
    drawCrossMark(g, vp.x(b.alt.landX), vp.y(CO.groundY) - 2, 9, 2, 0.5, pal(INK.alt), 0.9);
  }

  // 判定区:就位与击球两步才画(第①步画了会抢来球弧的读)
  if (step >= 1) drawStrike(g, vp, rig, step === 1 || step === 2 ? 0.9 : 0.35, viewScale(W));
  // 击球点高度标尺:从地面立到接触点,配「起跳才够到」那句话
  if (step === 1 || step === 2) {
    g.strokeColor = withAlpha(pal(INK.strike), 0.4);
    g.lineWidth = 1.2;
    for (let yy = CO.groundY; yy > b.contact.y; yy -= 14) {
      g.moveTo(vp.x(b.stand.x) + 10, vp.y(yy)); g.lineTo(vp.x(b.stand.x) + 18, vp.y(yy)); g.stroke();
    }
  }

  drawHitBurst(g, vp, rig, f);

  drawPlayer(g, vp, rig.p, Math.floor(f), 0, null);
  const ball = ballAt(rig, f);
  if (ball) {
    const fake: Ball = {
      x: ball.x, y: ball.y, px: ball.x, py: ball.y, vx: 1, vy: 0,
      live: true, held: false, owner: null, lastHitter: null, crossed: false, netted: false,
      shot: null, sq: 1, sqPrev: 1, flying: false, flyT: 0, flyFromX: 0, flyFromY: 0,
    };
    drawShuttle(g, vp, fake, null);
  }
  // 理想落点准星:第④步钉住
  if (step === 3) {
    drawCrossMark(g, vp.x(b.ret.landX), vp.y(CO.groundY) - 2, 13, 2.6, 0.5, pal(INK.ret), 0.95);
  }

  drawKeys(g, rig, f, W, H, step);

  // 挥拍时机条:窗口 = 引拍 + 定格,和场上 drillMeter 同一支笔
  const u = f >= tl.in && f <= tl.hit + tl.freeze
    ? clamp((f - tl.in) / (tl.wind + tl.freeze), 0, 1)
    : null;
  meter(g, -W / 2 + 16, H / 2 - H + 30, W - 130, u, { h: 15 });
}

/**
 * 场上 HUD 也读这个:hud-overlay 的「目标落点区」与引导页必须是同一条带子。
 * 落点已知(烘焙过)就用真落点定心,没烘焙成功时退回按 wantKey 给的位置 —— 绝不退回旧那套
 * 按 id switch 的硬编码,那正是「带子画在这儿、判据判在那儿」的来源。
 */
export function targetZoneFor(def: DrillDef): TargetZone {
  const b = DrillDemo.bake(def);
  return DrillDemo.zoneFor(def, b ? b.ret.landX : null);
}
