// ============================================================
// UI 统一控制器:主菜单 / 对战 HUD / 暂停 / 结算 的装配与状态切换。
//
// 接入方式(阶段约束:不改动 game-root):本模块顶层向 director 注册
// 「场景启动后」一次性钩子,把 UIManager 组件挂到 Canvas 上 —— 晚于
// game-root.start() 执行,所以 ui-root 天然排在触屏虚拟按键之后,
// 弹窗遮罩 + BlockInputEvents 就能盖在按键之上。
//
// 状态切换用「轮询」:每帧读 Rules.R.state,与老 DD.UI.sync(R) 同构。
// 「现在显示哪块 UI」是状态的纯函数,轮询让 UI 与 game-root 的系统键
// 处理(Esc 暂停 / R 重开)天然同步 —— 谁改的状态都无所谓。
//
// 结算桥接:game-root 在 match-over 事件里已调用一次 Career.settle()
// (会写档,调两次就是双倍奖励),但把返回值丢了。这里对 settle /
// settleDrill 做一层透传包装截获返回值,结算面板吃到的仍是 Career
// 的真实数据。对外导出的 showSettle(res) 是正式接口,后续 game-root
// 直连后可整体删除 bridgeCareerSettle()。
// ============================================================
import {
  BlockInputEvents, Button, Color, Component, director, Director,
  Font, Graphics, Label, Layers, Node, Tween, tween, UIOpacity, UITransform, Widget,
  view, _decorator,
} from "cc";
import { CFG, DRILLS } from "../core/config";
import { Settings } from "../core/settings";
import { installStorageBackend } from "../game/host";
import { Rules } from "../core/rules";
import { Career } from "../core/career";
import { Drill } from "../core/drill";
import type { DiffKey, SkillId } from "../core/types";
import type { DrillResult } from "../core/drill";
import type { SettleResult } from "../core/career";
import { Sfx } from "../game/sfx";
import { courtRenderer, CourtThemeItem } from "../render/court";
import { ARCADE, drawArcadeButton, drawArcadePanel, drawHardShadow, drawMenuCard, drawScanlines, drawSlantShadow, drawVeil, drawVignette, getDisplayFont, onDisplayFont, screenSwap, skewOf, slashWipe, textW, TOUCH_MIN } from "./ui-arcade";
import { SkillDialog } from "./skill-dialog";
import type { BtnStyle } from "./ui-arcade";
import { MainMenu } from "./main-menu";
import { Hud } from "./hud";
import { PausePanel } from "./pause-panel";
import { SettleBadge, SettlePanel, SettlePayload, SettleStat } from "./settle-panel";
import { CareerPanel } from "./career-panel";
import { DrillPanel } from "./drill-panel";
import { CampaignPanel } from "./campaign-panel";
import { CampaignManager, type StageDef } from "../core/campaign";
import { SettingsPanel } from "./settings-panel";
import { uiSlider, uiToggle } from "./widgets";
import { UpdateDialog } from "./update-dialog";
import { MatchSetupScreen, EndlessScreen } from "./mode-screen";
import type { UpdateInfo } from "../core/update-service";

const { ccclass } = _decorator;

// ---------- 调色板(P5「暗红斩劈」:红黑白主导,黄降为点缀;与 ui-arcade.ARCADE 同源) ----------
export const PAL = {
  ink: "#07070d",         // 最深底(P5 黑)
  panel: "#101018",       // 面板底(近黑)
  panelLight: "#1a1a26",  // 按钮底
  line: "#f5efe1",        // 描边基色(暖纸白,配 alpha 用)
  accent: "#ffe14d",      // 荧光黄 —— 二级点缀(金币/连击/经验条),与 CFG.colors.accent 同源
  slash: "#e60012",       // P5 主红:主按钮/横幅/强调块
  cyan: "#00f0ff",
  red: "#ff4d4d",         // 队色红(与球衣同源,勿当主红用)
  blue: "#3ea8ff",        // 队色蓝
  wood: "#c8703a",        // 暖木(球场氛围色)
  text: "#f5efe1",        // 暖纸白正文
  dim: "#8f9cbe",
  danger: "#ff6b6b",      // --bad
  good: "#7dff9e",
};

/** hex(+alpha) → cc.Color;Graphics/Label 逐帧赋值时引擎内部会拷贝,放心用临时实例 */
export function col(hex: string, alpha = 1): Color {
  const c = new Color();
  c.fromHEX(hex);
  if (alpha < 1) c.a = Math.round(alpha * 255);
  return c;
}

// ---------- 程序化 UI 构件(面板经 UiKit 引用,避免 ui 文件互相 import 成环) ----------

