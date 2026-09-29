// ============================================================
// 街机绘图构件:移植老项目 styles/ui.css + base.css 的
// 「黄昏体育馆 · 街机赛事海报」语言 —— 硬偏移阴影贴纸感、
// 厚底 3D 按钮、扫描线氛围、rise / slam / pop 分层入场。
//
// 只依赖 cc 与 core/config,不 import 其它 ui 文件:ui-manager 与 career/drill
// 面板都要用它,放独立文件避免互相 import 成环。
// Graphics 为保留型画布:一次构建,运行时零重绘(动画只用 tween)。
// ============================================================
import { BlockInputEvents, Button, Color, Graphics, Label, Node, sys, Tween, tween, UIOpacity, UITransform, Vec3, view } from "cc";
import { CFG } from "../core/config";

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

// ---------- 移动端触控令牌(统一从这把尺子出,不再每个面板各写各的) ----------

/** 触控目标最小高度(世界单位):1 单位 ≈ 0.15mm,44 ≈ 6.6mm,是拇指点准的下限 */
export const TOUCH_MIN = 44;
/** 相邻可点目标的最小间隙:低于它就到了「想按 A 按成 B」的误触区 */
export const TOUCH_GAP = 14;
/** 关停类小按钮(返回 ✕ 等)的命中区边长:视觉小、命中大 */
export const ICON_HIT = 56;

// ---------- 安全区:三处私有实现收编成一份 ----------

export interface SafePad { top: number; right: number; bottom: number; left: number }

/**
 * 刘海/打孔/圆角的安全内缩,像素 → 世界单位换算只在这里做一次。
 * hud.ts 与 settings-panel.ts 曾各抄一份且算法漂移(后者忘了乘缩放,
 * 高分屏上避让量差一截),touchpad.ts 又是第三套 —— UI 层一律改用本函数。
 * 顶边 cap 48:刘海再高也不能把记分牌推到球场中间;左右给 14 的基础边距。
 */
export function safePad(): SafePad {
  let top = 0, left = 14, right = 14, bottom = 0;
  try {
    const vs = view.getVisibleSize();
    const sr = sys.getSafeAreaRect();
    if (vs.height > 0 && sr) {
      const k = CFG.world.h / vs.height;          // 像素 → 世界单位
      const t = vs.height - (sr.y + sr.height);
      if (t > 0) top = Math.min(48, t * k);
      if (sr.x > 0) left = Math.max(left, sr.x * k + 8);
      const r = vs.width - (sr.x + sr.width);
      if (r > 0) right = Math.max(right, r * k + 8);
      if (sr.y > 0) bottom = Math.min(24, sr.y * k);
    }
  } catch { /* 拿不到安全区就按无刘海排 */ }
  return { top, right, bottom, left };
}

// ---------- 统一按压反馈与面板退场 ----------

/**
 * 裸 TOUCH_END 交互的按压反馈:按下缩到 0.94、抬起回弹。
 * Button(SCALE) 组件的等价物 —— 皮肤卡/关卡卡用不到 Button 的 CLICK 语义,
 * 但「按下去有回应」不能缺席(此前这两块面板点了毫无反应,与全站手感割裂)。
 */
export function pressFx(node: Node): void {
  node.on(Node.EventType.TOUCH_START, () => {
    if (!node.isValid) return;
    Tween.stopAllByTarget(node);
    node.setScale(0.94, 0.94, 1);
  });
  const up = (): void => {
    if (!node.isValid) return;
    Tween.stopAllByTarget(node);
    tween(node).to(0.14, { scale: new Vec3(1, 1, 1) }, { easing: "backOut" }).start();
  };
  node.on(Node.EventType.TOUCH_END, up);
  node.on(Node.EventType.TOUCH_CANCEL, up);
}

/** 在途退场动画的作废令牌:show 前调 cancelFade,晚到的 fade 回调不再关面板 */
const fadeTags = new Map<Node, number>();

/** 已完成淡出的面板:hide 对隐着的面板重复调用时短路,防止 opacity 复位 255 闪现 */
const fadedOut = new WeakSet<Node>();

