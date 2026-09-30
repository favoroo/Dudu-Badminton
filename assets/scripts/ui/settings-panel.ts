// ============================================================
// 设置页:按键布局 / 声音两条总线 / 画面提示。
//
// 装配方式跟 career-panel / drill-panel 一致:懒 addComponent + show()/hide()
// 里整树销毁。老的面具类(主菜单/暂停/结算)是常驻一份,面板类是按需建 ——
// 设置页一年也开不了几次,没必要全程占着一屏节点。
//
// 两个视图:
//   LIST  —— 卡片式开关与滑杆;
//   EDIT  —— 「调整位置」的所见即所得层:自己的一份 dim(带 BlockInputEvents)
//            + 第二个虚拟按键实例(edit 模式,挂在临时 Pad 上,绝不写玩家的 pad)。
// 面板根挂在 Canvas 上、晚于 ui-root,所以整块天然压在真按键之上:
// 不需要把真按键 re-parent 上来,也不存在两份按键同屏。
//
// EDIT 的背景必须是**真实球场**:进编辑器时把 LIST 整块(暗底 + 卡片)收掉,
// 只留编辑器自己那层很淡的 dim。曾经踩过的坑是 LIST 的内容直接挂在面板根上,
// 收起用的空容器里其实什么都没有 → 调位置时满屏还是设置页,按钮压根看不出落在场上
// 是什么位子。所以「暗底 + 卡片」从建的时候就得挂进 listView 这个容器里。
//
// 但「收掉」这一步**不能用 active=false**(真机踩过,见 CHANGELOG 2026-09-29 那条):
// 引擎在 UIRenderer.onDisable 里 destroyRenderData(),原生(JSB)侧 Graphics 的渲染数据
// 一旦被清,重新 activate 不会自动重传 —— 返回 LIST 后暗底、卡片、按钮底全透明,
// 只剩 Label 和每帧 clear()+重画的开关/滑杆活着,而且那屏的按钮也点不动。
// 所以这里两条路都不给引擎清数据的机会:
//   LIST  —— 用 fadeOutHide/cancelFade 显隐(保持 active,靠 UIOpacity 0 + 禁交互件藏起来);
//   EDIT  —— 每次开都新建、关了就整块 destroy,复用的从来不是一个画过的子树。
// listView 也因此必须是 kit.root 那种带全屏 UITransform 的容器:裸 Node 没有 UITransform,
// dim 的 Widget 找不到对齐目标,暗底会停在 960×540 —— 20:9 屏两侧那一条触摸就漏到世界里了。
//
// 版面按设计分辨率 960×540 排;内容收在 ±380 内(可见宽最窄就是 16:9 的 960),
// 卡片顶边 201 低于 HUD 记分牌底边 203,从暂停页打开时不会挡住身后的比分。
// ============================================================
import { _decorator, Button, Color, Component, Graphics, Label, Layers, Node, UITransform, Vec2 } from "cc";
import { Settings, PAD_LIMIT, JOYSTICK_LIMIT, SLIDER_LIMIT, type MoveMode } from "../core/settings";
import { CFG } from "../core/config";
import { Pace, paceIndexOf, paceTierById } from "../core/pace";
import { Gait, gaitIndexOf, gaitTierById } from "../core/gait";
import type { UiKit } from "./ui-manager";
import { ac, cancelFade, drawArcadeButton, drawHardShadow, fadeOutHide, riseIn, safePad, slamIn } from "./ui-arcade";
import type { Slider, Toggle } from "./widgets";
import { stripAt, stripLayout } from "./editor-strip";
import { newPad } from "../input/pad";
import { buildTouchPad, type PadSlot, type TouchPadHandle } from "../input/touchpad";

const { ccclass } = _decorator;

const PW = 760, PH = 424;      // 卡片尺寸(比旧版高 28:开关行距放宽到 46+,加一行震动开关)
const CARD_Y = -11;            // 卡片中心下移:顶边 201 仍低于 HUD 记分牌底边 203

const MODES: Array<{ mode: MoveMode; label: string; tip: string }> = [
  { mode: "joystick", label: "摇杆", tip: "虚拟摇杆模拟走位 · 向上推摇杆即起跳" },
  { mode: "slider", label: "滑轨", tip: "手指在哪人就在哪 · 上滑或双击起跳" },
  { mode: "buttons", label: "按键", tip: "经典左右两键全速 · 左手独立按键跳跃" },
];

