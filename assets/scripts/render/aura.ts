// ============================================================
// 传说皮肤「脚下法阵」(纯装饰,只画不算):外溢光晕 / 主齿环 / 外断环 / 符文 /
// 环绕星尘 / 上升光尘 六层。数值全在 config.fx.aura,配色与「性格」在下方表里。
//
// 为什么单独成文件:旧写法是 drawPlayer 里 24 行「两个光滑椭圆环 + 三颗圆点」——
// 与全站 P5 语汇「拒绝光滑圆圈」正相反,细看就是一根铁丝套在脚踝上。用户拍的现场:
// 「传说皮肤人物底下那层光圈太简陋了」。拆成六层后每一层各管一件事:
// 光晕负责「光溢到地板上」,齿环与断环负责对转的法阵读感,符文与星尘负责
// 把「传说」这个等级说出来,升尘负责让脚下这块地方一直在动。
//
// 三条不变量(改数值前先读):
//  1. **逐帧零 rand** —— 每层角度/相位都是 t 的纯函数(与 p5kit「出生定形」同一口径)。
//     一圈抖动的噪点不叫特效,叫坏了。
//  2. **只画不算** —— 不读也不写任何比赛状态;整阵在人物身体之前绘制,所以永远
//     压在脚后跟底下,升尘飘到腿后会被身体挡住,不需要任何裁剪。
//  3. **扁率只有一个** —— 所有层共用同一 (长半轴, flat) 投影,任何一层偷偷改扁率
//     都会读成「两个圈没对齐」而不是「阵有纵深」。
//
// 坐标约定:cx/cy 是 Graphics 空间(屏幕,y 向上)的脚底中心;kx/ky 是「世界 px →
// Graphics px」两轴各自的换算(与影子同一把尺,预览缩放/镜像都吃得进来);
// rx 是世界单位长半轴,由调用方按人物宽算好。
// ============================================================
import { Graphics } from "cc";
import { CFG } from "../core/config";
import { TAU, clamp } from "../core/utils";
import { pal, withAlpha } from "./palette";
import { drawStarburst } from "./p5kit";

const A = CFG.fx.aura;

/** 法阵配色与性格:a 画阵线与溢光,b 画宝石与星尘。
 *  teeth / starPoints 是覆写位 —— 冰阵走六棱星芒,与太阳王冠的九齿区分开,
 *  免得两款传说皮肤只是换个色、同一张脸。 */
export interface AuraSkin {
  a: string; b: string;
  teeth?: number;
  starPoints?: number;
}

export const AURA_COLORS: Record<string, AuraSkin> = {
  gold: { a: "#ffd24d", b: "#fff3c4" },
  neon: { a: "#3dffa8", b: "#a5ffe0" },
  flame: { a: "#ff6a1f", b: "#ffd24d" },
  ice: { a: "#7ecbff", b: "#eaffff", teeth: 6, starPoints: 6 },
};

export interface SigilSpec {
  /** Graphics 空间的脚底中心(世界 groundY 已经换算过) */
  cx: number; cy: number;
  /** 主齿环长半轴(世界 px) */
  rx: number;
  /** 世界 px → Graphics px 的两轴换算(与影子同一把尺) */
  kx: number; ky: number;
  /** 渲染帧时钟(与 drawPlayer 的 animT 同源,商店预览也要给真时钟) */
  t: number;
  /** AURA_COLORS 键;未知兜 gold */
  key: string;
  /** 整体可见度 0..1(离地淡出由调用方算好喂进来) */
  vis: number;
}

// ---------- 投影:模块级暂存,一帧内被下面的采样函数共用(零闭包分配) ----------

let _cx = 0, _cy = 0, _rx = 0, _ry = 0, _kx = 1, _ky = 1;

/** 椭圆上一点的屏幕 x:长轴沿屏幕 x */
function PX(ang: number, rK: number): number { return _cx + Math.cos(ang) * _rx * rK * _kx; }
/** 椭圆上一点的屏幕 y:短轴 = 长轴 × flat(地面透视),Graphics y 向上 */
function PY(ang: number, rK: number): number { return _cy + Math.sin(ang) * _ry * rK * _ky; }

