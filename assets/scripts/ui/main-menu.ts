// ============================================================
// 主菜单:球场在身后,菜单是浮在场上的一层玻璃。
// 版面自上而下:等级/金币/音效条 → 球馆铭牌 → 标题 → 赛制横线 →
// 球馆选择 → 三档难度卡 → 训练/生涯入口 → 玩法提示 → 版本。
// 决策②:手机版纯单人 —— 入口只从 menuForPlatform() 取(仅 1p 三档),
// 2p / 2v2 的 MENU 条目不渲染不引用,面板上不存在这两个入口。
// ============================================================
import { Button, Color, Graphics, Label, Node, tween, UIOpacity, UITransform, Vec2, Widget } from "cc";
import { CFG, DRILLS, menuForPlatform } from "../core/config";
import { Career } from "../core/career";
import type { DiffKey } from "../core/types";
import { col } from "./ui-manager";
import type { UiKit } from "./ui-manager";
import {
  ARCADE, drawArcadeButton, drawChevron, drawHardShadow, drawMenuCard,
  floatLoop, makeChip, makeCoinIcon, riseIn, stopLoops,
} from "./ui-arcade";
import type { MenuCardOpts } from "./ui-arcade";
import { APP_VERSION_NAME } from "../core/version";
import { UpdateService } from "../core/update-service";

/** 建卡参数:绘图选项 + 本文件才关心的圆角/阴影强度 */
type CardOpts = MenuCardOpts & { r?: number; shadow?: number };

// 产品命名:老 MENU 的「简单/困难」在手机版叫「入门/普通/大师」,档位与 CFG.diffs 一一对应
const CN_DIFF: Record<string, string> = { easy: "入门", normal: "普通", hard: "大师" };
/** 三档各自的强调色:绿 → 荧光黄 → 橙红,一眼看出强度 */
const DIFF_ACCENT: Record<string, string> = { easy: "#7dff9e", normal: "#ffe14d", hard: "#ff6a1f" };

const DIM_SUB = "#93a0c4";     // 老 .mode .m-desc
const DIM_FAINT = "#6f7ca6";   // 老 .hint / .hero-kicker

export class MainMenu {
  readonly root: Node;
  private kit: UiKit;
  private lvLabel: Label;
  private coinLabel: Label;
  private soundLabel: Label;
  private kickerLabel: Label;
  /** 球馆 tab:选中态要重画底块 + 亮「使用中」角标,故缓存这两样 */
  private courtTabs: Array<{ g: Graphics; name: Label; flag: Node; id: string; accent: string }> = [];
  private careerSub: Label;
  private drillSub: Label;
  private checkedStartup = false;
  /** rise 入场的节点队列(节点,延迟):show 时逐级展开 */
  private riseNodes: Array<{ node: Node; delay: number }> = [];
  private titleNode: Node | null = null;
  /** 半透明暗底节点:入场时从全黑淡到半透,让身后球场渐渐显出来 */
  private dimNode: Node | null = null;

