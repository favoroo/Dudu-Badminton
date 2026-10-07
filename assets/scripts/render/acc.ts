// ============================================================
// 配饰画法:商店配饰(墨镜/口罩/围巾/球鞋/手套)的全部笔画。
// 数据真话在 config.ACCESSORIES(style/slot/三色),佩戴挂载点由 slot 决定,
// sprites.drawPlayer/drawHead 在身体对应部位按本表的 hook 接线 —— 这里只画不算。
//
// 三条不变量(与 aura.ts 同款纪律):
//  · **零状态只画不算**:不写任何逻辑字段、不持有可变模块状态;
//  · **禁逐帧 rand**:所有"随机"形状(星芒相位/围巾波纹)都是 def.id 哈希的
//    纯函数(mulberry32 出生定形),逐帧只做 sin 摆动与 alpha —— 逐帧重掷会抖成噪点;
//  · **同一把变换尺**:一律吃 sprites 传进来的 Frame(draw-kit),配饰自动跟随
//    facing 镜像/挤压/视口缩放,绝不在本文件里另算一套坐标。
//
// 新配饰 = config.ACCESSORIES 加一条数据(复用现有 style 时零绘制代码);
// 需要新画法时在这里加一个 style hook,tools/accessory-check.ts 会核对每个
// def.style 都已注册(未注册 = 商店卡有货、身上永远画不出来,必须拦)。
// ============================================================
import { Color, Graphics } from "cc";
import { CFG } from "../core/config";
import { AccessoryDef } from "../core/types";
import { mulberry32 } from "./p5kit";
import { pal, withAlpha } from "./palette";
import { arm, arcPts, circleAA, lineSeg, polyPath, pooledPt, px, scaledFrame } from "./draw-kit";
import type { Frame, Pt, Viewport } from "./draw-kit";

const C = CFG;
const PAPER = "#f2efe6";   // 纸白:鞋底/高光共用全站底色
const INK_LINE = "rgba(10,13,24,0.55)";

/** def 三色的兜底读法:dark 缺省压向墨、accent 缺省走纸白 */
function accCols(def: AccessoryDef): { main: string; dark: string; accent: string } {
  return { main: def.main, dark: def.dark ?? "#0c0e14", accent: def.accent ?? PAPER };
}

/** id → 稳定种子(FNV-1a):同 id 恒同形,"出生定形"的种子来源 */
export function accSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---------- 面部槽:墨镜 / 口罩(drawHead 五官之后调用,头中心 cx,cy 半径 hr) ----------

/** 斜切四边镜片:P5 语汇拒绝圆框,镜片是一块上缘外斜的平行四边形 */
function lensQuad(f: Frame, lx: number, ly: number, hw: number, hh: number, skew: number): Pt[] {
  return [
    f.pt(lx - hw, ly - hh + skew),
    f.pt(lx + hw, ly - hh - skew),
    f.pt(lx + hw * 0.92, ly + hh),
    f.pt(lx - hw * 0.92, ly + hh + skew * 0.6),
  ];
}

/** 四尖星芒(出生定形相位,每 ~2.1s 闪一次):墨镜镜角的点缀 */
function glint(g: Graphics, f: Frame, x: number, y: number, r: number, color: string, phase: number, t: number): void {
  const s = Math.max(0, Math.sin(t * 0.045 + phase * Math.PI * 2)) ** 6;
  if (s < 0.05) return;
  const rr = r * s;
  const pts = [
    f.pt(x, y - rr), f.pt(x + rr * 0.22, y - rr * 0.22), f.pt(x + rr, y),
    f.pt(x + rr * 0.22, y + rr * 0.22), f.pt(x, y + rr),
    f.pt(x - rr * 0.22, y + rr * 0.22), f.pt(x - rr, y),
    f.pt(x - rr * 0.22, y - rr * 0.22),
  ];
  g.fillColor = withAlpha(pal(color), 0.92);
  polyPath(g, pts, true);
  g.fill();
}

