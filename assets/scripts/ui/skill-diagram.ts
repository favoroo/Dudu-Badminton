// ============================================================
// 技能图示:一款技能「什么时候按得下去、按下去会发生什么、代价是什么」的一格会动示意图。
// 零 cc —— 出显示列表(Paint[]),画笔在 ui/p5-paint;与 pad-diagram 同族、同一套纪律。
//
// 为什么要有它:技能卡只有 88 宽,详情板那条说明再怎么写也是**句子** —— 而「判定区 ×1.55」
// 「来球就位自动轰出」「离地 115 px 才点亮」是句子说不清的那种:没有画面的人读不出手感。
// 于是这里把三件事画在同一格里:键面(什么时候亮)、场上的人与球(按下之后发生了什么)、
// 判定圈(够得着多少)。
//
// 三条纪律,一条都不松(前两条与移动方式图示逐字同源):
//   1) **一帧都不自己算**:人物位置、球位、判定圈圆心与半径、分身站位,全部逐帧抄自
//      core/skill-demo —— 那是把 `Rules.step` 当真机跑过一遍录下来的快照。
//      本模块只做「世界坐标 → 图示坐标」的映射与画法,不产生任何判据数字。
//   2) **真值引用、不复制第二份**:冷却弧用 input/pad-cd 的 `cdArcs`(与真技能键面同一把尺子),
//      键的底色用 CFG.padSkin,三色分身用 CFG.skills.shadow.slots[].tint,
//      漩涡半径/电弧数/残影重数/蓄能分档全读 CFG。改数值这里跟着动。
//   3) **文字一律交出去**:引擎 Graphics 画不了字(sprites.ts 顶部老规矩),所以标注以
//      `skillDemoCallouts()` 数据交出,由 ui/skill-dialog 摆 Label。本模块不建节点。
//
// 取景:固定切「主角这一侧 + 球网」这一条带(不按每款技能变焦 —— 换技能时画面跳变焦,
// 读起来像坏了)。缩放 k 取宽/高中较小的一边,保证最高的那颗球与地面都进得来;
// 剩下的边距由地板与顶部暗角填掉,所以看不出是"裁过来的一张图"。
// ============================================================
import { CFG } from "../core/config";
import { Skills } from "../core/skills";
import { SkillDemo } from "../core/skill-demo";
import type { DemoSnap, SkillDemoBake } from "../core/skill-demo";
import { SkillId } from "../core/types";
import { cdArcs } from "../input/pad-cd";
import { C } from "./p5-tokens";
import { slantQuad, type Paint, type Pt } from "./p5-shapes";
import { personDL, ringPts } from "./pad-diagram";

const CO = CFG.court;
const SKIN = CFG.padSkin;

/** 取景与尺寸 token(图示自己的版式,不是游戏数值) */
export const SKD = {
  /** 图示盒内边距:凹陷槽底与画面之间那圈留白 */
  pad: 8,
  /** 世界 x 取景:够球位(wallL)再留 26,网前留 34(那道墙是"再往右过不去") */
  x0: CO.wallL - 26,
  x1: CO.netX + 34,
  /** 地面以下画这么多世界像素的地板(让脚有地方站) */
  below: 22,
  /** 地面以上要容得下演示里最高的那颗球 */
  above: 300,
  /** 键面半径(图示像素,不随 k 缩:它是"手上的那颗键",不是场上的东西) */
  keyR: 15,
  /** 球的半径 = 人物身高的这个比例(场上的东西就该跟着镜头一起缩;再小就看不见它在转) */
  shuttleOfH: 0.15,
  /** 一帧画多少笔就判超重(出图与真机都按这条核) */
  strokeBudget: 240,
} as const;

export interface SkillStage {
  sw: number; sh: number;
  /** 世界像素 → 图示像素 */
  k: number;
  /** 地面线的图示 y */
  gy: number;
  /** 键面圆心 */
  kx: number; ky: number;
}