export interface LabelOpts {
  outline?: string;     // 描边色:大标题/大字的像素感主要靠它
  outlineW?: number;
  align?: number;       // 0 左 / 1 中 / 2 右(与 Label.HorizontalAlign 对齐)
  opacity?: number;
  /** 挂子集化标题黑体(tools/make-font-subset.py 的产物);加载完成前先按系统字体渲染 */
  disp?: boolean;
}

export function uiLabel(parent: Node, text: string, size: number, colorHex: string | Color, opts: LabelOpts = {}): Label {
  const n = new Node("label");
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform);
  n.setParent(parent);
  const l = n.addComponent(Label);
  l.string = text;
  l.fontSize = size;
  l.lineHeight = Math.round(size * 1.22);
  l.horizontalAlign = opts.align ?? 1;
  l.verticalAlign = 1;
  l.color = typeof colorHex === "string" ? col(colorHex) : colorHex;
  if (opts.outline) {
    l.enableOutline = true;
    l.outlineColor = col(opts.outline);
    l.outlineWidth = opts.outlineW ?? 2;
  }
  if (opts.disp) {
    const apply = (f: Font | null): void => {
      if (!f || !l.isValid) return;
      l.font = f;
      l.useSystemFont = false;
    };
    apply(getDisplayFont());
    if (!getDisplayFont()) onDisplayFont(apply);
  }
  if (opts.opacity != null) n.addComponent(UIOpacity).opacity = opts.opacity;
  return l;
}

export interface BtnOpts {
  bg?: string;
  bgAlpha?: number;
  fg?: string;
  size?: number;
  stroke?: string;
  strokeAlpha?: number;
  /** 街机按钮分层:acid/红面自动判为 primary(厚底 3D),其余 ghost */
  style?: BtnStyle;
  /** 斜切角度(度),默认 6;传 0 回到圆角矩形 */
  slantDeg?: number;
}

/**
 * 街机按钮:硬偏移阴影 + 厚底 3D(primary)/浮起(ghost)+ Label;
 * 按压反馈用 Button(SCALE),与老 .btn:active 的「按下去」等价。
 * 高度钳到 TOUCH_MIN:移动端拇指点准的下限,低于它的按钮一律抬到 44。
 * P5 化:默认 6° 斜切平行四边形,primary 为斩劈红面白字。
 */
export function uiButton(parent: Node, text: string, w: number, h: number, opts: BtnOpts = {}): Node {
  h = Math.max(h, TOUCH_MIN);
  const style: BtnStyle = opts.style
    ?? (opts.bg === PAL.accent || opts.bg === PAL.slash || opts.bg?.toLowerCase() === "#ffe14d" ? "primary" : "ghost");
  const slantDeg = opts.slantDeg ?? 6;
  const n = new Node(`btn:${text}`);
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform).setContentSize(w, h);
  const g = n.addComponent(Graphics);
  if (slantDeg !== 0) {
    drawSlantShadow(g, w, h, skewOf(h, slantDeg), 4, 4, 0.5);
    drawArcadeButton(g, w, h, style, 9, skewOf(h, slantDeg));
  } else {
    drawHardShadow(g, w, h, 9, 4, 4, 0.5);
    drawArcadeButton(g, w, h, style);
  }
  const fg = opts.fg ?? (style === "primary" ? "#fff5f2" : PAL.text);
  uiLabel(n, text, opts.size ?? 18, fg);
  const b = n.addComponent(Button);
  b.transition = Button.Transition.SCALE;
  b.zoomScale = 0.94;
  b.target = n;
  n.setParent(parent);
  return n;
}

export interface PanelOpts {
  r?: number;
  bg?: string;
  bgAlpha?: number;
  stroke?: string;
  strokeAlpha?: number;
  /** 关掉硬偏移阴影(嵌在小卡片里时用) */
  noShadow?: boolean;
  /** 面板上叠扫描线氛围 */
  scan?: boolean;
  /** 面板整体不透明度:默认 0.93,留一点球场在身后 */
  alpha?: number;
  /** 斜切角度(度),默认 3(轻微斜切的 P5 衬纸感);传 0 回到圆角矩形 */
  slantDeg?: number;
}