function drawShadesFace(g: Graphics, f: Frame, def: AccessoryDef, hr: number, cx: number, cy: number, t: number): void {
  const col = accCols(def);
  const seed = mulberry32(accSeed(def.id));
  const phase = seed();
  // 3/4 透视:近镜大、远镜小(基线沿用五官的近/远眼位,镜片压在眼上)
  const nLx = cx + hr * 0.40, nLy = cy + hr * 0.06;
  const fLx = cx - hr * 0.14, fLy = cy + hr * 0.10;
  const nHw = hr * 0.30, nHh = hr * 0.19;
  const fHw = hr * 0.23, fHh = hr * 0.15;
  // 镜腿先画(压在镜片后面):外角 → 耳侧
  g.strokeColor = pal(col.main);
  g.lineWidth = f.lw(1.6);
  lineSeg(g, f, nLx + nHw * 0.9, nLy - nHh * 0.4, cx + hr * 0.88, cy + hr * 0.16);
  lineSeg(g, f, fLx - fHw * 0.9, fLy - fHh * 0.4, cx - hr * 0.86, cy + hr * 0.10);
  g.stroke();
  // 镜片:暗面填充 + 主色框
  for (const [lx, ly, hw, hh] of [[nLx, nLy, nHw, nHh], [fLx, fLy, fHw, fHh]] as const) {
    g.fillColor = pal(col.dark);
    polyPath(g, lensQuad(f, lx, ly, hw, hh, hh * 0.5), true);
    g.fill();
    g.strokeColor = pal(col.main);
    g.lineWidth = f.lw(1.3);
    polyPath(g, lensQuad(f, lx, ly, hw, hh, hh * 0.5), true);
    g.stroke();
  }
  // 鼻梁架:两镜内角之间一道主色横梁
  g.strokeColor = pal(col.main);
  g.lineWidth = f.lw(2.0);
  lineSeg(g, f, nLx - nHw * 0.95, nLy - nHh * 0.55, fLx + fHw * 0.95, fLy - fHh * 0.55);
  g.stroke();
  // 镜面反光:两道**静止**的斜向白条(位置固定不出镜,只呼吸 alpha ——
  // 会滑动的反光要裁剪才不出镜,Graphics 没有裁剪,别改)
  g.fillColor = withAlpha(pal("#ffffff"), 0.16 + 0.08 * Math.sin(t * 0.03 + phase * 6.28));
  polyPath(g, [f.pt(nLx - nHw * 0.55, nLy + nHh * 0.8), f.pt(nLx - nHw * 0.1, nLy + nHh * 0.8),
    f.pt(nLx + nHw * 0.25, nLy - nHh * 0.75), f.pt(nLx - nHw * 0.4, nLy - nHh * 0.75)], true);
  g.fill();
  g.fillColor = withAlpha(pal("#ffffff"), 0.10 + 0.06 * Math.sin(t * 0.026 + 1.7));
  polyPath(g, [f.pt(fLx - fHw * 0.5, fLy + fHh * 0.8), f.pt(fLx - fHw * 0.15, fLy + fHh * 0.8),
    f.pt(fLx + fHw * 0.3, fLy - fHh * 0.7), f.pt(fLx - fHw * 0.3, fLy - fHh * 0.7)], true);
  g.fill();
  // 点缀星芒:近镜外上角,accent 色出生定形相位
  glint(g, f, nLx + nHw * 0.85, nLy - nHh * 1.1, 2.6, col.accent, phase, t);
}

