// ============================================================
// 设置页:tab 三页(操控 / 声音画面 / 关于)+ 「调整位置」的所见即所得编辑器。
//
// 「关于」这页是搬进来的:版本号 + 检查更新原本挂在首页底部当一颗按钮(用户指令:
// 去掉),而"查更新"本来就是设置里的事 —— 顺带补一条浏览器下载出路,应用内那条
// 路走不通时不至于只能干瞪眼。
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
import { _decorator, Button, Component, Graphics, Label, Layers, Node, sys, UITransform } from "cc";
import { Settings, PAD_LIMIT, JOYSTICK_LIMIT, SLIDER_LIMIT, type MoveMode } from "../core/settings";
import { CFG } from "../core/config";
import { APP_VERSION_NAME } from "../core/version";
import { Pace, paceIndexOf, paceTierById } from "../core/pace";
import { Gait, gaitIndexOf, gaitTierById } from "../core/gait";
import { hapticIndexOf, hapticLabel, hapticLevelId } from "../core/haptic";
import { haptic, hapticCancel, hapticStatus } from "../game/haptics";
import { browserDownloadUrl, UpdateService, type UpdateCheckResult } from "../game/update-service";
import type { UiKit } from "./ui-manager";
import { cancelFade, fadeOutHide, riseIn, safePad, slamIn, SLANT, type Role } from "./ui-arcade";
import { C, ROLE } from "./p5-tokens";
import { paintP5 } from "./p5-paint";
import { DIAG, padDiagramDL } from "./pad-diagram";
import { sectionTitle, solidTab, type TabHandle } from "./ui-shell";
import type { Slider, Toggle } from "./widgets";
import { stripAt, stripLayout } from "./editor-strip";
import {
  aboutLayout, ASSIST_COPY, ASSIST_COPY_SIZE, assistLayout, controlLayout, donePos,
  hapticTestRow, mediaLayout, MODE_TIP_SIZE, MOVE_MODES, SET, SETTINGS_TABS,
  strengthRow, tabBoxes, type SettingsTab,
} from "./settings-layout";
import { newPad } from "../input/pad";
import { buildTouchPad, type PadSlot, type TouchPadHandle } from "../input/touchpad";

const { ccclass } = _decorator;

// 版面常量全部搬进 settings-layout.ts(纯函数,由 tools/panel-check.ts 在 node 下断言
// 不重叠、不溢出)。这里只留 PW/PH 两个别名:「调整位置」顶栏与 strip-check 共用着它们。
const PW = SET.pw, PH = SET.ph;
const CARD_Y = SET.cardY;
const COL_X = SET.colX;                 // 两页小节标题与行标签的统一左缘

/**
 * 各区块用哪个角色色 —— 色即功能,一律查 p5-tokens.ROLE,不在面板里写 hex。
 * 旧版这一页所有小节标题都是同一支荧光黄裸文字,读起来像"整页一个主题";
 * 现在颜色在报结构:红=当前 tab、青=声音、黄=画面、绿=手感。
 */
const ROLE_TAB: Role = "primary";
const ROLE_SOUND: Role = "info";
const ROLE_SCREEN: Role = "star";
const ROLE_FEEL: Role = "drill";
/** 关于页的小节色带:纸白面 —— 这一页不推销任何东西,给个中性色,别跟红/黄/绿抢 */
const ROLE_ABOUT: Role = "record";
/** 辅助页色带:绿 —— 与操控页的「手感」同族(都在改玩法,不是改声音改画面) */
const ROLE_ASSIST: Role = "drill";
/** 衬纸后面那张错位副衬:整页用主红,与首页 hero 同色同源 */
const BAND_HEX = ROLE.primary.face;

/** 页表在 settings-layout 里(零 cc):panel-check 要拿它量「再加一页 tab 栏挤不挤」 */
const TAB_DEFS: Array<{ key: SettingsTab; label: string }> = SETTINGS_TABS;

/**
 * 三档移动方式与那行提示 —— 表住在 settings-layout(零 cc)。
 * 原来这张表写在本文件里,于是「提示行窄了 22px 会不会把句子静默截掉」panel-check 量不到
 * (它 import 不动一个要 cc 的文件);挪过去之后,量宽吃的就是面板真正摆出去的那三句。
 */
const MODES = MOVE_MODES;

