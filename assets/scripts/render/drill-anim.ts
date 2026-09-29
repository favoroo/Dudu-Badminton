// ============================================================
// 训练动作引导:用 DD.Sprites 同一套绘制函数把「正确动作长什么样」循环播出来
// —— 升级为「发球来球 → 跑位起跳 → 击球定格 → 目标落点」完整教学闭环。
//
// 为什么不用图片/视频:项目零资源,而 Cocos Graphics 矢量绘制 + 同一套
// sprites 绘制函数,引导里的姿势就是游戏里那一套,皮肤换了它跟着换,
// 永远不会和实机长得不一样。
//
// 坐标约定:draw 接收的 Graphics 节点本地空间原点在中心、y 向上;
// 内部 Viewport 把世界坐标(canvas 惯例 960×540 y-down)映射到该空间。
// ============================================================
import { Graphics } from "cc";
import { CFG, DRILLS } from "../core/config";
import { Ball, DrillDef, Player, SkinDef } from "../core/types";
import { Physics } from "../core/physics";
import { Player as PlayerNS } from "../core/player";
import { drawPlayer, drawShuttle, Viewport } from "../render/sprites";
import { clamp, TAU, D2R, inv } from "../core/utils";
import { pal, withAlpha } from "../render/palette";

const C = CFG;
const CO = C.court, SW = C.swing;

// ---------- 教学演示阶段节拍(单位: 模拟帧 @60Hz) ----------
// 阶段 1: 发球机来球迎球 (球自右半场越网飞向击球点)
export const INBOUND_FRAMES = 32;
// 阶段 2: 跑位/引拍/起跳蓄力 (玩家就位、腾空或弓步就位)
export const WINDUP_FRAMES = 12;
// 阶段 3: 黄金击球点定格慢放 (按键按下动画、爆点火花、时机条命中完美区)
export const FREEZE_FRAMES = 10;
// 阶段 4: 出球飞行与命中目标 (金色理想弹道越网飞向对方落点区)
export const OUTBOUND_FRAMES = 42;
// 阶段 5: 落点光圈结算与收尾 (落点波纹扩散、假人收拍恢复站姿)
export const SETTLE_FRAMES = 18;

// 完整循环总帧数: 114 帧 (~1.9 秒)
export const TOTAL_CYCLE = INBOUND_FRAMES + WINDUP_FRAMES + FREEZE_FRAMES + OUTBOUND_FRAMES + SETTLE_FRAMES;
export const LOOP_MS = TOTAL_CYCLE / 60 * 1000;
export const CYCLE = TOTAL_CYCLE;

// 阶段定义
export interface DemoStage {
  index: number;
  name: string;
  desc: string;
}

export function stageOfFrame(f: number): DemoStage {
  if (f < INBOUND_FRAMES) {
    return { index: 0, name: "迎球", desc: "观察发球机来球弧线" };
  }
  if (f < INBOUND_FRAMES + WINDUP_FRAMES) {
    return { index: 1, name: "起跳/就位", desc: "迅速移动到位或起跳迎击" };
  }
  if (f < INBOUND_FRAMES + WINDUP_FRAMES + FREEZE_FRAMES) {
    return { index: 2, name: "黄金击球点", desc: "抓住最佳击球时机按下按键" };
  }
  return { index: 3, name: "目标落点", desc: "球越过球网落入目标得分区" };
}

// ---------- 跳跃递推:与 Player.update 完全同一套 ----------
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

// ---------- 导出常量 ----------
export const contactFrame = (): number => SW.windup + (SW.active - 1) / 2;

// ---------- 辅助:最小 Ball ----------
function mkBall(x: number, y: number, vx = 0, vy = 0): Ball {
  return {
    x, y, px: x, py: y, vx, vy,
    live: true, held: false, owner: null,
    lastHitter: null, crossed: false, netted: false,
    shot: null, sq: 1, sqPrev: 1,
  };
}

// ============================================================
// 目标落点范围: 这一关回球应该落到对方半场的哪个区域
// ============================================================
export interface TargetZone {
  x1: number;
  x2: number;
  label: string;
}

