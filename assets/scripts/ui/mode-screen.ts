// ============================================================
// 模式屏基座:首页大色块点进来的「第二层」界面(对练 / 无限练习)。
//
// 设计动机:
// - 用户指令:模式选择不再用弹窗 —— 点首页大色块要「斩进一块新界面」,
//   返回时斩回来,进出都走 ui-arcade.screenSwap 的斜带转场。
// - 两块屏骨架同构(暗底 + 氛围 + 返回条 + 三档难度实底大色块条),
//   差异只在赛前准备区(对练屏独有:球馆 + 技能)与选档后的去向 ——
//   抽成基类 + buildExtra/onPick 钩子,子类只补差异,不复制骨架。
// - 三档难度文案统一吃 config.DIFF_PICKS(主菜单旧三卡的展示表收编于此),
//   色面用 drawSolidBlock 实底大色块,文字用色由 inkOn(accent) 决定。
// - 触摸卫生沿用仓库契约:hide 走 fadeOutHide(禁交互件、不 deactivate),
//   show 走 cancelFade 整树放行;不挂任何裸 TOUCH 监听,不造隐形挡板。
// - 作者通道(连点同一个球馆 tab 拉满档)随球馆 tabs 从主菜单迁到这里。
// ============================================================
import { Button, Color, Graphics, Label, Node, UITransform, Vec2 } from "cc";
import { CFG, DIFF_PICKS } from "../core/config";
import { Career } from "../core/career";
import { Skills } from "../core/skills";
import type { DiffKey } from "../core/types";
import { col } from "./ui-manager";
import type { UiKit } from "./ui-manager";
import {
  ARCADE, cancelFade, drawChevron, drawMenuCard, drawSlantPanel, drawSlantShadow,
  drawSolidBlock, fadeOutHide, inkOn, makeChip, riseIn, safePad, skewOf, slashIn,
} from "./ui-arcade";

const DIM_FAINT = "#6f7ca6";

export abstract class ModeScreen {
  readonly root: Node;
  protected kit: UiKit;
  private readonly title: string;
  private readonly tag: string;
  private readonly goBack: () => void;
  private bars: Node[] = [];
  private extras: Node[] = [];
  private titleNode!: Node;
  private backNode!: Node;

  protected constructor(
    parent: Node, kit: UiKit, name: string,
    title: string, tag: string, goBack: () => void,
  ) {
    this.kit = kit;
    this.title = title;
    this.tag = tag;
    this.goBack = goBack;
    this.root = kit.root(parent, name);
    this.root.active = false;
    kit.dim(this.root, 0.3, 0.55);       // 比主菜单略深:模式屏是「进了一层」
    kit.atmosphere(this.root);
    this.buildHeader();
    this.buildBars();
    this.buildExtra();
  }

  show(): void {
    cancelFade(this.root);
    this.root.active = true;
    this.refreshExtra();
    slashIn(this.backNode, 0, -34, -6);
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

    // 返回键:黑面斜切小片(视觉与主菜单右上角徽章同族)
    const back = new Node("back");
    back.layer = this.root.layer;
    back.addComponent(UITransform).setContentSize(96, 40);
    const bg = back.addComponent(Graphics);
    drawSlantShadow(bg, 96, 40, skewOf(40, 8), 3, 3, 0.45);
    drawSlantPanel(bg, 96, 40, skewOf(40, 8), { face: "#16161f", alpha: 0.96, edge: ARCADE.paper, edgeA: 0.35 });
    this.kit.label(back, "‹ 返回", 13, ARCADE.paper, { disp: true });
    const bb = back.addComponent(Button);
    bb.transition = Button.Transition.SCALE;
    bb.zoomScale = 0.92;
    bb.target = back;
    back.on(Button.EventType.CLICK, () => {
      this.kit.sfx.play("back");
      this.goBack();
    });
    back.setPosition(-480 + sp.left + 52, 214, 0);
    back.setParent(this.root);
    this.backNode = back;

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
    slantPath2(gg, bw, 62, bs);
    gg.fill();
    gg.fillColor = col(ARCADE.ink, 0.97);
    slantPath2(gg, bw - 12, 50, bs * 0.92, -4, -2);
    gg.fill();
    gg.strokeColor = col("#ff6b72", 0.5);
    gg.lineWidth = 1.5;
    slantPath2(gg, bw, 62, bs);
    gg.stroke();
    backing.setParent(holder);

    const t = this.kit.label(holder, this.title, 34, ARCADE.paper, { disp: true });
    t.enableShadow = true;
    t.shadowColor = new Color(0, 0, 0, 140);
    t.shadowOffset = new Vec2(0, -5);
    t.node.setPosition(0, 2, 0);
    const sub = this.kit.label(holder, this.tag, 11, DIM_FAINT);
    sub.node.setPosition(0, -38, 0);

    holder.setParent(this.root);
    this.titleNode = holder;
  }

