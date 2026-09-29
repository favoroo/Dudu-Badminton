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
import { _decorator, Button, Color, Component, Label, Node, UITransform, Vec2 } from "cc";
import { Settings, PAD_LIMIT, type PadAction } from "../core/settings";
import type { UiKit } from "./ui-manager";
import { fadeOutHide, riseIn, safePad, slamIn } from "./ui-arcade";
import type { Slider, Toggle } from "./widgets";
import { newPad } from "../input/pad";
import { buildTouchPad, type TouchPadHandle } from "../input/touchpad";

const { ccclass } = _decorator;

const PW = 760, PH = 424;      // 卡片尺寸(比旧版高 28:开关行距放宽到 46+,加一行震动开关)
const CARD_Y = -11;            // 卡片中心下移:顶边 201 仍低于 HUD 记分牌底边 203

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
    this.txt(this.card, "操作按钮只在真正打球时出现;这里调成自己最顺手的位子。",
      12, P.dim, -PW / 2 + 20, 98, 340);

    const adjust = this.kit.button(this.card, "调整位置", 220, 52, { style: "primary", size: 19 });
    adjust.setPosition(-PW / 2 + 130, 34, 0);
    adjust.on(Button.EventType.CLICK, () => { this.kit.sfx.play("ui"); this.openEditor(); });

    const reset = this.kit.button(this.card, "重置默认", 220, 48, { size: 16 });
    reset.setPosition(-PW / 2 + 130, -38, 0);
    reset.on(Button.EventType.CLICK, () => {
      this.kit.sfx.play("ui");
      Settings.resetPad();
      Settings.flush();
      this.kit.toast("操作按钮已回到默认位子");
    });

    this.txt(this.card, "拖动按钮 = 移动位置 · 选中后用滑杆 = 改大小",
      12, "#6f7ca6", -PW / 2 + 20, -94, 340);
    this.txt(this.card, "存的是相对屏幕角落的位子,换手机不会被刘海挤歪",
      12, "#6f7ca6", -PW / 2 + 20, -120, 340);

    // ---------- 右列:声音 + 震动 ----------
    // 列内几何都按「不越过卡片右缘 ±380」排:开关 150 + 滑杆 140 + 中间留 5
    const rx = 78;                       // 右列内容左缘
    const rw = PW / 2 - 20 - rx;         // 右列可用宽
    this.txt(this.card, "声音", 15, P.accent, rx, 130, rw);

    const sfxTog = this.kit.toggle(this.card, "音效", 150, {
      get: () => Settings.v.sfxOn,
      set: (v) => { this.kit.sfx.play("ui"); Settings.setPart({ sfxOn: v }); },
    });
    sfxTog.node.setPosition(rx + 75, 80, 0);
    this.toggles.push(sfxTog);

    const sfxSl = this.kit.slider(this.card, 140, { min: 0, max: 1, step: 0.05, value: Settings.v.sfxVol });
    sfxSl.node.setPosition(rx + 225, 80, 0);
    this.wireVolume(sfxSl, "sfxVol", "sfxOn");

    const bgmTog = this.kit.toggle(this.card, "音乐", 150, {
      get: () => Settings.v.bgmOn,
      set: (v) => { this.kit.sfx.play("ui"); Settings.setPart({ bgmOn: v }); },
    });
    bgmTog.node.setPosition(rx + 75, 32, 0);
    this.toggles.push(bgmTog);

    const bgmSl = this.kit.slider(this.card, 140, { min: 0, max: 1, step: 0.05, value: Settings.v.bgmVol });
    bgmSl.node.setPosition(rx + 225, 32, 0);
    this.wireVolume(bgmSl, "bgmVol", "bgmOn");

    // 震动反馈:按键/击球/得分的触觉短震(移动端才有体感,Web 是空操作)
    const hapticTog = this.kit.toggle(this.card, "震动反馈", 150, {
      get: () => Settings.v.hapticOn,
      set: (v) => { this.kit.sfx.play("ui"); Settings.setPart({ hapticOn: v }); },
    });
    hapticTog.node.setPosition(rx + 75, -16, 0);
    this.toggles.push(hapticTog);

    // ---------- 右列:画面提示 ----------
    this.txt(this.card, "画面提示", 15, P.accent, rx, -62, rw);

    const mkHint = (text: string, key: "hintLanding" | "hintShake" | "hintFloat", y: number): void => {
      const cardNode = this.card!;      // 闭包里 this.card 的窄化会丢,捕获一次
      const t = this.kit.toggle(cardNode, text, 280, {
        get: () => (Settings.v as unknown as Record<string, boolean>)[key],
        set: (v) => { this.kit.sfx.play("ui"); Settings.setPart({ [key]: v } as never); },
      });
      t.node.setPosition(rx + 140, y, 0);
      this.toggles.push(t);
    };
    mkHint("落点预测圈", "hintLanding", -106);
    mkHint("屏幕震动", "hintShake", -152);
    mkHint("飘字提示", "hintFloat", -198);

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

    const hint = this.kit.label(this.editView, "拖动屏幕上的按钮可移动 · 点一下选中后用上方滑杆改大小",
      13, "#dfe6ff", { outline: "#05070f", outlineW: 2 });
    hint.node.setPosition(0, stripY - 58, 0);

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
    // 入场动画只动顶部操作条和说明,不动整层:editView 是 Widget 全屏容器,
    // 位置归 Widget 管;而这一层里装着按钮本体 —— 调位子时最不该自己先飘起来。
    riseIn(strip, 0);
    riseIn(hint.node, 0.06);
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