export function targetZoneFor(def: DrillDef): TargetZone {
  switch (def.id) {
    case "clear":
      return { x1: def.minLandX || 790, x2: CO.right - 12, label: "后场底线深区" };
    case "slash":
    case "netshot":
      return { x1: CO.netX + 18, x2: CO.shortServeR + 42, label: "网前小球区" };
    case "drive":
      return { x1: CO.netX + 90, x2: CO.right - 35, label: "中后场深区" };
    case "smash":
      return { x1: CO.netX + 80, x2: CO.right - 45, label: "下压得分区" };
    case "lob":
      return { x1: CO.netX + 160, x2: CO.right - 20, label: "后场过渡区" };
    default:
      return { x1: def.minLandX || 600, x2: CO.right - 20, label: "目标得分区" };
  }
}

// ============================================================
// 理想来球弹道: 发球机自右半场喂过来的真实弧线
// ============================================================
export interface InboundPath {
  pts: { x: number; y: number }[];
  feederX: number;
  feederY: number;
}

function idealInPath(def: DrillDef): InboundPath {
  const feederX = Math.min(CO.right - 60, CO.netX + 175);
  const feederY = CO.groundY - (def.feed.jumpLead > 0 ? 110 : 70);
  const contactY = CO.groundY - def.demoH;
  const contactX = def.contactX;

  // 抛物线顶点高度调节
  let arcLift = 60;
  if (def.id === "smash" || def.id === "slash") arcLift = 105; // 高球
  else if (def.id === "clear") arcLift = 70;
  else if (def.id === "netshot" || def.id === "lob") arcLift = 42;
  else if (def.id === "drive") arcLift = 35; // 平快球

  const apexY = Math.min(feederY, contactY) - arcLift;
  const pts: { x: number; y: number }[] = [];
  const N = INBOUND_FRAMES;

  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const x = feederX + (contactX - feederX) * u;
    const baseY = feederY + (contactY - feederY) * u;
    const arch = (apexY - Math.min(feederY, contactY)) * 4 * u * (1 - u);
    const y = baseY + arch;
    pts.push({ x, y });
  }

  return { pts, feederX, feederY };
}

// ============================================================
// 理想回球弹道: 玩家击球后飞向对方场地的真实球路
// ============================================================
export interface PathResult {
  pts: { x: number; y: number }[];
  landX: number;
  hitNet: boolean;
}

function idealPath(def: DrillDef): PathResult {
  const h = def.demoH, y0 = CO.groundY - h;
  const depth = def.wantKey === "near" ? C.aimDepth.near : C.aimDepth.deep;
  const q = 0.72;
  const loft = clamp(Physics.loftFor(depth, h, q), C.shot.loftMinDeg, C.shot.loftMaxDeg);
  const s = Physics.solveShot(def.contactX, y0, 1, depth, loft, 0);
  const b = mkBall(def.contactX, y0, s.vx, s.vy);
  const pts = [{ x: b.x, y: b.y }];
  for (let i = 0; i < 220; i++) {
    Physics.step(b);
    pts.push({ x: b.x, y: b.y });
    if (b.y >= CO.groundY - 2 || b.x > CO.right + 40 || b.x < 20) break;
  }
  return { pts, landX: s.trace.landX, hitNet: s.trace.hitNet };
}

// ============================================================
// Rig: 演示假人 + 双向弹道 + 目标区 + 播放状态
// ============================================================
export interface DrillRig {
  def: DrillDef;
  p: Player;
  inPath: InboundPath;
  path: PathResult;
  target: TargetZone;
  jumpStart: number;
  // 播放控制
  paused: boolean;
  speed: number;
  currentFrame: number;
}

export function build(def: DrillDef, skin: SkinDef | null): DrillRig {
  const ps = C.colors.red;
  const th = skin?.main
    ? { main: skin.main, dark: skin.dark!, glow: skin.glow!, name: skin.name }
    : ps;
  const p = PlayerNS.create("left", { theme: th, jersey: "01" });
  p.x = def.contactX; p.y = CO.groundY;
  p.swingRadius = C.swing.radiusBase;
  p.swingHit = true;
  return {
    def,
    p,
    inPath: idealInPath(def),
    path: idealPath(def),
    target: targetZoneFor(def),
    jumpStart: contactFrame() - C.player.jumpApex,
    paused: false,
    speed: 1.0,
    currentFrame: 0,
  };
}

