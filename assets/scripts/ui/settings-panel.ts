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
// EDIT 的背景必须是**真实球场**:进编辑器时把 LIST 整块(暗底 + 卡片)active=false
// 收掉,只留编辑器自己那层很淡的 dim。曾经踩过的坑是 LIST 的内容直接挂在面板根上,
// 收起用的空容器里其实什么都没有 → 调位置时满屏还是设置页,按钮压根看不出落在场上
// 是什么位子。所以「暗底 + 卡片」从建的时候就得挂进 listView 这个容器里。
//
// 版面按设计分辨率 960×540 排;内容收在 ±380 内(可见宽最窄就是 16:9 的 960),
// 卡片顶边 201 低于 HUD 记分牌底边 203,从暂停页打开时不会挡住身后的比分。
// ============================================================
import { _decorator, Button, Color, Component, Graphics, Label, Layers, Node, UITransform, Vec2 } from "cc";
import { Settings, PAD_LIMIT, JOYSTICK_LIMIT, SLIDER_LIMIT, type MoveMode, type ReplayMode } from "../core/settings";
import type { UiKit } from "./ui-manager";
import { ac, drawArcadeButton, drawHardShadow, fadeOutHide, riseIn, safePad, slamIn } from "./ui-arcade";
import type { Slider, Toggle } from "./widgets";
import { newPad } from "../input/pad";
import { buildTouchPad, type PadSlot, type TouchPadHandle } from "../input/touchpad";

const { ccclass } = _decorator;

const PW = 760, PH = 424;      // 卡片尺寸(比旧版高 28:开关行距放宽到 46+,加一行震动开关)
const CARD_Y = -11;            // 卡片中心下移:顶边 201 仍低于 HUD 记分牌底边 203

const MODES: Array<{ mode: MoveMode; label: string; tip: string }> = [
  { mode: "joystick", label: "摇杆", tip: "虚拟摇杆模拟走位 · 向上推摇杆即起跳" },
  { mode: "slider", label: "滑轨", tip: "滑动精准定点定位 · 向上滑或双击起跳" },
  { mode: "buttons", label: "按键", tip: "经典左右两键全速 · 左手独立按键跳跃" },
];

