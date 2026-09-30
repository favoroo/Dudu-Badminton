// ============================================================
// 羽毛球飞行轨迹:锥形丝带(Ribbon)。
//
// 换掉的是什么:老实现把拖尾画成"每个采样点叠 3~4 个同心圆"(world.trailDot),
// 既不是线也没有宽度,而且采样是"每 2 个模拟帧一次"(rules.setTrailHook 那侧),
// 于是扣杀的圆点稀疏散列、搓球的又挤成一坨,发球/高远/吊球还全都长一个样。
// 现在改成一条**沿真实路径连续收尖的丝带**:按距离入点、逐点法向偏移、
// 分若干段分别填色(Graphics 没有渐变,分段是这工程一贯的近似手法 ——
// 见 world.strokeVignette / court.drawVignette)。
//
// 分级炫技落在这里最直白:normal 一条细白纱、sweet 青芯金焰、smash 粗直金橙、
// sweetSmash 三层烧白、fire 红金四层并在末端打卷 —— 同一套管线,只换层数、
// 宽度、寿命与配色(config.fx.trailTiers)。
//
// 预算账:旧 70 点 × 最多 4 个 g.circle(每个 36 段采样)≈ 280 次 fill / 上万顶点;
// 丝带 ≤56 点、层数 × 段数最多 4×7=28 次 fill / 约 300 顶点。更精细也更省。
//
// 铁律对账:只读 ball/rules 的状态,不写回;入点/老化都住在渲染层
// (world.render 采样、world.stepFx 老化),所以 core/rules 的采样节流一行没动。
// ============================================================
import { Graphics } from "cc";
import { CFG } from "../core/config";
import { ShotResult, SkinDef } from "../core/types";
import { clamp } from "../core/utils";
import { withAlpha } from "./palette";
import { fadePow } from "./easing";
import { hueColor } from "./sprites";
import { TIER_FIRE, TIER_NORMAL, TIER_SMASH, TIER_SWEET, TIER_SWEET_SMASH } from "./shuttle-motion";

const C = CFG;
const { sin, cos, hypot, PI } = Math;
const TAU = PI * 2;

/** 世界坐标 → Graphics 本地坐标(与 world.ts 同签名,本地重声明避免循环 import) */
interface Viewport {
  x(wx: number): number;
  y(wy: number): number;
}

/** 丝带层:从外焰到芯线(顺序即绘制顺序,后画的盖在前面上) */
interface TrailLayer { hex: string; wMul: number; aMul: number }
interface TrailTier { lenMul: number; widthMul: number; bands: number; curl: number; layers: TrailLayer[] }

/** 档位索引 → config.fx.trailTiers 的键(顺序必须与 shuttle-motion 的 TIER_* 一致) */
const TIER_KEYS = ["normal", "sweet", "smash", "sweetSmash", "fire"] as const;

function tierDef(tier: number): TrailTier {
  const i = clamp(tier | 0, 0, TIER_KEYS.length - 1);
  return C.fx.trailTiers[TIER_KEYS[i]];
}

/** 球种形态倍率:高远留长线、搓/吊几乎不留尾。kind 是字符串,按现有 shotLabel 的写法取 */
function shapeOf(kind: string): number {
  const map = C.fx.trailShotShape as unknown as Record<string, number>;
  return map[kind] ?? 1;
}

/** 一个丝带采样点(世界坐标 + 自己的寿命,档位换人时旧尾按旧档淡完) */
interface RibbonPoint {
  x: number; y: number;
  age: number; life: number;
  tier: number; shape: number;
}

// 逐点几何的复用缓冲(零 GC:每帧只算数值,不新建对象)
const MAXP = 64;
const sx = new Float32Array(MAXP);
const sy = new Float32Array(MAXP);
const snx = new Float32Array(MAXP);
const sny = new Float32Array(MAXP);
const sw = new Float32Array(MAXP);
const sf = new Float32Array(MAXP);

export class Ribbon {
  /** 旧→新排列;头部(最新)在末尾 */
  readonly pts: RibbonPoint[] = [];
  /** 最近一次击球的档位与球种形态(rules 的 trailHook 只更新这两个戳) */
  private tier = TIER_NORMAL;
  private shape = 1;