/** 由图示盒尺寸算舞台:内容居中,地面钉在画面下沿往上一点 */
export function stageOf(w: number, h: number): SkillStage {
  const sw = w - SKD.pad * 2, sh = h - SKD.pad * 2;
  const cropW = SKD.x1 - SKD.x0, cropH = SKD.above + SKD.below;
  const k = Math.min(sw / cropW, sh / cropH);
  const gy = -sh / 2 + (sh - cropH * k) / 2 + SKD.below * k;
  return { sw, sh, k, gy, kx: sw / 2 - SKD.keyR - 3, ky: -sh / 2 + SKD.keyR + 3 };
}

/** 这块取景折算成图示像素要多宽 —— 面板与判据拿它量「盒子装不装得下这一格」 */
export function cropWidthPx(h: number): number {
  const sh = h - SKD.pad * 2;
  return (SKD.x1 - SKD.x0) * Math.min(1, sh / (SKD.above + SKD.below));
}

const sxOf = (st: SkillStage, wx: number): number => (wx - (SKD.x0 + SKD.x1) / 2) * st.k;
/** 世界 y 向下、图示 y 向上:离地越高(世界 y 越小)画得越靠上 */
const syOf = (st: SkillStage, wy: number): number => st.gy + (CO.groundY - wy) * st.k;

const fill = (hex: string, a: number, pts: Pt[]): Paint => ({ kind: "fill", hex, a, pts });
const line = (hex: string, a: number, lw: number, pts: Pt[]): Paint => ({ kind: "stroke", hex, a, lw, close: false, pts });
const outline = (hex: string, a: number, lw: number, pts: Pt[]): Paint => ({ kind: "stroke", hex, a, lw, close: true, pts });

/** 把「从 a0 扫到 a1」折成多边形(点列要能在 node 里出图与断言,也绕开 Graphics.arc 的补集坑) */
function fanPts(cx: number, cy: number, r: number, a0: number, a1: number, n = 18): Pt[] {
  const pts: Pt[] = [[cx, cy]];
  for (let i = 0; i <= n; i++) {
    const th = a0 + (a1 - a0) * (i / n);
    pts.push([cx + Math.cos(th) * r, cy + Math.sin(th) * r]);
  }
  return pts;
}

/** 虚线圆环(判定区/漩涡/领域都用它) */
function dashRing(out: Paint[], cx: number, cy: number, r: number, hex: string, a: number, lw: number, seg = 16): void {
  for (let i = 0; i < seg; i++) {
    const t0 = (i / seg) * Math.PI * 2, t1 = t0 + (Math.PI * 2 / seg) * 0.58;
    const pts: Pt[] = [];
    for (let j = 0; j <= 3; j++) {
      const th = t0 + (t1 - t0) * (j / 3);
      pts.push([cx + Math.cos(th) * r, cy + Math.sin(th) * r]);
    }
    out.push(line(hex, a, lw, pts));
  }
}

// ---------- 场地 ----------

function courtDL(out: Paint[], st: SkillStage, domain: boolean, accent: string): void {
  const gy = st.gy, far = st.sw / 2;
  // 地板:地面以下一条暖色带,只说明「这是地面」
  out.push(fill(C.wood, 0.085, [[-far, gy], [far, gy], [far, -st.sh / 2], [-far, -st.sh / 2]]));
  // 地面线:主角站得到的那一段亮,网对面暗一档
  out.push(line(C.paper, 0.62, 2.2, [[sxOf(st, CO.wallL), gy], [sxOf(st, CO.netX), gy]]));
  out.push(line(C.paper, 0.22, 1.6, [[-far, gy], [sxOf(st, CO.wallL), gy]]));
  out.push(line(C.paper, 0.22, 1.6, [[sxOf(st, CO.netX), gy], [far, gy]]));
  // 场地线:底线与前发球线(刻度与真球场同一批世界 x)
  for (const wx of [CO.left, CO.shortServeL]) {
    const x = sxOf(st, wx);
    out.push(line(C.paper, 0.26, 1.4, [[x, gy], [x, gy + 8]]));
  }
  // 球网:再往右过不去的那道墙
  const nx = sxOf(st, CO.netX), nt = syOf(st, CO.netTopY);
  out.push(line(C.paper, 0.55, 2.4, [[nx, gy], [nx, nt]]));
  out.push(line(C.paper, 0.75, 2.4, [[nx - 5, nt], [nx + 5, nt]]));
  for (let i = 1; i <= 3; i++) {
    const y = gy + (nt - gy) * (i / 4);
    out.push(line(C.paper, 0.16, 1, [[nx - 4, y], [nx + 4, y]]));
  }
  // 时空领域:把整个场子罩进暗角(浓度 = CFG.skills.focus.vignetteAlpha,不另拍一个数)
  if (domain) {
    out.push(outline(accent, CFG.skills.focus.vignetteAlpha, 2, ringPts(0, 0, st.sw * 0.46, st.sh / (st.sw * 0.92), 28)));
    dashRing(out, 0, 0, st.sw * 0.40, accent, 0.16, 1.2, 24);
  }
}

