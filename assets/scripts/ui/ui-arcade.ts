// ============================================================
// 街机绘图构件:「暗红斩劈」视觉语言(女神异闻录式 UI)——
// 斜切平行四边形、锯齿撕纸边、星芒爆发、侧向斩入与全屏斜切转场,
// 叠在老项目「硬偏移阴影贴纸感」的骨架上(rise / slam / pop 保留)。
// 面色由 navy 蓝调整体换血为墨黑,主强调色由荧光黄让位给斩劈红,
// 黄降为二级点缀(金币 / 连击 / TO 徽章)。
//
// 只依赖 cc、core/config 与零依赖的 text-metrics,不 import 其它 ui 文件:ui-manager 与 career/drill
// 面板都要用它,放独立文件避免互相 import 成环。
// Graphics 为保留型画布:一次构建,运行时零重绘(动画只用 tween)。
// 例外是 retainedDraw() 那一条:节点被 deactivate 再 activate 时原生侧会掉渲染数据,
// 所以「会被按状态开关」的底块都登记一份可重放的绘制,激活时 clear()+重画。
// ============================================================
import { BlockInputEvents, Button, Color, Component, Font, Graphics, Label, Node, resources, sys, Tween, tween, UIOpacity, UITransform, Vec3, view, Widget, _decorator } from "cc";
import { CFG } from "../core/config";
import { textW } from "./text-metrics";

const { ccclass } = _decorator;

// ---------- 设计令牌(P5「暗红斩劈」:红黑白主导,黄点缀) ----------
export const ARCADE = {
  ink: "#07070d",        // 最深底(P5 黑)
  navy: "#101018",       // 面板底(原深蓝 navy 换血为近黑)
  navy2: "#1a1a26",      // 按钮底/面板上层
  panelTop: "#20202e",   // 面板渐变上端
  line: "#2c2c3a",       // 描线
  paper: "#f5efe1",      // 暖纸白(正文/大字)
  paperDim: "#cfc7b4",
  acid: "#ffe14d",       // 荧光黄:二级点缀(金币/连击/TO 徽章)
  acidEdge: "#b79b12",
  acidDk: "#8a7514",
  slash: "#e60012",      // P5 主红:主按钮/横幅/强调块
  slashDk: "#8f000b",    // 主红的厚底边
  red: "#ff4d4d",        // 队色红(与球衣同源,别当主红用)
  blue: "#3ea8ff",       // 队色蓝
  wood: "#c8703a",       // 暖木
  good: "#7dff9e",
  bad: "#ff6b6b",
  cyan: "#00f0ff",
  dim: "#8f9cbe",
  dimDeep: "#6f7ca6",
};

// ---------- 显示字体:子集化的中文标题黑体(见 tools/make-font-subset.py) ----------
// 挂标题/比分大字/横幅;加载失败(资源未导入、低端机)静默回退系统字体,调用方无需判空。
let displayFont: Font | null = null;
const fontWaiters: Array<(f: Font) => void> = [];

/** 标题/大字专用字体;尚未加载完成时返回 null(调用方先按系统字体走) */
export function getDisplayFont(): Font | null { return displayFont; }

/** 字体就绪回调(已就绪则立即调):给先建好的 Label 补挂字体用 */
export function onDisplayFont(cb: (f: Font) => void): void {
  if (displayFont) { cb(displayFont); return; }
  fontWaiters.push(cb);
}

try {
  resources.load("fonts/dudu-display", Font, (err, asset) => {
    if (!err && asset && asset.isValid) {
      displayFont = asset;
      for (const cb of fontWaiters.splice(0)) cb(asset);
    }
  });
} catch { /* 无 resources 的运行环境忽略:一律系统字体 */ }

// ---------- 移动端触控令牌(统一从这把尺子出,不再每个面板各写各的) ----------

/** 触控目标最小高度(世界单位):1 单位 ≈ 0.15mm,44 ≈ 6.6mm,是拇指点准的下限 */
export const TOUCH_MIN = 44;
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
 * 组件是不是藏在「自己已经淡出收起」的子树里(祖先 = top 时不算)。
 * cancelFade 放行整棵子树时要靠它跳过这些区域,见下面的注释。
 */
