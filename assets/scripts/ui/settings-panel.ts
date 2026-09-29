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
// 版面按设计分辨率 960×540 排;内容收在 ±380 内(可见宽最窄就是 16:9 的 960),
// 卡片顶边 198 低于 HUD 记分牌底边 203,从暂停页打开时不会挡住身后的比分。
// ============================================================
import { _decorator, Button, Color, Component, Label, Node, UITransform, Vec2, sys, view } from "cc";
import { Settings, PAD_LIMIT, type PadAction } from "../core/settings";
import type { UiKit } from "./ui-manager";
import { riseIn, slamIn } from "./ui-arcade";
import type { Slider, Toggle } from "./widgets";
import { newPad } from "../input/pad";
import { buildTouchPad, type TouchPadHandle } from "../input/touchpad";

const { ccclass } = _decorator;

const PW = 760, PH = 396;      // 卡片尺寸

@ccclass("SettingsPanel")
export class SettingsPanel extends Component {
  private kit!: UiKit;
  private root: Node | null = null;
  private card: Node | null = null;
  private listView: Node | null = null;
  private editView: Node | null = null;
  private padHandle: TouchPadHandle | null = null;
  private sizeSlider: Slider | null = null;
  private selected: PadAction | null = null;
  private toggles: Toggle[] = [];
  private sliders: Slider[] = [];
  private offChange: (() => void) | null = null;
  private onCloseCb: (() => void) | null = null;

  // ---------- 公开接口 ----------

  /** 构建并显示;UiKit 由 UIManager 传进来(面板不 import ui-manager 的实例,避免成环) */
  show(parent: Node, kit: UiKit, onClose: () => void): void {
    this.kit = kit;
    this.onCloseCb = onClose;
    this.selected = "left";
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
    this.sizeSlider = null;
    this.onCloseCb = null;
    this.listView = null;
    this.editView = null;
    this.card = null;
    if (this.root && this.root.isValid) this.root.destroy();
    this.root = null;
  }

  // ---------- LIST 视图 ----------

