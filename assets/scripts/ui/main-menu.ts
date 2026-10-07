// ============================================================
// 主菜单:球场在身后,菜单是浮在场上的一层玻璃。
// 版式(P5 海报改版):等级/金币/音效条 → 标题 → 五块实底大色块 → 底部活动横幅。
// 底部不再挂版本号与「检查更新」(用户指令):更新整条链路收进设置「关于」页,
// 这里只留冷启动的 24h 静默检查 —— 有更新会自己弹窗,没更新不必给个按钮让人点。
// 信息架构(用户指令):「入门/普通/大师」不再铺在首页 —— 合并成左上那块
// 「对练」大色块,和闯关/无限练习/专项训练/生涯同级;点进去是模式屏
// (mode-screen.ts),球馆选择与技能胶囊也搬进了对练屏,首页只留模式入口。
// 大色块 = ui-arcade.drawSolidBlock 实底海报面,文字用色由 inkOn(accent) 定。
// 屏间转场走 ui-arcade.screenSwap(红黑斜带扫屏),进对局仍走 slashWipe。
//
// **坐标一律从 menu-layout 读**(用户 2026-10-07 现场:「手机上看这个底部的活动中心
// 这一块,被挤到下面去了」)。这一屏是全站唯一跟着屏幕长宽比变的一屏 —— FIXED_HEIGHT
// 下高恒 540、宽随长宽比涨,旧版把 960 那一排的坐标手拍在这里,宽屏上就是
// 「两侧各空 140、横幅贴到屏幕最下沿」。现在 layoutMenu(可视宽, 安全区) 一份算术,
// 构造时摆一次、show() 里按当前可视宽整表重摆(折叠屏展开 / 分屏换宽后回首页不脱节)。
// ============================================================
import { Button, Color, Graphics, Label, Node, tween, UIOpacity, UITransform, Vec2, view, Widget } from "cc";
import { CFG, DRILLS } from "../core/config";
import { Career } from "../core/career";
import { CampaignManager } from "../core/campaign";
import { col } from "./ui-manager";
import type { UiKit } from "./ui-manager";
import {
  ARCADE, cancelFade, drawChevron, drawSlantPanel, drawSlantShadow, drawSawtooth,
  drawSolidBlock, fadeOutHide, inkOn, makeChip, makeCoinIcon,
  riseIn, safePad, skewOf, slashIn, slantPath,
} from "./ui-arcade";
import { UpdateService } from "../game/update-service";
import {
  MENU, MENU_SIZE, MENU_TEXT, bannerSubClaimable, center, layoutMenu, width,
  type Box, type MenuLayout,
} from "./menu-layout";

/** 大色块字色:亮面配墨黑,斩劈红面配纸白(由亮度算,不逐块手拍) */
const inkOf = (accent: string): string => (inkOn(accent) ? "#0a0e1c" : "#f5efe1");

/** 可视宽(设计单位):FIXED_HEIGHT 下高恒 540,宽 = 540 × 屏幕长宽比(hud 同一把尺) */
function visibleDesignWidth(): number {
  const vs = view.getVisibleSize();
  const k = vs.height > 0 ? CFG.world.h / vs.height : 1;
  return vs.width * k;
}

export class MainMenu {
  readonly root: Node;
  private kit: UiKit;
  private lvLabel: Label;
  private coinLabel: Label;
  private soundLabel: Label;
  // 大色块改版后闯关/训练/生涯不再带副行,sub 为空串时 entry() 不建 Label —— 三字段可为 null
  private campaignSub: Label | null = null;
  private drillSub: Label | null = null;
  private careerSub: Label | null = null;
  /** 底部活动横幅(2026-10-07 活动板块):动态副行 + 可领角签(文案变了才重建) */
  private activitySub: Label | null = null;
  private activityNode: Node | null = null;
  private claimChip: Node | null = null;
  private claimChipText = "";
  private checkedStartup = false;
  /** rise 入场的节点队列(节点,延迟):show 时逐级展开 */
  private riseNodes: Array<{ node: Node; delay: number }> = [];
  /** 顶栏徽章的斩入队列:与 rise 分开,show 时侧向 slashIn */
  private slashNodes: Array<{ node: Node; delay: number }> = [];
  /** 标题衬底节点:show 时一次性 slashIn,落位后静止(无循环动画) */
  private titleBackNode: Node | null = null;
  /** 半透明暗底节点:入场时从全黑淡到半透,让身后球场渐渐显出来 */
  private dimNode: Node | null = null;
  /** 当前版式(屏幕局部坐标);show() 里可视宽变了就整表重摆 */
  private L: MenuLayout = layoutMenu({ visW: visibleDesignWidth() });
  /** 摆位表:每项 = 「按 this.L 重摆这一块/这一件」,构造时跑一遍、show() 再跑一遍 */
  private relayout: Array<() => void> = [];

