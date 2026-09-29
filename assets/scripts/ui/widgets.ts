// ============================================================
// 通用交互构件:滑杆 + 开关。
//
// 为什么单独成文件:设置页要 2 根音量滑杆 + 1 根按键大小滑杆 + 5 个开关,
// 各处手搓 Graphics 会漂成五种长相。这里一次做对,面板只给「读哪个值、写哪个值」。
//
// 依赖纪律:本文件只 import `cc` 与 `./ui-arcade`,**绝不 import ui-manager** ——
// ui-manager 会把这两个构件挂进 UiKit 发给面板,反手 import 就成环。
// (ui-arcade 自己只 import cc,同理。)
// ============================================================
import { Button, Color, EventTouch, Graphics, Label, Layers, Node, UITransform, Vec3, v3 } from "cc";
import { ARCADE, ac, drawGlassCard, drawHardShadow } from "./ui-arcade";

const tmpV = new Vec3();

/**
 * 本地小 Label。
 * ⚠ 必须给节点设 contentSize:Cocos 的 Label 是按节点 contentSize 排字的,
 * 留着默认 100×100 再摆节点中心,长文案会整段推出卡片(同 main-menu.txt 的坑)。
 */
function mkLabel(parent: Node, text: string, size: number, colorHex: string,
  leftEdge: number, w: number): Label {
  const n = new Node("label");
  n.layer = Layers.Enum.UI_2D;
  const ut = n.addComponent(UITransform);
  ut.setContentSize(w, Math.round(size * 1.35));
  n.setParent(parent);
  n.setPosition(leftEdge + w / 2, 0, 0);
  const l = n.addComponent(Label);
  l.string = text;
  l.fontSize = size;
  l.lineHeight = Math.round(size * 1.22);
  l.horizontalAlign = 0;             // 左对齐(0 左 / 1 中 / 2 右)
  l.verticalAlign = 1;
  l.overflow = Label.Overflow.CLAMP;
  l.color = ac(colorHex);
  return l;
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
  /** 强调色(默认荧光黄) */
  accent?: string;
  /** 轨道高度,默认 14;整条触摸区固定 34 高,手指好点 */
  trackH?: number;
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
 * 水平滑杆:玻璃轨道 + 强调色填充 + 圆旋钮。
 * 取值走引擎 Slider 的同一条数学 —— UI 单位即世界单位,不需要任何缩放系数。
 */
export function uiSlider(parent: Node, w: number, opts: SliderOpts = {}): Slider {
  const min = opts.min ?? 0;
  const max = opts.max ?? 1;
  const step = opts.step ?? 0;
  const accent = opts.accent ?? ARCADE.acid;
  const trackH = opts.trackH ?? 14;
  let val = opts.value ?? (min + max) / 2;

  const node = new Node("slider");
  node.layer = Layers.Enum.UI_2D;
  const ut = node.addComponent(UITransform);
  ut.setContentSize(w, 34);          // 触摸区比轨道高,手指点得着
  node.setParent(parent);

  const g = node.addComponent(Graphics);

  const snap = (v: number): number => {
    const c = v < min ? min : v > max ? max : v;
    const s = step > 0 ? Math.round(c / step) * step : c;
    return Math.round((s < min ? min : s > max ? max : s) * 1000) / 1000;   // 抹掉浮点尾巴
  };

  let changeCb: ((v: number) => void) | null = null;
  let commitCb: (() => void) | null = null;

  const paint = (): void => {
    const t = max > min ? clamp01((val - min) / (max - min)) : 0;
    const fillW = w * t;
    const knobX = -w / 2 + fillW;
    g.clear();
    drawGlassCard(g, w, trackH, trackH / 2, 0.5);
    if (fillW > trackH * 0.6) {
      g.fillColor = ac(accent, 0.9);
      g.roundRect(-w / 2, -trackH / 2, fillW, trackH, trackH / 2);
      g.fill();
    }
    // 旋钮:实心白点 + 强调色描边,压在最右/最左也留得出一半在外面看得见的视觉
    g.fillColor = ac("#ffffff", 0.95);
    g.circle(knobX, 0, 8);
    g.fill();
    g.strokeColor = ac(accent);
    g.lineWidth = 3;
    g.circle(knobX, 0, 8);
    g.stroke();
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

  paint();

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
}

export interface Toggle {
  node: Node;
  paint(): void;
  destroy(): void;
}

/**
 * 一行开关:玻璃底卡 + 左标签 + 右侧滑块式指示。
 * 整行即按钮(点哪儿都算),不用把手指瞄准那颗小方块。
 * 声音反馈交给调用方(kit.sfx.play("ui")),原始构件不耦合 Sfx。
 */
export function uiToggle(parent: Node, text: string, w: number, opts: ToggleOpts): Toggle {
  const h = 40;
  const node = new Node(`toggle:${text}`);
  node.layer = Layers.Enum.UI_2D;
  const ut = node.addComponent(UITransform);
  ut.setContentSize(w, h);
  node.setParent(parent);

  const g = node.addComponent(Graphics);
  const knobW = 22, knobH = 22;
  const trackW = 46;
  const trackX = w / 2 - trackW / 2 - 10;      // 轨道贴在行右侧

  // 左标签:左缘贴卡边留 14,宽度让开右侧轨道
  const label = mkLabel(node, text, 15, ARCADE.paper, -w / 2 + 14, w - trackW - 34);

  const paint = (): void => {
    const on = !!opts.get();
    g.clear();
    drawHardShadow(g, w, h, 9, 3, 3, 0.4);
    drawGlassCard(g, w, h, 9, on ? 0.5 : 0.36, on ? ARCADE.acid : undefined);
    // 轨道
    g.fillColor = ac(ARCADE.ink, on ? 0.55 : 0.7);
    g.roundRect(trackX - trackW / 2, -knobH / 2, trackW, knobH, knobH / 2);
    g.fill();
    g.strokeColor = ac(on ? ARCADE.acid : ARCADE.dim, on ? 0.9 : 0.5);
    g.lineWidth = 2;
    g.roundRect(trackX - trackW / 2, -knobH / 2, trackW, knobH, knobH / 2);
    g.stroke();
    // 旋钮:开在右、关在左
    const kx = trackX + (on ? trackW / 2 - knobH / 2 - 2 : -trackW / 2 + knobH / 2 + 2);
    g.fillColor = ac(on ? ARCADE.acid : "#5b6690");
    g.circle(kx, 0, knobH / 2 - 2);
    g.fill();
    label.color = ac(on ? ARCADE.paper : (opts.dimWhenOff === false ? ARCADE.paper : ARCADE.dim));
  };

  // 用 Button 而不是裸 TOUCH_END:本仓库每个可点行都是 Button(SCALE),
  // 按压反馈和「按下又抬起才算一次」的语义都跟着现成的走,不赌触摸事件细节。
  const b = node.addComponent(Button);
  b.transition = Button.Transition.SCALE;
  b.zoomScale = 0.96;
  b.target = node;
  node.on(Button.EventType.CLICK, () => opts.set(!opts.get()));

  paint();
  return { node, paint, destroy() { node.destroy(); } };
}