function drawMaskFace(g: Graphics, f: Frame, def: AccessoryDef, hr: number, cx: number, cy: number, t: number): void {
  const col = accCols(def);
  // 挂耳带先画(不随呼吸缩放):口罩两缘 → 耳侧。口罩只罩鼻嘴,上缘压在眼下缘之下
  // (眼在 cy+0.10hr~0.14hr,罩面从 cy+0.26hr 起 —— 盖住眼睛就成"蒙眼布"不是口罩)
  g.strokeColor = withAlpha(pal(col.dark), 0.9);
  g.lineWidth = f.lw(1.4);
  lineSeg(g, f, cx - hr * 0.54, cy + hr * 0.36, cx - hr * 0.86, cy + hr * 0.22);
  lineSeg(g, f, cx + hr * 0.60, cy + hr * 0.32, cx + hr * 0.88, cy + hr * 0.28);
  g.stroke();
  // 罩面以自身中心呼吸(±2%,与人物呼吸同数量级,读作"在喘气"而不是"在抖")
  const sf = scaledFrame(f, cx + hr * 0.05, cy + hr * 0.58, 1 + 0.02 * Math.sin(t * 0.05));
  const x0 = -hr * 0.58, x1 = hr * 0.62, y0 = -hr * 0.32, y1 = hr * 0.33;
  g.fillColor = pal(col.main);
  polyPath(g, [
    sf.pt(x0, y0 + 1.4), sf.pt(x1 - 0.6, y0), sf.pt(x1, y1 - 1.2), sf.pt(x0 + 0.8, y1),
  ], true);
  g.fill();
  g.strokeColor = withAlpha(pal(col.dark), 0.8);
  g.lineWidth = f.lw(1.2);
  polyPath(g, [
    sf.pt(x0, y0 + 1.4), sf.pt(x1 - 0.6, y0), sf.pt(x1, y1 - 1.2), sf.pt(x0 + 0.8, y1),
  ], true);
  g.stroke();
  // 两条斜褶线:P5 斜切语汇,顺罩面斜率走
  g.strokeColor = withAlpha(pal(col.dark), 0.42);
  g.lineWidth = f.lw(1.1);
  lineSeg(g, sf, x0 + 1.4, y0 + (y1 - y0) * 0.38, x1 - 1.6, y0 + (y1 - y0) * 0.30);
  lineSeg(g, sf, x0 + 1.8, y0 + (y1 - y0) * 0.70, x1 - 2.0, y0 + (y1 - y0) * 0.62);
  g.stroke();
  // 点缀斜贴片:近侧下角一小块 accent 平行四边形(口罩上唯一的彩色)
  g.fillColor = pal(col.accent);
  polyPath(g, [
    sf.pt(x1 - 3.4, y1 - 2.6), sf.pt(x1 - 1.2, y1 - 3.1), sf.pt(x1 - 1.5, y1 - 1.7), sf.pt(x1 - 3.7, y1 - 1.2),
  ], true);
  g.fill();
}

// ---------- 上身槽:围巾(飘尾在躯干之前画、颈圈在躯干之后画,两段式景深) ----------

/** 围巾两段式的锚点与激励(sprites.drawPlayer 现算好传入,这里不算坐标) */
export interface AccNeck {
  /** 颈部中心(局部 canvas 坐标,y 向下) */
  x: number;
  y: number;
  /** 渲染帧时钟 */
  t: number;
  /** 跑动相位 0..1(飘尾摆幅激励) */
  run: number;
  /** 空中相位 0..1(离地风激励:飘得更高更散) */
  air: number;
}

/** 飘尾(躯干之前调用 → 压在身体后面):沿正弦曲线分 4 段渐细的缎带 + 尾端流苏。
 *  波形 = 出生定形相位/卷曲 + 逐帧 sin 摆动,摆幅由跑动/离地激励 —— 站着也微微飘。 */
