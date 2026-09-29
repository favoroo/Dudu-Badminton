// ============================================================
// 训练动作引导:用 DD.Sprites 同一套绘制函数把「正确动作长什么样」循环播出来
// —— 自老版 canvas 工程 src/render/drill-anim.js 逐行移植。
//
// 为什么不用图片/视频:项目零资源,而 Cocos Graphics 矢量绘制 + 同一套
// sprites 绘制函数,引导里的姿势就是游戏里那一套,皮肤换了它跟着换,
// 永远不会和实机长得不一样。
//
// 做法:造一个私有假人,手写字段定格任意挥拍阶段,再用世界坐标相机
// 缩进小 Graphics 区域。浮点 swingT 是被允许的 —— sprites 的
// swingPose 全程插值,逐帧给小数能得到亚帧平滑。
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

// ---------- 循环节奏(单位:模拟帧 @60Hz) ----------
// 待机留一段是给人眼定位用的,收尾那段是收拍回摆 ——
// 少了它每次循环都会「啪」地瞬移回待机
const HOLD = 30, TAIL = 26;
const SWING_FRAMES = Physics.swingTotal();
const CYCLE = HOLD + SWING_FRAMES + TAIL;
const LOOP_MS = CYCLE / 60 * 1000;

// ---------- 跳跃递推:与 Player.update 完全同一套 ----------
// 预生成高度表,引导里的起跳高度/顶点时刻和游戏里逐帧一致
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
export { LOOP_MS, CYCLE };

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
// 理想弹道:这一关该把球送到哪
// 用与 Player.buildShot 相同的公式,引导画的线就是真实球路
// ============================================================