// ---------- 球 ----------

function shuttleDL(out: Paint[], x: number, y: number, vx: number, vy: number, alpha: number, r: number, ghost = false): void {
  const ang = Math.atan2(-vy, vx);           // 世界 y 向下 → 图示 y 向上
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const px = -uy, py = ux;
  if (ghost) {
    out.push(outline(C.dim, alpha, 1.1, ringPts(x, y, r * 0.8, 1, 10)));
    return;
  }
  // 球头朝前、裙摆朝后(与场上 drawShuttle 同一条读法)
  out.push(fill(C.paper, 0.95 * alpha, [
    [x - ux * r * 0.1 + px * r * 0.34, y - uy * r * 0.1 + py * r * 0.34],
    [x - ux * r * 1.05 + px * r * 0.66, y - uy * r * 1.05 + py * r * 0.66],
    [x - ux * r * 1.05 - px * r * 0.66, y - uy * r * 1.05 - py * r * 0.66],
    [x - ux * r * 0.1 - px * r * 0.34, y - uy * r * 0.1 - py * r * 0.34],
  ]));
  out.push(fill(C.paper, 0.98 * alpha, ringPts(x + ux * r * 0.34, y + uy * r * 0.34, r * 0.46, 1, 12)));
}

/** 球的残影:倒推几帧的位置(重数 = CFG.skills.focus.chronoGhosts) */
function chronoDL(out: Paint[], st: SkillStage, bake: SkillDemoBake, f: number, r: number): void {
  const n = CFG.skills.focus.chronoGhosts;
  for (let i = 1; i <= n; i++) {
    const g = bake.frames[Math.max(0, Math.round(f) - i * 5)];
    if (!g?.ball) continue;
    shuttleDL(out, sxOf(st, g.ball.x), syOf(st, g.ball.y), g.ball.vx, g.ball.vy, 0.42 - i * 0.07, r, true);
  }
}

// ---------- 技能特效(全部只读快照字段) ----------

function fxLunge(out: Paint[], st: SkillStage, sn: DemoSnap, accent: string): void {
  const dashing = sn.lungeT >= 0;
  const tail = sn.autoT > 0;
  if (!dashing && !tail) return;
  const h = CFG.player.h * st.k;
  // 风道画在腰腹那一带(地上那截是腿,画在那儿读成"扫地")
  const y = syOf(st, sn.y) + h * 0.45;
  // 拖尾朝"这一趟的反方向":冲量期看速度,冲完之后看人朝哪儿站
  const dir = Math.abs(sn.vx ?? 0) > 1 ? Math.sign(sn.vx) : sn.facing;
  const a = dashing ? 0.62 : 0.26;
  for (let i = -1; i <= 1; i++) {
    const yy = y + i * h * 0.16;
    out.push(line(accent, a, 2.2, [[sxOf(st, sn.x) - dir * h * 0.30, yy], [sxOf(st, sn.x) - dir * h * (0.86 + 0.1 * i), yy]]));
  }
}

