// ============================================================
// 通用交互构件:滑杆 + 开关。
//
// 为什么单独成文件:设置页要 2 根音量滑杆 + 1 根按键大小滑杆 + 5 个开关,
// 各处手搓 Graphics 会漂成五种长相。这里一次做对,面板只给「读哪个值、写哪个值」。
//
// 依赖纪律:本文件只 import `cc` 与 `./ui-arcade`,**绝不 import ui-manager** ——
// ui-manager 会把这两个构件挂进 UiKit 发给面板,反手 import 就成环。
// (ui-arcade 自己只 import cc,同理。)
//
// P5 化(本轮):这两个构件原来全是「玻璃胶囊 + 光滑圆」—— 圆角轨道、白实心圆旋钮、
// 胶囊开关带圆钮,三件光滑物叠在一行里,与全站的大色块语言毫无关系。现在:
//   轨道 = 凹陷槽(上缘压暗、下缘接光,读作「挖进去」,不描边);
//   填充 = 同斜率的实底斜切块(凸出来的那截);
//   旋钮 = 斜切方块(墨底垫层 + 同色压暗 + 面 + 顶缘高光);
//   开关 = 整行按 on/off 走实底色块 / 凹陷槽,状态另有「开 / 关」文字读数。
// 读数这条不许省:外观淡出不等于把读数一起抹掉(设置页音量此前只有滑杆没有数字,
// 用户报过一次「看不见透明度滑杆」就是同一类病)。触摸区一律抬到 TOUCH_MIN=44。
// ============================================================
import { Button, Color, EventTouch, Graphics, Label, Layers, Node, UITransform, Vec3, v3 } from "cc";
import { ARCADE, ac, applyFont, mkLabel as uiMkLabel, retainedDraw, TOUCH_MIN } from "./ui-arcade";
import { C, inkFor, type Role } from "./p5-tokens";
import { styleOf, TOGGLE_READOUT_W } from "./p5-shapes";
import { drawSliderFace, drawToggleFace, sliderDL } from "./p5-paint";

const tmpV = new Vec3();

/**
 * 本地小 Label。
 * ⚠ 必须给节点设 contentSize:Cocos 的 Label 是按节点 contentSize 排字的,
 * 留着默认 100×100 再摆节点中心,长文案会整段推出卡片(同 main-menu.txt 的坑)。
 */
function mkLabel(parent: Node, text: string, size: number, colorHex: string,
  leftEdge: number, w: number): Label {
  // 委托权威 mkLabel。锚点保持 center + 节点摆 leftEdge + w/2:滑杆/开关行的
  // x 坐标都是按这个语义调的,与 campaign 的左锚语义不同源,别顺手"统一"。
  return uiMkLabel(parent, "label", text, size, ac(colorHex), {
    x: leftEdge + w / 2, w,
    lineH: Math.round(size * 1.22),
    contentH: Math.round(size * 1.35),
    align: 0,                        // 左对齐(0 左 / 1 中 / 2 右)
    anchor: "center",
    overflow: Label.Overflow.CLAMP,
  });
}

/** 右对齐读数:x 传「文字右缘」,给开关行末与滑杆尾部的读数用 */
function mkRight(parent: Node, text: string, size: number, colorHex: string,
  rightEdge: number, w: number): Label {
  return uiMkLabel(parent, "readout", text, size, ac(colorHex), {
    x: rightEdge, w,
    lineH: Math.round(size * 1.22),
    contentH: Math.round(size * 1.35),
    align: 2,
    anchor: "align",
    overflow: Label.Overflow.CLAMP,
  });
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

// ============================================================
// 滑杆
// ============================================================

export interface SliderOpts {
  min?: number;
  max?: number;
  /** >0 时吸附到该刻度(按键半径按 1px 吸) */
  step?: number;
  /** 初始值;不传取 min..max 的中值 */
  value?: number;
  /** 强调色(默认荧光黄);给了 role 则按「色即功能」取面色 */
  accent?: string;
  role?: Role;
  /** 轨道高度,默认 14;整条触摸区固定 TOUCH_MIN(44) 高,手指点得着 */
  trackH?: number;
  /**
   * 轨道右缘的读数(音量百分比、档位名)。传函数则每次 paint 重取 ——
   * 「只有滑杆没有数」是用户报过的老病:滑杆能看个大概,但 0.8 和 0.85 分不出来。
   */
  readout?: string | (() => string);
  /** 读数框宽,默认 96 */
  readoutW?: number;
  /** 离散档位数:>1 时在轨道下缘画刻度,让「能停在哪儿」看得见 */
  ticks?: number;
}

export interface Slider {
  node: Node;
  get(): number;
  /** 外部同步(不触发 onChange,避免「写 → 通知 → 又写」的回环) */
  set(v: number): void;
  onChange(cb: (v: number) => void): void;
  /** 松手:落盘/提交只在这里做一次 */
  onCommit(cb: () => void): void;
  destroy(): void;
}

/**
 * 水平滑杆:凹陷槽轨道 + 实底斜切填充 + 斜切旋钮。
 * 取值走引擎 Slider 的同一条数学 —— UI 单位即世界单位,不需要任何缩放系数。
 */
export function uiSlider(parent: Node, w: number, opts: SliderOpts = {}): Slider {
  const min = opts.min ?? 0;
  const max = opts.max ?? 1;
  const step = opts.step ?? 0;
  const accent = opts.role ? styleOf(opts.role).face : (opts.accent ?? ARCADE.acid);
  const trackH = opts.trackH ?? 14;
  let val = opts.value ?? (min + max) / 2;

  const node = new Node("slider");
  node.layer = Layers.Enum.UI_2D;
  const ut = node.addComponent(UITransform);
  ut.setContentSize(w, TOUCH_MIN);    // 触摸区比轨道高,手指点得着
  node.setParent(parent);

  const g = node.addComponent(Graphics);
  const readout = opts.readout === undefined ? null
    : mkRight(node, "", 13, C.dim, w / 2 + 8 + (opts.readoutW ?? 96), opts.readoutW ?? 96);

  const snap = (v: number): number => {
    const c = v < min ? min : v > max ? max : v;
    const s = step > 0 ? Math.round(c / step) * step : c;
    return Math.round((s < min ? min : s > max ? max : s) * 1000) / 1000;   // 抹掉浮点尾巴
  };

  let changeCb: ((v: number) => void) | null = null;
  let commitCb: (() => void) | null = null;

  const paint = (): void => {
    const t = max > min ? clamp01((val - min) / (max - min)) : 0;
    g.clear();
    drawSliderFace(g, sliderDL(w, trackH, t, accent, opts.ticks ?? 0));
    if (readout && opts.readout) {
      readout.string = typeof opts.readout === "function" ? opts.readout() : opts.readout;
    }
  };

  const valueAt = (e: EventTouch): number => {
    const u = e.getUILocation();
    const local = ut.convertToNodeSpaceAR(v3(u.x, u.y, 0), tmpV);
    return snap(min + clamp01((local.x + w / 2) / w) * (max - min));
  };

  let touching = false;
  node.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
    touching = true;
    const v = valueAt(e);
    if (v !== val) { val = v; paint(); changeCb?.(val); }
    else paint();
  });
  node.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
    if (!touching) return;
    const v = valueAt(e);
    if (v === val) return;
    val = v;
    paint();
    changeCb?.(val);
  });
  const end = () => {
    if (!touching) return;
    touching = false;
    commitCb?.();
  };
  node.on(Node.EventType.TOUCH_END, end);
  node.on(Node.EventType.TOUCH_CANCEL, end);      // 拖出轨道外松手走 CANCEL

  // 登记成可重放:本构件用裸 TOUCH 监听、切页时整树 destroy(见 settings-panel 文件头),
  // 但一旦被祖先连带 deactivate,原生侧会掉渲染数据 —— 而 paint 本来就是 clear + 重画。
  retainedDraw(g, paint);

  return {
    node,
    get: () => val,
    set(v: number): void { val = snap(v); paint(); },
    onChange(cb) { changeCb = cb; },
    onCommit(cb) { commitCb = cb; },
    destroy() { node.destroy(); },
  };
}

