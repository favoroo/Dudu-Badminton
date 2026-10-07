// ============================================================
// 主菜单:球场在身后,菜单是浮在场上的一层玻璃。
// 版式(P5 海报改版):等级/金币/音效条 → 标题 → 五块实底大色块。
// 底部不再挂版本号与「检查更新」(用户指令):更新整条链路收进设置「关于」页,
// 这里只留冷启动的 24h 静默检查 —— 有更新会自己弹窗,没更新不必给个按钮让人点。
// 信息架构(用户指令):「入门/普通/大师」不再铺在首页 —— 合并成左上那块
// 「对练」大色块,和闯关/无限练习/专项训练/生涯同级;点进去是模式屏
// (mode-screen.ts),球馆选择与技能胶囊也搬进了对练屏,首页只留模式入口。
// 大色块 = ui-arcade.drawSolidBlock 实底海报面,文字用色由 inkOn(accent) 定。
// 屏间转场走 ui-arcade.screenSwap(红黑斜带扫屏),进对局仍走 slashWipe。
// ============================================================
import { Button, Color, Graphics, Label, Node, tween, UIOpacity, UITransform, Vec2, Widget } from "cc";
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
import { textW } from "../core/text-metrics";
import { UpdateService } from "../game/update-service";

/** 大色块字色:亮面配墨黑,斩劈红面配纸白(由亮度算,不逐块手拍) */
const inkOf = (accent: string): string => (inkOn(accent) ? "#0a0e1c" : "#f5efe1");

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
    const backing = new Node("title-backing");
    backing.layer = this.root.layer;
    backing.addComponent(UITransform);
    const bgg = backing.addComponent(Graphics);
    drawSolidBlock(bgg, 372, 74, ARCADE.slash, 9);   // 自带硬阴影/厚底边/高光/描边
    backing.setPosition(0, 190, 0);
    backing.setParent(this.root);
    this.titleBackNode = backing;

    const t1 = kit.label(this.root, "嘟嘟", 54, P.accent, { disp: true });
    t1.node.setPosition(-81, 190, 0);
    const t2 = kit.label(this.root, "羽毛球", 54, P.text, { disp: true });
    t2.node.setPosition(54, 190, 0);
    for (const t of [t1, t2]) {
      t.enableShadow = true;
      t.shadowColor = new Color(0, 0, 0, 140);
      t.shadowOffset = new Vec2(0, -6);
      t.node.angle = 1.5;                 // 与斜切色块同向的轻微仰角
      this.riseNodes.push({ node: t.node, delay: 0.16 });
    }

    // ---------- 五块实底大色块(P5 海报面):对练为主入口,右列 2×2 ----------
    // 对练 = 左侧整柱斩劈红(进对练屏选难度/球馆/技能);
    // 右列:闯关(荧光黄)/ 无限练习(绿)/ 专项训练(青)/ 生涯与商店(纸白)。
    // 色即功能语言:红=上场、黄=闯关星星、绿=练球、青=专项、白=档案。
    const block = (
      name: string, w: number, h: number, accent: string, onTap: () => void,
    ): Node => {
      const n = new Node(name);
      n.layer = this.root.layer;
      n.addComponent(UITransform).setContentSize(w, h);
      drawSolidBlock(n.addComponent(Graphics), w, h, accent, 5);
      const b = n.addComponent(Button);
      b.transition = Button.Transition.SCALE;
      b.zoomScale = 0.96;
      b.target = n;
      n.on(Button.EventType.CLICK, () => {
        kit.sfx.play("ui");
        onTap();
      });
      n.setParent(this.root);
      return n;
    };

    // 主入口:对练(整柱大块,内容竖排)
    const hero = block("mode:match-setup", 316, 330, ARCADE.slash, () => kit.openMatchSetup());
    hero.setPosition(-298, -51, 0);
    makeChip(hero, "MATCH", 10, "#0a0e1c", ARCADE.acid).setPosition(-102, 126, 0);
    const heroName = kit.label(hero, "对练", 44, ARCADE.paper, { disp: true });
    heroName.node.setPosition(-96, 74, 0);
    this.txt(hero, "四档难度 · 选球馆 · 随时开局", 12, col(ARCADE.paper, 0.8), -104, 24, 240);
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
    dots.setPosition(-88, -22, 0);
    dots.setParent(hero);
    const heroHint = this.txt(hero, "EASY / NORMAL / HARD / EXPERT", 10, col(ARCADE.paper, 0.55), -104, -58, 240);
    heroHint.horizontalAlign = Label.HorizontalAlign.LEFT;
    const heroChev = new Node("hero-chev");
    heroChev.layer = hero.layer;
    heroChev.addComponent(UITransform);
    drawChevron(heroChev.addComponent(Graphics), 15, ARCADE.paper, 0.85, 2);
    heroChev.setPosition(112, -124, 0);
    heroChev.setParent(hero);

    /** 右列小块:EN 角签 + 名称 + 动态副行 + 箭标(整块即按钮) */
    const entry = (
      name: string, accent: string, tag: string, label: string, sub: string,
      x: number, y: number, onTap: () => void,
    ): { node: Node; subLabel: Label | null } => {
      const n = block(name, 282, 150, accent, onTap);
      n.setPosition(x, y, 0);
      const ink = inkOf(accent);
      makeChip(n, tag, 9, "#0a0e1c", accent).setPosition(-104, 46, 0);
      // 名称按实测字宽左锚摆位:「生涯与商店」5 字也要贴齐左缘,中心摆会溢出块外
      const nm = kit.label(n, label, 22, ink, { disp: true });
      nm.node.setPosition(-104 + textW(label, 22) / 2, 10, 0);
      const subLabel = sub ? this.txt(n, sub, 11, col(ink, 0.62), -104, -34, 210) : null;
      const chev = new Node("chev");
      chev.layer = n.layer;
      chev.addComponent(UITransform);
      drawChevron(chev.addComponent(Graphics), 12, ink, 0.75, 2);
      chev.setPosition(112, -8, 0);
      chev.setParent(n);
      return { node: n, subLabel };
    };

    const campaign = entry("entry:campaign", ARCADE.acid, "CHALLENGE", "闯关模式", "", 12, 40, () => kit.openCampaign());
    this.campaignSub = campaign.subLabel;
    const endless = entry("entry:endless", ARCADE.good, "ENDLESS", "无限练习", "无视比分 · 持续对拉", 318, 40, () => kit.openEndless());
    const drill = entry("entry:drill", ARCADE.cyan, "TRAIN", "专项训练", "", 12, -138, () => kit.openDrills());
    this.drillSub = drill.subLabel;
    const career = entry("entry:career", ARCADE.paper, "CAREER", "生涯与商店", "", 318, -138, () => kit.openCareer());
    this.careerSub = career.subLabel;

    // ---------- 底部活动横幅(2026-10-07 活动板块):五块色块的通宽收尾条 ----------
    // 宽度对齐五块的合拢外缘(hero 左缘 -456 → career 右缘 459),压在色块底(-213)
    // 与屏底(-270)之间;打击橙是第六种功能色(红=上场/黄=闯关/绿=练球/青=专项/白=档案,
    // 橙=活动奖励)。有可领奖励时副行升到全亮、右侧浮一枚荧光黄「N 项可领」角签 ——
    // 首页唯一的「有事可领」信号,refresh() 每次都按 Career.activityViews() 现算。
    const activity = block("entry:activity", 915, 44, ARCADE.hot, () => kit.openActivity());
    activity.setPosition(1.5, -243, 0);
    this.activityNode = activity;
    makeChip(activity, "EVENT", 9, "#0a0e1c", ARCADE.hot).setPosition(-424, 0, 0);
    const actName = kit.label(activity, "活动中心", 18, inkOf(ARCADE.hot), { disp: true });
    actName.node.setPosition(-392 + textW("活动中心", 18) / 2, 0, 0);
    this.activitySub = this.txt(activity, "", 12, col(inkOf(ARCADE.hot), 0.62), -280, 0, 500);
    const actChev = new Node("act-chev");
    actChev.layer = activity.layer;
    actChev.addComponent(UITransform);
    drawChevron(actChev.addComponent(Graphics), 12, inkOf(ARCADE.hot), 0.75, 2);
    actChev.setPosition(429, 0, 0);
    actChev.setParent(activity);

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

  /**
   * 左对齐文本:x 传「文字左缘」而不是节点中心 ——
   * Cocos 的 Label 是按节点 contentSize 排字的,直接摆中心点会把整段推出卡片。
   */
  private txt(parent: Node, text: string, size: number, colorHex: string | Color,
    left: number, y: number, w: number, lines = 1, outline?: string): Label {
    // 落在遮罩上的裸文字要描边,不然亮球馆(海滩场)一冲就糊
    const l = this.kit.label(parent, text, size, colorHex,
      { align: 0, outline, outlineW: outline ? (size >= 14 ? 2 : 1) : 0 });
    const ut = l.node.getComponent(UITransform)!;
    ut.setContentSize(w, Math.round(size * 1.35) * lines);
    l.overflow = Label.Overflow.CLAMP;
    l.node.setPosition(left + w / 2, y, 0);
    return l;
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
    const av = Career.activityViews();
    if (this.activitySub) {
      const weeklyDone = av.weekly.filter((v) => v.done).length;
      this.activitySub.string = av.anyClaimable
        ? `今日 ${av.dailyDone}/${av.dailyTotal} · 每周 ${weeklyDone}/${av.weekly.length}`
        : "完成任务领金币 · 每天 0 点刷新";
      this.activitySub.color = col(inkOf(ARCADE.hot), av.anyClaimable ? 1 : 0.62);
    }
    const chipText = av.claimableCount > 0 ? `${av.claimableCount} 项可领` : "";
    if (chipText !== this.claimChipText) {
      this.claimChipText = chipText;
      if (this.claimChip) { this.claimChip.destroy(); this.claimChip = null; }
      if (chipText && this.activityNode) {
        this.claimChip = makeChip(this.activityNode, chipText, 10, ARCADE.acid, "#0a0e1c");
        this.claimChip.setPosition(330, 0, 0);
      }
    }
  }
}