// ============================================================
// Pose: 假人在完整演示时间线上的姿势摆位
// ============================================================
function pose(rig: DrillRig, f: number): void {
  const p = rig.p, d = rig.def.pose || {};
  const baseContactX = rig.def.contactX;
  const startX = d.lunge ? baseContactX - d.lunge : baseContactX;

  p.x = startX;
  p.y = CO.groundY;
  p.onGround = true;
  p.sq = 1;
  p.recoverT = 0;
  p.runAmt = 0;
  p.vx = 0;
  p.swingT = -1;

  // 1. 来球飞行阶段 (0 .. INBOUND_FRAMES): 准备站姿或轻度预启动
  if (f < INBOUND_FRAMES) {
    p.x = startX;
    p.swingT = -1;
    return;
  }

  // 2. 引拍蓄力与起跳 (INBOUND_FRAMES .. INBOUND_FRAMES + WINDUP_FRAMES)
  const relW = f - INBOUND_FRAMES;
  if (relW < WINDUP_FRAMES) {
    if (d.lunge) {
      const u = clamp(relW / WINDUP_FRAMES, 0, 1);
      p.x = startX + d.lunge * u;
      p.runAmt = 1;
      p.vx = 2.5;
    }
    if (d.jump) {
      const ju = clamp(relW / WINDUP_FRAMES, 0, 1);
      const jumpIdx = Math.round(ju * (C.player.jumpApex + 2));
      if (jumpIdx < JUMP.length && JUMP[jumpIdx] > 0) {
        p.y = CO.groundY - JUMP[jumpIdx];
        p.onGround = false;
        p.sq = C.player.jumpStretch;
      }
    }
    p.swingStyle = d.style || "over";
    p.lastSwingStyle = p.swingStyle;
    p.swingT = Math.floor(relW / WINDUP_FRAMES * SW.windup);
    return;
  }

  // 3. 击球定格慢放 (INBOUND_FRAMES + WINDUP_FRAMES .. + FREEZE_FRAMES)
  const relF = relW - WINDUP_FRAMES;
  if (relF < FREEZE_FRAMES) {
    p.x = baseContactX;
    if (d.jump) {
      const apexH = JUMP[C.player.jumpApex] || 85;
      p.y = CO.groundY - apexH;
      p.onGround = false;
    }
    if (d.crouch) p.sq = C.player.landSquash;
    p.swingStyle = d.style || "over";
    p.lastSwingStyle = p.swingStyle;
    p.swingT = SW.windup;
    return;
  }

  // 4. 出球飞行与随球收拍 (.. + OUTBOUND_FRAMES)
  const relOut = relF - FREEZE_FRAMES;
  if (relOut < OUTBOUND_FRAMES) {
    p.x = baseContactX;
    const swingProg = clamp(relOut / 16, 0, 1);
    if (d.cut && relOut > d.cut) {
      p.swingT = -1;
      p.recoverT = Math.max(1, SW.blendOut - (relOut - d.cut));
      p.lastSwingStyle = d.style;
    } else {
      p.swingT = SW.windup + Math.round(swingProg * SW.active);
      p.swingStyle = d.style || "over";
    }

    if (d.jump) {
      const fallIdx = Math.min(JUMP.length - 1, C.player.jumpApex + Math.round(relOut * 1.5));
      if (fallIdx < JUMP.length && JUMP[fallIdx] > 0) {
        p.y = CO.groundY - JUMP[fallIdx];
        p.onGround = false;
      } else {
        p.y = CO.groundY;
        p.onGround = true;
      }
    }
    return;
  }

  // 5. 结算收尾恢复
  p.x = baseContactX;
  p.swingT = -1;
  p.recoverT = 0;
  p.onGround = true;
}

// ============================================================
// Viewport: 世界坐标 → Graphics 本地坐标
// ============================================================
const VIEW_S = 0.62;

