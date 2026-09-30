// ============================================================
// P5 绘图构件(render 层共享):尖刺爆裂环 / 锥形集中线 / 落点准星 /
// 星芒 / 飘字底板 / 斩劈 cut-in 斜带。
// 与 ui/ui-arcade.ts 是「同形不同源」的有意复制:UI 层绑定 ARCADE
// 色板与 retained 一次绘制,这里全部由调用方传色(Color 实例)、
// 服务于 world 层每帧 clear+重绘的立即模式 —— render 不反向依赖 ui。
// 零 rand 约定:随机形状只在「出生」时用 mulberry32(seed) 定死,
// 逐帧绘制只做缩放与透明度衰减 —— 同一种子同形状,绝不逐帧抖闪。
// 所有坐标均为「调用方已变换好的本地坐标」:fx.ts 传 Viewport 换算后的
// 屏幕坐标,world.ts 飘字/屏幕特效层直接用节点本地坐标。
// ============================================================
import { Color, Graphics } from "cc";
import { TAU, clamp } from "../core/utils";
import { withAlpha } from "./palette";

// ---------- 确定性随机:出生定形,逐帧零 rand ----------

/**
 * mulberry32:32 位种子的小型 PRNG,纯函数无状态外泄。
 * 每个锯齿环出生时取一个种子,从此形状终身不变 —— 扩散中的环
 * 若逐帧重掷尖刺,读起来就是一团抖动的噪点而不是"炸开的那一下"。
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 每环顶点上限(尖刺数 ×2);池按 MAX_R × 此值预分配 */
export const SPIKE_VERTS = 24;

/**
 * 出生时生成锯齿环顶点乘数,写入 dst[off..off+SPIKE_VERTS):
 * 偶数点 = 外径(≈1)、奇数点 = 内径(inK),再叠 ±jagK 径向抖动。
 * 返回实际顶点数(2N,恒为偶数);调用方逐帧只乘当前半径 r。
 */
export function fillSpikes(
  dst: Float32Array, off: number, seed: number,
  nMin: number, nMax: number, inK: number, jagK: number,
): number {
  const rng = mulberry32(seed);
  const n = nMin + Math.floor(rng() * (nMax - nMin + 1));
  const count = Math.min(Math.floor(dst.length - off), n * 2);
  for (let v = 0; v < count; v++) {
    const base = v % 2 === 0 ? 1 : inK;
    dst[off + v] = base * (1 + jagK * (rng() * 2 - 1));
  }
  return count;
}

// ---------- 尖刺爆裂环 ----------

/**
 * P5 爆裂锯齿环:尖刺多边形描边,双 pass(宽而暗的外晕 + 窄而亮的芯),
 * 与平滑椭圆环同一套辉光近似语义。verts 里的乘数 × r 得每顶点半径;
 * yK 为纵向压扁系数(贴地冲击波用 <1)。
 */
