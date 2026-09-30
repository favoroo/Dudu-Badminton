// ============================================================
// 比赛结算弹窗:VICTORY!/DEFEAT 大标语 + 终局比分 + 成长奖励结算卡。
// 数据全部来自 Career.settle() 的真实返回值(经 UIManager 桥截获),
// 训练模式吃 settleDrill + Drill.result,同屏复用一套布局。
// 经验条:从结算前快照滚到结算后档位,跨级时分段填充并逐级闪「Lv.X」;
// 满级静态显示 MAX(经济曲线只有一份,动画只负责演)。
// ============================================================
import { Button, Color, Graphics, Label, Node, Tween, tween, UIOpacity, UITransform, Vec2, Vec3 } from "cc";
import { CFG } from "../core/config";
import { Career } from "../core/career";
import type { SettleResult } from "../core/career";
import type { DrillResult } from "../core/drill";
import { col } from "./ui-manager";
import type { UiKit } from "./ui-manager";
import { ARCADE, cancelFade, drawMenuCard, drawSlantShadow, fadeOutHide, retainedDraw, slantPath, skewOf } from "./ui-arcade";

/** 荣誉称号(老 ui.js evaluateTitle 的返回,文案已换 BMP 安全符号) */
export interface SettleBadge { title: string; color: string }

/** 结算统计格(老 .stats 的 .stat:大数 + 小标签 + 点缀色) */
export interface SettleStat { v: string; k: string; tone?: "gold" | "hot" | "cyan" | "plain" }

export interface SettlePayload {
  kind: "match" | "drill";
  res: SettleResult | null;
  drill: DrillResult | null;
  /** 结算前的等级/经验(经验条动画起点);无桥数据时为 null */
  before: { level: number; exp: number } | null;
  scores: [number, number];
  won: boolean;
  /** 比赛模式的荣誉称号(训练模式为 null) */
  badge: SettleBadge | null;
  /** 六格战报:比赛看全场数据,训练看这一份账 */
  stats: SettleStat[];
}

/** 经验条动画:分段 = 每级一段(可能跨级连升) */
interface ExpSeg { lv: number; from: number; to: number; need: number }
interface ExpAnim { segs: ExpSeg[]; total: number; elapsed: number; done: boolean; shownSeg: number }

const BAR_W = 320;
const DUR = 1.25; // 经验条整体滚动时长(s),段数多时按比例加快由 tick 内兜底

/** 卡片尺寸:统计六格 + 奖励区 + 双按钮都塞得下,四周又还留得住球场(老 .panel.result) */
const CW = 560, CH = 490;
const CELL_W = 168, CELL_H = 48, CELL_GAP = 8;
/** 战报两行的纵坐标(卡片中心为原点) */
const STAT_Y = 76;

const stars = (n: number): string => "★".repeat(n) + "☆".repeat(Math.max(0, 3 - n));

export class SettlePanel {
  readonly root: Node;
  private kit: UiKit;
  private card: Node;
  private cardOp: UIOpacity;
  private verdict: Label;
  private sub: Label;
  private score: Label;
  private titleBadge: Label;
  private badgeBg: Graphics;
  private statLayer: Node;
  private coinLine: Label;
  private bonusLine: Label;
  private lvLabel: Label;
  private barBg: Graphics;
  private barFill: Graphics;
  private barWrap: Node;
  private newsLine: Label;
  private againLabel: Label | null;
  private anim: ExpAnim | null = null;
  private payload: SettlePayload | null = null;
  private cMax = new Color();