/** 街机面板:硬偏移阴影 + 渐变底 + 描边 + 内高光;P5 化后默认 3° 斜切 */
export function uiPanel(parent: Node, w: number, h: number, opts: PanelOpts = {}): Graphics {
  const n = new Node("panel");
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform).setContentSize(w, h);
  const g = n.addComponent(Graphics);
  const slantDeg = opts.slantDeg ?? 3;
  if (slantDeg !== 0) {
    const skew = skewOf(h, slantDeg);
    if (!opts.noShadow) drawSlantShadow(g, w, h, skew, 6, 6, 0.45);
    drawArcadePanel(g, w, h, opts.r ?? 14, opts.alpha ?? 0.93, skew);
  } else {
    if (!opts.noShadow) drawHardShadow(g, w, h, opts.r ?? 14, 6, 6, 0.45);
    drawArcadePanel(g, w, h, opts.r ?? 14, opts.alpha ?? 0.93);
  }
  if (opts.scan) drawScanlines(g, w, h, 0.05);
  n.setParent(parent);
  return g;
}

/**
 * 全屏暗遮罩 + BlockInputEvents:弹窗层级压过虚拟按键,且触摸不再穿透到世界。
 * 两个 alpha = 老 .screen 的 radial-gradient(中心 centerA → 四周 edgeA):
 * 中心透一点,球场才看得见;外围压暗,居中的字才站得住。
 */
export function uiDim(parent: Node, centerA = 0.52, edgeA = 0.82): Node {
  const n = new Node("dim");
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform).setContentSize(CFG.world.w, CFG.world.h);
  const w = n.addComponent(Widget);
  w.isAlignTop = true; w.top = 0;
  w.isAlignBottom = true; w.bottom = 0;
  w.isAlignLeft = true; w.left = 0;
  w.isAlignRight = true; w.right = 0;
  const g = n.addComponent(Graphics);
  // 底:整片铺 centerA 的墨蓝(超宽/带鱼屏也不留亮边)
  g.fillColor = col(PAL.ink, centerA);
  g.rect(-2000, -1000, 4000, 2000);
  g.fill();
  // 渐变:可见区域内再往四周叠加,叠加完正好收到 edgeA(增量要按「还剩多少不透明」折算)
  const vs = view.getVisibleSize();
  drawVeil(g, Math.max(CFG.world.w, vs.width), Math.max(CFG.world.h, vs.height),
    0, Math.max(0, (edgeA - centerA) / (1 - Math.min(0.999, centerA))));
  n.addComponent(BlockInputEvents);
  n.setParent(parent);
  return n;
}

/** 全屏氛围层:扫描线 + 暗角(菜单/结算等整屏场景用,压在遮罩上、内容下) */
export function uiAtmosphere(parent: Node): Node {
  const n = new Node("atmosphere");
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform).setContentSize(CFG.world.w, CFG.world.h);
  const w = n.addComponent(Widget);
  w.isAlignTop = true; w.top = 0;
  w.isAlignBottom = true; w.bottom = 0;
  w.isAlignLeft = true; w.left = 0;
  w.isAlignRight = true; w.right = 0;
  // 这层是「街机厅的味儿」不是「再蒙一层黑」:强度必须远低于遮罩,
  // 否则菜单背景直接被糊成纯黑(球场切换看不出来)。
  const g = n.addComponent(Graphics);
  drawScanlines(g, CFG.world.w, CFG.world.h, 0.05);
  drawVignette(g, CFG.world.w, CFG.world.h, 6, 0.09);
  n.setParent(parent);
  return n;
}

/** 全屏自适应容器:Widget 四边对齐,真机上 fit-height 拉宽后角落锚点依然正确 */
export function uiRoot(parent: Node, name: string): Node {
  const n = new Node(name);
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform).setContentSize(CFG.world.w, CFG.world.h);
  const w = n.addComponent(Widget);
  w.isAlignTop = true; w.top = 0;
  w.isAlignBottom = true; w.bottom = 0;
  w.isAlignLeft = true; w.left = 0;
  w.isAlignRight = true; w.right = 0;
  n.setParent(parent);
  return n;
}

/**
 * 轻提示底块的宽度:按文案估出来(见 ui-arcade.textW)。
 * 固定 340 时长句会溢出框外,变成飘在场上的一串字。
 */
function toastPlateWidth(s: string, size: number): number {
  return Math.min(700, Math.max(210, textW(s, size) + 52));
}

// ---------- 面板契约:四个面板只依赖这张表,不反向 import ui-manager ----------