  constructor(parent: Node, kit: UiKit) {
    this.kit = kit;
    const P = kit.pal;
    this.root = kit.root(parent, "main-menu");
    this.root.active = false;

    // 暗底:中心只压到 0.22,四周收到 0.5 —— 换球馆时身后那座场子清晰可见
    this.dimNode = kit.dim(this.root, 0.22, 0.5);
    // 扫描线 + 暗角:老 #scan / .grain 的街机厅氛围(轻量,不能再糊一层)
    kit.atmosphere(this.root);

    // ---------- 顶部条:等级(左) / 金币 + 声音 + 设置(右) ----------
    // 四块都收在 ±448 内:16:9 屏(FIXED_HEIGHT 下可见宽正好 960)也不贴到边。
    const lvBadge = this.badge(-380, 246, 118, "primary");
    this.lvLabel = kit.label(lvBadge, "Lv.1", 16, "#14100a");
    this.lvLabel.node.setPosition(0, -3, 0);

    const coinBadge = this.badge(236, 246, 128, "ghost");
    makeCoinIcon(coinBadge, -42, -2, 9);   // Graphics 金币(替代 🪙 emoji,原生平台无彩色 emoji 字体)
    this.coinLabel = kit.label(coinBadge, "0", 16, P.accent);
    this.coinLabel.node.setPosition(6, -2, 0);

    // 「声音」= 音效 + 音乐两条总线一起切(单独的开关在设置页里)
    const soundBadge = this.badge(341, 246, 66, "ghost");
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

    const setBadge = this.badge(414, 246, 64, "ghost");
    kit.label(setBadge, "设置", 13, ARCADE.acid);
    const setBtn = setBadge.addComponent(Button);
    setBtn.transition = Button.Transition.SCALE;
    setBtn.zoomScale = 0.94;
    setBtn.target = setBadge;
    setBadge.on(Button.EventType.CLICK, () => {
      kit.sfx.play("ui");
      kit.openSettings();
    });

    this.riseNodes.push(
      { node: lvBadge, delay: 0.0 }, { node: coinBadge, delay: 0.04 },
      { node: soundBadge, delay: 0.08 }, { node: setBadge, delay: 0.12 },
    );

    // ---------- 球馆铭牌(老 .hero-kicker:跟着当前球馆走) ----------
    this.kickerLabel = this.txt(this.root, kit.getCourtTheme().sub, 11, DIM_FAINT, -240, 200, 480, 1, P.ink);
    this.kickerLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
    this.riseNodes.push({ node: this.kickerLabel.node, delay: 0.12 });

    // ---------- 街机海报标题:「嘟嘟」荧光黄 +「羽毛球」暖纸白 ----------
    const t1 = kit.label(this.root, "嘟嘟", 54, P.accent);
    t1.node.setPosition(-81, 164, 0);
    const t2 = kit.label(this.root, "羽毛球", 54, P.text);
    t2.node.setPosition(54, 164, 0);
    for (const t of [t1, t2]) {
      t.enableShadow = true;
      t.shadowColor = new Color(0, 0, 0, 140);
      t.shadowOffset = new Vec2(0, -6);
      this.riseNodes.push({ node: t.node, delay: 0.16 });
    }
    this.titleNode = t1.node;
    stopLoops(t2.node); // 浮动只挂在一个节点上,两个都停过再启

    // ---------- 赛制横线(老 .hero-rule:左右渐隐 + 中央点题) ----------
    const rule = new Node("hero-rule");
    rule.layer = this.root.layer;
    const rg = rule.addComponent(Graphics);
    for (let i = 0; i < 4; i++) {
      rg.fillColor = col(ARCADE.line, 0.1 + i * 0.08);
      rg.rect(-170 + i * 26, -1, 30, 2);
      rg.rect(140 - i * 26, -1, 30, 2);
    }
    rg.fill();
    rule.setParent(this.root);
    rule.setPosition(0, 124, 0);
    kit.label(rule, `${CFG.scoring.winScore} 分制 · 单局决胜`, 11, P.accent).node.setPosition(0, 0, 0);
    this.riseNodes.push({ node: rule, delay: 0.22 });

    // ---------- 球馆选择(老 .court-picker:名称 + 描述,选中描边该馆主题色) ----------
    kit.courtThemes().forEach((c, i) => {
      const { node, g } = this.card(`court:${c.id}`, 200, 48, { r: 10, edge: 0, bar: 0, alpha: 0.82 });
      node.setPosition((i - 1.5) * 212, 80, 0);
      const name = this.txt(node, c.name, 14, P.text, -88, 13, 96);
      this.txt(node, c.tag, 10, DIM_FAINT, -88, -13, 100);
      // 「使用中」角标:选中才亮,贴在卡片右上角
      const flag = new Node("flag");
      flag.layer = this.root.layer;
      flag.addComponent(UITransform).setContentSize(52, 18);
      const fg = flag.addComponent(Graphics);
      fg.fillColor = col(c.accent);
      fg.roundRect(-26, -9, 52, 18, 4);
      fg.fill();
      kit.label(flag, "使用中", 10, "#0a0e1c").node.setPosition(0, 0, 0);
      flag.setPosition(62, 13, 0);
      flag.setParent(node);

      node.on(Button.EventType.CLICK, () => {
        kit.sfx.play("ui");
        kit.setCourtTheme(c.id);
        this.kickerLabel.string = c.sub;
        this.paintCourts();
        kit.toast(`球馆已切换 · ${c.name}`);
      });
      this.courtTabs.push({ g, name, flag, id: c.id, accent: c.accent });
      this.riseNodes.push({ node, delay: 0.26 + i * 0.03 });
    });

    // ---------- 单人三难度:横排三张实底卡,整卡即按钮 ----------
    // 染色强度随档位递增:入门冷静 → 大师发烫,颜色本身就在报难度
    menuForPlatform().forEach((m, i) => {
      const diff = (m.diff ?? "normal") as DiffKey;
      const accent = DIFF_ACCENT[diff];
      const { node } = this.card(`mode:${diff}`, 268, 104, {
        r: 12, accent, tint: 0.09 + i * 0.045, bar: 5, edge: 5, alpha: 0.9,
      });
      node.setPosition((i - 1) * 280, -34, 0);
      makeChip(node, m.tag ?? diff.toUpperCase(), 9, accent, "#0a0e1c").setPosition(98, 34, 0);
      this.txt(node, CN_DIFF[diff], 22, accent, -108, 14, 150);
      this.txt(node, m.desc, 11, DIM_SUB, -108, -26, 212);
      node.on(Button.EventType.CLICK, () => {
        kit.sfx.play("ui");
        kit.startMatch(diff);
      });
      this.riseNodes.push({ node, delay: 0.4 + i * 0.06 });
    });

    // ---------- 功能入口(老 .career-entry:色块标签 + 现状一行 + 右侧箭标) ----------
    const career = this.card("entry:career", 408, 62, {
      r: 12, accent: ARCADE.cyan, tint: 0.1, bar: 5, edge: 4, alpha: 0.9,
    });
    career.node.setPosition(-212, -134, 0);
    makeChip(career.node, "TRAINING", 9, ARCADE.cyan, "#04121a").setPosition(-156, 8, 0);
    this.txt(career.node, "专项训练", 19, ARCADE.paper, -116, 8, 120);
    this.drillSub = this.txt(career.node, "", 11, DIM_FAINT, -116, -16, 258);
    this.arrow(career.node, ARCADE.cyan);

    const shop = this.card("entry:shop", 408, 62, {
      r: 12, accent: ARCADE.acid, tint: 0.1, bar: 5, edge: 4, alpha: 0.9,
    });
    shop.node.setPosition(212, -134, 0);
    makeChip(shop.node, "CAREER", 9, ARCADE.acid, "#0a0e1c").setPosition(-156, 8, 0);
    this.txt(shop.node, "生涯与商店", 19, ARCADE.paper, -116, 8, 130);
    this.careerSub = this.txt(shop.node, "", 11, DIM_FAINT, -116, -16, 258);
    this.arrow(shop.node, ARCADE.acid);

    career.node.on(Button.EventType.CLICK, () => { kit.sfx.play("ui"); kit.openDrills(); });
    shop.node.on(Button.EventType.CLICK, () => { kit.sfx.play("ui"); kit.openCareer(); });
    this.riseNodes.push({ node: career.node, delay: 0.58 }, { node: shop.node, delay: 0.63 });

    // ---------- 玩法提示:落点教学只在发球那一次说(hud.ts 状态行),首页不再复述 ----------

    // ---------- 底部版本号与更新检查入口 ----------
    const verBtn = kit.button(this.root, `${APP_VERSION_NAME} 检查更新`, 200, 30, { size: 13, fg: P.dim });
    verBtn.setPosition(0, -230, 0);
    verBtn.on(Button.EventType.CLICK, async () => {
      kit.sfx.play("ui");
      kit.toast("正在检查更新...");
      try {
        const res = await UpdateService.instance.checkForUpdate();
        if (res.status === "available" && res.info) {
          kit.showUpdateDialog(res.info);
        } else if (res.status === "up_to_date") {
          kit.toast(`当前已是最新版本 ${APP_VERSION_NAME}`);
        } else {
          kit.toast(res.error || "检查更新失败，请稍后重试");
        }
      } catch {
        kit.toast("网络连接失败，请稍后重试");
      }
    });
    this.riseNodes.push({ node: verBtn, delay: 0.7 });

    this.paintCourts();
    this.paintSound();
  }

