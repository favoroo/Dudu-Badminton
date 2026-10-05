// ============================================================
// 比赛结算弹窗:VICTORY!/DEFEAT 大标语 + 终局比分 + 成长奖励结算卡。
// 数据全部来自 Career.settle() 的真实返回值(经 UIManager 桥截获),
// 训练模式吃 settleDrill + Drill.result,同屏复用一套布局。
// 经验条:从结算前快照滚到结算后档位,跨级时分段填充并逐级闪「Lv.X」;
// 满级静态显示 MAX(经济曲线只有一份,动画只负责演)。
// ============================================================
import { BlockInputEvents, Button, Color, Graphics, Label, Node, Tween, tween, UIOpacity, UITransform, Vec2, Vec3, view, Widget } from "cc";
import { CFG } from "../core/config";
import { Career } from "../core/career";
import type { SettleResult } from "../core/career";
import type { DrillResult } from "../core/drill";
import type { StageDef } from "../core/campaign";
import type { ObjectiveResult } from "../core/campaign-hud";
import { col } from "./ui-manager";
import type { UiKit } from "./ui-manager";
import { buildCine, type CinePlan } from "./settle-cine";
import {
  ARCADE, burstOnce, cancelFade, drawMenuCard, drawSectionBand, drawSlantShadow, drawVeil, fadeOutHide, inkFor, paintP5,
  progressDL, retainedDraw, riseIn, ROLE, SLANT, slantPath, skewOf, slashIn, textW,
} from "./ui-arcade";
import { clearKids } from "./ui-shell";

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
  /**
   * 闯关模式才有:这一屏的行动钮要按「本关 / 下一关」重排。
   * next = 打完这关之后的下一关(全 20 关通完则为 null),由 UIManager 从关卡表算好喂进来。
   */
  campaign?: { stageNo: number; stageTitle: string; next: StageDef | null } | null;
  /**
   * 闯关:这一局三条目标的逐条结果(达成与否 + 差多少)。
   * **输赢都要给** —— 从前判星整块只在获胜时算,于是挑战失败后玩家只看到"DEFEAT",
   * 不知道"其实后两条都达成了,只差净胜分",下一局没有任何方向。
   * 数据来自 rules.R.lastFacts,措辞与进度由 core/campaign-hud 出(与简报、HUD 同源)。
   */
  conds?: ObjectiveResult[] | null;
}

/** 经验条动画:分段 = 每级一段(可能跨级连升) */
interface ExpSeg { lv: number; from: number; to: number; need: number }
interface ExpAnim { segs: ExpSeg[]; total: number; elapsed: number; done: boolean; shownSeg: number }

/** 一颗行动钮:文案 + 字号 + 是否主钮 + 点下去干什么(宽度由文案量出来) */
interface Act { text: string; size: number; primary?: boolean; run: () => void }

const BAR_W = 320;
const DUR = 1.25; // 经验条整体滚动时长(s),段数多时按比例加快由 tick 内兜底

/** 卡片尺寸:统计六格 + 奖励区 + 双按钮都塞得下,四周又还留得住球场(老 .panel.result) */
const CW = 560, CH = 490;
const CELL_W = 168, CELL_H = 48, CELL_GAP = 8;
/** 战报两行的纵坐标(卡片中心为原点) */
const STAT_Y = 76;

const stars = (n: number): string => "★".repeat(n) + "☆".repeat(Math.max(0, 3 - n));

