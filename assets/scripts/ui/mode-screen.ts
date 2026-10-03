// ============================================================
// 模式屏基座:首页大色块点进来的「第二层」界面(对练 / 无限练习)。
//
// 设计动机:
// - 用户指令:模式选择不再用弹窗 —— 点首页大色块要「斩进一块新界面」,
//   返回时斩回来,进出都走 ui-arcade.screenSwap 的斜带转场。
// - 两块屏骨架同构(暗底 + 氛围 + 右上 ✕ 关闭键 + 四档难度 2×2 实底大色块),
//   差异只在赛前准备区(技能胶囊两块屏都有,基类提供;球馆是对练屏独有)与选档后的去向 ——
//   抽成基类 + buildExtra/onPick 钩子,子类只补差异,不复制骨架。
// - 四档难度文案统一吃 config.DIFF_PICKS(主菜单旧三卡的展示表收编于此),
//   色面用 drawSolidBlock 实底大色块,文字用色由 inkOn(accent) 决定。
// - 触摸卫生沿用仓库契约:hide 走 fadeOutHide(禁交互件、不 deactivate),
//   show 走 cancelFade 整树放行;不挂任何裸 TOUCH 监听,不造隐形挡板。
// - 作者通道(连点同一个球馆 tab 拉满档)随球馆 tabs 从主菜单迁到这里。
// ============================================================
import { Button, Color, Graphics, Label, Node, profiler, UITransform, Vec2 } from "cc";
import { CFG, DIFF_PICKS } from "../core/config";
import { Career } from "../core/career";
import { Skills } from "../core/skills";
import type { DiffKey } from "../core/types";
import { col } from "./ui-manager";
import type { UiKit } from "./ui-manager";
import {
  ARCADE, cancelFade, drawChevron, drawMenuCard, drawSlantPanel, drawSlantShadow,
  drawSolidBlock, fadeOutHide, inkOn, makeChip, riseIn, retainedDraw, safePad, skewOf,
  slashIn, slantPath, textW, TOUCH_MIN, uiIconButton,
} from "./ui-arcade";
import { pressable as shellPressable, solidBlock as shellSolidBlock } from "./ui-shell";

const DIM_FAINT = "#6f7ca6";

export abstract class ModeScreen {
  readonly root: Node;
  protected kit: UiKit;
  private readonly title: string;
  private readonly goBack: () => void;
  private bars: Node[] = [];
  private extras: Node[] = [];
  private titleNode!: Node;
  private closeNode!: Node;
  /** 技能胶囊的名字读数:只有调过 buildSkillBadge 的屏才有(基类重绘时要能空转) */
  private skillNameLabel: Label | null = null;

  protected constructor(
    parent: Node, kit: UiKit, name: string,
    title: string, goBack: () => void,
  ) {
    this.kit = kit;
    this.title = title;
    this.goBack = goBack;
    this.root = kit.root(parent, name);
    this.root.active = false;
    kit.dim(this.root, 1, 1, { bands: false });        // 二级界面底即墨黑:身后的一级界面一律不露(用户指令)
    kit.atmosphere(this.root);
    this.buildHeader();
    this.buildBars();
    // 注意:buildExtra 必须由各子类在 super() 之后自行调用,
    // 不能在父类 constructor 里调 —— ES/TS 规范下子类字段初始化器(如 courtTabs = [])
    // 晚于 super() 执行,在此处调用会因子类属性未就绪抛 Cannot read properties of undefined (reading 'push')。
  }

  show(): void {
    cancelFade(this.root);
    this.root.active = true;
    this.refreshExtra();
    slashIn(this.closeNode, 0, 34, 6);
    slashIn(this.titleNode, 0.06, -38, -6);
    for (let i = 0; i < this.bars.length; i++) riseIn(this.bars[i], 0.14 + i * 0.06);
    for (let i = 0; i < this.extras.length; i++) riseIn(this.extras[i], 0.36 + i * 0.05);
  }

  hide(): void {
    fadeOutHide(this.root);
  }