function fxSmash(out: Paint[], st: SkillStage, sn: DemoSnap, accent: string): void {
  if (sn.buffT <= 0) return;
  const SM = CFG.skills.smash;
  const cx = sxOf(st, sn.aim.x), cy = syOf(st, sn.aim.y);
  const r = SM.auraRadius * st.k;
  // 拍面烈焰:火舌数 = flameTongues,长度按剩余附魔衰减(兑现那一拍看得见"烧完了")
  const k = Math.min(1, sn.buffT / SM.buffDuration);
  for (let i = 0; i < SM.flameTongues; i++) {
    const th = (Math.PI * 2 * i) / SM.flameTongues + sn.t * 0.06;
    const len = r * (1.15 + 0.5 * k);
    out.push(line(accent, 0.5 + 0.4 * k, 2.2, [
      [cx + Math.cos(th) * r * 0.5, cy + Math.sin(th) * r * 0.5],
      [cx + Math.cos(th) * len, cy + Math.sin(th) * len],
    ]));
  }
  dashRing(out, cx, cy, r, accent, 0.5, 1.6, 12);
}

function fxFlash(out: Paint[], st: SkillStage, sn: DemoSnap, accent: string): void {
  if (!sn.flashFrom) return;
  const x0 = sxOf(st, sn.flashFrom.x), y0 = syOf(st, sn.flashFrom.y);
  const x1 = sxOf(st, sn.x), y1 = syOf(st, sn.y);
  // 折跃轨迹:一道折线(雷光),起点留一个残影圈 —— 「他从那儿来」必须一眼看出来
  const pts: Pt[] = [[x0, y0]];
  for (let i = 1; i < 4; i++) {
    const u = i / 4;
    pts.push([x0 + (x1 - x0) * u + (i % 2 ? 5 : -5), y0 + (y1 - y0) * u - 4]);
  }
  pts.push([x1, y1]);
  out.push(line(accent, 0.9, 2.6, pts));
  out.push(outline(accent, 0.45, 1.8, ringPts(x0, y0, CFG.player.h * st.k * 0.24, 1, 12)));
}

function fxMagnet(out: Paint[], st: SkillStage, sn: DemoSnap, bake: SkillDemoBake, f: number, accent: string): void {
  const MG = CFG.skills.magnet;
  const pulling = f >= bake.cast && f <= bake.cast + MG.pullFrames;
  if (!pulling || !sn.ball) return;
  const cx = sxOf(st, sn.aim.x), cy = syOf(st, sn.aim.y);
  const r = MG.vortexRadius * st.k;
  dashRing(out, cx, cy, r, accent, 0.75, 2, 14);
  dashRing(out, cx, cy, r * 0.55, accent, 0.45, 1.4, 10);
  // 引力电弧:束数 = arcBranches,从球头接到漩涡
  const bx = sxOf(st, sn.ball.x), by = syOf(st, sn.ball.y);
  for (let i = 0; i < MG.arcBranches; i++) {
    const u = (i + 0.5) / MG.arcBranches;
    const mx = bx + (cx - bx) * 0.5, my = by + (cy - by) * 0.5 - 10 * (u - 0.5);
    out.push(line(accent, 0.5, 1.4, [[bx, by], [mx, my], [cx, cy]]));
  }
}

function fxShadow(out: Paint[], st: SkillStage, sn: DemoSnap): void {
  const SH = CFG.skills.shadow;
  const h = CFG.player.h * st.k;
  for (const c of sn.clones) {
    const tint = SH.slots[c.slot]?.tint ?? C.paper;
    const hop = Math.max(0, CO.groundY - c.y) * st.k;
    personDL(out, sxOf(st, c.x), st.gy, h, c.despawnT > 0 ? 0.35 : 0.8, hop, tint);
    // 头顶剩余次数:pips 数 = 还能接几球(附属读数贴在它描述的头上)
    const left = Math.max(0, SH.maxHits - c.hits);
    for (let i = 0; i < left; i++) {
      const px = sxOf(st, c.x) + (i - (left - 1) / 2) * 6;
      out.push(fill(tint, 0.9, slantQuad(4, 2.4, 0.6, px, st.gy + hop + h * 0.98)));
    }
  }
}

// ---------- 键面(与真机那颗键同一份配色与同一把冷却尺) ----------

