// ============================================================
// 街机绘图构件:移植老项目 styles/ui.css + base.css 的
// 「黄昏体育馆 · 街机赛事海报」语言 —— 硬偏移阴影贴纸感、
// 厚底 3D 按钮、扫描线氛围、rise / slam / pop 分层入场。
//
// 只依赖 cc,不 import 其它 ui 文件:ui-manager 与 career/drill
// 面板都要用它,放独立文件避免互相 import 成环。
// Graphics 为保留型画布:一次构建,运行时零重绘(动画只用 tween)。
// ============================================================
import { Color, Graphics, Label, Node, Tween, tween, UIOpacity, UITransform, Vec3 } from "cc";

// ---------- 设计令牌(老 base.css :root 同源) ----------
export const ARCADE = {
  ink: "#05070f",        // --ink 最深底
  navy: "#0e1428",       // --navy 面板底
  navy2: "#182142",      // --navy-2 按钮底/面板上层
  panelTop: "#16203c",   // 面板渐变上端(老 .panel linear-gradient)
  line: "#2b3560",       // --line
  paper: "#f5efe1",      // --paper 暖纸白(正文/大字)
  paperDim: "#cfc7b4",   // --paper-dim
  acid: "#ffe14d",       // --acid 荧光黄
  acidEdge: "#b79b12",   // 主按钮描边
  acidDk: "#8a7514",     // 厚底按钮的底边
  red: "#ff4d4d",        // --red
  blue: "#3ea8ff",       // --blue
  wood: "#c8703a",       // --wood 暖木
  good: "#7dff9e",       // --good
  bad: "#ff6b6b",        // --bad
  cyan: "#00f0ff",
  dim: "#8f9cbe",        // 老项目里高频出现的灰蓝字
  dimDeep: "#6f7ca6",    // 更暗一档
};

export function ac(hex: string, alpha = 1): Color {
  const c = new Color();
  c.fromHEX(hex);
  if (alpha < 1) c.a = Math.round(alpha * 255);
  return c;
}

// ---------- 硬偏移阴影(sticker 感的魂) ----------

/** 阴影矩形:偏移 (dx,dy) 的纯色块,画在主体之前 */
export function drawHardShadow(g: Graphics, w: number, h: number, r: number, dx = 5, dy = 5, alpha = 0.55): void {
  g.fillColor = ac("#000000", alpha);
  g.roundRect(-w / 2 + dx, -h / 2 - dy, w, h, r);
  g.fill();
}

// ---------- 面板:渐变模拟 + 描边 + 内高光 ----------

/** 街机面板底:上亮下暗的竖向渐变(用半透明叠层模拟)+ 2px 描边 + 顶边高光线 */
export function drawArcadePanel(g: Graphics, w: number, h: number, r = 14): void {
  // 渐变模拟:底部整块 navy,再叠 3 段向上变亮的横带(半透明,肉眼平滑)
  g.fillColor = ac(ARCADE.panelTop);            // 顶端最亮 #16203c
  g.roundRect(-w / 2, -h / 2, w, h, r);
  g.fill();
  g.fillColor = ac(ARCADE.navy, 0.55);          // 中段压暗
  g.roundRect(-w / 2, -h / 2, w, h * 0.62, r);
  g.fill();
  g.fillColor = ac(ARCADE.ink, 0.5);            // 底端最深 #0b1020
  g.roundRect(-w / 2, -h / 2, w, h * 0.34, r);
  g.fill();
  // 描边
  g.strokeColor = ac(ARCADE.paper, 0.14);
  g.lineWidth = 2;
  g.roundRect(-w / 2, -h / 2, w, h, r);
  g.stroke();
  // 顶边内高光(老 .panel 的 border 上沿提亮)
  g.strokeColor = ac(ARCADE.paper, 0.1);
  g.lineWidth = 1;
  g.roundRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6, Math.max(2, r - 3));
  g.stroke();
}

// ---------- 按钮:厚底 3D(primary) / 浮起(ghost) ----------

export type BtnStyle = "primary" | "ghost" | "danger";