function demoVp(contactX: number, w: number, h: number): Viewport {
  const s = VIEW_S * (w / C.drill.canvas.w);
  const camX = contactX - w * 0.30 / s;
  const camY = CO.groundY - 268 / s + 8;
  return {
    x: (wx: number) => (wx - camX) * s - w / 2,
    y: (wy: number) => -(wy - camY) * s + h / 2,
  };
}

// ============================================================
// 绘制构件: 球场、目标区、双弹道、火花、按键提示、时机条
// ============================================================

// ---------- 球场与目标落点区 ----------
function drawCourt(g: Graphics, vp: Viewport, w: number, h: number, rig: DrillRig, f: number): void {
  const X = (x: number) => vp.x(x);
  const Y = (y: number) => vp.y(y);

  // 背景
  g.fillColor = withAlpha(pal("#0c101e"), 0.88);
  g.rect(-w / 2, -h / 2, w, h);
  g.fill();

  // 地板
  const groundScreenY = Y(CO.groundY);
  g.fillColor = withAlpha(pal("#c8703a"), 0.32);
  g.rect(-w / 2, -h / 2, w, groundScreenY + h / 2);
  g.fill();

  // 地面线
  g.strokeColor = withAlpha(pal("#fff3e0"), 0.55);
  g.lineWidth = 2;
  g.moveTo(X(CO.left - 40), groundScreenY);
  g.lineTo(X(CO.right + 40), groundScreenY);
  g.stroke();

  // 场界线
  g.strokeColor = withAlpha(pal("#fff3e0"), 0.22);
  g.lineWidth = 1;
  for (const lx of [CO.left, CO.shortServeL, CO.shortServeR, CO.right]) {
    g.moveTo(X(lx), groundScreenY);
    g.lineTo(X(lx), groundScreenY - 6);
    g.stroke();
  }

  // 网
  g.strokeColor = withAlpha(pal("#e6f0ff"), 0.85);
  g.lineWidth = 2.5;
  g.moveTo(X(CO.netX), groundScreenY);
  g.lineTo(X(CO.netX), Y(CO.netTopY));
  g.stroke();
  const netTop = Y(CO.netTopY);
  g.strokeColor = withAlpha(pal("#e6f0ff"), 0.5);
  g.lineWidth = 1.5;
  g.moveTo(X(CO.netX) - 14, netTop);
  g.lineTo(X(CO.netX) + 14, netTop);
  g.stroke();

  // ---------- 对方半场目标落点区高亮 ----------
  const tgt = rig.target;
  const tx1 = X(tgt.x1);
  const tx2 = X(tgt.x2);
  const tw = Math.max(20, tx2 - tx1);
  const isLandedPhase = f >= INBOUND_FRAMES + WINDUP_FRAMES + FREEZE_FRAMES + OUTBOUND_FRAMES * 0.7;

  // 目标区地板高光
  const pulseA = isLandedPhase ? 0.38 + 0.15 * Math.sin(f * 0.3) : 0.18;
  g.fillColor = withAlpha(pal("#7dff9e"), pulseA);
  g.rect(tx1, groundScreenY - 8, tw, 10);
  g.fill();

  // 目标区边框
  g.strokeColor = withAlpha(pal(isLandedPhase ? "#ffe14d" : "#7dff9e"), isLandedPhase ? 0.95 : 0.65);
  g.lineWidth = isLandedPhase ? 2.5 : 1.5;
  g.rect(tx1, groundScreenY - 8, tw, 10);
  g.stroke();

  // 落地脉冲波纹
  if (isLandedPhase) {
    const ripU = ((f - (INBOUND_FRAMES + WINDUP_FRAMES + FREEZE_FRAMES + OUTBOUND_FRAMES * 0.7)) % 25) / 25;
    g.strokeColor = withAlpha(pal("#ffe14d"), (1 - ripU) * 0.85);
    g.lineWidth = 1.8;
    g.ellipse(X(rig.path.landX), groundScreenY, 12 + ripU * 22, 4 + ripU * 7);
    g.stroke();
  }
}