function parkedInside(top: Node, n: Node | null): boolean {
  for (let p = n; p && p !== top; p = p.parent) if (fadedOut.has(p)) return true;
  return false;
}

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
 *
 * ⚠ 但这里管不到**裸触摸监听**。引擎派发 UI 触摸默认吞噬(`UIEvent.preventSwallow`
 * 为 false:谁先接住 TOUCH_START,渲染层级在它之下的节点一个都收不到),而吞噬只取决
 * 于「这个节点还 active 且挂着 TOUCH_* 监听」,与监听里干了什么无关。所以:
 *   面板里凡是给整屏/大块节点挂 `node.on(Node.EventType.TOUCH_*)` 的
 *   (点遮罩关闭、日志窗拖动、pressFx 那一类),hide 时必须自己 off、show 时再 on;
 *   否则关掉的面板就是屏幕上一块隐形挡板,底下的虚拟按键与暂停键一起失灵
 *   (无限练习弹窗曾把整局按键打死,见 endless-dialog.setDimLive)。
 * 做不到挂卸的,就学 career/drill/settings:退场动画放完后 destroy。
 *
 * 同一套坑在**面板里的小弹窗**上会再来一遍:fadeOutHide 只管「这一棵」,
 * 而父面板 show() 的 cancelFade(this.root) 管的是「整棵子树」。两层收起状态叠在
 * 一起时,放行必须跳过自己还收着的子树(parkedInside),退场必须无条件收触摸
 * (禁用写在短路判断之前) —— 少一条,那层弹窗的整屏遮罩就常驻在隐形面板之上,
 * 把大厅所有卡片与 ✕ 一起打死。要更省事就学 settings 的编辑器:每次新建、收完 destroy。
 */
