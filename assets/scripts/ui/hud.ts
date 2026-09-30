// ============================================================
// 对战 HUD(P5「暗红斩劈」):顶部斜切比分大牌 + 发球箭旗 +
// 锯齿连击徽章 + 暂停按钮 + 平分大横幅。
// 触屏避让(决策②):常驻元素全部在 y >= 0 的上部空间;虚拟按键
// 占 y ∈ [-190, -274] 的底部两角。连击徽章贴右上角(暂停键正下方,
// Widget 右上对齐):老版大字压在球网正上方,对拉时正好糊在角色身上。
// 同步策略与老 DD.UI.sync(R) 一致:由 UIManager 每帧喂入 R,UI 只读。
// ============================================================
import { Button, Color, Graphics, Label, Node, Tween, tween, UIOpacity, UITransform, Vec2, Vec3, view, Widget } from "cc";
import { CFG } from "../core/config";
import { Rules } from "../core/rules";
import { Drill } from "../core/drill";
import { Physics } from "../core/physics";
import type { RulesState } from "../core/rules";
import { col } from "./ui-manager";
import type { UiKit } from "./ui-manager";
import {
  ARCADE, bannerOnce, burstOnce, cancelFade, drawDiagStripes, drawSawtooth, drawSlantPanel,
  drawSlantShadow, fadeOutHide, popScore, retainedDraw, safePad, skewOf, slashIn, slantPath, textW,
} from "./ui-arcade";
import { rand } from "../core/utils";

