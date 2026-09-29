// ============================================================
// 运行时 cc 模块替身 —— 只服务 tools/pose-preview.ts,不属于游戏代码,也不进构建。
//
// 为什么需要它:Cocos 构建产物在内置浏览器里永久 hang(HANDOFF.md 记录,引擎内置
// 资源加载不回调),而本工程的角色是**纯 cc.Graphics 折线/圆**、零图片零骨骼 ——
// 把 Graphics 换成"记录每一笔画"的替身,就能在 node 里把 drawPlayer 直接 dump 成
// SVG,肉眼比对姿势改动,不必启动编辑器或跑一次 30s 构建。
//
// 必须遵守的 cc 语义(照抄 tools/cc-shim.d.ts 与 sprites.ts 头注释):
//  * fill()/stroke() 只消费自上次 stroke/fill 之后新增的路径(canvas beginPath 语义)。
//    这条错了会让形状互相污染,SVG 全是假象 —— 所以 _cmds 在每次 stroke/fill 后清空;
//  * ellipse(cx,cy,rx,ry) 的参数是「半径」不是包围盒;
//  * 本替身不做裁剪、不做变换:坐标就是 Graphics 本地坐标,翻转/缩放交给 SVG 的 <g>。
// ============================================================

/** 一笔里的路径指令(与 cc.Graphics 的建模一致:指令流 + stroke/fill 收尾) */
export interface StubCmd {
  t: "M" | "L" | "Z" | "E" | "R";
  x?: number; y?: number;      // M / L
  cx?: number; cy?: number;    // E(圆心)
  rx?: number; ry?: number;    // E(半径)
  w?: number; h?: number;      // R(宽高)
}

export interface StubOp {
  kind: "stroke" | "fill";
  cmds: StubCmd[];
  color: string;               // css 串,含 alpha
  width: number;               // stroke 才有意义
  cap: string; join: string;
}

/** cc.Color 替身:只保留 r/g/b/a(0..255)与 palette.ts 用到的构造签名 */
export class Color {
  r = 0; g = 0; b = 0; a = 255;
  constructor(r?: number | string, g?: number, b?: number, a?: number) {
    if (typeof r === "string") { this.fromHEX(r); return; }
    this.r = r ?? 0; this.g = g ?? 0; this.b = b ?? 0; this.a = a ?? 255;
  }
  fromHEX(hex: string): this {
    const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
    if (m) {
      const n = parseInt(m[1], 16);
      this.r = (n >> 16) & 255; this.g = (n >> 8) & 255; this.b = n & 255;
      this.a = m[2] ? parseInt(m[2], 16) : 255;
    }
    return this;
  }
  css(): string {
    return `rgba(${Math.round(this.r)},${Math.round(this.g)},${Math.round(this.b)},${(this.a / 255).toFixed(3)})`;
  }
}

/** 记录型 Graphics:笔画序列挂在 .ops 上 */
export class Graphics {
  static LineCap = { BUTT: "butt", ROUND: "round", SQUARE: "square" };
  static LineJoin = { BEVEL: "bevel", ROUND: "round", MITER: "miter" };

  strokeColor: Color = new Color(255, 255, 255, 255);
  fillColor: Color = new Color(255, 255, 255, 255);
  lineWidth = 1;
  lineCap = "round";
  lineJoin = "round";

  ops: StubOp[] = [];
  private _cmds: StubCmd[] = [];

  moveTo(x: number, y: number): void { this._cmds.push({ t: "M", x, y }); }
  lineTo(x: number, y: number): void { this._cmds.push({ t: "L", x, y }); }
  close(): void { this._cmds.push({ t: "Z" }); }
  /** cc 语义:参数是半径。采样成折线环,与 ellipseAA 的自采样结果同形 */
  ellipse(cx: number, cy: number, rx: number, ry: number): void {
    this._cmds.push({ t: "E", cx, cy, rx, ry });
  }
  circle(cx: number, cy: number, r: number): void { this.ellipse(cx, cy, r, r); }
  rect(x: number, y: number, w: number, h: number): void { this._cmds.push({ t: "R", x, y, w, h }); }
  roundRect(x: number, y: number, w: number, h: number, _r: number): void { this.rect(x, y, w, h); }