@ccclass("SettingsPanel")
export class SettingsPanel extends Component {
  private kit!: UiKit;
  private root: Node | null = null;
  private card: Node | null = null;
  private listView: Node | null = null;
  private editView: Node | null = null;
  private padHandle: TouchPadHandle | null = null;
  private sizeSlider: Slider | null = null;
  private alphaSlider: Slider | null = null;
  /** 球速档位滑杆:与 sizeSlider/alphaSlider 一样存独立字段,**绝不 push 进 this.sliders**
   *  —— repaint() 按下标 0/1 同步音效/音乐音量,混进去会把音量滑杆指错。 */
  private paceSlider: Slider | null = null;
  private paceValueLabel: Label | null = null;
  private gaitSlider: Slider | null = null;
  private gaitValueLabel: Label | null = null;
  private selected: PadSlot | null = "left";
  private sizeLabel: Label | null = null;
  private modeTipLabel: Label | null = null;
  private modeBtns: Array<{ mode: MoveMode; node: Node; g: Graphics; label: Label }> = [];
  private toggles: Toggle[] = [];
  private sliders: Slider[] = [];
  private offChange: (() => void) | null = null;
  private onCloseCb: (() => void) | null = null;

  // ---------- 公开接口 ----------

  /** 构建并显示;UiKit 由 UIManager 传进来(面板不 import ui-manager 的实例,避免成环) */
  show(parent: Node, kit: UiKit, onClose: () => void): void {
    this.kit = kit;
    this.onCloseCb = onClose;
    const m = Settings.moveMode;
    this.selected = m === "joystick" ? "joystick" : m === "slider" ? "slider" : "left";
    this.buildList(parent);
    if (this.card) slamIn(this.card);
    // 任何地方改了设置(菜单徽章 / KeyM / 编辑器拖动)都回到这里重画一遍
    this.offChange = Settings.onChange(() => this.repaint());
  }

  /** 销毁整树;编辑器实例一并清掉,不留悬空节点 */
  hide(): void {
    this.offChange?.();
    this.offChange = null;
    this.padHandle?.destroy();
    this.padHandle = null;
    this.toggles.length = 0;
    this.sliders.length = 0;
    this.modeBtns.length = 0;
    this.modeTipLabel = null;
    this.sizeSlider = null;
    this.alphaSlider = null;
    this.paceSlider = null;
    this.paceValueLabel = null;
    this.gaitSlider = null;
    this.gaitValueLabel = null;
    this.onCloseCb = null;
    this.listView = null;
    this.editView = null;
    this.card = null;
    // 退场淡出后再销毁整树;引用立刻置空,避免 update/回调摸到已收走的节点
    const r = this.root;
    if (r && r.isValid) fadeOutHide(r, () => { if (r.isValid) r.destroy(); });
    this.root = null;
  }

  // ---------- LIST 视图 ----------

