// ============================================================
// 对战 HUD:顶部比分大牌 + 发球权指示 + 连击大字 + 暂停按钮。
// 触屏避让(决策②):常驻元素全部在 y >= 0 的上部空间;虚拟按键
// 占 y ∈ [-190, -274] 的底部两角,连击大字置于球网正上方(y≈+25,
// 网顶在 -70)的开阔区,与两侧控制簇错开。
// 同步策略与老 DD.UI.sync(R) 一致:由 UIManager 每帧喂入 R,UI 只读。
// ============================================================
import { Button, Color, Graphics, Label, Node, Tween, tween, UIOpacity, UITransform, Vec2, Vec3, Widget, sys, view } from "cc";
import { CFG } from "../core/config";
import { Rules } from "../core/rules";
import { Drill } from "../core/drill";
import type { RulesState } from "../core/rules";
import { col } from "./ui-manager";
import type { UiKit } from "./ui-manager";
import { ARCADE, bannerOnce, drawArcadePanel, drawChip, drawHardShadow, popScore } from "./ui-arcade";

export class Hud {
  readonly root: Node;
  private kit: UiKit;
  // 比分区(训练模式整体隐藏)
  private pills: Node;
  private scoreL: Label;
  private scoreR: Label;
  private teamL: Label;
  private teamR: Label;
  private centerBadge: Label;
  private badgeNode: Node;
  private badgeGfx: Graphics;
  private badgeHot = false;
  private statusLine: Label;
  private statusOp: UIOpacity;
  private drillInfo: Label;
  // 连击大字
  private combo: Node;
  private comboLabel: Label;
  // 发球指示
  private serveFlag: Node;
  // 暂停按钮
  private pauseBtn: Node;
  // 同步用缓存
  private lastScore = "";
  private lastStatus = "";
  private lastCombo = -1;
  private frameT = 0;
  private cHot = new Color();
  private cPlain = new Color();