  private buildList(parent: Node): void {
    const P = this.kit.pal;
    this.root = this.kit.root(parent, "settings-panel");
    // 中心压得比主菜单暗:这一屏是读字调参数的,不是看球场的
    this.kit.dim(this.root, 0.5, 0.78);

    const card = this.kit.panel(this.root, PW, PH, { r: 16, alpha: 0.94 });
    this.card = card.node;
    this.listView = new Node("list-view");
    this.listView.layer = this.root.layer;
    this.listView.setParent(this.root);

    const title = this.kit.label(this.card, "设置", 26, P.accent);
    title.node.setPosition(0, 166, 0);
    title.enableShadow = true;
    title.shadowColor = new Color(0, 0, 0, 130);
    title.shadowOffset = new Vec2(0, -4);
    this.kit.label(this.card, "SETTINGS", 11, P.dim).node.setPosition(0, 142, 0);

    const done = this.kit.button(this.card, "完成", 120, 42, { style: "primary", size: 17 });
    done.setPosition(PW / 2 - 82, 152, 0);
    done.on(Button.EventType.CLICK, () => { this.kit.sfx.play("ui"); this.close(); });

    // ---------- 左列:按键布局 ----------
    this.txt(this.card, "按键布局", 15, P.accent, -PW / 2 + 20, 104, 200);
    this.txt(this.card, "操作按钮只在真正打球时出现;这里调成自己最顺手的位子。",
      12, P.dim, -PW / 2 + 20, 72, 320);

    const adjust = this.kit.button(this.card, "调整位置", 220, 52, { style: "primary", size: 19 });
    adjust.setPosition(-PW / 2 + 130, 6, 0);
    adjust.on(Button.EventType.CLICK, () => { this.kit.sfx.play("ui"); this.openEditor(); });

    const reset = this.kit.button(this.card, "重置默认", 220, 44, { size: 16 });
    reset.setPosition(-PW / 2 + 130, -62, 0);
    reset.on(Button.EventType.CLICK, () => {
      this.kit.sfx.play("ui");
      Settings.resetPad();
      Settings.flush();
      this.kit.toast("操作按钮已回到默认位子");
    });

    this.txt(this.card, "拖动按钮 = 移动位置 · 选中后用滑杆 = 改大小",
      12, "#6f7ca6", -PW / 2 + 20, -116, 320);
    this.txt(this.card, "存的是相对屏幕角落的位子,换手机不会被刘海挤歪",
      12, "#6f7ca6", -PW / 2 + 20, -140, 320);

    // ---------- 右列:声音 ----------
    // 列内几何都按「不越过卡片右缘 ±380」排:开关 150 + 滑杆 140 + 中间留 5
    const rx = 78;                       // 右列内容左缘
    const rw = PW / 2 - 20 - rx;         // 右列可用宽
    this.txt(this.card, "声音", 15, P.accent, rx, 104, rw);

    const sfxTog = this.kit.toggle(this.card, "音效", 150, {
      get: () => Settings.v.sfxOn,
      set: (v) => { this.kit.sfx.play("ui"); Settings.setPart({ sfxOn: v }); },
    });
    sfxTog.node.setPosition(rx + 75, 56, 0);
    this.toggles.push(sfxTog);

    const sfxSl = this.kit.slider(this.card, 140, { min: 0, max: 1, step: 0.05, value: Settings.v.sfxVol });
    sfxSl.node.setPosition(rx + 225, 56, 0);
    this.wireVolume(sfxSl, "sfxVol", "sfxOn");

    const bgmTog = this.kit.toggle(this.card, "音乐", 150, {
      get: () => Settings.v.bgmOn,
      set: (v) => { this.kit.sfx.play("ui"); Settings.setPart({ bgmOn: v }); },
    });
    bgmTog.node.setPosition(rx + 75, 2, 0);
    this.toggles.push(bgmTog);

    const bgmSl = this.kit.slider(this.card, 140, { min: 0, max: 1, step: 0.05, value: Settings.v.bgmVol });
    bgmSl.node.setPosition(rx + 225, 2, 0);
    this.wireVolume(bgmSl, "bgmVol", "bgmOn");

    // ---------- 右列:画面提示 ----------
    this.txt(this.card, "画面提示", 15, P.accent, rx, -40, rw);

    const mkHint = (text: string, key: "hintLanding" | "hintShake" | "hintFloat", y: number): void => {
      const cardNode = this.card!;      // 闭包里 this.card 的窄化会丢,捕获一次
      const t = this.kit.toggle(cardNode, text, 280, {
        get: () => (Settings.v as unknown as Record<string, boolean>)[key],
        set: (v) => { this.kit.sfx.play("ui"); Settings.setPart({ [key]: v } as never); },
      });
      t.node.setPosition(rx + 140, y, 0);
      this.toggles.push(t);
    };
    mkHint("落点预测圈", "hintLanding", -84);
    mkHint("屏幕震动", "hintShake", -128);
    mkHint("飘字提示", "hintFloat", -172);

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

  private repaint(): void {
    for (const t of this.toggles) if (t.node && t.node.isValid) t.paint();
    // 滑杆的值可能被别处(键盘/其它面板)改动,单向同步;不触发它们的 onChange
    const s = Settings.v;
    if (this.sliders[0] && this.sliders[0].get() !== s.sfxVol) this.sliders[0].set(s.sfxVol);
    if (this.sliders[1] && this.sliders[1].get() !== s.bgmVol) this.sliders[1].set(s.bgmVol);
    if (this.sizeSlider) {
      const a = this.selected;
      if (a) this.sizeSlider.set(Settings.padOf(a).r);
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
    // 比 LIST 的暗底透得多:调位置要看清按钮落在球场上是什么样子
    this.kit.dim(this.editView, 0.16, 0.46);

    // 顶部操作条:让开刘海/状态栏(hud.ts 同款算法,安全区内缩像素 == 世界单位)
    let safeTop = 0;
    try {
      const vs = view.getVisibleSize();
      const sr = sys.getSafeAreaRect();
      if (vs.height > 0 && sr) {
        const topPx = vs.height - (sr.y + sr.height);
        if (topPx > 0) safeTop = Math.min(48, topPx);
      }
    } catch { /* 拿不到就按无刘海排 */ }
    const stripY = 270 - 34 - safeTop;

    const strip = new Node("strip");
    strip.layer = this.root!.layer;
    strip.setParent(this.editView);
    strip.setPosition(0, stripY, 0);

    const g = this.kit.panel(strip, PW, 64, { r: 12, alpha: 0.88 });
    g.node.setPosition(0, 0, 0);

    this.txt(strip, "大小", 14, P.text, -PW / 2 + 26, 0, 60);
    this.sizeSlider = this.kit.slider(strip, 220, {
      min: PAD_LIMIT.rMin, max: PAD_LIMIT.rMax, step: 1,
      value: Settings.padOf(this.selected ?? "left").r,
    });
    this.sizeSlider.node.setPosition(-PW / 2 + 226, 0, 0);
    this.sizeSlider.onChange((v) => {
      const a = this.selected;
      if (!a) return;
      Settings.setPad(a, { r: v }, false);      // 半径变化不夹位置,内存改完 apply 自动跟上
    });
    this.sizeSlider.onCommit(() => Settings.flush());

    const eReset = this.kit.button(strip, "重置默认", 150, 44, { size: 15 });
    eReset.setPosition(PW / 2 - 268, 0, 0);
    eReset.on(Button.EventType.CLICK, () => {
      this.kit.sfx.play("ui");
      Settings.resetPad();
      Settings.flush();
      this.padHandle?.apply();
      this.sizeSlider?.set(Settings.padOf(this.selected ?? "left").r);
    });

    const eDone = this.kit.button(strip, "完成", 150, 44, { style: "primary", size: 16 });
    eDone.setPosition(PW / 2 - 100, 0, 0);
    eDone.on(Button.EventType.CLICK, () => { this.kit.sfx.play("ui"); this.closeEditor(); });

    this.kit.label(this.editView, "拖动屏幕上的按钮可移动 · 点一下选中后用上方滑杆改大小",
      13, "#dfe6ff", { outline: "#05070f", outlineW: 2 }).node.setPosition(0, stripY - 58, 0);

    // 第二个按键实例:挂在一个临时 Pad 上,edit 模式又跳过 press/release,
    // 双保险保证这里怎么拖都不会打出一个球、也不会污染玩家 pad 的跨步计时。
    this.padHandle = buildTouchPad(this.editView, newPad(), {
      edit: true,
      onPick: (a) => this.pick(a),
      onDrag: (a, dx, dy) => {
        if (!this.padHandle) return;
        const clamped = this.padHandle.clampDelta(a, dx, dy);
        Settings.setPad(a, clamped, false);      // 拖动中不落盘(原生 localStorage 是同步 IO)
      },
      onDragEnd: () => Settings.flush(),
    });
    // 建层时 Widget 还没给全屏容器定尺寸,首帧的夹取用的是兜底宽度;补一次
    this.padHandle.apply();
    this.pick(this.selected ?? "left");

    this.listView!.active = false;
    riseIn(this.editView, 0);
  }

  private pick(a: PadAction): void {
    this.selected = a;
    this.padHandle?.select(a);
    this.sizeSlider?.set(Settings.padOf(a).r);
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