  private buildList(parent: Node): void {
    const P = this.kit.pal;
    this.root = this.kit.root(parent, "settings-panel");

    // LIST 的一切内容都挂在这个容器下 —— openEditor 靠它一整块收起,背景才露出球场。
    // 用 kit.root 而不是裸 Node:dim 的 Widget 要往父级的 UITransform 上对齐,
    // 裸 Node 没有它 → 暗底停在 960×540,宽屏两侧那一条触摸会漏到世界里(见文件头)。
    this.listView = this.kit.root(this.root, "list-view");

    // 中心压得比主菜单暗:这一屏是读字调参数的,不是看球场的
    this.kit.dim(this.listView, 0.5, 0.78);

    const card = this.kit.panel(this.listView, PW, PH, { r: 16, alpha: 0.94 });
    this.card = card.node;
    this.card.setPosition(0, CARD_Y, 0);

    const title = this.kit.label(this.card, "设置", 26, P.accent);
    title.node.setPosition(0, 186, 0);
    title.enableShadow = true;
    title.shadowColor = new Color(0, 0, 0, 130);
    title.shadowOffset = new Vec2(0, -4);
    this.kit.label(this.card, "SETTINGS", 11, P.dim).node.setPosition(0, 160, 0);

    const done = this.kit.button(this.card, "完成", 150, 48, { style: "primary", size: 17 });
    done.setPosition(PW / 2 - 98, 176, 0);
    done.on(Button.EventType.CLICK, () => { this.kit.sfx.play("ui"); this.close(); });

    // ---------- 左列:按键布局 ----------
    this.txt(this.card, "按键布局", 15, P.accent, -PW / 2 + 20, 130, 200);
    this.txt(this.card, "选择移动控制方式与手势",
      12, P.dim, -PW / 2 + 20, 104, 340);

    // 三档分段选择器: [ 摇杆 ] [ 滑轨 ] [ 按键 ]
    this.modeBtns = [];
    const btnW = 94, btnH = 40;
    const xs = [-300, -200, -100];
    MODES.forEach((mItem, idx) => {
      const n = new Node(`mode-btn-${mItem.mode}`);
      n.layer = Layers.Enum.UI_2D;
      n.addComponent(UITransform).setContentSize(btnW, btnH);
      n.setPosition(xs[idx], 66, 0);
      n.setParent(this.card!);
      const g = n.addComponent(Graphics);

      const lNode = new Node("text");
      lNode.layer = Layers.Enum.UI_2D;
      lNode.addComponent(UITransform).setContentSize(btnW, btnH);
      lNode.setParent(n);
      const l = lNode.addComponent(Label);
      l.string = mItem.label;
      l.fontSize = 15;
      l.lineHeight = btnH;
      l.horizontalAlign = Label.HorizontalAlign.CENTER;
      l.verticalAlign = Label.VerticalAlign.CENTER;

      const btn = n.addComponent(Button);
      btn.transition = Button.Transition.SCALE;
      btn.zoomScale = 0.94;
      btn.target = n;
      n.on(Button.EventType.CLICK, () => {
        if (Settings.moveMode === mItem.mode) return;
        this.kit.sfx.play("ui");
        Settings.setPart({ moveMode: mItem.mode });
        this.padHandle?.apply();
        this.pick(mItem.mode === "joystick" ? "joystick" : mItem.mode === "slider" ? "slider" : "left");
        this.updateModeSelector();
      });

      this.modeBtns.push({ mode: mItem.mode, node: n, g, label: l });
    });

    this.modeTipLabel = this.txt(this.card, "", 12, P.dim, -PW / 2 + 20, 28, 350);
    this.updateModeSelector();

    const adjust = this.kit.button(this.card, "调整位置", 240, 46, { style: "primary", size: 17 });
    adjust.setPosition(-200, -16, 0);
    adjust.on(Button.EventType.CLICK, () => { this.kit.sfx.play("ui"); this.openEditor(); });

    const reset = this.kit.button(this.card, "重置默认", 240, 42, { size: 15 });
    reset.setPosition(-200, -66, 0);
    reset.on(Button.EventType.CLICK, () => {
      this.kit.sfx.play("ui");
      Settings.resetPad();
      Settings.flush();
      this.kit.toast("操作按钮已回到默认位子");
    });

    this.txt(this.card, "拖动控件 = 调整位置 · 选中后用滑杆 = 改大小透明度",
      12, "#6f7ca6", -PW / 2 + 20, -114, 350);
    this.txt(this.card, "存的是相对屏幕角落的位子,换手机不会被刘海挤歪",
      12, "#6f7ca6", -PW / 2 + 20, -138, 350);

    // ---------- 左列下块:手感两档(球速 / 移速)----------
    // 每行「标签 + 定位滑杆 + 档名」,没有小节标题:卡片下沿在局部坐标 -212,两条灰提示以下
    // 只剩 74px,塞不下「标题 + 两行(每行 36)」,所以沿用同类设置行的写法把标签内联。
    // 行距 36 = uiSlider 触摸区高度 34 + 2,两根滑杆不会互相压。
    // 用滑杆而不是分段按钮:八档 / 六档 ×62px 在左列这 340 宽里放不下;而 uiSlider 同页已用四根,
    // 原生侧安全(Graphics 每次 paint 都 clear() 重放,不碰 active=false 那个坑 —— 见文件头)。
    const tierX = -PW / 2 + 20;            // 行标签左缘(-360)
    const tSlX = tierX + 52 + 4 + 80;      // 滑杆中心(-224):滑杆宽 160 → 占 -304..-144
    const capX = tSlX + 82;                // 档名左缘(-142),122 宽到 -20 收尾,不越列界
    const mkTierRow = (label: string, y: number, n: number, idx: number,
      apply: (i: number) => void, commit: () => void): Slider => {
      this.txt(this.card!, label, 14, P.text, tierX, y, 46);
      const sl = this.kit.slider(this.card!, 160, { min: 0, max: n - 1, step: 1, value: idx });
      sl.node.setPosition(tSlX, y, 0);
      // 拖动 60Hz:只改内存(原生 setItem 是同步文件 IO),档名跟着 repaint 的订阅刷新
      sl.onChange((v) => apply(Math.round(v)));
      sl.onCommit(() => { Settings.flush(); commit(); });
      return sl;
    };

    this.paceSlider = mkTierRow("球速", -160, CFG.pace.tiers.length, paceIndexOf(Settings.paceTier),
      (i) => Settings.setPart({ paceTier: CFG.pace.tiers[i].id }, false),
      () => this.kit.toast(`球速「${this.paceCaption()}」· 下一球起生效`));
    this.paceValueLabel = this.txt(this.card, this.paceCaption(), 13, P.text, capX, -160, 122);

    this.gaitSlider = mkTierRow("移速", -196, CFG.gait.tiers.length, gaitIndexOf(Settings.gaitTier),
      (i) => Settings.setPart({ gaitTier: CFG.gait.tiers[i].id }, false),
      () => this.kit.toast(`移速「${this.gaitCaption()}」· 已生效`));
    this.gaitValueLabel = this.txt(this.card, this.gaitCaption(), 13, P.text, capX, -196, 122);

    // ---------- 右列:声音 + 震动 ----------
    // 列内几何都按「不越过卡片右缘 ±380」排:开关 150 + 滑杆 140 + 中间留 5
    const rx = 78;                       // 右列内容左缘
    const rw = PW / 2 - 20 - rx;         // 右列可用宽
    this.txt(this.card, "声音", 15, P.accent, rx, 130, rw);

    const sfxTog = this.kit.toggle(this.card, "音效", 150, {
      get: () => Settings.v.sfxOn,
      set: (v) => { this.kit.sfx.play("ui"); Settings.setPart({ sfxOn: v }); },
    });
    sfxTog.node.setPosition(rx + 75, 82, 0);
    this.toggles.push(sfxTog);

    const sfxSl = this.kit.slider(this.card, 140, { min: 0, max: 1, step: 0.05, value: Settings.v.sfxVol });
    sfxSl.node.setPosition(rx + 225, 82, 0);
    this.wireVolume(sfxSl, "sfxVol", "sfxOn");

    const bgmTog = this.kit.toggle(this.card, "音乐", 150, {
      get: () => Settings.v.bgmOn,
      set: (v) => { this.kit.sfx.play("ui"); Settings.setPart({ bgmOn: v }); },
    });
    bgmTog.node.setPosition(rx + 75, 36, 0);
    this.toggles.push(bgmTog);

    const bgmSl = this.kit.slider(this.card, 140, { min: 0, max: 1, step: 0.05, value: Settings.v.bgmVol });
    bgmSl.node.setPosition(rx + 225, 36, 0);
    this.wireVolume(bgmSl, "bgmVol", "bgmOn");

    // 震动反馈:按键/击球/得分的触觉短震(移动端才有体感,Web 是空操作)
    const hapticTog = this.kit.toggle(this.card, "震动反馈", 150, {
      get: () => Settings.v.hapticOn,
      set: (v) => { this.kit.sfx.play("ui"); Settings.setPart({ hapticOn: v }); },
    });
    hapticTog.node.setPosition(rx + 75, -10, 0);
    this.toggles.push(hapticTog);

    // ---------- 右列:画面 ----------
    this.txt(this.card, "画面", 15, P.accent, rx, -52, rw);

    const mkHint = (text: string, key: "hintLanding" | "hintShake" | "hintFloat", y: number): void => {
      const cardNode = this.card!;      // 闭包里 this.card 的窄化会丢,捕获一次
      const t = this.kit.toggle(cardNode, text, 280, {
        get: () => (Settings.v as unknown as Record<string, boolean>)[key],
        set: (v) => { this.kit.sfx.play("ui"); Settings.setPart({ [key]: v } as never); },
      });
      t.node.setPosition(rx + 140, y, 0);
      this.toggles.push(t);
    };
    mkHint("落点预测圈", "hintLanding", -86);
    mkHint("屏幕震动", "hintShake", -124);
    mkHint("飘字提示", "hintFloat", -162);

    this.repaint();
  }