  constructor(parent: Node, kit: UiKit) {
    this.kit = kit;
    const P = kit.pal;
    this.root = kit.root(parent, "hud");
    this.root.active = false;
    this.cHot.fromHEX(P.accent);   // 老 .status.hot:提示变荧光黄
    this.cPlain.fromHEX(P.text);

    // ---------- 顶部比分大牌(老 .board:渐变底 + 硬阴影 + 斜切数字) ----------
    this.pills = new Node("score-bar");
    this.pills.layer = this.root.layer;
    this.pills.addComponent(UITransform);
    this.pills.setParent(this.root);

    const mkPill = (x: number, name: string, strokeHex: string): Node => {
      const n = new Node(name);
      n.layer = this.root.layer;
      n.setPosition(x, 232, 0);
      const g = n.addComponent(Graphics);
      drawHardShadow(g, 170, 58, 10, 5, 5, 0.55);
      drawArcadePanel(g, 170, 58, 10);
      // 队伍色点题:左/右各一道竖色条(老 .team .dot 的贴纸色)
      g.fillColor = col(strokeHex, 0.9);
      g.roundRect(-82, -22, 5, 44, 2.5);
      g.fill();
      n.setParent(this.pills);
      return n;
    };
    const pillL = mkPill(-130, "pill-l", P.red);
    const pillR = mkPill(130, "pill-r", P.blue);
    // 队名/比分必须挂在胶囊下:训练模式整体隐藏 pills,比分区要跟着消失
    this.teamL = kit.label(pillL, "你", 12, P.red);
    this.teamL.node.setPosition(6, 14, 0);
    this.teamR = kit.label(pillR, "CPU", 12, P.blue);
    this.teamR.node.setPosition(6, 14, 0);
    this.scoreL = kit.label(pillL, "0", 30, P.text);
    this.scoreL.node.setPosition(4, -8, 0);
    this.scoreL.node.angle = 7; // 斜切数字(老 .scores b 的 skewX)
    this.scoreR = kit.label(pillR, "0", 30, P.text);
    this.scoreR.node.setPosition(4, -8, 0);
    this.scoreR.node.angle = 7;
    for (const s of [this.scoreL, this.scoreR]) {
      s.enableShadow = true;
      s.shadowColor = new Color(0, 0, 0, 128);
      s.shadowOffset = new Vec2(0, -3);
    }
    // 中缝小徽章:平时显示赛制,赛点时变「赛点」(老 .tag 的 acid 芯片)
    const bd = new Node("badge");
    bd.layer = this.root.layer;
    bd.addComponent(UITransform).setContentSize(84, 24);
    const bdg = bd.addComponent(Graphics);
    bdg.strokeColor = new Color(0, 0, 0, 90);
    bdg.lineWidth = 1;
    drawChip(bdg, 84, 24, ARCADE.acid, 4);
    bdg.roundRect(-42, -12, 84, 24, 4);
    bdg.stroke();
    bd.setPosition(0, 232, 0);
    bd.setParent(this.root);
    this.badgeNode = bd;
    this.badgeGfx = bdg;
    this.centerBadge = kit.label(bd, `TO ${CFG.scoring.winScore}`, 12, "#0a0e1c");

    // ---------- 状态行(发球/赛点提示) ----------
    this.statusLine = kit.label(this.root, "", 15, P.text);
    this.statusLine.node.setPosition(0, 190, 0);
    const op = this.statusLine.node.addComponent(UIOpacity);
    this.statusOp = op;

    // ---------- 训练模式:比分区替换为关卡进度 ----------
    this.drillInfo = kit.label(this.root, "", 17, P.accent, { outline: P.ink, outlineW: 2 });
    this.drillInfo.node.setPosition(0, 232, 0);
    this.drillInfo.node.active = false;

    // ---------- 连击大字(球网正上方,老 #flash 的大字海报风) ----------
    this.combo = new Node("combo");
    this.combo.layer = this.root.layer;
    this.combo.setPosition(0, 25, 0);
    this.comboLabel = kit.label(this.combo, "", 44, P.accent, { outline: P.ink, outlineW: 2 });
    this.comboLabel.enableShadow = true;
    this.comboLabel.shadowColor = new Color(255, 225, 77, 70);   // acid 辉光(老 text-shadow 0 0 40px)
    this.comboLabel.shadowOffset = new Vec2(0, -5);
    this.combo.setParent(this.root);
    this.combo.active = false;

    // ---------- 发球指示(小绿三角 + 字,悬在发球方外侧) ----------
    this.serveFlag = new Node("serve-flag");
    this.serveFlag.layer = this.root.layer;
    const sg = this.serveFlag.addComponent(Graphics);
    sg.fillColor = col(P.good, 0.95);
    sg.moveTo(0, 6);
    sg.lineTo(-8, -6);
    sg.lineTo(8, -6);
    sg.close();
    sg.fill();
    kit.label(this.serveFlag, "发球", 11, P.good).node.setPosition(0, -20, 0);
    this.serveFlag.setParent(this.root);
    this.serveFlag.active = false;

    // ---------- 暂停按钮(右上角,Widget 对齐真机拉宽后的边缘并避让安全区) ----------
    this.pauseBtn = kit.button(this.root, "II", 56, 56, { bg: P.panel, size: 22, stroke: P.line, strokeAlpha: 0.35 });
    let safeRight = 14;
    try {
      const safeRect = sys.getSafeAreaRect();
      const visSize = view.getVisibleSize();
      if (safeRect && visSize.width > 0) {
        const rightMargin = visSize.width - (safeRect.x + safeRect.width);
        if (rightMargin > 0) safeRight = Math.max(safeRight, rightMargin + 8);
      }
    } catch {}
    const wd = this.pauseBtn.addComponent(Widget);
    wd.isAlignTop = true; wd.top = 12;
    wd.isAlignRight = true; wd.right = safeRight;
    wd.updateAlignment();
    this.pauseBtn.on(Button.EventType.CLICK, () => {
      kit.sfx.play("back");
      Rules.pause();
    });
  }

  setPlaying(on: boolean): void {
    if (!on) {
      // 离开比赛态:清同步缓存,下一局比分变化才不会被误判
      this.lastScore = "";
      this.lastStatus = "";
    }
    this.root.active = on;
  }

