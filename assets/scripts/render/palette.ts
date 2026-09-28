// ============================================================
// 颜色工具:老 canvas 的颜色写法(#rgb / #rrggbb / rgb() / rgba())→ cc.Color。
// 移植自老工程 sprites.js 的用色习惯(见 render/sprites.ts)。
// cc.Color 构造器吃 (r,g,b,a) 或十六进制串,rgba() 函数串要自己拆;
// alpha 约定:cc 是 0..255,canvas 的 rgba() 第四参是 0..1,在此换算。
// fillColor/strokeColor 赋值时引擎内部会 .set() 拷贝,所以缓存同一实例安全;
// withAlpha 恒返回新实例(透明度往往逐帧变化,不缓存)。
// ============================================================
import { Color } from "cc";

const HEX3 = /^#([0-9a-f]{3})$/i;
const HEX6 = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i;
const FUNC = /^rgba?\(([^)]*)\)$/i;
// rgba() 的分隔符兼容逗号与空格(canvas 两种写法都出现在老代码里)
const SEP = /[\s,/]+/;

const cache = new Map<string, Color>();

function byte(v: string): number {
  const n = parseFloat(v);
  return n < 0 ? 0 : n > 255 ? 255 : Math.round(n);
}

function parse(c: string): Color {
  let m = HEX3.exec(c);
  if (m) {
    const ch = m[1];
    return new Color(
      parseInt(ch[0] + ch[0], 16),
      parseInt(ch[1] + ch[1], 16),
      parseInt(ch[2] + ch[2], 16),
      255,
    );
  }
  m = HEX6.exec(c);
  if (m) {
    const n = parseInt(m[1], 16);
    return new Color((n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) : 255);
  }
  m = FUNC.exec(c);
  if (m) {
    const p = m[1].split(SEP).filter((s) => s.length > 0);
    const a = p[3] !== undefined ? parseFloat(p[3]) : 1;
    const k = a < 0 ? 0 : a > 1 ? 1 : a;
    return new Color(byte(p[0]), byte(p[1]), byte(p[2]), Math.round(k * 255));
  }
  // 兜底:解析不了按纯白,别让 Graphics 吃到非法值
  return new Color(255, 255, 255, 255);
}

/** canvas 颜色字符串 → cc.Color(带缓存;返回实例为共享只读,调用方不得修改) */
export function pal(c: string): Color {
  const hit = cache.get(c);
  if (hit) return hit;
  const out = parse(c);
  cache.set(c, out);
  return out;
}

/** canvas globalAlpha 语义:在颜色上叠乘不透明度(a ∈ 0..1),恒返回新实例 */
export function withAlpha(c: string | Color, a: number): Color {
  const base = typeof c === "string" ? pal(c) : c;
  const k = a < 0 ? 0 : a > 1 ? 1 : a;
  return new Color(base.r, base.g, base.b, Math.round(k * 255));
}
