// ============================================================
// 「说明井」的滚动器:可视窗(Mask 裁切)+ 被拖动的内容层 + 上下箭头提示。
//
// 为什么单独一个类:更新弹窗与「更新记录」弹窗各有一口说明井,裁切、拖动、
// 钳位、箭头显隐的规则完全同构 —— 而**触摸卫生**恰恰是这类组件最险的部分:
// fadeOutHide 收起不 deactivate,裸 TOUCH 监听不归它管,忘了在 hide 里卸掉,
// 关掉的弹窗就留一块隐形挡板偷吃全屏触摸(用户报过「点了没反应」的正是这条)。
// 挂卸收口在 setLive 一处,两个弹窗都走它,不会再有一份手抄漏掉半边。
//
// 排版(折行/行高/缩进)在 release-notes,落屏在 notes-paint —— 这里只管滚动,
// 不参与任何测量。
// ============================================================
import { EventTouch, Graphics, Mask, Node, UITransform } from "cc";
import { drawChevron } from "./ui-arcade";
import { noteScrollRange } from "./release-notes";

export class NotesScroller {
  private readonly viewport: Node;
  private readonly mask: Mask;
  private readonly content: Node;
  private readonly hintUp: Node;
  private readonly hintDown: Node;
  private scrollable = false;
  private scrollMin = 0;
  private scrollMax = 0;
  private dragFromY: number | null = null;
  private dragBaseY = 0;
  /** 拖动手势是否挂在身上(只允许在弹窗亮着时挂,理由见文件头) */
  private live = false;

  constructor(opts: {
    viewport: Node;
    mask: Mask;
    content: Node;
    /** 箭头的父节点:挂在井框上而不是可视窗里,免得跟着内容一起被裁掉 */
    hintParent: Node;
    /** 箭头颜色(一般是 pal.dim) */
    color: string;
    layer: number;
  }) {
    this.viewport = opts.viewport;
    this.mask = opts.mask;
    this.content = opts.content;
    this.hintUp = NotesScroller.makeHint(opts.hintParent, opts.color, opts.layer, 90);
    this.hintDown = NotesScroller.makeHint(opts.hintParent, opts.color, opts.layer, -90);
  }

  /** 滚动提示:一个旋转过的箭标节点(90 = 朝上,-90 = 朝下),出生隐藏 */
  private static makeHint(parent: Node, color: string, layer: number, angle: number): Node {
    const n = new Node("scroll-hint");
    n.layer = layer;
    n.addComponent(UITransform).setContentSize(20, 20);
    const g = n.addComponent(Graphics);
    drawChevron(g, 7, color, 0.85, 2);
    n.angle = angle;
    n.active = false;
    n.setParent(parent);
    return n;
  }

  get y(): number {
    return this.content.position.y;
  }

  /** 内容高 / 可视高 → 裁切开关 + 滚动区间,并滚到**顶**(打开时从第一条看起)。
   *  区间与「顶 = 负位移」的方向真话在 release-notes.noteScrollRange,这里不另推。
   *  scrollable 缺省按「内容高是否超过可视高」算;调用方已有判式(如 fitNotesBox)
   *  时显式传入,两边口径不一致时以调用方为准。 */
  setRange(contentH: number, viewH: number, scrollable?: boolean): void {
    this.scrollable = scrollable ?? contentH > viewH + 0.5;
    this.mask.enabled = this.scrollable;
    const range = noteScrollRange(contentH, viewH, this.scrollable);
    this.scrollMin = range.min;
    this.scrollMax = range.max;
    this.scrollTo(this.scrollMin);
  }

  /** 箭头位置(井框半高随弹窗而异):x 取井宽内侧,y = ±(半高 - 12) */
  placeHints(x: number, halfH: number): void {
    this.hintUp.setPosition(x, halfH - 12, 0);
    this.hintDown.setPosition(x, -halfH + 12, 0);
  }

  /** 设滚动位并刷新箭头:钳到 [min, max]。
   *  y 越负看得越靠上(顶 = scrollMin,上面再没有内容),越正看得越靠下 ——
   *  没到顶就点亮上箭头、没到底就点亮下箭头,到边即收。 */
  scrollTo(v: number): void {
    const y = Math.max(this.scrollMin, Math.min(this.scrollMax, v));
    this.content.setPosition(0, y, 0);
    this.hintUp.active = this.scrollable && y > this.scrollMin + 1;
    this.hintDown.active = this.scrollable && y < this.scrollMax - 1;
  }

  /**
   * 拖动手势随弹窗亮/关挂卸。
   *
   * 与无限练习弹窗同一件事:`fadeOutHide` 的隐藏不 deactivate,只关掉子树里的
   * Button / BlockInputEvents 组件,而裸 `Node.EventType.TOUCH_*` 监听照旧接活;
   * 引擎派发默认吞噬触摸(见 UIEvent.preventSwallow 注释),所以关掉的弹窗会在屏幕
   * 正中留一块隐形的「说明井」挡板,把落在它范围内的按键全吃掉。
   */
  setLive(on: boolean): void {
    if (this.live === on) return;
    this.live = on;
    const T = Node.EventType;
    if (on) {
      this.viewport.on(T.TOUCH_START, this.onDragStart, this);
      this.viewport.on(T.TOUCH_MOVE, this.onDragMove, this);
      this.viewport.on(T.TOUCH_END, this.onDragEnd, this);
      this.viewport.on(T.TOUCH_CANCEL, this.onDragEnd, this);
    } else {
      this.viewport.off(T.TOUCH_START, this.onDragStart, this);
      this.viewport.off(T.TOUCH_MOVE, this.onDragMove, this);
      this.viewport.off(T.TOUCH_END, this.onDragEnd, this);
      this.viewport.off(T.TOUCH_CANCEL, this.onDragEnd, this);
    }
  }

  private onDragStart(e: EventTouch): void {
    if (!this.scrollable) return;
    this.dragFromY = e.getUILocation().y;
    this.dragBaseY = this.content.position.y;
  }

  private onDragMove(e: EventTouch): void {
    if (!this.scrollable || this.dragFromY === null) return;
    this.scrollTo(this.dragBaseY + (e.getUILocation().y - this.dragFromY));
  }

  private onDragEnd(): void {
    this.dragFromY = null;
  }
}