  /**
   * 当前档的人话标签:「标准 · 慢 8%」。
   * 绝不给玩家看 s=0.92 这种系数 —— 那是实现细节;「慢百分之几、原速是哪一档」才是他能用的信息。
   */
  private paceCaption(): string {
    return Pace.labelOf(paceTierById(Settings.paceTier));
  }

  /** 移速档的人话标签:「偏快 · 快 15%」(相对默认档,不是相对系数 1.0) */
  private gaitCaption(): string {
    return Gait.labelOf(gaitTierById(Settings.gaitTier));
  }

  /**
   * 音量滑杆:拖动只改内存(persist=false),松手才落盘;
   * 顺手把这条总线打开 —— 关着拖音量结果没声音,是最容易被当成 bug 的一处。
   */
  private wireVolume(sl: Slider, volKey: "sfxVol" | "bgmVol", onKey: "sfxOn" | "bgmOn"): void {
    this.sliders.push(sl);
    sl.onChange((v) => Settings.setPart({ [volKey]: v, [onKey]: true } as never, false));
    sl.onCommit(() => { Settings.flush(); this.repaint(); });
  }

  private updateModeSelector(): void {
    const cur = Settings.moveMode;
    const P = this.kit.pal;
    const btnW = 94, btnH = 40;
    for (const b of this.modeBtns) {
      const active = b.mode === cur;
      drawHardShadow(b.g, btnW, btnH, 8, 3, 3, 0.4);
      drawArcadeButton(b.g, btnW, btnH, active ? "primary" : "ghost", 8);
      b.label.color = ac(active ? "#14100a" : P.text);
    }
    const item = MODES.find((m) => m.mode === cur);
    if (this.modeTipLabel && item) {
      this.modeTipLabel.string = item.tip;
    }
  }

