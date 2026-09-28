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
  AudioSource, BlockInputEvents, Button, Color, Component, director, Director,
  Graphics, Label, Layers, Node, Tween, tween, UIOpacity, UITransform, Widget,
  _decorator,
} from "cc";
import { CFG, DRILLS } from "../core/config";
import { load, save } from "../core/utils";
import { Rules } from "../core/rules";
import { Career } from "../core/career";
import { Drill } from "../core/drill";
import type { DiffKey } from "../core/types";
import type { DrillResult } from "../core/drill";
import type { SettleResult } from "../core/career";
import { Sfx } from "../game/sfx";
import { courtRenderer } from "../render/court";
import { MainMenu } from "./main-menu";
import { Hud } from "./hud";
import { PausePanel } from "./pause-panel";
import { SettlePanel, SettlePayload } from "./settle-panel";
import { CareerPanel } from "./career-panel";
import { DrillPanel } from "./drill-panel";
import { UpdateDialog } from "./update-dialog";
import type { UpdateInfo } from "../core/update-service";

const { ccclass } = _decorator;

// ---------- 调色板(老 ui.css 的暗色霓虹语言) ----------
export const PAL = {
  ink: "#0a0d18",         // 最深底
  panel: "#141a2e",       // 面板底
  panelLight: "#1e2745",  // 按钮底
  line: "#dfe6ff",        // 描边基色(配 alpha 用)
  accent: "#ffe14d",      // 荧光黄 —— 与 CFG.colors.accent 同源
  cyan: "#00f0ff",
  red: "#ff4d4d",
  blue: "#3ea8ff",
  text: "#f0f4ff",
  dim: "#8f9cbe",
  danger: "#ff6b6b",
  good: "#6fe08a",
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
}

export function uiLabel(parent: Node, text: string, size: number, colorHex: string, opts: LabelOpts = {}): Label {
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
  l.color = col(colorHex);
  if (opts.outline) {
    l.enableOutline = true;
    l.outlineColor = col(opts.outline);
    l.outlineWidth = opts.outlineW ?? 2;
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
}

/** 圆角按钮:Graphics 底 + Label + Button(SCALE 按压反馈);点击事件由调用方注册 */
export function uiButton(parent: Node, text: string, w: number, h: number, opts: BtnOpts = {}): Node {
  const n = new Node(`btn:${text}`);
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform).setContentSize(w, h);
  const g = n.addComponent(Graphics);
  g.fillColor = col(opts.bg ?? PAL.panelLight, opts.bgAlpha ?? 1);
  g.strokeColor = col(opts.stroke ?? PAL.line, opts.strokeAlpha ?? 0.3);
  g.lineWidth = 2;
  g.roundRect(-w / 2, -h / 2, w, h, Math.min(h * 0.3, 14));
  g.fill();
  g.stroke();
  uiLabel(n, text, opts.size ?? 18, opts.fg ?? PAL.text, opts.stroke ? { outline: opts.stroke } : {});
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
}

/** 圆角面板,返回 Graphics 便于调用方取 .node 定位/挂子节点 */
export function uiPanel(parent: Node, w: number, h: number, opts: PanelOpts = {}): Graphics {
  const n = new Node("panel");
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform).setContentSize(w, h);
  const g = n.addComponent(Graphics);
  g.fillColor = col(opts.bg ?? PAL.panel, opts.bgAlpha ?? 0.97);
  g.strokeColor = col(opts.stroke ?? PAL.line, opts.strokeAlpha ?? 0.18);
  g.lineWidth = 2;
  g.roundRect(-w / 2, -h / 2, w, h, opts.r ?? 14);
  g.fill();
  g.stroke();
  n.setParent(parent);
  return g;
}

/** 全屏暗遮罩 + BlockInputEvents:弹窗层级压过虚拟按键,且触摸不再穿透到世界 */
export function uiDim(parent: Node, alpha: number): Node {
  const n = new Node("dim");
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform).setContentSize(CFG.world.w, CFG.world.h);
  const w = n.addComponent(Widget);
  w.isAlignTop = true; w.top = 0;
  w.isAlignBottom = true; w.bottom = 0;
  w.isAlignLeft = true; w.left = 0;
  w.isAlignRight = true; w.right = 0;
  const g = n.addComponent(Graphics);
  g.fillColor = col(PAL.ink, alpha);
  g.rect(-CFG.world.w / 2, -CFG.world.h / 2, CFG.world.w, CFG.world.h);
  g.fill();
  n.addComponent(BlockInputEvents);
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

// ---------- 面板契约:四个面板只依赖这张表,不反向 import ui-manager ----------

export interface UiKit {
  pal: typeof PAL;
  sfx: Sfx;
  label: typeof uiLabel;
  button: typeof uiButton;
  panel: typeof uiPanel;
  dim: typeof uiDim;
  root: typeof uiRoot;
  toast(msg: string): void;
  toggleMute(): boolean;
  readonly muted: boolean;
  startMatch(diff: DiffKey): void;
  startDrill(id: string): void;
  restartCurrent(): void;
  quitToMenu(): void;
  openCareer(): void;
  openDrills(): void;
  cycleCourtTheme(): string;
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
  private careerPanel: CareerPanel | null = null;
  private drillPanel: DrillPanel | null = null;
  private capture: SettleCapture | null = null;
  private prevSt = "";
  private toastNode: Node | null = null;
  private toastLabel: Label | null = null;
  private toastOp: UIOpacity | null = null;