// ---------- 绘制双向弹道 ----------
function drawTrajectories(g: Graphics, vp: Viewport, rig: DrillRig, f: number): void {
  // 1. 来球轨迹 (青蓝色虚线)
  const inPts = rig.inPath.pts;
  if (inPts.length >= 2) {
    g.strokeColor = withAlpha(pal("#64d8ff"), 0.55);
    g.lineWidth = 1.8;
    g.moveTo(vp.x(inPts[0].x), vp.y(inPts[0].y));
    for (let i = 1; i < inPts.length; i++) {
      g.lineTo(vp.x(inPts[i].x), vp.y(inPts[i].y));
    }
    g.stroke();
  }

  // 2. 回球理想弹道 (金色/橙色虚线)
  const outPts = rig.path.pts;
  if (outPts && outPts.length >= 2) {
    g.strokeColor = rig.path.hitNet
      ? withAlpha(pal("#ff7878"), 0.75)
      : withAlpha(pal("#ffe14d"), 0.75);
    g.lineWidth = 2.0;

    let drawing = true;
    let dashLen = 0;
    const dashTotal = 6, gapTotal = 5;
    g.moveTo(vp.x(outPts[0].x), vp.y(outPts[0].y));
    for (let i = 1; i < outPts.length; i++) {
      const dx = outPts[i].x - outPts[i - 1].x;
      const dy = outPts[i].y - outPts[i - 1].y;
      const segLen = Math.sqrt(dx * dx + dy * dy);
      dashLen += segLen;
      if (drawing) {
        g.lineTo(vp.x(outPts[i].x), vp.y(outPts[i].y));
      } else {
        g.moveTo(vp.x(outPts[i].x), vp.y(outPts[i].y));
      }
      if (dashLen >= (drawing ? dashTotal : gapTotal)) {
        dashLen = 0;
        drawing = !drawing;
      }
    }
    g.stroke();

    // 落点圈
    const last = outPts[outPts.length - 1];
    g.strokeColor = withAlpha(pal("#ffe14d"), 0.85);
    g.lineWidth = 2;
    g.ellipse(vp.x(last.x), vp.y(CO.groundY) + 1, 12, 4.5);
    g.stroke();
  }
}

// ---------- 击球定格火花与击球点标记 ----------
function drawHitSparks(g: Graphics, vp: Viewport, rig: DrillRig, f: number): void {
  const contactStart = INBOUND_FRAMES + WINDUP_FRAMES;
  const isHitFreeze = f >= contactStart && f < contactStart + FREEZE_FRAMES;
  if (!isHitFreeze) return;

  const cx = vp.x(rig.def.contactX);
  const cy = vp.y(CO.groundY - rig.def.demoH);

  // 击球闪光核心
  g.fillColor = withAlpha(pal("#ffffff"), 0.95);
  g.circle(cx, cy, 6.5);
  g.fill();

  g.fillColor = withAlpha(pal("#ffe14d"), 0.65);
  g.circle(cx, cy, 14);
  g.fill();

  // 8 向爆破火花
  g.strokeColor = withAlpha(pal("#ffe14d"), 0.9);
  g.lineWidth = 2;
  const sparkR = 18;
  for (let i = 0; i < 8; i++) {
    const ang = i * (Math.PI / 4);
    g.moveTo(cx + Math.cos(ang) * 7, cy + Math.sin(ang) * 7);
    g.lineTo(cx + Math.cos(ang) * sparkR, cy + Math.sin(ang) * sparkR);
  }
  g.stroke();

  // 击球高度水平标尺
  g.strokeColor = withAlpha(pal("#ffffff"), 0.35);
  g.lineWidth = 1;
  g.moveTo(cx - 36, cy);
  g.lineTo(cx + 36, cy);
  g.stroke();
}