// ============================================================
// 开关
// ============================================================

export interface ToggleOpts {
  get(): boolean;
  set(v: boolean): void;
  /** 关的时候是否也留着标签文字(默认留,只压暗) —— 全灰会让人以为是禁用了 */
  dimWhenOff?: boolean;
  /** 开时的角色色,默认 star(荧光黄);亮面自动配墨黑字 */
  role?: Role;
  /** 右缘读数文案,默认「开 / 关」;传 "" 关掉读数(不推荐:状态得看得见) */
  onText?: string;
  offText?: string;
}

export interface Toggle {
  node: Node;
  paint(): void;
  destroy(): void;
}

/**
 * 一行开关:整行即按钮(点哪儿都算),开 = 实底大色块、关 = 凹陷槽。
 * 声音反馈交给调用方(kit.sfx.play("ui")),原始构件不耦合 Sfx。
 * 行高取 TOUCH_MIN:旧值 40 低于拇指点准下限,而且和滑杆排在一列时对不齐。
 */
export function uiToggle(parent: Node, text: string, w: number, opts: ToggleOpts): Toggle {
  const h = TOUCH_MIN;
  const face = styleOf(opts.role ?? "star").face;
  const node = new Node(`toggle:${text}`);
  node.layer = Layers.Enum.UI_2D;
  const ut = node.addComponent(UITransform);
  ut.setContentSize(w, h);
  node.setParent(parent);

  const g = node.addComponent(Graphics);
  // 右端布局:读数占最后 TOGGLE_READOUT_W,斜纹记号再往左 44 —— 两个数都跟 toggleDL 同源,
  // 上一版在这里手拍 20/12,记号画到了读数位上,「开」字被斜纹压住(出图抓到的)。
  const readoutRight = w / 2 - 8;
  const labelRight = w / 2 - TOGGLE_READOUT_W - 30;   // 记号起点再留 4

  // 左标签:左缘贴行边留 14,宽度让开右端的记号与读数
  const label = mkLabel(node, text, 15, ARCADE.paper, -w / 2 + 14, labelRight - (-w / 2 + 14));
  const state = mkRight(node, "", 13, C.dim, readoutRight, TOGGLE_READOUT_W - 8);

  const paint = (): void => {
    const on = !!opts.get();
    g.clear();
    drawToggleFace(g, w, h, on, face);
    label.color = ac(on ? inkFor(face) : (opts.dimWhenOff === false ? ARCADE.paper : ARCADE.dim));
    const txt = on ? (opts.onText ?? "开") : (opts.offText ?? "关");
    state.string = txt;
    state.color = ac(on ? inkFor(face) : ARCADE.dim);
  };

  // 用 Button 而不是裸 TOUCH_END:本仓库每个可点行都是 Button(SCALE),
  // 按压反馈和「按下又抬起才算一次」的语义都跟着现成的走,不赌触摸事件细节。
  const b = node.addComponent(Button);
  b.transition = Button.Transition.SCALE;
  b.zoomScale = 0.96;
  b.target = node;
  node.on(Button.EventType.CLICK, () => opts.set(!opts.get()));

  retainedDraw(g, paint);
  return { node, paint, destroy() { node.destroy(); } };
}