export interface UiKit {
  pal: typeof PAL;
  sfx: Sfx;
  label: typeof uiLabel;
  button: typeof uiButton;
  panel: typeof uiPanel;
  dim: typeof uiDim;
  root: typeof uiRoot;
  /** 扫描线 + 暗角氛围层(整屏弹窗用) */
  atmosphere: typeof uiAtmosphere;
  /** 水平滑杆(音量、按键大小) */
  slider: typeof uiSlider;
  /** 一行式开关(整行即按钮) */
  toggle: typeof uiToggle;
  toast(msg: string): void;
  toggleMute(): boolean;
  readonly muted: boolean;
  startMatch(diff: DiffKey): void;
  startEndlessMatch(diff: DiffKey): void;
  startDrill(id: string): void;
  restartCurrent(): void;
  quitToMenu(): void;
  openCareer(): void;
  openDrills(): void;
  openCampaign(): void;
  startCampaignStage(stage: StageDef): void;
  /** 对练屏(模式屏:三档难度 + 球馆 + 技能;主菜单大色块点入,screenSwap 转场) */
  openMatchSetup(): void;
  /** 无限练习屏(模式屏:三档难度;由旧弹窗改造,同样非弹窗直切) */
  openEndless(): void;
  /** 技能配置弹窗 (赛前选择主动技能) */
  openSkillDialog(onEquip?: (id: SkillId) => void): void;
  /** 设置页(主菜单与暂停页都进得来;从暂停页进,关完回暂停页) */
  openSettings(): void;
  cycleCourtTheme(): string;
  /** 球馆清单(老 ui.js courtPicker 的数据源) */
  courtThemes(): readonly CourtThemeItem[];
  /** 切换球馆(点击 courtPicker tab) */
  setCourtTheme(id: string): boolean;
  /** 当前球馆 */
  getCourtTheme(): CourtThemeItem;
  showUpdateDialog(info: UpdateInfo): void;
}

// ---------- 结算截获(game-root 桥接) ----------

interface SettleCapture {
  kind: "match" | "drill";
  res: SettleResult | null;
  drill?: DrillResult;
  /** 结算前的等级/经验快照:经验条要从旧值滚到新值 */
  before: { level: number; exp: number };
}

@ccclass("UIManager")
export class UIManager extends Component {
  private sfx = new Sfx();
  private kit!: UiKit;
  private menu!: MainMenu;
  private hud!: Hud;
  private pausePanel!: PausePanel;
  private settlePanel!: SettlePanel;
  private updateDialog!: UpdateDialog;
  private matchSetup!: MatchSetupScreen;
  private endlessScreen!: EndlessScreen;
  private skillDialog!: SkillDialog;
  private campaignPanel!: CampaignPanel;
  private careerPanel: CareerPanel | null = null;
  private drillPanel: DrillPanel | null = null;
  private settingsPanel: SettingsPanel | null = null;
  private capture: SettleCapture | null = null;
  private prevSt = "";
  private toastNode: Node | null = null;
  private toastLabel: Label | null = null;
  private toastOp: UIOpacity | null = null;

  start(): void {
    // 阶段 2 的 game-root 直开一局「单人·普通」;UI 层接管后本次启动必须先落菜单
    const coldBoot = !booted;
    if (coldBoot) {
      booted = true;
      Rules.R.state = "MENU";
    }
    // 下掉阶段 2 的临时 HUD(两个 Label 按 y 值命名,前缀识别,不依赖具体数字)
    for (const c of this.node.children) {
      if (c.name.indexOf("hud-") === 0) c.active = false;
    }

    // 存档后端与设置读盘:UIManager 可能晚于 GameRoot 挂载(编辑器直挂/热重载),
    // 两处各调一次,installStorageBackend 与 Settings.init 都是幂等的。
    installStorageBackend();
    Settings.init();

    this.buildKit();
    const root = uiRoot(this.node, "ui-root");
    // 兄弟顺序即渲染顺序(后加者在上):HUD < 菜单 < 暂停 < 结算
    this.hud = new Hud(root, this.kit);
    this.menu = new MainMenu(root, this.kit);
    // 模式屏(对练/无限练习):渲染序压在菜单上、又低于暂停/结算 —— 菜单层的「第二页」
    this.matchSetup = new MatchSetupScreen(root, this.kit,
      () => screenSwap(this.node, this.matchSetup.root, () => this.menu.show()));
    this.endlessScreen = new EndlessScreen(root, this.kit,
      () => screenSwap(this.node, this.endlessScreen.root, () => this.menu.show()));
    this.pausePanel = new PausePanel(root, this.kit);
    this.settlePanel = new SettlePanel(root, this.kit);
    this.updateDialog = new UpdateDialog(root, this.kit);
    this.skillDialog = new SkillDialog(root, this.kit);
    this.campaignPanel = new CampaignPanel(root, this.kit);
    this.bridgeCareerSettle();

    // UI 音复用同一批烘焙 WAV(resources 缓存共享)。
    // 只 load 这一次:重复调用会往节点上再挂一个 AudioSource。
    this.sfx.load(this.node);
  }

  // ---------- 对外统一接口(正式契约) ----------
  // 当前流程由状态轮询驱动,这四个方法是给 game-root 后续直连用的薄封装:
  // 内部仍然只改状态/复用既有链路,保证「谁调」都走同一条路。