function drawScarfBack(g: Graphics, f: Frame, def: AccessoryDef, n: AccNeck): void {
  const col = accCols(def);
  const seed = mulberry32(accSeed(def.id));
  const phase = seed();
  const curl = (seed() - 0.35) * 1.6;          // 出生定形:这条围巾天生垂多少/翘多少
  const amp = 1.5 + n.run * 2.8 + n.air * 2.4; // 摆幅:站立 < 跑动 < 离地
  const droop = 1.05 - n.air * 0.55;           // 离地时尾梢整体上扬
  const segN = 4, segLen = 5.6;
  // 缎带中轴线:向背后(-x)铺开,逐段加波
  const cx: number[] = [], cy2: number[] = [];
  for (let i = 0; i <= segN; i++) {
    cx.push(n.x - 4 - i * segLen);
    cy2.push(n.y - 0.5 + i * i * 0.42 * droop + curl * i * 0.5
      + Math.sin(n.t * 0.085 + i * 1.05 + phase * Math.PI * 2) * amp * (0.2 + i * 0.24));
  }
  // 分段渐细描成缎带(圆头相接)
  for (let i = 0; i < segN; i++) {
    arm(g, f, col.main, [{ x: cx[i], y: cy2[i] }, { x: cx[i + 1], y: cy2[i + 1] }], 5.4 - i * 0.9);
  }
  // 中线 accent 条(细、半透明,读作织纹)
  g.strokeColor = withAlpha(pal(col.accent), 0.75);
  g.lineWidth = f.lw(1.1);
  for (let i = 0; i < segN; i++) {
    lineSeg(g, f, cx[i] + 0.4, cy2[i] - 1.1, cx[i + 1] + 0.4, cy2[i + 1] - 1.1);
  }
  g.stroke();
  // 尾端流苏:三根短刺沿末段方向扇开(锯齿语汇,不圆头)
  const dx = cx[segN] - cx[segN - 1], dy = cy2[segN] - cy2[segN - 1];
  const dl = Math.hypot(dx, dy) || 1;
  const ux = dx / dl, uy = dy / dl;
  g.lineWidth = f.lw(1.5);
  for (const s of [-0.55, 0, 0.55]) {
    const ca = Math.cos(s), sa = Math.sin(s);
    const tx = ux * ca - uy * sa, ty = ux * sa + uy * ca;
    lineSeg(g, f, cx[segN], cy2[segN], cx[segN] + tx * 2.6, cy2[segN] + ty * 2.6);
  }
  g.strokeColor = pal(col.dark);
  g.stroke();
}

/** 颈圈 + 前结(躯干之后、头之前调用 → 上压头、下压衣,自然景深) */
function drawScarfFront(g: Graphics, f: Frame, def: AccessoryDef, n: AccNeck): void {
  const col = accCols(def);
  const seed = mulberry32(accSeed(def.id));
  const phase = seed();
  const wob = Math.sin(n.t * 0.06 + phase * 6.28) * 0.8;   // 颈圈随呼吸微微错动
  // 双绕颈圈:两道横带,下缘一道暗边
  px(g, f, n.x - 7.2, n.y - 3.4 + wob * 0.3, 14.6, 4.4, col.main);
  px(g, f, n.x - 7.2, n.y + 0.6 + wob * 0.3, 14.6, 1.3, col.dark);
  px(g, f, n.x - 6.6, n.y + 1.6 - wob * 0.2, 13.4, 2.6, col.main);
  // 斜向 accent 织纹:一道从背侧劈向前下的亮条
  g.strokeColor = withAlpha(pal(col.accent), 0.9);
  g.lineWidth = f.lw(1.7);
  lineSeg(g, f, n.x - 5.2, n.y - 3.0 + wob * 0.3, n.x + 4.2, n.y + 1.4 + wob * 0.3);
  g.stroke();
  // 前结:斜切四边小结 + 一道 accent 折角
  g.fillColor = pal(col.main);
  polyPath(g, [
    f.pt(n.x + 5.6, n.y - 2.8 + wob * 0.4), f.pt(n.x + 9.2, n.y - 0.6 + wob * 0.4),
    f.pt(n.x + 7.6, n.y + 2.9 + wob * 0.4), f.pt(n.x + 4.2, n.y + 1.1 + wob * 0.4),
  ], true);
  g.fill();
  g.strokeColor = withAlpha(pal(col.dark), 0.8);
  g.lineWidth = f.lw(1.1);
  polyPath(g, [
    f.pt(n.x + 5.6, n.y - 2.8 + wob * 0.4), f.pt(n.x + 9.2, n.y - 0.6 + wob * 0.4),
    f.pt(n.x + 7.6, n.y + 2.9 + wob * 0.4), f.pt(n.x + 4.2, n.y + 1.1 + wob * 0.4),
  ], true);
  g.stroke();
  g.fillColor = pal(col.accent);
  polyPath(g, [
    f.pt(n.x + 6.1, n.y - 1.6 + wob * 0.4), f.pt(n.x + 8.4, n.y - 0.2 + wob * 0.4),
    f.pt(n.x + 7.7, n.y + 1.8 + wob * 0.4),
  ], true);
  g.fill();
}