  stroke(): void {
    this.ops.push({
      kind: "stroke", cmds: this._cmds.slice(),
      color: (this.strokeColor as Color).css(), width: this.lineWidth,
      cap: this.lineCap, join: this.lineJoin,
    });
    this._cmds = [];
  }
  fill(): void {
    this.ops.push({
      kind: "fill", cmds: this._cmds.slice(),
      color: (this.fillColor as Color).css(), width: 0, cap: "", join: "",
    });
    this._cmds = [];
  }
  clear(): void { this.ops = []; this._cmds = []; }
}

/** 把一条 op 的路径指令展开成点列(供几何断言用;R 给四角,E 给采样环) */
export function opPoints(op: StubOp): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const c of op.cmds) {
    if (c.t === "M" || c.t === "L") out.push({ x: c.x as number, y: c.y as number });
    else if (c.t === "R") {
      const x = c.x as number, y = c.y as number, w = c.w as number, h = c.h as number;
      out.push({ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h });
    } else if (c.t === "E") {
      const cx = c.cx as number, cy = c.cy as number, rx = c.rx as number, ry = c.ry as number;
      for (let i = 0; i < 36; i++) {
        const th = (i / 36) * Math.PI * 2;
        out.push({ x: cx + rx * Math.cos(th), y: cy + ry * Math.sin(th) });
      }
    }
  }
  return out;
}

/** 把 op 列表渲染成 SVG 片段(坐标系与 Graphics 本地坐标一致,y 向上,由外层 <g> 翻转) */
export function opsToSvg(ops: StubOp[]): string {
  const parts: string[] = [];
  for (const op of ops) {
    let d = "";
    for (const c of op.cmds) {
      if (c.t === "M") d += `M${f(c.x)} ${f(c.y)}`;
      else if (c.t === "L") d += `L${f(c.x)} ${f(c.y)}`;
      else if (c.t === "Z") d += "Z";
      else if (c.t === "R") d += `M${f(c.x)} ${f(c.y)}h${f(c.w)}v${f(c.h)}h${f(-(c.w as number))}Z`;
      else if (c.t === "E") {
        const cx = c.cx as number, cy = c.cy as number, rx = c.rx as number, ry = c.ry as number;
        if (rx <= 0 || ry <= 0) continue;
        d += `M${f(cx - rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)}`
          + `A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)}Z`;
      }
    }
    if (!d) continue;
    parts.push(op.kind === "stroke"
      ? `<path d="${d}" fill="none" stroke="${op.color}" stroke-width="${f(op.width)}" stroke-linecap="${op.cap}" stroke-linejoin="${op.join}"/>`
      : `<path d="${d}" fill="${op.color}"/>`);
  }
  return parts.join("\n");
}

function f(v?: number): string {
  return (Math.round((v ?? 0) * 100) / 100).toString();
}

let installed = false;

/** 打补丁:让后续 require("cc") 命中本替身。幂等。 */
export function installCc(): void {
  if (installed) return;
  installed = true;
  const Mod = require("module") as { _load: (req: string, parent: unknown, main: boolean) => unknown };
  const orig = Mod._load;
  const stub = { Color, Graphics };
  Mod._load = function (request: string, parent: unknown, main: boolean): unknown {
    if (request === "cc") return stub;
    return orig.call(this, request, parent, main);
  };
}

// 模块求值即打补丁:调用方只要把 `import "./cc-stub"` 排在 `import ... from ".../sprites"`
// 之前就够了。TS 编译到 commonjs 时按 import 声明顺序 emit require,而补丁必须早于
// sprites.ts 内部的 require("cc") —— 这是编译后唯一可靠的顺序来源。
installCc();