  /** 每帧由 UIManager 调用;只读 R,不推进任何游戏状态 */
  sync(R: RulesState): void {
    if (!this.root.active) return;
    this.frameT++;
    const drill = R.mode === "drill";
    const playing = R.state === "SERVE" || R.state === "RALLY" || R.state === "POINT";
    this.pauseBtn.active = playing;
    this.pills.active = !drill;
    this.badgeNode.active = !drill;
    this.statusLine.node.active = playing;
    this.drillInfo.node.active = drill;
    if (!R.players.length) return;

    // ---- 比分 / 训练进度 ----
    if (drill) {
      // 训练不计分:直接喂 goalText()(「后场重杀 · 有效 1/3 · 提示」)
      this.drillInfo.string = Drill.goalText();
    } else {
      const key = `${R.scores[0]}-${R.scores[1]}`;
      if (key !== this.lastScore) {
        const [a, b] = key.split("-");
        const [pa, pb] = this.lastScore.split("-");
        if (+a > +(pa || 0)) this.pop(this.scoreL.node, this.scoreL);
        if (+b > +(pb || 0)) this.pop(this.scoreR.node, this.scoreR);
        this.scoreL.string = a;
        this.scoreR.string = b;
        this.lastScore = key;
      }
      this.teamL.string = Rules.labelOf("left");
      this.teamR.string = Rules.labelOf("right");
    }

    // ---- 中缝徽章:赛点 / 赛制(acid 芯片 ↔ 红色芯片) ----
    const mp = Rules.matchPointInfo();
    if (!drill) {
      const hot = mp.active;
      if (hot !== this.badgeHot) {
        this.badgeHot = hot;
        const g = this.badgeGfx;
        g.clear();
        g.strokeColor = new Color(0, 0, 0, 90);
        g.lineWidth = 1;
        drawChip(g, 84, 24, hot ? ARCADE.red : ARCADE.acid, 4);
        g.roundRect(-42, -12, 84, 24, 4);
        g.stroke();
        this.centerBadge.color = col(hot ? "#fff5f5" : "#0a0e1c");
      }
      this.centerBadge.string = mp.active ? "赛点" : `TO ${CFG.scoring.winScore}`;
    }

    // ---- 状态行 ----
    let txt = "";
    let hot = false;
    if (playing) {
      if (R.state === "SERVE" && R.serverPlayer) {
        const mine = !R.serverPlayer.isAI;
        txt = mine ? "轮到你发球 · 深球压底线 / 短球放网前" : "CPU 发球";
        hot = mine;
      } else if (R.state === "RALLY") {
        txt = `回合 ${R.rally} 拍`;
      }
      if (mp.active) {
        txt = mp.label;
        hot = true;
      } else if (R.deuce) {
        txt = `平分 · 需领先 ${CFG.scoring.deuceMinLead} 分`;
        hot = true;
      }
    }
    if (txt !== this.lastStatus) {
      this.statusLine.string = txt;
      this.lastStatus = txt;
    }
    this.statusLine.color = hot ? this.cHot : this.cPlain;
    // 赛点/发球提示轻微呼吸,不抢比分牌的注意力
    this.statusOp.opacity = hot ? 205 + Math.round(Math.sin(this.frameT * 0.2) * 50) : 255;

    // ---- 发球指示:只在 SERVE 态出现,悬在发球方外侧并上下浮动 ----
    const showServe = !drill && R.state === "SERVE" && !!R.serverPlayer;
    this.serveFlag.active = showServe;
    if (showServe && R.serverPlayer) {
      const x = R.serverPlayer.side === "left" ? -245 : 245;
      this.serveFlag.setPosition(x, 232 + Math.sin(this.frameT * 0.12) * 4, 0);
    }

    // ---- 连击大字:RALLY 且 ≥5 拍;≥10 换橙色加 ⚡,≥15 换红加 🔥 且脉动更猛 ----
    const showCombo = !drill && R.state === "RALLY" && R.rally >= 5;
    this.combo.active = showCombo;
    if (showCombo) {
      const r = R.rally;
      const epic = r >= 15;
      const hotC = r >= 10;
      if (r !== this.lastCombo) {
        this.comboLabel.string = epic ? `🔥 x${r} 连击` : hotC ? `⚡ x${r} 连击` : `x${r} 连击`;
        this.comboLabel.color = col(epic ? this.kit.pal.danger : hotC ? "#ff9f1c" : this.kit.pal.accent);
        this.lastCombo = r;
        if (!hotC) popScore(this.combo);   // 起势时砸一下;hot/epic 有持续脉动就不再抢戏
      }
      const s = epic ? 1 + Math.sin(this.frameT * 0.3) * 0.08 : hotC ? 1 + Math.sin(this.frameT * 0.22) * 0.06 : 1;
      this.combo.setScale(s, s, 1);
    } else {
      this.lastCombo = -1;
    }
  }

  /** 比分变化的小弹跳:放大 + 闪一次荧光黄(老 @keyframes pop) */
  private pop(n: Node, label?: Label): void {
    popScore(n, label, ARCADE.acid, this.kit.pal.text);
  }
}