  showMenu(): void {
    Drill.reset();
    Rules.R.state = "MENU";
  }

  /** 仅在比赛进行态有意义;其余状态是 no-op(HUD 显隐由轮询统一管) */
  showHud(): void {
    this.hud.setPlaying(true);
  }

  showPause(): void {
    Rules.pause();                       // frozen 态下 Rules 自己会拒绝
  }

  /** 外部直喂结算数据的入口(res 非 null 时带奖励卡);与桥接共用同一清理语义 */
  showSettle(res: SettleResult | null): void {
    const R = Rules.R;
    this.capture = null;
    this.settlePanel.show({
      kind: "match",
      res,
      drill: null,
      before: null,
      scores: [R.scores[0], R.scores[1]],
      won: R.winner === "left",
      badge: this.matchBadge(),
      stats: this.statRows("match", null),
      campaign: null,
    });
  }

  /**
   * 荣誉称号(老 ui.js evaluateTitle):按终局战绩挑一个头衔。
   * emoji 换成 BMP 安全符号(原生平台 FreeType 无彩色 emoji 字体)。
   */
  private matchBadge(): SettleBadge | null {
    const R = Rules.R;
    if (R.mode === "drill") return null;
    const a = Rules.statsOf("left");
    const youWon = R.winner === "left";
    if (R.mode === "2p") {
      const won = R.winner !== null;
      if (R.longestRally >= 10) return { title: `∞ 相持之壁 · ${R.longestRally} 拍对轰`, color: "#7fd0ff" };
      if (won && Math.abs(R.scores[0] - R.scores[1]) >= 6) return { title: "★ 决胜制霸 · 一边倒", color: "#ffe14d" };
      return { title: "默契对抗 · 友谊第一", color: "#9aa4c7" };
    }
    if (youWon && a.whiffs === 0 && a.hits >= 12) return { title: "★ 完美掌控 · 零失误制霸", color: "#ffe14d" };
    if (a.smashes >= 5) return { title: "重炮轰炸 · 暴力下压", color: "#ff6a1f" };
    if (a.perfects >= 3) return { title: "✦ 神级时机 · 技惊四座", color: "#00f0ff" };
    if (a.sweetRate >= 60 && a.hits >= 10) return { title: "◎ 极致精准 · 甜区大师", color: "#ffe14d" };
    if (R.longestRally >= 10) return { title: `∞ 相持之壁 · ${R.longestRally} 拍对轰`, color: "#7fd0ff" };
    if (youWon) return { title: "★ 决胜制霸 · 拿下比赛", color: "#ffe14d" };
    if (a.hits >= 8 && Math.abs(R.scores[0] - R.scores[1]) <= 2) return { title: "顽强拼搏 · 虽败犹荣", color: "#9aa4c7" };
    return { title: "初出茅庐 · 再战一场", color: "#9aa4c7" };
  }

  /**
   * 战报六格(老 ui.js result() 的 rows):比赛看全场,训练看这一份账。
   * 数字全从 Rules/Drill 的真实统计来,面板只负责摆。
   */
  private statRows(kind: "match" | "drill", drill: DrillResult | null): SettleStat[] {
    const R = Rules.R;
    if (kind === "drill" && drill) {
      return [
        { v: `${drill.valid}/${drill.goal}`, k: "有效拍数", tone: "gold" },
        { v: `${drill.perfect}`, k: "完美击球", tone: "cyan" },
        { v: `${drill.sweet}`, k: "甜区命中", tone: "gold" },
        { v: `${Math.round(drill.avgQ * 100)}%`, k: "平均质量", tone: "hot" },
        { v: `${drill.attempts}`, k: "喂球回合" },
        { v: `${drill.plays}`, k: "你的击球" },
      ];
    }
    const a = Rules.statsOf("left"), b = Rules.statsOf("right");
    return [
      { v: `${R.longestRally}`, k: "最长回合 · 拍", tone: "gold" },
      { v: `${a.smashes}`, k: "你的扣杀", tone: "hot" },
      { v: `${a.sweetRate}%`, k: "甜区命中率", tone: "gold" },
      { v: `${a.perfects}`, k: "完美击球", tone: "cyan" },
      { v: `${a.hits + b.hits}`, k: "全场击球" },
      { v: `${a.whiffs}`, k: "失误挥空" },
    ];
  }

  // ---------- 状态轮询 ----------

  update(dt: number): void {
    const R = Rules.R;
    if (R.state !== this.prevSt) {
      this.onState(R.state);
      this.prevSt = R.state;
    }
    this.hud.sync(R);
    this.settlePanel.tick(dt);
    this.careerPanel?.update(dt);
    this.drillPanel?.update(dt);
  }