// ---------- 演示羽毛球 ----------
function drawShuttleBall(g: Graphics, vp: Viewport, rig: DrillRig, f: number, t: number): void {
  let bx = 0, by = 0;

  // 1. 来球阶段
  if (f < INBOUND_FRAMES) {
    const inPts = rig.inPath.pts;
    const rel = clamp(f / INBOUND_FRAMES, 0, 1);
    const idx = Math.min(inPts.length - 1, Math.floor(rel * inPts.length));
    bx = inPts[idx].x;
    by = inPts[idx].y;
  }
  // 2. 引拍至定格阶段
  else if (f < INBOUND_FRAMES + WINDUP_FRAMES + FREEZE_FRAMES) {
    bx = rig.def.contactX;
    by = CO.groundY - rig.def.demoH;
  }
  // 3. 出球与落地阶段
  else {
    const outPts = rig.path.pts;
    const rel = clamp(
      (f - (INBOUND_FRAMES + WINDUP_FRAMES + FREEZE_FRAMES)) / OUTBOUND_FRAMES,
      0, 1,
    );
    const idx = Math.min(outPts.length - 1, Math.floor(rel * outPts.length));
    bx = outPts[idx].x;
    by = outPts[idx].y;
  }

  const b = mkBall(bx, by, 1, 0);
  b.sq = 0.96 + 0.04 * Math.sin(t * 0.02);
  drawShuttle(g, vp, b, null);
}

// ---------- 拟真按键动态投影 (演示何时按键) ----------
function drawKeyPromptOverlay(g: Graphics, rig: DrillRig, f: number, w: number, h: number): void {
  const isNear = rig.def.wantKey === "near";
  const needsJump = !!rig.def.pose?.jump;

  // 击球按键按下时机: FREEZE 阶段按下
  const isHitActive = f >= INBOUND_FRAMES + WINDUP_FRAMES && f < INBOUND_FRAMES + WINDUP_FRAMES + FREEZE_FRAMES;
  // 跳跃按键按下时机: WINDUP 阶段按下
  const isJumpActive = f >= INBOUND_FRAMES && f < INBOUND_FRAMES + WINDUP_FRAMES + 3;

  const bx = w / 2 - 46;
  const by = h / 2 - 38;

  // 1. 击球按键卡片 (深球 / 短球)
  const shotKeyColor = isNear ? "#7dff9e" : "#ffe14d";
  const shotKeyName = isNear ? "短球" : "深球";
  const shotBtnR = isHitActive ? 18 : 20;

  // 按键阴影
  g.fillColor = withAlpha(pal("#000000"), 0.55);
  g.circle(bx + 2, by - 2, shotBtnR);
  g.fill();

  // 按键底色
  g.fillColor = withAlpha(pal(isHitActive ? "#ffffff" : "#182142"), 0.92);
  g.circle(bx, by, shotBtnR);
  g.fill();

  // 按键描边
  g.strokeColor = withAlpha(pal(shotKeyColor), isHitActive ? 1.0 : 0.8);
  g.lineWidth = isHitActive ? 3.5 : 2.0;
  g.circle(bx, by, shotBtnR);
  g.stroke();

  // 按键按下脉冲冲击波
  if (isHitActive) {
    const pulseU = ((f - (INBOUND_FRAMES + WINDUP_FRAMES)) % FREEZE_FRAMES) / FREEZE_FRAMES;
    g.strokeColor = withAlpha(pal(shotKeyColor), (1 - pulseU) * 0.9);
    g.lineWidth = 2.2;
    g.circle(bx, by, shotBtnR + pulseU * 16);
    g.stroke();
  }

  // 2. 起跳按键 (若有关卡要求)
  if (needsJump) {
    const jx = bx - 48;
    const jy = by;
    const jumpBtnR = isJumpActive ? 17 : 19;

    g.fillColor = withAlpha(pal("#000000"), 0.55);
    g.circle(jx + 2, jy - 2, jumpBtnR);
    g.fill();

    g.fillColor = withAlpha(pal(isJumpActive ? "#ffffff" : "#182142"), 0.92);
    g.circle(jx, jy, jumpBtnR);
    g.fill();

    g.strokeColor = withAlpha(pal("#3ea8ff"), isJumpActive ? 1.0 : 0.7);
    g.lineWidth = isJumpActive ? 3.0 : 1.8;
    g.circle(jx, jy, jumpBtnR);
    g.stroke();

    // 绘制简易向上箭头
    g.strokeColor = withAlpha(pal(isJumpActive ? "#0e1428" : "#3ea8ff"), 0.95);
    g.lineWidth = 2.0;
    g.moveTo(jx, jy + 6);
    g.lineTo(jx, jy - 6);
    g.moveTo(jx - 4, jy + 2);
    g.lineTo(jx, jy + 6);
    g.lineTo(jx + 4, jy + 2);
    g.stroke();
  }
}