// ---------- 下身槽:球鞋(腿循环里替换素色鞋块;踝点 fx,fy,远侧腿压暗) ----------

function drawSneakerFoot(g: Graphics, f: Frame, def: AccessoryDef, fx: number, fy: number, alpha: number): void {
  const col = accCols(def);
  const a = (c: string): Color => withAlpha(pal(c), alpha);
  // 鞋帮(主色)+ 后跟领口加高
  px(g, f, fx - 2.9, fy - 2.7, 12.8, 5.5, a(col.main));
  px(g, f, fx - 3.1, fy - 3.5, 4.6, 1.6, a(col.main));
  // 鞋头护罩(暗色)
  px(g, f, fx + 6.2, fy + 0.1, 3.9, 2.6, a(col.dark));
  // 中底分色线 + 纸白厚底
  px(g, f, fx - 3.3, fy + 2.6, 13.7, 0.8, a(col.dark));
  px(g, f, fx - 3.3, fy + 3.3, 13.7, 2.6, a(PAPER));
  // 点缀斜切条(网侧一道 accent)+ 鞋带两道斜杠
  g.strokeColor = a(col.accent);
  g.lineWidth = f.lw(1.8);
  lineSeg(g, f, fx + 0.7, fy - 1.7, fx + 7.4, fy + 1.5);
  g.stroke();
  g.strokeColor = a(col.dark);
  g.lineWidth = f.lw(1.2);
  lineSeg(g, f, fx + 0.1, fy - 2.1, fx + 2.0, fy - 1.6);
  lineSeg(g, f, fx + 1.5, fy - 2.7, fx + 3.4, fy - 2.2);
  g.stroke();
  // 后跟提环(accent)
  px(g, f, fx - 3.7, fy - 3.3, 1.2, 1.9, a(col.accent));
}

// ---------- 手部槽:手套(drawHand 的替换画;dir = 手 → 腕的单位向量) ----------

export function drawAccGlove(g: Graphics, f: Frame, def: AccessoryDef,
  hx: number, hy: number, r: number, alpha: number, dx: number, dy: number): void {
  const col = accCols(def);
  const a = (c: string, k = 1): Color => withAlpha(pal(c), alpha * k);
  // 掌面:手套主色整颗替换肤色(圆头与原手一致, Silhouette 不跳)
  g.fillColor = a(col.main);
  circleAA(g, f, hx, hy, r + 0.3);
  g.fill();
  g.strokeColor = a(col.dark, 0.8);
  g.lineWidth = f.lw(1.1);
  circleAA(g, f, hx, hy, r + 0.3);
  g.stroke();
  // 腕口束带:垂直于小臂方向的一条 accent 短带
  const px2 = -dy, py2 = dx;                       // 小臂方向的垂直向量
  const wx = hx + dx * (r + 1.0), wy = hy + dy * (r + 1.0);
  const cw = r * 0.95, ct = 1.25;
  g.fillColor = a(col.accent);
  polyPath(g, [
    f.pt(wx + px2 * cw - dx * ct, wy + py2 * cw - dy * ct),
    f.pt(wx + px2 * cw + dx * ct, wy + py2 * cw + dy * ct),
    f.pt(wx - px2 * cw + dx * ct, wy - py2 * cw + dy * ct),
    f.pt(wx - px2 * cw - dx * ct, wy - py2 * cw - dy * ct),
  ], true);
  g.fill();
  // 指节缝线:掌背一道浅色弧线(垂直于小臂方向拱起,读作"这是手套不是手")
  const kx = hx - dx * r * 0.2, ky = hy - dy * r * 0.2;
  const base = Math.atan2(py2, px2);
  g.strokeColor = a(col.dark, 0.5);
  g.lineWidth = f.lw(1.0);
  polyPath(g, arcPts(f, kx, ky, r * 0.62, base - 0.9, base + 0.9, false), false);
  g.stroke();
}