/** tab → 页节点名:切页时按这个建,别再用三目串拼(加一页就漏一处) */
const PAGE_NAME: Record<SettingsTab, string> = {
  control: "page-control", assist: "page-assist", media: "page-media", about: "page-about",
};

/** 时间戳 → 「10-02 14:35」:状态行要说清"什么时候查的",年份没必要 */
function fmtStamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

@ccclass("SettingsPanel")
export class SettingsPanel extends Component {
  private kit!: UiKit;
  private root: Node | null = null;

  /** 面板根节点:供 ui-manager 做 screenSwap 退场用(退场仍走 hide(),那里有清理) */
  get rootNode(): Node | null { return this.root; }
  private card: Node | null = null;
  private listView: Node | null = null;
  private editView: Node | null = null;
  private padHandle: TouchPadHandle | null = null;
  private sizeSlider: Slider | null = null;
  private alphaSlider: Slider | null = null;
  /** 当前 tab 与对应的页节点;切页 = discardPage() + buildPage(),从不复用画过的子树 */
  private tab: SettingsTab = "control";
  private page: Node | null = null;
  private tabs: TabHandle[] = [];
  /** tabs 与 TAB_DEFS 同序:工厂只管画,「第几格是哪个页」由这张平行表记住 */
  private tabKeys: SettingsTab[] = [];
  /** 球速档位滑杆:与 sizeSlider/alphaSlider 一样存独立字段,**绝不 push 进 this.sliders**
   *  —— repaint() 按下标 0/1 同步音效/音乐音量,混进去会把音量滑杆指错。 */
  private paceSlider: Slider | null = null;
  private paceValueLabel: Label | null = null;
  private gaitSlider: Slider | null = null;
  private gaitValueLabel: Label | null = null;
  /** 震动强度滑杆 + 读数:同样独立字段,理由与 paceSlider 相同(别撞音量滑杆的下标) */
  private hapticSlider: Slider | null = null;
  private hapticValueLabel: Label | null = null;
  private hapticStatusLabel: Label | null = null;
  /** 关于页:结果读数 + 「检查中」闸门(在途时再点不重复发请求) */
  private aboutStatus: Label | null = null;
  private aboutCheckLabel: Label | null = null;
  private aboutChecking = false;
  /** 上一次检查的人话结论。存在组件上而不是 Label 上:切页会整树销毁重建,读数不该跟着丢 */
  private aboutResult = "";
  private selected: PadSlot | null = "left";
  private sizeLabel: Label | null = null;
  private modeTipLabel: Label | null = null;
  /**
   * 移动方式图示:一块逐帧重画的小舞台(只读,不吃触摸 —— 凹陷槽的语法就是"只读")。
   * 引用随 discardPage 置空,切页从不复用画过的子树(见文件头两条原生坑)。
   */
  private diagGfx: Graphics | null = null;
  /** 图示盒的宽高:建的时候从 controlLayout 抄一份,免得每帧再算一遍版式 */
  private diagW = 0;
  private diagH = 0;
  /** 图示时钟(帧,取模 DIAG.loop)。切档不重置:同一拍继续演,换的只是那件控件 */
  private diagT = 0;
  private modeBtns: Array<{ mode: MoveMode; tab: TabHandle }> = [];
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
    // 试震的待发放不能留:面板已经收走了,晚半秒再震一下只会像灵异事件
    hapticCancel();
    this.padHandle?.destroy();
    this.padHandle = null;
    this.discardPage();
    this.tabs = [];
    this.tabKeys = [];
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
    // 裸节点没有它 → 暗底停在 960×540,宽屏两侧那一条触摸会漏到世界里(见文件头)。
    this.listView = this.kit.root(this.root, "list-view");

    // 二级界面底即墨黑(用户指令):这一屏是读字调参数的,身后的一级界面/球场一律不露。
    // bands:false —— 这一屏的主角是衬纸本身,遮罩再叠两道红带就把注意力抢走了。
    this.kit.dim(this.listView, 1, 1, { bands: false });

    // 衬纸(L1):一张黑纸垫在红纸上,标题带叠网点,平直收边。
    // 旧写法是「navy 竖向渐变 + 14 圆角」—— 那是通用深色弹窗,不是 P5。
    const card = this.kit.panel(this.listView, PW, PH, {
      bandHex: BAND_HEX, halftone: true, alpha: 0.96,
    });
    this.card = card.node;
    this.card.setPosition(0, CARD_Y, 0);