export function fadeOutHide(node: Node, onDone?: () => void, dur = 0.15): void {
  // ⚠ 收触摸排在短路判断**之前**:短路只该省掉「重播一遍淡出动画」,
  // 不该顺手省掉「把交互件收走」。写在那道 return 之后的话,同一个节点第二次
  // hide 就是空操作 —— 而它可能在两次之间被父面板的 cancelFade 整树点亮过
  // (见 cancelFade 的 parkedInside),结果隐形遮罩常驻,底下所有按钮点不动
  // (用户报的「闯关成功后返回再进大厅,什么都点不了」正是这一条)。
  for (const b of node.getComponentsInChildren(BlockInputEvents)) b.enabled = false;
  for (const b of node.getComponentsInChildren(Button)) b.enabled = false;
  if (fadedOut.has(node)) { onDone?.(); return; }
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
  // 重新显示了就不算「已淡出」:不清掉的话下一次 hide 会在这里短路成空操作,
  // 面板从此永远挂在屏幕上关不掉(暂停/主菜单/HUD/结算/更新弹窗全中招)。
  fadedOut.delete(node);
  const op = node.getComponent(UIOpacity);
  if (op) {
    Tween.stopAllByTarget(op);
    op.opacity = 255;
  }
  Tween.stopAllByTarget(node);
  // 从隐藏态恢复:把退场时禁用的交互件全部开回(首次显示时它们从未被禁,开了也无副作用)。
  // 但**不碰自己还收着的子树**:面板 show() 的 cancelFade(this.root) 是整树放行,
  // 顺手复活面板里那层已经淡出收起的弹窗,它的整屏 BlockInputEvents 就变成一块
  // 看不见、又吃触摸的挡板(Opacity 0 不参与命中判定,只有 active=false 才不吃)。
  for (const b of node.getComponentsInChildren(Button)) if (!parkedInside(node, b.node)) b.enabled = true;
  for (const b of node.getComponentsInChildren(BlockInputEvents)) if (!parkedInside(node, b.node)) b.enabled = true;
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
  retainedDraw(g, () => {
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
  });
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

// ---------- 小构件:文案宽度 ----------

/**
 * 文案宽度估算:全角按 1.05、半角按 0.62 个字宽 —— 实现见 ./text-metrics.ts。
 * 搬出去只为让零 cc 依赖的折行算法能在 node 下回归(更新弹窗的溢出全押在这把尺上);
 * 这里 import 再 export:本文件 makeChip 要用它,各面板
 * `import { textW } from "./ui-arcade"` 的调用点也一律不动。
 */
export { textW };

// ---------- 一次绘制的 Graphics 的「复活」 ----------

/**
 * 记在组件上的那次绘制。用闭包而不是去摸引擎私有字段:`clear()` + 重画是
 * 本仓库已经验证过的活路(开关/滑杆就是这么在往返后活下来的)。
 */
@ccclass("GraphicsKeepAlive")
class GraphicsKeepAlive extends Component {
  private g: Graphics | null = null;
  private draw: (() => void) | null = null;

  /** 必须晚于 Graphics 的 addComponent:激活顺序按组件顺序走,要排在它后面 */
  setup(g: Graphics, draw: () => void): void {
    this.g = g;
    this.draw = draw;
  }

  onEnable(): void {
    const g = this.g;
    if (!g || !g.isValid || !this.draw) return;
    g.clear();
    this.draw();
  }
}

/**
 * 把「一次绘制」登记成可重放:节点每次回到激活态(含被祖先带起来)就 clear() + 重画。
 *
 * 为什么要这一手 —— 引擎 `UIRenderer.onDisable → destroyRenderData()`,原生(JSB)侧
 * Graphics 的渲染数据被清之后,重新 activate **不会**自动重传:底块全透明、只剩 Label,
 * 而每次 `clear()` + 重画的构件毫发无损。web/preview 完全不复现,所以只能从源头兜住。
 * 面板整块的显隐另有 `fadeOutHide`/`cancelFade`(压根不 deactivate);这个管的是
 * 「按状态每帧开关的小件」—— 暂停键、比分胶囊、发球旗标、页内子树那一类。
 *
 * 约定:`draw` 必须自包含且可重复执行(只往 g 上画,不写外部状态)。
 * 首帧会画两次(登记时一次 + 激活时一次),代价是一次 roundRect,换调用点不用改结构。
 */
export function retainedDraw(g: Graphics, draw: () => void): Graphics {
  draw();
  const n = g.node;
  const k = (n.getComponent(GraphicsKeepAlive) ?? n.addComponent(GraphicsKeepAlive)) as GraphicsKeepAlive;
  k.setup(g, draw);
  return g;
}

// ---------- 硬偏移阴影(sticker 感的魂) ----------

/** 阴影矩形:偏移 (dx,dy) 的纯色块,画在主体之前 */
export function drawHardShadow(g: Graphics, w: number, h: number, r: number, dx = 5, dy = 5, alpha = 0.55): void {
  g.fillColor = ac("#000000", alpha);
  g.roundRect(-w / 2 + dx, -h / 2 - dy, w, h, r);
  g.fill();
}

// ---------- 斜切几何(P5 的基本语汇:平行四边形 + 锯齿 + 星芒) ----------

/** 斜切量换算:高 h 的块倾斜 deg 度时,顶边相对底边的水平偏移(世界单位) */
export function skewOf(h: number, deg: number): number {
  return h * Math.tan(deg * Math.PI / 180);
}

/**
 * 斜切平行四边形路径(视觉居中约定):整体盒心与节点原点对齐,
 * skew>0 = 顶边向 +x 倾(与 CSS skewX(负角) 同视效)。cx/cy 为整块平移。
 * 注意视觉盒比 w 宽 |skew|:动态底块的宽度计算要预留这份溢出。
 */
export function slantPath(g: Graphics, w: number, h: number, skew: number, cx = 0, cy = 0): void {
  const s = skew / 2;
  g.moveTo(-w / 2 + s + cx, -h / 2 + cy);
  g.lineTo(w / 2 + s + cx, -h / 2 + cy);
  g.lineTo(w / 2 - s + cx, h / 2 + cy);
  g.lineTo(-w / 2 - s + cx, h / 2 + cy);
  g.close();
}

/** 斜切硬阴影:与 drawHardShadow 同职责,形状跟着斜切块走 */
export function drawSlantShadow(g: Graphics, w: number, h: number, skew: number, dx = 5, dy = 5, alpha = 0.55): void {
  g.fillColor = ac("#000000", alpha);
  slantPath(g, w, h, skew, dx, -dy);
  g.fill();
}

export interface SlantPanelOpts {
  /** 整块不透明度,默认 0.92 */
  alpha?: number;
  /** 面色,默认面板黑 */
  face?: string;
  /** 描边色,默认纸白低透明 */
  edge?: string;
  edgeA?: number;
}

/**
 * 斜切面板底:面色 + 下半压暗(同斜率的内接带)+ 描边 + 顶缘高光线。
 * P5 是平面高对比,不做多层渐变;层次靠硬阴影与描边。
 */
export function drawSlantPanel(g: Graphics, w: number, h: number, skew: number, o: SlantPanelOpts = {}): void {
  const a = o.alpha ?? 0.92;
  g.fillColor = ac(o.face ?? ARCADE.panelTop, a);
  slantPath(g, w, h, skew);
  g.fill();
  g.fillColor = ac(ARCADE.ink, 0.45 * a);
  slantPath(g, w, h * 0.5, skew * 0.5, 0, h * 0.25);
  g.fill();
  g.strokeColor = ac(o.edge ?? ARCADE.paper, o.edgeA ?? 0.18);
  g.lineWidth = 2;
  slantPath(g, w, h, skew);
  g.stroke();
  const s = skew / 2;
  g.strokeColor = ac("#ffffff", 0.13);
  g.lineWidth = 1;
  g.moveTo(-w / 2 + s + 3, -h / 2);
  g.lineTo(w / 2 + s - 3, -h / 2);
  g.stroke();
}

/**
 * 锯齿条(撕纸边):w 均分 teeth 个齿。dir="up" 齿尖朝上(基线在下缘 -h/2),
 * "down" 齿尖朝下(基线在上缘 +h/2);"left"/"right" 为竖向齿(基线在 x=+w/2 / -w/2)。
 * 用作横幅上下缘、卡片撕边、旗标装饰带;cx/cy 为整条平移。
 */
export function drawSawtooth(g: Graphics, w: number, h: number, teeth: number, hex: string, alpha = 1, dir: "up" | "down" | "left" | "right" = "up", cx = 0, cy = 0): void {
  g.fillColor = ac(hex, alpha);
  if (dir === "up" || dir === "down") {
    const base = dir === "up" ? -h / 2 : h / 2;
    const tip = -base;
    const step = w / teeth;
    g.moveTo(-w / 2 + cx, base + cy);
    for (let i = 0; i < teeth; i++) {
      const x0 = -w / 2 + i * step;
      g.lineTo(x0 + step * 0.5 + cx, tip + cy);
      g.lineTo(x0 + step + cx, base + cy);
    }
  } else {
    const base = dir === "right" ? -w / 2 : w / 2;
    const tip = -base;
    const step = h / teeth;
    g.moveTo(base + cx, h / 2 + cy);
    for (let i = 0; i < teeth; i++) {
      const y0 = h / 2 - i * step;
      g.lineTo(tip + cx, y0 - step * 0.5 + cy);
      g.lineTo(base + cx, y0 - step + cy);
    }
  }
  g.close();
  g.fill();
}

/** 45° 斜纹带:gap 为条纹间距(条宽 = gap),裁在 w×h 域内(P5 危险条纹) */
export function drawDiagStripes(g: Graphics, w: number, h: number, gap: number, hex: string, alpha = 1, cx = 0, cy = 0): void {
  g.fillColor = ac(hex, alpha);
  const bw = gap;
  for (let x = -w / 2 - h; x < w / 2; x += gap * 2) {
    g.moveTo(x + cx, h / 2 + cy);
    g.lineTo(x + bw + cx, h / 2 + cy);
    g.lineTo(x + bw + h + cx, -h / 2 + cy);
    g.lineTo(x + h + cx, -h / 2 + cy);
    g.close();
  }
  g.fill();
}

/** 星芒:n 尖多角星(rot 弧度),得分爆发/徽章衬底 */
export function drawStarburst(g: Graphics, rOut: number, rIn: number, points: number, hex: string, alpha = 1, rot = 0): void {
  g.fillColor = ac(hex, alpha);
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOut : rIn;
    const t = (Math.PI * i) / points + rot;
    const x = Math.cos(t) * r;
    const y = Math.sin(t) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.close();
  g.fill();
}

/**
 * 一次性星芒爆发:得分/连击点燃的 P5 高光。自构建自销毁,不占常驻节点;
 * below=true 时插到父节点最底层(星芒衬在数字后面,不糊字)。
 */
export function burstOnce(parent: Node, hex: string, r = 30, points = 10, x = 0, y = 0, below = false): void {
  if (!parent.isValid) return;
  const n = new Node("burst");
  n.layer = parent.layer;
  n.addComponent(UITransform);
  n.setPosition(x, y, 0);
  const g = n.addComponent(Graphics);
  // P5 双层尖刺星:内层白 0.4α、rot 错半步,读出「叠了两张纸」的剪纸感
  drawStarburst(g, r, r * 0.55, points, hex, 0.95);
  drawStarburst(g, r * 0.72, r * 0.4, points, "#ffffff", 0.4, Math.PI / points);
  const op = n.addComponent(UIOpacity);
  n.setScale(0.4, 0.4, 1);
  if (below) parent.insertChild(n, 0); else n.setParent(parent);
  tween(n).to(0.2, { scale: new Vec3(1.15, 1.15, 1) }, { easing: "quadOut" }).start();
  tween(op).to(0.26, { opacity: 0 }).call(() => { if (n.isValid) n.destroy(); }).start();
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
 * slant≠0 时切成平行四边形(跳过圆角专属的半面高光)。
 */
export function drawGlassCard(g: Graphics, w: number, h: number, r = 10, darkA = 0.42, accentHex?: string, slant = 0): void {
  const drawBody = (): void => {
    if (slant !== 0) {
      slantPath(g, w, h, skewOf(h, slant));
      g.fill();
      return;
    }
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.fill();
  };
  g.fillColor = ac(ARCADE.ink, darkA);
  drawBody();
  g.fillColor = ac(ARCADE.navy2, darkA * 0.6);
  drawBody();
  if (slant === 0) {
    g.fillColor = ac("#ffffff", 0.06);
    g.roundRect(-w / 2, h / 2 - h * 0.5, w, h * 0.5, r);
    g.fill();
  }
  g.strokeColor = ac(accentHex ?? ARCADE.paper, accentHex ? 0.75 : 0.3);
  g.lineWidth = accentHex ? 2 : 1.5;
  drawBody();
  g.stroke();
  if (slant !== 0) {
    const s = skewOf(h, slant) / 2;
    g.strokeColor = ac("#ffffff", 0.12);
    g.lineWidth = 1;
    g.moveTo(-w / 2 + s + 3, -h / 2);
    g.lineTo(w / 2 + s - 3, -h / 2);
    g.stroke();
    return;
  }
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
  /** 斜切角度(度,P5 平行四边形);0/缺省 = 圆角矩形(向后兼容) */
  slant?: number;
}

/**
 * 菜单主视觉卡底:不透明 navy 渐变 + accent 色调/描边/厚底边 + 左缘色带。
 *
 * 与 drawGlassCard 的分工:玻璃卡用在「身后是深色面板」的列表项和开关上;
 * 而难度卡 / 入口条 / 球馆 tab 是直接贴在球场地面上的 —— 海滩场、竹林道场
 * 这类亮地面下,0.4 的近黑根本读不出形状(实测就是"和背景融成一片")。
 * 所以这里底色给到 navy 的实色渐变,再靠 accent 把三档难度区分开。
 * slant>0 时整体切成平行四边形(P5 卡片),子矩形按高度比例同斜率内接。
 */
export function drawMenuCard(g: Graphics, w: number, h: number, r = 12, o: MenuCardOpts = {}): void {
  const a = o.alpha ?? 0.88;
  const accent = o.accent;
  const hw = w / 2, hh = h / 2;
  const edge = o.edge ?? 4;
  const bar = o.bar ?? 5;
  const slDeg = o.slant ?? 0;
  const skew = slDeg !== 0 ? skewOf(h, slDeg) : 0;

  // 厚底边:同色系压暗向下垫一层 → 街机贴纸的立体感(按下时整卡缩放,底边跟着走)
  if (edge > 0 && accent) {
    g.fillColor = acShade(accent, 0.36, a);
    if (slDeg !== 0) { slantPath(g, w, h + edge, skewOf(h + edge, slDeg), 0, -edge / 2); g.fill(); }
    else { g.roundRect(-hw, -hh - edge, w, h + edge, r); g.fill(); }
  }

  // navy 竖向渐变(上亮下暗),与 drawArcadePanel 同源
  g.fillColor = ac(ARCADE.panelTop, a);
  if (slDeg !== 0) { slantPath(g, w, h, skew); g.fill(); }
  else { g.roundRect(-hw, -hh, w, h, r); g.fill(); }
  g.fillColor = ac(ARCADE.navy, 0.62 * a);
  if (slDeg !== 0) { slantPath(g, w, h * 0.62, skewOf(h * 0.62, slDeg), 0, -hh + h * 0.31); g.fill(); }
  else { g.roundRect(-hw, -hh, w, h * 0.62, r); g.fill(); }
  g.fillColor = ac(ARCADE.ink, 0.55 * a);
  if (slDeg !== 0) { slantPath(g, w, h * 0.34, skewOf(h * 0.34, slDeg), 0, -hh + h * 0.17); g.fill(); }
  else { g.roundRect(-hw, -hh, w, h * 0.34, r); g.fill(); }

  // accent 整面染色:让每张卡带自己的色调,而不是只有一条边
  if (accent) {
    g.fillColor = ac(accent, (o.tint ?? 0.12) * a);
    if (slDeg !== 0) { slantPath(g, w, h, skew); g.fill(); }
    else { g.roundRect(-hw, -hh, w, h, r); g.fill(); }
  }

  // 左缘色带:内缩一点,免得戳出圆角;斜切模式下跟着卡边同斜率
  if (bar > 0 && accent) {
    g.fillColor = ac(accent, 0.95);
    if (slDeg !== 0) { slantPath(g, bar, h - 12, skewOf(h - 12, slDeg), -hw + 5 + bar / 2, 0); g.fill(); }
    else { g.roundRect(-hw + 5, -hh + 6, bar, h - 12, bar / 2); g.fill(); }
  }

  // 描边 + 顶缘高光线
  g.strokeColor = ac(accent ?? ARCADE.paper, accent ? (o.active ? 0.92 : 0.6) : 0.24);
  g.lineWidth = accent ? 2 : 1.5;
  if (slDeg !== 0) { slantPath(g, w, h, skew); g.stroke(); }
  else { g.roundRect(-hw, -hh, w, h, r); g.stroke(); }
  if (slDeg !== 0) {
    const s = skew / 2;
    g.strokeColor = ac(accent ?? "#ffffff", 0.22);
    g.lineWidth = 1;
    g.moveTo(-hw + s + 3, -hh);
    g.lineTo(hw + s - 3, -hh);
    g.stroke();
    return;
  }
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

// ---------- 实底大色块:首页模式入口 / 模式屏难度条(P5 海报面) ----------

/**
 * 亮色面上用墨黑字还是纸白字:按相对亮度判(绿/黄/青/纸白 → 墨黑,斩劈红 → 纸白)。
 * 大色块是整面实底,字的对比度就是可读性,不许调用方各拍一个。
 */
export function inkOn(hex: string): boolean {
  const c = ac(hex);
  const l = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  return l > 0.5;   // 亮面 → true(配墨黑字)
}

/**
 * 实底斜切大色块:整面 accent 实底 + 同色压暗厚底边 + 顶缘高光 + 同色描边。
 * 与 drawMenuCard 的分工:MenuCard 是「深底染色卡」,色只在边上;
 * 这里色占满整面(P5 海报的大色块语言),文字用色由 inkOn(accent) 决定。
 */
export function drawSolidBlock(g: Graphics, w: number, h: number, accent: string, slantDeg = 5): void {
  const skew = skewOf(h, slantDeg);
  drawSlantShadow(g, w, h, skew, 5, 8, 0.55);
  g.fillColor = acShade(accent, 0.4);                        // 厚底边(同色压暗)
  slantPath(g, w, h + 5, skewOf(h + 5, slantDeg), 0, -2.5);
  g.fill();
  g.fillColor = ac(accent, 0.97);                            // 主面
  slantPath(g, w, h, skew);
  g.fill();
  const s = skew / 2;
  g.strokeColor = ac("#ffffff", 0.25);                       // 顶缘高光线
  g.lineWidth = 1;
  g.moveTo(-w / 2 + s + 3, h / 2);
  g.lineTo(w / 2 + s - 3, h / 2);
  g.stroke();
  g.strokeColor = acShade(accent, 0.62, 0.9);                // 同色系描边
  g.lineWidth = 2;
  slantPath(g, w, h, skew);
  g.stroke();
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

/** 街机面板底:上亮下暗的竖向渐变(用半透明叠层模拟)+ 2px 描边 + 顶边高光线;
 *  slant≠0 时改为斜切平行四边形(P5 平面高对比,不做渐变叠层) */
export function drawArcadePanel(g: Graphics, w: number, h: number, r = 14, alpha = 1, slant = 0): void {
  if (slant !== 0) {
    const skew = skewOf(h, slant);
    g.fillColor = ac(ARCADE.panelTop, alpha);
    slantPath(g, w, h, skew);
    g.fill();
    g.fillColor = ac(ARCADE.ink, 0.45 * alpha);
    slantPath(g, w, h * 0.5, skew * 0.5, 0, h * 0.25);
    g.fill();
    g.strokeColor = ac(ARCADE.paper, 0.16);
    g.lineWidth = 2;
    slantPath(g, w, h, skew);
    g.stroke();
    const s = skew / 2;
    g.strokeColor = ac("#ffffff", 0.12);
    g.lineWidth = 1;
    g.moveTo(-w / 2 + s + 3, -h / 2);
    g.lineTo(w / 2 + s - 3, -h / 2);
    g.stroke();
    return;
  }
  // 渐变模拟:底部整块 navy,再叠 3 段向上变亮的横带(半透明,肉眼平滑)
  g.fillColor = ac(ARCADE.panelTop, alpha);          // 顶端最亮
  g.roundRect(-w / 2, -h / 2, w, h, r);
  g.fill();
  g.fillColor = ac(ARCADE.navy, 0.55 * alpha);       // 中段压暗
  g.roundRect(-w / 2, -h / 2, w, h * 0.62, r);
  g.fill();
  g.fillColor = ac(ARCADE.ink, 0.5 * alpha);         // 底端最深
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
 * 街机按钮底:
 * primary = 斩劈红面 + 暗红厚底 4px(P5 主行动键,原荧光黄让位为点缀);
 * ghost   = 面板黑面 + 纸白 32% 描边;danger = 暗红面。
 * slant≠0 时整个按钮切成平行四边形(P5 斜切键)。
 * 阴影画在独立节点返回(按压时缩进,见 pressShadow)。
 */
export function drawArcadeButton(g: Graphics, w: number, h: number, style: BtnStyle = "ghost", r = 9, slant = 0): void {
  const bottom = 4; // 厚底厚度
  if (slant !== 0) {
    const skew = skewOf(h, slant);
    let face: Color, bot: Color, edge: Color;
    if (style === "primary") { bot = ac(ARCADE.slashDk); face = ac(ARCADE.slash); edge = ac("#ff6b72", 0.9); }
    else if (style === "danger") { bot = ac("#3a1218"); face = ac("#6e2029"); edge = ac(ARCADE.bad, 0.6); }
    else { bot = acShade(ARCADE.navy2, 0.42); face = ac(ARCADE.navy2, 0.98); edge = ac(ARCADE.paper, 0.32); }
    g.fillColor = bot;
    slantPath(g, w, h + bottom, skew, 0, -bottom / 2);
    g.fill();
    g.fillColor = face;
    slantPath(g, w, h, skew);
    g.fill();
    g.strokeColor = edge;
    g.lineWidth = 2;
    slantPath(g, w, h, skew);
    g.stroke();
    const s = skew / 2;
    g.strokeColor = ac("#ffffff", 0.18);
    g.lineWidth = 1;
    g.moveTo(-w / 2 + s + 3, -h / 2);
    g.lineTo(w / 2 + s - 3, -h / 2);
    g.stroke();
    return;
  }
  if (style === "primary") {
    g.fillColor = ac(ARCADE.slashDk);                // 底边厚块
    g.roundRect(-w / 2, -h / 2 - bottom, w, h + bottom, r);
    g.fill();
    g.fillColor = ac(ARCADE.slash);                  // 主面:斩劈红
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.fill();
    g.strokeColor = ac("#ff6b72");                   // 提亮描边
    g.lineWidth = 2;
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.stroke();
    // 顶缘提亮(kbd 高光同款)
    g.strokeColor = ac("#ffd9d9", 0.55);
    g.lineWidth = 1;
    g.roundRect(-w / 2 + 3, h / 2 - 6, w - 6, 3, 1.5);
    g.fillColor = ac("#ffd9d9", 0.4);
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
    // ghost = 面板里的次级按钮。老写法(ink 40% + 白 7%)在深色面板上只有
    // 约 1.1:1,读起来根本不像个按钮 —— 和主菜单那次「和背景融成一片」同一个病。
    // 现在与 primary/danger 同构:暗底边 + 实色面板黑面 + 提亮描边。
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

/** 标签 chip:底块 + 深色小字(用于 SOLO / EASY / 赛点等);slantDeg>0 切成斜切小片 */
export function makeChip(parent: Node, text: string, size = 9, bg = ARCADE.acid, fg = "#0a0e1c", slantDeg = 0): Node {
  const n = new Node("chip");
  n.layer = parent.layer;
  n.addComponent(UITransform);
  const g = n.addComponent(Graphics);

  // 计算字符显示宽度(全角汉字按 1.05, 半角按 0.62)
  const h = Math.round(size + 10);
  const w = Math.max(size * 2 + 16, textW(text, size) + 16) + (slantDeg !== 0 ? Math.abs(skewOf(h, slantDeg)) : 0);
  retainedDraw(g, () => {
    if (slantDeg !== 0) {
      g.fillColor = ac(bg);
      slantPath(g, w, h, skewOf(h, slantDeg));
      g.fill();
    } else {
      drawChip(g, w, h, bg);
    }
  });

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
  retainedDraw(g, () => {
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
  });
  n.setParent(parent);
  return n;
}

// ---------- 动画(老 ui.css 的 rise / slam / pop / banner + P5 斩入/转场) ----------

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

/**
 * 斩入(P5 式入场):从侧面平移进来 + 初始偏转角回正 + 轻缩放回弹。
 * 用于顶栏徽章 / 比分牌的逐级入场;调用前节点应已就位在最终坐标。
 */
export function slashIn(node: Node, delay = 0, fromX = -42, angle = -6, dur = 0.34): void {
  const op = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
  Tween.stopAllByTarget(node);
  Tween.stopAllByTarget(op);
  const x = node.position.x;
  const y = node.position.y;
  op.opacity = 0;
  node.setPosition(x + fromX, y, 0);
  node.setScale(0.92, 0.92, 1);
  node.angle = angle;
  tween(op).delay(delay).to(dur * 0.4, { opacity: 255 }).start();
  tween(node)
    .delay(delay)
    .to(dur, { position: new Vec3(x, y, 0), angle: 0, scale: new Vec3(1, 1, 1) }, { easing: "backOut" })
    .start();
}

// ---------- 全屏斜切转场(P5 关卡切换的招牌) ----------

let wipeBusy = false;

/**
 * 斜切转场:黑/红两条斜带依次扫过全屏,黑带盖满中点(约 0.2s)回调 onMid ——
 * 状态切换放这里,被盖住时切,观众看不到过程;扫完整层自毁。
 * 进行中重复调用会立即执行 onMid/onDone 并跳过(状态切换必须发生,转场不叠加)。
 * 层级:挂在谁下面就压在谁之上 —— 传最顶层的父节点(Canvas 级)。
 */
export function slashWipe(parent: Node, onMid?: () => void, onDone?: () => void): void {
  if (wipeBusy) { onMid?.(); onDone?.(); return; }
  wipeBusy = true;

  const root = new Node("slash-wipe");
  root.layer = parent.layer;
  root.addComponent(UITransform);
  const wg = root.addComponent(Widget);
  wg.isAlignTop = true; wg.top = 0;
  wg.isAlignBottom = true; wg.bottom = 0;
  wg.isAlignLeft = true; wg.left = 0;
  wg.isAlignRight = true; wg.right = 0;
  wg.updateAlignment();
  root.addComponent(BlockInputEvents);   // 转场期吞触摸;整层随 root 销毁,不留残党
  root.setParent(parent);

  const mkBand = (name: string, th: number, hex: string, alpha: number, delay: number): Node => {
    // 带宽 2400 + 斜切 0.9 倍带宽:黑带中心过屏芯时(约 0.2s)必然盖满整屏
    const bw = 2400;
    const sk = th * 0.9;
    const n = new Node(name);
    n.layer = root.layer;
    n.addComponent(UITransform);
    const g = n.addComponent(Graphics);
    g.fillColor = ac(hex, alpha);
    slantPath(g, bw, th, sk);
    g.fill();
    n.setPosition(-1850, 0, 0);
    n.setParent(root);
    tween(n)
      .delay(delay)
      .to(0.4, { position: new Vec3(1850, 0, 0) }, { easing: "quadIn" })
      .start();
    return n;
  };
  const black = mkBand("wipe-black", 900, ARCADE.ink, 0.98, 0);
  mkBand("wipe-red", 420, ARCADE.slash, 0.92, 0.09);

  tween(black)
    .delay(0.2)
    .call(() => onMid?.())
    .start();
  tween(root)
    .delay(0.62)
    .call(() => {
      onDone?.();
      wipeBusy = false;
      if (root.isValid) root.destroy();
    })
    .start();
}

// ---------- 模式屏斩劈换屏(菜单层之间的「轻」转场) ----------

let swapBusy = false;

/**
 * 模式屏之间的转场:旧屏淡出收触摸 + 红黑斜带扫屏 + 新屏就位。
 * 与 slashWipe(进对局:黑带盖满、状态在中点切换)的分工 —— 这里状态不动,
 * 只是 UI 层换页:斜带压过时新屏已经在 show() 里逐级入场,交接过程看得见。
 * showIn() 立即调用(新屏自己的 stagger 动画自带节奏);转场层挂 BlockInputEvents
 * 防连点,扫完自毁。进行中重复调用:直接执行 showIn 并跳过(与 slashWipe 同语义)。
 */
export function screenSwap(parent: Node, out: Node | null, showIn?: () => void): void {
  if (swapBusy) { showIn?.(); return; }
  swapBusy = true;
  if (out) fadeOutHide(out);             // 旧屏退场:沿用 fadeOutHide 语义(禁交互件、不 deactivate)
  const root = new Node("swap-bands");
  root.layer = parent.layer;
  root.addComponent(UITransform);
  const wg = root.addComponent(Widget);
  wg.isAlignTop = true; wg.top = 0;
  wg.isAlignBottom = true; wg.bottom = 0;
  wg.isAlignLeft = true; wg.left = 0;
  wg.isAlignRight = true; wg.right = 0;
  wg.updateAlignment();
  root.addComponent(BlockInputEvents);   // 转场期吞触摸;整层随 root 销毁,不留残党
  root.setParent(parent);
  const mkBand = (name: string, th: number, hex: string, alpha: number, delay: number): void => {
    const bw = 2400;
    const n = new Node(name);
    n.layer = root.layer;
    n.addComponent(UITransform);
    const g = n.addComponent(Graphics);
    g.fillColor = ac(hex, alpha);
    slantPath(g, bw, th, th * 0.9);
    g.fill();
    n.setPosition(-1900, 0, 0);
    n.setParent(root);
    tween(n).delay(delay).to(0.38, { position: new Vec3(1900, 0, 0) }, { easing: "quadIn" }).start();
  };
  mkBand("swap-band-ink", 780, ARCADE.ink, 0.97, 0.02);
  mkBand("swap-band-red", 270, ARCADE.slash, 0.9, 0.13);
  showIn?.();
  tween(root)
    .delay(0.64)
    .call(() => {
      swapBusy = false;
      if (root.isValid) root.destroy();
    })
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