/** 胜利扫场三带的纵向位(占屏高比例:上/中/下三条平行斜带,构造与 show 时共用一份) */
const BAND_Y = [0.3, 0, -0.28];

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
  /** 闯关目标逐条结果那一行(非闯关隐藏) */
  private objRow!: Node;
  /** 底部行动钮容器(整排随场景重建,见 buildActions) */
  private actionRow!: Node;
  private anim: ExpAnim | null = null;
  private payload: SettlePayload | null = null;
  private cMax = new Color();
  // ---------- 谢幕演出(胜负两条路径,时间轴来自 settle-cine.buildCine) ----------
  /** 暗幕节点:演出里它要从透明度 0 缓缓压上来(从前一步到位,球场瞬间被盖住) */
  private dimNode: Node;
  private dimOp: UIOpacity;
  /** 氛围层(扫描线+暗角+红斜带):失败时整层收掉,别给败局添红 */
  private atmoNode: Node;
  /** 失败限定冷 veil:叠在暗幕上压得更深更冷,胜利恒隐 */
  private loseVeil!: Node;
  private loseVeilOp!: UIOpacity;
  /** 谢幕演出层(压在卡片之上):斜带扫场 + 标语舞台;演出期吞触摸供「点按跳过」 */
  private cine!: Node;
  private cineBlock!: BlockInputEvents;
  /** 标语舞台:大字先于卡片砸落/沉落,所以从卡片里搬出来钉在同一坐标(卡片 (0,2)+标语 (0,198) → (0,200)) */
  private stage!: Node;
  private verdictBg!: Node;
  private verdictBgOp!: UIOpacity;
  private verdictBgLose!: Node;
  private verdictBgLoseOp!: UIOpacity;
  private verdictOp!: UIOpacity;
  /** 胜利扫场斜带 ×3(形状构造时一次画好,show 时只摆位起 tween) */
  private bands: Node[] = [];
  /** 当前入场阶段:beat=留白演出(可点按跳过)→ card=卡片已入场 → done */
  private cinePhase: "beat" | "card" | "done" = "done";
  private plan: CinePlan | null = null;
  private readonly onCineSkip = (): void => this.skipCine();

  constructor(parent: Node, kit: UiKit) {
    this.kit = kit;
    const P = kit.pal;
    this.root = kit.root(parent, "settle-panel");
    this.root.active = false;
    this.cMax.fromHEX(P.dim);

    this.dimNode = kit.dim(this.root, 0.28, 0.55);
    this.dimOp = this.dimNode.addComponent(UIOpacity);
    this.atmoNode = kit.atmosphere(this.root);

    // 失败限定冷 veil:压在卡片之下(只暗球场,不压内容)、暗幕之上。
    // 胜利恒隐;失败时叠上暗幕缓缓压下来 —— 败局的暗要更冷、更深,但不能一步到位。
    const veil = new Node("lose-veil");
    veil.layer = this.root.layer;
    veil.addComponent(UITransform);
    const vw = Math.max(CFG.world.w, view.getVisibleSize().width);
    const vh = Math.max(CFG.world.h, view.getVisibleSize().height);
    const vgw = veil.addComponent(Graphics);
    const SC = CFG.fx.settleCine;
    retainedDraw(vgw, () => drawVeil(vgw, vw, vh, SC.loseVeilCenter, SC.loseVeilEdge, 8, SC.loseVeilHex));
    const veilW = veil.addComponent(Widget);
    veilW.isAlignTop = true; veilW.top = 0;
    veilW.isAlignBottom = true; veilW.bottom = 0;
    veilW.isAlignLeft = true; veilW.left = 0;
    veilW.isAlignRight = true; veilW.right = 0;
    this.loseVeilOp = veil.addComponent(UIOpacity);
    this.loseVeilOp.opacity = 0;
    veil.active = false;
    veil.setParent(this.root);
    this.loseVeil = veil;

    const card = kit.panel(this.root, CW, CH, {
      r: 18, alpha: 0.94, bandHex: ROLE.primary.face,
    });
    this.card = card.node;
    this.card.setPosition(0, 2, 0);
    this.cardOp = this.card.addComponent(UIOpacity);

    // ---------- 谢幕演出层(压在卡片之上, Widget 撑满):斜带扫场 + 标语舞台 ----------
    // 大字先于卡片砸落/沉落,所以标语从卡片里搬出来,钉在同一坐标
    // (卡片在 (0,2)、标语原卡内 (0,198) → 舞台 (0,200),逐像素不动)。
    // 演出期 BlockInputEvents 吞触摸:留白段不许误触卡片下还没显形的按钮,
    // 卡片入场即关 —— 按钮要能点。点按跳过也挂在这层(ui-hide-check:有 on 必有 off)。
    this.cine = new Node("settle-cine");
    this.cine.layer = this.root.layer;
    this.cine.addComponent(UITransform).setContentSize(CFG.world.w, CFG.world.h);
    const cineW = this.cine.addComponent(Widget);
    cineW.isAlignTop = true; cineW.top = 0;
    cineW.isAlignBottom = true; cineW.bottom = 0;
    cineW.isAlignLeft = true; cineW.left = 0;
    cineW.isAlignRight = true; cineW.right = 0;
    this.cineBlock = this.cine.addComponent(BlockInputEvents);
    this.cineBlock.enabled = false;
    this.cine.setParent(this.root);

    // 胜利扫场斜带 ×3:金/红/墨三条平行斜带错相位横扫(形状一次画好,show 时只摆位)。
    // 与 slashWipe 同一套语汇但更轻:不盖满屏、不挡触摸、扫完即隐。
    for (let i = 0; i < 3; i++) {
      const b = new Node(`cine-band-${i}`);
      b.layer = this.cine.layer;
      b.addComponent(UITransform);
      const bg = b.addComponent(Graphics);
      const th = SC.bandsThick, bw = 2400, sk = th * SC.bandsSkewK;
      retainedDraw(bg, () => {
        bg.fillColor = col(SC.bandsColors[i % SC.bandsColors.length], SC.bandsAlpha);
        slantPath(bg, bw, th, sk);
        bg.fill();
      });
      b.setPosition(-1850, BAND_Y[i] * CFG.world.h, 0);
      b.active = false;
      b.setParent(this.cine);
      this.bands.push(b);
    }

    // 标语舞台:斜切衬底(胜=斩劈红 / 败=冷墨)+ 大字
    const stage = new Node("verdict-stage");
    stage.layer = this.cine.layer;
    stage.addComponent(UITransform);
    stage.setPosition(0, 200, 0);
    stage.setParent(this.cine);
    this.stage = stage;

    // 大标语斜切衬底(P5):胜利=红色斩劈块(slashIn 斩入),失败=冷墨横带(淡入),训练不亮
    const verdictBg = new Node("verdict-bg");
    verdictBg.layer = stage.layer;
    verdictBg.addComponent(UITransform);
    const vbg = verdictBg.addComponent(Graphics);
    const vsk = skewOf(88, 9);
    retainedDraw(vbg, () => {
      drawSlantShadow(vbg, 470, 88, vsk, 7, 7, 0.55);
      vbg.fillColor = col(ARCADE.slash, 0.96);
      slantPath(vbg, 470, 88, vsk);
      vbg.fill();
      vbg.strokeColor = col("#ff6b72", 0.5);
      vbg.lineWidth = 1.5;
      slantPath(vbg, 470, 88, vsk);
      vbg.stroke();
    });
    verdictBg.setPosition(0, 0, 0);
    verdictBg.setParent(stage);
    verdictBg.active = false;
    this.verdictBg = verdictBg;
    this.verdictBgOp = verdictBg.addComponent(UIOpacity);
    this.verdictBgOp.opacity = 0;

    const verdictBgLose = new Node("verdict-bg-lose");
    verdictBgLose.layer = stage.layer;
    verdictBgLose.addComponent(UITransform);
    const vbl = verdictBgLose.addComponent(Graphics);
    retainedDraw(vbl, () => {
      drawSlantShadow(vbl, 470, 88, vsk, 7, 7, 0.55);
      vbl.fillColor = col(ARCADE.ink, 0.78);
      slantPath(vbl, 470, 88, vsk);
      vbl.fill();
      vbl.strokeColor = col(SC.loseVeilHex, 0.9);
      vbl.lineWidth = 1.5;
      slantPath(vbl, 470, 88, vsk);
      vbl.stroke();
    });
    verdictBgLose.setPosition(0, 0, 0);
    verdictBgLose.setParent(stage);
    verdictBgLose.active = false;
    this.verdictBgLose = verdictBgLose;
    this.verdictBgLoseOp = verdictBgLose.addComponent(UIOpacity);
    this.verdictBgLoseOp.opacity = 0;

    this.verdict = kit.label(stage, "", 42, P.text, { outline: P.ink, outlineW: 2, disp: true });
    this.verdict.node.setPosition(0, 0, 0);
    this.verdict.node.angle = 2;
    this.verdictOp = this.verdict.node.addComponent(UIOpacity);
    this.verdictOp.opacity = 0;
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

    // 经验条:Lv 左标 + 底槽 + 填充(填充逐帧重绘)。底槽 = 凹陷槽,与滑杆轨道同件
    this.lvLabel = kit.label(this.card, "", 14, P.text);
    this.lvLabel.node.setPosition(-CW / 2 + 44, -82, 0);
    this.barWrap = new Node("exp-bar");
    this.barWrap.layer = this.card.layer;
    this.barWrap.setPosition(24, -82, 0);
    this.barBg = this.barWrap.addComponent(Graphics);
    // 2p 友谊赛不发奖励时整条会 active=false,再显示就得重画(原生侧 onDisable 清渲染数据)
    retainedDraw(this.barBg, () => {
      paintP5(this.barBg, progressDL(BAR_W, 14, 0, P.accent).track);
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

    // ---------- 关卡目标逐条结果(只在闯关亮;输赢都排) ----------
    // 三条横排在奖励新闻行与行动钮之间那条 24px 的空带上:每条「★N 净胜 1/2」,
    // 达成=荧光黄、未达=纸白压暗 —— 一眼看得出"差的是哪一条、差多少"。
    this.objRow = new Node("obj-row");
    this.objRow.layer = this.card.layer;
    this.objRow.addComponent(UITransform).setContentSize(CW - 40, 16);
    this.objRow.setPosition(0, -150, 0);
    this.objRow.setParent(this.card);
    this.objRow.active = false;

    // ---------- 行动钮:整排在 show() 里按场景新建 ----------
    // 为什么不建三颗再按状态开关:uiButton 的底块是「一次绘制」的 Graphics,
    // 原生(JSB)侧 onDisable 会清掉渲染数据、重显不重传 → 藏过的那颗会变成只剩字的透明钮
    // (见 ui-arcade.retainedDraw)。结算一屏建一次整排,几个节点的代价,
    // 换「任何一套按钮组合都不会隐身」,而且按钮个数/文案本来就要随模式变。
    this.actionRow = new Node("actions");
    this.actionRow.layer = this.card.layer;
    this.actionRow.addComponent(UITransform).setContentSize(CW, 60);
    this.actionRow.setPosition(0, -190, 0);
    this.actionRow.setParent(this.card);
  }

  /**
   * 底部行动钮:闯关通关时「下一关」顶到最左当主钮;全 20 关通完自动退回「返回主菜单」。
   * 宽度按实测文案量、超宽再等比缩回卡片内 —— 三颗钮的文案长短差得很多(第 1 关 vs 第 20 关)。
   */
  private buildActions(p: SettlePayload): void {
    clearKids(this.actionRow);
    const camp = p.campaign;

    const toMenu = (primary = false): Act => ({
      text: "返回主菜单", size: 16, primary,
      run: () => { this.kit.sfx.play("back"); this.hide(); this.kit.quitToMenu(); },
    });
    const retry = (text: string): Act => ({
      text, size: 18, primary: true,
      run: () => { this.kit.sfx.play("ui"); this.hide(); this.kit.restartCurrent(); },
    });

    const acts: Act[] = [];
    let caption = "";
    const replay = (size: number): Act => ({
      text: "重打本关", size,
      run: () => { this.kit.sfx.play("ui"); this.hide(); this.kit.restartCurrent(); },
    });
    if (camp && p.won && camp.next) {
      const next = camp.next;
      acts.push({
        text: `下一关 ▶ 第 ${next.stageNo} 关`, size: 16, primary: true,
        run: () => { this.kit.sfx.play("ui"); this.hide(); this.kit.startCampaignStage(next); },
      });
      acts.push(replay(15));
      acts.push(toMenu());
      // 关名塞进按钮会把整排撑出卡片(「热带沙尘暴」那关实测 586 > 可用 520),
      // 所以另起一行小字报「下一关是什么玩法」。
      caption = `第 ${next.stageNo} 关「${next.title}」· ${next.deathmatch ? "一球生死战" : `抢 ${next.targetScore} 分`}`;
    } else if (camp && p.won) {
      // 第 20 关打完:没有下一关可去了,主钮交回菜单
      acts.push(toMenu(true));
      acts.push(replay(16));
      caption = `全部 20 关已通关 · 「${camp.stageTitle}」是最后一关,想冲三星随时重打`;
    } else if (camp) {
      acts.push(retry(`再战第 ${camp.stageNo} 关`));
      acts.push(toMenu());
    } else if (p.kind === "drill") {
      acts.push(retry("再练一次"));
      acts.push(toMenu());
    } else {
      acts.push(retry("再来一局"));
      acts.push(toMenu());
    }

    const GAP = 14;
    // 宽度按实测文案走:20 关的关卡名长短不一,写死会把长文案挤出按钮底块
    const laid = acts.map((a) => ({
      a, w: Math.min(300, Math.max(acts.length >= 3 ? 128 : 240, Math.round(textW(a.text, a.size) + 46))),
    }));
    let total = laid.reduce((s, x) => s + x.w, 0) + GAP * (laid.length - 1);
    if (total > CW - 32) {
      // 兜底:文案再长也挤回卡片内(缩到下限 112 时三颗仍远宽于 528)
      const k = (CW - 32 - GAP * (laid.length - 1)) / laid.reduce((s, x) => s + x.w, 0);
      for (const x of laid) x.w = Math.max(112, Math.floor(x.w * k));
      total = laid.reduce((s, x) => s + x.w, 0) + GAP * (laid.length - 1);
    }
    let x = -total / 2;
    for (const { a, w } of laid) {
      const n = this.kit.button(this.actionRow, a.text, w, 52, { style: a.primary ? "primary" : "ghost", size: a.size });
      n.setPosition(x + w / 2, caption ? 12 : 0, 0);
      n.on(Button.EventType.CLICK, () => a.run());
      x += w + GAP;
    }
    if (caption) {
      this.kit.label(this.actionRow, caption, 12, this.kit.pal.dim).node.setPosition(0, -28, 0);
    }
  }

  /** 战报六格:格数固定 6,节点复用,只换文案与颜色 */
  private renderStats(rows: SettleStat[]): void {
    const P = this.kit.pal;
    // 打击橙走 ROLE.power(与商店履历格「扣杀终结」同一支笔);旧写法这里又抄一遍 #ff6a1f
    const TONE: Record<string, string> = { gold: P.accent, hot: ROLE.power.face, cyan: P.cyan, plain: P.text };
    const cells = this.statLayer.children;
    for (let i = 0; i < 6; i++) {
      let cell = cells[i];
      if (!cell) {
        cell = new Node(`stat-${i}`);
        cell.layer = this.card.layer;
        cell.addComponent(UITransform).setContentSize(CELL_W, CELL_H);
        const g = cell.addComponent(Graphics);
        // 格子按「这一局有没有这条数据」逐个开关(见下面 cell.active),底块得能重放
        retainedDraw(g, () => drawMenuCard(g, CELL_W, CELL_H, 9, { edge: 0, bar: 0, alpha: 0.6, slant: SLANT.block }));
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

  /** 荣誉胶囊:底块宽度跟着字数走(老 .match-badge 的 fit-content);测宽走全站唯一尺 */
  /**
   * 关卡目标逐条:三条横排「★1 净胜 1/2」,达成提荧光黄、未达压暗。
   * **输赢都排** —— 打输了玩家最需要知道的就是"差哪一条、差多少",
   * 而从前这里只有 "DEFEAT" 两个字母(判星整块只在获胜分支里跑)。
   * 这行只有 Label 没有 Graphics 底块,所以整行 active 切换是安全的
   * (原生侧 onDisable 清的是 Graphics 的渲染数据,文字标签重上时是完整的)。
   */
  private renderConds(p: SettlePayload): void {
    const conds = p.conds ?? [];
    this.objRow.active = conds.length > 0;
    if (!conds.length) return;
    const P = this.kit.pal;
    const GAP = 14;
    const laid = conds.map((c, i) => {
      const text = `★${i + 1} ${c.detail}`;
      return { text, ok: c.ok, w: textW(text, 12) + 2 };
    });
    const total = laid.reduce((s, x) => s + x.w, 0) + GAP * (laid.length - 1);
    let x = -total / 2;
    for (let i = 0; i < laid.length; i++) {
      let n = this.objRow.children[i];
      if (!n) {
        n = new Node(`cond-${i}`);
        n.layer = this.card.layer;
        n.addComponent(UITransform);
        this.kit.label(n, "", 12, P.text);
        n.setParent(this.objRow);
      }
      n.active = true;
      const l = n.children[0].getComponent(Label)!;
      l.string = laid[i].text;
      l.color = col(laid[i].ok ? P.accent : P.dim);
      n.setPosition(x + laid[i].w / 2, 0, 0);
      x += laid[i].w + GAP;
    }
    for (let i = laid.length; i < this.objRow.children.length; i++) this.objRow.children[i].active = false;
  }

  private renderBadge(b: SettleBadge | null): void {
    this.badgeBg.node.active = !!b;
    if (!b) return;
    const w = Math.min(CW - 60, textW(b.title, 13) + 34);
    const g = this.badgeBg;
    g.clear();
    // 荣誉称号 = 斜切色带印章(与闯关大厅状态胶囊同件),不再画圆角胶囊
    drawSectionBand(g, w, 26, b.color);
    this.titleBadge.string = b.title;
    // 面从半透明描边换成了实底徽章色,字色按面色亮度重算,不然白字印黄底读不出
    this.titleBadge.color = col(inkFor(b.color));
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
    // 衬纸只在比赛模式亮:胜利=红色斩劈块(slashIn 斩入),失败=冷墨横带(随标语沉落淡入)
    this.verdictBg.active = match && won;
    this.verdictBgLose.active = match && !won;
    this.score.node.active = match;
    this.sub.node.active = !match;
    this.score.string = `${p.scores[0]} : ${p.scores[1]}`;
    this.sub.string = p.drill ? `${p.drill.def ? p.drill.def.label : ""} ${stars(p.drill.stars)}` : "";
    // 行动钮:比赛「再来一局」、训练「再练一次」、闯关通关「下一关 ▶ …」(老 btnAgain)
    this.buildActions(p);
    // 荣誉称号:比赛模式才显示(老 .matchBadge)
    this.renderBadge(match ? p.badge : null);
    this.renderStats(p.stats);
    this.renderConds(p);

    this.fillRewards(p);
    this.anim = this.buildExpAnim(p);
    this.renderBar(true);

    // ---------- 入场:谢幕演出(胜负两条路径;训练保持旧快速入场) ----------
    this.playCine(buildCine(won, match));
  }

  hide(): void {
    // 谢幕演出的一切计时随收摊停掉:节拍调度/斜带/暗幕/标语,跳过监听随 off 卸干净
    // (ui-hide-check:裸 TOUCH 监听有 on 必有 off —— 面板关掉不能留隐形挡板)
    this.teardownCine();
    fadeOutHide(this.root);
    this.anim = null;
    this.payload = null;
  }

  // ---------- 谢幕演出(计划由 ui/settle-cine.ts 烘出,这里只照计划摆 tween) ----------
  //
  // 节拍:留白段(球场在暗幕后面活着 —— 彩带在 celebrate 时钟里真正落完、欢呼、
  // 定格表情)→ 斜带扫场(胜)/冷 veil 压下(败)→ 卡片入场 + 标语 slam/descend
  // → 内容逐行浮现。留白段点一下屏幕直接快进到卡片, repeated 败局不被拖时间。

  private playCine(plan: CinePlan): void {
    this.teardownCine();
    this.plan = plan;
    this.cinePhase = "beat";

    const card = this.card;
    const op = this.cardOp;
    Tween.stopAllByTarget(card);
    card.setPosition(0, 2, 0);
    card.setScale(1, 1, 1);
    // 卡片本体在留白段必须隐身:上一局正常收场时 opacity 是 255,不复位就会
    // 整张卡提前明晃晃地压在球场上,等 beatWin 才"入场"
    op.opacity = 0;

    // —— 复位:上一局(或上一次快速开关)的任何残留全部归零 ——
    this.dimOp.opacity = plan.cinematic ? 0 : 255;
    this.loseVeilOp.opacity = 0;
    this.loseVeil.active = plan.veil != null;
    this.atmoNode.active = true;
    this.verdictBgOp.opacity = 0;
    this.verdictBgLoseOp.opacity = 0;
    this.verdictOp.opacity = 0;
    this.verdict.node.setScale(1, 1, 1);
    this.verdict.node.setPosition(0, 0, 0);
    this.verdict.node.angle = 2;
    for (const b of this.bands) { Tween.stopAllByTarget(b); b.active = false; }

    if (!plan.cinematic) {
      // 训练场:保持旧快速入场 —— 卡片弹入、标语随后砸下(与改版前逐帧同款)
      this.cinePhase = "done";
      this.verdictOp.opacity = 255;
      card.setScale(0.72, 0.72, 1);
      op.opacity = 0;
      tween(card).to(plan.card.dur, { scale: new Vec3(1, 1, 1) }, { easing: "backOut" }).start();
      tween(op).to(0.2, { opacity: 255 }).start();
      this.verdict.node.setScale(1.9, 1.9, 1);
      tween(this.verdict.node)
        .delay(plan.verdict.at)
        .to(plan.verdict.dur, { scale: new Vec3(1, 1, 1) }, { easing: "backOut" })
        .start();
      this.startRows(plan, 0, true);
      return;
    }

    // —— 暗幕:从 0 缓缓压上来(不一步到位,球场多活一小会儿)——
    tween(this.dimOp)
      .delay(plan.dim.delay)
      .to(plan.dim.dur, { opacity: 255 }, { easing: "quadOut" })
      .start();

    if (plan.won && plan.bands) {
      // —— 胜利:金/红/墨三条平行斜带错相位从左扫到右,卡片落地前扫完主段 ——
      const B = plan.bands;
      this.bands.forEach((b, i) => {
        b.active = true;
        b.setPosition(-1850, BAND_Y[i] * CFG.world.h, 0);
        tween(b)
          .delay(B.at + i * B.stagger)
          .to(B.dur, { position: new Vec3(1850, BAND_Y[i] * CFG.world.h, 0) }, { easing: "quadIn" })
          .call(() => { b.active = false; })
          .start();
      });
    } else if (plan.veil) {
      // —— 失败:氛围红斜带整层收掉,冷 veil 叠上暗幕一起压下来(更冷更深)——
      this.atmoNode.active = false;
      tween(this.loseVeilOp)
        .delay(plan.veil.at)
        .to(plan.veil.dur, { opacity: 255 }, { easing: "quadOut" })
        .start();
    }

    if (!plan.won) {
      // —— 失败标语:DEFEAT 从上方 26px 缓沉(quadIn 加速下坠,无弹跳)。
      //    起点烘在 beatLose − verdictDescend,标语沉完那一帧卡片正好浮上来 ——
      const v = this.verdict.node;
      v.setPosition(0, 26, 0);
      tween(v)
        .delay(plan.verdict.at)
        .to(plan.verdict.dur, { position: new Vec3(0, 0, 0) }, { easing: "quadIn" })
        .start();
      tween(this.verdictOp)
        .delay(plan.verdict.at)
        .to(plan.verdict.dur * 0.45, { opacity: 255 })
        .start();
      tween(this.verdictBgLoseOp)
        .delay(plan.verdict.at)
        .to(plan.verdict.dur * 0.6, { opacity: 255 })
        .start();
    }

    // —— 留白段可点按跳过:演出层吞触摸(防误触卡片下还没显形的按钮),点到即快进 ——
    this.cineBlock.enabled = true;
    this.cine.on(Node.EventType.TOUCH_END, this.onCineSkip, this);

    // —— 到卡片节拍:胜利在 beatWin 同时砸落,失败在 beatLose 浮上来(调度挂在
    //    stage 上,与卡片/标语自己的 tween 目标互不干扰)——
    tween(this.stage).delay(plan.card.at).call(() => this.enterCard(false)).start();
  }

  /** 卡片入场:胜利=弹入+标语砸落+星芒爆+落定轻震;失败=沉重浮现(无弹跳)。fast=点按跳过的快进 */
  private enterCard(fast: boolean): void {
    if (this.cinePhase !== "beat" || !this.plan) return;
    this.cinePhase = "card";
    this.cineBlock.enabled = false;              // 按钮要能点了
    this.cine.off(Node.EventType.TOUCH_END, this.onCineSkip, this);   // 跳过通道关闭(ui-hide-check:off 配对)
    const plan = this.plan;
    const card = this.card;
    const op = this.cardOp;
    Tween.stopAllByTarget(card);
    Tween.stopAllByTarget(this.verdict.node);
    Tween.stopAllByTarget(this.verdictOp);

    if (plan.card.mode === "pop") {
      card.setScale(0.86, 0.86, 1);
      op.opacity = 0;
      tween(card).to(plan.card.dur, { scale: new Vec3(1, 1, 1) }, { easing: "backOut" }).start();
      tween(op).to(plan.card.dur * 0.6, { opacity: 255 }).start();
      // 标语砸落 + 红衬纸斩入 + 星芒爆(插在 cine 层底,光刺从衬纸四周探出来)
      const v = this.verdict.node;
      v.setScale(1.9, 1.9, 1);
      v.setPosition(0, 0, 0);
      tween(this.verdictOp).to(0.12, { opacity: 255 }).start();
      tween(v).delay(0.02).to(plan.verdict.dur, { scale: new Vec3(1, 1, 1) }, { easing: "backOut" }).start();
      slashIn(this.verdictBg, 0, -46, -5, 0.3);
      burstOnce(this.cine, CFG.fx.settleCine.bandsColors[0], plan.burst?.r ?? 130, plan.burst?.points ?? 12, 0, 200, true);
      tween(this.stage).delay(0.22).call(() => {
        if (this.cinePhase === "card") this.shakeCard(plan.card.shakeAmp, plan.card.shakeDur);
      }).start();
    } else {
      // 失败:沉重 = 淡入 + 从上方 18px 缓沉,无弹性曲线;标语若在沉落途中被跳过则当场归位
      card.setScale(1.03, 1.03, 1);
      op.opacity = 0;
      const y = card.position.y;
      card.setPosition(0, y + 18, 0);
      tween(card).to(plan.card.dur, { scale: new Vec3(1, 1, 1), position: new Vec3(0, y, 0) }, { easing: "quadOut" }).start();
      tween(op).to(plan.card.dur * 0.7, { opacity: 255 }).start();
      Tween.stopAllByTarget(this.verdictBgLoseOp);
      this.verdictBgLoseOp.opacity = 255;
      if (fast) {
        const v = this.verdict.node;
        v.setScale(1, 1, 1);
        v.setPosition(0, 0, 0);
        v.angle = 2;
        this.verdictOp.opacity = 255;
      }
    }
    this.startRows(plan, fast ? 0 : 0.08, plan.card.mode === "pop");
  }

  /** 留白段点按:暗幕/冷 veil 立即到位、斜带收掉,直接进卡片 */
  private skipCine(): void {
    if (this.cinePhase !== "beat" || !this.plan) return;
    Tween.stopAllByTarget(this.dimOp);
    Tween.stopAllByTarget(this.loseVeilOp);
    this.dimOp.opacity = 255;
    this.loseVeilOp.opacity = 255;
    for (const b of this.bands) { Tween.stopAllByTarget(b); b.active = false; }
    this.enterCard(true);
  }

  /** 落定轻震:标语砸下那一下,卡片 ±amp 抖两下归位(失败不震) */
  private shakeCard(amp: number, dur: number): void {
    if (amp <= 0) return;
    const card = this.card;
    const y = card.position.y;
    const step = dur / 4;
    tween(card)
      .to(step, { position: new Vec3(amp, y, 0) })
      .to(step, { position: new Vec3(-amp, y, 0) })
      .to(step, { position: new Vec3(amp * 0.5, y, 0) })
      .to(step, { position: new Vec3(0, y, 0) })
      .start();
  }

  /** 卡片内容逐行浮现:胜利 riseIn 上浮,失败安静淡入;训练/旧路径(rows=0)整体直接显形 */
  private startRows(plan: CinePlan, base: number, move: boolean): void {
    const rows = [
      this.score.node, this.sub.node, this.badgeBg.node, this.statLayer,
      this.coinLine.node, this.bonusLine.node, this.barWrap, this.newsLine.node,
      this.objRow, this.actionRow,
    ];
    if (plan.rows <= 0) {
      for (const n of rows) {
        const rowOp = n.getComponent(UIOpacity) ?? n.addComponent(UIOpacity);
        Tween.stopAllByTarget(rowOp);
        rowOp.opacity = 255;
      }
      return;
    }
    rows.forEach((n, i) => {
      if (!n.active) return;   // 不在场的行(训练 sub / 非闯关 objRow / 无奖励 bar)不动
      if (move) { riseIn(n, base + i * plan.rows, 14, 0.5); return; }
      const rowOp = n.getComponent(UIOpacity) ?? n.addComponent(UIOpacity);
      Tween.stopAllByTarget(rowOp);
      Tween.stopAllByTarget(n);
      rowOp.opacity = 0;
      tween(rowOp).delay(base + i * plan.rows).to(0.4, { opacity: 255 }).start();
    });
  }

  /** 收摊:停掉演出的一切 tween 与节拍调度、卸掉跳过监听、关吞触摸(hide 与重 show 都走这里) */
  private teardownCine(): void {
    Tween.stopAllByTarget(this.stage);
    Tween.stopAllByTarget(this.dimOp);
    Tween.stopAllByTarget(this.loseVeilOp);
    Tween.stopAllByTarget(this.verdictOp);
    Tween.stopAllByTarget(this.verdict.node);
    Tween.stopAllByTarget(this.verdictBgOp);
    Tween.stopAllByTarget(this.verdictBgLoseOp);
    for (const b of this.bands) Tween.stopAllByTarget(b);
    this.cine.off(Node.EventType.TOUCH_END, this.onCineSkip, this);
    this.cineBlock.enabled = false;
    this.cinePhase = "done";
    this.plan = null;
  }

  /** UIManager 每帧驱动:经验条滚动 + 升级闪标 */
  tick(dt: number): void {
    const a = this.anim;
    if (!this.root.active || !a || a.done) return;
    // 留白段卡片还隐着,经验条别偷偷先滚:入场那刻才开始,玩家才看得到"涨经验"本身
    if (this.cinePhase === "beat") return;
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
    // 奖励来源标签:训练首通 / 闯关首通(战前简报承诺的关卡奖励到账)/ 普通比赛
    const rewardLabel = p.kind === "drill" ? "首次通关" : res.first ? "首通奖励" : "比赛奖励";
    this.coinLine.string = res.coin > 0
      ? `${rewardLabel} 金币 +${res.coin} · 经验 +${res.exp}`
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
    // unlocked 是 SkinDef[],直接 join 会排成 "[object Object]" —— 只取商店里那套名字
    if (res.unlocked.length > 0) news.push(`新品上架:${res.unlocked.map((s) => s.name).join(" · ")}`);
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
    // 与旧胶囊同款:再空也露 14 宽的斜切头(progressDL 内部对过窄填充不画)
    const t = Math.max(r, 14 / BAR_W);
    paintP5(g, progressDL(BAR_W, 14, t, this.kit.pal.accent).fill);
    // 亮头(老 .exp-bar i 的 linear-gradient 提亮):同斜率斜切条,贴着填充顶缘
    const w = Math.max(14, BAR_W * t);
    g.fillColor = col("#fff0a0", 0.9);
    slantPath(g, w, 4, skewOf(4, SLANT.block), -BAR_W / 2 + w / 2, 5);
    g.fill();
  }

  private pulseLv(): void {
    const n = this.lvLabel.node;
    Tween.stopAllByTarget(n);
    n.setScale(1.6, 1.6, 1);
    tween(n).to(0.3, { scale: new Vec3(1, 1, 1) }, { easing: "backOut" }).start();
  }
}