  constructor(parent: Node, kit: UiKit) {
    this.kit = kit;
    const P = kit.pal;
    this.root = kit.root(parent, "main-menu");
    this.root.active = false;

    // 暗底:中心只压到 0.22,四周收到 0.5 —— 换球馆时身后那座场子清晰可见
    this.dimNode = kit.dim(this.root, 0.22, 0.5, { bands: false });
    // 扫描线 + 暗角:老 #scan / .grain 的街机厅氛围(轻量,不能再糊一层)
    kit.atmosphere(this.root);

    // ---------- 顶部条(P5 化):左上 Lv+金币级联,右上声音/设置级联 ----------
    // 等级与金币归拢到左上级联(用户指令:左边等级、右边金币,显示在一块);
    // 老版徽章用固定 x 散排一行,宽屏下离角落越来越远,看着"孤零零";
    // 现在两组各用 Widget 角锚(safePad 避让刘海),块间轻微错位 —— P5 菜单的层叠感。
    // 徽章高度 44 = 触控下限;斜切统一 10°,入场改侧向 slashIn。
    const sp = safePad();
    const chipSkew = skewOf(44, 10);

    /** 顶栏斜切徽章:黑面为主,级联下沉,后建者压在先建者上面 */
    const cornerChip = (parent: Node, name: string, w: number, x: number, y: number, face: string, edgeHex: string): Node => {
      const n = new Node(name);
      n.layer = this.root.layer;
      n.addComponent(UITransform).setContentSize(w, 44);
      const g = n.addComponent(Graphics);
      drawSlantShadow(g, w, 44, chipSkew, 3, 3, 0.45);
      drawSlantPanel(g, w, 44, chipSkew, { face, alpha: 0.96, edge: edgeHex, edgeA: face === ARCADE.slash ? 0.8 : 0.4 });
      n.setPosition(x, y, 0);
      n.setParent(parent);
      return n;
    };

    // 左上级联容器:锚点 (0, 0.5) —— 子块坐标从左缘往右排,宽屏自动贴角
    const leftCluster = new Node("left-cluster");
    leftCluster.layer = this.root.layer;
    leftCluster.addComponent(UITransform).setContentSize(256, 60);
    leftCluster.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
    leftCluster.setParent(this.root);
    const lcWd = leftCluster.addComponent(Widget);
    lcWd.isAlignLeft = true; lcWd.left = sp.left;
    lcWd.isAlignTop = true; lcWd.top = 14 + sp.top;
    lcWd.updateAlignment();

    const lvNode = new Node("lv-badge");
    lvNode.layer = this.root.layer;
    lvNode.addComponent(UITransform).setContentSize(116, 44);
    const lvg = lvNode.addComponent(Graphics);
    drawSlantShadow(lvg, 116, 44, chipSkew, 4, 4, 0.5);
    drawSlantPanel(lvg, 116, 44, chipSkew, { face: ARCADE.slash, alpha: 0.97, edge: "#ff6b72", edgeA: 0.8 });
    drawSawtooth(lvg, 8, 26, 4, ARCADE.slashDk, 0.95, "right", 52, 0);   // 右缘撕纸边,兼作与金币牌的分隔
    this.lvLabel = kit.label(lvNode, "Lv.1", 18, "#fff5f2", { disp: true });
    lvNode.setPosition(58, 0, 0);
    lvNode.setParent(leftCluster);
    const lvBtn = lvNode.addComponent(Button);
    lvBtn.transition = Button.Transition.SCALE;
    lvBtn.zoomScale = 0.94;
    lvBtn.target = lvNode;
    lvNode.on(Button.EventType.CLICK, () => {
      kit.sfx.play("ui");
      kit.openCareer("stats");
    });

    // 金币牌贴在 Lv 牌右侧(用户指令:左等级右金币),错位 6px 延续级联感
    const coinBadge = cornerChip(leftCluster, "coin", 140, 186, 6, "#16161f", ARCADE.line);
    makeCoinIcon(coinBadge, -46, 0, 9);   // Graphics 金币(替代 🪙 emoji,原生平台无彩色 emoji 字体)
    this.coinLabel = kit.label(coinBadge, "0", 16, P.accent, { disp: true });
    this.coinLabel.node.setPosition(12, 0, 0);
    const coinBtn = coinBadge.addComponent(Button);
    coinBtn.transition = Button.Transition.SCALE;
    coinBtn.zoomScale = 0.94;
    coinBtn.target = coinBadge;
    coinBadge.on(Button.EventType.CLICK, () => {
      kit.sfx.play("ui");
      kit.openCareer("player");
    });

    // 右上级联容器:锚点 (1, 0.5) —— 子块坐标从右缘往左排,宽屏自动贴角
    const rightCluster = new Node("right-cluster");
    rightCluster.layer = this.root.layer;
    rightCluster.addComponent(UITransform).setContentSize(240, 60);
    rightCluster.getComponent(UITransform)!.setAnchorPoint(1, 0.5);
    rightCluster.setParent(this.root);
    const clWd = rightCluster.addComponent(Widget);
    clWd.isAlignRight = true; clWd.right = sp.right;
    clWd.isAlignTop = true; clWd.top = 14 + sp.top;
    clWd.updateAlignment();

    // 「声音」= 音效 + 音乐两条总线一起切(单独的开关在设置页里)
    const soundBadge = cornerChip(rightCluster, "sound", 92, -136, 2, "#16161f", ARCADE.line);
    this.soundLabel = kit.label(soundBadge, "声音", 13, P.dim);
    const sndBtn = soundBadge.addComponent(Button);
    sndBtn.transition = Button.Transition.SCALE;
    sndBtn.zoomScale = 0.94;
    sndBtn.target = soundBadge;
    soundBadge.on(Button.EventType.CLICK, () => {
      kit.sfx.play("ui");
      kit.toggleMute();
      this.paintSound();
    });

    const setBadge = cornerChip(rightCluster, "settings", 84, -42, -4, ARCADE.slash, "#ff6b72");
    kit.label(setBadge, "设置", 13, "#fff5f2").node.setPosition(0, 0, 0);
    const setBtn = setBadge.addComponent(Button);
    setBtn.transition = Button.Transition.SCALE;
    setBtn.zoomScale = 0.94;
    setBtn.target = setBadge;
    setBadge.on(Button.EventType.CLICK, () => {
      kit.sfx.play("ui");
      kit.openSettings();
    });

    this.slashNodes.push(
      { node: lvNode, delay: 0.0 }, { node: coinBadge, delay: 0.05 },
      { node: soundBadge, delay: 0.1 }, { node: setBadge, delay: 0.15 },
    );

    // ---------- 街机海报标题:单块大红斜切色块 + 两段大字 ----------
    // 返工定稿:去黄衬/锯齿/星芒/逐字错位,衬底与下方五块模式色块同款
    // (drawSolidBlock 厚底边语言),标题即「第六块大色块」;入场一次性,落位全静止。
    // 标题不参与横向拉伸(它是 logo,宽屏上就该居中占那么大块),但行心读版式那一份。
    const backing = new Node("title-backing");
    backing.layer = this.root.layer;
    backing.addComponent(UITransform).setContentSize(width(this.L.title), this.L.title.h);
    const bgg = backing.addComponent(Graphics);
    drawSolidBlock(bgg, width(this.L.title), this.L.title.h, ARCADE.slash, 9);   // 自带硬阴影/厚底边/高光/描边
    backing.setParent(this.root);
    this.bind(backing, (L) => L.title);
    this.titleBackNode = backing;

    const t1 = kit.label(this.root, MENU_TEXT.title[0], MENU.titleSize, P.accent, { disp: true });
    const t2 = kit.label(this.root, MENU_TEXT.title[1], MENU.titleSize, P.text, { disp: true });
    for (const [t, dx] of [[t1, MENU.titleDx[0]], [t2, MENU.titleDx[1]]] as Array<[Label, number]>) {
      const run = (): void => t.node.setPosition(dx, this.L.title.cy, 0);
      this.relayout.push(run); run();
      t.enableShadow = true;
      t.shadowColor = new Color(0, 0, 0, 140);
      t.shadowOffset = new Vec2(0, -6);
      t.node.angle = 1.5;                 // 与斜切色块同向的轻微仰角
      this.riseNodes.push({ node: t.node, delay: 0.16 });
    }

    // ---------- 摆位登记(整屏只这一处读坐标) ----------
    /** 按当前版式摆一个「节点即盒心」的件,并挂进重摆表 */
    const bind = (node: Node, get: (L: MenuLayout) => Box): Node => {
      this.bind(node, get);
      return node;
    };
    /** 大色块:位置 + 尺寸 + 重画底面(底面是一次绘制的斜切块,宽高一变必须跟着重画) */
    const block = (
      name: string, accent: string, onTap: () => void, get: (L: MenuLayout) => Box,
    ): Node => {
      const n = new Node(name);
      n.layer = this.root.layer;
      n.addComponent(UITransform);
      const g = n.addComponent(Graphics);
      const b = n.addComponent(Button);
      b.transition = Button.Transition.SCALE;
      b.zoomScale = 0.96;
      b.target = n;
      n.on(Button.EventType.CLICK, () => {
        kit.sfx.play("ui");
        onTap();
      });
      n.setParent(this.root);
      const run = (): void => {
        const bx = get(this.L);
        n.getComponent(UITransform)!.setContentSize(width(bx), bx.h);
        this.place(n, bx);
        g.clear();
        drawSolidBlock(g, width(bx), bx.h, accent, 5);
      };
      this.relayout.push(run);
      run();
      return n;
    };

    // ---------- 五块实底大色块(P5 海报面):对练为主入口,右列 2×2 ----------
    // 对练 = 左侧整柱斩劈红(进对练屏选难度/球馆/技能);
    // 右列:闯关(荧光黄)/ 无限练习(绿)/ 专项训练(青)/ 生涯与商店(纸白)。
    // 色即功能语言:红=上场、黄=闯关星星、绿=练球、青=专项、白=档案。
    // 尺寸与坐标全在 menu-layout:宽屏上整排横向拉伸、块内件贴住块缘的固定内缩。

    // 主入口:对练(整柱大块,内容竖排)
    const hero = block("mode:match-setup", ARCADE.slash, () => kit.openMatchSetup(), (L) => L.hero.outer);
    bind(makeChip(hero, MENU_TEXT.hero.tag, MENU_SIZE.heroChip, "#0a0e1c", ARCADE.acid), (L) => L.hero.chip);
    const heroName = kit.label(hero, MENU_TEXT.hero.name, MENU_SIZE.heroName, ARCADE.paper, { disp: true });
    bind(heroName.node, (L) => L.hero.name);
    this.txt(hero, MENU_TEXT.hero.line, MENU_SIZE.heroLine, col(ARCADE.paper, 0.8), (L) => L.hero.line!);
    // 四档强度色点:绿→黄→橙→红,颜色本身就在报难度(与对练屏 DIFF_PICKS 同源)
    const dots = new Node("diff-dots");
    dots.layer = hero.layer;
    dots.addComponent(UITransform);
    const dg = dots.addComponent(Graphics);
    const dotHexes = ["#7dff9e", "#ffe14d", "#ff6a1f", "#f43f5e"];
    for (let i = 0; i < dotHexes.length; i++) {
      dg.fillColor = col(dotHexes[i], 0.95);
      slantPath(dg, 26, 14, skewOf(14, 8), -51 + i * 34, 0);
      dg.fill();
    }
    dots.setParent(hero);
    bind(dots, (L) => L.hero.dots);
    this.txt(hero, MENU_TEXT.hero.hint, MENU_SIZE.heroHint, col(ARCADE.paper, 0.55), (L) => L.hero.hint);
    const heroChev = new Node("hero-chev");
    heroChev.layer = hero.layer;
    heroChev.addComponent(UITransform);
    drawChevron(heroChev.addComponent(Graphics), 15, ARCADE.paper, 0.85, 2);
    heroChev.setParent(hero);
    bind(heroChev, (L) => L.hero.chev);

    /** 右列小块:EN 角签 + 名称 + 动态副行 + 箭标(整块即按钮) */
    const entry = (i: number, accent: string, onTap: () => void): { node: Node; subLabel: Label | null } => {
      const t = MENU_TEXT.entries[i];
      const n = block(`entry:${t.key}`, accent, onTap, (L) => L.entries[i].outer);
      const ink = inkOf(accent);
      bind(makeChip(n, t.tag, MENU_SIZE.chip, "#0a0e1c", accent), (L) => L.entries[i].chip);
      // 名称按实测字宽左锚摆位:「生涯与商店」5 字也要贴齐左缘,中心摆会溢出块外
      const nm = kit.label(n, t.name, MENU_SIZE.name, ink, { disp: true });
      bind(nm.node, (L) => L.entries[i].name);
      const subLabel = t.sub
        ? this.txt(n, t.sub, MENU_SIZE.sub, col(ink, 0.62), (L) => L.entries[i].line!)
        : null;
      const chev = new Node("chev");
      chev.layer = n.layer;
      chev.addComponent(UITransform);
      drawChevron(chev.addComponent(Graphics), 12, ink, 0.75, 2);
      chev.setParent(n);
      bind(chev, (L) => L.entries[i].chev);
      return { node: n, subLabel };
    };

    const campaign = entry(0, ARCADE.acid, () => kit.openCampaign());
    this.campaignSub = campaign.subLabel;
    const endless = entry(1, ARCADE.good, () => kit.openEndless());
    const drill = entry(2, ARCADE.cyan, () => kit.openDrills());
    this.drillSub = drill.subLabel;
    const career = entry(3, ARCADE.paper, () => kit.openCareer());
    this.careerSub = career.subLabel;

    // ---------- 底部活动横幅(2026-10-07 活动板块):五块色块的通宽收尾条 ----------
    // 左右缘与五块那一排合拢对齐(版式里同一 rowHalf 算出来),压在色块阵与屏底之间,
    // 屏底留白 + 阵↔横幅两道缝都由 menu-layout 兜住 —— 旧版这两道缝各只剩 5 单位,
    // 宽屏上就是用户说的「被挤到下面去了」。打击橙是第六种功能色(红=上场/黄=闯关/
    // 绿=练球/青=专项/白=档案,橙=活动奖励)。有可领奖励时副行升到全亮、右侧浮一枚
    // 荧光黄「N 项可领」角签 —— 首页唯一的「有事可领」信号,refresh() 每次都按
    // Career.activityViews() 现算。
    const activity = block("entry:activity", ARCADE.hot, () => kit.openActivity(), (L) => L.banner.outer);
    this.activityNode = activity;
    bind(makeChip(activity, MENU_TEXT.banner.tag, MENU_SIZE.bannerChip, "#0a0e1c", ARCADE.hot), (L) => L.banner.chip);
    const actName = kit.label(activity, MENU_TEXT.banner.name, MENU_SIZE.bannerName, inkOf(ARCADE.hot), { disp: true });
    bind(actName.node, (L) => L.banner.name);
    this.activitySub = this.txt(activity, "", MENU_SIZE.bannerSub, col(inkOf(ARCADE.hot), 0.62), (L) => L.banner.line!);
    const actChev = new Node("act-chev");
    actChev.layer = activity.layer;
    actChev.addComponent(UITransform);
    drawChevron(actChev.addComponent(Graphics), 12, inkOf(ARCADE.hot), 0.75, 2);
    actChev.setParent(activity);
    bind(actChev, (L) => L.banner.chev);

    this.riseNodes.push(
      { node: hero, delay: 0.26 },
      { node: campaign.node, delay: 0.3 },
      { node: endless.node, delay: 0.34 },
      { node: drill.node, delay: 0.38 },
      { node: career.node, delay: 0.42 },
      { node: activity, delay: 0.46 },
    );

    // 版本号与「检查更新」不再占首页底部(用户指令:入口收进设置「关于」页)。
    // 冷启动的 24h 静默检查照旧,见 show()。

    this.paintSound();
  }