  private repaint(): void {
    this.updateModeSelector();
    for (const t of this.toggles) if (t.node && t.node.isValid) t.paint();
    // 滑杆的值可能被别处(键盘/其它面板)改动,单向同步;不触发它们的 onChange
    const s = Settings.v;
    if (this.sliders[0] && this.sliders[0].get() !== s.sfxVol) this.sliders[0].set(s.sfxVol);
    if (this.sliders[1] && this.sliders[1].get() !== s.bgmVol) this.sliders[1].set(s.bgmVol);
    if (this.sizeSlider) {
      const a = this.selected;
      if (a === "joystick") this.sizeSlider.set(s.joystick.r);
      else if (a === "slider") this.sizeSlider.set(s.slider.r);
      else if (a) this.sizeSlider.set(s.pad[a].r);
    }
    if (this.alphaSlider && this.alphaSlider.get() !== Settings.padAlpha) {
      this.alphaSlider.set(Settings.padAlpha);
    }
    // 球速档:带「值不同才 set」的守卫 —— 这里被 onChange 回调触发,再写回 Settings
    // 就会自己转圈(setPart → 通知 → repaint → set → onChange)
    if (this.paceSlider) {
      const idx = paceIndexOf(Settings.paceTier);
      if (this.paceSlider.get() !== idx) this.paceSlider.set(idx);
    }
    if (this.paceValueLabel) this.paceValueLabel.string = this.paceCaption();
    if (this.gaitSlider) {
      const gi = gaitIndexOf(Settings.gaitTier);
      if (this.gaitSlider.get() !== gi) this.gaitSlider.set(gi);
    }
    if (this.gaitValueLabel) this.gaitValueLabel.string = this.gaitCaption();
    if (this.sizeLabel) {
      // 「大小」标签跟着选中槽位变,提示玩家当前拖的是谁
      this.sizeLabel.string = this.selected === "joystick" ? "摇杆" : this.selected === "slider" ? "滑轨" : "大小";
    }
  }

  // ---------- EDIT 视图 ----------

  private openEditor(): void {
    // 收起 LIST 用 fadeOutHide 而不是 active=false(见文件头):保持 active、靠
    // UIOpacity 0 藏起来,顺带把子树里的 Button/BlockInputEvents 一起禁掉 ——
    // 暗底那层在编辑态不吃触摸,触摸由编辑器自己的 dim 接管。
    if (this.listView) fadeOutHide(this.listView);
    this.buildEditor();
  }

