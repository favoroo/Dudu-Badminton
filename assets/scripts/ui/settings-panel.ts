// ============================================================
// 设置页:tab 双页(操控 / 声音画面)+ 「调整位置」的所见即所得编辑器。
//
// 装配方式跟 career-panel / drill-panel 一致:懒 addComponent + show()/hide()
// 里整树销毁。老的面具类(主菜单/暂停/结算)是常驻一份,面板类是按需建 ——
// 设置页一年也开不了几次,没必要全程占着一屏节点。
//
// 三个层次:
//   外壳  —— 暗底 + 卡片 + 标题 + tab 栏 + 「完成」,进编辑器时整块收起;
//   页    —— tab 对应的内容页(操控 / 声音画面),**切页即整树销毁重建**;
//   EDIT  —— 「调整位置」的所见即所得层:自己的一份 dim(带 BlockInputEvents)
//            + 第二个虚拟按键实例(edit 模式,挂在临时 Pad 上,绝不写玩家的 pad)。
// 面板根挂在 Canvas 上、晚于 ui-root,所以整块天然压在真按键之上:
// 不需要把真按键 re-parent 上来,也不存在两份按键同屏。
//
// 切页为什么走「销毁重建」,而不是显隐/激活切换 —— 两条真机踩过的老坑都不给机会:
//   1) 不能 active=false:引擎在 UIRenderer.onDisable 里 destroyRenderData(),
//      原生(JSB)侧 Graphics 的渲染数据一旦被清,重新 activate 不会自动重传 ——
//      回来后暗底、卡片、按钮底全透明,只剩 Label 活着,且那屏的按钮也点不动;
//   2) 不能 fadeOutHide 藏页:uiSlider 用裸 TOUCH 监听,而 fadeOutHide 只禁
//      Button/BlockInputEvents —— 藏起来的滑杆会变成看不见还能摸的幽灵控件。
//   所以每次切页把旧页整树 destroy、再按 tab 重建(EDIT 同理:每次全新建,关了整块 destroy),
//   从不复活一个画过的子树。
// listView 也必须是 kit.root 那种带全屏 UITransform 的容器:裸 Node 没有 UITransform,
// dim 的 Widget 找不到对齐目标,暗底会停在 960×540 —— 20:9 屏两侧那一条触摸就漏到世界里了。
// 曾经踩过的另一个坑:LIST 的内容直接挂在面板根上,收起用的空容器里其实什么都没有 →
// 调位置时满屏还是设置页。所以「暗底 + 卡片」从建的时候就得挂进 listView 这个容器里。
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

const PW = 760, PH = 424;      // 卡片尺寸
const CARD_Y = -11;            // 卡片中心下移:顶边 201 仍低于 HUD 记分牌底边 203

const TAB_W = 176, TAB_H = 40, TAB_GAP = 12;
const TAB_Y = 144;             // tab 栏行心:上离标题留白,下离小节标题(y=104)留白

/** 控件列几何:左列标签左缘、手感行滑杆中心/档名左缘 */
const COL_X = -PW / 2 + 20;            // -340,两页小节标题与行标签的统一左缘
const TIER_SLIDER_X = -52;             // 滑杆(宽 300)中心:-202..98,两侧各留 92
const TIER_CAPTION_X = 190;            // 档名左缘:190..340,右缘与内容区对齐

type SettingsTab = "control" | "media";

const TAB_DEFS: Array<{ key: SettingsTab; label: string }> = [
  { key: "control", label: "操控" },
  { key: "media", label: "声音画面" },
];

const MODES: Array<{ mode: MoveMode; label: string; tip: string }> = [
  { mode: "joystick", label: "摇杆", tip: "虚拟摇杆模拟走位 · 向上推摇杆即起跳" },
  { mode: "slider", label: "滑轨", tip: "手指在哪人就在哪 · 上滑或双击起跳" },
  { mode: "buttons", label: "按键", tip: "经典左右两键全速 · 左手独立按键跳跃" },
];