export function drawSpikeRing(
  g: Graphics, cx: number, cy: number, r: number, yK: number,
  verts: Float32Array, off: number, count: number, rot: number,
  color: Color, alpha: number, width: number, haloK: number, haloA: number,
): void {
  if (alpha <= 0.006 || r < 0.6 || count < 6) return;
  const step = TAU / count;
  const trace = (): void => {
    for (let v = 0; v < count; v++) {
      const a = rot + v * step;
      const pr = verts[off + v] * r;
      const x = cx + Math.cos(a) * pr;
      const y = cy + Math.sin(a) * pr * yK;
      if (v === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.close();
  };
  g.strokeColor = withAlpha(color, alpha * haloA);
  g.lineWidth = width * haloK * 0.8;
  trace();
  g.stroke();
  g.strokeColor = withAlpha(color, alpha);
  g.lineWidth = Math.max(0.6, width);
  trace();
  g.stroke();
}

// ---------- 漫画集中线 ----------

/**
 * 锥形三角集中线:头在 (x1,y1) 宽 wHead、尖端收在 (x2,y2)。
 * 取代圆帽线段 —— 尖角朝击球点才有漫画速度线"扎进去"的读感。
 */
export function drawTaper(
  g: Graphics, x1: number, y1: number, x2: number, y2: number,
  wHead: number, color: Color, alpha: number,
): void {
  if (alpha <= 0.006 || wHead < 0.3) return;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const hw = wHead / 2;
  g.fillColor = withAlpha(color, alpha);
  g.moveTo(x1 + nx * hw, y1 + ny * hw);
  g.lineTo(x2, y2);
  g.lineTo(x1 - nx * hw, y1 - ny * hw);
  g.close();
  g.fill();
}

// ---------- 落点准星 ----------

/**
 * P5 落点准星:四向尖刺臂 + 中心菱形,整体纵向压扁贴地。
 * 取代椭圆圈 —— 十字准星才是"这球钉在这里"的 P5 语汇。
 */
export function drawCrossMark(
  g: Graphics, cx: number, cy: number, len: number, w: number, yK: number,
  color: Color, alpha: number,
): void {
  if (alpha <= 0.006 || len < 1) return;
  g.fillColor = withAlpha(color, alpha);
  // 四条臂:根宽尖细的小三角
  const arm = (dx: number, dy: number): void => {
    const nx = -dy, ny = dx;
    g.moveTo(cx + nx * w, cy + ny * w * yK);
    g.lineTo(cx + dx * len, cy + dy * len * yK);
    g.lineTo(cx - nx * w, cy - ny * w * yK);
    g.close();
  };
  arm(1, 0); arm(-1, 0); arm(0, 1); arm(0, -1);
  g.fill();
  // 中心小菱形锚点
  const kw = w * 1.6;
  g.moveTo(cx, cy - kw * yK);
  g.lineTo(cx + kw, cy);
  g.lineTo(cx, cy + kw * yK);
  g.lineTo(cx - kw, cy);
  g.close();
  g.fill();
}

// ---------- 星芒与飘字底板 ----------

/** 多角星芒(填充,中心 cx,cy):得分爆发/星底板的共用绘制 */
export function drawStarburst(
  g: Graphics, cx: number, cy: number,
  rOut: number, rIn: number, points: number,
  color: Color, alpha: number, rot = 0,
): void {
  if (alpha <= 0.006 || rOut < 0.5) return;
  g.fillColor = withAlpha(color, alpha);
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOut : rIn;
    const t = (Math.PI * i) / points + rot;
    const x = cx + Math.cos(t) * r;
    const y = cy + Math.sin(t) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.close();
  g.fill();
}

export type FloatPlateStyle = "slant" | "star" | "none";

/** slant 底板的斜切角(度)与底色(ARCADE.ink 同值,有意不 import ui) */
const PLATE_SKEW_DEG = 8;
const PLATE_INK = "07070d";

/**
 * 飘字底板:
 *  slant = 斜切黑片 + 档位色描边(漫画对话框的地基);
 *  star  = 双层尖刺星芒衬底(外层档位色半透,内层白,错半步相位)。
 * w/h 为文字盒外扩后的底板尺寸;rot 只用于 star 的相位错开。
 */
export function drawFloatPlate(
  g: Graphics, w: number, h: number, style: FloatPlateStyle,
  color: Color, rot = 0,
): void {
  if (style === "slant") {
    const skew = h * Math.tan(PLATE_SKEW_DEG * Math.PI / 180);
    const s = skew / 2;
    const trace = (): void => {
      g.moveTo(-w / 2 + s, -h / 2);
      g.lineTo(w / 2 + s, -h / 2);
      g.lineTo(w / 2 - s, h / 2);
      g.lineTo(-w / 2 - s, h / 2);
      g.close();
    };
    g.fillColor = withAlpha(pal_(PLATE_INK), 0.85);
    trace();
    g.fill();
    g.strokeColor = withAlpha(color, 0.9);
    g.lineWidth = 2;
    trace();
    g.stroke();
  } else if (style === "star") {
    const r = w / 2;
    drawStarburst(g, 0, 0, r, r * 0.55, 10, color, 0.42, rot);
    drawStarburst(g, 0, 0, r * 0.74, r * 0.38, 10, pal_("ffffff"), 0.30, rot + Math.PI / 10);
  }
}

/** pal 的模块内克隆(避免与 palette.ts 的同名导出在调用点混淆) */
function pal_(hex: string): Color {
  return withAlpha(hex, 1);
}

// ---------- 斩劈 cut-in ----------

/**
 * P5 斩劈 cut-in:三道斜带错相位横扫全屏(屏幕空间,中心为原点)。
 * p ∈ 0..1 为整体进度;每带相位错开 stagger,带内 alpha 走 sin(π·pi)
 * (进场渐显 → 扫过屏心最亮 → 出场渐隐)。四角手算平行四边形,
 * 带长取对角线兜底,任意小倾角都盖满全屏。dir=±1 扫描方向。
 */
export function drawCutinBands(
  g: Graphics, W: number, H: number, p: number,
  angDeg: number, bandW: number,
  colors: Color[], alphaPeak: number, stagger: number, dir: number,
): void {
  if (p <= 0 || p >= 1 || colors.length === 0) return;
  const bw = bandW * W;
  const hh = Math.hypot(W, H) * 0.62;   // 半高:旋转后仍盖满全屏
  const ang = angDeg * Math.PI / 180;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const span = W + bw * 2;              // 从完全出屏左扫到完全出屏右
  for (let i = 0; i < colors.length; i++) {
    const pi = clamp(p * (1 + 2 * stagger) - i * stagger, 0, 1);
    if (pi <= 0.001 || pi >= 0.999) continue;
    const ease = pi < 0.5 ? 2 * pi * pi : 1 - Math.pow(-2 * pi + 2, 2) / 2;  // easeInOutQuad
    const xpos = dir * (-span / 2 + span * ease);
    const a = Math.sin(Math.PI * pi) * alphaPeak;
    if (a <= 0.006) continue;
    g.fillColor = withAlpha(colors[i], a);
    // 局部四角(宽 bw 沿扫描向,高 2hh 沿带长向)→ 旋转 ang → 平移 (xpos, 0)
    const c4x = [-bw / 2, bw / 2, bw / 2, -bw / 2];
    const c4y = [-hh, -hh, hh, hh];
    for (let k = 0; k < 4; k++) {
      const x = xpos + c4x[k] * ca - c4y[k] * sa;
      const y = c4x[k] * sa + c4y[k] * ca;
      if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.close();
    g.fill();
  }
}

// ---------- 文案宽度 ----------

/**
 * 文案宽度估算(与 ui/text-metrics 同尺:全角 1.05、半角 0.62)。
 * render 层飘字底板要用,但 render 不 import ui,这里按同一把尺重出。
 */
export function measureTextW(text: string, size: number): number {
  let w = 0;
  for (const ch of text) {
    w += ch.charCodeAt(0) > 0xff ? 1.05 : 0.62;
  }
  return w * size;
}
