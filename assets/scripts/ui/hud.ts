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
import { clamp, rand } from "../core/utils";
import { objectiveLines, physicsModReadout, playerModReadout, progressText } from "../core/campaign-hud";

// 风向标牌面尺寸(斜切底 + 两根针都要用同一把尺)
// 132 → 176:上一版真机反馈"针太小、方向要读字才知道什么意思"。加宽之后两端直接标
// 「浅 / 深」—— 针尖朝哪边,球就被推向哪边,不必再把"顺风/逆风"在脑子里换算一次。
const WG_W = 176;
const WG_H = CFG.hudColumn.h.wind;
// 闯关读数牌(目标进度 / 机制读数)共用的牌宽;高度走 CFG.hudColumn(排布判据吃同一张表)
const OBJ_W = 214;
const OBJ_H = CFG.hudColumn.h.obj;

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
  /**
   * 闯关目标进度牌:三条三星判据的实时读数 + 已挣到的星。
   * 为什么必须有(0.0.21):20 关 60 条目标在场内**一个字都不报**,HUD 只有
   * 「STAGE N · 关卡名」和「TO 7」—— 玩家得自己记"净胜 2 分打到几分了""飞扑几次了"。
   * 同门的训练场反倒有实时行(drill.ts goalText → 这块屏幕上的 drillInfo),
   * 于是"这关要什么"只有开打前看一眼简报、打完看结果,中间全程摸黑。
   * 文案与进度一律来自 core/campaign-hud(与简报、结算同一份真话),UI 不再抄一遍。
   */
  private objNode: Node;
  private objInfo: Label;
  private objBg: Graphics;
  private objWasOn = false;
  private objLastKey = "";
  private objPassed = 0;
  /** 机制读数牌(这一关改了什么、改成多少) */
  private mechNode: Node;
  private mechInfo: Label;
  private mechBg: Graphics;
  private mechLastKey = "";
  /**
   * 阵风横幅:风向翻掉的那一瞬间报一句「起风了 →」。
   * 为什么不是把角落那根针做得更准就能解决:震荡风 6.6 秒翻一次方向,而玩家的对局
   * 注意力全在球与人物身上 —— 上一版(0.0.20)加了双针牌,真机反馈仍是「方向不明显」。
   * 缺的不是读数,是**变化发生时的通知**。判据与冷却都在 physics.gustWatch(rules 派发),
   * 这里只按 gustTick 的上升沿播,自己绝不数风(那是第五份积分)。
   */
  private gustNode: Node;
  private gustLabel: Label;
  private gustBg: Graphics;
  private lastGustTick = -1;
  private gustUntil = -1;
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
  // AI 体力条(P5 斜切 5 段能量槽)
  private aiStaminaNode: Node;
  private aiStaminaG: Graphics;
  private aiStaminaLabel: Label;
  private lastStaminaLit = -1;
  // 同步用缓存
  private lastScore = "";
  private lastStatus = "";
  private lastCombo = -1;
  private lastDeuce = false;
  private lastTeamL = "";
  private lastTeamR = "";
  private lastCenter = "";
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

    // AI 体力血条(boss 规格:P5 斜切 5 段大槽,挂在 top 层 AI 比分卡右侧。
    // 旧版 50×7 缩在 pillR 角落,玩家注意力在场上根本扫不到 —— 这就是要横出来
    // 的原因:变化要在余光里发生。归一化与动画见 sync()。)
    const stNode = new Node("ai-stamina");
    stNode.layer = this.root.layer;
    stNode.addComponent(UITransform).setContentSize(CFG.aiStaminaBar.w, CFG.aiStaminaBar.h);
    stNode.setPosition(CFG.aiStaminaBar.x, CFG.aiStaminaBar.y, 0);
    stNode.setParent(top);
    this.aiStaminaNode = stNode;
    this.aiStaminaG = stNode.addComponent(Graphics);
    this.aiStaminaLabel = kit.label(stNode, "体力", 11, P.dim, { outline: P.ink, outlineW: 1.5 });
    this.aiStaminaLabel.node.setPosition(-CFG.aiStaminaBar.w / 2 - 18, 0, 0);
    this.aiStaminaLabel.node.angle = 2;
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
    tagWd.isAlignTop = true; tagWd.top = CFG.hudColumn.top.tag + safeTop;
    tagWd.updateAlignment();
    tagNode.setParent(this.root);
    this.modeTagNode = tagNode;

    // ---------- 闯关目标进度(左列第二格,压在局别标签下面) ----------
    // 左列而不是中央:中央那条带是比分牌/赛制徽章/状态行/发球旗的领地,对拉时
    // 人物与球都在中缝附近活动,常驻读数压上去就是挡视线(用户已否过全屏特效糊脸)。
    const objNode = new Node("obj-bar");
    objNode.layer = this.root.layer;
    objNode.addComponent(UITransform).setContentSize(OBJ_W, OBJ_H);
    const objBg = new Node("obj-bg");
    objBg.layer = this.root.layer;
    objBg.addComponent(UITransform).setContentSize(OBJ_W, OBJ_H);
    this.objBg = objBg.addComponent(Graphics);
    objBg.setParent(objNode);
    this.objInfo = kit.label(objNode, "", 11, ARCADE.paper, { align: 0 });
    this.objInfo.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
    this.objInfo.node.setPosition(-OBJ_W / 2 + 10, 0, 0);
    const objW = objNode.addComponent(Widget);
    objW.isAlignLeft = true; objW.left = safeLeft;
    objW.isAlignTop = true; objW.top = CFG.hudColumn.top.obj + safeTop;     // 局别标签(20)占一条,这条压它下面
    objW.updateAlignment();
    objNode.setParent(this.root);
    objNode.active = false;                              // 非闯关模式不占屏幕
    this.objNode = objNode;
    this.paintObjPlate("占位");                          // 底块先画一次,免得首次亮起时是空框

    // ---------- 阵风横幅(底部中央那条空带:两只虚拟按键之间正好没人用) ----------
    // 刻意不放大字居中横幅:那会盖住球与人物,而用户已经否过"经常触发的全屏特效"(0.0.17)。
    const gustNode = new Node("gust-banner");
    gustNode.layer = this.root.layer;
    gustNode.addComponent(UITransform).setContentSize(232, 26);
    const gustBg = new Node("gust-bg");
    gustBg.layer = this.root.layer;
    gustBg.addComponent(UITransform).setContentSize(232, 26);
    this.gustBg = gustBg.addComponent(Graphics);
    gustBg.setParent(gustNode);
    this.gustLabel = kit.label(gustNode, "", 14, ARCADE.acid, { align: 1, outline: ARCADE.ink, outlineW: 2 });
    const gustWd = gustNode.addComponent(Widget);
    gustWd.isAlignHorizontalCenter = true; gustWd.horizontalCenter = 0;
    gustWd.isAlignBottom = true; gustWd.bottom = 116 + sp.bottom;
    gustWd.updateAlignment();
    gustNode.setParent(this.root);
    gustNode.active = false;
    this.gustNode = gustNode;

    // ---------- 机制读数(这一关把玩家的什么改成了多少) ----------
    // 第 2 关「深陷流沙」的现场:腿被砍到 70%,画面却和第 1 关一模一样 —— 玩家读出的是
    // "我今天手感好差/手机卡",不是"这关是流沙"。一句「移速 70% · 判定 155%」就把机制
    // 从隐形变成事实。数值一律来自 core/campaign-hud(它只翻译关卡表,不另存一份系数)。
    const mechNode = new Node("mech-info");
    mechNode.layer = this.root.layer;
    mechNode.addComponent(UITransform).setContentSize(OBJ_W, OBJ_H);
    const mechBg = new Node("mech-bg");
    mechBg.layer = this.root.layer;
    mechBg.addComponent(UITransform).setContentSize(OBJ_W, OBJ_H);
    this.mechBg = mechBg.addComponent(Graphics);
    mechBg.setParent(mechNode);
    this.mechInfo = kit.label(mechNode, "", 11, ARCADE.cyan, { align: 0 });
    this.mechInfo.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
    this.mechInfo.node.setPosition(-OBJ_W / 2 + 10, 0, 0);
    const mechW = mechNode.addComponent(Widget);
    mechW.isAlignLeft = true; mechW.left = safeLeft;
    mechW.isAlignTop = true; mechW.top = CFG.hudColumn.top.mech + safeTop;
    mechW.updateAlignment();
    mechNode.setParent(this.root);
    mechNode.active = false;
    this.mechNode = mechNode;

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
    // 两端写死「浅 / 深」:针偏哪边,球就被推向哪边 —— 省掉"针往右到底是顺风还是逆风"
    // 这一层心算。上一版只有针和一句「顺风 → 收力」,玩家要先把文字换算回球场方向。
    const windEnd = (txt: string, x: number): void => {
      const l = kit.label(wgNode, txt, 10, ARCADE.dim, { align: 1 });
      l.node.setPosition(x, 0, 0);
    };
    windEnd("浅", -WG_W / 2 + 9);
    windEnd("深", WG_W / 2 - 9);
    const wgW = wgNode.addComponent(Widget);
    wgW.isAlignLeft = true; wgW.left = safeLeft;
    wgW.isAlignTop = true; wgW.top = CFG.hudColumn.top.wind + safeTop;     // 左列:局别 20 → 目标 48 → 机制 76 → 风向 104
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
      this.lastStaminaLit = -1;
      this.lastTeamL = "";
      this.lastTeamR = "";
      this.lastCenter = "";
      this.banner.active = false;
      this.entranceDone = false;
      fadeOutHide(this.root);
      return;
    }
    cancelFade(this.root);
    this.root.active = true;
    if (!this.entranceDone) {
      // 每局首显:P5 斩入 —— 两张比分卡相向侧入(中缝徽章保持 4° 仰角,不参与);
      // AI 体力血条跟着右卡一起斩入,「这张卡背后挂着一条血」的归属感从第一帧就建立
      this.entranceDone = true;
      const kids = this.pills.children;
      if (kids.length >= 2) {
        slashIn(kids[0], 0.05, -46, 6);
        slashIn(kids[1], 0.12, 46, -6);
      }
      if (this.aiStaminaNode) slashIn(this.aiStaminaNode, 0.2, 52, -4);
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
  /**
   * 闯关目标进度:三条判据的实时读数 + 已挣到的星。
   * 数据一律走 core/campaign-hud(与战前简报、结算页同一份措辞与同一把尺),
   * 求值仍是 campaign.ts 的 checkStarCond —— UI 这边只翻译,不另算一套。
   */
  private syncObjectives(R: RulesState): void {
    const stage = R.mode === "campaign" ? R.activeStage : null;
    const on = !!stage;
    if (on !== this.objWasOn) {
      this.objWasOn = on;
      this.objNode.active = on;
      if (!on) this.mechNode.active = false;
      if (on) { this.objLastKey = ""; this.objPassed = -1; }   // 换一局:底数复位,别把上一局的达成当新成就
    }
    if (!on || !stage) return;

    // 机制读数:这一关把玩家/球改成了多少(「移速 70% · 判定 155%」)。
    // 空就不占位 —— 对练/无限/无倍率的关卡不需要这块屏。
    const mech = [playerModReadout(stage.modifiers), physicsModReadout(stage.modifiers)]
      .filter((s) => s.length > 0).join(" · ");
    if (mech !== this.mechLastKey) {
      this.mechLastKey = mech;
      this.mechNode.active = mech.length > 0;
      if (mech.length) {
        this.mechInfo.string = mech;
        this.paintPlate(this.mechBg, mech, OBJ_H, ARCADE.cyan, 0.5);
      }
    }

    const lines = objectiveLines(stage, Rules.starFacts(R.scores[0] > R.scores[1]));
    if (!lines.length) { this.objNode.active = false; this.objWasOn = false; return; }
    const met = lines.reduce((n, l) => n + (l.ok ? 1 : 0), 0);
    const txt = `${"★".repeat(met)}${"☆".repeat(Math.max(0, lines.length - met))} ${lines.map(progressText).join(" · ")}`;
    if (txt !== this.objLastKey) {
      this.objLastKey = txt;
      this.objInfo.string = txt;
      this.paintObjPlate(txt, met);
    }
    // 刚达成一条:小弹一下 + 一声。刻意不用中央横幅 —— 那是 DEUCE 的领地,
    // 而且用户已经否过"经常触发的全屏特效"(0.0.17),这条要安静地报出来。
    if (this.objPassed >= 0 && met > this.objPassed) {
      popScore(this.objNode, this.objInfo, ARCADE.acid, ARCADE.paper);
      this.kit.sfx.play("ui");
    }
    this.objPassed = met;
  }

  /** 通用斜切读数牌:宽度跟着文案走(局别标签 / 目标进度 / 机制读数共用) */
  private paintPlate(g: Graphics, txt: string, h: number, edge: string, edgeA: number, size = 11): void {
    const ut = g.node.getComponent(UITransform);
    if (!ut) return;
    const sk = skewOf(h, 8);
    const w = Math.max(120, textW(txt, size) + 22) + Math.abs(sk);
    ut.setContentSize(w, h);
    g.node.setPosition(-OBJ_W / 2 + w / 2, 0, 0);
    g.clear();
    drawSlantShadow(g, w, h, sk, 3, 3, 0.45);
    drawSlantPanel(g, w, h, sk, { alpha: 0.88, face: ARCADE.navy, edge, edgeA });
  }

  /** 进度牌底块:宽度跟着文案走,已达条数决定描边颜色 */
  private paintObjPlate(txt: string, met = 0): void {
    const edge = met >= 3 ? ARCADE.acid : met > 0 ? ARCADE.cyan : ARCADE.line;
    this.paintPlate(this.objBg, txt, OBJ_H, edge, met > 0 ? 0.75 : 0.45);
  }

  /**
   * 阵风横幅:按 R.gustTick 的上升沿播一句,持续 ~1.1s 后自己收。
   * 文案只说**这一拍该怎么打**(顺风收力 / 逆风发力),不复述数值 —— 数值角落那根针给,
   * 这一句要抢的是"风向刚刚变了"这件事本身的注意力。
   */
  private syncGust(R: RulesState): void {
    if (R.gustTick !== this.lastGustTick) {
      this.lastGustTick = R.gustTick;
      if (R.gustTick > 0) {
        const fwd = R.gustDir > 0;                      // +1 = 朝对方底线 = 玩家这一拍顺风
        this.gustLabel.string = fwd ? "起风了 → 顺风 · 收力,别打越线" : "起风了 ← 逆风 · 发力,压深才过网";
        this.paintGustPlate(fwd);
        this.gustUntil = this.frameT + 66;
        this.gustNode.active = true;
        slashIn(this.gustNode, 0, -26, -4, 0.26);
        this.kit.sfx.play("ui");
      }
    }
    if (this.gustNode.active && this.frameT > this.gustUntil) this.gustNode.active = false;
  }

  /** 横幅底块:斜切墨条 + 风向那一侧的描边加亮(箭头朝哪边,哪边就亮) */
  private paintGustPlate(fwd: boolean): void {
    const g = this.gustBg;
    if (!g) return;
    const w = 232, h = 26;
    const sk = skewOf(h, 10);
    g.clear();
    drawSlantShadow(g, w, h, sk, 4, 4, 0.5);
    drawSlantPanel(g, w, h, sk, { alpha: 0.9, face: ARCADE.ink, edge: ARCADE.acid, edgeA: 0.7 });
    // 受力侧画一组尖刺:读成"被吹向这一边",与 render 层的星芒同一套语言
    const n = 5;
    g.fillColor = col(ARCADE.acid, 0.85);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = (fwd ? 1 : -1) * (w / 2 - 6 - t * 16);
      const yy = -h / 2 + 4 + t * (h - 8);
      g.moveTo(x, yy - 3);
      g.lineTo(x + (fwd ? 4 : -4), yy);
      g.lineTo(x, yy + 3);
      g.close();
      g.fill();
    }
  }

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
    // 满偏留 22px:两端各有一颗「浅/深」标签,针尖不许戳到字上
    const reach = W / 2 - 22;
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

  /**
   * 绘制 AI 体力能量槽(P5 风格 5 段斜切平行四边形)
   * segmentsLit ∈ [0, 5], 0 = 彻底力竭斩劈红慢呼吸警告
   */
  private paintAiStamina(segmentsLit: number, stamina: number): void {
    const g = this.aiStaminaG;
    if (!g) return;
    const cfg = CFG.aiStaminaBar;
    const totalSegs = cfg.segments;
    const segW = (cfg.w - (totalSegs - 1) * cfg.gap) / totalSegs;
    const h = cfg.h;
    const sk = cfg.skew;
    g.clear();

    // 1. 暗底槽(黑色硬投影 + 墨黑衬底)
    for (let i = 0; i < totalSegs; i++) {
      const cx = -cfg.w / 2 + i * (segW + cfg.gap) + segW / 2;
      g.fillColor = col("#000000", 0.55);
      slantPath(g, segW, h, sk, cx + 1, -1);
      g.fill();
      g.fillColor = col("#181c2b", 0.85);
      slantPath(g, segW, h, sk, cx, 0);
      g.fill();
    }

    // 2. 亮格根据体能充沛度分级着色
    if (segmentsLit > 0) {
      let hex = "#ffe14d"; // 充沛(4-5格): 荧光黄
      if (segmentsLit <= 1) hex = ARCADE.red;       // 危险(1格): 斩劈红
      else if (segmentsLit <= 3) hex = "#ff8a3d";   // 消耗(2-3格): 活力橙

      for (let i = 0; i < segmentsLit; i++) {
        const cx = -cfg.w / 2 + i * (segW + cfg.gap) + segW / 2;
        g.fillColor = col(hex, 0.95);
        slantPath(g, segW, h, sk, cx, 0);
        g.fill();
      }
    } else {
      // 0格彻底力竭: 边框带斩劈红慢呼吸警告
      const blinkA = 0.5 + Math.sin(this.frameT * 0.25) * 0.4;
      g.strokeColor = col(ARCADE.red, blinkA);
      g.lineWidth = 1;
      for (let i = 0; i < totalSegs; i++) {
        const cx = -cfg.w / 2 + i * (segW + cfg.gap) + segW / 2;
        slantPath(g, segW, h, sk, cx, 0);
        g.stroke();
      }
    }
  }

  /** 掉格:血条挨刀 —— 左右小抖(±2.5°,0.18s),玩家余光就能捕捉到"在掉血" */
  private kickStamina(): void {
    const n = this.aiStaminaNode;
    Tween.stopAllByTarget(n);
    n.angle = 0;
    tween(n).to(0.05, { angle: -2.5 }).to(0.07, { angle: 2 }).to(0.06, { angle: 0 }).start();
  }

  /** 回格:对手回气/新回合充能 —— 纵向弹一下(backOut),涨回来的方向感要明确 */
  private chargeStamina(): void {
    const n = this.aiStaminaNode;
    Tween.stopAllByTarget(n);
    n.angle = 0;
    n.setScale(1.12, 1.3, 1);
    tween(n).to(0.2, { scale: new Vec3(1, 1, 1) }, { easing: "backOut" }).start();
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

    // ---------- 闯关目标进度(闯关才亮) ----------
    this.syncObjectives(R);

    // ---------- 阵风横幅(风向刚翻的那一句) ----------
    this.syncGust(R);

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
      // 队名/目标分:值不变就不赋(Label 同值早退虽不重排,但模板串拼接本身就是每帧 GC)
      const teamL = Rules.labelOf("left");
      if (teamL !== this.lastTeamL) { this.teamL.string = teamL; this.lastTeamL = teamL; }
      const teamR = Rules.labelOf("right");
      if (teamR !== this.lastTeamR) { this.teamR.string = teamR; this.lastTeamR = teamR; }
      const stage = campaign ? R.activeStage : null;
      const center = endless
        ? "PRACTICE"
        : stage
        ? (stage.deathmatch ? "1-POINT" : `TO ${stage.targetScore}`)
        : `TO ${CFG.scoring.winScore}`;
      if (center !== this.lastCenter) { this.centerBadge.string = center; this.lastCenter = center; }

      // ---- AI 体力血条同步(boss 血条:归一化 + 掉格/回气动画) ----
      const aiPlayer = R.players.find((p) => p.side === "right" && p.isAI);
      if (!aiPlayer || drill) {
        // 训练场右半边是喂球机,没有"对手体力"这回事;pillR 挂靠关系已断,这里自己收
        this.aiStaminaNode.active = false;
      } else {
        this.aiStaminaNode.active = true;
        const pr = aiPlayer.ai?.pressure ?? 0;
        // 归一化:内部 P 已乘过档位 crush,直接 1-P 会让 hard(0.3)永远只掉 1 格、
        // easy(0.5)永不力竭 —— 顶档玩家反而看不到任何反馈,这就是旧版"感受不到"
        // 的头号根因。除回 crush → 血条表达「距离力竭还差多远」,与内部数值解耦。
        const tier = aiPlayer.aiTier ?? CFG.diffs[aiPlayer.aiDiff ?? "normal"];
        const stamina = clamp(1 - (tier.crush > 0 ? pr / tier.crush : 0), 0, 1);
        // 5 段斜切小方块: 满压或 stamina<=0.04 为 0 格(力竭)
        const lit = stamina <= 0.04 ? 0 : Math.max(1, Math.min(5, Math.ceil(stamina * 5)));
        if (lit !== this.lastStaminaLit) {
          const prev = this.lastStaminaLit;
          this.lastStaminaLit = lit;
          this.paintAiStamina(lit, stamina);
          if (prev >= 0) {
            // 掉格 = 血条挨了一刀(抖);回格 = 对手回气/新回合充能(弹一下)。
            // 前者告诉玩家"压住别松",后者告诉玩家"对手缓过来了" —— 涨跌都有戏看。
            if (lit < prev) this.kickStamina();
            else if (lit > prev) this.chargeStamina();
          }
        } else if (lit === 0) {
          this.paintAiStamina(0, stamina);   // 力竭:红框呼吸要每帧重绘
        }
      }
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