// ============================================================
// 挥拍时机条
// ============================================================
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

  // 背景
  g.fillColor = withAlpha(pal("#080b16"), 0.78 * a);
  g.rect(x, y, w, h);
  g.fill();
  g.strokeColor = withAlpha(pal("#ffffff"), 0.22 * a);
  g.lineWidth = 1;
  g.rect(x, y, w, h);
  g.stroke();

  // 色带
  const band = (rng: number[], col: string) => {
    g.fillColor = withAlpha(pal(col), (rng === BANDS.sweet ? 0.55 : 0.95) * a);
    g.rect(x + w * rng[0], y + 1, w * (rng[1] - rng[0]), h - 2);
    g.fill();
  };
  band(BANDS.sweet, "#ffe14d");
  band(BANDS.perfect, "#ffffff");

  // 刻度
  g.strokeColor = withAlpha(pal("#ffffff"), 0.14 * a);
  g.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    const cx = Math.round(x + w * i / 8);
    g.moveTo(cx, y + 2);
    g.lineTo(cx, y + h - 2);
    g.stroke();
  }

  // 游标与小三角
  if (u != null) {
    const cx = x + w * clamp(u, 0, 1);
    g.strokeColor = withAlpha(pal("#ffffff"), a);
    g.lineWidth = 2.2;
    g.moveTo(cx, y - 3);
    g.lineTo(cx, y + h + 3);
    g.stroke();

    const inSweet = u >= BANDS.sweet[0] && u <= BANDS.sweet[1];
    g.fillColor = inSweet ? withAlpha(pal("#ffe14d"), 0.95 * a) : withAlpha(pal("#ffffff"), 0.45 * a);
    g.moveTo(cx - 4, y - 5);
    g.lineTo(cx + 4, y - 5);
    g.lineTo(cx, y - 1);
    g.close();
    g.fill();
  }
}

// ============================================================
// 主绘制入口
// ============================================================
export function draw(g: Graphics, rig: DrillRig, ms: number, w?: number, h?: number): void {
  w = w ?? C.drill.canvas.w;
  h = h ?? C.drill.canvas.h;
  const vp = demoVp(rig.def.contactX, w, h);

  // 计算当前循环帧
  const f = (ms % LOOP_MS) / LOOP_MS * TOTAL_CYCLE;
  rig.currentFrame = f;
  pose(rig, f);

  g.clear();

  // 1. 球场底 + 目标落点高亮区
  drawCourt(g, vp, w, h, rig, f);

  // 2. 双向弹道 (来球青线 + 回球金线)
  drawTrajectories(g, vp, rig, f);

  // 3. 击球定格火花
  drawHitSparks(g, vp, rig, f);

  // 4. 假人 + 羽毛球
  drawPlayer(g, vp, rig.p, Math.floor(ms / 16.7), 0, null);
  drawShuttleBall(g, vp, rig, f, ms);

  // 5. 按键投影提示
  drawKeyPromptOverlay(g, rig, f, w, h);

  // 6. 挥拍时机条 (完美击球窗口落在 FREEZE 帧)
  let u: number | null = null;
  const windowStart = INBOUND_FRAMES;
  const windowTotal = WINDUP_FRAMES + FREEZE_FRAMES;
  if (f >= windowStart && f <= windowStart + windowTotal) {
    u = clamp((f - windowStart) / windowTotal, 0, 1);
  }
  meter(g, -w / 2 + 16, h / 2 - h + 30, w - 130, u, { h: 15 });
}

export function shotLabel(wantKey: "far" | "near"): string {
  return wantKey === "near" ? "短球" : "深球";
}