interface PathResult {
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
// Rig:一个私有假人 + 它那一条演示线
// ============================================================

export interface DrillRig {
  def: DrillDef;
  p: Player;
  path: PathResult;
  jumpStart: number;
}

export function build(def: DrillDef, skin: SkinDef | null): DrillRig {
  const ps = C.colors.red;
  const th = skin?.main
    ? { main: skin.main, dark: skin.dark!, glow: skin.glow!, name: skin.name }
    : ps;
  const p = PlayerNS.create("left", { theme: th, jersey: "01" });
  p.x = def.contactX; p.y = CO.groundY;
  p.swingRadius = C.swing.radiusBase;
  // swingHit 必须为真:否则 sprites 会把挥空的 whiffExtra 硬直也算进时长
  p.swingHit = true;
  return { def, p, path: idealPath(def), jumpStart: contactFrame() - C.player.jumpApex };
}

// ============================================================
// Pose:把假人摆到循环里第 f 帧(单位:模拟帧,可带小数)的样子
// ============================================================

function pose(rig: DrillRig, f: number): void {
  const p = rig.p, d = rig.def.pose || {};
  p.x = rig.def.contactX;
  p.y = CO.groundY; p.onGround = true; p.sq = 1;
  p.recoverT = 0; p.runAmt = 0; p.vx = 0;

  if (f < HOLD) { p.swingT = -1; return; }
  const k = f - HOLD;

  if (k < SWING_FRAMES) {
    p.swingT = k;
    // 收拍点:点杀这类短促动作只播到第 cut 帧就转回收
    if (d.cut && k > d.cut) {
      p.swingT = -1;
      p.recoverT = Math.max(1, SW.blendOut - (k - d.cut));
      p.lastSwingStyle = d.style;
    } else {
      p.swingStyle = d.style || "over";
      p.lastSwingStyle = p.swingStyle;
      p.swingRadius = C.swing.radiusBase * (d.tight ? 0.86 : 1);
    }
    if (d.jump) {
      const jk = Math.round(k - rig.jumpStart);
      if (jk >= 0 && jk < JUMP.length && JUMP[jk] > 0) {
        p.y = CO.groundY - JUMP[jk];
        p.onGround = false;
        p.sq = JUMP[jk] > 40 ? C.player.jumpStretch : 1;
      }
    }
    if (d.lunge) {
      const t = clamp((k - 2) / (SWING_FRAMES * 0.6), 0, 1);
      p.x = rig.def.contactX + Math.round(d.lunge * t);
      p.runAmt = 1; p.vx = 3;
    }
    if (d.crouch) p.sq = C.player.landSquash;
    return;
  }

  // 收尾:从弧线终点摆回待机
  p.swingT = -1;
  p.lastSwingStyle = d.style || "over";
  p.recoverT = Math.max(0, SW.blendOut - (k - SWING_FRAMES));
  if (d.lunge) p.x = rig.def.contactX + d.lunge;
}

// ============================================================
// Viewport:世界坐标(canvas 960×540 y-down)→ Graphics 本地坐标(居中 y-up)
// ============================================================

const VIEW_S = 0.62;

/** 与原版 cam() 一致:相机跟随接触点(玩家固定在画面 30% 处),地面固定在距顶 268px */
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
// 绘制:球场底 + 弹道 + 假人 + 演示球 + 时机条
// ============================================================

// ---------- 小球场:地面、界线、网 ----------
function drawCourt(g: Graphics, vp: Viewport, w: number, h: number): void {
  const X = (x: number) => vp.x(x);
  const Y = (y: number) => vp.y(y);

  // 背景(全画布,屏幕空间,同原版 fillRect(0,0,w,h))
  g.fillColor = withAlpha(pal("#0c101e"), 0.55);
  g.rect(-w / 2, -h / 2, w, h);
  g.fill();

  // 地板:地面线到底边(同原版 fillRect(0, Y(groundY), w, h-Y(groundY)))
  const groundScreenY = Y(CO.groundY);
  g.fillColor = withAlpha(pal("#c8703a"), 0.30);
  g.rect(-w / 2, -h / 2, w, groundScreenY + h / 2);
  g.fill();

  // 地面线
  g.strokeColor = withAlpha(pal("#fff3e0"), 0.55);
  g.lineWidth = 2;
  g.moveTo(X(CO.left - 40), groundScreenY);
  g.lineTo(X(CO.right + 40), groundScreenY);
  g.stroke();

  // 界线
  g.strokeColor = withAlpha(pal("#fff3e0"), 0.22);
  g.lineWidth = 1;
  for (const lx of [CO.left, CO.shortServeL, CO.right]) {
    g.moveTo(X(lx), groundScreenY);
    g.lineTo(X(lx), groundScreenY - 5);
    g.stroke();
  }

  // 网
  g.strokeColor = withAlpha(pal("#e6f0ff"), 0.8);
  g.lineWidth = 2;
  g.moveTo(X(CO.netX), groundScreenY);
  g.lineTo(X(CO.netX), Y(CO.netTopY));
  g.stroke();
  // 网顶横线
  g.strokeColor = withAlpha(pal("#e6f0ff"), 0.35);
  g.lineWidth = 1;
  const netTop = Y(CO.netTopY);
  g.moveTo(X(CO.netX) - 14, netTop);
  g.lineTo(X(CO.netX) + 14, netTop);
  g.stroke();
}

// ---------- 理想弹道:虚线 + 落点圈 ----------
function drawPath(g: Graphics, vp: Viewport, rig: DrillRig): void {
  const pts = rig.path.pts;
  if (!pts || pts.length < 2) return;

  // 虚线效果:用短线段的间隙来模拟
  g.strokeColor = rig.path.hitNet
    ? withAlpha(pal("#ff7878"), 0.75)
    : withAlpha(pal("#ffe14d"), 0.7);
  g.lineWidth = 1.8;

  // 绘制虚线:每隔一段画一小段
  let drawing = true;
  let dashLen = 0;
  const dashTotal = 5, gapTotal = 5;
  g.moveTo(vp.x(pts[0].x), vp.y(pts[0].y));
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    dashLen += segLen;
    if (drawing) {
      g.lineTo(vp.x(pts[i].x), vp.y(pts[i].y));
    } else {
      g.moveTo(vp.x(pts[i].x), vp.y(pts[i].y));
    }
    if (dashLen >= (drawing ? dashTotal : gapTotal)) {
      dashLen = 0;
      drawing = !drawing;
    }
  }
  g.stroke();

  // 落点圈
  const last = pts[pts.length - 1];
  g.strokeColor = withAlpha(pal("#ffe14d"), 0.85);
  g.lineWidth = 2;
  g.ellipse(vp.x(last.x), vp.y(CO.groundY) + 1, 11, 4);
  g.stroke();
}

// ---------- 演示球:沿理想弹道走 ----------
function drawDemoBall(g: Graphics, vp: Viewport, rig: DrillRig, f: number, t: number): void {
  const pts = rig.path.pts;
  if (!pts) return;
  let pt = pts[0];
  if (f > HOLD) {
    const rel = clamp((f - HOLD - contactFrame()) / (SWING_FRAMES * 1.15), 0, 1);
    pt = pts[Math.min(pts.length - 1, Math.round(rel * (pts.length - 1)))];
  }
  const b = mkBall(pt.x, pt.y, 1, 0);
  // spin 用 sq 微调来暗示旋转(真实 spin 字段不在 Ball 接口里)
  b.sq = 0.96 + 0.04 * Math.sin(t * 0.02);
  drawShuttle(g, vp, b, null);
}