  constructor(parent: Node, kit: UiKit) {
    this.kit = kit;
    const P = kit.pal;
    this.root = kit.root(parent, "settle-panel");
    this.root.active = false;
    this.cMax.fromHEX(P.dim);

    kit.dim(this.root, 0.28, 0.55);
    kit.atmosphere(this.root);

    const card = kit.panel(this.root, CW, CH, { r: 18, alpha: 0.91 });
    this.card = card.node;
    this.card.setPosition(0, 2, 0);
    this.cardOp = this.card.addComponent(UIOpacity);

    // 大标语斜切衬底(P5):胜利时红色斩劈块,失败/训练不亮
    const verdictBg = new Node("verdict-bg");
    verdictBg.layer = this.card.layer;
    verdictBg.addComponent(UITransform);
    const vbg = verdictBg.addComponent(Graphics);
    const vsk = skewOf(88, 9);
    drawSlantShadow(vbg, 470, 88, vsk, 7, 7, 0.55);
    vbg.fillColor = col(ARCADE.slash, 0.96);
    slantPath(vbg, 470, 88, vsk);
    vbg.fill();
    vbg.strokeColor = col("#ff6b72", 0.5);
    vbg.lineWidth = 1.5;
    slantPath(vbg, 470, 88, vsk);
    vbg.stroke();
    verdictBg.setPosition(0, 198, 0);
    verdictBg.setParent(this.card);
    verdictBg.active = false;

    this.verdict = kit.label(this.card, "", 42, P.text, { outline: P.ink, outlineW: 2, disp: true });
    this.verdict.node.setPosition(0, 198, 0);
    this.verdict.node.angle = 2;
    this.verdict.enableShadow = true;
    this.verdict.shadowColor = new Color(0, 0, 0, 140);
    this.verdict.shadowOffset = new Vec2(0, -5);
    // 比分(比赛)与关卡名(训练)共用同一个位置,同屏只亮一个
    this.sub = kit.label(this.card, "", 15, P.text);
    this.sub.node.setPosition(0, 158, 0);
    this.score = kit.label(this.card, "", 34, P.text, { disp: true });
    this.score.node.setPosition(0, 158, 0);
    this.score.node.angle = 7;   // 老 .final 的斜切数字
    this.score.enableShadow = true;
    this.score.shadowColor = new Color(0, 0, 0, 128);
    this.score.shadowOffset = new Vec2(0, -3);

    // 荣誉称号胶囊(老 .match-badge:比分下方的圆角小条,颜色随战绩变化)
    const badgeWrap = new Node("badge-pill");
    badgeWrap.layer = this.card.layer;
    badgeWrap.addComponent(UITransform).setContentSize(CW - 60, 26);
    badgeWrap.setParent(this.card);
    badgeWrap.setPosition(0, 124, 0);
    this.badgeBg = badgeWrap.addComponent(Graphics);
    this.titleBadge = kit.label(badgeWrap, "", 13, P.accent, { outline: P.ink, outlineW: 1 });

    // 六格战报(老 .stats:grid-template-columns:repeat(3,1fr))
    this.statLayer = new Node("stats");
    this.statLayer.layer = this.card.layer;
    this.statLayer.addComponent(UITransform);
    this.statLayer.setParent(this.card);

    // ---------- 奖励:一行大数 + 一行明细 ----------
    this.coinLine = kit.label(this.card, "", 17, P.accent);
    this.coinLine.node.setPosition(0, -34, 0);
    this.bonusLine = kit.label(this.card, "", 12, P.dim);
    this.bonusLine.node.setPosition(0, -56, 0);

    // 经验条:Lv 左标 + 底槽 + 填充(填充逐帧重绘)
    this.lvLabel = kit.label(this.card, "", 14, P.text);
    this.lvLabel.node.setPosition(-CW / 2 + 44, -82, 0);
    this.barWrap = new Node("exp-bar");
    this.barWrap.layer = this.card.layer;
    this.barWrap.setPosition(24, -82, 0);
    this.barBg = this.barWrap.addComponent(Graphics);
    // 2p 友谊赛不发奖励时整条会 active=false,再显示就得重画(原生侧 onDisable 清渲染数据)
    retainedDraw(this.barBg, () => {
      this.barBg.fillColor = col(P.panelLight, 0.85);
      this.barBg.strokeColor = col(P.line, 0.2);
      this.barBg.lineWidth = 2;
      this.barBg.roundRect(-BAR_W / 2, -7, BAR_W, 14, 7);
      this.barBg.fill();
      this.barBg.stroke();
    });
    const fillN = new Node("fill");
    fillN.layer = this.card.layer;
    fillN.setPosition(0, 0, 0);
    fillN.setParent(this.barWrap);
    this.barFill = fillN.addComponent(Graphics);
    this.barWrap.setParent(this.card);

    // 升级 / 商店上新:合到一行两格高,免得某一帧突然把按钮顶下去
    this.newsLine = kit.label(this.card, "", 14, P.accent, { outline: P.ink, outlineW: 1 });
    this.newsLine.node.setPosition(0, -118, 0);
    this.newsLine.node.getComponent(UITransform)!.setContentSize(CW - 60, 44);
    this.newsLine.overflow = Label.Overflow.SHRINK;
    this.newsLine.lineHeight = 20;

    // ---------- 按钮 ----------
    const again = kit.button(this.card, "", 240, 52, { style: "primary", size: 18 });
    again.setPosition(-128, -190, 0);
    // 文案随模式在 show() 里设置(老 index.html:「再来一局」/「再练一次」)
    this.againLabel = again.getChildByName("label")?.getComponent(Label) ?? null;
    again.on(Button.EventType.CLICK, () => {
      kit.sfx.play("ui");
      this.hide();
      kit.restartCurrent();
    });
    const toMenu = kit.button(this.card, "返回主菜单", 240, 52, { size: 17 });
    toMenu.setPosition(128, -190, 0);
    toMenu.on(Button.EventType.CLICK, () => {
      kit.sfx.play("back");
      this.hide();
      kit.quitToMenu();
    });
  }