  // ---------- 建块辅助 ----------

  /** 盒心 → 节点位置:版式交的是盒子,面板只搬它的中心(全站同一条口径) */
  private place(node: Node, b: Box): void {
    node.setPosition(center(b), b.cy, 0);
  }

  /** 按当前版式摆一个「节点即盒心」的件,并挂进重摆表(show() 里可视宽变了整表重跑) */
  private bind(node: Node, get: (L: MenuLayout) => Box): void {
    const run = (): void => this.place(node, get(this.L));
    this.relayout.push(run);
    run();
  }

  /**
   * 左对齐文本盒:版式交的是「盒子」(左缘 + 宽 + 行心),这里翻译成 contentSize + 节点位置 ——
   * Cocos 的 Label 是按节点 contentSize 排字的,直接摆中心点会把整段推出卡片。
   * 注册进重摆表:可视宽一变(折叠屏展开 / 分屏换宽)格子跟着变,CLAMP 才裁在对的地方。
   */
  private txt(parent: Node, text: string, size: number, colorHex: string | Color,
    get: (L: MenuLayout) => Box, outline?: string): Label {
    // 落在遮罩上的裸文字要描边,不然亮球馆(海滩场)一冲就糊
    const l = this.kit.label(parent, text, size, colorHex,
      { align: 0, outline, outlineW: outline ? (size >= 14 ? 2 : 1) : 0 });
    const ut = l.node.getComponent(UITransform)!;
    const run = (): void => {
      const b = get(this.L);
      ut.setContentSize(width(b), b.h);
      this.place(l.node, b);
    };
    this.relayout.push(run);
    run();
    l.overflow = Label.Overflow.CLAMP;
    return l;
  }