interface TabBtn { key: SettingsTab; node: Node; g: Graphics; label: Label; }

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
  /** 当前 tab 与对应的页节点;切页 = discardPage() + buildPage(),从不复用画过的子树 */
  private tab: SettingsTab = "control";
  private page: Node | null = null;
  private tabs: TabBtn[] = [];
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
    this.tab = "control";              // 每次打开都落「操控」页
    this.buildShell(parent);
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
    this.discardPage();
    this.tabs = [];
    this.tab = "control";
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

  // ---------- 外壳:暗底 + 卡片 + 标题 + tab 栏 ----------

  private buildShell(parent: Node): void {
    const P = this.kit.pal;
    this.root = this.kit.root(parent, "settings-panel");

    // 外壳的一切内容都挂在这个容器下 —— openEditor 靠它一整块收起,背景才露出球场。
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

    const done = this.kit.button(this.card, "完成", 150, 48, { style: "primary", size: 17 });
    done.setPosition(PW / 2 - 98, 176, 0);
    done.on(Button.EventType.CLICK, () => { this.kit.sfx.play("ui"); this.close(); });

    this.buildTabBar(this.card!);
    this.buildPage();
  }

  /** tab 栏:手绘 Graphics(跟移动方式分段同一套),选中态由 paintTabs() 重画切换 */
  private buildTabBar(card: Node): void {
    const total = TAB_DEFS.length * TAB_W + (TAB_DEFS.length - 1) * TAB_GAP;
    this.tabs = TAB_DEFS.map((d, i) => {
      const n = new Node(`tab-${d.key}`);
      n.layer = Layers.Enum.UI_2D;
      n.addComponent(UITransform).setContentSize(TAB_W, TAB_H);
      n.setPosition(-total / 2 + TAB_W / 2 + i * (TAB_W + TAB_GAP), TAB_Y, 0);
      n.setParent(card);

      const g = n.addComponent(Graphics);
      const lNode = new Node("text");
      lNode.layer = Layers.Enum.UI_2D;
      lNode.addComponent(UITransform).setContentSize(TAB_W, TAB_H);
      lNode.setParent(n);
      const l = lNode.addComponent(Label);
      l.string = d.label;
      l.fontSize = 15;
      l.lineHeight = TAB_H;
      l.horizontalAlign = Label.HorizontalAlign.CENTER;
      l.verticalAlign = Label.VerticalAlign.CENTER;

      const btn = n.addComponent(Button);
      btn.transition = Button.Transition.SCALE;
      btn.zoomScale = 0.94;
      btn.target = n;
      n.on(Button.EventType.CLICK, () => {
        if (this.tab === d.key) return;
        this.kit.sfx.play("ui");
        this.switchTab(d.key);
      });
      return { key: d.key, node: n, g, label: l };
    });
    this.paintTabs();
  }

  private paintTabs(): void {
    const P = this.kit.pal;
    for (const t of this.tabs) {
      const active = t.key === this.tab;
      drawHardShadow(t.g, TAB_W, TAB_H, 8, 3, 3, 0.4);
      drawArcadeButton(t.g, TAB_W, TAB_H, active ? "primary" : "ghost", 8);
      t.label.color = ac(active ? "#fff5f2" : P.text);
    }
  }

  // ---------- 页:切页即销毁重建 ----------

  private switchTab(tab: SettingsTab): void {
    if (this.tab === tab) return;
    this.tab = tab;
    this.paintTabs();
    this.buildPage();
  }

  /** 清掉当前页:引用先置空(repaint 全带空值守卫),节点再整树销毁 */
  private discardPage(): void {
    this.modeBtns.length = 0;
    this.modeTipLabel = null;
    this.toggles.length = 0;
    this.sliders.length = 0;
    this.paceSlider = null;
    this.paceValueLabel = null;
    this.gaitSlider = null;
    this.gaitValueLabel = null;
    if (this.page && this.page.isValid) this.page.destroy();
    this.page = null;
  }

  private buildPage(): void {
    this.discardPage();
    const page = new Node(this.tab === "control" ? "page-control" : "page-media");
    page.layer = Layers.Enum.UI_2D;
    page.setParent(this.card!);
    this.page = page;
    if (this.tab === "control") this.buildControlPage(page);
    else this.buildMediaPage(page);
    this.repaint();
  }

  /** 操控页:移动方式分段 + 调整位置/重置默认 + 手感两档(球速/移速) */
  private buildControlPage(page: Node): void {
    const P = this.kit.pal;
    this.txt(page, "移动方式", 15, P.accent, COL_X, 104, 200);

    // 三档分段选择器: [ 摇杆 ] [ 滑轨 ] [ 按键 ](整组居中)
    this.modeBtns = [];
    const btnW = 120, btnH = 44, gap = 14;
    const totalW = MODES.length * btnW + (MODES.length - 1) * gap;
    MODES.forEach((mItem, idx) => {
      const n = new Node(`mode-btn-${mItem.mode}`);
      n.layer = Layers.Enum.UI_2D;
      n.addComponent(UITransform).setContentSize(btnW, btnH);
      n.setPosition(-totalW / 2 + btnW / 2 + idx * (btnW + gap), 62, 0);
      n.setParent(page);
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

    // 模式提示:居中一行,随选中档变化(updateModeSelector 刷新文案)
    const tip = this.kit.label(page, "", 12, P.dim);
    const tipUt = tip.node.getComponent(UITransform)!;
    tipUt.setContentSize(420, 16);
    tip.overflow = Label.Overflow.CLAMP;
    tip.node.setPosition(0, 28, 0);
    this.modeTipLabel = tip;
    this.updateModeSelector();

    // 「调整位置」进 EDIT;「重置默认」一行两颗,不再竖着占两条
    const adjust = this.kit.button(page, "调整位置", 190, 46, { style: "primary", size: 17 });
    adjust.setPosition(-83, -20, 0);
    adjust.on(Button.EventType.CLICK, () => { this.kit.sfx.play("ui"); this.openEditor(); });

    const reset = this.kit.button(page, "重置默认", 150, 46, { size: 15 });
    reset.setPosition(103, -20, 0);
    reset.on(Button.EventType.CLICK, () => {
      this.kit.sfx.play("ui");
      Settings.resetPad();
      Settings.flush();
      this.kit.toast("操作按钮已回到默认位子");
    });

    // ---------- 手感两档(球速 / 移速)----------
    // 行距 42 = uiSlider 触摸区 34 + 8。用滑杆而不是分段按钮:八档 / 六档分段在
    // 一行里放不下;而 uiSlider 同页已用多根,原生侧安全(Graphics 每次 paint 都
    // clear() 重放,不碰 active=false 那个坑 —— 见文件头)。
    this.txt(page, "手感", 15, P.accent, COL_X, -84, 46);
    this.txt(page, "球速下一球起效 · 移速立即生效", 12, P.dim, COL_X + 56, -84, 330);

    const mkTierRow = (label: string, y: number, n: number, idx: number,
      apply: (i: number) => void, commit: () => void): Slider => {
      this.txt(page, label, 14, P.text, COL_X, y, 46);
      const sl = this.kit.slider(page, 300, { min: 0, max: n - 1, step: 1, value: idx });
      sl.node.setPosition(TIER_SLIDER_X, y, 0);
      // 拖动 60Hz:只改内存(原生 setItem 是同步文件 IO),档名跟着 repaint 的订阅刷新
      sl.onChange((v) => apply(Math.round(v)));
      sl.onCommit(() => { Settings.flush(); commit(); });
      return sl;
    };

    this.paceSlider = mkTierRow("球速", -124, CFG.pace.tiers.length, paceIndexOf(Settings.paceTier),
      (i) => Settings.setPart({ paceTier: CFG.pace.tiers[i].id }, false),
      () => this.kit.toast(`球速「${this.paceCaption()}」· 下一球起生效`));
    this.paceValueLabel = this.txt(page, this.paceCaption(), 13, P.text, TIER_CAPTION_X, -124, 150);

    this.gaitSlider = mkTierRow("移速", -164, CFG.gait.tiers.length, gaitIndexOf(Settings.gaitTier),
      (i) => Settings.setPart({ gaitTier: CFG.gait.tiers[i].id }, false),
      () => this.kit.toast(`移速「${this.gaitCaption()}」· 已生效`));
    this.gaitValueLabel = this.txt(page, this.gaitCaption(), 13, P.text, TIER_CAPTION_X, -164, 150);
  }

  /** 声音画面页:左子列「声音与震动」,右子列「画面」,中线 x=0 分界 */
  private buildMediaPage(page: Node): void {
    const P = this.kit.pal;
    const togX = -268;                 // 左子列开关(宽 140)中心:-338..-198
    const volX = -125;                 // 左子列音量滑杆(宽 130)中心:-190..-60
    const hintX = 200;                 // 右子列开关(宽 280)中心:60..340
    const rows = [56, 0, -56];         // 行心:行距 56 = 开关高 40 + 16

    this.txt(page, "声音与震动", 15, P.accent, COL_X, 104, 200);
    this.txt(page, "画面", 15, P.accent, 60, 104, 120);

    const sfxTog = this.kit.toggle(page, "音效", 140, {
      get: () => Settings.v.sfxOn,
      set: (v) => { this.kit.sfx.play("ui"); Settings.setPart({ sfxOn: v }); },
    });
    sfxTog.node.setPosition(togX, rows[0], 0);
    this.toggles.push(sfxTog);

    const sfxSl = this.kit.slider(page, 130, { min: 0, max: 1, step: 0.05, value: Settings.v.sfxVol });
    sfxSl.node.setPosition(volX, rows[0], 0);
    this.wireVolume(sfxSl, "sfxVol", "sfxOn");

    const bgmTog = this.kit.toggle(page, "音乐", 140, {
      get: () => Settings.v.bgmOn,
      set: (v) => { this.kit.sfx.play("ui"); Settings.setPart({ bgmOn: v }); },
    });
    bgmTog.node.setPosition(togX, rows[1], 0);
    this.toggles.push(bgmTog);

    const bgmSl = this.kit.slider(page, 130, { min: 0, max: 1, step: 0.05, value: Settings.v.bgmVol });
    bgmSl.node.setPosition(volX, rows[1], 0);
    this.wireVolume(bgmSl, "bgmVol", "bgmOn");

    // 震动反馈:按键/击球/得分的触觉短震(移动端才有体感,Web 是空操作)
    const hapticTog = this.kit.toggle(page, "震动反馈", 140, {
      get: () => Settings.v.hapticOn,
      set: (v) => { this.kit.sfx.play("ui"); Settings.setPart({ hapticOn: v }); },
    });
    hapticTog.node.setPosition(togX, rows[2], 0);
    this.toggles.push(hapticTog);

    const mkHint = (text: string, key: "hintLanding" | "hintShake" | "hintFloat", y: number): void => {
      const t = this.kit.toggle(page, text, 280, {
        get: () => (Settings.v as unknown as Record<string, boolean>)[key],
        set: (v) => { this.kit.sfx.play("ui"); Settings.setPart({ [key]: v } as never); },
      });
      t.node.setPosition(hintX, y, 0);
      this.toggles.push(t);
    };
    mkHint("落点预测圈", "hintLanding", rows[0]);
    mkHint("屏幕震动", "hintShake", rows[1]);
    mkHint("飘字提示", "hintFloat", rows[2]);
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
    const btnW = 120, btnH = 44;
    for (const b of this.modeBtns) {
      const active = b.mode === cur;
      drawHardShadow(b.g, btnW, btnH, 8, 3, 3, 0.4);
      drawArcadeButton(b.g, btnW, btnH, active ? "primary" : "ghost", 8);
      b.label.color = ac(active ? "#fff5f2" : P.text);
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
    // 收起外壳用 fadeOutHide 而不是 active=false(见文件头):保持 active、靠
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

    // 提示两行:上一行 = 这屏怎么操作 + 当前模式的玩法提示;下一行 = 存档机制说明。
    // (面板 tab 页上不再常驻教学文字,谁进编辑器谁才需要。)
    const hintText = Settings.moveMode === "joystick"
      ? "点选控件拖动挪位 · 顶部滑杆改大小与透明度 · 上推摇杆即起跳"
      : Settings.moveMode === "slider"
      ? "滑轨与左半场 1:1 对齐,只能上下挪 · 顶部滑杆改大小与透明度"
      : "点选按钮拖动挪位 · 顶部滑杆改大小与透明度";
    const hint = this.kit.label(this.editView, hintText, 13, "#dfe6ff", { outline: "#05070f", outlineW: 2 });
    hint.node.setPosition(0, stripY - 58, 0);
    const saveHint = this.kit.label(this.editView, "位置按屏幕比例保存,换手机不会被刘海挤歪", 11, "#8f9cbe",
      { outline: "#05070f", outlineW: 2 });
    saveHint.node.setPosition(0, stripY - 82, 0);

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
    riseIn(saveHint.node, 0.12);
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

  /** 拆掉编辑器那一层(顶条、说明、第二份按键实例),tab 页不受影响 */
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