  start(): void {
    // 阶段 2 的 game-root 直开一局「单人·普通」;UI 层接管后本次启动必须先落菜单
    if (!booted) {
      booted = true;
      Rules.R.state = "MENU";
    }
    // 下掉阶段 2 的临时 HUD(两个 Label 按 y 值命名,前缀识别,不依赖具体数字)
    for (const c of this.node.children) {
      if (c.name.indexOf("hud-") === 0) c.active = false;
    }

    this.sfx.load(this.node);          // UI 音复用同一批烘焙 WAV(resources 缓存共享)
    this.applyMute(load("muted", false));

    this.buildKit();
    const root = uiRoot(this.node, "ui-root");
    // 兄弟顺序即渲染顺序(后加者在上):HUD < 菜单 < 暂停 < 结算
    this.hud = new Hud(root, this.kit);
    this.menu = new MainMenu(root, this.kit);
    this.pausePanel = new PausePanel(root, this.kit);
    this.settlePanel = new SettlePanel(root, this.kit);
    this.updateDialog = new UpdateDialog(root, this.kit);
    this.bridgeCareerSettle();
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
    });
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
    switch (st) {
      case "MENU":
        this.pausePanel.root.active = false;
        this.settlePanel.hide();
        this.menu.show();
        this.hud.setPlaying(false);
        break;
      case "PAUSED":
        this.menu.hide();
        this.careerPanel?.hide();
        this.drillPanel?.hide();
        this.hud.setPlaying(true);       // 暗遮罩后仍能看见终局前的比分牌
        this.pausePanel.show();
        break;
      case "OVER":
        this.menu.hide();
        this.careerPanel?.hide();
        this.drillPanel?.hide();
        this.hud.setPlaying(true);
        this.settlePanel.show(this.takeSettle("match"));
        break;
      case "DRILLDONE":
        this.menu.hide();
        this.careerPanel?.hide();
        this.drillPanel?.hide();
        this.hud.setPlaying(true);
        this.settlePanel.show(this.takeSettle("drill"));
        break;
      default:                           // SERVE / RALLY / POINT:比赛进行态
        this.menu.hide();
        this.careerPanel?.hide();
        this.drillPanel?.hide();
        this.pausePanel.root.active = false;
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
      return {
        kind,
        res: cap ? cap.res : null,
        drill: null,
        before: cap ? cap.before : null,
        scores: [R.scores[0], R.scores[1]],
        won: R.winner === "left",
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
    };
  }

  // ---------- 动作(kit 回调) ----------

  private doStartMatch(diff: DiffKey): void {
    Rules.newMatch("1p", diff);
    Career.applyToMatch();               // 皮肤跟「你」走,换局也要重挂
    this.sfx.play("whistle");
  }

  private doStartDrill(id: string): void {
    Rules.newMatch("drill", "normal");
    Drill.begin(id);                     // 发球权焊死在喂球机一侧
    this.sfx.play("whistle");
  }

  private doRestart(): void {
    this.sfx.play("ui");
    if (Rules.R.mode === "drill") {
      this.doStartDrill(Drill.cur()?.id || DRILLS[0].id);
    } else {
      Rules.restart();
      Career.applyToMatch();
    }
  }

  private doQuit(): void {
    this.sfx.play("back");
    Drill.reset();                       // 训练进行态不跨局泄漏(账本/关卡都清)
    Rules.R.state = "MENU";              // frozen 态,世界自动停;老 game 同款直改
  }

  // ---------- 音效开关:UI 音 + game-root 的比赛音一起静才叫全局开关 ----------

  private applyMute(v: boolean): void {
    save("muted", v);
    this.sfx.setMuted(v);
    // game-root 的 Sfx 把 AudioSource 加在 Canvas(本节点)上;两份实例一起切
    for (const src of this.node.getComponents(AudioSource)) src.mute = v;
  }

  private toggleMute(): boolean {
    const v = !load("muted", false);
    this.applyMute(v);
    return v;
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

  private toast(msg: string): void {
    if (!this.toastNode) {
      const n = new Node("toast");
      n.layer = Layers.Enum.UI_2D;
      n.addComponent(UITransform).setContentSize(340, 42);
      n.setPosition(0, 150, 0);
      const g = n.addComponent(Graphics);
      g.fillColor = col(PAL.panel, 0.95);
      g.strokeColor = col(PAL.accent, 0.5);
      g.lineWidth = 2;
      g.roundRect(-170, -21, 340, 42, 21);
      g.fill();
      g.stroke();
      this.toastLabel = uiLabel(n, "", 15, PAL.text);
      n.addComponent(UIOpacity);
      n.setParent(this.node);
      this.toastNode = n;
      this.toastOp = n.getComponent(UIOpacity);
    }
    this.toastLabel!.string = msg;
    this.toastNode!.active = true;
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

  private cycleCourtTheme(): string {
    const next = courtRenderer.cycleTheme();
    return next.name;
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
      toast: (m) => this.toast(m),
      toggleMute: () => this.toggleMute(),
      get muted() { return !!load("muted", false); },
      startMatch: (d) => this.doStartMatch(d),
      startDrill: (id) => this.doStartDrill(id),
      restartCurrent: () => this.doRestart(),
      quitToMenu: () => this.doQuit(),
      openCareer: () => this.openCareer(),
      openDrills: () => this.openDrills(),
      cycleCourtTheme: () => this.cycleCourtTheme(),
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