  /** 战报六格:格数固定 6,节点复用,只换文案与颜色 */
  private renderStats(rows: SettleStat[]): void {
    const P = this.kit.pal;
    const TONE: Record<string, string> = { gold: P.accent, hot: "#ff6a1f", cyan: P.cyan, plain: P.text };
    const cells = this.statLayer.children;
    for (let i = 0; i < 6; i++) {
      let cell = cells[i];
      if (!cell) {
        cell = new Node(`stat-${i}`);
        cell.layer = this.card.layer;
        cell.addComponent(UITransform).setContentSize(CELL_W, CELL_H);
        const g = cell.addComponent(Graphics);
        // 格子按「这一局有没有这条数据」逐个开关(见下面 cell.active),底块得能重放
        retainedDraw(g, () => drawMenuCard(g, CELL_W, CELL_H, 9, { edge: 0, bar: 0, alpha: 0.6 }));
        this.kit.label(cell, "", 20, P.text).node.setPosition(0, 8, 0);   // 大数
        this.kit.label(cell, "", 12, P.dim).node.setPosition(0, -13, 0);  // 标签
        cell.setParent(this.statLayer);
      }
      const r = rows[i];
      cell.active = !!r;
      if (!r) continue;
      const col2 = i % 3, row = Math.floor(i / 3);
      cell.setPosition((col2 - 1) * (CELL_W + CELL_GAP), STAT_Y - row * (CELL_H + CELL_GAP), 0);
      const big = cell.children[0].getComponent(Label)!;
      const cap = cell.children[1].getComponent(Label)!;
      big.string = r.v;
      big.color = col(TONE[r.tone ?? "plain"]);
      cap.string = r.k;
    }
  }

  /** 荣誉胶囊:底块宽度跟着字数走(老 .match-badge 的 fit-content) */
  private renderBadge(b: SettleBadge | null): void {
    this.badgeBg.node.active = !!b;
    if (!b) return;
    let cw = 0;
    for (let i = 0; i < b.title.length; i++) cw += b.title.charCodeAt(i) > 255 ? 1 : 0.6;
    const w = Math.min(CW - 60, Math.round(cw * 13 + 34));
    const g = this.badgeBg;
    g.clear();
    g.fillColor = col("#ffffff", 0.1);
    g.roundRect(-w / 2, -13, w, 26, 13);
    g.fill();
    g.strokeColor = col(b.color, 0.75);
    g.lineWidth = 1.5;
    g.roundRect(-w / 2, -13, w, 26, 13);
    g.stroke();
    this.titleBadge.string = b.title;
    this.titleBadge.color = col(b.color);
  }