/**
 * 街机按钮底(老 .btn / .btn.primary):
 * primary = 荧光黄面 + 暗黄描边 + 4px 暗黄底边(厚底 3D);
 * ghost   = 白 7% 面 + 白 18% 描边;danger = 暗红面。
 * 阴影画在独立节点返回(按压时缩进,见 pressShadow)。
 */
export function drawArcadeButton(g: Graphics, w: number, h: number, style: BtnStyle = "ghost", r = 9): void {
  const bottom = 4; // 厚底厚度
  if (style === "primary") {
    g.fillColor = ac(ARCADE.acidDk);                 // 底边厚块
    g.roundRect(-w / 2, -h / 2 - bottom, w, h + bottom, r);
    g.fill();
    g.fillColor = ac(ARCADE.acid);                   // 主面
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.fill();
    g.strokeColor = ac(ARCADE.acidEdge);
    g.lineWidth = 2;
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.stroke();
    // 顶缘提亮(kbd 高光同款)
    g.strokeColor = ac("#fff8e2", 0.55);
    g.lineWidth = 1;
    g.roundRect(-w / 2 + 3, h / 2 - 6, w - 6, 3, 1.5);
    g.fillColor = ac("#fff8e2", 0.4);
    g.roundRect(-w / 2 + 4, h / 2 - 5, w - 8, 2, 1);
    g.fill();
  } else if (style === "danger") {
    g.fillColor = ac("#3a1218");
    g.roundRect(-w / 2, -h / 2 - bottom, w, h + bottom, r);
    g.fill();
    g.fillColor = ac("#6e2029");
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.fill();
    g.strokeColor = ac(ARCADE.bad, 0.6);
    g.lineWidth = 2;
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.stroke();
  } else {
    g.fillColor = ac("#ffffff", 0.07);
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.fill();
    g.strokeColor = ac(ARCADE.paper, 0.18);
    g.lineWidth = 2;
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.stroke();
  }
}

// ---------- 氛围:扫描线 + 暗角 ----------

/**
 * 扫描线整屏覆盖(老 #scan):每 3px 一条 1px 暗线,低不透明度。
 * 960×540 ≈ 180 条横线,一次性构建,成本可忽略。
 */
export function drawScanlines(g: Graphics, w: number, h: number, alpha = 0.1): void {
  g.fillColor = ac("#000000", alpha);
  for (let y = -h / 2; y < h / 2; y += 3) {
    g.rect(-w / 2, y, w, 1);
  }
  g.fill();
}

/** 暗角(inset grain 的近似):嵌套描边带,由外向内淡出 */
export function drawVignette(g: Graphics, w: number, h: number, steps = 10, alpha = 0.05): void {
  g.lineWidth = 14;
  for (let i = 0; i < steps; i++) {
    const k = 7 + i * 14;
    g.strokeColor = ac("#000000", alpha * (1 - i / steps));
    g.rect(-w / 2 + k, -h / 2 + k, w - k * 2, h - k * 2);
    g.stroke();
  }
}

// ---------- 小构件:acid 标签 chip ----------

/** 老 .tag / .m-tag:荧光黄底 + 深字的小标签块 */
export function drawChip(g: Graphics, w: number, h: number, bg = ARCADE.acid, r = 3): void {
  g.fillColor = ac(bg);
  g.roundRect(-w / 2, -h / 2, w, h, r);
  g.fill();
}

/** 标签 chip:底块 + 深色小字(用于 SOLO / EASY / 赛点等) */
export function makeChip(parent: Node, text: string, size = 9, bg = ARCADE.acid, fg = "#0a0e1c"): Node {
  const n = new Node("chip");
  n.layer = parent.layer;
  n.addComponent(UITransform);
  const g = n.addComponent(Graphics);
  const w = text.length * size * 0.62 + 12;
  drawChip(g, w, size + 7, bg);
  const l = n.addComponent(Label);
  l.string = text;
  l.fontSize = size;
  l.lineHeight = size + 3;
  l.horizontalAlign = Label.HorizontalAlign.CENTER;
  l.verticalAlign = Label.VerticalAlign.CENTER;
  l.color = ac(fg);
  n.setParent(parent);
  return n;
}