  private onState(st: string): void {
    // 状态一变就先收设置页:它不属于任何状态(是浮在状态上的临时面板),
    // 逐个分支去 hide 迟早漏一个 —— 漏了的后果是面板浮在实时对局上,
    // 连同编辑器那份预览按键一起叠在球场上。
    // openSettings() 期间状态不变,所以这里不会把刚打开的面板自己关掉。
    this.settingsPanel?.hide();
    this.matchSetup?.hide();
    this.endlessScreen?.hide();
    this.skillDialog?.hide();
    switch (st) {
      case "MENU": {
        this.pausePanel.hide();
        this.settlePanel.hide();
        this.menu.show();
        this.hud.setPlaying(false);
        break;
      }
      case "PAUSED":
        this.menu.hide();
        this.careerPanel?.hide();
        this.drillPanel?.hide();
        this.campaignPanel?.hide();
        this.hud.setPlaying(true);       // 暗遮罩后仍能看见终局前的比分牌
        this.pausePanel.show();
        break;
      case "OVER":
        this.menu.hide();
        this.careerPanel?.hide();
        this.drillPanel?.hide();
        this.campaignPanel?.hide();
        this.hud.setPlaying(true);
        this.settlePanel.show(this.takeSettle("match"));
        break;
      case "DRILLDONE":
        this.menu.hide();
        this.careerPanel?.hide();
        this.drillPanel?.hide();
        this.campaignPanel?.hide();
        this.hud.setPlaying(true);
        this.settlePanel.show(this.takeSettle("drill"));
        break;
      default:                           // SERVE / RALLY / POINT:比赛进行态
        this.menu.hide();
        this.careerPanel?.hide();
        this.drillPanel?.hide();
        this.campaignPanel?.hide();
        this.pausePanel.hide();
        this.settlePanel.hide();
        this.hud.setPlaying(true);
        break;
    }
  }

  /** 状态切换沿只触发一次结算弹窗;拿走截获数据后即清 */
  private takeSettle(kind: "match" | "drill"): SettlePayload {
    const R = Rules.R;
    const cap = this.capture && this.capture.kind === kind ? this.capture : null;
    this.capture = null;
    if (kind === "match") {
      const isCamp = R.mode === "campaign" && !!R.activeStage;
      const stage = R.activeStage;
      const won = R.winner === "left";
      let badge = this.matchBadge();
      // 闯关结算要知道「下一关是谁」:按钮文案、点了开哪一关都从这儿出。
      // 判据用「本关的编号 +1」而不是「全局第一个没通的」—— 回头重打第 1 关时,
      // 后者会报第 4 关,那是大厅的「继续闯关」该说的话,不是这颗钮的。
      let campaign: SettlePayload["campaign"] = null;
      if (isCamp && stage) {
        const after = CampaignManager.getStageByNo(stage.stageNo + 1);
        campaign = {
          stageNo: stage.stageNo,
          stageTitle: stage.title,
          next: won && after && CampaignManager.isStageUnlocked(after.stageNo) ? after : null,
        };
        if (won) {
          badge = {
            title: `★ 关卡突破 · ${stage.title} (${stage.badge})`,
            color: PAL.accent,
          };
        } else {
          badge = { title: `挑战失败 · ${stage.title}`, color: PAL.dim };
        }
      }
      return {
        kind,
        res: cap ? cap.res : null,
        drill: null,
        before: cap ? cap.before : null,
        scores: [R.scores[0], R.scores[1]],
        won,
        badge,
        stats: this.statRows("match", null),
        campaign,
      };
    }
    const drill = cap && cap.drill ? cap.drill : (Drill.cur() ? Drill.result() : null);
    return {
      kind,
      res: cap ? cap.res : null,
      drill,
      before: cap ? cap.before : null,
      scores: [0, 0],
      won: !!drill && drill.stars >= 1,
      badge: null,
      stats: this.statRows("drill", drill),
    };
  }

  // ---------- 动作(kit 回调) ----------

  // 开赛三连都用斜切转场包住:状态切换放在黑带盖满屏的中点,切换过程观众看不到
  private doStartMatch(diff: DiffKey): void {
    slashWipe(this.node, () => {
      Rules.newMatch("1p", diff);
      Career.applyToMatch();               // 皮肤跟「你」走,换局也要重挂
      this.sfx.play("whistle");
    });
  }

  private doStartEndlessMatch(diff: DiffKey): void {
    slashWipe(this.node, () => {
      Rules.newMatch("endless", diff);
      Career.applyToMatch();
      this.sfx.play("whistle");
    });
  }