/**
 * 面板退场统一收尾:淡出 + 轻缩,完了把交互件禁用。
 * 曾经所有面板 hide 都是瞬间 active=false —— 进有 rise/slam,出却是硬切。
 * 退场比进场快(0.15s),别让人等;BlockInputEvents 立即失效,
 * 淡出的残影不该拦着已经在打球的拇指。
 *
 * 隐藏语义刻意**不用 active=false**:「UIOpacity 归零后整树 deactivate」会踩进
 * 引擎的坑 —— Graphics 的渲染数据在 onDisable 里被清掉,重新 activate 不会自动
 * 重传,面板再显示时所有一次绘制的底块全部隐身(标签无事,Label 每帧重建自己的
 * 数据)。用户报告的「训练场返回主菜单后按钮全透明」即此因。而纯透明度 0↔255
 * 往返从不丢 Graphics(slamIn 每次显示都在跑),故隐藏改为:
 * 保持 active + UIOpacity 0 + Button/BlockInputEvents 禁用,重显由 cancelFade 还原。
 */
export function fadeOutHide(node: Node, onDone?: () => void, dur = 0.15): void {
  if (fadedOut.has(node)) { onDone?.(); return; }
  for (const b of node.getComponentsInChildren(BlockInputEvents)) b.enabled = false;
  for (const b of node.getComponentsInChildren(Button)) b.enabled = false;
  const op = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
  Tween.stopAllByTarget(node);
  Tween.stopAllByTarget(op);
  op.opacity = 255;
  node.setScale(1, 1, 1);
  const tag = (fadeTags.get(node) ?? 0) + 1;
  fadeTags.set(node, tag);
  tween(op)
    .to(dur, { opacity: 0 })
    .call(() => {
      if (!node.isValid || fadeTags.get(node) !== tag) return;
      op.opacity = 0;
      node.setScale(1, 1, 1);
      fadedOut.add(node);
      onDone?.();
    })
    .start();
}

/** show() 前调:作废在途退场,面板从可见态起步(快速关-开不会被旧动画收走) */
export function cancelFade(node: Node): void {
  fadeTags.set(node, (fadeTags.get(node) ?? 0) + 1);
  const op = node.getComponent(UIOpacity);
  if (op) {
    Tween.stopAllByTarget(op);
    op.opacity = 255;
  }
  Tween.stopAllByTarget(node);
  // 从隐藏态恢复:把退场时禁用的交互件全部开回(首次显示时它们从未被禁,开了也无副作用)
  for (const b of node.getComponentsInChildren(Button)) b.enabled = true;
  for (const b of node.getComponentsInChildren(BlockInputEvents)) b.enabled = true;
}

/**
 * 图标按钮:视觉圆底小、命中区大 —— 触摸目标是 contentSize(默认 56),
 * 圆底只是其中央一块,拇指不用瞄准。返回节点自带 Button(SCALE),接 CLICK 用。
 */
export function uiIconButton(
  parent: Node, glyph: string,
  opts: { hit?: number; vis?: number; bg?: string; bgA?: number; edge?: string; edgeA?: number; fg?: string; fontSize?: number } = {},
): Node {
  const hit = opts.hit ?? ICON_HIT;
  const vis = opts.vis ?? TOUCH_MIN;
  const n = new Node(`icon-btn:${glyph}`);
  n.layer = parent.layer;
  n.addComponent(UITransform).setContentSize(hit, hit);
  const g = n.addComponent(Graphics);
  const r = vis / 2;
  g.fillColor = ac("#000000", 0.45);          // 硬偏移阴影
  g.circle(2.5, -2.5, r);
  g.fill();
  g.fillColor = ac(opts.bg ?? "#6e2029", opts.bgA ?? 0.94);
  g.circle(0, 0, r);
  g.fill();
  g.strokeColor = ac(opts.edge ?? "#ff8a8a", opts.edgeA ?? 0.7);
  g.lineWidth = 1.5;
  g.circle(0, 0, r);
  g.stroke();
  const ln = new Node("glyph");
  ln.layer = parent.layer;
  ln.addComponent(UITransform).setContentSize(vis, vis);
  ln.setParent(n);
  const l = ln.addComponent(Label);
  l.string = glyph;
  l.fontSize = opts.fontSize ?? 18;
  l.lineHeight = vis;
  l.horizontalAlign = Label.HorizontalAlign.CENTER;
  l.verticalAlign = Label.VerticalAlign.CENTER;
  l.color = ac(opts.fg ?? ARCADE.paper);
  const b = n.addComponent(Button);
  b.transition = Button.Transition.SCALE;
  b.zoomScale = 0.9;
  b.target = n;
  n.setParent(parent);
  return n;
}

export function ac(hex: string, alpha = 1): Color {
  const c = new Color();
  c.fromHEX(hex);
  if (alpha < 1) c.a = Math.round(alpha * 255);
  return c;
}