// ---------- 动画(老 ui.css 的 rise / slam / pop / banner) ----------

/**
 * rise:淡入 + 上移归位(老 @keyframes rise)。
 * stagger 用 delay 逐级展开;调用前节点应已就位(隐藏态由 UI 显隐控制)。
 */
export function riseIn(node: Node, delay = 0, dist = 14, dur = 0.5): void {
  const op = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
  Tween.stopAllByTarget(op);
  Tween.stopAllByTarget(node);
  const y = node.position.y;
  op.opacity = 0;
  node.setPosition(node.position.x, y + dist, 0);
  tween(op)
    .delay(delay)
    .to(dur * 0.6, { opacity: 255 })
    .start();
  tween(node)
    .delay(delay)
    .to(dur, { position: new Vec3(node.position.x, y, 0) }, { easing: "quadOut" })
    .start();
}

/** slam:面板砸落(老 @keyframes slam,scale .86 + 下坠 18px → 回弹) */
export function slamIn(node: Node, delay = 0): void {
  const op = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
  Tween.stopAllByTarget(node);
  Tween.stopAllByTarget(op);
  const y = node.position.y;
  op.opacity = 0;
  node.setScale(0.86, 0.86, 1);
  node.setPosition(node.position.x, y - 18, 0);
  tween(op).delay(delay).to(0.18, { opacity: 255 }).start();
  tween(node)
    .delay(delay)
    .to(0.3, { scale: new Vec3(1, 1, 1), position: new Vec3(node.position.x, y, 0) }, { easing: "backOut" })
    .start();
}

/** 标题持续浮动:上下 ±3px 的往复呼吸(tween 循环,show 时调一次) */
export function floatLoop(node: Node, amp = 3, dur = 1.6): void {
  Tween.stopAllByTarget(node);
  const y = node.position.y;
  node.setPosition(node.position.x, y + amp, 0);
  tween(node)
    .to(dur, { position: new Vec3(node.position.x, y - amp, 0) }, { easing: "sineInOut" })
    .to(dur, { position: new Vec3(node.position.x, y + amp, 0) }, { easing: "sineInOut" })
    .union()
    .repeatForever()
    .start();
}

/** 得分 pop(老 @keyframes pop):放大 1.7 → 回缩,附带闪一次荧光黄 */
export function popScore(node: Node, label?: Label, flashHex = ARCADE.acid, baseHex = ARCADE.paper): void {
  Tween.stopAllByTarget(node);
  node.setScale(1.7, 1.7, 1);
  tween(node)
    .to(0.13, { scale: new Vec3(1, 1, 1) }, { easing: "quadOut" })
    .start();
  if (label) {
    label.color = ac(flashHex);
    tween(label.node)
      .delay(0.24)
      .call(() => { if (label.isValid) label.color = ac(baseHex); })
      .start();
  }
}

/** 大字横幅(老 #flash banner):底部弹入 → 定格 → 上飘淡出(一次性,由调用方触发) */
export function bannerOnce(node: Node, label: Label): void {
  const op = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
  Tween.stopAllByTarget(node);
  Tween.stopAllByTarget(op);
  const y0 = node.position.y;
  op.opacity = 0;
  node.setScale(0.8, 0.8, 1);
  node.setPosition(node.position.x, y0 - 24, 0);
  tween(node)
    .to(0.2, { scale: new Vec3(1.06, 1.06, 1), position: new Vec3(node.position.x, y0, 0) }, { easing: "quadOut" })
    .to(0.1, { scale: new Vec3(1, 1, 1) })
    .delay(0.72)
    .to(0.3, { position: new Vec3(node.position.x, y0 + 16, 0) }, { easing: "quadIn" })
    .start();
  tween(op)
    .to(0.18, { opacity: 255 })
    .delay(0.74)
    .to(0.3, { opacity: 0 })
    .start();
  label.color = ac(ARCADE.paper);
}

/** 关闭节点上全部循环动画(floatLoop 等),show 时先调 */
export function stopLoops(node: Node): void {
  Tween.stopAllByTarget(node);
}