  private doStartDrill(id: string): void {
    slashWipe(this.node, () => {
      Rules.newMatch("drill", "normal");
      Drill.begin(id);                     // 发球权焊死在喂球机一侧
      this.sfx.play("whistle");
    });
  }

  private doStartCampaign(stage: StageDef): void {
    slashWipe(this.node, () => {
      this.kit.setCourtTheme(stage.court);
      Rules.startCampaign(stage);
      Career.applyToMatch();
      this.sfx.play("whistle");
    });
  }

  private doRestart(): void {
    this.sfx.play("ui");
    if (Rules.R.mode === "drill") {
      this.doStartDrill(Drill.cur()?.id || DRILLS[0].id);
    } else if (Rules.R.mode === "endless") {
      this.doStartEndlessMatch(Rules.R.diff);
    } else if (Rules.R.mode === "campaign" && Rules.R.activeStage) {
      this.doStartCampaign(Rules.R.activeStage);
    } else {
      Rules.restart();
      Career.applyToMatch();
    }
  }

  private doQuit(): void {
    this.sfx.play("back");
    Drill.reset();                       // 训练进行态不跨局泄漏(账本/关卡都清)
    Rules.resetModifiers();              // 关卡物理与球员修饰不跨局泄漏
    slashWipe(this.node, () => {
      Rules.R.state = "MENU";            // frozen 态,世界自动停;老 game 同款直改
    });
  }

  // ---------- 全局静音:一个钮管音效/音乐两条总线,真值只在 Settings ----------
  //
  // 这里原本是 `this.node.getComponents(AudioSource)` 逐个 set mute ——
  // 那个写法是非递归的,而 BGM 的 6 个 stem 是 BgmManager 挂在**子节点**上的,
  // 结果菜单/暂停页的「音效」开关从来没静音过背景音乐(只有 KeyM 走 bgm.setMute 才行)。
  // 现在音效/音乐各自读 Settings 的总线开关(Sfx / BgmManager 内部判定),
  // UI 不再伸手进音频节点树 —— 别把 getComponents 扫描加回来。

  private toggleMute(): boolean {
    return Settings.toggleAllMute();
  }

  // ---------- 结算桥(见文件头注释) ----------

  private bridgeCareerSettle(): void {
    const origSettle = Career.settle;
    Career.settle = (arg) => {
      const p = Career.profile();
      const before = { level: p.level, exp: p.exp };
      const res = origSettle(arg);
      this.capture = { kind: "match", res, before };
      return res;
    };
    const origSettleDrill = Career.settleDrill;
    Career.settleDrill = (res) => {
      const p = Career.profile();
      const before = { level: p.level, exp: p.exp };
      const r = origSettleDrill(res);
      this.capture = { kind: "drill", res: r, drill: res, before };
      return r;
    };
  }

  // ---------- 顶部轻提示(商店/球场等未移植入口的占位反馈) ----------
  //
  // 它挂在 Canvas 上、浮在所有面板之上,身后可能是亮球馆也可能是实时球场,
  // 所以底块必须自己站得住。

  private toast(msg: string): void {
    if (!this.toastNode) {
      const n = new Node("toast");
      n.layer = Layers.Enum.UI_2D;
      n.addComponent(UITransform).setContentSize(340, 42);
      n.setPosition(0, 150, 0);
      n.addComponent(Graphics);
      this.toastLabel = uiLabel(n, "", 15, PAL.text);
      n.addComponent(UIOpacity);
      n.setParent(this.node);
      this.toastNode = n;
      this.toastOp = n.getComponent(UIOpacity);
    }
    const w = toastPlateWidth(msg, 15);
    const g = this.toastNode.getComponent(Graphics)!;
    this.toastNode.getComponent(UITransform)!.setContentSize(w, 42);
    g.clear();
    drawHardShadow(g, w, 42, 9, 4, 4, 0.5);
    drawMenuCard(g, w, 42, 9, { accent: ARCADE.acid, tint: 0.05, bar: 5, edge: 4, alpha: 0.95 });
    this.toastLabel!.string = msg;
    this.toastNode.active = true;
    const op = this.toastOp!;
    Tween.stopAllByTarget(op);
    op.opacity = 0;
    tween(op)
      .to(0.12, { opacity: 255 })
      .delay(1.4)
      .to(0.3, { opacity: 0 })
      .call(() => { this.toastNode!.active = false; })
      .start();
  }

  private openCareer(): void {
    if (!this.careerPanel) {
      this.careerPanel = this.node.addComponent(CareerPanel);
    }
    this.menu.hide();
    this.careerPanel.show(this.node, () => {
      this.careerPanel?.hide();
      this.menu.show();
    });
  }