  // ---------- 建块辅助 ----------

  /**
   * 左对齐文本:x 传「文字左缘」而不是节点中心 ——
   * Cocos 的 Label 是按节点 contentSize 排字的,直接摆中心点会把整段推出卡片。
   */
  private txt(parent: Node, text: string, size: number, colorHex: string,
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

  /** 实底菜单卡节点:自带 Button(SCALE) 与硬阴影;返回 Graphics 供状态变化时重画 */
  private card(name: string, w: number, h: number, o: CardOpts): { node: Node; g: Graphics } {
    const r = o.r ?? 12;
    const n = new Node(name);
    n.layer = this.root.layer;
    n.addComponent(UITransform).setContentSize(w, h);
    const g = n.addComponent(Graphics);
    // 阴影要探出厚底边之下才读得出「浮起」,故 dy 跟着 edge 走
    drawHardShadow(g, w, h, r, 5, (o.edge ?? 4) + 3, o.shadow ?? 0.5);
    drawMenuCard(g, w, h, r, o);
    const b = n.addComponent(Button);
    b.transition = Button.Transition.SCALE;
    b.zoomScale = 0.96;
    b.target = n;
    n.setParent(this.root);
    return { node: n, g };
  }

  /** 入口条右侧箭标:一眼看出「这格点进去还有下一页」,而不是一个信息块 */
  private arrow(parent: Node, hex: string): void {
    const n = new Node("arrow");
    n.layer = this.root.layer;
    n.addComponent(UITransform).setContentSize(24, 20);
    drawChevron(n.addComponent(Graphics), 11, hex, 0.8, 2);
    n.setParent(parent);
    n.setPosition(182, 0, 0);
  }

  /** 顶部徽章:primary = 荧光黄厚底(Lv),ghost = 玻璃(金币 / 音效) */
  private badge(x: number, y: number, w: number, style: "primary" | "ghost"): Node {
    const n = new Node(`badge:${style}:${w}`);
    n.layer = this.root.layer;
    n.addComponent(UITransform).setContentSize(w, 34);
    const g = n.addComponent(Graphics);
    drawHardShadow(g, w, 34, 8, 3, 3, 0.42);
    if (style === "primary") drawArcadeButton(g, w, 34, "primary", 8);
    else drawMenuCard(g, w, 34, 8, { edge: 0, bar: 0, alpha: 0.85 });
    n.setParent(this.root);
    n.setPosition(x, y, 0);
    return n;
  }

  // ---------- 状态描绘 ----------

  /** 球馆 tab:选中 = 该馆主题色实底 + 描边点亮 + 亮「使用中」角标 */
  private paintCourts(): void {
    const curId = this.kit.getCourtTheme().id;
    for (const t of this.courtTabs) {
      const active = t.id === curId;
      t.g.clear();
      drawHardShadow(t.g, 200, 48, 10, 5, 7, active ? 0.52 : 0.34);
      drawMenuCard(t.g, 200, 48, 10, {
        accent: active ? t.accent : undefined,
        tint: 0.14, bar: 0, edge: active ? 4 : 0,
        alpha: active ? 0.92 : 0.82, active,
      });
      t.name.color = col(active ? ARCADE.paper : "#a7b6dd");
      t.flag.active = active;
    }
  }

  private paintSound(): void {
    const muted = this.kit.muted;      // 两条总线都关才算「声音关」,与设置页的独立开关不冲突
    this.soundLabel.string = muted ? "声音关" : "声音开";
    this.soundLabel.color = col(muted ? "#626f96" : ARCADE.acid);
  }

  show(): void {
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

    // 街机海报式入场:铭牌 → 标题 → 横线 → 卡片逐级 rise
    for (const r of this.riseNodes) riseIn(r.node, r.delay);
    // 标题浮动等 rise 落位后再起(floatLoop 会停掉同一节点的位移动画)
    if (this.titleNode) {
      const tn = this.titleNode;
      tween(tn).delay(0.8).call(() => { if (tn.isValid && this.root.active) floatLoop(tn, 3, 1.6); }).start();
    }

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
    this.root.active = false;
  }

  private refresh(): void {
    const p = Career.profile();
    this.lvLabel.string = `Lv.${p.level}`;
    this.coinLabel.string = `${p.coins}`;
    this.paintSound();
    // 铭牌跟随当前球馆(老 ui.js heroKicker)
    this.kickerLabel.string = this.kit.getCourtTheme().sub;
    this.paintCourts();
    const cleared = Object.values(p.drills).filter((d) => d.stars > 0).length;
    this.drillSub.string = `${cleared}/${DRILLS.length} 已练成 · 首通有奖`;
    const rate = p.stats.matches > 0 ? Math.round((p.stats.wins / p.stats.matches) * 100) : 0;
    this.careerSub.string = `${p.stats.wins} 胜 · 胜率 ${rate}% · 金币 ${p.coins}`;
  }
}