  /**
   * 档位戳:由 world.pushTrail(rules 的 hook)调用。
   * 这里**不入点** —— 入点改由 render 按距离采样,才不会再出现"扣杀点稀疏、
   * 搓球点扎堆"这种由采样节拍(而非几何)决定的走样。
   */
  stamp(shot: ShotResult | null): void {
    if (!shot) { this.tier = TIER_NORMAL; this.shape = 1; return; }
    const isSmash = shot.kind === "smash";
    const isSweet = !!(shot.sweet || shot.perfect);
    const isFire = (shot.heat ?? 0) >= (C.heat.fireAt || 3);
    this.tier = isFire ? TIER_FIRE
      : (isSmash && isSweet) ? TIER_SWEET_SMASH
        : isSmash ? TIER_SMASH
          : isSweet ? TIER_SWEET
            : TIER_NORMAL;
    this.shape = shapeOf(shot.kind);
  }

  /** 清带(换局/重发球:上一分的尾迹绝不能带进下一分) */
  clear(): void { this.pts.length = 0; }

  /**
   * 按距离入点。渲染帧率无关:120Hz 屏不会比 60Hz 多出一倍的点。
   * speed 低于 trailMinSpeed(搓球末段、死球在地上滚)不给尾。
   */
  sample(x: number, y: number, speed: number): void {
    const f = C.fx;
    if (speed < (f.trailMinSpeed ?? 2.2)) return;
    const last = this.pts[this.pts.length - 1];
    const spacing = f.trailSpacing ?? 4.5;
    if (last && hypot(x - last.x, y - last.y) < spacing) return;
    const def = tierDef(this.tier);
    // 寿命基数沿用 trailLen / trailSweetLen(它们仍是唯一真旋钮,别在这里再造一个)
    const base = this.tier >= TIER_SWEET ? (f.trailSweetLen || 24) : (f.trailLen || 18);
    const life = Math.max(4, Math.round(base * def.lenMul));
    this.pts.push({ x, y, age: 0, life, tier: this.tier, shape: this.shape });
    const cap = Math.min(f.trailMax ?? 56, MAXP);
    if (this.pts.length > cap) this.pts.splice(0, this.pts.length - cap);
  }

  /** 老化:只在 world.stepFx 的非定格分支里调用(定格时丝带跟着一起冻) */
  step(): void {
    const n = this.pts.length;
    if (n === 0) return;
    let alive = 0;
    for (let i = 0; i < n; i++) {
      const p = this.pts[i];
      p.age++;
      if (p.age < p.life) this.pts[alive++] = p;
    }
    this.pts.length = alive;
  }

  /**
   * 画丝带。style = 设计款球皮的专属残影风格(只换配色与头部形状,不再叠同心圆)。
   */
  draw(g: Graphics, vp: Viewport, style?: NonNullable<SkinDef["trailStyle"]> | null): void {
    const n = this.pts.length;
    if (n < 3) return;
    const f = C.fx;
    const headW = f.trailHeadW ?? 2.6;
    const tailW = f.trailTailW ?? 0.55;
    const taperK = f.trailTaperK ?? 0.7;
    const alphaK = f.trailAlphaK ?? 1.8;

    // ---- 逐点几何:切线→法线→半宽→存活比 ----
    for (let i = 0; i < n; i++) {
      const p = this.pts[i];
      const prev = this.pts[i > 0 ? i - 1 : i];
      const next = this.pts[i < n - 1 ? i + 1 : i];
      const def = tierDef(p.tier);
      // 末端打卷:搓/吊这类慢球在尾巴上卷一下(纯视觉,不改真实轨迹)
      const curl = def.curl + (p.shape < 0.7 ? (f.trailCurlDrop ?? 0.55) : 0);
      const fr = 1 - p.age / p.life;                    // 1=刚入点, 0=该没了
      const w = (tailW + (headW - tailW) * fadePow(fr, taperK)) * def.widthMul * p.shape;
      let tx = next.x - prev.x, ty = next.y - prev.y;
      const tl = hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;
      // 法线(垂直于切线;世界系 y 向下,符号只影响卷动方向,不影响力度)
      let nx = -ty, ny = tx;
      const wig = curl * sin(p.age * 0.42) * (1 - fr) * w * 1.6;
      sx[i] = p.x + nx * wig;
      sy[i] = p.y + ny * wig;
      // 半宽:w 已按 taperK 沿程收过了,这里只把最老的一点(press)压成尖,
      // 免得尾端留个平头;头部(n-1)保持满宽,丝带才是"从球头长出来"的
      snx[i] = nx; sny[i] = ny;
      sw[i] = i === 0 ? w * 0.18 : w;
      sf[i] = fr;
    }

    // 头部档位的层表决定整条带的画法;尾段沿用各自点的档位只影响宽度/寿命
    const def = tierDef(this.pts[n - 1].tier);
    const bands = Math.max(2, Math.min(def.bands, n - 2));
    const skin = style ? (C.fx.trailSkin as unknown as Record<string, { hexes: string[]; head: string }>)[style] : null;
    const hexes = skin && skin.hexes.length > 0 ? skin.hexes : null;
    const isHue = !!skin && skin.head === "hue";
    const t = this.tick;

    // ---- 分层 × 分段填色(外焰宽而淡 → 芯线窄而亮) ----
    for (let L = 0; L < def.layers.length; L++) {
      const layer = def.layers[L];
      for (let b = 0; b < bands; b++) {
        const i0 = Math.floor(b * (n - 1) / bands);
        const i1 = Math.floor((b + 1) * (n - 1) / bands);
        if (i1 - i0 < 1) continue;
        const frMid = (sf[i0] + sf[i1]) * 0.5;
        const a = fadePow(frMid, alphaK) * layer.aMul;
        if (a <= 0.006) continue;
        const hex = hexes ? hexes[L % hexes.length]
          : isHue ? hueColor((frMid * 360 + t * (f.trailRainbowStep ?? 16)) % 360, 0.9, 0.62)
            : layer.hex;
        const wl = layer.wMul;
        g.fillColor = withAlpha(hex, a);
        g.moveTo(vp.x(sx[i0] + snx[i0] * sw[i0] * wl), vp.y(sy[i0] + sny[i0] * sw[i0] * wl));
        for (let i = i0 + 1; i <= i1; i++) {
          g.lineTo(vp.x(sx[i] + snx[i] * sw[i] * wl), vp.y(sy[i] + sny[i] * sw[i] * wl));
        }
        for (let i = i1; i >= i0; i--) {
          g.lineTo(vp.x(sx[i] - snx[i] * sw[i] * wl), vp.y(sy[i] - sny[i] * sw[i] * wl));
        }
        g.close();
        g.fill();
      }
    }

    // ---- 头部亮核:丝带是"尾",这一下才是"啪" ----
    this.drawHead(g, vp, def, style, skin ? skin.head : null);
  }