const REPLAY_MODES: Array<{ mode: ReplayMode; label: string }> = [
  { mode: "off", label: "关闭" },
  { mode: "matchpoint", label: "赛点" },
  { mode: "all", label: "全开" },
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
  private selected: PadSlot | null = "left";
  private sizeLabel: Label | null = null;
  private modeTipLabel: Label | null = null;
  private modeBtns: Array<{ mode: MoveMode; node: Node; g: Graphics; label: Label }> = [];
  private replayBtns: Array<{ mode: ReplayMode; node: Node; g: Graphics; label: Label }> = [];
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
    this.replayBtns.length = 0;
    this.modeTipLabel = null;
    this.sizeSlider = null;
    this.alphaSlider = null;
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

    // LIST 的一切内容都挂在这个容器下 —— openEditor 靠它一整块收起,背景才露出球场
    this.listView = new Node("list-view");
    this.listView.layer = this.root.layer;
    this.listView.setParent(this.root);

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

    // ---------- 右列:画面与回放 ----------
    this.txt(this.card, "画面与回放", 15, P.accent, rx, -52, rw);

    // 精彩回放:三档选择器 [关闭] [赛点] [全开]
    this.txt(this.card, "精彩回放", 14, P.text, rx + 14, -86, 70);
    this.replayBtns = [];
    const rBtnW = 62, rBtnH = 30;
    const rXs = [rx + 104, rx + 172, rx + 240];
    REPLAY_MODES.forEach((item, idx) => {
      const n = new Node(`replay-btn-${item.mode}`);
      n.layer = Layers.Enum.UI_2D;
      n.addComponent(UITransform).setContentSize(rBtnW, rBtnH);
      n.setPosition(rXs[idx], -86, 0);
      n.setParent(this.card!);
      const g = n.addComponent(Graphics);

      const lNode = new Node("text");
      lNode.layer = Layers.Enum.UI_2D;
      lNode.addComponent(UITransform).setContentSize(rBtnW, rBtnH);
      lNode.setParent(n);
      const l = lNode.addComponent(Label);
      l.string = item.label;
      l.fontSize = 13;
      l.lineHeight = rBtnH;
      l.horizontalAlign = Label.HorizontalAlign.CENTER;
      l.verticalAlign = Label.VerticalAlign.CENTER;

      const btn = n.addComponent(Button);
      btn.transition = Button.Transition.SCALE;
      btn.zoomScale = 0.94;
      btn.target = n;
      n.on(Button.EventType.CLICK, () => {
        if (Settings.replayMode === item.mode) return;
        this.kit.sfx.play("ui");
        Settings.setPart({ replayMode: item.mode });
        this.updateReplaySelector();
      });

      this.replayBtns.push({ mode: item.mode, node: n, g, label: l });
    });
    this.updateReplaySelector();

    const mkHint = (text: string, key: "hintLanding" | "hintShake" | "hintFloat", y: number): void => {
      const cardNode = this.card!;      // 闭包里 this.card 的窄化会丢,捕获一次
      const t = this.kit.toggle(cardNode, text, 280, {
        get: () => (Settings.v as unknown as Record<string, boolean>)[key],
        set: (v) => { this.kit.sfx.play("ui"); Settings.setPart({ [key]: v } as never); },
      });
      t.node.setPosition(rx + 140, y, 0);
      this.toggles.push(t);
    };
    mkHint("落点预测圈", "hintLanding", -124);
    mkHint("屏幕震动", "hintShake", -162);
    mkHint("飘字提示", "hintFloat", -200);

    this.repaint();
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

  private updateReplaySelector(): void {
    const cur = Settings.replayMode;
    const P = this.kit.pal;
    const btnW = 62, btnH = 30;
    for (const b of this.replayBtns) {
      const active = b.mode === cur;
      drawHardShadow(b.g, btnW, btnH, 6, 2, 2, 0.35);
      drawArcadeButton(b.g, btnW, btnH, active ? "primary" : "ghost", 6);
      b.label.color = ac(active ? "#14100a" : P.text);
      b.label.isBold = active;
    }
  }

  private repaint(): void {
    this.updateModeSelector();
    this.updateReplaySelector();
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
    if (this.sizeLabel) {
      // 「大小」标签跟着选中槽位变,提示玩家当前拖的是谁
      this.sizeLabel.string = this.selected === "joystick" ? "摇杆" : this.selected === "slider" ? "滑轨" : "大小";
    }
  }

  // ---------- EDIT 视图 ----------

  private openEditor(): void {
    if (this.editView) {
      this.listView!.active = false;
      this.editView.active = true;
      this.padHandle?.apply();
      this.padHandle?.select(this.selected);
      return;
    }
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
    this.sizeLabel = this.txt(strip, modeName, 14, P.text, -PW / 2 + 26, 0, 60);
    // 半径滑杆区间取按钮、摇杆与滑轨的并集。
    this.sizeSlider = this.kit.slider(strip, 180, {
      min: Math.min(PAD_LIMIT.rMin, JOYSTICK_LIMIT.rMin, SLIDER_LIMIT.rMin),
      max: Math.max(PAD_LIMIT.rMax, JOYSTICK_LIMIT.rMax, SLIDER_LIMIT.rMax),
      step: 1,
      value: this.sizeOfSelected(),
    });
    this.sizeSlider.node.setPosition(-PW / 2 + 196, 0, 0);
    this.sizeSlider.onChange((v) => {
      const a = this.selected;
      if (!a) return;
      // 半径变化不夹位置,内存改完 apply 自动跟上
      if (a === "joystick") Settings.setJoystick({ r: v }, false);
      else if (a === "slider") Settings.setSlider({ r: v }, false);
      else Settings.setPad(a, { r: v }, false);
    });
    this.sizeSlider.onCommit(() => Settings.flush());

    this.txt(strip, "透明度", 14, P.text, 40, 0, 80);
    this.alphaSlider = this.kit.slider(strip, 180, {
      min: PAD_LIMIT.alphaMin, max: PAD_LIMIT.alphaMax, step: 0.05,
      value: Settings.padAlpha,
    });
    this.alphaSlider.node.setPosition(244, 0, 0);
    this.alphaSlider.onChange((v) => {
      Settings.setPart({ padAlpha: v }, false);  // 拖动中不落盘
    });
    this.alphaSlider.onCommit(() => Settings.flush());

    const eReset = this.kit.button(strip, "重置默认", 150, 44, { size: 15 });
    eReset.setPosition(PW / 2 - 268, 0, 0);
    eReset.on(Button.EventType.CLICK, () => {
      this.kit.sfx.play("ui");
      Settings.resetPad();
      Settings.flush();
      this.padHandle?.apply();
      this.sizeSlider?.set(this.sizeOfSelected());
      this.alphaSlider?.set(Settings.padAlpha);
    });

    const eDone = this.kit.button(strip, "完成", 150, 44, { style: "primary", size: 16 });
    eDone.setPosition(PW / 2 - 100, 0, 0);
    eDone.on(Button.EventType.CLICK, () => { this.kit.sfx.play("ui"); this.closeEditor(); });

    const hintText = Settings.moveMode === "joystick"
      ? "往上推摇杆就是起跳 · 拖底圈或右侧按键调整位子 · 上方滑杆改大小和透明度"
      : Settings.moveMode === "slider"
      ? "上滑或双击即起跳 · 拖动滑轨或按键调整位子 · 上方滑杆改大小和透明度"
      : "拖动按钮移动 · 上方滑杆改大小和透明度";
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

    this.listView!.active = false;
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
    if (this.editView) this.editView.active = false;
    if (this.listView) this.listView.active = true;
    this.repaint();
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