  // ---------- 骨架 ----------

  private buildHeader(): void {
    const sp = safePad();

    // 关闭键:右上角 ✕,与闯关大厅/训练场/生涯面板同一颗斜方形 uiIconButton ——
    // 「离开当前界面」全站一个角、一个形状(旧写法是左上手绘「‹ 返回」黑斜片,两套逻辑)。
    const close = uiIconButton(this.root, "✕", { fontSize: 20 });
    close.on(Button.EventType.CLICK, () => {
      this.kit.sfx.play("back");
      this.goBack();
    });
    close.setPosition(480 - sp.right - 52, 214, 0);
    this.closeNode = close;

    // 标题:红黑斜切衬底 + 大字(主菜单标题同构,窄一号)
    const holder = new Node("title");
    holder.layer = this.root.layer;
    holder.addComponent(UITransform);
    holder.setPosition(0, 214, 0);

    const backing = new Node("backing");
    backing.layer = holder.layer;
    backing.addComponent(UITransform);
    const gg = backing.addComponent(Graphics);
    const bs = skewOf(62, 9);
    gg.fillColor = col(ARCADE.slash, 0.97);
    const bw = 96 + this.title.length * 44;
    slantPath(gg, bw, 62, bs);
    gg.fill();
    gg.fillColor = col(ARCADE.ink, 0.97);
    slantPath(gg, bw - 12, 50, bs * 0.92, -4, -2);
    gg.fill();
    gg.strokeColor = col("#ff6b72", 0.5);
    gg.lineWidth = 1.5;
    slantPath(gg, bw, 62, bs);
    gg.stroke();
    backing.setParent(holder);

    const t = this.kit.label(holder, this.title, 34, ARCADE.paper, { disp: true });
    t.enableShadow = true;
    t.shadowColor = new Color(0, 0, 0, 140);
    t.shadowOffset = new Vec2(0, -5);
    t.node.setPosition(0, 2, 0);

    holder.setParent(this.root);
    this.titleNode = holder;
  }

  /** 四档难度 2×2 实底大色块:每块即按钮,文案全吃 DIFF_PICKS */
  private buildBars(): void {
    DIFF_PICKS.forEach((p, i) => {
      const ink = inkOn(p.accent) ? "#0a0e1c" : "#f5efe1";
      const node = this.solidBlock(`diff:${p.key}`, 312, 108, p.accent, 4);
      // 2×2:上排 easy/normal、下排 hard/expert,行距 12(块高 108 → 两行共 228,
      // 顶到标题下沿、底到球馆/说明上方,不挤不撞)
      node.setPosition(i % 2 === 0 ? -164 : 164, i < 2 ? 92 : -32, 0);
      // 名字 + 标签胶囊 + 一行说明:左列竖排,占块左侧 250 宽
      const name = this.kit.label(node, p.name, 26, ink, { disp: true });
      name.node.setPosition(-128 + textW(p.name, 26) / 2, 32, 0);
      makeChip(node, p.tag, 10, "#0a0e1c", p.accent).setPosition(-98, 4, 0);
      this.txt(node, p.desc, 12, col(ink, 0.75), -128, -30, 250);
      // 右侧大号水印序号 + 箭标:一个节点只容一个渲染组件,标和箭各自挂笔
      const idx = this.kit.label(node, `0${i + 1}`, 46, col(ink, 0.16));
      idx.node.setPosition(110, 0, 0);
      const chev = new Node("chev");
      chev.layer = node.layer;
      chev.addComponent(UITransform);
      drawChevron(chev.addComponent(Graphics), 12, ink, 0.65, 2);
      chev.setPosition(134, 34, 0);
      chev.setParent(node);

      node.on(Button.EventType.CLICK, () => {
        this.kit.sfx.play("ui");
        this.onPick(p.key);
      });
      this.bars.push(node);
    });
  }

  // ---------- 子类钩子 ----------