// ---------- 卡片/预览静置画:单件商品画(商店缩略图与 acc-preview 出图共用) ----------

/** 试穿预览/卡片静置:统一入口,按 style 分发;未知 style 兜空(accessory-check 会拦) */
export function drawAccStill(g: Graphics, vp: Viewport, def: AccessoryDef, t: number): void {
  const st = ACC_STYLES[def.style];
  st?.still?.(g, vp, def, t);
}

/** 静置画的公共帧:单位 = 卡片局部 px,锚点(0,0)= 商品中心,scale 由调用方给 */
function stillFrame(vp: Viewport, scale: number): Frame {
  return {
    pt: (lx, ly) => {
      const p = pooledPt();
      p.x = vp.x(lx * scale);
      p.y = vp.y(ly * scale);
      return p;
    },
    lw: (v) => v * scale,
    kx: scale, ky: scale,
  };
}

/** 面部商品卡的脸底圆盘:墨镜/口罩是「戴在脸上的东西」,深色件直接画在暗卡上认不出 ——
 *  给一张肤色脸圆当展台,商品一眼可辨(与真机脸部同一支笔,不算另抄配色) */
function faceDisc(g: Graphics, f: Frame, r: number): void {
  g.fillColor = pal("#f2c491");
  circleAA(g, f, 0, 0, r);
  g.fill();
  g.strokeColor = withAlpha(pal("#0a0e18"), 0.5);
  g.lineWidth = f.lw(1.2);
  circleAA(g, f, 0, 0, r);
  g.stroke();
}

function stillShades(g: Graphics, vp: Viewport, def: AccessoryDef, t: number): void {
  // 缩放按 64 宽的卡片缩略图校准:镜腿全宽 ~37 局部单位 ×1.5 ≈ 56px,不顶出卡框
  const f = stillFrame(vp, 1.5);
  faceDisc(g, f, 17);
  drawShadesFace(g, f, def, 21, 0, 0, t);
}

function stillMask(g: Graphics, vp: Viewport, def: AccessoryDef, t: number): void {
  const f = stillFrame(vp, 1.8);   // 脸盘 d~34 局部单位 ×1.8 ≈ 61px,装进 64 宽的卡
  faceDisc(g, f, 17);
  drawMaskFace(g, f, def, 21, 0, -1, t);
}

function stillScarf(g: Graphics, vp: Viewport, def: AccessoryDef, t: number): void {
  // 挂展姿势(圈 + 双垂尾)全高 ~40 局部单位 ×1.25 ≈ 50px
  const f = stillFrame(vp, 1.25);
  // 圈 + 双垂尾的"挂展"姿势:尾梢慢波
  const col = accCols(def);
  const seed = mulberry32(accSeed(def.id));
  const phase = seed();
  // 展开的环:椭圆双圈
  g.strokeColor = pal(col.main);
  g.lineWidth = f.lw(6.2);
  polyPath(g, arcPts(f, -2, -8, 12.5, Math.PI * 0.06, Math.PI * 1.94, false), true);
  g.stroke();
  g.strokeColor = withAlpha(pal(col.dark), 0.75);
  g.lineWidth = f.lw(1.3);
  polyPath(g, arcPts(f, -2, -8, 15.7, Math.PI * 0.06, Math.PI * 1.94, false), true);
  g.stroke();
  g.strokeColor = pal(col.main);
  g.lineWidth = f.lw(6.2);
  polyPath(g, arcPts(f, -2, -8, 9.5, Math.PI * 1.1, Math.PI * 2.5, false), false);
  g.stroke();
  // 两条垂尾(一长一短,慢波)
  for (const [ax, len, ph] of [[3, 15, 0], [-4.5, 10, 1.4]] as const) {
    const segN = 3, segLen = len / segN;
    let x: number = ax, y = 2;
    for (let i = 0; i < segN; i++) {
      const nx2 = x + 1.6 + Math.sin(t * 0.075 + phase * 6.28 + ph + i * 1.2) * (1.6 + i * 1.3);
      const ny2 = y + segLen;
      arm(g, f, col.main, [{ x, y }, { x: nx2, y: ny2 }], 5.2 - i * 0.9);
      x = nx2; y = ny2;
    }
  }
  // accent 织纹斜条一道
  g.strokeColor = withAlpha(pal(col.accent), 0.9);
  g.lineWidth = f.lw(2.0);
  lineSeg(g, f, -11, -13, 4, -19);
  g.stroke();
}

