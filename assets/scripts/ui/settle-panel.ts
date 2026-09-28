// ============================================================
// 比赛结算弹窗:VICTORY!/DEFEAT 大标语 + 终局比分 + 成长奖励结算卡。
// 数据全部来自 Career.settle() 的真实返回值(经 UIManager 桥截获),
// 训练模式吃 settleDrill + Drill.result,同屏复用一套布局。
// 经验条:从结算前快照滚到结算后档位,跨级时分段填充并逐级闪「Lv.X」;
// 满级静态显示 MAX(经济曲线只有一份,动画只负责演)。
// ============================================================
import { Button, Color, Graphics, Label, Node, Tween, tween, UIOpacity, Vec3 } from "cc";
import { CFG } from "../core/config";
import { Career } from "../core/career";
import type { SettleResult } from "../core/career";
import type { DrillResult } from "../core/drill";
import { col } from "./ui-manager";
import type { UiKit } from "./ui-manager";

export interface SettlePayload {
  kind: "match" | "drill";
  res: SettleResult | null;
  drill: DrillResult | null;
  /** 结算前的等级/经验(经验条动画起点);无桥数据时为 null */
  before: { level: number; exp: number } | null;
  scores: [number, number];
  won: boolean;
}

/** 经验条动画:分段 = 每级一段(可能跨级连升) */
interface ExpSeg { lv: number; from: number; to: number; need: number }
interface ExpAnim { segs: ExpSeg[]; total: number; elapsed: number; done: boolean; shownSeg: number }

const BAR_W = 300;
const DUR = 1.25; // 经验条整体滚动时长(s),段数多时按比例加快由 tick 内兜底

const stars = (n: number): string => "★".repeat(n) + "☆".repeat(Math.max(0, 3 - n));

export class SettlePanel {
  readonly root: Node;
  private kit: UiKit;
  private card: Node;
  private cardOp: UIOpacity;
  private verdict: Label;
  private sub: Label;
  private score: Label;
  private coinLine: Label;
  private bonusLine: Label;
  private expLine: Label;
  private lvLabel: Label;
  private barBg: Graphics;
  private barFill: Graphics;
  private barWrap: Node;
  private upLine: Label;
  private unlockLine: Label;
  private anim: ExpAnim | null = null;
  private payload: SettlePayload | null = null;
  private cMax = new Color();

  constructor(parent: Node, kit: UiKit) {
    this.kit = kit;
    const P = kit.pal;
    this.root = kit.root(parent, "settle-panel");
    this.root.active = false;
    this.cMax.fromHEX(P.dim);

    kit.dim(this.root, 0.78);

    const card = kit.panel(this.root, 540, 436, { r: 18, bg: P.panel, bgAlpha: 0.97, stroke: P.accent, strokeAlpha: 0.5 });
    this.card = card.node;
    this.card.setPosition(0, 2, 0);
    this.cardOp = this.card.addComponent(UIOpacity);

    this.verdict = kit.label(this.card, "", 48, P.accent, { outline: P.ink, outlineW: 4 });
    this.verdict.node.setPosition(0, 158, 0);
    this.sub = kit.label(this.card, "", 17, P.text);
    this.sub.node.setPosition(0, 118, 0);
    this.score = kit.label(this.card, "", 36, P.text, { outline: P.ink, outlineW: 2 });
    this.score.node.setPosition(0, 74, 0);

    // ---------- 奖励结算卡 ----------
    this.coinLine = kit.label(this.card, "", 19, P.accent);
    this.coinLine.node.setPosition(0, 32, 0);
    this.bonusLine = kit.label(this.card, "", 13, P.dim);
    this.bonusLine.node.setPosition(0, 6, 0);
    this.expLine = kit.label(this.card, "", 16, P.cyan);
    this.expLine.node.setPosition(0, -22, 0);

    // 经验条:Lv 左标 + 底槽 + 填充(填充逐帧重绘)
    this.lvLabel = kit.label(this.card, "", 14, P.text);
    this.lvLabel.node.setPosition(-238, -50, 0);
    this.barWrap = new Node("exp-bar");
    this.barWrap.layer = this.card.layer;
    this.barWrap.setPosition(18, -50, 0);
    this.barBg = this.barWrap.addComponent(Graphics);
    this.barBg.fillColor = col(P.panelLight, 1);
    this.barBg.strokeColor = col(P.line, 0.2);
    this.barBg.lineWidth = 2;
    this.barBg.roundRect(-BAR_W / 2, -7, BAR_W, 14, 7);
    this.barBg.fill();
    this.barBg.stroke();
    const fillN = new Node("fill");
    fillN.layer = this.card.layer;
    fillN.setPosition(0, 0, 0);
    fillN.setParent(this.barWrap);
    this.barFill = fillN.addComponent(Graphics);
    this.barWrap.setParent(this.card);

    this.upLine = kit.label(this.card, "", 16, P.accent, { outline: P.ink, outlineW: 1 });
    this.upLine.node.setPosition(0, -92, 0);
    this.unlockLine = kit.label(this.card, "", 14, P.cyan);
    this.unlockLine.node.setPosition(0, -124, 0);

    // ---------- 按钮 ----------
    const again = kit.button(this.card, "", 230, 54, { bg: P.accent, fg: P.ink, size: 18 });
    again.setPosition(-128, -172, 0);
    again.on(Button.EventType.CLICK, () => {
      kit.sfx.play("ui");
      this.hide();
      kit.restartCurrent();
    });
    const toMenu = kit.button(this.card, "返回主菜单", 230, 54, { size: 17 });
    toMenu.setPosition(128, -172, 0);
    toMenu.on(Button.EventType.CLICK, () => {
      kit.sfx.play("back");
      this.hide();
      kit.quitToMenu();
    });
  }