  /** 三档难度实底大色块条:整条即按钮,文案全吃 DIFF_PICKS */
  private buildBars(): void {
    DIFF_PICKS.forEach((p, i) => {
      const ink = inkOn(p.accent) ? "#0a0e1c" : "#f5efe1";
      const node = this.solidBlock(`diff:${p.key}`, 640, 82, p.accent, 4);
      node.setPosition(0, 104 - i * 92, 0);
      const idx = this.kit.label(node, `0${i + 1}`, 22, col(ink, 0.4));
      idx.node.setPosition(-286, 0, 0);
      makeChip(node, p.tag, 10, "#0a0e1c", p.accent).setPosition(-226, 0, 0);
      const name = this.kit.label(node, p.name, 26, ink, { disp: true });
      name.node.setPosition(-142, 0, 0);
      this.txt(node, p.desc, 12, col(ink, 0.72), -96, 0, 360);

      // 箭标:独立子节点挂笔(一个节点只容一个渲染组件,块面已占该节点的 Graphics)
      const chev = new Node("chev");
      chev.layer = node.layer;
      chev.addComponent(UITransform);
      drawChevron(chev.addComponent(Graphics), 12, ink, 0.65, 2);
      chev.setPosition(288, 0, 0);
      chev.setParent(node);

      node.on(Button.EventType.CLICK, () => {
        this.kit.sfx.play("ui");
        this.onPick(p.key);
      });
      this.bars.push(node);
    });
  }

  // ---------- 子类钩子 ----------

  /** 赛前准备区:对练屏 = 球馆 + 技能胶囊;无限屏 = 一句说明。坐标自负 */
  protected abstract buildExtra(): void;

  /** 选档去向:对练 → startMatch;无限 → startEndlessMatch */
  protected abstract onPick(d: DiffKey): void;

  /** show() 时的数据重绘(球馆选中态 / 技能名等);默认无 */
  protected refreshExtra(): void {}

  /** 把准备区的节点登记进入场队列(riseIn,按登记顺序 stagger) */
  protected pushExtra(n: Node): void {
    this.extras.push(n);
  }

  // ---------- 建块辅助(与 main-menu 同约定) ----------