/** 闭合折线环:n 边形硬边(要的就是折线,光滑椭圆是它取代的东西) */
function ringPath(g: Graphics, rK: number, n: number, rot: number): void {
  for (let i = 0; i < n; i++) {
    const ang = rot + (i / n) * TAU;
    const x = PX(ang, rK), y = PY(ang, rK);
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.close();
}

/** 方齿环:一齿四点(齿顶两点走外圆、齿槽两点走内圆),4n 顶点闭合。
 *  齿顶与齿槽都用弦而非弧 —— 20° 一档的弦降在 r≈43px 上不到 0.6px,肉眼看不出,
 *  但折角让整圈读成「切出来的阵」而不是「画上去的圈」。 */
function cogPath(g: Graphics, n: number, rot: number, inK: number, topK: number): void {
  const step = TAU / n;
  for (let i = 0; i < n; i++) {
    const a0 = rot + i * step;          // 齿顶起点
    const a1 = a0 + step * topK;        // 齿顶终点(此处径向掉进齿槽)
    const a2 = a0 + step;               // 下一齿起点
    const x0 = PX(a0, 1), y0 = PY(a0, 1);
    if (i === 0) g.moveTo(x0, y0); else g.lineTo(x0, y0);
    g.lineTo(PX(a1, 1), PY(a1, 1));
    g.lineTo(PX(a1, inK), PY(a1, inK));
    g.lineTo(PX(a2, inK), PY(a2, inK));
  }
  g.close();
}

/** 菱形宝石(符文与光尘共用):竖着的尖菱形比圆点贵气,也才符合这套语汇 */
function diamond(g: Graphics, cx: number, cy: number, w: number, h: number): void {
  g.moveTo(cx, cy - h);
  g.lineTo(cx + w, cy);
  g.lineTo(cx, cy + h);
  g.lineTo(cx - w, cy);
  g.close();
}

const frac = (v: number): number => v - Math.floor(v);

// ============================================================
// 主绘制
// ============================================================

/**
 * 画一整套传说法阵。调用方只给「脚在哪、多大、第几帧、哪款配色、还能不能看见」。
 * vis ≤ 0.02 直接返回 —— 跳起时整阵淡光比硬消失干净。
 */
export function drawFootSigil(g: Graphics, s: SigilSpec): void {
  const vis = clamp(s.vis, 0, 1);
  if (vis <= 0.02) return;

  const sk = AURA_COLORS[s.key] ?? AURA_COLORS.gold;
  const t = s.t;
  _cx = s.cx; _cy = s.cy; _kx = s.kx; _ky = s.ky;

  const bs = Math.sin(t * A.breathSpeed);
  _rx = s.rx * (1 + A.breathK * bs);
  _ry = _rx * A.flat;
  // 线宽只认几何平均:两轴换算不等时(非等比视口)按 vs 走,与影子/旧光环同一把尺
  const vs = Math.sqrt(Math.abs(_kx * _ky)) || 1;
  const Rpx = _rx * Math.abs(_kx);
  const aCol = sk.a, bCol = sk.b;
  // 光晕与齿环反相吐纳:环胀起时溢出的光收暗 —— 两路同相会读成整圈在闪,不像呼吸
  const bloomK = 1 - A.bloomPulse * bs;

  // ---------- 一、外溢光晕(最底:先让光落到地上,再画线上的阵) ----------
  // 三遍由内到外变宽变淡的环带 = shadowBlur 的近似。刻意不铺实心圆:见 config 注释。
  for (let i = A.bloomR.length - 1; i >= 0; i--) {
    g.strokeColor = withAlpha(aCol, A.bloomA[i] * vis * bloomK);
    g.lineWidth = A.bloomW[i] * vs;
    ringPath(g, A.bloomR[i], 20, 0);
    g.stroke();
  }

  // ---------- 二、外断环(先画在外侧,让齿环压在它上面,纵深才排得开) ----------
  // 用主色而不是高光色:阵线是一整套「同一种东西」,高光只留给宝石与星尘。
  // 从前这里用近白的 b,在商店墨底上读成几道随机灰弧 —— 像划痕,不像阵。
  const rotO = t * A.spinOuter;
  const segStep = TAU / A.outerSegs;
  const segArc = segStep * A.outerArcK;
  g.strokeColor = withAlpha(aCol, A.outerA * vis);
  g.lineWidth = A.outerW * vs;
  for (let i = 0; i < A.outerSegs; i++) {
    const a0 = rotO + i * segStep;
    for (let k = 0; k <= 4; k++) {
      const ang = a0 + (segArc * k) / 4;
      const x = PX(ang, A.outerK), y = PY(ang, A.outerK);
      if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
  }
  g.stroke();

  // ---------- 三、主齿环:同形状描两遍(宽而暗的晕 + 窄而亮的芯) ----------
  const rotC = t * A.spinCore;
  const inK = 1 - A.toothDepth;
  g.strokeColor = withAlpha(aCol, A.haloA * vis);
  g.lineWidth = A.haloW * vs;
  cogPath(g, sk.teeth ?? A.teeth, rotC, inK, A.toothTopK);
  g.stroke();
  g.strokeColor = withAlpha(aCol, A.coreA * vis);
  g.lineWidth = Math.max(0.7, A.coreW * vs);
  cogPath(g, sk.teeth ?? A.teeth, rotC, inK, A.toothTopK);
  g.stroke();

  // ---------- 四、符文:错开半格压在齿槽正中,与齿环同转 ----------
  // 主色做宝石体、高光色只点一颗小内焰。从前整颗宝石用 b(近白):在亮球场上直接
  // 洗没,在暗底上又只是白点 —— 宝石要在两种场地上都读得出「镶在那儿」。
  const rw = A.runeW * vs, rh = A.runeH * vs;
  // 两遍填:宝石体走主色、内焰走高光色。四颗宝石各自攒进同一批路径再一次 fill,
  // 所以一层的成本是 1 次绘制提交,不是 4 次。
  const runePhase = TAU / (A.runes * 2);
  for (let i = 0; i < A.runes; i++) {
    const ang = rotC + (i / A.runes) * TAU + runePhase;
    diamond(g, PX(ang, A.runeK), PY(ang, A.runeK), rw, rh);
  }
  g.fillColor = withAlpha(aCol, A.runeA * vis);
  g.fill();
  for (let i = 0; i < A.runes; i++) {
    const ang = rotC + (i / A.runes) * TAU + runePhase;
    diamond(g, PX(ang, A.runeK), PY(ang, A.runeK), rw * 0.46, rh * 0.46);
  }
  g.fillColor = withAlpha(bCol, A.runeGlowA * vis);
  g.fill();

  // ---------- 五、环绕星尘:沿外轨巡游,各自错相位闪烁 + 小幅离地漂浮 ----------
  const starRot = t * A.starSpin;
  const starPts = sk.starPoints ?? A.starPoints;
  for (let i = 0; i < A.stars; i++) {
    const ang = starRot + (i / A.stars) * TAU;
    const tw = 0.55 + 0.45 * Math.sin(t * A.starTwinkle + i * 2.4);
    const r = A.starR * vs * (0.72 + 0.28 * tw);
    const bob = Math.sin(t * 0.04 + i * 2.1) * A.starBob * _ky;
    drawStarburst(
      g, PX(ang, A.starK), PY(ang, A.starK) + bob,
      r, r * A.starInK, starPts, pal(aCol), A.starA * tw * vis, ang * 0.5,
    );
  }

  // ---------- 六、上升光尘(最上:飘起来的那几粒) ----------
  // 缩略图那档尺寸(主环半宽 < moteMinPx)直接跳过 —— 26px 圈上撒五粒细点只会糊成噪点
  if (Rpx >= A.moteMinPx) {
    const mw = A.moteW * vs;
    for (let i = 0; i < A.motes; i++) {
      const p = frac(t * A.moteSpeed + i / A.motes);
      const ang = rotC + (i / A.motes) * TAU;
      const shrink = 1 - p * 0.55;
      diamond(
        g,
        PX(ang, A.moteK),
        PY(ang, A.moteK) + p * A.moteRise * _ky,
        mw * shrink, mw * 1.8 * shrink,
      );
    }
    g.fillColor = withAlpha(aCol, A.moteA * vis);
    g.fill();
  }
}