  show(p: SettlePayload): void {
    cancelFade(this.root);
    this.payload = p;
    this.root.active = true;
    const P = this.kit.pal;
    const match = p.kind === "match";
    const won = p.won;

    // 大标语:胜利压在红衬纸上;训练用中文,语气也不同(老 .verdict / .verdict.lose)
    this.verdict.string = match ? (won ? "VICTORY!" : "DEFEAT") : (won ? "训练完成!" : "再接再厉");
    this.verdict.color = col(won ? P.text : P.dim);
    // 红衬纸只在「比赛获胜」时亮(失败/训练标语直接压在面板上)
    (this.card.getChildByName("verdict-bg"))!.active = match && won;
    this.score.node.active = match;
    this.sub.node.active = !match;
    this.score.string = `${p.scores[0]} : ${p.scores[1]}`;
    this.sub.string = p.drill ? `${p.drill.def ? p.drill.def.label : ""} ${stars(p.drill.stars)}` : "";
    // 主行动按钮文案:比赛「再来一局」,训练「再练一次」(老 btnAgain/btnDrillAgain)
    if (this.againLabel) this.againLabel.string = match ? "再来一局" : "再练一次";
    // 荣誉称号:比赛模式才显示(老 .matchBadge)
    this.renderBadge(match ? p.badge : null);
    this.renderStats(p.stats);

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
    fadeOutHide(this.root);
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
      this.newsLine.string = "";
      this.lvLabel.string = "";
      this.barWrap.active = false;
      return;
    }
    this.barWrap.active = true;
    const drillNotFirst = p.kind === "drill" && res.first === false;
    this.coinLine.string = res.coin > 0
      ? `${p.kind === "drill" ? "首次通关" : "比赛奖励"} 金币 +${res.coin} · 经验 +${res.exp}`
      : (drillNotFirst ? "已通关 · 重打不重复发奖励" : "金币 +0");
    // 明细行:基础金币(按难度)+ 表现加成 + 连胜系数
    const parts: string[] = [`基础 ${res.baseCoin}`];
    if (res.perf > 0) parts.push(`表现 +${res.perf}`);
    if (res.streakBonus > 0) parts.push(`连胜 ×${(1 + res.streakBonus).toFixed(2).replace(/0$/, "")}(${res.streak} 连胜)`);
    // 明细恒在:没经验时也照样把「基础/表现/连胜」摊开,不用另写一句"本次没有经验入账"
    this.bonusLine.string = parts.join(" · ");

    const news: string[] = [];
    if (res.levelUps.length > 0) {
      const coinSum = res.levelUps.reduce((s, lv) => s + Career.levelCoin(lv), 0);
      news.push(res.levelUps.length > 1
        ? `↑ 连升 ${res.levelUps.length} 级 → Lv.${res.levelUps[res.levelUps.length - 1]} · 奖励金币 +${coinSum}`
        : `↑ 升级 Lv.${res.levelUps[0]} · 奖励金币 +${coinSum}`);
    }
    if (res.unlocked.length > 0) news.push(`新品上架:${res.unlocked.join(" · ")}`);
    this.newsLine.string = news.join("\n");
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

  /** 填充条逐帧重绘((Graphics)为保留型画布,先 clear 再画);顶缘加一道高光 */
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
    // 亮头(老 .exp-bar i 的 linear-gradient 提亮)
    g.fillColor = col("#fff0a0", 0.9);
    g.roundRect(-BAR_W / 2, 3, w, 4, 2);
    g.fill();
  }

  private pulseLv(): void {
    const n = this.lvLabel.node;
    Tween.stopAllByTarget(n);
    n.setScale(1.6, 1.6, 1);
    tween(n).to(0.3, { scale: new Vec3(1, 1, 1) }, { easing: "backOut" }).start();
  }
}