  /** 赛前准备区:对练屏 = 球馆 + 技能胶囊;无限屏 = 一句说明 + 技能胶囊。坐标自负 */
  protected abstract buildExtra(): void;

  /** 选档去向:对练 → startMatch;无限 → startEndlessMatch */
  protected abstract onPick(d: DiffKey): void;

  /** show() 时的数据重绘(球馆选中态 / 技能名等);默认无 */
  protected refreshExtra(): void {}

  /** 把准备区的节点登记进入场队列(riseIn,按登记顺序 stagger) */
  protected pushExtra(n: Node): void {
    this.extras.push(n);
  }

  /**
   * 核心技能配置胶囊:整块可点,弹技能选择弹窗。装备的是**全局一份**
   * (Career.equippedSkill,不分模式),所以每块能开赛的模式屏都该就地换技能 ——
   * 建在基类,子类只决定摆在哪个 y。
   */
  protected buildSkillBadge(y: number): void {
    const skill = new Node("badge:skill");
    skill.layer = this.root.layer;
    skill.addComponent(UITransform).setContentSize(640, 46);
    const sg = skill.addComponent(Graphics);
    drawSlantShadow(sg, 640, 46, skewOf(46, 4), 4, 5, 0.5);
    drawSlantPanel(sg, 640, 46, skewOf(46, 4), { face: "#16161f", alpha: 0.94, edge: "#38bdf8", edgeA: 0.5 });
    makeChip(skill, "SKILL", 9, "#38bdf8", "#0a0e1c").setPosition(-262, 0, 0);
    this.skillNameLabel = this.txt(skill, "强力跨步", 14, "#38bdf8", -216, 0, 200);
    this.txt(skill, "赛前可选主动技能 · 更换 ›", 12, DIM_FAINT, 180, 0, 220);
    this.pressable(skill, 0.96);
    skill.on(Button.EventType.CLICK, () => {
      this.kit.sfx.play("ui");
      this.kit.openSkillDialog(() => this.paintSkillBadge());
    });
    skill.setPosition(0, y, 0);
    skill.setParent(this.root);
    this.pushExtra(skill);
  }

  /** 胶囊读数跟着当前装备走(名字与配色都来自技能表) */
  protected paintSkillBadge(): void {
    const lbl = this.skillNameLabel;
    if (!lbl) return;
    const def = Skills.defOf(Career.equippedSkill());
    lbl.string = def.name;
    lbl.color = col(def.accent);
  }

  // ---------- 建块辅助(与 main-menu 同约定) ----------

  /**
   * 给手绘节点补上真按钮。**这一步不能省**:`click` 只由 `Button._onTouchEnded` 派发,
   * 而 TOUCH_* 监听只由 `Button._registerNodeEvent` 在 onEnable 时注册 —— 一个只有
   * UITransform + Graphics 的节点即便挂了 `on(Button.EventType.CLICK)`,也进不了引擎的
   * 命中判定(那把表里没有 'click'),结果既不响也不吞触摸:症状是「只有这一排点不动,
   * 上下装了 Button 的块全好」。0.0.18 把球馆 tab 与技能胶囊从主菜单 card() 迁到手搓
   * Node 时就是漏了这一行。闸门见 tools/ui-click-check.ts。
   *
   * 实现已提到 ui-shell.pressable(四个面板要用同一个工厂,不能各留一份),
   * 这里保留方法名:调用点三十多处不动,且 ui-click-check 认的还是这个名字。
   */
  protected pressable(n: Node, zoom: number): void {
    shellPressable(n, zoom);
  }

  /** 实底斜切大色块:自带 Button(SCALE);返回节点供补画箭标等 */
  protected solidBlock(name: string, w: number, h: number, accent: string, slant = 4): Node {
    return shellSolidBlock(name, this.root, w, h, accent, slant);
  }