  /** 编辑器整块新建:每次进编辑都是全新节点,不给「画过一次再激活」留机会 */
  private buildEditor(): void {
    const P = this.kit.pal;
    this.editView = this.kit.root(this.root!, "pad-editor");
    // 编辑器这一层几乎不压暗:LIST 的暗底已经整块收走了,球场地面的明暗就是
    // 玩家真正手感里的明暗 —— 这一屏要判断的正是「按钮压不压到场上东西」。
    this.kit.dim(this.editView, 0.16, 0.46);

    // 顶部操作条:让开刘海/状态栏(safePad 统一换算,像素内缩 → 世界单位)
    const stripY = 270 - 34 - safePad().top;

    const strip = new Node("strip");
    strip.layer = this.root!.layer;
    strip.setParent(this.editView);
    strip.setPosition(0, stripY, 0);

    const g = this.kit.panel(strip, PW, 64, { r: 12, alpha: 0.88 });
    g.node.setPosition(0, 0, 0);

    const curM = Settings.moveMode;
    const modeName = curM === "joystick" ? "摇杆" : curM === "slider" ? "滑轨" : "大小";
    /**
     * 顶栏这一行的宽与 x 全部由 editor-strip 算(纯函数,tools/strip-check.ts 在 node 下
     * 断言不重叠、不溢出)—— 面板这边只照着结果摆,不再手调数字。原因见该文件头:
     * 上一版手调坐标把透明度滑杆整根埋在了两颗按钮底下,用户看到的是「没有透明度滑杆」。
     */
    const L = stripLayout(modeName);
    const nameIt = stripAt(L, "name");
    const sizeIt = stripAt(L, "size");
    const alphaNameIt = stripAt(L, "alphaName");
    const alphaIt = stripAt(L, "alpha");
    const resetIt = stripAt(L, "reset");
    const doneIt = stripAt(L, "done");

    this.sizeLabel = this.txt(strip, nameIt.text, nameIt.fontSize, P.text, nameIt.left, 0, nameIt.w);
    // 半径滑杆区间取按钮、摇杆与滑轨的并集。
    this.sizeSlider = this.kit.slider(strip, sizeIt.w, {
      min: Math.min(PAD_LIMIT.rMin, JOYSTICK_LIMIT.rMin, SLIDER_LIMIT.rMin),
      max: Math.max(PAD_LIMIT.rMax, JOYSTICK_LIMIT.rMax, SLIDER_LIMIT.rMax),
      step: 1,
      value: this.sizeOfSelected(),
    });
    this.sizeSlider.node.setPosition(sizeIt.center, 0, 0);
    this.sizeSlider.onChange((v) => {
      const a = this.selected;
      if (!a) return;
      // 半径变化不夹位置,内存改完 apply 自动跟上
      if (a === "joystick") Settings.setJoystick({ r: v }, false);
      else if (a === "slider") Settings.setSlider({ r: v }, false);
      else Settings.setPad(a, { r: v }, false);
    });
    this.sizeSlider.onCommit(() => Settings.flush());

    this.txt(strip, alphaNameIt.text, alphaNameIt.fontSize, P.text, alphaNameIt.left, 0, alphaNameIt.w);
    this.alphaSlider = this.kit.slider(strip, alphaIt.w, {
      min: PAD_LIMIT.alphaMin, max: PAD_LIMIT.alphaMax, step: 0.05,
      value: Settings.padAlpha,
    });
    this.alphaSlider.node.setPosition(alphaIt.center, 0, 0);
    this.alphaSlider.onChange((v) => {
      Settings.setPart({ padAlpha: v }, false);  // 拖动中不落盘
    });
    this.alphaSlider.onCommit(() => Settings.flush());

    const eReset = this.kit.button(strip, resetIt.text, resetIt.w, 44, { size: resetIt.fontSize });
    eReset.setPosition(resetIt.center, 0, 0);
    eReset.on(Button.EventType.CLICK, () => {
      this.kit.sfx.play("ui");
      Settings.resetPad();
      Settings.flush();
      this.padHandle?.apply();
      this.sizeSlider?.set(this.sizeOfSelected());
      this.alphaSlider?.set(Settings.padAlpha);
    });

    const eDone = this.kit.button(strip, doneIt.text, doneIt.w, 46, { style: "primary", size: doneIt.fontSize });
    eDone.setPosition(doneIt.center, 0, 0);
    eDone.on(Button.EventType.CLICK, () => { this.kit.sfx.play("ui"); this.closeEditor(); });

    const hintText = Settings.moveMode === "joystick"
      ? "往上推摇杆就是起跳 · 控件可拖到屏幕任意位置"
      : Settings.moveMode === "slider"
      ? "滑轨与左半场 1:1 对齐,刻度就是脚下的场地线 · 只能上下挪"
      : "拖动按钮移动 · 可拖到屏幕任意位置";
    const hint = this.kit.label(this.editView, hintText, 13, "#dfe6ff", { outline: "#05070f", outlineW: 2 });
    hint.node.setPosition(0, stripY - 58, 0);

    // 第二个按键实例:挂在一个临时 Pad 上,edit 模式又跳过 press/release
    this.padHandle = buildTouchPad(this.editView, newPad(), {
      edit: true,
      onPick: (a) => this.pick(a),
      onDrag: (slot, dx, dy) => {
        if (!this.padHandle) return;
        const clamped = this.padHandle.clampDelta(slot, dx, dy);
        // 拖动中不落盘(原生 localStorage 是同步 IO,跟手指 60Hz 写盘会卡)
        if (slot === "joystick") Settings.setJoystick(clamped, false);
        else if (slot === "slider") Settings.setSlider(clamped, false);
        else Settings.setPad(slot, clamped, false);
      },
      onDragEnd: () => Settings.flush(),
    });
    // 建层时 Widget 还没给全屏容器定尺寸,首帧的夹取用的是兜底宽度;补一次
    this.padHandle.apply();
    const defPick = Settings.moveMode === "joystick" ? "joystick" : Settings.moveMode === "slider" ? "slider" : "left";
    this.pick(this.selected ?? defPick);

    // 入场动画只动顶部操作条和说明,不动整层
    riseIn(strip, 0);
    riseIn(hint.node, 0.06);
  }