function keyDL(out: Paint[], st: SkillStage, sn: DemoSnap, bake: SkillDemoBake, accent: string, charge: boolean): void {
  const { kx, ky } = st;
  const R = SKD.keyR;
  const pressed = sn.t >= bake.cast && sn.t <= bake.cast + 6;
  out.push(fill(pressed ? SKIN.downFill : SKIN.idleFill, 0.92, ringPts(kx, ky, R, 1, 20)));
  out.push(outline(pressed ? SKIN.downEdge : SKIN.idleEdge, 0.9, 2.2, ringPts(kx, ky, R, 1, 20)));
  if (charge) {
    // 充能款:键面不画倒计时,画「攒了几管 + 这一管几成」(口径同真键的蓄能环)
    const RG = CFG.skills.rage;
    const pipes = Math.min(RG.pipes, Math.floor(sn.rage / RG.max));
    const fillRatio = (sn.rage % RG.max) / RG.max;
    for (let i = 0; i < RG.pipes; i++) {
      const on = i < pipes || (i === pipes && fillRatio > 0.02);
      const th0 = Math.PI * 0.5 - (Math.PI * 2 * (i + 0.86)) / RG.pipes;
      const th1 = Math.PI * 0.5 - (Math.PI * 2 * (i + 0.14)) / RG.pipes;
      const upto = i === pipes ? th0 + (th1 - th0) * fillRatio : th1;
      out.push(line(on ? accent : C.line, on ? 0.95 : 0.5, 3.4, fanPts(kx, ky, R - 3, th0, upto, 6).slice(1)));
    }
  } else if (sn.cd > 0 && sn.maxCd > 0) {
    const arcs = cdArcs(sn.cd / sn.maxCd);
    out.push(fill(C.ink, 0.62, fanPts(kx, ky, R - 1, arcs.pie0, arcs.pie1)));
    out.push(line(accent, 0.9, 2.4, fanPts(kx, ky, R - 1, arcs.ring0, arcs.ring1).slice(1)));
  } else if (sn.ready) {
    // 就绪:键缘亮起来 —— 演示里"什么时候能按"就靠这一眼
    out.push(outline(accent, 0.95, 2.6, ringPts(kx, ky, R - 3, 1, 18)));
  }
  if (pressed) {
    const k = (sn.t - bake.cast) / 6;
    out.push(outline(C.paper, 0.8 * (1 - k), 2, ringPts(kx, ky, R + 2 + k * 12, 1, 20)));
  }
}

// ---------- 一帧 ----------

/** 第 t 帧(浮点帧号,内部取模)的完整显示列表。w/h = 图示盒宽高。 */
export function skillDiagramDL(id: SkillId, t: number, w: number, h: number): Paint[] {
  const bake = SkillDemo.bake(id);
  const st = stageOf(w, h);
  const out: Paint[] = [];
  if (!bake) return out;
  const f = ((Math.floor(t) % bake.loop) + bake.loop) % bake.loop;
  const sn = bake.frames[f];
  const def = Skills.defOf(id);
  const accent = def.accent;
  /** 人物在图里的实际身高:球、特效的尺寸都从它推,镜头一变整格一起变(而不是各拍各的) */
  const ph = CFG.player.h * st.k;
  courtDL(out, st, id === "focus" && sn.focusT > 0, accent);
  if (id === "focus" && sn.focusT > 0) chronoDL(out, st, bake, f, ph * SKD.shuttleOfH);
  if (id === "shadow") fxShadow(out, st, sn);
  if (sn.ball) shuttleDL(out, sxOf(st, sn.ball.x), syOf(st, sn.ball.y), sn.ball.vx, sn.ball.vy, 1, ph * SKD.shuttleOfH);
  // 判定圈:只有"够不够得着"是卖点的那几款才画(闪现画的是折跃后的那一个)
  const showZone = id === "lunge" || id === "flash" || id === "focus";
  if (showZone) {
    const hot = sn.lungeT >= 0 || sn.autoT > 0 || sn.flashHoldT > 0 || sn.focusT > 0;
    dashRing(out, sxOf(st, sn.zone.x), syOf(st, sn.zone.y), sn.zone.r * st.k, accent,
      hot ? 0.72 : 0.2, 1.6, 14);
  }
  const hop = Math.max(0, CO.groundY - sn.y) * st.k;
  personDL(out, sxOf(st, sn.x), st.gy, ph, 1, hop);
  if (id === "lunge") fxLunge(out, st, sn, accent);
  if (id === "smash" || id === "rage") fxSmash(out, st, sn, accent);
  if (id === "flash") fxFlash(out, st, sn, accent);
  if (id === "magnet") fxMagnet(out, st, sn, bake, f, accent);
  keyDL(out, st, sn, bake, accent, def.kind === "charge");
  return out;
}