  private openDrills(): void {
    if (!this.drillPanel) {
      this.drillPanel = this.node.addComponent(DrillPanel);
    }
    this.menu.hide();
    this.drillPanel.show(
      this.node,
      (drill) => {
        this.drillPanel?.hide();
        this.doStartDrill(drill.id);
      },
      () => {
        this.drillPanel?.hide();
        this.menu.show();
      },
    );
  }

  /**
   * 闯关大厅和 career / drills 一样是「浮在 MENU 之上的一屏」:Rules 状态全程不动,
   * 所以关完的归途必须命令式给回来。少这一句的后果不是难看,是**卡死** ——
   * 菜单被 hide 掉、状态又没有变化沿,onState 永远不会再跑,屏幕上只剩一座空球场
   * (用户报的「进入闯关模式后什么按钮都看不到」)。
   */
  private openCampaign(): void {
    this.menu.hide();
    this.campaignPanel.show(() => {
      this.campaignPanel.hide();
      this.menu.show();
    });
  }

  /**
   * 设置页。从暂停页进来时关完要回暂停页,不能漏进主菜单 ——
   * onState 只在状态**变化沿**触发,而 PAUSED → (开着设置) → PAUSED 根本没有变化沿,
   * 所以恢复只能命令式做,和 openCareer 同一个套路。
   */
  private openSettings(): void {
    if (!this.settingsPanel) {
      this.settingsPanel = this.node.addComponent(SettingsPanel);
    }
    const fromPause = Rules.R.state === "PAUSED";
    if (!fromPause) this.menu.hide();
    else this.pausePanel.hide();
    this.settingsPanel.show(this.node, this.kit, () => {
      this.settingsPanel?.hide();
      if (fromPause) this.pausePanel.show();
      else this.menu.show();
    });
  }

  private cycleCourtTheme(): string {
    const next = courtRenderer.cycleTheme();
    return next.name;
  }

  private courtThemes(): readonly CourtThemeItem[] {
    return CFG.courts as CourtThemeItem[];
  }

  private setCourtTheme(id: string): boolean {
    return courtRenderer.setTheme(id);
  }

  private getCourtTheme(): CourtThemeItem {
    return courtRenderer.getTheme();
  }

  // ---------- 装配 kit ----------

  private buildKit(): void {
    this.kit = {
      pal: PAL,
      sfx: this.sfx,
      label: uiLabel,
      button: uiButton,
      panel: uiPanel,
      dim: uiDim,
      root: uiRoot,
      atmosphere: uiAtmosphere,
      slider: uiSlider,
      toggle: uiToggle,
      toast: (m) => this.toast(m),
      toggleMute: () => this.toggleMute(),
      get muted() { return Settings.allMuted; },
      startMatch: (d) => this.doStartMatch(d),
      startEndlessMatch: (d) => this.doStartEndlessMatch(d),
      startDrill: (id) => this.doStartDrill(id),
      restartCurrent: () => this.doRestart(),
      quitToMenu: () => this.doQuit(),
      openCareer: () => this.openCareer(),
      openDrills: () => this.openDrills(),
      openCampaign: () => this.openCampaign(),
      startCampaignStage: (stage) => this.doStartCampaign(stage),
      openMatchSetup: () => screenSwap(this.node, this.menu.root, () => this.matchSetup.show()),
      openEndless: () => screenSwap(this.node, this.menu.root, () => this.endlessScreen.show()),
      openSkillDialog: (onEquip) => this.skillDialog.show(onEquip),
      openSettings: () => this.openSettings(),
      cycleCourtTheme: () => this.cycleCourtTheme(),
      courtThemes: () => this.courtThemes(),
      setCourtTheme: (id) => this.setCourtTheme(id),
      getCourtTheme: () => this.getCourtTheme(),
      showUpdateDialog: (info) => this.updateDialog.show(info),
    };
  }
}

// 「本次场景启动后先落菜单」只生效一次:install 复位,热重载/重开场景也正确
let booted = false;

function install(): void {
  const canvas = director.getScene() && director.getScene()!.getChildByName("Canvas");
  if (!canvas || canvas.getComponent(UIManager)) return;
  booted = false;
  canvas.addComponent(UIManager);
}

// 模块加载即注册:场景启动(game-root.start 之后)自动挂载,game-root 零改动
director.once(Director.EVENT_AFTER_SCENE_LAUNCH, install);
// 兜底:模块加载晚于场景启动(编辑器手动挂载 / 热重载)时立即装
const sceneNow = director.getScene();
if (sceneNow && sceneNow.getChildByName("Canvas")) install();
