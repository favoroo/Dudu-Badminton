// ============================================================
// 主菜单:像素风标题 + 单人三难度 + 功能入口 + 顶部等级/金币。
// 决策②:手机版纯单人 —— 入口只从 menuForPlatform() 取(仅 1p 三档),
// 2p / 2v2 的 MENU 条目不渲染不引用,面板上不存在这两个入口。
// 专项训练的关卡选择内嵌为菜单第二页,不另开文件。
// ============================================================
import { BlockInputEvents, Button, Graphics, Label, Node } from "cc";
import { DRILLS, menuForPlatform } from "../core/config";
import { Career } from "../core/career";
import type { DiffKey, DrillDef } from "../core/types";
import { col } from "./ui-manager";
import type { UiKit } from "./ui-manager";
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

  constructor(parent: Node, kit: UiKit) {
    this.kit = kit;
    const P = kit.pal;
    this.root = kit.root(parent, "main-menu");
    this.root.active = false;

    // 暗底:球场隐约可见(0.9,保留一点"场馆在身后"的氛围);BlockInputEvents 挡穿透
    kit.dim(this.root, 0.9);

    // ---------- 顶部常驻:等级 / 金币(练完关卡、买完东西立刻跟手) ----------
    this.pill(-392, 246, 118);
    this.lvLabel = kit.label(this.root, "Lv.1", 16, P.text);
    this.lvLabel.node.setPosition(-392, 246, 0);
    this.pill(386, 246, 148);
    this.coinLabel = kit.label(this.root, "🪙 0", 16, P.accent);
    this.coinLabel.node.setPosition(386, 246, 0);

    // ---------- 像素风标题 ----------
    const title = kit.label(this.root, "嘟嘟羽毛球", 54, P.accent, { outline: P.ink, outlineW: 5 });
    title.node.setPosition(0, 192, 0);
    // cc Label 无字距,手插空格做英文字距(系统字体下等效)
    const sub = kit.label(this.root, "D U D U   B A D M I N T O N", 15, P.cyan, { outline: P.ink, outlineW: 1 });
    sub.node.setPosition(0, 148, 0);
    // 标题下的像素装饰条:主条 + 两端小方块,呼应像素题字
    const barG = new Node("title-bar");
    barG.layer = this.root.layer;
    const bar = barG.addComponent(Graphics);
    bar.fillColor = col(P.accent, 0.9);
    bar.fillRect(-110, -3, 220, 6);
    bar.fillRect(-130, -2, 12, 4);
    bar.fillRect(118, -2, 12, 4);
    barG.setParent(this.root);
    barG.setPosition(0, 128, 0);

    // ---------- 单人三难度(menuForPlatform 已按 mobileOnly 裁剪) ----------
    const entries = menuForPlatform();
    entries.forEach((m, i) => {
      const y = 74 - i * 72;
      const b = kit.button(this.root, "", 410, 62, { bg: P.panelLight, stroke: P.line, strokeAlpha: 0.25 });
      b.setPosition(0, y, 0);
      kit.label(b, `${CN_DIFF[m.diff ?? "normal"]}  ${m.tag}`, 21, P.accent).node.setPosition(0, 11, 0);
      kit.label(b, m.desc, 12, P.dim).node.setPosition(0, -14, 0);
      b.on(Button.EventType.CLICK, () => {
        kit.sfx.play("ui");
        kit.startMatch(m.diff as DiffKey);
      });
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
    });

    // ---------- 底部版本号与更新检查入口 ----------
    const verBtn = kit.button(this.root, `${APP_VERSION_NAME} 检查更新`, 168, 32, {
      bg: P.panelLight,
      bgAlpha: 0.65,
      stroke: P.line,
      strokeAlpha: 0.2,
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

    // ---------- 第二页:专项训练选关 ----------
    this.drillPage = this.buildDrillPage();
    this.drillPage.active = false;
  }

  /** 小胶囊底(等级/金币的字底) */
  private pill(x: number, y: number, w: number): void {
    const n = new Node("pill");
    n.layer = this.root.layer;
    const g = n.addComponent(Graphics);
    g.fillColor = col(this.kit.pal.panelLight, 0.85);
    g.strokeColor = col(this.kit.pal.line, 0.22);
    g.lineWidth = 2;
    g.roundRect(-w / 2, -17, w, 34, 17);
    g.fill();
    g.stroke();
    n.setParent(this.root);
    n.setPosition(x, y, 0);
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