function stillSneaker(g: Graphics, vp: Viewport, def: AccessoryDef, t: number): void {
  const f = stillFrame(vp, 2.6);   // 侧视全宽 ~17.5 局部单位 ×2.6 ≈ 45px
  // 侧视球鞋(与上身画同一支笔):踝点对齐 (0,-1)
  drawSneakerFoot(g, f, def, -2, -4.5, 1);
  // 静置专属:鞋底下再垫一道投影线,商品"落得住"
  px(g, f, -8, 7.6, 18, 1.4, withAlpha(pal("#000000"), 0.18));
}

function stillGloves(g: Graphics, vp: Viewport, def: AccessoryDef, t: number): void {
  const f = stillFrame(vp, 2.4);   // 一副两只,横跨 ~20 局部单位 ×2.4 ≈ 48px
  // 掌心朝前的一只 + 腕口朝下
  drawAccGlove(g, f, def, 0, -2, 6.2, 1, 0.12, 0.99);
  // 静置专属:第二只斜搭在后面(一副手套);压暗别太狠 —— 深色手套压在暗卡上只剩黄腕带
  drawAccGlove(g, f, def, 9.5, 3.5, 5.2, 0.8, 0.35, 0.94);
  // 掌背一道纸白斜高光:深色手套在暗色卡上的"皮革反光"
  g.strokeColor = withAlpha(pal(PAPER), 0.30);
  g.lineWidth = f.lw(1.4);
  lineSeg(g, f, -3.6, -4.6, 1.6, -0.6);
  g.stroke();
}

// ---------- 注册表:key → 各挂载点的画法 hook(全可选,按 slot 取用) ----------

export interface AccStyle {
  /** 面部槽:drawHead 五官之后(g, f, def, hr, cx, cy, t) */
  face?: (g: Graphics, f: Frame, def: AccessoryDef, hr: number, cx: number, cy: number, t: number) => void;
  /** 上身槽·背段:drawPlayer 躯干之前(g, f, def, 颈锚点) */
  back?: (g: Graphics, f: Frame, def: AccessoryDef, n: AccNeck) => void;
  /** 上身槽·前段:drawPlayer 躯干之后、头之前(g, f, def, 颈锚点) */
  front?: (g: Graphics, f: Frame, def: AccessoryDef, n: AccNeck) => void;
  /** 下身槽:腿循环替换素色鞋块(g, f, def, 踝x, 踝y, 远侧alpha) */
  foot?: (g: Graphics, f: Frame, def: AccessoryDef, fx: number, fy: number, alpha: number) => void;
  /** 手部槽:drawHand 替换画(g, f, def, 手x, 手y, 手r, alpha, 腕向dx, 腕向dy) */
  hand?: (g: Graphics, f: Frame, def: AccessoryDef, hx: number, hy: number, r: number, alpha: number, dx: number, dy: number) => void;
  /** 商店卡/预览静置画(g, vp, def, t) */
  still?: (g: Graphics, vp: Viewport, def: AccessoryDef, t: number) => void;
}

/** 配饰画法注册表:新画法 = 写 hook 挂进来 + config.ACCESSORIES 引用 key */
export const ACC_STYLES: Record<string, AccStyle> = {
  shades: { face: drawShadesFace, still: stillShades },
  mask: { face: drawMaskFace, still: stillMask },
  scarf: { back: drawScarfBack, front: drawScarfFront, still: stillScarf },
  sneaker: { foot: drawSneakerFoot, still: stillSneaker },
  gloves: { hand: drawAccGlove, still: stillGloves },
};
