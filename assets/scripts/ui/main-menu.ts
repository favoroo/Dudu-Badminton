// ============================================================
// 主菜单:像素风标题 + 单人三难度 + 功能入口 + 顶部等级/金币。
// 决策②:手机版纯单人 —— 入口只从 menuForPlatform() 取(仅 1p 三档),
// 2p / 2v2 的 MENU 条目不渲染不引用,面板上不存在这两个入口。
// 专项训练的关卡选择内嵌为菜单第二页,不另开文件。
// ============================================================
import { BlockInputEvents, Button, Color, Graphics, Label, Node, tween, UITransform, Vec2 } from "cc";
import { DRILLS, menuForPlatform } from "../core/config";
import { Career } from "../core/career";
import type { DiffKey, DrillDef } from "../core/types";
import { col } from "./ui-manager";
import type { UiKit } from "./ui-manager";
import { ARCADE, drawArcadeButton, drawHardShadow, floatLoop, makeChip, riseIn, stopLoops } from "./ui-arcade";
import { APP_VERSION_NAME } from "../core/version";
import { UpdateService } from "../core/update-service";

// 产品命名:老 MENU 的「简单/困难」在手机版叫「入门/大师」,档位与 CFG.diffs 一一对应
const CN_DIFF: Record<string, string> = { easy: "入门", normal: "普通", hard: "大师" };

const stars = (n: number): string => "★".repeat(n) + "☆".repeat(Math.max(0, 3 - n));

export class MainMenu {
  readonly root: Node;
  private kit: UiKit;
  private drillPage: Node;
  private lvLabel: Label;
  private coinLabel: Label;
  private drillStarLabels: Array<{ label: Label; id: string }> = [];
  private checkedStartup = false;
  /** rise 入场的节点队列(节点,延迟):show 时逐级展开 */
  private riseNodes: Array<{ node: Node; delay: number }> = [];
  private titleNode: Node | null = null;

  constructor(parent: Node, kit: UiKit) {
    this.kit = kit;
    const P = kit.pal;
    this.root = kit.root(parent, "main-menu");
    this.root.active = false;

    // 暗底:球场隐约可见(0.9,保留一点"场馆在身后"的氛围);BlockInputEvents 挡穿透
    kit.dim(this.root, 0.9);
    // 扫描线 + 暗角:老 #scan / .grain 的街机厅氛围
    kit.atmosphere(this.root);

    // ---------- 顶部常驻:等级 / 金币(练完关卡、买完东西立刻跟手) ----------
    const lvBadge = this.badge(-392, 246, 118, "primary");
    this.lvLabel = kit.label(lvBadge, "Lv.1", 16, "#14100a");
    this.lvLabel.node.setPosition(0, -3, 0);
    const coinBadge = this.badge(386, 246, 148, "ghost");
    this.coinLabel = kit.label(coinBadge, "🪙 0", 16, P.accent);
    this.coinLabel.node.setPosition(0, -2, 0);
    this.riseNodes.push({ node: lvBadge, delay: 0.0 }, { node: coinBadge, delay: 0.04 });

    // ---------- 街机海报标题区(老 .hero:kicker → 标题 → 副题 → 横线) ----------
    const kicker = makeChip(this.root, "ARCADE BADMINTON", 10);
    kicker.setPosition(0, 226, 0);
    this.riseNodes.push({ node: kicker, delay: 0.05 });

    // 主标题:「嘟嘟」荧光黄 +「羽毛球」暖纸白,双层 text-shadow 硬阴影
    const t1 = kit.label(this.root, "嘟嘟", 54, P.accent);
    t1.node.setPosition(-84, 188, 0);
    const t2 = kit.label(this.root, "羽毛球", 54, P.text);
    t2.node.setPosition(66, 188, 0);
    for (const t of [t1, t2]) {
      t.enableShadow = true;
      t.shadowColor = new Color(0, 0, 0, 140);
      t.shadowOffset = new Vec2(0, -6);
      this.riseNodes.push({ node: t.node, delay: 0.1 });
    }
    this.titleNode = t1.node;
    stopLoops(t2.node); // 浮动只挂在一个节点上,两个都停过再启

    const sub = kit.label(this.root, "D U D U   B A D M I N T O N", 13, P.dim, { outline: P.ink, outlineW: 1 });
    sub.node.setPosition(0, 150, 0);
    this.riseNodes.push({ node: sub.node, delay: 0.16 });

    // hero-rule:左右渐隐横线 + 中央点题(老 .hero-rule)
    const rule = new Node("hero-rule");
    rule.layer = this.root.layer;
    const rg = rule.addComponent(Graphics);
    for (let i = 0; i < 4; i++) {
      rg.fillColor = col(ARCADE.line, 0.12 + i * 0.1);
      rg.rect(-160 + i * 26, -1, 30, 2);
      rg.rect(130 - i * 26, -1, 30, 2);
    }
    rg.fill();
    rule.setParent(this.root);
    rule.setPosition(0, 128, 0);
    const ruleText = kit.label(rule, "黄昏体育馆 · 街机赛事", 11, P.accent);
    ruleText.node.setPosition(0, 0, 0);
    this.riseNodes.push({ node: rule, delay: 0.2 });

    // ---------- 单人三难度(menuForPlatform 已按 mobileOnly 裁剪,卡片化排版) ----------
    const entries = menuForPlatform();
    entries.forEach((m, i) => {
      const y = 74 - i * 72;
      const b = kit.button(this.root, "", 440, 62, { bg: P.panelLight });
      b.setPosition(0, y, 0);
      // 左对齐排版:固定宽 + CLAMP,文字贴卡片左缘(老 .mode 的左齐卡片)
      const name = kit.label(b, CN_DIFF[m.diff ?? "normal"], 21, P.accent);
      name.horizontalAlign = Label.HorizontalAlign.LEFT;
      name.overflow = Label.Overflow.CLAMP;
      name.node.getComponent(UITransform)!.setContentSize(280, 26);
      name.node.setPosition(-80, 11, 0);
      const desc = kit.label(b, m.desc, 12, P.dim);
      desc.horizontalAlign = Label.HorizontalAlign.LEFT;
      desc.overflow = Label.Overflow.CLAMP;
      desc.node.getComponent(UITransform)!.setContentSize(280, 16);
      desc.node.setPosition(-80, -14, 0);
      const chip = makeChip(b, m.tag, 9);
      chip.setPosition(178, 14, 0);
      b.on(Button.EventType.CLICK, () => {
        kit.sfx.play("ui");
        kit.startMatch(m.diff as DiffKey);
      });
      this.riseNodes.push({ node: b, delay: 0.26 + i * 0.07 });
    });

    // ---------- 功能入口 ----------
    const fns: Array<{ text: string; onClick: () => void }> = [
      { text: "专项训练", onClick: () => kit.openDrills() },
      { text: "生涯与商店", onClick: () => kit.openCareer() },
      {
        text: "球场选择",
        onClick: () => {
          const name = kit.cycleCourtTheme();
          kit.toast(`球场已切换: ${name}`);
        },
      },
    ];
    fns.forEach((f, i) => {
      const b = kit.button(this.root, f.text, 240, 54, { size: 17 });
      b.setPosition((i - 1) * 256, -150, 0);
      b.on(Button.EventType.CLICK, () => {
        kit.sfx.play("ui");
        f.onClick();
      });
      this.riseNodes.push({ node: b, delay: 0.48 + i * 0.06 });
    });

    // ---------- 底部版本号与更新检查入口 ----------
    const verBtn = kit.button(this.root, `${APP_VERSION_NAME} 检查更新`, 168, 32, {
      size: 13,
      fg: P.dim,
    });
    verBtn.setPosition(370, -238, 0);
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
    this.riseNodes.push({ node: verBtn, delay: 0.62 });

    // ---------- 第二页:专项训练选关 ----------
    this.drillPage = this.buildDrillPage();
    this.drillPage.active = false;
  }