// 风向标牌面尺寸(斜切底 + 两根针都要用同一把尺)
const WG_W = 132;
const WG_H = 22;

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
  private statusLine: Label;
  private statusOp: UIOpacity;
  /** 状态行/局别标签的底块:两者都浮在球场上,没底就只是一串糊字(见 paintPlate) */
  private statusBg: Node;
  private statusBgG: Graphics;
  private modeTagBg: Graphics;
  private drillInfo: Label;
  private modeTag: Label;
  private modeTagNode: Node;
  private lastModeTag = "";
  // 风向标(闯关侧风关):黄针=此刻的风、青针=出手那一拍的风。
  // 第 1 关的现场反馈是「海风完全没有方向提示,我根本不知道怎么利用」——
  // 风当时只住在 physics 的每步积分里,界面一行都不读,玩家挨了打也不知道是谁打的。
  private windGauge: Node;
  private windGaugeG: Graphics;
  private windLabel: Label;
  private windWasOn = false;
  private windPaintKey = NaN;
  private windLastTxt = "";
  // 连击徽章(右上角小牌:大数字 + 「连击」小字 + 档位进度条)
  private combo: Node;
  private comboBgG: Graphics;
  private comboNum: Label;
  private comboSub: Label;
  private comboW = 0;
  // 安全区缓存(构造算一次,连击徽章手动定位与顶部簇共用)
  private safeTop = 0;
  private safeRight = 14;
  // 发球指示(箭旗:箭头方向由发球方决定,翻转 Graphics 子节点、Label 不动)
  private serveFlag: Node;
  private serveFlagG: Graphics;
  // 平分大横幅(P5 斩劈横幅,deuce 上升沿播一次)
  private banner: Node;
  private bannerLabel: Label;
  // 暂停按钮
  private pauseBtn: Node;
  // 同步用缓存
  private lastScore = "";
  private lastStatus = "";
  private lastCombo = -1;
  private lastDeuce = false;
  private entranceDone = false;
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

    // ---------- 安全区避让:刘海/圆角把顶部压掉多少,整条记分牌就往下挪多少 ----------
    // 换算与 cap 规则收编进 ui-arcade.safePad():世界单位出尺,不再本地手算
    const sp = safePad();
    const safeTop = sp.top, safeLeft = sp.left, safeRight = sp.right;
    this.safeTop = sp.top;
    this.safeRight = sp.right;

    // 顶部整簇(比分牌 / 中缝徽章 / 状态行 / 训练进度 / 发球指示)一起让开安全区
    const top = new Node("top-bar");
    top.layer = this.root.layer;
    top.addComponent(UITransform);
    top.setPosition(0, -safeTop, 0);
    top.setParent(this.root);

    // ---------- 顶部比分大牌(P5 化:两张斜切对抗卡,相向倾斜) ----------
    this.pills = new Node("score-bar");
    this.pills.layer = this.root.layer;
    this.pills.addComponent(UITransform);
    this.pills.setParent(top);

    const mkPill = (x: number, name: string, teamHex: string, dir: 1 | -1): Node => {
      const n = new Node(name);
      n.layer = this.root.layer;
      n.setPosition(x, 232, 0);
      const g = n.addComponent(Graphics);
      const sk = skewOf(62, 8) * dir;              // dir=1 顶边向右倾(左卡),dir=-1 向左 —— 相向对抗
      retainedDraw(g, () => {
        drawSlantShadow(g, 196, 62, sk, -7 * dir, 6, 0.55);   // 阴影向外踢,对抗感
        drawSlantPanel(g, 196, 62, sk, { face: ARCADE.navy, alpha: 0.95, edge: ARCADE.line, edgeA: 0.9 });
        // 队色斜切色带:贴外缘,代替老版的圆角竖条
        g.fillColor = col(teamHex, 0.95);
        slantPath(g, 7, 46, skewOf(46, 8) * dir, dir * -91, 0);
        g.fill();
      });
      n.setParent(this.pills);
      return n;
    };
    const pillL = mkPill(-130, "pill-l", P.red, 1);
    const pillR = mkPill(130, "pill-r", P.blue, -1);
    // 队名/比分必须挂在胶囊下:训练模式整体隐藏 pills,比分区要跟着消失
    this.teamL = kit.label(pillL, "你", 12, P.red);
    this.teamL.node.setPosition(-60, 15, 0);
    this.teamR = kit.label(pillR, "AI", 12, P.blue);
    this.teamR.node.setPosition(60, 15, 0);
    this.scoreL = kit.label(pillL, "0", 40, P.text, { disp: true });
    this.scoreL.node.setPosition(-56, -10, 0);
    this.scoreL.node.angle = 3;                    // 轻微仰角,顺着斜切卡的势
    this.scoreR = kit.label(pillR, "0", 40, P.text, { disp: true });
    this.scoreR.node.setPosition(56, -10, 0);
    this.scoreR.node.angle = 3;
    for (const s of [this.scoreL, this.scoreR]) {
      s.enableShadow = true;
      s.shadowColor = new Color(0, 0, 0, 150);
      s.shadowOffset = new Vec2(0, -3);
    }
    // 中缝小徽章:斜切黄片微仰,常驻显示赛制(赛点由顶部斩劈横幅提示,这里不抢戏)
    const bd = new Node("badge");
    bd.layer = this.root.layer;
    bd.addComponent(UITransform).setContentSize(88, 30);
    const bdg = bd.addComponent(Graphics);
    retainedDraw(bdg, () => {
      const sk = skewOf(30, 10);
      drawSlantShadow(bdg, 88, 30, sk, 2, 4, 0.6);
      bdg.fillColor = col(ARCADE.acid, 0.97);
      slantPath(bdg, 88, 30, sk);
      bdg.fill();
      bdg.strokeColor = new Color(0, 0, 0, 110);
      bdg.lineWidth = 1;
      slantPath(bdg, 88, 30, sk);
      bdg.stroke();
    });
    bd.setPosition(0, 232, 0);
    bd.angle = 4;
    bd.setParent(top);
    this.badgeNode = bd;
    this.centerBadge = kit.label(bd, `TO ${CFG.scoring.winScore}`, 13, "#0a0e1c", { disp: true });

    // ---------- 状态行(发球 / 平分提示) ----------
    // 底块必须先建、文字后建:兄弟序即绘制序,文字要压在底块上。
    this.statusBg = new Node("status-bg");
    this.statusBg.layer = this.root.layer;
    this.statusBg.addComponent(UITransform).setContentSize(240, 28);
    this.statusBgG = this.statusBg.addComponent(Graphics);
    this.statusBg.setPosition(0, 190, 0);
    this.statusBg.setParent(top);
    this.statusBg.active = false;

    this.statusLine = kit.label(top, "", 15, P.text, { outline: P.ink, outlineW: 2 });
    this.statusLine.node.setPosition(0, 190, 0);
    this.statusOp = this.statusLine.node.addComponent(UIOpacity);

    // ---------- 训练模式:比分区替换为关卡进度 ----------
    this.drillInfo = kit.label(top, "", 17, P.accent, { outline: P.ink, outlineW: 2 });
    this.drillInfo.node.setPosition(0, 232, 0);
    this.drillInfo.node.active = false;

    // ---------- 局别标签(老 .modeTag:左上角告诉你现在在打什么档) ----------
    const tagNode = new Node("mode-tag");
    tagNode.layer = this.root.layer;
    tagNode.addComponent(UITransform).setContentSize(190, 24);
    const tagBg = new Node("tag-bg");
    tagBg.layer = this.root.layer;
    tagBg.addComponent(UITransform).setContentSize(150, 24);
    this.modeTagBg = tagBg.addComponent(Graphics);
    tagBg.setParent(tagNode);
    this.modeTag = kit.label(tagNode, "", 12, P.dim, { align: 0 });
    // 文字锚到左缘:Label 会自动把 contentSize 撑到文案宽,锚在中心时
    // 「TRAINING · 后场重杀」这种长档名会往两边长,底块就追不上了
    this.modeTag.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
    this.modeTag.node.setPosition(-95 + 13, 0, 0);
    const tagWd = tagNode.addComponent(Widget);
    tagWd.isAlignLeft = true; tagWd.left = safeLeft;
    tagWd.isAlignTop = true; tagWd.top = 20 + safeTop;
    tagWd.updateAlignment();
    tagNode.setParent(this.root);
    this.modeTagNode = tagNode;

    // ---------- 风向标(闯关侧风关:第 1 关「海风突变」的唯一读数入口) ----------
    // 为什么必须有这块:侧风会把球横推 ~150px(半场才 390px),但从前界面上一个像素都不提,
    // 玩家只看到"我瞄的线外、球却飞出去了",于是把机制读成随机惩罚 —— 用户原话是
    // 「我根本不知道这个海风要怎么利用,一点游戏性都没有」。
    // 两根针而不是数字:数字要读、要换算,而"往哪边推、正在往哪边转"是看一眼就会的东西。
    //   黄实针 = 此刻的风      青虚针 = 出手那一拍(约 60 步后)的风
    // 两针的夹角就是"风正在往哪儿转",于是"等哪一拍出手"这件事第一次变得可执行。
    const wgNode = new Node("wind-gauge");
    wgNode.layer = this.root.layer;
    wgNode.addComponent(UITransform).setContentSize(WG_W, WG_H);
    const wgBg = new Node("wg-bg");
    wgBg.layer = this.root.layer;
    wgBg.addComponent(UITransform).setContentSize(WG_W, WG_H);
    this.windGaugeG = wgBg.addComponent(Graphics);
    wgBg.setParent(wgNode);
    this.windLabel = kit.label(wgNode, "海风", 11, ARCADE.paper, { align: 0 });
    this.windLabel.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
    this.windLabel.node.setPosition(-WG_W / 2 + 6, -WG_H - 1, 0);
    const wgW = wgNode.addComponent(Widget);
    wgW.isAlignLeft = true; wgW.left = safeLeft;
    wgW.isAlignTop = true; wgW.top = 50 + safeTop;      // 压在局别标签下面,不与状态行/发球旗抢位
    wgW.updateAlignment();
    wgNode.setParent(this.root);
    wgNode.active = false;                               // 非侧风关不占屏幕
    this.windGauge = wgNode;

    // ---------- 连击徽章(右上角,暂停键正下方;锯齿星芒卡,档位变色) ----------
    // 不用 Widget 右对齐:边缘对齐对「锚点≠0.5 + 宽度动态」的节点补偿不可靠,
    // 实测徽章溢出屏幕右缘。节点保持默认中心锚,sync 每帧按可视区右缘手动收边。
    this.combo = new Node("combo");
    this.combo.layer = this.root.layer;
    this.combo.addComponent(UITransform);
    const comboBg = new Node("combo-bg");
    comboBg.layer = this.root.layer;
    comboBg.addComponent(UITransform);
    this.comboBgG = comboBg.addComponent(Graphics);
    comboBg.setParent(this.combo);
    this.comboNum = kit.label(this.combo, "", 30, P.accent, { outline: P.ink, outlineW: 2, disp: true });
    this.comboNum.enableShadow = true;
    this.comboNum.shadowColor = new Color(0, 0, 0, 130);
    this.comboNum.shadowOffset = new Vec2(0, -3);
    this.comboSub = kit.label(this.combo, "连击", 12, P.dim, { outline: P.ink, outlineW: 2 });
    this.combo.setParent(this.root);
    this.combo.active = false;

    // ---------- 发球指示(P5 箭旗:红底白字,箭头朝场内,悬在发球方外侧) ----------
    this.serveFlag = new Node("serve-flag");
    this.serveFlag.layer = this.root.layer;
    const flagBody = new Node("flag-body");
    flagBody.layer = this.root.layer;
    flagBody.addComponent(UITransform);
    this.serveFlagG = flagBody.addComponent(Graphics);
    retainedDraw(this.serveFlagG, () => {
      const g = this.serveFlagG;
      if (!g) return;
      // 箭头朝右绘制;右半场发球时由 sync 把 body 翻转(scaleX=-1),Label 不受影响
      g.fillColor = col(ARCADE.slash, 0.96);
      g.moveTo(-20, 11);
      g.lineTo(20, 11);
      g.lineTo(8, 0);
      g.lineTo(20, -11);
      g.lineTo(-20, -11);
      g.close();
      g.fill();
      g.strokeColor = col("#ff6b72", 0.8);
      g.lineWidth = 1.5;
      g.moveTo(-20, 11);
      g.lineTo(20, 11);
      g.lineTo(8, 0);
      g.lineTo(20, -11);
      g.lineTo(-20, -11);
      g.close();
      g.stroke();
    });
    flagBody.setParent(this.serveFlag);
    kit.label(this.serveFlag, "发球", 11, "#fff5f2", { outline: ARCADE.ink, outlineW: 2 }).node.setPosition(-3, 0, 0);
    this.serveFlag.setParent(top);
    this.serveFlag.active = false;

    // ---------- 平分大横幅(P5 斩劈横幅:deuce 上升沿播一次) ----------
    this.banner = new Node("deuce-banner");
    this.banner.layer = this.root.layer;
    this.banner.addComponent(UITransform);
    const bg = this.banner.addComponent(Graphics);
    const bsk = skewOf(56, 10);
    drawSlantShadow(bg, 340, 56, bsk, 5, 5, 0.55);
    bg.fillColor = col(ARCADE.slash, 0.96);
    slantPath(bg, 340, 56, bsk);
    bg.fill();
    bg.strokeColor = col("#ff6b72", 0.7);
    bg.lineWidth = 2;
    slantPath(bg, 340, 56, bsk);
    bg.stroke();
    // P5 撕纸边:上下缘黑色锯齿(撕开纸背的黑衬)+ 底部斜纹带(危险条纹的低饱和用法)
    drawSawtooth(bg, 340, 6, 13, "#0a0a10", 0.9, "up", 0, -31);
    drawSawtooth(bg, 340, 6, 13, "#0a0a10", 0.9, "down", 0, 31);
    drawDiagStripes(bg, 336, 8, 7, "#ffffff", 0.10, 0, 20);
    this.bannerLabel = kit.label(this.banner, "平分! DEUCE", 26, "#fff5f2", { disp: true });
    this.banner.setPosition(0, 150, 0);
    this.banner.setParent(top);
    this.banner.active = false;

    // ---------- 暂停按钮(右上角,Widget 对齐真机拉宽后的边缘并避让安全区) ----------
    // 64×64:横屏下离拇指最远的角落,不能再小;字号跟着按钮走(默认 6° 斜切)
    this.pauseBtn = kit.button(this.root, "II", 64, 64, { bg: P.panel, size: 24, stroke: P.line, strokeAlpha: 0.35 });
    const wd = this.pauseBtn.addComponent(Widget);
    wd.isAlignTop = true; wd.top = 12 + safeTop;
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
      this.lastModeTag = "";
      this.lastDeuce = false;
      this.banner.active = false;
      this.entranceDone = false;
      fadeOutHide(this.root);
      return;
    }
    cancelFade(this.root);
    this.root.active = true;
    if (!this.entranceDone) {
      // 每局首显:P5 斩入 —— 两张比分卡相向侧入(中缝徽章保持 4° 仰角,不参与)
      this.entranceDone = true;
      const kids = this.pills.children;
      if (kids.length >= 2) {
        slashIn(kids[0], 0.05, -46, 6);
        slashIn(kids[1], 0.12, 46, -6);
      }
    }
  }

  /**
   * 状态行底块:宽度跟文案走(斜切量另加溢出)。
   * 这行字浮在实时球场上,亮球馆(海滩场)地面一冲就糊,所以给一块斜切黑底;
   * 提示清空时由 sync 里的 active 一起收走,场上不会浮着个空块。
   */
  private paintStatusPlate(txt: string): void {
    const g = this.statusBgG;
    if (!g) return;
    const sk = skewOf(28, 8);
    const w = Math.max(140, textW(txt, 15) + 44) + Math.abs(sk);
    g.node.getComponent(UITransform)!.setContentSize(w, 28);
    g.clear();
    drawSlantShadow(g, w, 28, sk, 3, 3, 0.45);
    drawSlantPanel(g, w, 28, sk, { face: ARCADE.navy, alpha: 0.9, edge: ARCADE.line, edgeA: 0.5 });
  }

  /** 局别标签底块:左缘贴在 Widget 的 left 上,只往右长(文字已锚到左缘) */

  /**
   * 风向标:黄针=此刻的风,青针=出手那一拍(约 windLookahead 步后)的风。
   * 数值一律来自 Physics.windAt(envPhase()) —— 与球真正受到的那个力同一个来源,
   * 不在 UI 里再算一份正弦(那就是第五份积分,只是这次飘的是指针)。
   */
  private syncWind(R: RulesState): void {
    const stage = R.mode === "campaign" ? R.activeStage : null;
    const base = stage?.modifiers.physics?.windX ?? 0;
    const on = !!stage && base !== 0;
    if (on !== this.windWasOn) {
      this.windWasOn = on;
      this.windGauge.active = on;
      if (on) this.windPaintKey = NaN;          // 重新亮起来要先画一次
    }
    if (!on) return;

    const E = CFG.env;
    const ph = Physics.envPhase();
    const cur = Physics.windAt(ph) / E.windFullScale;
    // oscillate 决定这关的风会不会**变向**:恒定侧风没有"未来"可读,
    // 硬摆一根预读针等于画一根永远和实针重合的假针
    const osc = !!stage?.modifiers.physics?.windOscillate;
    const ahead = osc ? Physics.windAt(ph + E.windLookahead) / E.windFullScale : cur;
    // 指针量化到 1/16:连续值每帧都在动,但玩家读的是"往哪边、多大力",
    // 量化既不丢信息,又省掉每帧一次 Graphics.clear + 十余条路径
    const key = Math.round(cur * 16) * 1000 + Math.round(ahead * 16) + (osc ? 0 : 999999);
    if (key !== this.windPaintKey) {
      this.windPaintKey = key;
      this.paintWind(cur, ahead, osc);
    }
    const txt = Math.abs(cur) < 0.16
      ? (osc ? "风平 · 落点可控" : "侧风恒定 · 落点可控")
      : !osc
        ? (cur > 0 ? "恒定顺风 → 收力" : "恒定逆风 → 发力")
        : cur > 0
        ? "顺风 → 收力,别打越线"
        : "逆风 → 发力,压深才过网";
    if (txt !== this.windLastTxt) { this.windLastTxt = txt; this.windLabel.string = txt; }
  }

  /** 一根针:头在中心、尖朝受力方向(斜切三角,不用圆头线段 —— P5 拒绝光滑) */
  private drawWindNeedle(g: Graphics, u: number, reach: number, halfW: number, hex: string, alpha: number): void {
    const len = u * reach;
    if (Math.abs(len) < 2.5) {
      g.fillColor = col(hex, alpha);
      g.circle(0, 0, 2.6);
      g.fill();
      return;
    }
    g.fillColor = col(hex, alpha);
    g.moveTo(0, -halfW);
    g.lineTo(0, halfW);
    g.lineTo(len, 0);          // 尖端:风力越大伸得越远
    g.close();
    g.fill();
    // 尾迹:反方向一小段,读起来像被风吹出去的丝
    g.strokeColor = col(hex, alpha * 0.5);
    g.lineWidth = 1.4;
    g.moveTo(-len * 0.32, 0);
    g.lineTo(0, 0);
    g.stroke();
  }

  private paintWind(cur: number, ahead: number, osc: boolean): void {
    const g = this.windGaugeG;
    if (!g) return;
    const W = WG_W, H = WG_H;
    const sk = skewOf(H, 10);
    g.clear();
    drawSlantShadow(g, W, H, sk, 4, 4, 0.5);
    drawSlantPanel(g, W, H, sk, { alpha: 0.92, face: ARCADE.navy, edge: ARCADE.cyan, edgeA: 0.6 });
    // 零刻度:中线 + 两侧满偏刻线,给"这根针偏了多少"一个参照
    g.strokeColor = col(ARCADE.line, 0.95);
    g.lineWidth = 1;
    g.moveTo(0, -H / 2 + 3); g.lineTo(0, H / 2 - 3); g.stroke();
    const reach = W / 2 - 14;
    g.strokeColor = col(ARCADE.paper, 0.28);
    g.moveTo(-reach, -H / 2 + 5); g.lineTo(-reach, H / 2 - 5); g.stroke();
    g.moveTo(reach, -H / 2 + 5); g.lineTo(reach, H / 2 - 5); g.stroke();
    // 先画预读(青、半透)再画实时(黄、实心):实时针压在上面的层级是对的
    if (osc) this.drawWindNeedle(g, Math.max(-1, Math.min(1, ahead)), reach, H * 0.20, ARCADE.cyan, 0.55);
    this.drawWindNeedle(g, Math.max(-1, Math.min(1, cur)), reach, H * 0.26, ARCADE.acid, 0.96);
    // 撕纸下沿:让这块读数牌和 HUD 其余构件同一套形状语言
    drawSawtooth(g, W - 4, 4, 9, ARCADE.ink, 0.8, "down", 0, -H / 2 - 2);
  }

  private paintModeTagPlate(txt: string): void {
    const g = this.modeTagBg;
    if (!g) return;
    const sk = skewOf(24, 8);
    const w = Math.max(72, textW(txt, 12) + 26) + Math.abs(sk);
    g.node.getComponent(UITransform)!.setContentSize(w, 24);
    g.node.setPosition(-95 + w / 2, 0, 0);
    g.clear();
    drawSlantPanel(g, w, 24, sk, { face: ARCADE.ink, alpha: 0.88, edge: ARCADE.line, edgeA: 0.5 });
  }

  /**
   * 连击徽章底块:宽度跟数字位数走,斜切卡 + 上下档位色撕纸边 + 进度槽
   * (黄→橙→红)。全部走中心锚排版([pad][数字][6][连击][pad]),不依赖锚点补偿;
   * 宽度记进 comboW,sync 每帧按它把右缘收进可视区。
   */
  private paintComboPlate(r: number, hex: string): void {
    const g = this.comboBgG;
    if (!g) return;
    const sk = skewOf(48, 8);
    const subW = textW("连击", 12);
    const numW = textW(`${r}`, 30);
    const w = numW + subW + 30 + Math.abs(sk);
    const h = 48;
    this.comboW = w;
    g.node.getComponent(UITransform)!.setContentSize(w, h);
    this.comboNum.node.setPosition(-w / 2 + 12 + numW / 2, 5, 0);
    this.comboSub.node.setPosition(-w / 2 + 12 + numW + 6 + subW / 2, -3, 0);
    g.clear();
    drawSlantShadow(g, w, h, sk, 3, 3, 0.45);
    drawSlantPanel(g, w, h, sk, { face: ARCADE.navy, alpha: 0.9, edge: hex, edgeA: 0.9 });
    // 上下撕纸边:档位色锯齿,顶/底各一排齿
    drawSawtooth(g, w, 5, 9, hex, 0.95, "up", 0, h / 2 + 2.5);
    drawSawtooth(g, w, 5, 9, hex, 0.95, "down", 0, -h / 2 - 2.5);
    // 进度槽:5 拍起显、15 拍(epic)拉满 —— 徽章小,涨到哪一眼可见
    const trackW = w - 20;
    g.fillColor = col("#ffffff", 0.1);
    g.roundRect(-trackW / 2, -h / 2 + 5, trackW, 3, 1.5);
    g.fill();
    const p = Math.min(1, Math.max(0, (r - 5) / 10));
    if (p > 0) {
      g.fillColor = col(hex, 0.95);
      g.roundRect(-trackW / 2, -h / 2 + 5, Math.max(3, trackW * p), 3, 1.5);
      g.fill();
    }
  }

  /** 徽章起势小弹:1.28 → 回弹(徽章小,popScore 的 1.7 砸得太猛) */
  private popCombo(): void {
    Tween.stopAllByTarget(this.combo);
    this.combo.setScale(1.28, 1.28, 1);
    // P5 手感:每次连击跳动带 ±6° 随机歪斜再弹回 —— 徽章像被拍了一下
    this.combo.angle = rand(-6, 6);
    tween(this.combo).to(0.16, { scale: new Vec3(1, 1, 1), angle: 0 }, { easing: "backOut" }).start();
  }

  /** 每帧由 UIManager 调用;只读 R,不推进任何游戏状态 */
  sync(R: RulesState): void {
    if (!this.root.active) return;
    this.frameT++;
    const drill = R.mode === "drill";
    const endless = R.mode === "endless";
    const campaign = R.mode === "campaign";
    const playing = Rules.isPlaying(R.state);   // 与虚拟按键的显隐共用同一判据
    this.pauseBtn.active = playing;
    this.pills.active = !drill;
    this.badgeNode.active = !drill;
    this.statusLine.node.active = playing;
    // 底块跟着文字一起走:非对局态(暂停/结算浮在上面)不单独留一块黑底
    this.statusBg.active = playing && this.lastStatus.length > 0;
    this.drillInfo.node.active = drill;
    if (!R.players.length) return;

    // ---- 局别标签(老 #modeTag):打的是什么档,一眼能看到 ----
    const tag = drill
      ? `TRAINING · ${(Drill.cur()?.tag ?? "")}`
      : endless
      ? `ENDLESS · ${(CFG.diffs[R.diff]?.label) ?? R.diff ?? ""}`
      : campaign && R.activeStage
      ? `STAGE ${R.activeStage.stageNo} · ${R.activeStage.title}`
      : `SOLO · ${(CFG.diffs[R.diff]?.label) ?? R.diff ?? ""}`;
    if (tag !== this.lastModeTag) {
      this.modeTag.string = tag;
      this.lastModeTag = tag;
      this.paintModeTagPlate(tag);
    }

    // ---------- 风向标(侧风关才亮) ----------
    this.syncWind(R);

    // ---- 比分 / 训练进度 ----
    if (drill) {
      // 训练不计分:直接喂 goalText()(「后场重杀 1/3 · 起跳,在最高点按「深球」」)
      this.drillInfo.string = Drill.goalText();
    } else {
      const key = `${R.scores[0]}-${R.scores[1]}`;
      if (key !== this.lastScore) {
        const [a, b] = key.split("-");
        const [pa, pb] = this.lastScore.split("-");
        if (+a > +(pa || 0)) this.pop(this.scoreL.node, this.scoreL, ARCADE.red);
        if (+b > +(pb || 0)) this.pop(this.scoreR.node, this.scoreR, ARCADE.blue);
        this.scoreL.string = a;
        this.scoreR.string = b;
        this.lastScore = key;
      }
      this.teamL.string = Rules.labelOf("left");
      this.teamR.string = Rules.labelOf("right");
      const stage = campaign ? R.activeStage : null;
      this.centerBadge.string = endless
        ? "PRACTICE"
        : stage
        ? (stage.deathmatch ? "1-POINT" : `TO ${stage.targetScore}`)
        : `TO ${CFG.scoring.winScore}`;
    }

    // ---- 状态行:只管「现在该干什么」 ----
    // 拍数交给连击大字,赛点交给顶部斩劈横幅 —— 同一件事不在三处念
    let txt = "";
    let hot = false;
    if (playing) {
      if (R.state === "SERVE" && R.serverPlayer) {
        const mine = !R.serverPlayer.isAI;
        txt = mine ? "你发球 · 深球压底线,短球放网前" : "AI 发球";
        hot = mine;
      } else if (R.deuce) {
        txt = `平分 · 净胜 ${CFG.scoring.deuceMinLead} 分`;
        hot = true;
      }
    }
    if (txt !== this.lastStatus) {
      this.statusLine.string = txt;
      this.lastStatus = txt;
      this.paintStatusPlate(txt);
    }
    this.statusLine.color = hot ? this.cHot : this.cPlain;
    // 发球/平分提示轻微呼吸,不抢比分牌的注意力
    this.statusOp.opacity = hot ? 205 + Math.round(Math.sin(this.frameT * 0.2) * 50) : 255;

    // ---- 平分大横幅:deuce 上升沿播一次斩劈横幅 ----
    if (R.deuce && !this.lastDeuce && !drill) {
      this.bannerLabel.string = "平分! DEUCE";
      this.banner.active = true;
      bannerOnce(this.banner, this.bannerLabel);
      tween(this.banner)
        .delay(1.25)
        .call(() => { if (this.banner.isValid) this.banner.active = false; })
        .start();
    }
    this.lastDeuce = !!R.deuce;

    // ---- 发球指示:只在 SERVE 态出现,悬在发球方外侧并上下浮动;箭头朝场内 ----
    const showServe = !drill && R.state === "SERVE" && !!R.serverPlayer;
    this.serveFlag.active = showServe;
    if (showServe && R.serverPlayer) {
      const left = R.serverPlayer.side === "left";
      this.serveFlag.setPosition(left ? -245 : 245, 232 + Math.sin(this.frameT * 0.12) * 4, 0);
      this.serveFlagG.node.setScale(left ? 1 : -1, 1, 1);
    }

    // ---- 连击徽章:RALLY 且 ≥5 拍;≥10 换橙色,≥15 换红且脉动更猛 ----
    const showCombo = !drill && R.state === "RALLY" && R.rally >= 5;
    this.combo.active = showCombo;
    if (showCombo) {
      // 手动收边:FIXED_HEIGHT 下可视区宽随屏幕比例涨,右缘按可视宽实时算,
      // 贴暂停键正下方。中心锚:y = 可视顶 - 88(键底 76 + 12 间隙) - 半高 24,
      // 少减半高会把徽章顶进按钮底下(上一版被遮的根因)。
      const vs = view.getVisibleSize();
      const k = vs.height > 0 ? CFG.world.h / vs.height : 1;
      const rightEdge = (vs.width * k) / 2 - (4 + this.safeRight);
      const topY = CFG.world.h / 2 - (88 + this.safeTop) - 24;
      this.combo.setPosition(rightEdge - this.comboW / 2, topY, 0);
      const r = R.rally;
      const epic = r >= 15;
      const hotC = r >= 10;
      if (r !== this.lastCombo) {
        const hex = epic ? this.kit.pal.danger : hotC ? "#ff9f1c" : this.kit.pal.accent;
        this.comboNum.string = `${r}`;
        this.comboNum.color = col(hex);
        this.paintComboPlate(r, hex);
        this.lastCombo = r;
        if (!hotC) this.popCombo();   // 起势时砸一下;hot/epic 有持续脉动就不再抢戏
        if (epic) burstOnce(this.combo, hex, 52, 12, 0, 0, true);   // epic 档星芒爆发一次
      }
      const s = epic ? 1 + Math.sin(this.frameT * 0.3) * 0.06 : hotC ? 1 + Math.sin(this.frameT * 0.22) * 0.045 : 1;
      this.combo.setScale(s, s, 1);
    } else {
      this.lastCombo = -1;
    }
  }

  /** 比分变化的小弹跳:放大 + 闪一次荧光黄 + 队色星芒衬底(老 @keyframes pop 的 P5 版) */
  private pop(n: Node, label?: Label, burstHex?: string): void {
    popScore(n, label, ARCADE.acid, this.kit.pal.text);
    if (burstHex && n.parent) burstOnce(n.parent, burstHex, 44, 10, n.position.x, n.position.y, true);
  }
}