/** 同色系压暗:k<1 越暗。厚底边/描边要跟着 accent 走,不能每个色再手写一遍深色 */
export function acShade(hex: string, k: number, alpha = 1): Color {
  const c = new Color();
  c.fromHEX(hex);
  c.r = Math.round(c.r * k);
  c.g = Math.round(c.g * k);
  c.b = Math.round(c.b * k);
  c.a = Math.round(alpha * 255);
  return c;
}

/**
 * 文案宽度估算:全角按 1.05、半角按 0.62 个字宽。
 * Graphics 没有 measureText,而 Label 的 contentSize 要等布局才准(当帧读是旧值),
 * 所以「底块要跟着字长走」的地方(chip / 轻提示 / HUD 状态条)统一用这把尺子。
 */
export function textW(text: string, size: number): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) w += text.charCodeAt(i) > 255 ? 1.05 : 0.62;
  return Math.round(w * size);
}

// ---------- 硬偏移阴影(sticker 感的魂) ----------

/** 阴影矩形:偏移 (dx,dy) 的纯色块,画在主体之前 */
export function drawHardShadow(g: Graphics, w: number, h: number, r: number, dx = 5, dy = 5, alpha = 0.55): void {
  g.fillColor = ac("#000000", alpha);
  g.roundRect(-w / 2 + dx, -h / 2 - dy, w, h, r);
  g.fill();
}

// ---------- 面板:渐变模拟 + 描边 + 内高光 ----------

// ---------- 遮罩:老 .screen 的 radial-gradient(中心透、四周暗) ----------

/**
 * 分层暗遮罩:模拟 `radial-gradient(... rgba(.centerA) ... rgba(.edgeA))`。
 * 画法是从内到外一圈圈「矩形环」,每环再切成上/下/左/右 4 块互不重叠的填充,
 * 所以不会像嵌套整块填充那样把中心越叠越黑 —— 中心正好是 centerA。
 * 菜单/面板背后要看得见球场,centerA 就是那个「看得见」的量。
 */
export function drawVeil(g: Graphics, w: number, h: number, centerA: number, edgeA: number, bands = 8, hex = ARCADE.ink): void {
  const hw = w / 2, hh = h / 2;
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  for (let i = 0; i < bands; i++) {
    const u = i / bands, v = (i + 1) / bands;
    const a = centerA + (edgeA - centerA) * smooth((u + v) / 2);
    if (a <= 0.001) continue;
    g.fillColor = ac(hex, a);
    const x0 = hw * u, x1 = hw * v;   // 环的内外边界(半宽方向)
    const y0 = hh * u, y1 = hh * v;
    g.rect(-x1, y0, x1 * 2, y1 - y0);         // 上
    g.rect(-x1, -y1, x1 * 2, y1 - y0);        // 下
    if (y0 > 0) {
      g.rect(-x1, -y0, x1 - x0, y0 * 2);      // 左
      g.rect(x0, -y0, x1 - x0, y0 * 2);       // 右
    }
    g.fill();
  }
}

// ---------- 玻璃卡:球场透得过,字还站得住 ----------

/**
 * 半透明「毛玻璃」底:深色压住背景保证对比度 + 白描边 + 顶边高光。
 * 用于菜单卡片/列表项这类要贴在球场上展示的表面。
 * 两层底:近黑层压对比,再叠一层 navy-2 蓝灰「色底」—— 深色球馆背景上
 * 纯近黑半透明看不出卡片的形状,蓝灰层让按钮在任何背景下都显出底色。
 */
export function drawGlassCard(g: Graphics, w: number, h: number, r = 10, darkA = 0.42, accentHex?: string): void {
  g.fillColor = ac(ARCADE.ink, darkA);
  g.roundRect(-w / 2, -h / 2, w, h, r);
  g.fill();
  g.fillColor = ac(ARCADE.navy2, darkA * 0.6);
  g.roundRect(-w / 2, -h / 2, w, h, r);
  g.fill();
  g.fillColor = ac("#ffffff", 0.06);
  g.roundRect(-w / 2, h / 2 - h * 0.5, w, h * 0.5, r);
  g.fill();
  g.strokeColor = ac(accentHex ?? ARCADE.paper, accentHex ? 0.75 : 0.3);
  g.lineWidth = accentHex ? 2 : 1.5;
  g.roundRect(-w / 2, -h / 2, w, h, r);
  g.stroke();
  // 顶缘高光:老 kbd / 面板 border 上沿提亮
  g.strokeColor = ac("#ffffff", 0.1);
  g.lineWidth = 1;
  g.roundRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6, Math.max(2, r - 3));
  g.stroke();
}