// ============================================================
// 挥拍时机条
// 段位长度与色带全部从 C.swing / C.sweet / C.perfect 推导,
// 引导里教的「什么时候按」和场上判的「打得好不好」永不跑偏
// ============================================================

/** 挥拍窗口游标位置(0..1):elapsed = swingT 模拟帧;场上头顶条与引导页共用 */
export const winU = (elapsed: number): number =>
  clamp((elapsed - SW.windup - 0.5) / (SW.active - 1), 0, 1);

const BANDS = {
  sweet: [0.5 - C.sweet.coreRatio / 2, 0.5 + C.sweet.coreRatio / 2],
  perfect: [0.5 - C.perfect.coreRatio / 2, 0.5 + C.perfect.coreRatio / 2],
};

/**
 * 时机条(屏幕坐标,不随相机缩放)
 * u = 游标位置(0..1),null = 不在窗口内
 * a = 整体透明度乘数(场上头顶条用:非挥拍时压暗)
 */
export function meter(g: Graphics, x: number, y: number, w: number, u: number | null,
  opt?: { h?: number; a?: number }): void {
  const h = opt?.h ?? 14;
  const a = opt?.a ?? 1;
  // 背景
  g.fillColor = withAlpha(pal("#080b16"), 0.72 * a);
  g.rect(x, y, w, h);
  g.fill();
  g.strokeColor = withAlpha(pal("#ffffff"), 0.18 * a);
  g.lineWidth = 1;
  g.rect(x, y, w, h);
  g.stroke();

  // 色带
  const band = (rng: number[], col: string) => {
    g.fillColor = withAlpha(pal(col), (rng === BANDS.sweet ? 0.5 : 0.9) * a);
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

  // 游标
  if (u != null) {
    const cx = x + w * clamp(u, 0, 1);
    g.strokeColor = withAlpha(pal("#ffffff"), a);
    g.lineWidth = 2;
    g.moveTo(cx, y - 3);
    g.lineTo(cx, y + h + 3);
    g.stroke();
  }

  // 出手位置暗示(Graphics 无法 fillText,用游标上方的小三角代替文字)
  // 三角在甜蜜带内变黄:一眼看出此刻按得准不准
  if (u != null) {
    const cx = x + w * clamp(u, 0, 1);
    const inSweet = u >= BANDS.sweet[0] && u <= BANDS.sweet[1];
    // 小三角指示
    g.fillColor = inSweet ? withAlpha(pal("#ffe14d"), 0.9 * a) : withAlpha(pal("#ffffff"), 0.4 * a);
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

/**
 * 绘制一整帧引导画面。
 * @param g      Graphics 组件(节点尺寸 = 画布像素尺寸)
 * @param rig    build() 返回的演示假人
 * @param ms     累计毫秒(用于循环)
 * @param w      画布宽(默认读 config)
 * @param h      画布高(默认读 config)
 */
export function draw(g: Graphics, rig: DrillRig, ms: number, w?: number, h?: number): void {
  w = w ?? C.drill.canvas.w;
  h = h ?? C.drill.canvas.h;
  const vp = demoVp(rig.def.contactX, w, h);
  const f = (ms % LOOP_MS) / LOOP_MS * CYCLE;
  pose(rig, f);

  g.clear();

  // 球场底 + 弹道(屏幕空间,经 vp 变换)
  drawCourt(g, vp, w, h);
  drawPath(g, vp, rig);

  // 假人 + 演示球(世界空间,经 vp 变换)
  drawPlayer(g, vp, rig.p, Math.floor(ms / 16.7), 0, null);
  drawDemoBall(g, vp, rig, f, ms);

  // 时机条(屏幕空间,直接用 Graphics 坐标)
  const u = (f >= HOLD && f <= HOLD + SWING_FRAMES) ? winU(f - HOLD) : null;
  // 位置:左下角(canvas 16, h-30 → Graphics -w/2+16, h/2-(h-30))
  meter(g, -w / 2 + 16, h / 2 - h + 30, w - 130, u, { h: 15 });
}

// ============================================================
// 落点键名:wantKey → 触屏上那颗击球键的文字,引导文案跟着按键标签走
// ============================================================

export function shotLabel(wantKey: "far" | "near"): string {
  return wantKey === "near" ? "短球" : "深球";
}
