// ============================================================
// P5 画笔层:把 p5-shapes 算出的显示列表画到 cc.Graphics 上。
//
// 为什么单独一层 —— 本文件只 import cc 的 `Color` 与 `Graphics` 两个类,
// 而 tools/cc-stub.ts 恰好桩得住这两个。于是同一批形状函数既能在游戏里画,
// 也能在 node 里 dump 成 SVG 出图(见 tools/panel-preview.ts)——
// 出图与实机**共用同一份形状代码**,不再是 brief-preview 那种「重抄一份对照」。
//
// 批量:连续同色同宽的笔画合成一次 fill/stroke。网点层几百个点如果逐个 fill,
// 就是几百次绘制;合并成一条路径后是一次。cc 的 Graphics 允许一个 fill()
// 里多个 moveTo 子路径(见 ui-arcade.drawScanlines 同样的批量写法)。
// ============================================================
import { Color, Graphics } from "cc";
import type { CardOpts, HalftoneOpts, Paint, PlateOpts, SliderDL } from "./p5-shapes";
import {
  bandDL, blockDL, cardDL, halftoneDL, knobDL, plateDL, rankBadgeDL, sliderDL, slotDL,
  starGlyphDL, toggleDL, type BadgeKind,
} from "./p5-shapes";

const tmpColor = new Color();

/** hex + alpha → cc.Color(复用同一个实例:Graphics 赋值时引擎内部会拷贝) */
function setFill(g: Graphics, hex: string, a: number): void {
  tmpColor.fromHEX(hex);
  tmpColor.a = Math.round(a * 255);
  g.fillColor = tmpColor;
}

function setStroke(g: Graphics, hex: string, a: number, lw: number): void {
  tmpColor.fromHEX(hex);
  tmpColor.a = Math.round(a * 255);
  g.strokeColor = tmpColor;
  g.lineWidth = lw;
}

/** 一条子路径:moveTo + lineTo(+ 可选闭合) */
function trace(g: Graphics, pts: readonly (readonly [number, number])[], close: boolean): void {
  if (pts.length === 0) return;
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  if (close) g.close();
}

/**
 * 画一个显示列表。相邻的同类笔画合并成一次绘制。
 * 约定:调用方负责 `g.clear()`(保留型画布唯一安全的改法),本函数只追加。
 */
export function paintP5(g: Graphics, paints: readonly Paint[]): void {
  let i = 0;
  while (i < paints.length) {
    const p = paints[i];
    let j = i + 1;
    while (j < paints.length) {
      const q = paints[j];
      if (q.kind !== p.kind || q.hex !== p.hex || q.a !== p.a) break;
      if (p.kind !== "dot" && q.kind !== "dot" && (q.lw ?? 1) !== (p.lw ?? 1)) break;
      j++;
    }
    if (p.kind === "dot") {
      for (let k = i; k < j; k++) {
        const d = paints[k] as Extract<Paint, { kind: "dot" }>;
        g.circle(d.cx, d.cy, d.r);
      }
      setFill(g, p.hex, p.a);
      g.fill();
    } else {
      const close = p.kind === "fill" ? true : p.close !== false;
      for (let k = i; k < j; k++) trace(g, (paints[k] as Extract<Paint, { pts: [number, number][] }>).pts, close);
      if (p.kind === "fill") {
        setFill(g, p.hex, p.a);
        g.fill();
      } else {
        setStroke(g, p.hex, p.a, p.lw ?? 1);
        g.stroke();
      }
    }
    i = j;
  }
}

// ---------- 面板层语法:一层一个入口 ----------

/** L1 衬纸:面板本体(斜切硬阴影 + 错位 accent 副衬 + 墨面 + 平直下缘 + 顶缘高光) */
export function drawPosterPlate(g: Graphics, w: number, h: number, o: PlateOpts = {}): void {
  paintP5(g, plateDL(w, h, o));
}

/** L3 实底大色块(与 ui-arcade.drawSolidBlock 同配方;tab / 卡片 / 主按钮) */
export function drawP5Block(g: Graphics, w: number, h: number, accent: string, slantDeg = 5): void {
  paintP5(g, blockDL(w, h, accent, slantDeg));
}

/** L2 分区色带:小节标题、状态胶囊(= 大色块的 10° 档) */
export function drawSectionBand(g: Graphics, w: number, h: number, faceHex: string): void {
  paintP5(g, bandDL(w, h, faceHex));
}

/**
 * 卡片底:墨面 + 顶部一条 accent 色带 + 同色 keyline。
 * 一屏十几张的表面用它,不要用 drawP5Block(那会把屏幕涂成五色彩虹)。
 */
export function drawP5Card(g: Graphics, w: number, h: number, accent: string, o: CardOpts = {}): void {
  paintP5(g, cardDL(w, h, accent, o));
}

/** L3′ 凹陷槽:经验槽、滑杆轨道、未选中/锁定态 */
export function drawBevelSlot(g: Graphics, w: number, h: number, slantDeg = 5, face?: string): void {
  paintP5(g, slotDL(w, h, slantDeg, face ? { face } : {}));
}

/** 斜切旋钮(替代滑杆那颗白圆) */
export function drawSlantKnob(g: Graphics, s: number, faceHex: string, cx = 0, cy = 0): void {
  paintP5(g, knobDL(s, faceHex, cx, cy));
}

/** 开关行面:开 = 实底色块,关 = 凹陷槽 */
export function drawToggleFace(g: Graphics, w: number, h: number, on: boolean, faceHex: string): void {
  paintP5(g, toggleDL(w, h, on, faceHex));
}

/** 滑杆整支(轨道 + 填充 + 旋钮 + 刻度) */
export function drawSliderFace(g: Graphics, dl: SliderDL): void {
  paintP5(g, dl.track);
  paintP5(g, dl.fill);
  paintP5(g, dl.ticks);
  paintP5(g, dl.knob);
}

/** 由尺寸与取值直接出滑杆列表:调用方不必自己算 t */
export { sliderDL } from "./p5-shapes";

/**
 * 网点层。**返回点数**,让调用方与 panel-check 的红线对上 ——
 * 网点是这套语法里唯一按面积堆绘制量的件,预算必须可见,不能画完就忘。
 */
export function drawHalftone(g: Graphics, w: number, h: number, o: HalftoneOpts = {}): number {
  const paints = halftoneDL(w, h, o);
  paintP5(g, paints);
  return paints.length;
}

/** 四尖星等级件:实 = 拿到,空 = 描边 */
export function drawStarGlyph(g: Graphics, cx: number, cy: number, s: number, filled: boolean, hex: string): void {
  paintP5(g, starGlyphDL(cx, cy, s, filled, hex));
}

/** 状态印章:锁 / 最佳 / 下一关 / 已拥有(替代 🔒 与 ★☆ 文本) */
export function drawRankBadge(g: Graphics, kind: BadgeKind, s: number, hex: string, cx = 0, cy = 0): void {
  paintP5(g, rankBadgeDL(kind, s, hex, cx, cy));
}