  /**
   * 左对齐文本:x 传「文字左缘」而不是节点中心 ——
   * Cocos 的 Label 按 contentSize 排字,直接摆中心点会把整段推出卡片。
   */
  protected txt(parent: Node, text: string, size: number, colorHex: string | Color,
    left: number, y: number, w: number, lines = 1): Label {
    const l = this.kit.label(parent, text, size, colorHex, { align: 0 });
    const ut = l.node.getComponent(UITransform)!;
    ut.setContentSize(w, Math.round(size * 1.35) * lines);
    l.overflow = Label.Overflow.CLAMP;
    l.node.setPosition(left + w / 2, y, 0);
    return l;
  }
}

// ============================================================
// 对练屏:四档难度 + 球馆 + 技能胶囊 —— 主菜单搬空的「赛前准备」都在这
// ============================================================

export class MatchSetupScreen extends ModeScreen {
  private courtTabs: Array<{ g: Graphics; name: Label; flag: Node; id: string; accent: string }> = [];
  /** 作者通道:连点同一个球馆 tab 的计数 / 上一次是哪块 tab / 上一落的时刻 */
  private authorTabId: string | null = null;
  private authorTaps = 0;
  private authorAt = 0;
  /** 本次连点已拉满:后续点击改判 profiler 开关(见 authorTap) */
  private authorMaxed = false;
  private profilerOn = false;

  constructor(parent: Node, kit: UiKit, goBack: () => void) {
    super(parent, kit, "match-setup", "对练", goBack);
    this.buildExtra();
  }

  protected buildExtra(): void {
    // 球馆选择(自主菜单迁入):选中 = 该馆主题色描边点亮 + 「使用中」角标
    const courts = new Node("courts");
    courts.layer = this.root.layer;
    courts.addComponent(UITransform).setContentSize(640, TOUCH_MIN);
    courts.setPosition(0, -152, 0);
    this.kit.courtThemes().forEach((c, i) => {
      const tab = new Node(`court:${c.id}`);
      tab.layer = courts.layer;
      // 命中框吃 TOUCH_MIN 下限,墨仍按 42 画(「视觉小、命中大」,同 uiIconButton 那一手)
      tab.addComponent(UITransform).setContentSize(148, TOUCH_MIN);
      const g = tab.addComponent(Graphics);
      const name = this.kit.label(tab, c.name, 13, ARCADE.paper);
      // 「使用中」角标:选中才亮,斜切小片贴在卡片右上角。
      // 这颗角标按选中态 active 开关,而原生侧 Graphics 的渲染数据会在 onDisable 被清、
      // 重激活不重传 —— 一次画完的它第二次点亮就只剩字没有底,所以登记成可重放。
      const flag = new Node("flag");
      flag.layer = tab.layer;
      flag.addComponent(UITransform).setContentSize(52, 16);
      const fg = flag.addComponent(Graphics);
      retainedDraw(fg, () => {
        fg.fillColor = col(c.accent);
        slantPath(fg, 52, 16, skewOf(16, 10));
        fg.fill();
      });
      this.kit.label(flag, "使用中", 10, "#0a0e1c").node.setPosition(0, 0, 0);
      flag.setPosition(58, 12, 0);
      flag.setParent(tab);

      this.pressable(tab, 0.94);
      tab.on(Button.EventType.CLICK, () => {
        this.kit.sfx.play("ui");
        this.kit.setCourtTheme(c.id);
        this.paintCourts();
        if (!this.authorTap(c.id)) this.kit.toast(`球馆已切换 · ${c.name}`);
      });
      tab.setPosition((i - 1.5) * 160, 0, 0);
      tab.setParent(courts);
      this.courtTabs.push({ g, name, flag, id: c.id, accent: c.accent });
    });
    courts.setParent(this.root);
    this.pushExtra(courts);

    // 核心技能配置胶囊:整块可点,弹技能选择弹窗
    this.buildSkillBadge(-214);
  }

  protected onPick(d: DiffKey): void {
    this.kit.startMatch(d);
  }

  protected refreshExtra(): void {
    this.paintCourts();
    this.paintSkillBadge();
  }

  // ---------- 状态描绘 ----------