/** 一帧画多少笔(skill-dialog 的每帧成本探针,判据在 skill-check) */
export function skillDiagramStrokeCount(id: SkillId, t: number, w: number, h: number): number {
  return skillDiagramDL(id, t, w, h).length;
}

export interface DemoCallout { x: number; y: number; text: string; hex: string }

/**
 * 这一帧该标的字(交出去由面板摆 Label)。
 * 每个数都是从快照与 CFG 现算的 —— 与画面上那个圈/那条弧是同一份真值,
 * 所以"标的"与"画的"不会各说各话(标注写 ×1.5 而圈按 1.55 画,就是第二把尺子)。
 */
export function skillDemoCallouts(id: SkillId, t: number, w: number, h: number): DemoCallout[] {
  const bake = SkillDemo.bake(id);
  if (!bake) return [];
  const st = stageOf(w, h);
  const f = ((Math.floor(t) % bake.loop) + bake.loop) % bake.loop;
  const sn = bake.frames[f];
  const def = Skills.defOf(id);
  const out: DemoCallout[] = [];
  const near = (wx: number, wy: number, dy: number, text: string, hex = def.accent): void => {
    out.push({ x: sxOf(st, wx), y: syOf(st, wy) + dy, text, hex });
  };
  if (f < bake.cast) {
    near(sn.x, CO.groundY - CFG.player.h, -14, sn.ready ? "可以按" : "等着", sn.ready ? C.good : C.dimDeep);
    return out;
  }
  if (f > bake.cast + 6 && f < bake.hit) {
    near(sn.x, sn.y - CFG.player.h * 0.5, -12, "已按下 · 等这一拍", C.dim);
  }
  switch (id) {
    case "lunge":
      if (sn.lungeT >= 0 || sn.autoT > 0) {
        near(sn.zone.x + sn.zone.r, sn.zone.y, 0, `×${CFG.lunge.reachMul}`);
        near(sn.x, CO.groundY, 12, `${Math.round(CFG.lunge.speed * CFG.lunge.duration)} px`);
      }
      break;
    case "smash":
      if (sn.buffT > 0) near(sn.aim.x, sn.aim.y, 16, "附魔中 · 到点替你轰");
      break;
    case "rage":
      if (sn.buffT > 0) near(sn.aim.x, sn.aim.y, 16, `怒气 ${Math.round(Math.min(1, sn.rage / CFG.skills.rage.max) * 100)}%`);
      break;
    case "flash":
      if (sn.flashHoldT > 0) near(sn.x, sn.y - CFG.player.h, -14, "时停 · 必定劈扣");
      break;
    case "magnet":
      if (f <= bake.cast + CFG.skills.magnet.pullFrames && sn.ball) {
        near(sn.ball.x, sn.ball.y, 14, `${CFG.skills.magnet.pullFrames} 帧抓回拍前`);
      }
      break;
    case "focus":
      if (sn.focusT > 0) near(sn.x, CO.groundY - CFG.player.h, -14, `球 ${Math.round(CFG.skills.focus.ballSlow * 100)}% · 我 ×${CFG.skills.focus.playerSpeedMul}`);
      break;
    case "shadow":
      for (const c of sn.clones) {
        near(c.x, CO.groundY - CFG.player.h, -10, `${c.slot + 1} 号`, CFG.skills.shadow.slots[c.slot]?.tint ?? C.paper);
      }
      break;
  }
  if (sn.hit) near(sn.x, CO.groundY - CFG.player.h, -16, sn.auto ? "这一拍是它替你打的" : "兑现", C.acid);
  return out;
}