    const title = this.kit.label(this.card, "设置", 26, P.accent, { disp: true, shadow: true, shadowDrop: 4 });
    title.node.setPosition(0, SET.titleY, 0);

    const dp = donePos();
    const done = this.kit.button(this.card, "完成", SET.doneBtn.w, SET.doneBtn.h, { style: "primary", size: 17 });
    done.setPosition(dp.x, dp.y, 0);
    done.on(Button.EventType.CLICK, () => { this.kit.sfx.play("ui"); this.close(); });

    this.buildTabBar(this.card!);
    this.buildPage();
  }

  /**
   * tab 栏:走 ui-shell.solidTab —— 与「移动方式」三选一同一个工厂。
   * 旧写法是这里画一遍、buildControlPage 里再画一遍(两份 drawHardShadow +
   * drawArcadeButton(r=8, slant=0)),圆角、零斜切,与全站大色块无关。
   * 宽与 x 一律由 tabBoxes() 给(整行左对齐贴内容列、右端让开「完成」),别在这儿拍数字。
   */
  private buildTabBar(card: Node): void {
    const bs = tabBoxes(TAB_DEFS.length);
    this.tabs = TAB_DEFS.map((d, i) => {
      const b = bs[i];
      const t = solidTab({
        name: `tab-${d.key}`, parent: card, label: d.label,
        w: b.right - b.left, h: SET.tab.h, role: ROLE_TAB, size: 15,
      });
      t.node.setPosition(b.left + (b.right - b.left) / 2, SET.tab.y, 0);
      this.tabKeys.push(d.key);
      t.node.on(Button.EventType.CLICK, () => {
        if (this.tab === d.key) return;
        this.kit.sfx.play("ui");
        this.switchTab(d.key);
      });
      return t;
    });
    this.paintTabs();
  }

  private paintTabs(): void {
    this.tabs.forEach((t, i) => t.paint(this.tabKeys[i] === this.tab));
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
    this.diagGfx = null;
    this.toggles.length = 0;
    this.sliders.length = 0;
    this.paceSlider = null;
    this.paceValueLabel = null;
    this.gaitSlider = null;
    this.gaitValueLabel = null;
    this.hapticSlider = null;
    this.hapticValueLabel = null;
    this.hapticStatusLabel = null;
    this.aboutStatus = null;
    this.aboutCheckLabel = null;
    if (this.page && this.page.isValid) this.page.destroy();
    this.page = null;
  }

  private buildPage(): void {
    this.discardPage();
    const page = new Node(PAGE_NAME[this.tab]);
    page.layer = Layers.Enum.UI_2D;
    page.setParent(this.card!);
    this.page = page;
    if (this.tab === "control") this.buildControlPage(page);
    else if (this.tab === "assist") this.buildAssistPage(page);
    else if (this.tab === "media") this.buildMediaPage(page);
    else this.buildAboutPage(page);
    this.repaint();
  }

  /** 操控页:移动方式分段 + 调整位置/重置默认 + 手感两档(球速/移速) */
  private buildControlPage(page: Node): void {
    const P = this.kit.pal;
    const K = controlLayout();
    const wOf = (b: { left: number; right: number }): number => b.right - b.left;
    const cOf = (b: { left: number; right: number }): number => b.left + (b.right - b.left) / 2;

    // 小节标题 = 分区色带(L2):整面 accent 实底 + 墨黑字。
    // 旧写法是一行荧光黄裸文字 —— P5 里没有「裸排飘字」这回事,标题得占住一块色。
    this.band(page, "移动方式", ROLE_SCREEN, K.sectionMove);

    // 三档分段选择器:与 tab 栏同一个工厂(选中=实底色块,未选=凹陷槽)
    this.modeBtns = MODES.map((mItem, idx) => {
      const b = K.modes[idx];
      const t = solidTab({
        name: `mode-${mItem.mode}`, parent: page, label: mItem.label,
        w: wOf(b), h: b.h, role: ROLE_TAB, size: 15,
      });
      t.node.setPosition(cOf(b), b.cy, 0);
      t.node.on(Button.EventType.CLICK, () => {
        if (Settings.moveMode === mItem.mode) return;
        this.kit.sfx.play("ui");
        Settings.setPart({ moveMode: mItem.mode });
        this.padHandle?.apply();
        this.pick(mItem.mode === "joystick" ? "joystick" : mItem.mode === "slider" ? "slider" : "left");
        this.updateModeSelector();
      });
      return { mode: mItem.mode, tab: t };
    });

    // 模式提示:随选中档变化(updateModeSelector 刷新文案)
    const tip = this.kit.label(page, "", MODE_TIP_SIZE, P.dim, { align: 0 });
    const tipUt = tip.node.getComponent(UITransform)!;
    tipUt.setContentSize(wOf(K.modeTip), K.modeTip.h);
    tip.overflow = Label.Overflow.CLAMP;
    tip.node.setPosition(cOf(K.modeTip), K.modeTip.cy, 0);
    this.modeTipLabel = tip;
    this.updateModeSelector();

    // ---------- 移动方式图示(右半格,会动) ----------
    // 底是一块凹陷槽:这套语法里「凹 = 只读、凸 = 能点」,所以这一格不吃任何触摸,
    // 也不会跟左列那三颗真键抢点按。动画本体是叠在槽上的第二块画布,逐帧重画
    // (装配法照先例 drill-panel 的 animBg + animGfx 两层:底一次成型、上面每帧 clear)。
    const D = K.diagram;
    this.diagW = wOf(D);
    this.diagH = D.h;
    const diagSlot = this.kit.slot("diag-slot", page, this.diagW, D.h, C.ink);
    diagSlot.node.setPosition(cOf(D), D.cy, 0);
    const diagNode = new Node("diag-gfx");
    diagNode.layer = Layers.Enum.UI_2D;
    diagNode.addComponent(UITransform).setContentSize(this.diagW, this.diagH);
    diagNode.setParent(page);
    diagNode.setPosition(cOf(D), D.cy, 0);
    this.diagGfx = diagNode.addComponent(Graphics);
    this.diagT = 0;
    // 建完当场画一帧:等下一次 update 的话,打开设置页的第一帧这一格是空的
    this.paintDiagram();

    // 「调整位置」进 EDIT;「重置默认」一行两颗,不再竖着占两条
    const [adjBox, rstBox] = K.actions;
    const adjust = this.kit.button(page, "调整位置", wOf(adjBox), adjBox.h, { style: "primary", size: 17 });
    adjust.setPosition(cOf(adjBox), adjBox.cy, 0);
    adjust.on(Button.EventType.CLICK, () => { this.kit.sfx.play("ui"); this.openEditor(); });

    const reset = this.kit.button(page, "重置默认", wOf(rstBox), rstBox.h, { size: 15 });
    reset.setPosition(cOf(rstBox), rstBox.cy, 0);
    reset.on(Button.EventType.CLICK, () => {
      this.kit.sfx.play("ui");
      Settings.resetPad();
      Settings.flush();
      this.kit.toast("操作按钮已回到默认位子");
    });

    // ---------- 手感两档(球速 / 移速)----------
    // 用滑杆而不是分段按钮:八档 / 六档分段在一行里放不下。行心一律由 settings-layout
    // 的 rowPitch 推 —— 上一版手写 -124/-164,滑杆触摸区从 34 抬到 44 之后那两行会
    // 重叠 4px:屏幕上看不出来,按下就是错档。
    this.band(page, "手感", ROLE_FEEL, K.sectionFeel);
    this.txt(page, "球速下一球起效 · 移速立即生效", 12, P.dim, K.feelHint.left, K.feelHint.cy, wOf(K.feelHint));

    const mkTierRow = (label: string, i: number, n: number, idx: number,
      apply: (i: number) => void, commit: () => void): Slider => {
      const row = K.tiers[i];
      this.txt(page, label, 14, P.text, row.name.left, row.y, wOf(row.name));
      const sl = this.kit.slider(page, wOf(row.slider), {
        min: 0, max: n - 1, step: 1, value: idx, ticks: n,
      });
      sl.node.setPosition(cOf(row.slider), row.y, 0);
      // 拖动 60Hz:只改内存(原生 setItem 是同步文件 IO),档名跟着 repaint 的订阅刷新
      sl.onChange((v) => apply(Math.round(v)));
      sl.onCommit(() => { Settings.flush(); commit(); });
      return sl;
    };

    this.paceSlider = mkTierRow("球速", 0, CFG.pace.tiers.length, paceIndexOf(Settings.paceTier),
      (i) => Settings.setPart({ paceTier: CFG.pace.tiers[i].id }, false),
      () => this.kit.toast(`球速「${this.paceCaption()}」· 下一球起生效`));
    this.paceValueLabel = this.txt(page, this.paceCaption(), 13, P.text,
      K.tiers[0].caption.left, K.tiers[0].y, wOf(K.tiers[0].caption));

    this.gaitSlider = mkTierRow("移速", 1, CFG.gait.tiers.length, gaitIndexOf(Settings.gaitTier),
      (i) => Settings.setPart({ gaitTier: CFG.gait.tiers[i].id }, false),
      () => this.kit.toast(`移速「${this.gaitCaption()}」· 已生效`));
    this.gaitValueLabel = this.txt(page, this.gaitCaption(), 13, P.text,
      K.tiers[1].caption.left, K.tiers[1].y, wOf(K.tiers[1].caption));
  }

  /**
   * 每帧推进「移动方式图示」。四道门控,少一道就是白画:
   *   · diagGfx 为空 —— 不在操控页(discardPage 里置空)
   *   · node 失效 —— 面板正在退场销毁,摸它就是摸一块死画布
   *   · editView 非空 —— 进「调整位置」了:外壳整块淡出(靠 opacity 不是 active=false,
   *     见文件头那条原生坑),看不见还每帧画 50 条多边形,就是纯浪费
   *   · tab 不是 control —— 理论上第一条已挡住,留着是防以后加页时漏改
   */
  update(dt: number): void {
    if (!this.diagGfx || !this.diagGfx.node.isValid || this.editView || this.tab !== "control") return;
    // dt 封顶 3 帧:切后台回来或掉一帧大卡,不该让图示一次跳过半段动作
    this.diagT = (this.diagT + Math.min(3, dt * 60)) % DIAG.loop;
    this.paintDiagram();
  }

  /** 画当前这一帧。档位每帧现读 Settings —— 点哪档下一帧就换哪档,不需要谁去通知它 */
  private paintDiagram(): void {
    const g = this.diagGfx;
    if (!g || !g.node.isValid) return;
    g.clear();
    paintP5(g, padDiagramDL(Settings.moveMode, this.diagT, this.diagW, this.diagH));
  }

  /**
   * 辅助页:一颗「自动击打」开关 + 三行说明。
   *
   * 为什么不塞进操控页:那一页竖排已经零余量 —— 手感第二行行心 -176、滑杆高 44 ⇒ 底边 -198,
   * 而版式红线是 -(ph/2 + cardY) = -201,再排一行要放到 -226,当场溢出 47px。
   *
   * 为什么三行说明一行都不能省:这个开关打开后人物会"自己挥拍"。看不见的机制会被读成坏掉的
   * 按键(现场先例:震动没开、冷却看不清,用户说的都是"没有反应"),而"它为什么不替我捞那个
   * 明显能到的球"确实有一个正确答案(那球要出界,让它落地才是对的)—— 不写出来就没人猜得到。
   * 文案是数据:三行字住在 settings-layout 的 ASSIST_COPY 里,由 panel-check 量宽 ——
   * 这里用 Overflow.CLAMP 摆字,长了会静默截,不量就等于没写。
   */
  private buildAssistPage(page: Node): void {
    const P = this.kit.pal;
    const S = assistLayout();
    const wOf = (b: { left: number; right: number }): number => b.right - b.left;
    const cOf = (b: { left: number; right: number }): number => b.left + (b.right - b.left) / 2;

    this.band(page, "辅助", ROLE_ASSIST, S.section);

    const t = this.kit.toggle(page, "自动击打", wOf(S.toggle), {
      get: () => Settings.v.autoHit,
      set: (v: boolean) => {
        this.kit.sfx.play("ui");
        Settings.setPart({ autoHit: v });
        // 即时生效(它不改任何已在飞的弹道,只是"下一拍由谁起手")—— 与移速同一口径,
        // 不像球速要等下一球。关掉不必清什么残留:代拍窗每帧重算,没有跨帧状态。
        this.kit.toast(v ? ASSIST_COPY.toastOn : ASSIST_COPY.toastOff);
      },
    });
    t.node.setPosition(cOf(S.toggle), S.toggle.cy, 0);
    this.toggles.push(t);

    this.txt(page, ASSIST_COPY.scope, ASSIST_COPY_SIZE, P.dim, S.scope.left, S.scope.cy, wOf(S.scope));
    this.txt(page, ASSIST_COPY.tip, ASSIST_COPY_SIZE, P.text, S.tip.left, S.tip.cy, wOf(S.tip));
    this.txt(page, ASSIST_COPY.landing, ASSIST_COPY_SIZE, P.dim,
      S.landingHint.left, S.landingHint.cy, wOf(S.landingHint));
  }

  /** 声音画面页:左子列「声音与震动」,右子列「画面」,中线 x=0 分界 */
  private buildMediaPage(page: Node): void {
    const M = mediaLayout();
    const wOf = (b: { left: number; right: number }): number => b.right - b.left;
    const cOf = (b: { left: number; right: number }): number => b.left + (b.right - b.left) / 2;

    this.band(page, "声音与震动", ROLE_SOUND, M.sectionLeft);
    this.band(page, "画面", ROLE_SCREEN, M.sectionRight);

    // 左列:音效 / 音乐 各带一根音量滑杆,震动反馈单独一行
    const togDefs = [
      {
        get: () => Settings.v.sfxOn,
        set: (v: boolean) => { this.kit.sfx.play("ui"); Settings.setPart({ sfxOn: v }); },
      },
      {
        get: () => Settings.v.bgmOn,
        set: (v: boolean) => { this.kit.sfx.play("ui"); Settings.setPart({ bgmOn: v }); },
      },
      {
        get: () => Settings.v.hapticOn,
        set: (v: boolean) => {
          this.kit.sfx.play("ui");
          Settings.setPart({ hapticOn: v });
          // 关掉就把待发放一起丢掉,不许有"已经关了还震一下"的尾巴
          if (!v) hapticCancel();
          else this.kit.toast("震动已开 · 点「试震」验一下");
        },
      },
    ];
    M.toggles.forEach((r, i) => {
      const t = this.kit.toggle(page, r.label, wOf(r.toggle), togDefs[i]);
      t.node.setPosition(cOf(r.toggle), r.toggle.cy, 0);
      this.toggles.push(t);
    });

    const volDefs: Array<[("sfxVol" | "bgmVol"), ("sfxOn" | "bgmOn"), number]> = [
      ["sfxVol", "sfxOn", Settings.v.sfxVol],
      ["bgmVol", "bgmOn", Settings.v.bgmVol],
    ];
    M.toggles.forEach((r, i) => {
      if (!r.vol) return;
      const [vk, onk, v0] = volDefs[i];
      const sl = this.kit.slider(page, wOf(r.vol), { min: 0, max: 1, step: 0.05, value: v0 });
      sl.node.setPosition(cOf(r.vol), r.vol.cy, 0);
      this.wireVolume(sl, vk, onk);
    });

    // ---------- 震动:强度档 + 试震 + 状态读数 ----------
    // 为什么三样一起给:上一版只有开关,用户看不到"到底是哪一环断了"就只能猜。
    const ST = strengthRow();
    this.txt(page, "强度", 14, this.kit.pal.text, ST.name.left, ST.name.cy, wOf(ST.name));
    const hSl = this.kit.slider(page, wOf(ST.slider), {
      min: 0, max: CFG.haptic.levels.length - 1, step: 1,
      value: hapticIndexOf(Settings.hapticLevel), ticks: CFG.haptic.levels.length,
    });
    hSl.node.setPosition(cOf(ST.slider), ST.slider.cy, 0);
    // 拖动只改内存(原生 setItem 是同步文件 IO),松手才落盘并当场试震一下
    hSl.onChange((v) => Settings.setPart({ hapticLevel: hapticLevelId(v) }, false));
    hSl.onCommit(() => {
      Settings.flush();
      const lab = hapticLabel(Settings.hapticLevel);
      this.kit.toast(`震动「${lab}」· 已生效`);
      haptic("smash");
    });
    this.hapticSlider = hSl;
    this.hapticValueLabel = this.txt(page, hapticLabel(Settings.hapticLevel), 13, this.kit.pal.text,
      ST.caption.left, ST.caption.cy, wOf(ST.caption));

    const TS = hapticTestRow();
    const testBtn = this.kit.button(page, "试震", wOf(TS.btn), TS.btn.h, { size: 15 });
    testBtn.setPosition(cOf(TS.btn), TS.btn.cy, 0);
    testBtn.on(Button.EventType.CLICK, () => {
      this.kit.sfx.play("ui");
      // 三档连打:轻/中/最重各一下,顺带验证 core/haptic.ts 的排队(同帧三件事都得响得出)
      haptic("sweet");
      haptic("smash");
      haptic("perfectSmash");
    });

    // 状态读数:这一行就是「为什么没震」的答案,不是装饰
    this.hapticStatusLabel = this.txt(page, hapticStatus(), 11, this.kit.pal.dim,
      TS.status.left, TS.status.cy, wOf(TS.status));

    const hintDefs: Array<[string, "hintLanding" | "hintShake" | "hintFloat"]> = [
      ["落点预测圈", "hintLanding"],
      ["屏幕震动", "hintShake"],
      ["飘字提示", "hintFloat"],
    ];
    M.hints.forEach((b, i) => {
      const [text, key] = hintDefs[i];
      const t = this.kit.toggle(page, text, wOf(b), {
        get: () => (Settings.v as unknown as Record<string, boolean>)[key],
        set: (v) => { this.kit.sfx.play("ui"); Settings.setPart({ [key]: v } as never); },
      });
      t.node.setPosition(cOf(b), b.cy, 0);
      this.toggles.push(t);
    });
  }

  /** 关于页:当前版本 + 检查更新 + 交给浏览器下载安装包 */
  private buildAboutPage(page: Node): void {
    const P = this.kit.pal;
    const A = aboutLayout();
    const wOf = (b: { left: number; right: number }): number => b.right - b.left;
    const cOf = (b: { left: number; right: number }): number => b.left + (b.right - b.left) / 2;

    this.band(page, "版本与更新", ROLE_ABOUT, A.section);
    this.txt(page, "当前版本", 14, P.text, A.verName.left, A.verName.cy, wOf(A.verName));
    this.txt(page, APP_VERSION_NAME, 15, P.accent, A.verValue.left, A.verValue.cy, wOf(A.verValue));

    const check = this.kit.button(page, "检查更新", wOf(A.checkBtn), A.checkBtn.h, { style: "primary", size: 16 });
    check.setPosition(cOf(A.checkBtn), A.checkBtn.cy, 0);
    check.on(Button.EventType.CLICK, () => { this.kit.sfx.play("ui"); this.checkNow(); });
    this.aboutCheckLabel = check.children[0].getComponent(Label);

    // 「更新记录」:全部历史版本的更新说明,拉两端 Releases 列表在弹窗里翻
    const log = this.kit.button(page, "更新记录", wOf(A.logBtn), A.logBtn.h, { size: 16 });
    log.setPosition(cOf(A.logBtn), A.logBtn.cy, 0);
    log.on(Button.EventType.CLICK, () => { this.kit.sfx.play("ui"); this.kit.showHistory(); });

    // 「浏览器下载」只在**确实挂着新版本**时才建这颗键(用户指令):没更新时点它,等于把人
    // 丢进一个空发布页去替我做检查。页本来就是切页整树重建的,所以按当前状态决定建不建,
    // 不去 toggle 已建节点的 active —— 原生侧一 disable 就把 Graphics 的渲染数据清了。
    // 版面给它的位在「更新记录」右侧(见 aboutLayout):常驻两颗钉死不动,晚到的它排最右。
    const pend = UpdateService.instance.pendingUpdate;
    if (pend) {
      const site = this.kit.button(page, "浏览器下载", wOf(A.siteBtn), A.siteBtn.h, { size: 15 });
      site.setPosition(cOf(A.siteBtn), A.siteBtn.cy, 0);
      site.on(Button.EventType.CLICK, () => {
        this.kit.sfx.play("ui");
        sys.openURL(browserDownloadUrl(pend));
        this.kit.toast(`已交给浏览器打开 ${pend.tagName} 的发布页`);
      });
    }

    // 重看新手教学:训练场列表页之外的第二处入口(首次启动会自动弹一次)
    const tut = this.kit.button(page, "重看新手教学", wOf(A.tutBtn), A.tutBtn.h, { size: 15 });
    tut.setPosition(cOf(A.tutBtn), A.tutBtn.cy, 0);
    tut.on(Button.EventType.CLICK, () => {
      this.kit.sfx.play("ui");
      this.kit.openTutorial();
    });

    this.aboutStatus = this.txt(page, this.aboutReadout(), 11, P.dim,
      A.status.left, A.status.cy, wOf(A.status));
    // 说明行跟着上面那颗键走:键不在的时候不许提它,否则就是「界面上说有个按钮,人找不到」
    this.txt(page, pend ? "应用内下载不动就点「浏览器下载」,用浏览器存安装包再装"
      : "有新版本时这里会出现「浏览器下载」;启动时也会自动检查一次",
      11, P.dim, A.hint.left, A.hint.cy, wOf(A.hint));
  }

  /**
   * 手动检查一次。三条结果都要落地成看得见的字:
   * 以前只有首页那颗按钮能查,查失败了一行 toast 一闪而过,没人知道是没网还是已经是最新。
   */
  private async checkNow(): Promise<void> {
    if (this.aboutChecking) return;      // 在途时再点不重复发请求(候选源一串,一次要等几秒)
    this.aboutChecking = true;
    this.paintAbout();
    let res: UpdateCheckResult;
    try {
      res = await UpdateService.instance.checkForUpdate();
    } catch (err: any) {
      res = { status: "failed", error: err?.message || "网络连接失败" };
    }
    this.aboutChecking = false;
    this.aboutResult = res.status === "available"
      ? `发现新版本 ${res.info?.tagName ?? ""}`
      : res.status === "up_to_date"
        ? `已是最新版本 ${APP_VERSION_NAME}`
        : `检查失败:${res.error || "未知原因"}`;
    if (res.status === "available" && res.info) {
      // 查出来有新版,这颗「浏览器下载」得当场上长出来 —— 这里已经在 await 的续体里,
      // 不在按钮的派发栈上,重建整页是安全的(同步重建才要担心拆掉正在派发的那个节点)。
      // tab 判据:等待期间人可能已经切去别的页了,那种情况只补读数,别把别人的页拆了重建。
      if (this.tab === "about" && this.page && this.page.isValid) this.buildPage();
      else this.paintAbout();
      this.kit.showUpdateDialog(res.info);
      return;
    }
    this.paintAbout();
  }

  /** 状态行一句话说清「查没查过、结果是什么、什么时候查的」 */
  private aboutReadout(): string {
    if (this.aboutChecking) return "正在检查更新…";
    const at = UpdateService.instance.lastCheckAt();
    const pend = UpdateService.instance.pendingUpdate;
    // 有挂着的新版本时优先报它:冷启动那次静默检查查出来的,这一页也得认
    const head = pend ? `发现新版本 ${pend.tagName} · 可点上方「浏览器下载」`
      : this.aboutResult || "还没查过 · 启动时会自动检查,也可以点「检查更新」";
    return at ? `${head} · 上次检查 ${fmtStamp(at)}` : head;
  }

  /** 关于页两处读数:按钮字与状态行。Label 可能已随切页销毁,全部带空值守卫 */
  private paintAbout(): void {
    if (this.aboutCheckLabel && this.aboutCheckLabel.isValid) {
      this.aboutCheckLabel.string = this.aboutChecking ? "检查中…" : "检查更新";
    }
    if (this.aboutStatus && this.aboutStatus.isValid) this.aboutStatus.string = this.aboutReadout();
  }

  /** 小节色带:整面 accent 实底 + 由亮度算出的字色,左锚摆文字 */
  private band(parent: Node, text: string, role: Role, b: { left: number; right: number; cy: number; h: number }): void {
    const w = b.right - b.left;
    const n = sectionTitle(`sec:${text}`, parent, text, role, w, b.h, 13);
    n.setPosition(b.left + w / 2, b.cy, 0);
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
    for (const b of this.modeBtns) b.tab.paint(b.mode === cur);
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
    // 震动:同样「值不同才 set」,否则 setPart → 通知 → repaint → set → onChange 自转圈
    if (this.hapticSlider) {
      const hi = hapticIndexOf(Settings.hapticLevel);
      if (this.hapticSlider.get() !== hi) this.hapticSlider.set(hi);
    }
    if (this.hapticValueLabel) this.hapticValueLabel.string = hapticLabel(Settings.hapticLevel);
    if (this.hapticStatusLabel) this.hapticStatusLabel.string = hapticStatus();
    if (this.sizeLabel) {
      // 「大小」标签跟着选中槽位变,提示玩家当前拖的是谁
      this.sizeLabel.string = this.selected === "joystick" ? "摇杆" : this.selected === "slider" ? "滑轨" : "大小";
    }
    // 关于页:检查中/检查完的读数跟着走(冷启动那次静默检查改了时间戳,这里也认)
    this.paintAbout();
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