  show(p: SettlePayload): void {
    this.payload = p;
    this.root.active = true;
    const P = this.kit.pal;
    const match = p.kind === "match";
    const won = p.won;

    // 大标语:胜金败灰蓝;训练用中文,语气也不同
    this.verdict.string = match ? (won ? "VICTORY!" : "DEFEAT") : (won ? "训练完成!" : "再接再厉");
    this.verdict.color = col(won ? P.accent : "#9fb0d8");
    this.sub.string = match
      ? (won ? "你赢了" : "CPU 获胜")
      : (p.drill ? `${p.drill.def ? p.drill.def.label : ""} ${stars(p.drill.stars)}` : "");
    this.score.node.active = match;
    this.score.string = `${p.scores[0]} : ${p.scores[1]}`;

    this.fillRewards(p);
    this.anim = this.buildExpAnim(p);
    this.renderBar(true);

    // ---------- 入场:卡片弹入,标语随后砸下 ----------
    const card = this.card;
    const op = this.cardOp;
    Tween.stopAllByTarget(card);
    Tween.stopAllByTarget(this.verdict.node);
    card.setScale(0.72, 0.72, 1);
    op.opacity = 0;
    tween(card).to(0.28, { scale: new Vec3(1, 1, 1) }, { easing: "backOut" }).start();
    tween(op).to(0.2, { opacity: 255 }).start();
    this.verdict.node.setScale(1.9, 1.9, 1);
    tween(this.verdict.node)
      .delay(0.16)
      .to(0.32, { scale: new Vec3(1, 1, 1) }, { easing: "backOut" })
      .start();
  }

  hide(): void {
    this.root.active = false;
    this.anim = null;
    this.payload = null;
  }

  /** UIManager 每帧驱动:经验条滚动 + 升级闪标 */
  tick(dt: number): void {
    const a = this.anim;
    if (!this.root.active || !a || a.done) return;
    a.elapsed += dt;
    const p = Math.min(1, a.elapsed / DUR);
    let acc = a.total * p;
    let idx = a.segs.length - 1;
    let k = 0;
    for (let i = 0; i < a.segs.length; i++) {
      const len = a.segs[i].to - a.segs[i].from;
      if (acc <= len) { idx = i; k = acc; break; }
      acc -= len;
    }
    const seg = a.segs[idx];
    this.lvLabel.string = `Lv.${seg.lv}`;
    this.lvLabel.color = col(this.kit.pal.text);
    this.drawBar((seg.from + k) / seg.need);
    if (idx > a.shownSeg) {
      a.shownSeg = idx;
      this.pulseLv();
    }
    if (p >= 1) {
      a.done = true;
      this.renderBar(false);
    }
  }

  // ---------- 内部 ----------