  private pick(slot: PadSlot): void {
    this.selected = slot;
    this.padHandle?.select(slot);
    this.sizeSlider?.set(this.sizeOfSelected());
    if (this.sizeLabel) this.sizeLabel.string = slot === "joystick" ? "摇杆" : slot === "slider" ? "滑轨" : "大小";
  }

  /** 当前选中槽位对应的半径(摇杆、滑轨与按钮各自一份存档) */
  private sizeOfSelected(): number {
    const s = this.selected;
    if (s === "joystick") return Settings.joystick.r;
    if (s === "slider") return Settings.slider.r;
    if (s) return Settings.padOf(s).r;
    return Settings.padOf("left").r;
  }

  private closeEditor(): void {
    Settings.flush();                      // 把最后一次拖动的内存值落盘
    // 编辑器不留着复用:下次 openEditor 建的是全新节点,一次绘制的 Graphics 才一定在
    this.destroyEditor();
    if (this.listView) cancelFade(this.listView);   // 恢复 Button / BlockInputEvents
    this.repaint();
  }

  /** 拆掉编辑器那一层(顶条、说明、第二份按键实例),LIST 不受影响 */
  private destroyEditor(): void {
    this.padHandle?.destroy();
    this.padHandle = null;
    this.sizeSlider = null;
    this.alphaSlider = null;
    this.sizeLabel = null;
    const v = this.editView;
    this.editView = null;
    if (v && v.isValid) v.destroy();
  }

  private close(): void {
    Settings.flush();
    const cb = this.onCloseCb;
    if (cb) cb();
  }

  // ---------- 建块辅助 ----------

  /** 左对齐文本:给「文字左缘」而不是节点中心(同 main-menu.txt) */
  private txt(parent: Node, text: string, size: number, colorHex: string,
    left: number, y: number, w: number): Label {
    const l = this.kit.label(parent, text, size, colorHex, { align: 0 });
    const ut = l.node.getComponent(UITransform)!;
    ut.setContentSize(w, Math.round(size * 1.35));
    l.overflow = Label.Overflow.CLAMP;
    l.node.setPosition(left + w / 2, y, 0);
    return l;
  }
}