  /** 头部:亮核 + 外晕;设计款按风格换成星芒/余烬/花瓣 */
  private drawHead(g: Graphics, vp: Viewport, def: TrailTier,
    style: NonNullable<SkinDef["trailStyle"]> | null | undefined, head: string | null): void {
    const f = C.fx;
    const n = this.pts.length;
    if (n === 0) return;
    const p = this.pts[n - 1];
    const x = vp.x(p.x), y = vp.y(p.y);
    const r = (f.trailHeadR ?? 4.6) * def.widthMul * p.shape;
    const core = def.layers[def.layers.length - 1];
    if (head === "star") {
      // 星芒头:十字辉(随相位闪)
      const tw = 0.7 + 0.3 * sin(this.tick * (f.trailHeadTwinkle ?? 0.25));
      g.strokeColor = withAlpha("#eaffff", 0.75 * tw);
      g.lineWidth = 1.4;
      g.moveTo(x - r * 2.1, y); g.lineTo(x + r * 2.1, y);
      g.moveTo(x, y - r * 2.1); g.lineTo(x, y + r * 2.1);
      g.stroke();
      g.fillColor = withAlpha("#ffffff", 0.95);
      g.circle(x, y, r * 0.5); g.fill();
      return;
    }
    if (head === "ember") {
      // 余烬头:三层焰核 + 一粒上飘火星
      g.fillColor = withAlpha("#ff4d26", 0.4);
      g.circle(x, y, r * 1.25); g.fill();
      g.fillColor = withAlpha("#ffd24d", 0.9);
      g.circle(x, y, r * 0.45); g.fill();
      const sp = sin(this.tick * 0.2) * r * 0.6;
      g.fillColor = withAlpha("#ffd24d", 0.55);
      g.circle(x + sp, y + r * 1.4, r * 0.28); g.fill();
      return;
    }
    if (head === "petal") {
      // 花瓣头:三片错落
      for (let i = 0; i < 3; i++) {
        const a = this.tick * 0.06 + i * TAU / 3;
        g.fillColor = withAlpha(i === 1 ? "#ff8fb8" : "#ffb7d0", 0.6);
        g.ellipse(x + cos(a) * r * 0.5, y + sin(a) * r * 0.5, r * 0.6, r * 0.34);
        g.fill();
      }
      g.fillColor = withAlpha("#ffe0ec", 0.95);
      g.circle(x, y, r * 0.34); g.fill();
      return;
    }
    // 默认(含 rainbow):外晕 + 亮核
    g.fillColor = withAlpha(core.hex, 0.22);
    g.circle(x, y, r * 1.6); g.fill();
    g.fillColor = withAlpha("#ffffff", 0.9);
    g.circle(x, y, r * 0.5); g.fill();
  }

  /** 帧时钟(头部闪烁/相位用,由 world 每渲染帧喂) */
  tick = 0;
}