  /** 顶部徽章:primary = 荧光黄厚底(Lv),ghost = 浮起(金币) */
  private badge(x: number, y: number, w: number, style: "primary" | "ghost"): Node {
    const n = new Node(`badge-${style}`);
    n.layer = this.root.layer;
    const g = n.addComponent(Graphics);
    drawHardShadow(g, w, 34, 8, 3, 3, 0.5);
    drawArcadeButton(g, w, 34, style, 8);
    n.setParent(this.root);
    n.setPosition(x, y, 0);
    return n;
  }

  /** 训练选关页:半透明衬底盖住第一页 + 2×3 关卡格 + 返回键 */
  private buildDrillPage(): Node {
    const kit = this.kit;
    const P = kit.pal;
    const page = new Node("drill-page");
    page.layer = this.root.layer;
    page.setParent(this.root);

    // 衬底自带 BlockInputEvents:页面打开时第一页的按钮点不到
    const veil = new Node("veil");
    veil.layer = this.root.layer;
    const vg = veil.addComponent(Graphics);
    vg.fillColor = col(P.ink, 0.88);
    vg.rect(-480, -270, 960, 540);
    vg.fill();
    veil.addComponent(BlockInputEvents);
    veil.setParent(page);

    const card = kit.panel(page, 620, 380, { r: 16, bg: P.panel, bgAlpha: 0.97, stroke: P.accent, strokeAlpha: 0.4 });
    card.node.setPosition(0, 4, 0);
    kit.label(card.node, "专项训练", 26, P.accent).node.setPosition(0, 152, 0);
    kit.label(card.node, "按提示击出目标球种 · 练成目标拍数即通关 · 首次通关发奖励", 12, P.dim).node.setPosition(0, 124, 0);

    DRILLS.forEach((d: DrillDef, i: number) => {
      const col2 = i % 2, row = Math.floor(i / 2);
      const b = kit.button(card.node, "", 276, 66, { bg: P.panelLight, stroke: P.line, strokeAlpha: 0.22 });
      b.setPosition(col2 === 0 ? -146 : 146, 62 - row * 76, 0);
      kit.label(b, `${d.tag} · ${d.label}`, 17, P.accent).node.setPosition(-18, 11, 0);
      const starLabel = kit.label(b, "", 11, P.dim);
      starLabel.node.setPosition(0, -14, 0);
      this.drillStarLabels.push({ label: starLabel, id: d.id });
      b.on(Button.EventType.CLICK, () => {
        kit.sfx.play("ui");
        kit.startDrill(d.id);
      });
    });

    const back = kit.button(card.node, "返回", 150, 44, { size: 16 });
    back.setPosition(0, -152, 0);
    back.on(Button.EventType.CLICK, () => {
      kit.sfx.play("back");
      page.active = false;
    });
    return page;
  }

  show(): void {
    this.root.active = true;
    this.drillPage.active = false;   // 每次回菜单都落在第一页
    this.refresh();

    // 街机海报式入场:kicker → 标题 → 副题 → 横线 → 卡片逐级 rise
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
    this.coinLabel.string = `🪙 ${p.coins}`;
    for (const s of this.drillStarLabels) {
      const rec = p.drills[s.id];
      s.label.string = `${rec && rec.stars > 0 ? stars(rec.stars) : "未练"} · ${(DRILLS.find((d) => d.id === s.id) as DrillDef).desc}`;
    }
  }
}