  private fillRewards(p: SettlePayload): void {
    const res = p.res;
    if (!res) {
      // 理论上手机版不会走到这(2p 友谊赛不发奖励):只留标语和比分
      this.coinLine.string = "";
      this.bonusLine.string = "";
      this.expLine.string = "";
      this.upLine.string = "";
      this.unlockLine.string = "";
      this.lvLabel.string = "";
      this.barWrap.active = false;
      return;
    }
    this.barWrap.active = true;
    const drillNotFirst = p.kind === "drill" && res.first === false;
    this.coinLine.string = res.coin > 0
      ? `${p.kind === "drill" ? "首次通关" : "比赛奖励"} · 🪙 金币 +${res.coin}`
      : (drillNotFirst ? "已通关 · 重打不重复发奖励" : "🪙 金币 +0");
    // 明细行:基础金币(按难度)+ 表现加成 + 连胜系数
    const parts: string[] = [`基础 ${res.baseCoin}`];
    if (res.perf > 0) parts.push(`表现 +${res.perf}`);
    if (res.streakBonus > 0) parts.push(`连胜 ×${(1 + res.streakBonus).toFixed(2).replace(/0$/, "")}(${res.streak} 连胜)`);
    this.bonusLine.string = parts.join(" · ");
    this.expLine.string = res.exp > 0 ? `EXP +${res.exp}` : "本次没有经验入账";
    // 升级行:可能连升,合并成一行
    if (res.levelUps.length > 0) {
      const coinSum = res.levelUps.reduce((s, lv) => s + Career.levelCoin(lv), 0);
      this.upLine.string = res.levelUps.length > 1
        ? `⬆ 连升 ${res.levelUps.length} 级 → Lv.${res.levelUps[res.levelUps.length - 1]} · 奖励 🪙 +${coinSum}`
        : `⬆ 升级 Lv.${res.levelUps[0]} · 奖励 🪙 +${coinSum}`;
    } else {
      this.upLine.string = "";
    }
    this.unlockLine.string = res.unlocked.length > 0
      ? `🎁 新皮肤已上架商店:${res.unlocked.join(" · ")}`
      : "";
  }

  /** 经验条分段:从结算前快照走到结算后档位;满级返回 null(静态 MAX) */
  private buildExpAnim(p: SettlePayload): ExpAnim | null {
    if (!p.res || p.res.exp <= 0) return null;
    const prof = Career.profile();
    const cap = CFG.career.level.cap;
    const before = p.before ?? { level: prof.level, exp: prof.exp };
    const segs: ExpSeg[] = [];
    let lv = before.level;
    let e = Math.max(0, before.exp);
    let remain = p.res.exp;
    while (remain > 0 && lv < cap) {
      const need = Career.expNeed(lv);
      const to = Math.min(need, e + remain);
      segs.push({ lv, from: e, to, need });
      remain -= to - e;
      if (to >= need) { lv++; e = 0; } else { e = to; }
    }
    if (!segs.length) return null;
    return {
      segs,
      total: segs.reduce((s, x) => s + (x.to - x.from), 0),
      elapsed: 0,
      done: false,
      shownSeg: 0,
    };
  }

  /** 最终帧:结算后的真实档位;满级画满格 + MAX */
  private renderBar(initial: boolean): void {
    if (!this.barWrap.active) return;   // 无奖励结算:整条经验区都不亮,Lv 字样也别留
    const prof = Career.profile();
    const cap = CFG.career.level.cap;
    if (prof.level >= cap) {
      this.lvLabel.string = "Lv.MAX";
      this.lvLabel.color = this.cMax;
      this.drawBar(1);
      return;
    }
    if (initial && this.payload && this.payload.before) {
      const before = this.payload.before;
      if (before.level < cap && this.payload.res && this.payload.res.exp > 0) {
        this.lvLabel.string = `Lv.${before.level}`;
        this.lvLabel.color = col(this.kit.pal.text);
        this.drawBar(Math.min(1, before.exp / Career.expNeed(before.level)));
        return;
      }
    }
    this.lvLabel.string = `Lv.${prof.level}`;
    this.lvLabel.color = col(this.kit.pal.text);
    this.drawBar(Math.min(1, prof.exp / Career.expNeed(prof.level)));
  }

  /** 填充条逐帧重绘((Graphics)为保留型画布,先 clear 再画) */
  private drawBar(ratio: number): void {
    const g = this.barFill;
    g.clear();
    const r = Math.max(0, Math.min(1, ratio));
    if (r <= 0.02) return;
    // 半径 7 > 高 14 的一半会画崩,短段时收窄成胶囊
    const w = Math.max(14, BAR_W * r);
    g.fillColor = col(this.kit.pal.accent);
    g.roundRect(-BAR_W / 2, -7, w, 14, 7);
    g.fill();
  }

  private pulseLv(): void {
    const n = this.lvLabel.node;
    Tween.stopAllByTarget(n);
    n.setScale(1.6, 1.6, 1);
    tween(n).to(0.3, { scale: new Vec3(1, 1, 1) }, { easing: "backOut" }).start();
  }
}