  /**
   * 重算版式并整表重摆。可视宽 = 540 × 屏幕长宽比(FIXED_HEIGHT 下只有宽在变),
   * 折叠屏展开、分屏改宽、平板横放都会撞上来 —— 构造时那一次不够用。
   * 必须在 riseIn/slashIn **之前**跑:那两个入场读的是节点「当前坐标」当落点。
   */
  private applyLayout(): void {
    const sp = safePad();
    this.L = layoutMenu({
      visW: visibleDesignWidth(),
      safeX: Math.max(sp.left, sp.right),
      safeBottom: sp.bottom,
    });
    for (const run of this.relayout) run();
    if (this.claimChip) this.place(this.claimChip, this.L.banner.claim);
  }

  // ---------- 状态描绘 ----------

  private paintSound(): void {
    const muted = this.kit.muted;      // 两条总线都关才算「声音关」,与设置页的独立开关不冲突
    this.soundLabel.string = muted ? "声音关" : "声音开";
    this.soundLabel.color = col(muted ? "#626f96" : ARCADE.acid);
  }

  show(): void {
    cancelFade(this.root);
    this.root.active = true;
    this.applyLayout();
    this.refresh();

    // 暗底「从黑渐透」入场:先叠一层纯黑遮罩,再淡出 → 球场渐渐显出来
    if (this.dimNode) {
      const cover = new Node("dim-cover");
      cover.layer = this.dimNode.layer;
      cover.addComponent(UITransform).setContentSize(CFG.world.w, CFG.world.h);
      const wg = cover.addComponent(Widget);
      wg.isAlignTop = true; wg.top = 0;
      wg.isAlignBottom = true; wg.bottom = 0;
      wg.isAlignLeft = true; wg.left = 0;
      wg.isAlignRight = true; wg.right = 0;
      const cg = cover.addComponent(Graphics);
      cg.fillColor = new Color(5, 7, 15, 255);
      cg.rect(-2000, -1000, 4000, 2000);
      cg.fill();
      const co = cover.addComponent(UIOpacity);
      co.opacity = 255;
      cover.setParent(this.dimNode);
      tween(co).delay(0.15).to(0.55, { opacity: 0 }, { easing: "quadOut" })
        .call(() => cover.destroy()).start();
    }

    // 街机海报式入场:顶栏斩入 → 标题衬底斩入 → 文字与大色块逐级 rise
    for (const s of this.slashNodes) slashIn(s.node, s.delay, -38, -6);
    for (const r of this.riseNodes) riseIn(r.node, r.delay);
    if (this.titleBackNode) slashIn(this.titleBackNode, 0.1, -30, -4);

    // 冷启动静默检测(节流 24 小时)
    if (!this.checkedStartup && UpdateService.instance.shouldRunStartupCheck()) {
      this.checkedStartup = true;
      UpdateService.instance.checkForUpdate().then((res) => {
        if (res.status === "available" && res.info) {
          this.kit.showUpdateDialog(res.info);
        }
      }).catch(() => {
        // 静默检查异常无需打扰用户
      });
    }
  }