  /** 实底斜切大色块:自带 Button(SCALE);返回 Graphics 供补画箭标等 */
  protected solidBlock(name: string, w: number, h: number, accent: string, slant = 4): Node {
    const n = new Node(name);
    n.layer = this.root.layer;
    n.addComponent(UITransform).setContentSize(w, h);
    drawSolidBlock(n.addComponent(Graphics), w, h, accent, slant);
    const b = n.addComponent(Button);
    b.transition = Button.Transition.SCALE;
    b.zoomScale = 0.96;
    b.target = n;
    n.setParent(this.root);
    return n;
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

/** 斜切平行四边形路径(与 ui-arcade.slantPath 同形;本文件多处要用,就地备一份) */
function slantPath2(g: Graphics, w: number, h: number, skew: number, cx = 0, cy = 0): void {
  const s = skew / 2;
  g.moveTo(-w / 2 + s + cx, -h / 2 + cy);
  g.lineTo(w / 2 + s + cx, -h / 2 + cy);
  g.lineTo(w / 2 - s + cx, h / 2 + cy);
  g.lineTo(-w / 2 - s + cx, h / 2 + cy);
  g.close();
}

// ============================================================
// 对练屏:三档难度 + 球馆 + 技能胶囊 —— 主菜单搬空的「赛前准备」都在这
// ============================================================

export class MatchSetupScreen extends ModeScreen {
  private courtTabs: Array<{ g: Graphics; name: Label; flag: Node; id: string; accent: string }> = [];
  private skillNameLabel!: Label;
  /** 作者通道:连点同一个球馆 tab 的计数 / 上一次是哪块 tab / 上一落的时刻 */
  private authorTabId: string | null = null;
  private authorTaps = 0;
  private authorAt = 0;

  constructor(parent: Node, kit: UiKit, goBack: () => void) {
    super(parent, kit, "match-setup", "对练", "MATCH PLAY", goBack);
  }

  protected buildExtra(): void {
    // 球馆选择(自主菜单迁入):选中 = 该馆主题色描边点亮 + 「使用中」角标
    const courts = new Node("courts");
    courts.layer = this.root.layer;
    courts.addComponent(UITransform);
    courts.setPosition(0, -152, 0);
    this.kit.courtThemes().forEach((c, i) => {
      const tab = new Node(`court:${c.id}`);
      tab.layer = courts.layer;
      tab.addComponent(UITransform).setContentSize(148, 42);
      const g = tab.addComponent(Graphics);
      const name = this.kit.label(tab, c.name, 13, ARCADE.paper);
      // 「使用中」角标:选中才亮,斜切小片贴在卡片右上角
      const flag = new Node("flag");
      flag.layer = tab.layer;
      flag.addComponent(UITransform).setContentSize(52, 16);
      const fg = flag.addComponent(Graphics);
      fg.fillColor = col(c.accent);
      slantPath2(fg, 52, 16, skewOf(16, 10));
      fg.fill();
      this.kit.label(flag, "使用中", 10, "#0a0e1c").node.setPosition(0, 0, 0);
      flag.setPosition(58, 12, 0);
      flag.setParent(tab);

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

    // 核心技能配置胶囊(自主菜单迁入):整块可点,弹技能选择弹窗
    const skill = new Node("badge:skill");
    skill.layer = this.root.layer;
    skill.addComponent(UITransform).setContentSize(640, 46);
    const sg = skill.addComponent(Graphics);
    drawSlantShadow(sg, 640, 46, skewOf(46, 4), 4, 5, 0.5);
    drawSlantPanel(sg, 640, 46, skewOf(46, 4), { face: "#16161f", alpha: 0.94, edge: "#38bdf8", edgeA: 0.5 });
    makeChip(skill, "SKILL", 9, "#38bdf8", "#0a0e1c").setPosition(-262, 0, 0);
    this.skillNameLabel = this.txt(skill, "强力跨步", 14, "#38bdf8", -216, 0, 200);
    this.txt(skill, "赛前可选主动技能 · 更换 ›", 12, DIM_FAINT, 180, 0, 220);
    skill.on(Button.EventType.CLICK, () => {
      this.kit.sfx.play("ui");
      this.kit.openSkillDialog(() => this.paintSkillBadge());
    });
    skill.setPosition(0, -214, 0);
    skill.setParent(this.root);
    this.pushExtra(skill);
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

  private paintSkillBadge(): void {
    const def = Skills.defOf(Career.equippedSkill());
    this.skillNameLabel.string = def.name;
    this.skillNameLabel.color = col(def.accent);
  }

  // ---------- 作者通道(自主菜单原样迁入) ----------

  /**
   * 连点同一个球馆 tab 满 CFG.author.taps 下 → 等级/金币拉满,方便真机测商店与技能解锁。
   * 换 tab 或两下点慢过 gapMs 就重新计数,所以正常「挨个看球馆」不会误触;
   * 触发时顺带吃掉这次点击,不再叠一层「球馆已切换」的提示(同一条 toast 通道,会互相盖)。
   * 拉满只在内存生效且此后 profile 不再落盘,所以重开应用会退回原档 —— 每次进应用都得重新连点。
   * @returns 本次是否触发了拉满
   */
  private authorTap(courtId: string): boolean {
    const A = CFG.author;
    if (!A.enabled) return false;
    const now = Date.now();
    if (this.authorTabId !== courtId || now - this.authorAt > A.gapMs) this.authorTaps = 0;
    this.authorTabId = courtId;
    this.authorAt = now;
    if (++this.authorTaps < A.taps) return false;
    this.authorTaps = 0;
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
    super(parent, kit, "endless-screen", "无限练习", "ENDLESS", goBack);
  }

  protected buildExtra(): void {
    const desc = new Node("desc");
    desc.layer = this.root.layer;
    desc.addComponent(UITransform).setContentSize(640, 22);
    this.txt(desc, "无视比分胜负,持续对拉练习 —— 选一位陪练 AI 的强度:", 13, "#9fb0d8", -320, 0, 640);
    desc.setPosition(0, -152, 0);
    desc.setParent(this.root);
    this.pushExtra(desc);
  }

  protected onPick(d: DiffKey): void {
    this.kit.startEndlessMatch(d);
  }
}