  /** 球馆 tab:选中 = 该馆主题色实底 + 描边点亮 + 亮「使用中」角标(主菜单同款) */
  private paintCourts(): void {
    const curId = this.kit.getCourtTheme().id;
    for (const t of this.courtTabs) {
      const active = t.id === curId;
      t.g.clear();
      drawSlantShadow(t.g, 148, 42, skewOf(42, 6), 4, 5, active ? 0.5 : 0.32);
      drawMenuCard(t.g, 148, 42, 8, {
        accent: active ? t.accent : undefined,
        tint: 0.14, bar: 0, edge: active ? 3 : 0,
        alpha: active ? 0.92 : 0.8, active, slant: 6,
      });
      t.name.color = col(active ? ARCADE.paper : "#a7b6dd");
      t.flag.active = active;
    }
  }

  // ---------- 作者通道(自主菜单原样迁入) ----------

  /**
   * 连点同一个球馆 tab 满 CFG.author.taps 下 → 等级/金币拉满,方便真机测商店与技能解锁。
   * 换 tab 或两下点慢过 gapMs 就重新计数,所以正常「挨个看球馆」不会误触;
   * 触发时顺带吃掉这次点击,不再叠一层「球馆已切换」的提示(同一条 toast 通道,会互相盖)。
   * 拉满后**继续**连点 profTaps 下 → 切引擎统计(profiler)显示开关:真机排查卡顿
   * 看 FPS/帧时间用,同一条手势链不用记新手势。两项都只在内存生效,重开应用即退回。
   * @returns 本次是否触发了拉满/统计开关
   */
  private authorTap(courtId: string): boolean {
    const A = CFG.author;
    if (!A.enabled) return false;
    const now = Date.now();
    if (this.authorTabId !== courtId || now - this.authorAt > A.gapMs) {
      this.authorTaps = 0;
      this.authorMaxed = false;
    }
    this.authorTabId = courtId;
    this.authorAt = now;
    if (this.authorMaxed) {
      if (++this.authorTaps < A.profTaps) return true;
      this.authorTaps = 0;
      this.authorMaxed = false;
      this.profilerOn = !this.profilerOn;
      if (this.profilerOn) profiler.showStats(); else profiler.hideStats();
      this.kit.sfx.play("ui");
      this.kit.toast(this.profilerOn ? "性能统计 · 开(再连点关)" : "性能统计 · 关");
      return true;
    }
    if (++this.authorTaps < A.taps) return false;
    this.authorTaps = 0;
    this.authorMaxed = true;
    const r = Career.maxOut(A.coins);
    this.paintCourts();
    this.kit.sfx.play("levelup");
    this.kit.toast(`作者模式 · Lv.${r.level} / 金币 ${r.coins} · 本局不落盘`);
    return true;
  }
}

// ============================================================
// 无限练习屏:由旧 EndlessDialog 弹窗改造成的模式屏(用户指令:不要弹窗)
// ============================================================

export class EndlessScreen extends ModeScreen {
  constructor(parent: Node, kit: UiKit, goBack: () => void) {
    super(parent, kit, "endless-screen", "无限练习", goBack);
    this.buildExtra();
  }

  protected buildExtra(): void {
    const desc = new Node("desc");
    desc.layer = this.root.layer;
    desc.addComponent(UITransform).setContentSize(640, 22);
    this.txt(desc, "无视比分胜负,持续对拉练习 —— 选一位陪练 AI 的强度:", 13, "#9fb0d8", -320, 0, 640);
    desc.setPosition(0, -152, 0);
    desc.setParent(this.root);
    this.pushExtra(desc);

    // 无限练习同样吃全局装备的技能(doStartEndlessMatch → Career.applyToMatch),
    // 所以这一屏也得能就地换 —— 原来只能退回对练屏改,改完再进来选难度。
    this.buildSkillBadge(-214);
  }

  protected refreshExtra(): void {
    this.paintSkillBadge();
  }

  protected onPick(d: DiffKey): void {
    this.kit.startEndlessMatch(d);
  }
}