  hide(): void {
    fadeOutHide(this.root);   // 退场淡出:BlockInputEvents 立即放行,不拦刚开局的拇指
  }

  private refresh(): void {
    const p = Career.profile();
    this.lvLabel.string = `Lv.${p.level}`;
    this.coinLabel.string = `${p.coins}`;
    this.paintSound();
    const campCleared = CampaignManager.getClearedCount();
    const campStars = CampaignManager.getTotalStars();
    if (this.campaignSub) this.campaignSub.string = `${campCleared}/20关 · ★${campStars}星`;
    const cleared = Object.values(p.drills).filter((d) => d.stars > 0).length;
    if (this.drillSub) this.drillSub.string = `${cleared}/${DRILLS.length} 已练成 · 首通有奖`;
    const rate = p.stats.matches > 0 ? Math.round((p.stats.wins / p.stats.matches) * 100) : 0;
    if (this.careerSub) this.careerSub.string = `${p.stats.wins} 胜 · 胜率 ${rate}% · 金币 ${p.coins}`;

    // 活动横幅:进度副行 + 「N 项可领」角签(判据只吃 Career.activityViews 一份,面板同款)
    // 两支文案的**格式**与 menu-layout 的样本串同形,量宽判据才量得到这一屏真会显示的字
    const av = Career.activityViews();
    if (this.activitySub) {
      const weeklyDone = av.weekly.filter((v) => v.done).length;
      this.activitySub.string = av.anyClaimable
        ? bannerSubClaimable(av.dailyDone, av.dailyTotal, weeklyDone, av.weekly.length)
        : MENU_TEXT.banner.sub;
      this.activitySub.color = col(inkOf(ARCADE.hot), av.anyClaimable ? 1 : 0.62);
    }
    const chipText = av.claimableCount > 0 ? `${av.claimableCount} 项可领` : "";
    if (chipText !== this.claimChipText) {
      this.claimChipText = chipText;
      if (this.claimChip) { this.claimChip.destroy(); this.claimChip = null; }
      if (chipText && this.activityNode) {
        this.claimChip = makeChip(this.activityNode, chipText, MENU_SIZE.claimChip, ARCADE.acid, "#0a0e1c");
        this.place(this.claimChip, this.L.banner.claim);
      }
    }
  }
}