// ---------- 主菜单卡片:要「站在」球场上,而不是透出去 ----------

export interface MenuCardOpts {
  /** 强调色:左缘色带 + 描边 + 厚底边 + 卡面染色 */
  accent?: string;
  /** 卡面 accent 染色强度,默认 0.12 */
  tint?: number;
  /** 底色不透明度,默认 0.88(留一点透光,身后那座场子不至于完全消失) */
  alpha?: number;
  /** 左缘竖条宽度,默认 5;0 = 不画 */
  bar?: number;
  /** 厚底边厚度,默认 4;0 = 不画 */
  edge?: number;
  /** 选中态:accent 描边提亮 */
  active?: boolean;
}

/**
 * 菜单主视觉卡底:不透明 navy 渐变 + accent 色调/描边/厚底边 + 左缘色带。
 *
 * 与 drawGlassCard 的分工:玻璃卡用在「身后是深色面板」的列表项和开关上;
 * 而难度卡 / 入口条 / 球馆 tab 是直接贴在球场地面上的 —— 海滩场、竹林道场
 * 这类亮地面下,0.4 的近黑根本读不出形状(实测就是"和背景融成一片")。
 * 所以这里底色给到 navy 的实色渐变,再靠 accent 把三档难度区分开。
 */
export function drawMenuCard(g: Graphics, w: number, h: number, r = 12, o: MenuCardOpts = {}): void {
  const a = o.alpha ?? 0.88;
  const accent = o.accent;
  const hw = w / 2, hh = h / 2;
  const edge = o.edge ?? 4;
  const bar = o.bar ?? 5;

  // 厚底边:同色系压暗向下垫一层 → 街机贴纸的立体感(按下时整卡缩放,底边跟着走)
  if (edge > 0 && accent) {
    g.fillColor = acShade(accent, 0.36, a);
    g.roundRect(-hw, -hh - edge, w, h + edge, r);
    g.fill();
  }

  // navy 竖向渐变(上亮下暗),与 drawArcadePanel 同源
  g.fillColor = ac(ARCADE.panelTop, a);
  g.roundRect(-hw, -hh, w, h, r);
  g.fill();
  g.fillColor = ac(ARCADE.navy, 0.62 * a);
  g.roundRect(-hw, -hh, w, h * 0.62, r);
  g.fill();
  g.fillColor = ac(ARCADE.ink, 0.55 * a);
  g.roundRect(-hw, -hh, w, h * 0.34, r);
  g.fill();

  // accent 整面染色:让每张卡带自己的色调,而不是只有一条边
  if (accent) {
    g.fillColor = ac(accent, (o.tint ?? 0.12) * a);
    g.roundRect(-hw, -hh, w, h, r);
    g.fill();
  }

  // 左缘色带:内缩一点,免得戳出圆角
  if (bar > 0 && accent) {
    g.fillColor = ac(accent, 0.95);
    g.roundRect(-hw + 5, -hh + 6, bar, h - 12, bar / 2);
    g.fill();
  }

  // 描边 + 顶缘高光线
  g.strokeColor = ac(accent ?? ARCADE.paper, accent ? (o.active ? 0.92 : 0.6) : 0.24);
  g.lineWidth = accent ? 2 : 1.5;
  g.roundRect(-hw, -hh, w, h, r);
  g.stroke();
  g.strokeColor = ac(accent ?? "#ffffff", 0.18);
  g.lineWidth = 1;
  g.roundRect(-hw + 3, -hh + 3, w - 6, h - 6, Math.max(2, r - 3));
  g.stroke();
  // 顶缘高光线:窄条上留不住就干脆不画,免得负宽矩形翻到左边去
  const glossW = w - (r + 8) * 2;
  if (glossW > 10) {
    g.fillColor = ac("#ffffff", 0.2);
    g.roundRect(-hw + r + 8, hh - 2.5, glossW, 1.5, 0.75);
    g.fill();
  }
}

/** 右向箭标:入口条右侧的「点我进去」提示(节点原点即箭标中心) */
export function drawChevron(g: Graphics, size = 10, hex = ARCADE.paper, alpha = 0.75, count = 2): void {
  g.strokeColor = ac(hex, alpha);
  g.lineWidth = 2.4;
  for (let i = 0; i < count; i++) {
    const ox = (i - (count - 1) / 2) * (size * 0.72);
    g.moveTo(ox - size * 0.34, size * 0.5);
    g.lineTo(ox + size * 0.34, 0);
    g.lineTo(ox - size * 0.34, -size * 0.5);
    g.stroke();
  }
}

/** 街机面板底:上亮下暗的竖向渐变(用半透明叠层模拟)+ 2px 描边 + 顶边高光线 */
export function drawArcadePanel(g: Graphics, w: number, h: number, r = 14, alpha = 1): void {
  // 渐变模拟:底部整块 navy,再叠 3 段向上变亮的横带(半透明,肉眼平滑)
  g.fillColor = ac(ARCADE.panelTop, alpha);          // 顶端最亮 #16203c
  g.roundRect(-w / 2, -h / 2, w, h, r);
  g.fill();
  g.fillColor = ac(ARCADE.navy, 0.55 * alpha);       // 中段压暗
  g.roundRect(-w / 2, -h / 2, w, h * 0.62, r);
  g.fill();
  g.fillColor = ac(ARCADE.ink, 0.5 * alpha);         // 底端最深 #0b1020
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
    // ghost = 面板里的次级按钮。老写法(ink 40% + 白 7%)在 navy 面板上只有
    // 约 1.1:1,读起来根本不像个按钮 —— 和主菜单那次「和背景融成一片」同一个病。
    // 现在与 primary/danger 同构:暗底边 + 实色 navy-2 面 + 提亮描边。
    g.fillColor = acShade(ARCADE.navy2, 0.42);            // 厚底边
    g.roundRect(-w / 2, -h / 2 - bottom, w, h + bottom, r);
    g.fill();
    g.fillColor = ac(ARCADE.navy2, 0.98);                 // 主面
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.fill();
    g.fillColor = ac(ARCADE.ink, 0.28);                   // 下半压暗,做出竖向层次
    g.roundRect(-w / 2, -h / 2, w, h * 0.42, r);
    g.fill();
    g.strokeColor = ac(ARCADE.paper, 0.32);
    g.lineWidth = 2;
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.stroke();
    g.fillColor = ac("#ffffff", 0.16);                    // 顶缘高光线(与 primary 同款)
    const gw = w - (r + 8) * 2;
    if (gw > 10) {
      g.roundRect(-gw / 2, h / 2 - 2.5, gw, 1.5, 0.75);
      g.fill();
    }
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

  // 计算字符显示宽度(全角汉字按 1.05, 半角按 0.62)
  const w = Math.max(size * 2 + 16, textW(text, size) + 16);
  const h = Math.round(size + 10);
  drawChip(g, w, h, bg);

  const lNode = new Node("chip-text");
  lNode.layer = parent.layer;
  lNode.addComponent(UITransform).setContentSize(w, h);
  lNode.setParent(n);
  const l = lNode.addComponent(Label);
  l.string = text;
  l.fontSize = size;
  l.lineHeight = h;
  l.horizontalAlign = Label.HorizontalAlign.CENTER;
  l.verticalAlign = Label.VerticalAlign.CENTER;
  l.color = ac(fg);

  n.setParent(parent);
  return n;
}

/**
 * 金币图标:Graphics 画的双层圆(替代 🪙 emoji —— 原生平台 FreeType
 * 无彩色 emoji 字体,会渲染成方框)。返回节点直径约 18px,可与数字 Label 组合。
 */
export function makeCoinIcon(parent: Node, x = 0, y = 0, r = 9): Node {
  const n = new Node("coin-icon");
  n.layer = parent.layer;
  n.addComponent(UITransform);
  n.setPosition(x, y, 0);
  const g = n.addComponent(Graphics);
  // 金底 + 深金描边
  g.fillColor = ac("#ffd34d");
  g.circle(0, 0, r);
  g.fill();
  g.strokeColor = ac("#b79b12");
  g.lineWidth = 1.5;
  g.circle(0, 0, r);
  g.stroke();
  // 内圈(铸币感)
  g.strokeColor = ac("#c79a1e", 0.9);
  g.lineWidth = 1;
  g.circle(0, 0, r * 0.62);
  g.stroke();
  // 高光弧
  g.strokeColor = ac("#fff2b8", 0.95);
  g.lineWidth = 1.6;
  g.arc(0, 0, r * 0.72, 130, 205, false);
  g.stroke();
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
