// ============================================================
// 触屏虚拟输入层:左下「移动 + 跳」+ 右下「跨步/深球/短球」。
//
// 左半屏有两种模式,由 Settings.moveMode 决定:
//   "joystick" —— 一个模拟摇杆:推多少走多少,能做小碎步/缓冲/微调站位;
//                 **往上推 = 起跳**(见下面「摇杆代跳」一段)。
//   "buttons"  —— 老式「左 / 右」两个按钮,离散全速(旧用户体验,可切回);
//                 没摇杆可推,跳跃退回左簇那个实体键(PAD_BASE.jump)。
// 键盘永远写离散 left/right,两种模式都能兼容 —— 移动轴通过 pad.moveAxis
// 传下去,player.ts 里 moveAxis 优先、其次回落到左右键。
//
// 摇杆代跳(为什么动垂直轴):readStick 过去只把水平 dx 交给 moveAxis,垂直分量
// 画完小球就丢了 —— 一根没人消费的轴。而"跳"本义就是往上,让左手推上去、右手
// 专管出拍,跳杀这两个必须同时发生的动作终于分到两只手上。判据是 CFG.stickJump
// 的两档迟滞(upHi 起跳 / upLo 松手),细节见 makeJoystick 里的 evalStickJump。
//
// 右侧两键:swing 击球键(合并版,滑动手势区分深浅) + lunge 跨步。
// 兄弟序即绘制/命中序,层级命中从最上层往回找,不能每次启动都变。
//
// 对局态的触摸命中收在**层节点**统一裁决(编辑态仍是逐键拖动):
// 每根手指 claim 一个 touch id,按住中滑动会重新命中 —— 「左」滑到「右」
// 不抬手直接换向,对拉快攻不用先松手;划过跨步/击球键不触发(只认按住类动作),
// 防止滑动误出球、误跨步。摇杆的 claim 独立:一根手指按住摇杆区就整段归它,
// 直到抬手,不做键间断续切换。
//
// 屏幕自适应与安全区防遮挡设计:
// 1. 左侧移动簇(摇杆 或 左/右/跳)通过 Widget 吸附屏幕左下角,避让刘海/打孔。
//    **滑轨不在这一簇里**:它要和球场 1:1 对位,而球场永远以屏幕中线为对称轴。
//    左下簇会随安全区内缩,一内缩整条轨的 x 就整体平移、对不上地面的场地线 ——
//    所以滑轨单独挂「屏幕底边中点」参考系(cluster-rail),见 railGeo()。
// 2. 右侧操作簇(跨步/短球/深球)通过 Widget 吸附屏幕右下角。
// 3. 底部留出安全边距,避免沉底或触发全面屏系统手势 —— 但这只是**默认位**,
//    玩家把控件拖到哪儿由 clampDelta 决定:唯一的约束是整块留在可视区内,
//    屏幕其余地方(包括 HUD 那一带)都能放。
// 4. **padScale** 把整套控件按可视宽/960 的比例放大 —— 16:9 屏 scale=1.0,
//    20:9 屏 scale≈1.125,让手指与视觉密度跨机型保持一致。存档仍记「基准倍」
//    下的原始数字,渲染时才乘,换手机不会污染存档。
//    **滑轨是唯一的例外**:轨的「长度」不乘 scale(球场本身不缩放),只有粗细
//    与触摸目标乘 —— 否则宽屏上轨会被拉得比球场还长,1:1 就破了。
//
// 可自定义布局(设置页「调整位置」)存的是**簇内相对位移 dx/dy + 半径 r**,
// 不是屏幕绝对坐标:设计分辨率是 FIXED_HEIGHT —— 高恒 540、宽随长宽比变,
// 再叠加刘海内缩,A 机调好的绝对坐标到 B 机就出屏了。簇靠 Widget 吸角落,
// 位移相对簇原点,才能同时穿越两者变化。
// 滑轨是这套规则里唯一被砍掉一个自由度的槽位:dx 恒 0(SLIDER_LIMIT.maxDx = 0),
// 编辑态只能上下拖 —— 横向一动,轨和脚下场地的 1:1 对位就废了。
//
// 反馈增强的四处(2026-10-01:这里原本还挂着四处 haptic("light") 按键轻震,已全撤 ——
// 用户定的范围是「只在特殊击打时震」,按键级触觉只会把马达噪声垫在击球那几下下面):
//   按下 → 冲击环:同一帧画一圈外扩淡出环(alpha 220 → 0,scale 0.85 → 1.15),
//           比色变更快地告诉玩家"按到了"。
//   松手 → 过冲回弹:0.90 → 1.06 → 1.00 两段 tween,物理感更"墩"。
//   摇杆满舵 → |axis| > 0.85 时底圈描边切荧光黄(只在跨阈值那一帧换)。
//   摇杆起跳 → 上推越过 upHi 时底圈上半弧点亮:代跳没有按键,
//           不给出看得见的边界就没人能学会它。
//
// 技能键的冷却读数(键心「还剩几秒」+ 扇形 + 进度环)**不跟透明度滑杆走到底**:
// 滑杆调的是按键本体有多碍眼,而冷却是信息 —— 浓度取 cdAlpha(),留一个读数下限。
// 算法与笔画在 input/pad-cd.ts(零 cc 依赖,node 侧能断言也能出图),
// 回归 tools/pad-cd-check.ts、出图 tools/pad-cd-preview.ts。
//
// 布局变化只改节点位置/半径,不销毁重建:重建会重置兄弟顺序(本项目的绘制
// 顺序就是有语义的兄弟序)、会在 Widget 还没给全屏层定尺寸时就 updateAlignment
// (错一帧),还会丢掉正在进行的触摸 claim。**唯一例外**是 moveMode 切换:
// 摇杆与左右键是不同的节点结构,这时会拆左簇重建,同时清掉左半的 claim。
// ============================================================
import { Color, EventTouch, Graphics, Label, Layers, Node, Tween, tween, UIOpacity, UITransform, Vec3, Widget, sys, v3, view } from "cc";
import { Pad, press, release, cancelJump, resetPadHolds, setMoveAxis, setTargetX, lockSwingAxis, clearSwingLocks } from "./pad";
import {
  PAD_BASE, PAD_LABEL, Settings,
  JOYSTICK_BASE,
  SLIDER_BASE, railGeo,
  type MoveMode, type PadAction,
} from "../core/settings";
import { CFG } from "../core/config";
import { clamp } from "../core/utils";
import { cdAlpha, alphaFloor, cdText, drawCooldown, drawBlockedSlash, drawBlockedTape, makeCdGate, skillAccent, chargeText, drawCharge, CH, type CdGate } from "./pad-cd";
// 判据唯一真话在 core/skills(哪款技能走充能读数 / 怒气比例怎么算),这里只照它执行。
// 不在 touchpad 里写 `skillId === "rage"`:那样多一款充能技能就会有一处漏一处。
import { isChargeSkill } from "../core/skills";
import type { SkillId } from "../core/types";
import { applyFont } from "../game/fonts";

/** 有按下/抬起两种状态的键;跨步键是纯边沿语义,抬起不动它。
 *  击球键(swing)需要松手检测(清理 held 态),所以也在 release 列表里。
 *  swingFar/swingNear 是键盘专用路径,触屏不建按钮,不在此列表。 */
const RELEASE_ACTIONS: PadAction[] = ["left", "right", "jump", "swing"];

/** 滑动手势阈值(像素):手指从按下点横移超过这个距离即提交方向。
 *  约为按钮半径的 1/3,够小不误触、够大有缓冲。
 *  数值搬到 config.touchAim.commitPx:同样的量要在 node 侧断言(见 reach-check 第④段),
 *  而这个文件 import cc,编译不进 tools/tsconfig.json —— 留在原地就永远测不到。 */
const SWIPE_THRESHOLD = CFG.touchAim.commitPx;
/** 纵向手势阈值(像素):比横轴紧一档 —— 纵向曾是有意无语义区(防纯纵向晃动误触),
 *  给了语义(上滑挑高/下滑平抽)后仍要压住点按时的上下漂移。见 config.touchAim.commitPxY。 */
const SWIPE_THRESHOLD_Y = CFG.touchAim.commitPxY;
/** 长滑锁定距离 = 按键显示半径 × 这个倍数(从按下点起算):普通瞄准滑动远远够不着,
 *  只有一把拉到头的长滑才会锁 —— 见 config.touchAim.lockRadiusK 的注释(第一版写死
 *  34px 比按键半径还小,真机上一滑就锁,用户现场反馈改的)。 */
const SWIPE_LOCK_K = CFG.touchAim.lockRadiusK;
/** 「拉住」锁入路径的近档:滑出按键半径的这么多倍(= 明显在按键外)后停够 dwell 才锁 */
const SWIPE_LOCK_NEAR_K = CFG.touchAim.lockNearK;
/** 「拉住」锁入路径的停留时长:在近档阈值外持续这么久才认可是刻意的拖,快甩永不触发 */
const SWIPE_LOCK_DWELL_MS = CFG.touchAim.lockDwellMs;
/** 长滑锁定时某轴要被锁上的方向占比:分量达到滑动距离的一半(±30° 锥角内)才算
 *  「明确指了这个方向」—— 斜 45° 长滑两轴都锁,基本沿纵轴的长滑只锁纵轴,
 *  不让漂移分量把持久锁带偏。与短滑提交的宽松判据(|dx| ≥ commitPx/2)刻意不同:
 *  短滑只管一拍,锁错也就错一拍;锁是持久的,宁可少锁不错锁。 */
const SWIPE_LOCK_CONE = 0.5;

/**
 * 每一簇的建键顺序(照改造前的书写序,别顺手改成 PAD_ACTIONS 的顺序):
 * 兄弟序即绘制/命中序,后建的压在前一个上面。用户把两个键拖到重叠时,
 * 谁的命中优先必须由建层顺序决定,不能每次启动都变。
 *
 * 「跳」从左簇末尾建起(仅 buttons 模式会建它,见 buildLeftSide 的分派)。
 * 它原来住在右簇最上层,是因为要抢在击球键之前响应误碰;搬到左手之后
 * 右簇只剩三键,层级关系回到「击球 → 跨步」这一条线。
 */
const CLUSTER_ORDER: Record<"left" | "right", PadAction[]> = {
  left: ["left", "right", "jump"],
  right: ["swing", "lunge"],
};

/** 摇杆满舵阈值:|moveAxis| 越过这个视觉与触觉都会给一次额外反馈 */
const FULL_DEFLECT = 0.85;

// ---------- 设备自适应缩放 ----------

/**
 * 触屏控件的视觉倍率:FIXED_HEIGHT 下高恒 540,宽随长宽比变。
 * 16:9 → 960 → 1.0;18:9 → 1080 → 1.125;折叠屏外屏 → 1.25 封顶。
 * 反过来小平板 4:3 → 720 → 0.9 封底,避免按钮大到糊屏。
 * 存档值仍是「基准倍」下的原始数字,渲染时才乘 —— 用户换手机不会污染存档。
 * 上下限搬到 CFG.padSkin.scaleMin/scaleMax:冷却读数的排版断言要按「最小档按钮」算
 * (tools/pad-cd-check.ts ④),而这个文件 import cc。
 */
export function padScale(): number {
  const w = view.getVisibleSize().width;
  if (!(w > 0)) return 1;
  return clamp(w / 960, CFG.padSkin.scaleMin, CFG.padSkin.scaleMax);
}

// ---------- 视觉状态 ----------

/** hex + alpha(0..1) → cc.Color(padSkin 的值都按这个格式住 config) */
function skinColor(hex: string, a: number): Color {
  const c = new Color();
  c.fromHEX(hex);
  c.a = Math.round(clamp(a, 0, 1) * 255);
  return c;
}

interface BtnRec {
  action: PadAction;
  node: Node;
  ut: UITransform;
  g: Graphics;
  cluster: Node;
  r: number;               // 已经乘过 padScale 的当前显示半径
  pressed: boolean;
  selected: boolean;
  glow: number;            // 按拍预告辉光 0..1(game 层按来球逼近度每帧喂;只挂击球键)
  flash: Node;             // 冲击环子节点
  flashG: Graphics;
  flashOp: UIOpacity;
  /** 滑动手势方向(仅 swing 键用):0=未提交, 1=右滑(deep), -1=左滑(near)。paint 时据此画方向色弧与切图标 */
  swipeDir: number;
  /** 纵向手势(仅 swing 键用):0=未提交, 1=上滑(挑高), -1=下滑(平抽)。与 swipeDir 两轴独立、可组合 */
  swipeDirY: number;
  /**
   * 长滑锁定去重门(仅 swing 键):本次手势(按下→松手)里该轴**已经锁过的方向**。
   * trackSwingSwipe 每个 MOVE 事件都跑,没有这道门,手指停在锁定阈值外的事件流会把
   * 同一个方向连写多遍(白亮).同方向只触发一次;按下时清 0 —— 锁定动作按**手势**计。
   */
  lockDirX: number;
  lockDirY: number;
  /**
   * 「拉住」锁入路径的计时(仅 swing 键):本次手势里手指**首次越过近档阈值**
   * (lockNearK × 半径)的时刻,0 = 还没越过。越过之后在阈值外持续 lockDwellMs
   * 才认可是刻意的拖;快甩越过即松,永远凑不满这段停留 —— 短滑/长滑按快慢区分。
   * 按下时清 0(新手势重新计时)。
   */
  lockArmT: number;
  /**
   * 「欠着一拍的瞄准」(仅 swing 键):辅助开着时玩家滑了但那一拍还没打出去,
   * game 层每帧把 pad 上的提交值喂进来。手指抬起来后 swipeDir 归 0,靠它把方向继续
   * 亮在键缘上 —— 否则"滑一次只管一拍"这件事没有任何读数(判据 auto-hit-check ⑩ + 肉眼验收)。
   * 只在**没被按住**时接管画面(见 paint 的 shownSwipe):按着的时候手势自己说话,两者不打架。
   */
  aimEcho: number;
  aimEchoY: number;
  /**
   * 自动击打(辅助模式)开着 = 把击球键的键名换成「自动」(config.autoHit.padLabel)。
   * 由 game 层喂进来(setAutoMark),这个文件不 import core/auto-hit:模式判定留在逻辑侧,
   * 按键只照参数画 —— 与 setShotPreview/setSkillState 同一个形状。
   */
  autoMark: boolean;
  /** 键名文字的透明度节点(仅 swing/lunge 有):apply 里随 padAlpha 同步,不参与 paint 重画 */
  labelOp: UIOpacity | null;
  /** 键名文本组件引用(用于动态更新技能名称) */
  labelComp?: Label | null;
  /** 键心「还剩几秒」的文本与透明度(仅技能键):内容由 setSkillState 刷,透明度由 syncLabel 刷 */
  cdComp: Label | null;
  cdOp: UIOpacity | null;
  /** 技能 CD 比例: 0 (就绪) .. 1 (全量冷却中) */
  cdRatio?: number;
  /** 冷却重画门控:基准 = 上一次画上屏的 ratio(基准写错成上一帧喂值时扫掠会整段冻结,见 pad-cd.makeCdGate) */
  cdGate?: CdGate;
  /** 技能剩余冷却秒数(与 cdRatio 同源,给键心读数用) */
  cdSec?: number;
  /**
   * 充能比例 0..1(仅 kind==="charge" 的技能喂,当前 = 怒气重击):**进行中那管**的填充。
   * 与 cdRatio 是**两个反向的量**:cd 越大越不能用、充能越大越能用,所以它绝不许
   * 借用 cdRatio(那会立刻得到"怒气越满键越暗"),也不许借用 cdGate(见 chargeGate 注)。
   * 多管蓄力后它只表达"当前管充到哪了",已满几管走 chargePipes —— 两个量纲各管各的。
   */
  chargeRatio?: number;
  /**
   * 已攒满的整管数 0..pipes(仅充能款喂;多管蓄力的"点亮几段/满怒外环"判据)。
   * 满管判据从旧的 chargeRatio>=1 迁到这里:恰好攒满一管时 fill 恒 0(见
   * Skills.ragePipeFillOf 的边界口径),靠 ratio>=1 判满会在整管边界上闪瞎。
   */
  chargePipes?: number;
  /**
   * 充能环的重画门控。**必须是独立一个 gate**,不能复用 cdGate:
   * 一个 gate 只能记一个基准,两层共用就会互相顶掉基准 —— 谁后画,另一层从此冻住
   * (cd 那层的同类事故见 pad-cd.makeCdGate 的头注:「阴影只能 1/3 地消失」)。
   */
  chargeGate?: CdGate;
  /** 技能是否满足当前局势释放条件 (不满足置灰, 满足点亮) */
  skillReady?: boolean;
  /** 技能专属类型 (lunge / smash / flash / magnet / focus / shadow / rage) */
  skillId?: string;
  /** 球种预告徽标(仅 swing 键):game-root 每帧喂 previewKind 的结果,空串隐藏 */
  badgeComp?: Label | null;
  badgeOp?: UIOpacity | null;
  /** 技能门槛原因文字(仅 lunge 键):cd 走完但局势不放时键上方显示 */
  hintComp?: Label | null;
  hintOp?: UIOpacity | null;
  /** 「就绪但门槛未满足」的当前原因(setSkillState 每帧喂;null = 无或冷却中) */
  skillBlock?: string | null;
  /** 就绪呼吸 tween 是否在跑(防重复启动;triggerFlash/triggerGlow 会把它打断置回 false) */
  readyPulsing?: boolean;
}

interface StickRec {
  cluster: Node;
  root: Node;              // 底圈(位置随 Settings.joystick.dx/dy + padScale)
  baseUt: UITransform;
  baseG: Graphics;
  knob: Node;              // 摇杆小球,root 的子节点
  knobG: Graphics;
  baseR: number;           // scaled
  knobR: number;           // scaled
  selected: boolean;
  activeTouch: number | null;
  /**
   * 上推代跳的迟滞状态:true = 这一段按住已经算作「正按住跳跃键」。
   * 必须有状态,不能在每帧里直接比大小 —— upHi/upLo 两档之间来回蹭时,
   * 无状态的判据会以帧率抖 press/release,而每一次 release 都触发一次 jumpCut。
   */
  jumpOn: boolean;
  /** 底圈最后一次重画时的 (满舵, 起跳分界) 状态:TOUCH_MOVE 只在状态沿变化时重画
   *  (触屏采样率高于刷新率,旧版推一圈摇杆 = 上百次全量 Graphics 重建) */
  paintedFull: boolean;
  paintedJump: boolean;
}

interface SliderRec {
  cluster: Node;           // cluster-rail:屏幕底边中点参考系(不是左下簇,见文件头)
  root: Node;              // 底座(x = railGeo().centerUiX 锁死,y = SLIDER_BASE.y + dy)
  baseUt: UITransform;
  baseG: Graphics;
  thumb: Node;             // 滑块,root 的子节点
  thumbG: Graphics;
  span: number;            // 滑块中心行程 = 左场可达区间长度;**不乘 scale**,与地面等长
  minX: number;            // 可达区间的世界 x 两端(与 player.ts 的夹取同源,见 railGeo)
  maxX: number;
  w: number;               // scaled 轨宽 = span + 2r(两端各让出一个滑块半径)
  h: number;               // scaled 轨高
  r: number;               // scaled 轨半高半径
  selected: boolean;
  activeTouch: number | null;
  jumpOn: boolean;
  /** 轨底座最后一次重画时的起跳分界状态(TOUCH_MOVE 状态沿门控,同 StickRec) */
  paintedJump: boolean;
  lastTouchTime: number;   // 双击跳跃判定时钟(ms)
  lastTouchX: number;
  lastTouchY: number;
  /** 上次记录的滑块局部 x(用于提取手势位移方向 -1/1) */
  lastThumbX: number;
}

/**
 * 统一在这里画按钮圆(按下反馈 / 选中环 / 布局重画共用一份),
 * 半径必须从 rec.r 现读 —— 老写法把 spec.r 闭包进了重画函数,r 可变后就是暗雷。
 * 配色一律读 CFG.padSkin(铁律:数值只进 config),本文件不再私藏色值。
 */
function paint(rec: BtnRec, edit: boolean): void {
  const g = rec.g;
  const S = CFG.padSkin;
  const A = Settings.padAlpha;
  // 按拍预告辉光:底色/描边/图标向档位金色拉,glow 只挂在击球两键上,其余键恒 0。
  // 手工通道插值(shim 的 Color 没有 lerp):连 alpha 一起抬,视觉就是「按键整体变亮」。
  const glow = rec.glow;
  const mix = (hex: string, a: number, t: number): Color => {
    const c = skinColor(hex, a);
    if (t <= 0) return c;
    const to = skinColor(CFG.colors.sweet.gold, 1);
    c.r += (to.r - c.r) * t;
    c.g += (to.g - c.g) * t;
    c.b += (to.b - c.b) * t;
    c.a += (to.a - c.a) * t;
    return c;
  };
  g.clear();
  const isLunge = rec.action === "lunge";
  // 充能款(kind==="charge"):键面读的是"攒了多少",不是"还剩几秒"。
  // 它**永远不该吃 cooling 那张脸** —— cooling 会把键压成暗底 + 藏图标 + 印秒数,
  // 而"怒气越满键越暗"是把奖励画成惩罚。判据只在 core/skills.isChargeSkill 一份。
  const isCharge = isLunge && isChargeSkill((rec.skillId ?? "lunge") as SkillId);
  const cooling = isLunge && !isCharge && (rec.cdRatio ?? 0) > 0;
  const isSkillDisabled = isLunge && (rec.skillReady === false || cooling);
  // 冷却走完但仍不放 = 门槛未满足(人在空中/挥拍中/球没过来),键面画一道斜切灰杠。
  // 视觉上必须与冷却扇形区分:「等 CD 会自己好」vs「得改站位」,这是两个决策。
  const isBlocked = isLunge && !cooling && rec.skillReady === false && !!rec.skillBlock;
  const isFlashReady = isLunge && rec.skillId === "flash" && rec.skillReady && !cooling;
  // 满怒 = 充能款自己的"就绪发亮"态。与 isFlashReady **分开两个变量、共用同一套画法**
  // (双白环 + 图标提亮):两态的成因不同(一个是 CD 走完 + 球够高,一个是攒满资源),
  // 合并成一个变量将来就拆不开,而拆不开迟早演变成"给闪现也开一管怒气"这种事故。
  // 多管蓄力后判"满"看整管数(>=1 管就能顶格放),不看当前段填充 —— 见 BtnRec.chargePipes 注。
  const isRageFull = isCharge && (rec.chargePipes ?? 0) >= 1 && rec.skillReady === true;
  // 冷却读数的浓度:滑杆压到最低时也留得下对比(算法与理由见 input/pad-cd.ts)
  const Acd = cdAlpha(A);

  let baseFill = rec.pressed ? mix(S.downFill, S.downFillA * A, glow * 0.4) : mix(S.idleFill, S.idleFillA * A, glow * 0.55);
  let baseEdge = rec.pressed ? mix(S.downEdge, S.downEdgeA * A, glow * 0.6) : mix(S.idleEdge, S.idleEdgeA * A, glow);
  if (isSkillDisabled) {
    baseFill = skinColor(S.cd.fill, S.cd.fillA * Acd);
    baseEdge = skinColor(S.cd.edge, S.cd.edgeA * Acd);
  } else if (isFlashReady) {
    baseEdge = skinColor(CFG.colors.accent, 0.98 * A);
  } else if (isRageFull) {
    // 描边用技能专属色(色即功能:一眼知道"这是怒气那根管满了"),白环交给下面那层
    baseEdge = skinColor(skillAccent(rec.skillId ?? "lunge"), 0.98 * A);
  }

  g.fillColor = baseFill;
  g.strokeColor = baseEdge;
  g.lineWidth = (rec.pressed || isFlashReady || isRageFull) ? 4 : 3;
  g.circle(0, 0, rec.r);
  g.fill();
  g.stroke();

  // 就绪态的双重高光环:闪现可触发 / 怒气满槽,同一个视觉语汇("这一下按得出去,而且值得按")
  if (isFlashReady || isRageFull) {
    g.strokeColor = skinColor("#ffffff", 0.8 * A);
    g.lineWidth = 1.8;
    g.circle(0, 0, rec.r - 3);
    g.stroke();
  }

  // 冷却中: 扇形墨底 + 技能色进度环 + 前沿亮点(一份笔画,node 侧同源出图)
  if (cooling) {
    g.lineCap = Graphics.LineCap.ROUND;
    g.lineJoin = Graphics.LineJoin.ROUND;
    drawCooldown(g, skinColor, rec.r, rec.cdRatio ?? 0, rec.skillId ?? "lunge", A);
  }
  // 蓄能环:与冷却层同一条内收几何、同一套补集规矩,但**它是进度不是惩罚** ——
  // 所以充能款永远不吃上面那个 cooling 分支(见本节头注)。多管分段版:
  // 喂「当前管填充 + 已满管数」两个量纲,笔画在 pad-cd.ts,node 侧同源断言。
  if (isCharge) {
    g.lineCap = Graphics.LineCap.ROUND;
    g.lineJoin = Graphics.LineJoin.ROUND;
    drawCharge(g, skinColor, rec.r, rec.chargeRatio ?? 0, rec.skillId ?? "lunge", A, rec.chargePipes ?? 0);
  }
  // 门槛未满足(非冷却):斜切灰杠,同一笔画源在 pad-cd.ts,node 侧可断言
  if (isBlocked) {
    g.lineCap = Graphics.LineCap.ROUND;
    drawBlockedSlash(g, skinColor, rec.r, A);
  }

  if (edit && rec.selected) {
    // 外圈荧光黄环 = 「选中」,与按下的内亮区分开:编辑态两者可能同时成立
    g.strokeColor = skinColor(S.downEdge, 1 * A);
    g.lineWidth = 3;
    g.circle(0, 0, rec.r + 8);
    g.stroke();
  }

  let iconCol = mix(rec.pressed ? S.downIcon : S.icon, (rec.pressed ? S.downIconA : S.iconA) * A, glow * 0.7);
  if (isBlocked) {
    // 受阻时背后的图标作为低对比水印(watermarkA),避免线条与封条抢夺视觉
    iconCol = skinColor(S.cd.lockedIcon, (CFG.padSkin.cd.watermarkA ?? 0.18) * Acd);
  } else if (isSkillDisabled) {
    iconCol = skinColor(S.cd.lockedIcon, S.cd.lockedIconA * Acd);
  } else if (isFlashReady) {
    iconCol = skinColor("#ffe14d", 0.98 * A);
  } else if (isRageFull) {
    // 满怒的图标提亮吃技能色(与描边同色 ⇒ "这管满了"这件事只有一个颜色在说)
    iconCol = skinColor(skillAccent(rec.skillId ?? "lunge"), 0.98 * A);
  }

  // 键面上"当前瞄准哪一档"的读数:按住中 = 手指这次滑的;抬起后 = 还欠着一拍的那次滑动
  // (rec.aimEcho,game 层每帧从 pad 喂)。今天旧写法抬起即熄,于是"滑一次只管一拍"这件事
  // 在键上读不出来 —— 而辅助开着时击球键**只会**被滑、不会被按,抬起就是常态。
  const shownSwipe = rec.action === "swing" ? (rec.pressed ? rec.swipeDir : rec.aimEcho) : 0;
  const shownSwipeY = rec.action === "swing" ? (rec.pressed ? rec.swipeDirY : rec.aimEchoY) : 0;

  // 图标跟随按下/选中/技能态变色;冷却中让位给键心的剩余秒数(键名标签还在,不会认错键)
  if (!cooling) {
    drawIcon(g, rec.action, rec.r, iconCol, shownSwipe, rec.skillId);
  }

  // 门槛未满足:P5 动感斜切封条底衬盖在水印图标与斜杠上方,保证中央干净平整
  if (isBlocked) {
    g.lineCap = Graphics.LineCap.ROUND;
    g.lineJoin = Graphics.LineJoin.ROUND;
    drawBlockedTape(g, skinColor, rec.r, A);
  }
  // 纵向手势的常驻提示(仅 swing 键):键缘 12 点/6 点方向的两枚小箭头,比左右大箭头
  // 淡一档 —— 横轴是教学在先的主手势;提交哪一档,那一档提亮到满(方向色弧同时在键缘亮起)。
  // 画在键缘而不是图标旁:键内下方是键名标签(0.62r 处),放不下第四枚箭头。
  // 取值与那两道弧同一个 shownSwipeY —— 箭头与弧不许各说一套(出图肉眼判抓到过)。
  if (rec.action === "swing") {
    const tickW = Math.max(4, rec.r * 0.11);
    const tickLen = Math.max(5, rec.r * 0.14);
    const upA = shownSwipeY > 0 ? 0.95 : 0.45;
    const dnA = shownSwipeY < 0 ? 0.95 : 0.45;
    g.lineWidth = 3;
    g.strokeColor = skinColor(CFG.colors.sweet.lob, A * upA);
    g.moveTo(-tickW, rec.r - 2 - tickLen);
    g.lineTo(0, rec.r - 2);
    g.lineTo(tickW, rec.r - 2 - tickLen);
    g.stroke();
    g.strokeColor = skinColor(CFG.colors.sweet.drive, A * dnA);
    g.moveTo(-tickW, -(rec.r - 2 - tickLen));
    g.lineTo(0, -(rec.r - 2));
    g.lineTo(tickW, -(rec.r - 2 - tickLen));
    g.stroke();
  }

  // 滑动手势反馈(仅 swing 键):已提交方向时画一道方向色弧
  if (rec.action === "swing" && shownSwipe !== 0) {
    const hex = shownSwipe > 0 ? CFG.colors.sweet.gold : CFG.colors.sweet.neonCyan;
    g.strokeColor = skinColor(hex, 0.9 * A);
    g.lineWidth = 5;
    const a0 = shownSwipe > 0 ? -0.9 : Math.PI - 0.9;
    const a1 = shownSwipe > 0 ? 0.9 : Math.PI + 0.9;
    g.arc(0, 0, rec.r - 4, a0, a1, false);
    g.stroke();
  }
  // 纵向手势的方向弧:与横轴同一套画法,圆心角分别对准 12 点(+π/2,挑高)与 6 点(-π/2,平抽);
  // UI 本地 y 向上,两轴同时提交时两道弧并存(上+右 = 一眼读出「挑高到后场」)
  if (rec.action === "swing" && shownSwipeY !== 0) {
    const hex = shownSwipeY > 0 ? CFG.colors.sweet.lob : CFG.colors.sweet.drive;
    g.strokeColor = skinColor(hex, 0.9 * A);
    g.lineWidth = 5;
    const c = rec.swipeDirY > 0 ? Math.PI / 2 : -Math.PI / 2;
    g.arc(0, 0, rec.r - 4, c - 0.9, c + 0.9, false);
    g.stroke();
  }

  // 这一笔画的是什么,ratio 就是什么:所有重画路径(down/upOf/apply/edit 拖动)都在这里
  // 统一重定冷却门控的基准,stepTol 比的才是「屏上状态与真值的累计漂移」
  rec.cdGate?.sync(rec.cdRatio ?? 0);
}

/** 冲击环:按下瞬间亮一下,半径与按钮一致,alpha/scale 由 tween 驱动淡出;hex 传入档位色(甜蜜/完美辉光、滑动方向色复用同一子节点) */
function paintFlashRing(rec: BtnRec, hex?: string): void {
  const g = rec.flashG;
  const S = CFG.padSkin;
  g.clear();
  g.strokeColor = hex ? skinColor(hex, 1) : skinColor(S.downEdge, 1);
  g.lineWidth = 4;
  g.circle(0, 0, rec.r);
  g.stroke();
}

function triggerFlash(rec: BtnRec, hex?: string): void {
  paintFlashRing(rec, hex);
  rec.readyPulsing = false;          // 冲击环与呼吸共用 flash 子节点,打断呼吸态
  rec.flashOp.opacity = 220;
  rec.flash.setScale(0.85, 0.85, 1);
  Tween.stopAllByTarget(rec.flash);
  Tween.stopAllByTarget(rec.flashOp);
  tween(rec.flash).to(0.18, { scale: new Vec3(1.15, 1.15, 1) }, { easing: "quadOut" }).start();
  tween(rec.flashOp).to(0.18, { opacity: 0 }).start();
}

/**
 * 档位辉光:甜蜜/完美命中时击球键闪一圈档位色环 + 键身轻弹。
 * 与 triggerFlash(按下冲击环)刻意不同节奏 —— 一个说「我按到了」,
 * 一个说「这一拍打准了」。色值读 CFG.colors.sweet(铁律:数值只进 config)。
 */
function triggerGlow(rec: BtnRec, hex: string, strong: boolean): void {
  paintFlashRing(rec, hex);
  rec.readyPulsing = false;          // 档位辉光与呼吸共用 flash 子节点,打断呼吸态
  rec.flashOp.opacity = 255;
  rec.flash.setScale(1, 1, 1);
  Tween.stopAllByTarget(rec.flash);
  Tween.stopAllByTarget(rec.flashOp);
  const dur = strong ? 0.42 : 0.28;
  const spread = strong ? 1.6 : 1.3;
  tween(rec.flash).to(dur, { scale: new Vec3(spread, spread, 1) }, { easing: "quadOut" }).start();
  tween(rec.flashOp).to(dur, { opacity: 0 }).start();
  // 键身轻弹只在不被手指按住时做:按住态的 pressScale 缩放归 upOf 管,别抢
  if (!rec.pressed) {
    Tween.stopAllByTarget(rec.node);
    const s = strong ? 1.14 : 1.08;
    tween(rec.node)
      .to(0.08, { scale: new Vec3(s, s, 1) }, { easing: "quadOut" })
      .to(0.16, { scale: new Vec3(1, 1, 1) }, { easing: "sineIn" })
      .start();
  }
}

/** 摇杆底圈:半透明玻璃 + 十字辅助线;满舵时描边变荧光黄 */
function paintStick(st: StickRec, pressed: boolean, full: boolean, edit: boolean): void {
  const g = st.baseG;
  const S = CFG.padSkin;
  const A = Settings.padAlpha;
  g.clear();
  g.fillColor = skinColor(S.idleFill, S.idleFillA * A * 0.55);
  g.circle(0, 0, st.baseR);
  g.fill();
  // 描边:静止 = idleEdge 半透;按下 = downEdge;满舵 = 荧光黄实线
  if (full || pressed) {
    g.strokeColor = skinColor(S.downEdge, (full ? 1 : 0.72) * A);
    g.lineWidth = full ? 4 : 3;
  } else {
    g.strokeColor = skinColor(S.idleEdge, S.idleEdgeA * A * 0.7);
    g.lineWidth = 3;
  }
  g.circle(0, 0, st.baseR);
  g.stroke();
  // 内圈虚线参考(半径 baseR * 0.55),给玩家一个"推到这里算满舵"的直觉
  g.strokeColor = skinColor(S.idleEdge, S.idleEdgeA * A * 0.28);
  g.lineWidth = 2;
  g.circle(0, 0, st.baseR * 0.6);
  g.stroke();
  // 起跳分界线:摇杆代跳没有按键,不把「推过这里就跳」画出来没人学得会。
  // 画的是这条弦在底圈内的弦段(端点由坐标直接算),不用 arc —— arc 的角度
  // 旋向在 UI 层 y 轴向上/向下约定下容易反,画错半圈就成了「往下推才跳」。
  const J = CFG.stickJump;
  const jy = st.baseR * J.upHi;
  const jw = Math.sqrt(Math.max(0, st.baseR * st.baseR - jy * jy));
  g.strokeColor = skinColor(S.downEdge, (st.jumpOn ? 0.95 : 0.3) * A);
  g.lineWidth = st.jumpOn ? 5 : 2;
  g.moveTo(-jw, jy);
  g.lineTo(jw, jy);
  g.stroke();
  if (edit && st.selected) {
    g.strokeColor = skinColor(S.downEdge, 1 * A);
    g.lineWidth = 3;
    g.circle(0, 0, st.baseR + 10);
    g.stroke();
  }
}

/** 摇杆 knob:实心圆 + 高光描边;按下更亮一点 */
function paintKnob(st: StickRec, pressed: boolean): void {
  const g = st.knobG;
  const S = CFG.padSkin;
  const A = Settings.padAlpha;
  g.clear();
  g.fillColor = pressed ? skinColor(S.downFill, 0.95 * A) : skinColor(S.idleFill, 0.92 * A);
  g.strokeColor = pressed ? skinColor(S.downEdge, 0.95 * A) : skinColor(S.idleEdge, 0.85 * A);
  g.lineWidth = pressed ? 4 : 3;
  g.circle(0, 0, st.knobR);
  g.fill();
  g.stroke();
  // 中点小高光,让 knob 看起来是"凸起来可以推"的实体而不是平面色块
  g.fillColor = pressed ? skinColor(S.downIcon, 0.85 * A) : skinColor(S.icon, 0.55 * A);
  g.circle(0, 0, st.knobR * 0.22);
  g.fill();
}

/** 滑轨底座:胶囊型滑道(与左半场 1:1 对位)+ 真实场地线刻度 + 上滑起跳提示箭头 */
function paintSliderTrack(st: SliderRec, pressed: boolean, edit: boolean): void {
  const g = st.baseG;
  const S = CFG.padSkin;
  const A = Settings.padAlpha;
  const CO = CFG.court;
  const w = st.w, h = st.h, r = st.r;
  g.clear();

  // 底轨背景
  g.fillColor = skinColor(S.idleFill, S.idleFillA * A * 0.55);
  g.roundRect(-w / 2, -h / 2, w, h, r);
  g.fill();

  // 描边:按下时高亮
  if (pressed) {
    g.strokeColor = skinColor(S.downEdge, 0.88 * A);
    g.lineWidth = 3;
  } else {
    g.strokeColor = skinColor(S.idleEdge, S.idleEdgeA * A * 0.7);
    g.lineWidth = 2;
  }
  g.roundRect(-w / 2, -h / 2, w, h, r);
  g.stroke();

  // 刻度 = 脚下的真实场地线。轨与球场 1:1 对位后,世界 x 平移一下就能直接落笔,
  // 所以这里不再按轨宽取百分比(老那套假刻度对不上地面的任何一条线)。
  // 判读方式很简单:滑块停在哪条线上,人就站在那条线的正下方。
  const centerWorldX = (st.minX + st.maxX) / 2;   // 轨心脚下的世界 x
  const tick = (worldX: number, half: number): void => {
    const x = worldX - centerWorldX;
    g.moveTo(x, -half); g.lineTo(x, half); g.stroke();
  };
  g.strokeColor = skinColor(S.idleEdge, S.idleEdgeA * A * 0.42);
  g.lineWidth = 1.5;
  tick(CO.left, r * 0.45);            // 我方底线
  tick(CO.shortServeL, r * 0.45);     // 前发球线
  // 球网:更粗更亮、画得更满 —— 它是「再往右也过不去」的那道墙
  g.strokeColor = skinColor(S.idleEdge, S.idleEdgeA * A * 0.78);
  g.lineWidth = 3;
  tick(CO.netX, r * 0.74);
  // 可达端点(滑块行程的两个极限,即 wallL 与 netX-netPad):贴着轨上下缘的短横档,
  // 和「场地线」那种通高竖线区分开,免得右端三道线糊成一坨看不出谁是谁。
  g.strokeColor = skinColor(S.idleEdge, S.idleEdgeA * A * 0.5);
  g.lineWidth = 2;
  for (const lim of [st.minX, st.maxX]) {
    const x = lim - centerWorldX;
    g.moveTo(x, -r * 0.95); g.lineTo(x, -r * 0.6); g.stroke();
    g.moveTo(x, r * 0.6);  g.lineTo(x, r * 0.95);  g.stroke();
  }

  // 顶部起跳手势指引(小上箭头):越过起跳阈值时高亮
  const jumpArrowY = r + 6;
  g.strokeColor = skinColor(S.downEdge, (st.jumpOn ? 0.95 : 0.35) * A);
  g.lineWidth = st.jumpOn ? 3.5 : 2;
  g.moveTo(-7, jumpArrowY);
  g.lineTo(0, jumpArrowY + 6);
  g.lineTo(7, jumpArrowY);
  g.stroke();

  if (edit && st.selected) {
    g.strokeColor = skinColor(S.downEdge, 1 * A);
    g.lineWidth = 3;
    g.roundRect(-w / 2 - 8, -h / 2 - 8, w + 16, h + 16, r + 8);
    g.stroke();
  }
}

/** 滑轨 thumb:高光滑块 + 抓手手感刻线 */
function paintSliderThumb(st: SliderRec, pressed: boolean): void {
  const g = st.thumbG;
  const S = CFG.padSkin;
  const A = Settings.padAlpha;
  const tr = st.r * 0.88;
  g.clear();

  g.fillColor = pressed ? skinColor(S.downFill, 0.96 * A) : skinColor(S.idleFill, 0.92 * A);
  g.strokeColor = pressed ? skinColor(S.downEdge, 0.98 * A) : skinColor(S.idleEdge, 0.88 * A);
  g.lineWidth = pressed ? 3.5 : 2.5;
  g.circle(0, 0, tr);
  g.fill();
  g.stroke();

  // 抓手微刻线(3 条坚向微细线,暗示手指可左右滑动)
  g.strokeColor = pressed ? skinColor(S.downIcon, 0.9 * A) : skinColor(S.icon, 0.6 * A);
  g.lineWidth = 2;
  const lh = tr * 0.45;
  g.moveTo(-4, -lh); g.lineTo(-4, lh); g.stroke();
  g.moveTo(0, -lh);  g.lineTo(0, lh);  g.stroke();
  g.moveTo(4, -lh);  g.lineTo(4, lh);  g.stroke();
}

// ---------- 按钮图标(矢量,跟随按钮半径缩放) ----------

/** 重击图(深球档):粗笔高弧 + 顶端实心球 + 爆发短线 —— 力量感。
 *  击球键右滑提交后整键切这张;键盘 swingFar(已不上屏)共用同一份。 */
function drawPowerShot(g: Graphics, r: number): void {
  const w = r * 0.55;
  const h = r * 0.78;
  const N = 20;
  g.lineWidth = 6;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = -w + 2 * w * t;
    const y = -r * 0.15 + 4 * h * t * (1 - t);
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.stroke();
  // 顶端实心球(羽毛球)
  const br = r * 0.11;
  g.circle(w, -r * 0.15, br);
  g.fill();
  // 力量爆发线(从球向外辐射)
  g.lineWidth = 3;
  const bx = w, by = -r * 0.15;
  for (const a of [-0.9, -0.35, 0.2]) {
    g.moveTo(bx + Math.cos(a) * (br + 2), by + Math.sin(a) * (br + 2));
    g.lineTo(bx + Math.cos(a) * (br + 9), by + Math.sin(a) * (br + 9));
    g.stroke();
  }
}

/** 轻击图(短球档):细笔低弧 + 空心球 + 落点反弹小弧 —— 轻盈感。
 *  击球键左滑提交后整键切这张;键盘 swingNear(已不上屏)共用同一份。 */
function drawDropShot(g: Graphics, r: number): void {
  const w = r * 0.55;
  const h = r * 0.5;
  const N = 16;
  g.lineWidth = 3.5;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = -w + 2 * w * t;
    const y = r * 0.02 + h * Math.sin(Math.PI * t);
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.stroke();
  // 落点空心圈(球轻盈落地)
  g.circle(w, r * 0.02, r * 0.09);
  g.stroke();
  // 过网轻落小弧(在落点右侧)
  g.lineWidth = 2.5;
  const bx = w + r * 0.14, by = r * 0.02;
  g.moveTo(bx, by + 2);
  g.quadraticCurveTo(bx + r * 0.09, by + 9, bx + r * 0.18, by + 2);
  g.stroke();
}

/**
 * 在 Graphics 原点周围画按钮图标。
 * - left / right: 箭头
 * - jump: 上箭头
 * - lunge: 正面大开立的人形剪影 + 两侧速度线(键本身不带方向,往哪跨由方向键决定)
 * - swing: variant 三态 —— 0 中性羽毛球 + 档位色滑动箭头;1 深球重击图;-1 短球轻击图
 * - swingFar / swingNear: 键盘专用路径(触屏不再建按钮),与 swing 的两张档位图同源
 */
function drawIcon(g: Graphics, action: PadAction, r: number, color: Color, variant = 0, skillId = "lunge"): void {
  g.strokeColor = color;
  g.fillColor = color;
  g.lineWidth = 5;
  g.lineCap = Graphics.LineCap.ROUND;
  g.lineJoin = Graphics.LineJoin.ROUND;

  switch (action) {

    case "left": {
      const s = r * 0.38;
      g.moveTo(s * 0.35, s);
      g.lineTo(-s * 0.55, 0);
      g.lineTo(s * 0.35, -s);
      g.stroke();
      break;
    }

    case "right": {
      const s = r * 0.38;
      g.moveTo(-s * 0.35, s);
      g.lineTo(s * 0.55, 0);
      g.lineTo(-s * 0.35, -s);
      g.stroke();
      break;
    }

    case "jump": {
      const s = r * 0.38;
      g.moveTo(-s, -s * 0.25);
      g.lineTo(0, s * 0.65);
      g.lineTo(s, -s * 0.25);
      g.stroke();
      break;
    }

    case "lunge": {
      const sId = skillId || "lunge";
      if (sId === "smash") {
        // 百分百重击: 倾斜斩击巨剑 + 爆星
        const s = r * 0.42;
        g.lineWidth = 5;
        g.moveTo(-s * 0.45, -s * 0.45);
        g.lineTo(s * 0.45, s * 0.45);
        g.stroke();
        g.lineWidth = 3.5;
        g.moveTo(-s * 0.25, -s * 0.1);
        g.lineTo(-s * 0.6, -s * 0.35);
        g.stroke();
        g.circle(s * 0.55, s * 0.55, s * 0.18);
        g.fill();
        break;
      }
      if (sId === "flash") {
        // 闪现扣杀: 折线闪电
        const s = r * 0.42;
        g.lineWidth = 4.5;
        g.moveTo(-s * 0.2, s * 0.85);
        g.lineTo(-s * 0.48, s * 0.1);
        g.lineTo(0, s * 0.1);
        g.lineTo(-s * 0.25, -s * 0.7);
        g.lineTo(s * 0.48, 0);
        g.lineTo(0.08, 0);
        g.lineTo(s * 0.35, s * 0.85);
        g.stroke();
        break;
      }
      if (sId === "magnet") {
        // 引力吸球: 双同心圆 + 向心引力
        const s = r * 0.42;
        g.lineWidth = 3.2;
        g.circle(0, 0, s * 0.82);
        g.stroke();
        g.circle(0, 0, s * 0.46);
        g.stroke();
        g.circle(0, 0, s * 0.18);
        g.fill();
        break;
      }
      if (sId === "focus") {
        // 时空减速: 表盘刻度 + 指针
        const s = r * 0.42;
        g.lineWidth = 3.2;
        g.circle(0, 0, s * 0.75);
        g.stroke();
        g.lineWidth = 3.8;
        g.moveTo(0, 0);
        g.lineTo(0, s * 0.45);
        g.moveTo(0, 0);
        g.lineTo(s * 0.38, 0);
        g.stroke();
        g.circle(0, 0, s * 0.15);
        g.fill();
        break;
      }
      if (sId === "shadow") {
        // 影分身(2026-10-04): 一实一虚两个人形残影 + 中间一道斜切缝。
        // 实心人形在前(宿主),细线人形在后上方偏移(分身,还没凝实)——
        // 一眼读出"从本体分出一个影子";斜切缝是全站 P5 斩劈语汇,不画光滑重叠圈。
        const s = r * 0.40;
        // 虚影(后方):细描边,读作"影子"
        g.lineWidth = 2.5;
        const gx = -s * 0.58, gy = s * 0.24;
        g.circle(gx, gy + s * 0.86, s * 0.2);
        g.stroke();
        g.moveTo(gx, gy + s * 0.62);
        g.lineTo(gx, gy + s * 0.06);
        g.stroke();
        g.moveTo(gx, gy + s * 0.06);
        g.lineTo(gx - s * 0.42, gy - s * 0.48);
        g.moveTo(gx, gy + s * 0.06);
        g.lineTo(gx + s * 0.42, gy - s * 0.48);
        g.stroke();
        // 斜切缝:虚实分界
        g.lineWidth = 3;
        g.moveTo(-s * 0.1, s * 0.98);
        g.lineTo(-s * 0.42, -s * 0.3);
        g.stroke();
        // 实心(前方):宿主本体
        g.lineWidth = 5;
        g.circle(s * 0.32, s * 0.58, s * 0.22);
        g.fill();
        g.moveTo(s * 0.32, s * 0.32);
        g.lineTo(s * 0.32, -s * 0.22);
        g.stroke();
        g.moveTo(s * 0.32, -s * 0.22);
        g.lineTo(s * 0.06, -s * 0.82);
        g.moveTo(s * 0.32, -s * 0.22);
        g.lineTo(s * 0.58, -s * 0.82);
        g.stroke();
        break;
      }
      if (sId === "rage") {
        // 怒气重击(2026-10-04):一柱**带锯齿的斗气火苗** + 底部一道压梁 + 一粒余烬。
        // 语汇照全站 P5 规矩:打击类 = 尖刺/锯齿,不画光滑火苗轮廓(那是引力/时空那一族的圆),
        // 也不照抄重击那把剑 —— 两款都是"轰一拍",但这款的卖点是被打断之后还能攒回来,
        // 形状要读得出"从下往上长起来的东西",所以火苗的尖全朝上(+y,UI 本地 y 向上)。
        const s = r * 0.42;
        // 主苗:实心,带两个锯齿边(出生定形的几何,不逐帧 rand —— 见 AGENTS.md P5 那条)
        g.lineWidth = 3;
        g.moveTo(-s * 0.3, -s * 0.34);
        g.lineTo(-s * 0.16, s * 0.16);
        g.lineTo(-s * 0.3, s * 0.2);      // 左锯齿
        g.lineTo(-s * 0.02, s * 0.52);
        g.lineTo(-s * 0.14, s * 0.62);    // 上锯齿
        g.lineTo(s * 0.1, s * 1.0);       // 顶尖
        g.lineTo(s * 0.16, s * 0.5);
        g.lineTo(s * 0.34, s * 0.6);      // 右锯齿
        g.lineTo(s * 0.3, -s * 0.34);
        g.close();
        g.fill();
        // 压梁:读作"攒在底下的那口气",也给火苗一个落脚的底座
        g.lineWidth = 4.5;
        g.moveTo(-s * 0.62, -s * 0.5);
        g.lineTo(s * 0.62, -s * 0.5);
        g.stroke();
        // 余烬:偏左一粒,破掉对称(全站尖刺件都带一颗偏心点,见 p5kit 星芒)
        g.circle(-s * 0.52, s * 0.34, s * 0.13);
        g.fill();
        break;
      }

      // 默认强力跨步: 正面大开立的人形剪影 + 两侧速度线
      const s = r * 0.42;
      g.circle(0, s * 0.88, s * 0.24);
      g.fill();
      g.lineWidth = 5.5;
      g.moveTo(0, s * 0.6);
      g.lineTo(0, s * 0.05);
      g.stroke();
      g.moveTo(0, s * 0.05);
      g.lineTo(-s * 0.72, -s * 0.62);
      g.moveTo(0, s * 0.05);
      g.lineTo(s * 0.72, -s * 0.62);
      g.stroke();
      g.lineWidth = 4.5;
      g.moveTo(0, s * 0.48);
      g.lineTo(-s * 0.52, s * 0.02);
      g.moveTo(0, s * 0.48);
      g.lineTo(s * 0.52, s * 0.02);
      g.stroke();
      g.lineWidth = 3.5;
      for (const side of [-1, 1]) {
        const x0 = side * s * 0.98, x1 = side * s * 1.34;
        g.moveTo(x0, s * 0.32); g.lineTo(x1, s * 0.32); g.stroke();
        g.moveTo(x0, -s * 0.08); g.lineTo(x1, -s * 0.08); g.stroke();
      }
      break;
    }

    case "swingFar":
      drawPowerShot(g, r);
      break;

    case "swingNear":
      drawDropShot(g, r);
      break;

    case "swing": {
      // 合并击球键,三态:
      //   variant 0(未滑) —— 羽毛球本体 + 两侧档位色滑动箭头(右金=深球,左青=短球,
      //     与提交后的反馈弧/冲击环同色系:颜色即档位语言);
      //   variant 1(右滑) —— 整键切金色重击图;variant -1(左滑)—— 整键切青色轻击图。
      if (variant > 0) { drawPowerShot(g, r); break; }
      if (variant < 0) { drawDropShot(g, r); break; }
      const s = r * 0.42;
      // —— 羽毛球本体:球头实心 + 锥形羽裙 + 三片羽线(球头朝下,立在键面中央)——
      g.lineWidth = 3.5;
      // 裙口弧
      g.moveTo(-s * 0.55, s * 0.5);
      g.quadraticCurveTo(0, s * 0.68, s * 0.55, s * 0.5);
      g.stroke();
      // 裙两侧轮廓
      g.moveTo(-s * 0.55, s * 0.5);
      g.lineTo(-s * 0.2, -s * 0.34);
      g.moveTo(s * 0.55, s * 0.5);
      g.lineTo(s * 0.2, -s * 0.34);
      g.stroke();
      // 羽片线(裙内三道)
      g.lineWidth = 2.5;
      g.moveTo(0, s * 0.56);
      g.lineTo(0, -s * 0.28);
      g.moveTo(-s * 0.06, s * 0.52);
      g.lineTo(-s * 0.32, -s * 0.2);
      g.moveTo(s * 0.06, s * 0.52);
      g.lineTo(s * 0.32, -s * 0.2);
      g.stroke();
      // 球头(软木):实心圆
      g.circle(0, -s * 0.52, s * 0.26);
      g.fill();
      // —— 左右滑动指示:大号档位色箭头 ——
      const aw = r * 0.15;           // 箭头半宽
      const ax = r * 0.66;           // 箭头尖到中心距离
      g.lineWidth = 4;
      // 左箭头(青,短球)
      g.strokeColor = skinColor(CFG.colors.sweet.neonCyan, color.a / 255);
      g.moveTo(-ax + aw, -aw);
      g.lineTo(-ax - aw * 0.35, 0);
      g.lineTo(-ax + aw, aw);
      g.stroke();
      // 右箭头(金,深球)
      g.strokeColor = skinColor(CFG.colors.sweet.gold, color.a / 255);
      g.moveTo(ax - aw, -aw);
      g.lineTo(ax + aw * 0.35, 0);
      g.lineTo(ax - aw, aw);
      g.stroke();
      break;
    }
  }
}

// ---------- 安全区 ----------

export interface SafeMargins { l: number; r: number; b: number }

/** 获取设备安全边距(防打孔屏/刘海屏及底部全面屏横条) */
function safeMargins(): SafeMargins {
  let l = 28, r = 28, b = 20;
  try {
    const safeRect = sys.getSafeAreaRect();
    const visSize = view.getVisibleSize();
    if (safeRect && visSize.width > 0) {
      if (safeRect.x > 0) l = Math.max(l, safeRect.x + 8);
      const rightMargin = visSize.width - (safeRect.x + safeRect.width);
      if (rightMargin > 0) r = Math.max(r, rightMargin + 8);
      if (safeRect.y > 0) b = Math.max(b, safeRect.y + 4);
    }
  } catch {
    // 兜底使用默认安全留白
  }
  return { l, r, b };
}

// ---------- 建层 ----------

/**
 * 编辑选中的槽位:PadAction 中的任一按钮、"joystick"(摇杆本体)、"slider"(滑轨本体)、或 null(未选中)。
 * 编辑器与设置面板共用这一套语言。
 */
export type PadSlot = PadAction | "joystick" | "slider";

export interface TouchPadOpts {
  /** 编辑实例:可拖动、只通知回调,绝不写 Pad(拖动不许打出球,也不许打出一个跨步) */
  edit?: boolean;
  onPick?(slot: PadSlot): void;
  onDrag?(slot: PadSlot, dx: number, dy: number): void;
  onDragEnd?(slot: PadSlot): void;
}

export interface TouchPadHandle {
  root: Node;
  /** 读 Settings 现值刷位置/半径/画面;幂等,可每帧调;moveMode 变了这里会拆左簇重建 */
  apply(): void;
  /** 把候选位移夹到当前视口内(拖动时夹存档值,显示时只夹显示) */
  clampDelta(slot: PadSlot, dx: number, dy: number): { dx: number; dy: number };
  /** 编辑态选中环;传 null 清空 */
  select(slot: PadSlot | null): void;
  /** 甜蜜/完美命中 → 击球两键档位辉光(只由 GameRoot 在真人自己打出好球时调) */
  pulseSwing(tier: "sweet" | "perfect"): void;
  /**
   * 按拍预告辉光:0..1,game 层按「来球距最佳按拍时刻的逼近度」每帧喂。
   * 只重画击球两键,电平变化 <0.02 跳过重画,不来球时恒 0(无重画开销)。
   */
  setSwingGlow(level: number): void;
  /**
   * 设置技能按键的运行时状态 (CD比例、就绪状态、技能ID及按键名称)。
   * cdSec = 剩余冷却秒数(与 cdRatio 同源,由 game-root 从 s.cd 换算),画在键心当倒计时。
   * blockReason = cd 走完但门槛未满足时的可读原因(skills.skillBlockReason 判定),
   * 键上方常驻显示;null = 完全就绪或冷却中。
   * chargeRatio = 充能比例 0..1,**只有 kind==="charge" 的技能(怒气重击)会被读**:
   * 它画在环上、印在键心,与 cdRatio 各走一条通道(两者语义相反,不许互相顶替)。
   * 多管蓄力后 chargeRatio 是「进行中那管」的填充,chargePipes = 已满的整管数 ——
   * 两个量纲各管各的,键面分段环与总百分比读数都从这一对值折算。
   * 参数放最后且带默认值 ⇒ 现有六个技能的调用点一行都不用改。
   */
  setSkillState(cdRatio: number, ready: boolean, skillId: string, skillName?: string, cdSec?: number, blockReason?: string | null, chargeRatio?: number, chargePipes?: number): void;
  /**
   * 球种预告徽标(击球键上方):game-root 每帧喂 Player.previewKind 的结果;
   * null = 无来球,隐藏。只报球种 —— 自动这个模式读数在键名上(见 setAutoMark)。
   */
  setShotPreview(kind: string | null): void;
  /** 自动击打(辅助模式)的键面读数:开 = 击球键键名换成「自动」(config.autoHit.padLabel) */
  setAutoMark(on: boolean): void;
  /** 「已经瞄准、还没用掉」的方向回显(-1|0|1 两轴);那一拍打出去后由 game-root 喂 0 熄灭 */
  setAimEcho(x: number, y: number): void;
  /** 当前生效的移动方式(便于面板判断要不要显示摇杆的 chip) */
  readonly moveMode: MoveMode;
  /** 清触摸 claim 与按下的视觉状态(层被隐藏时 TOUCH_END 送不到,必须主动清) */
  clearPressed(): void;
  readonly safe: SafeMargins;
  destroy(): void;
}

/** UI 坐标 → 簇局部坐标(UI 单位即世界单位,不需要任何缩放系数) */
const tmpVec = new Vec3();
/** 命中检测的键心暂存向量(旧版在 hitAny 循环里每个键 new 一个) */
const tmpVecB = new Vec3();
function toClusterLocal(cluster: Node, e: EventTouch): Vec3 {
  const u = e.getUILocation();
  return cluster.getComponent(UITransform)!.convertToNodeSpaceAR(v3(u.x, u.y, 0), tmpVec);
}

/**
 * 键心读数的尺寸:字号 = sizeK × 半径(跟图标一样随半径缩放,而不是写死一个像素值),
 * 圆心抬到 numY × 半径 —— 让开贴在键圆底部那行键名,两个读数不许叠在一起
 * (这条几何在 tools/pad-cd-check.ts 里当断言④钉住,半径取到最小档时最容易撞)。
 * 建层时摆一次、apply() 改半径后再摆一次,共用同一个算式。
 *
 * sizeK 可覆写:充能款印的是「100%」这种 4 字宽,比倒计时"3.5"宽得多,
 * 照 numK 摆会在最小半径档啃到键名标签 —— 所以它用 padSkin.cd.charge.pctK(收一档)。
 */
function sizeCdLabel(comp: Label | null, r: number, sizeK?: number): void {
  if (!comp) return;
  const K = CFG.padSkin.cd;
  const fs = Math.max(9, Math.round(r * (sizeK ?? K.numK)));
  comp.fontSize = fs;
  comp.lineHeight = Math.round(fs * 1.1);
  comp.node.setPosition(0, r * K.numY);
}

function makeButton(action: PadAction, cluster: Node, opts: TouchPadOpts, recs: BtnRec[], scale: number): BtnRec {
  const base = PAD_BASE[action];
  const p = Settings.padOf(action);
  const r = p.r * scale;

  const node = new Node(`btn-${action}`);
  node.layer = Layers.Enum.UI_2D;
  const ut = node.addComponent(UITransform);
  ut.setContentSize(r * 2, r * 2);
  node.setPosition((base.x + p.dx) * scale, (base.y + p.dy) * scale);
  node.setParent(cluster);

  const g = node.addComponent(Graphics);

  // 冲击环子节点:UIOpacity 淡出 + 子节点自身 scale 外扩
  const flash = new Node(`flash-${action}`);
  flash.layer = Layers.Enum.UI_2D;
  const flashUt = flash.addComponent(UITransform);
  flashUt.setContentSize(r * 2.6, r * 2.6);
  const flashG = flash.addComponent(Graphics);
  const flashOp = flash.addComponent(UIOpacity);
  flashOp.opacity = 0;
  flash.setParent(node);

  // 键名文字标签(仅击球/跨步两键):图形之外再给一行字,一眼可读。
  // 挂在按钮圆内底部,不参与 paint 重画;透明度随 padAlpha,由 apply() 同步。
  let labelOp: UIOpacity | null = null;
  let labelComp: Label | null = null;
  if (action === "swing" || action === "lunge") {
    const PS = CFG.padSkin;
    const ln = new Node(`label-${action}`);
    ln.layer = Layers.Enum.UI_2D;
    ln.addComponent(UITransform).setContentSize(r * 1.7, PS.labelSize * 1.5);
    const lb = ln.addComponent(Label);
    lb.string = PAD_LABEL[action];
    lb.fontSize = PS.labelSize;
    lb.lineHeight = Math.round(PS.labelSize * 1.22);
    lb.horizontalAlign = 1;
    lb.verticalAlign = 1;
    lb.color = skinColor(PS.label, 1);
    lb.enableOutline = true;
    lb.outlineColor = skinColor(PS.labelOutline, 1);
    lb.outlineWidth = 2;
    applyFont(lb, true);
    ln.setPosition(0, -r * 0.62);
    labelOp = ln.addComponent(UIOpacity);
    labelOp.opacity = Math.round(PS.labelA * Settings.padAlpha * 255);
    ln.setParent(node);
    labelComp = lb;
  }

  // 键心倒计时(仅技能键):冷却是「还剩几秒」这件事,只有数字能一眼读完 ——
  // 扇形角度要目测,而拇指底下没人去目测。图形画不了字(见 AGENTS 的坑 5),走 Label。
  // 字号随半径缩放(和图标同一条规矩),透明度不取滑杆原值而是 cdAlpha
  // (滑杆最低时读数仍要读得出来,理由见 input/pad-cd.ts)。圆心抬高 numY·r 让开键名标签。
  let cdOp: UIOpacity | null = null;
  let cdComp: Label | null = null;
  if (action === "lunge") {
    const cn = new Node(`cd-${action}`);
    cn.layer = Layers.Enum.UI_2D;
    cn.addComponent(UITransform);
    const cb = cn.addComponent(Label);
    cb.string = "";
    cb.horizontalAlign = 1;
    cb.verticalAlign = 1;
    cb.isBold = true;
    cb.color = skinColor(CFG.padSkin.cd.num, 1);
    cb.enableOutline = true;
    cb.outlineColor = skinColor(CFG.padSkin.cd.numOutlineColor, 1);
    cb.outlineWidth = CFG.padSkin.cd.numOutline;
    applyFont(cb, true);
    cdOp = cn.addComponent(UIOpacity);
    cdOp.opacity = 0;
    cn.setParent(node);
    cdComp = cb;
    sizeCdLabel(cb, r);
  }

  // 球种预告徽标(仅击球键):game-root 每帧用 previewKind 预演这一拍,把球种写在键上方。
  // 「这一拍是扣杀/放网」不再靠碰 —— 预告与实打共用同一条 buildShot 代码路径。
  let badgeOp: UIOpacity | null = null;
  let badgeComp: Label | null = null;
  if (action === "swing") {
    const B = CFG.shotBadge;
    const bn = new Node(`badge-${action}`);
    bn.layer = Layers.Enum.UI_2D;
    bn.addComponent(UITransform).setContentSize(96, B.size * 1.5);
    const bl = bn.addComponent(Label);
    bl.string = "";
    bl.fontSize = B.size;
    bl.lineHeight = Math.round(B.size * 1.15);
    bl.horizontalAlign = 1;
    bl.verticalAlign = 1;
    bl.isBold = true;
    bl.enableOutline = true;
    bl.outlineColor = skinColor(B.outline, 1);
    bl.outlineWidth = 2.5;
    applyFont(bl, true);
    bn.setPosition(0, r * B.dyK);
    badgeOp = bn.addComponent(UIOpacity);
    badgeOp.opacity = 0;
    bn.setParent(node);
    badgeComp = bl;
  }

  // 技能门槛原因(仅技能键):cd 走完但局势不放时,内嵌在键内 P5 动感斜切封条上
  // (「球没过来」「挥拍中」「球不够高」…判据在 skills.skillBlockReason,文案在 config.skills.blockText)
  let hintOp: UIOpacity | null = null;
  let hintComp: Label | null = null;
  if (action === "lunge") {
    const CDK = CFG.padSkin.cd;
    const hn = new Node(`hint-${action}`);
    hn.layer = Layers.Enum.UI_2D;
    const tapeW = r * (CDK.tapeW ?? 1.44);
    const tapeH = r * (CDK.tapeH ?? 0.42);
    hn.addComponent(UITransform).setContentSize(tapeW, tapeH);
    const hb = hn.addComponent(Label);
    hb.string = "";
    const fs = Math.max(7, Math.round(r * 0.26));
    hb.fontSize = fs;
    hb.lineHeight = Math.round(fs * 1.15);
    hb.horizontalAlign = 1;
    hb.verticalAlign = 1;
    hb.isBold = true;
    hb.enableOutline = true;
    hb.outlineColor = skinColor(CDK.hintOutline ?? "#05070c", 1);
    hb.outlineWidth = CDK.hintOutlineW ?? 2;
    hb.color = skinColor(CDK.hintColor ?? "#f8fafc", CDK.hintA ?? 0.98);
    applyFont(hb, true);
    hn.setPosition(0, r * (CDK.hintY ?? 0.08));
    hintOp = hn.addComponent(UIOpacity);
    hintOp.opacity = 0;
    hn.setParent(node);
    hintComp = hb;
  }

  const rec: BtnRec = {
    action, node, ut, g, cluster, r, pressed: false, selected: false, glow: 0,
    flash, flashG, flashOp, swipeDir: 0, swipeDirY: 0, lockDirX: 0, lockDirY: 0, lockArmT: 0, aimEcho: 0, aimEchoY: 0, autoMark: false,
    labelOp, labelComp, cdOp, cdComp,
    badgeComp, badgeOp, hintComp, hintOp,
    cdRatio: 0, cdGate: makeCdGate(), cdSec: 0, skillReady: true, skillId: "lunge", skillBlock: null, readyPulsing: false,
    // 充能层自带一个 gate:与 cdGate 各记各的基准,两层互不顶掉(见 BtnRec.chargeGate 注)
    chargeRatio: 0, chargePipes: 0, chargeGate: makeCdGate(),
  };
  paint(rec, !!opts.edit);

  if (opts.edit) {
    // 拖动:谁先接到 TOUCH_START 谁就 claim 住这个 touch id,MOVE/END 只发给它,
    // 所以第二根手指来抢同一个键会被 dragId 挡住。
    let dragId: number | null = null;
    let grab = { x: 0, y: 0, dx: 0, dy: 0 };
    node.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
      if (dragId !== null) return;
      dragId = e.getID();
      const l = toClusterLocal(cluster, e);
      const cur = Settings.padOf(action);
      grab = { x: l.x / scale, y: l.y / scale, dx: cur.dx, dy: cur.dy };
      opts.onPick?.(action);
    });
    node.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
      if (e.getID() !== dragId) return;
      const l = toClusterLocal(cluster, e);
      opts.onDrag?.(action, grab.dx + (l.x / scale - grab.x), grab.dy + (l.y / scale - grab.y));
    });
    // 拖出按钮范围后松手走的是 TOUCH_CANCEL 而不是 TOUCH_END,两个都得收尾
    const fin = (e: EventTouch) => {
      if (e.getID() !== dragId) return;
      dragId = null;
      opts.onDragEnd?.(action);
    };
    node.on(Node.EventType.TOUCH_END, fin);
    node.on(Node.EventType.TOUCH_CANCEL, fin);
  }
  // 非编辑态不在这里挂事件:对局态的按下/滑动/换向由层节点统一裁决(见 bindPlayLayer),
  // 节点级分发做不到「手指按住左键滑到右键不抬手换向」。

  recs.push(rec);
  return rec;
}

/** 摇杆 knob 相对 baseR 的比例:手感里"手指刚好盖住小球、又能露出底圈刻度" */
const KNOB_RATIO = 0.42;

function makeJoystick(cluster: Node, opts: TouchPadOpts, scale: number): StickRec {
  const j = Settings.joystick;
  const baseR = j.r * scale;
  const knobR = baseR * KNOB_RATIO;

  const root = new Node("joystick");
  root.layer = Layers.Enum.UI_2D;
  const baseUt = root.addComponent(UITransform);
  baseUt.setContentSize(baseR * 2.6, baseR * 2.6);
  root.setPosition((JOYSTICK_BASE.x + j.dx) * scale, (JOYSTICK_BASE.y + j.dy) * scale);
  root.setParent(cluster);
  const baseG = root.addComponent(Graphics);

  const knob = new Node("knob");
  knob.layer = Layers.Enum.UI_2D;
  const knobUt = knob.addComponent(UITransform);
  knobUt.setContentSize(knobR * 2, knobR * 2);
  knob.setPosition(0, 0);
  const knobG = knob.addComponent(Graphics);
  knob.setParent(root);

  const st: StickRec = {
    cluster, root, baseUt, baseG, knob, knobG, baseR, knobR,
    selected: false, activeTouch: null, jumpOn: false, paintedFull: false, paintedJump: false,
  };
  paintStick(st, false, false, !!opts.edit);
  paintKnob(st, false);

  if (opts.edit) {
    // 编辑态:拖 root = 改 Settings.joystick.dx/dy。knob 事件让 root 收。
    let dragId: number | null = null;
    let grab = { x: 0, y: 0, dx: 0, dy: 0 };
    root.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
      if (dragId !== null) return;
      dragId = e.getID();
      const l = toClusterLocal(cluster, e);
      const cur = Settings.joystick;
      grab = { x: l.x / scale, y: l.y / scale, dx: cur.dx, dy: cur.dy };
      opts.onPick?.("joystick");
    });
    root.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
      if (e.getID() !== dragId) return;
      const l = toClusterLocal(cluster, e);
      opts.onDrag?.("joystick", grab.dx + (l.x / scale - grab.x), grab.dy + (l.y / scale - grab.y));
    });
    const fin = (e: EventTouch) => {
      if (e.getID() !== dragId) return;
      dragId = null;
      opts.onDragEnd?.("joystick");
    };
    root.on(Node.EventType.TOUCH_END, fin);
    root.on(Node.EventType.TOUCH_CANCEL, fin);
  }

  return st;
}

/**
 * 建滑轨。参考系是 cluster-rail 的原点 = **屏幕底边中点**(不是左下簇,原因见文件头),
 * 局部单位就是设计像素:轨的 x/长度一律不乘 scale,只有粗细 r 与触摸目标乘。
 */
function makeSlider(cluster: Node, opts: TouchPadOpts, scale: number): SliderRec {
  const s = Settings.slider;
  const G = railGeo();
  const r = s.r * scale;
  const h = r * 2;
  const w = G.span + r * 2;

  const root = new Node("slider-ctrl");
  root.layer = Layers.Enum.UI_2D;
  const baseUt = root.addComponent(UITransform);
  baseUt.setContentSize(w + 32, h + 32);
  root.setPosition(G.centerUiX, SLIDER_BASE.y + s.dy);
  root.setParent(cluster);
  const baseG = root.addComponent(Graphics);

  const thumb = new Node("thumb");
  thumb.layer = Layers.Enum.UI_2D;
  const thumbUt = thumb.addComponent(UITransform);
  thumbUt.setContentSize(r * 2.2, r * 2.2);
  thumb.setPosition(0, 0);
  const thumbG = thumb.addComponent(Graphics);
  thumb.setParent(root);

  const st: SliderRec = {
    cluster, root, baseUt, baseG, thumb, thumbG,
    span: G.span, minX: G.minX, maxX: G.maxX, w, h, r,
    selected: false, activeTouch: null, jumpOn: false, paintedJump: false,
    lastTouchTime: 0, lastTouchX: 0, lastTouchY: 0, lastThumbX: 0,
  };
  paintSliderTrack(st, false, !!opts.edit);
  paintSliderThumb(st, false);

  if (opts.edit) {
    // 编辑态拖动:簇局部单位 == 设计像素,所以这里**不除 scale**(按钮那套要除,
    // 因为它们的存档是「基准倍」下的数字;轨的 y 本来就是屏幕像素)。
    // 横向被 clampDelta 夹回 0,拖不动是设计而不是 bug。
    let dragId: number | null = null;
    let grab = { x: 0, y: 0, dy: 0 };
    root.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
      if (dragId !== null) return;
      dragId = e.getID();
      const l = toClusterLocal(cluster, e);
      grab = { x: l.x, y: l.y, dy: Settings.slider.dy };
      opts.onPick?.("slider");
    });
    root.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
      if (e.getID() !== dragId) return;
      const l = toClusterLocal(cluster, e);
      opts.onDrag?.("slider", 0, grab.dy + (l.y - grab.y));
    });
    const fin = (e: EventTouch) => {
      if (e.getID() !== dragId) return;
      dragId = null;
      opts.onDragEnd?.("slider");
    };
    root.on(Node.EventType.TOUCH_END, fin);
    root.on(Node.EventType.TOUCH_CANCEL, fin);
  }

  return st;
}

/**
 * 建一层虚拟按键。
 * @param root 父节点(通常是 Canvas);返回句柄,调用方**必须存住** —— 丢掉节点
 *             就没法隐藏,菜单半透明暗底下会露出按键(本次修掉的 bug 之一)。
 */
export function buildTouchPad(root: Node, pad: Pad, opts: TouchPadOpts = {}): TouchPadHandle {
  const layer = new Node(opts.edit ? "touchpad-edit" : "touchpad");
  layer.layer = Layers.Enum.UI_2D;
  const layerUt = layer.addComponent(UITransform);

  // 全屏自适应容器
  const layerWidget = layer.addComponent(Widget);
  layerWidget.isAlignTop = true; layerWidget.top = 0;
  layerWidget.isAlignBottom = true; layerWidget.bottom = 0;
  layerWidget.isAlignLeft = true; layerWidget.left = 0;
  layerWidget.isAlignRight = true; layerWidget.right = 0;
  layer.setParent(root);

  const safe = safeMargins();
  const recs: BtnRec[] = [];
  let stick: StickRec | null = null;
  let slider: SliderRec | null = null;
  let currentMode: MoveMode = Settings.moveMode;
  let currentScale = padScale();

  // 1. 左侧移动簇:按当前 moveMode 决定建摇杆,还是建 left/right/jump 三键。
  //    摇杆模式下不建跳跃键 —— 往上推摇杆就是跳(见 CFG.stickJump),没有实体键可摆。
  //    slider 模式这一簇是空的,轨住在下面的 cluster-rail 里(见 1b)。
  const leftCluster = new Node("cluster-left");
  leftCluster.layer = Layers.Enum.UI_2D;
  const leftTrans = leftCluster.addComponent(UITransform);
  leftTrans.setAnchorPoint(0, 0); // 以左下角为锚点
  // 尺寸按 buttons 模式三键的默认包围盒取整:右键 (162,50)+r48 伸到 x=210,
  // 跳键 (106,150)+r48 伸到 y=198,取 220×210。注意这只影响节点包围盒 ——
  // 拖动夹取走的是全屏世界坐标(slotCorner 用 -hw+safe.l),不依赖这个尺寸。
  leftTrans.setContentSize(220, 210);
  leftCluster.setParent(layer);

  const leftWidget = leftCluster.addComponent(Widget);
  leftWidget.isAlignLeft = true;
  leftWidget.left = safe.l;
  leftWidget.isAlignBottom = true;
  leftWidget.bottom = safe.b;
  leftWidget.updateAlignment();

  // 1b. 滑轨专用参考系:原点落在**屏幕底边中点**。
  //     滑轨是左半场在地面上的投影,而球场永远以屏幕中线为对称轴、且不随 padScale
  //     横向拉伸 —— 所以它不能住在会随刘海内缩的左下簇里(一内缩整条轨就平移,
  //     对不上脚下的场地线)。水平居中 + 吸底,轨心 x 才能直接等于 railGeo().centerUiX。
  const railCluster = new Node("cluster-rail");
  railCluster.layer = Layers.Enum.UI_2D;
  const railTrans = railCluster.addComponent(UITransform);
  railTrans.setAnchorPoint(0.5, 0);   // 原点 = 屏幕底边中点(尺寸只够 Widget 定位用)
  railTrans.setContentSize(2, 2);
  railCluster.setParent(layer);

  const railWidget = railCluster.addComponent(Widget);
  railWidget.isAlignHorizontalCenter = true;
  railWidget.horizontalCenter = 0;
  railWidget.isAlignBottom = true;
  railWidget.bottom = safe.b;
  railWidget.updateAlignment();

  const buildLeftSide = (): void => {
    // 拆掉上一份左簇子节点(mode 切换、scale 变化都会走这里)
    for (const rec of recs) if (PAD_BASE[rec.action].cluster === "left") rec.node.destroy();
    // filter 后保留 right 簇的 recs 原序
    for (let i = recs.length - 1; i >= 0; i--) if (PAD_BASE[recs[i].action].cluster === "left") recs.splice(i, 1);
    if (stick) { stick.root.destroy(); stick = null; }
    if (slider) { slider.root.destroy(); slider = null; }   // 轨本体拆,cluster-rail 这个参考系留着

    if (currentMode === "joystick") {
      stick = makeJoystick(leftCluster, opts, currentScale);
    } else if (currentMode === "slider") {
      slider = makeSlider(railCluster, opts, currentScale);
    } else {
      for (const a of CLUSTER_ORDER.left) makeButton(a, leftCluster, opts, recs, currentScale);
    }
  };
  buildLeftSide();

  // 2. 右侧操作簇(「击球」「跨步」)—— 两键(原深球+短球已合并为单击球键)。
  //    跳跃原来也在这里,和击球键挤同一只拇指,跳杀按不出来;现在归左手了。
  const rightCluster = new Node("cluster-right");
  rightCluster.layer = Layers.Enum.UI_2D;
  const rightTrans = rightCluster.addComponent(UITransform);
  rightTrans.setAnchorPoint(1, 0); // 以右下角为锚点
  // 跨步 (-235,50)+r40 伸到 x=-275、击球 (-135,140)+r46 伸到 y=186,取 280×200(同上,只算包围盒)
  rightTrans.setContentSize(280, 200);
  rightCluster.setParent(layer);

  const rightWidget = rightCluster.addComponent(Widget);
  rightWidget.isAlignRight = true;
  rightWidget.right = safe.r;
  rightWidget.isAlignBottom = true;
  rightWidget.bottom = safe.b;
  rightWidget.updateAlignment();

  for (const a of CLUSTER_ORDER.right) makeButton(a, rightCluster, opts, recs, currentScale);

  // ---------- 对局态触摸:层节点统一命中 + 滑动换向(编辑模式不挂,键只是摆给你拖) ----------
  //
  // 每根手指 claim 一个 touch id;按住中滑动会重新命中:
  //   「左」滑到「右」= 不抬手直接换向(对拉快攻省一次抬手);
  //   滑出所有键 = 松键(与旧的 TOUCH_CANCEL 自愈同语义);
  //   划过跨步/击球键不触发 —— 换向只认「按住类」动作(left/right/jump),
  //   防止手指路过右手键区凭空打出一拍、或凭空摔一次跨步。
  // 摇杆 claim 单独一等公民:一根手指一旦落到摇杆命中区,整段按住期间都归摇杆,
  // 不做按键间断续切换 —— 玩家拇指推在摇杆上时不该被"擦过边缘"打断了走位。
  // 摇杆模式下左簇没有实体键(跳跃改由上推代跳),所以这里不存在"键压在摇杆 1.5R
  // 捕获盘上谁优先"的问题;buttons 模式则根本没有摇杆,stick === null。
  // 击球键(swing)是 sticky claim:一旦按下,手指横滑离开按钮中心也不换键,
  // 直到 TOUCH_END 才释放 —— 给滑动手势留出完整的操作空间。
  // startX/Y 记录按下位置,用于计算滑动 delta 提交方向。
  type Claim = { kind: "rec"; rec: BtnRec; startX: number; startY: number } | { kind: "stick" } | { kind: "slider" };
  const claims = new Map<number, Claim>();

  const bindPlayLayer = (): void => {
    const layerTrans = layerUt;

    /** 触点 → 命中的键:兄弟序即层级,从最上层(数组尾部)往回找 */
    const hitAny = (e: EventTouch): BtnRec | null => {
      const u = e.getUILocation();
      const p = layerTrans.convertToNodeSpaceAR(v3(u.x, u.y, 0), tmpVec);
      for (let i = recs.length - 1; i >= 0; i--) {
        const rec = recs[i];
        const c = layerTrans.convertToNodeSpaceAR(rec.node.worldPosition, tmpVecB);
        const dx = p.x - c.x, dy = p.y - c.y;
        if (dx * dx + dy * dy <= rec.r * rec.r) return rec;
      }
      return null;
    };

    /** 触点 → 是否在摇杆激活区(半径 baseR × 1.5 内即算,手指不必精准命中底圈) */
    const hitStick = (e: EventTouch): boolean => {
      if (!stick) return false;
      const u = e.getUILocation();
      const p = layerTrans.convertToNodeSpaceAR(v3(u.x, u.y, 0), tmpVec);
      const c = layerTrans.convertToNodeSpaceAR(stick.root.worldPosition, new Vec3());
      const dx = p.x - c.x, dy = p.y - c.y;
      const rr = stick.baseR * 1.5;
      return dx * dx + dy * dy <= rr * rr;
    };

    /**
     * 触点 → 是否在滑轨激活区。
     * 轨现在是「你这一半场底部的一条投影带」,横向整条都收手指 —— 不必先瞄准胶囊
     * 才能站位,落点由 readSlider 夹进可达区间,所以过网那一点点也不会跑出界。
     * 上方多留一截是给「上滑起跳」留的余量。
     */
    const hitSlider = (e: EventTouch): boolean => {
      if (!slider) return false;
      const u = e.getUILocation();
      const p = layerTrans.convertToNodeSpaceAR(v3(u.x, u.y, 0), tmpVec);
      const c = layerTrans.convertToNodeSpaceAR(slider.root.worldPosition, new Vec3());
      const dx = p.x - c.x, dy = p.y - c.y;
      const hw = slider.w / 2 + 16, hh = slider.h / 2 + 36;
      return Math.abs(dx) <= hw && Math.abs(dy) <= hh;
    };

    /**
     * 触点 → 摇杆局部量。
     * axis = 归一化水平轴(交给 moveAxis);up = 归一化**上推量**(0..1,交给代跳判据);
     * kx/ky = 夹在底圈内的 knob 视觉位置。
     * UI 节点空间 y 向上,所以拇指往上推时 dy>0 —— up 取正半轴,下拉恒为 0。
     */
    const readStick = (e: EventTouch): { axis: number; up: number; kx: number; ky: number } => {
      const st = stick!;
      const u = e.getUILocation();
      const p = layerTrans.convertToNodeSpaceAR(v3(u.x, u.y, 0), tmpVec);
      const c = layerTrans.convertToNodeSpaceAR(st.root.worldPosition, new Vec3());
      let dx = p.x - c.x, dy = p.y - c.y;
      const len = Math.hypot(dx, dy);
      if (len > st.baseR && len > 0) { dx = dx * (st.baseR / len); dy = dy * (st.baseR / len); }
      return { axis: clamp(dx / st.baseR, -1, 1), up: clamp(dy / st.baseR, 0, 1), kx: dx, ky: dy };
    };

    /**
     * 触点 → 滑轨局部量 + 目标世界 x。
     *
     * 这里**故意没有归一化那一步**:轨心就钉在可达区间中点的正下方,而 FIXED_HEIGHT
     * 下 1 UI 像素 == 1 世界像素(世界层挂屏幕中心、不横向拉伸;击球瞬间的镜头 punch
     * 只是临时放大画面,不改逻辑坐标),所以「手指的屏幕 x + world.w/2」直接就是
     * 「脚下该站的世界 x」。手指挪 1px = 人挪 1px,人永远停在手指正上方那条竖线上。
     * 老写法把轨宽归一化成 0..1 再铺满可达区间:220px 的轨摊 426px 的地面 ≈ 1.94 倍
     * 放大,想微调 20px 站位得先心算手指该挪 10px —— 挂着"精准"名号的模式反而最不准。
     */
    const readSlider = (e: EventTouch): { targetX: number; thumbX: number; dy: number } => {
      const st = slider!;
      const u = e.getUILocation();
      const p = layerTrans.convertToNodeSpaceAR(v3(u.x, u.y, 0), tmpVec);
      const c = layerTrans.convertToNodeSpaceAR(st.root.worldPosition, new Vec3());
      const dx = p.x - c.x, dy = p.y - c.y;
      const thumbX = clamp(dx, -st.span / 2, st.span / 2);
      const targetX = clamp(c.x + thumbX + CFG.world.w / 2, st.minX, st.maxX);
      return { targetX, thumbX, dy };
    };

    const down = (rec: BtnRec): void => {
      // 技能按钮处于 CD 中或不满足释放门槛时拒绝触发:
      // 静默轻震曾是老写法 —— 玩家只觉得「按了没反应」。现在抖动 + 红环 + 键内封条微弹,
      // 按错时因果清晰、反馈强烈。
      if (rec.action === "lunge") {
        if ((rec.cdRatio ?? 0) > 0 || rec.skillReady === false) {
          Tween.stopAllByTarget(rec.node);
          tween(rec.node)
            .to(0.05, { position: v3(rec.node.position.x + 4, rec.node.position.y, 0) })
            .to(0.05, { position: v3(rec.node.position.x - 4, rec.node.position.y, 0) })
            .to(0.06, { position: v3(rec.node.position.x, rec.node.position.y, 0) })
            .start();
          if (rec.hintComp?.node && rec.skillBlock) {
            Tween.stopAllByTarget(rec.hintComp.node);
            tween(rec.hintComp.node)
              .to(0.06, { scale: v3(1.18, 1.18, 1) })
              .to(0.12, { scale: v3(1, 1, 1) })
              .start();
          }
          triggerFlash(rec, CFG.padSkin.cd.rejectFlash);
          return;
        }
      }
      rec.pressed = true;
      if (rec.action === "swing") {
        // 新手势开始:视觉初始化为**锁定值**(有锁时键缘弧当场亮起 = 「这一拍会往这个方向打」,
        // 与 pad 侧 press 恢复锁值同一帧语义),同时清长滑去重门 —— 去重按手势计。
        rec.swipeDir = pad.swingLockX; rec.swipeDirY = pad.swingLockY;
        rec.lockDirX = 0; rec.lockDirY = 0; rec.lockArmT = 0;
      }
      paint(rec, false);
      Tween.stopAllByTarget(rec.node);
      rec.node.setScale(CFG.padSkin.pressScale, CFG.padSkin.pressScale, 1);
      triggerFlash(rec);
      press(pad, rec.action);
    };
    const upOf = (rec: BtnRec): void => {
      rec.pressed = false;
      if (rec.action === "swing") { rec.swipeDir = 0; rec.swipeDirY = 0; }  // 松手清视觉反馈(pad 上的提交值保留给命中消费)
      paint(rec, false);
      Tween.stopAllByTarget(rec.node);
      // 两段:先 0.9 → 1.06 再回到 1.0,过冲幅度可控、比单调 backOut 更"实"
      tween(rec.node)
        .to(0.07, { scale: new Vec3(1.06, 1.06, 1) }, { easing: "sineOut" })
        .to(0.08, { scale: new Vec3(1, 1, 1) }, { easing: "sineIn" })
        .start();
      if (RELEASE_ACTIONS.includes(rec.action)) release(pad, rec.action as "left");
    };

    /**
     * 击球键滑动手势跟踪:手指从按下点位移超过阈值即提交方向,横纵两轴独立判定、可组合。
     * 横轴:总位移 hypot(dx,dy) ≥ commitPx(斜滑也算),横向分量需 ≥ 阈值一半(防纯纵向
     * 晃动误触),方向由 X 符号决定,右滑 → deep(1),左滑 → near(-1)。
     * 纵轴:纵向分量 ≥ commitPxY(比横轴紧一档,纵向曾是有意无语义区),上滑 → 挑高(1),
     * 下滑 → 平抽(-1)。两轴分别写入 pad.swingSwipe / pad.swingSwipeY,player.ts 在命中前
     * 读取;同一轴反向滑过阈值即改写(与横滑的「中途反悔」同构),斜上右滑一个动作即可
     * 组合出「挑高到后场」。同时更新 rec.swipeDir / rec.swipeDirY 触发方向色弧视觉反馈。
     *
     * 长滑锁定(参考和平精英长滑锁定端口,语义按用户 2026-10-05 口径):
     *  · **锁着时任何一次短滑 = 解除**(clearSwingLocks,白环)—— 那一拍按短滑方向打,
     *    没滑到的轴回 mid。放在轴提交之前:清完后下面的提交照常写新方向。
     *  · 锁入有两条路,都要求「刻意表态」:① 快拉,滑动距离越过按键半径 × lockRadiusK
     *    当帧即锁;② 拉住,滑出按键(lockNearK × 半径)后**在阈值外停够 lockDwellMs**。
     *    快甩哪怕甩得很远,越过即松、在阈值外不停留,绝不锁 —— 短滑/长滑按快慢区分,
     *    绝不锁 —— 短滑/长滑按快慢区分,
     *    不赌距离(距离阈值两版都被真机滑动击穿过:34 < 按键半径,138 < 正常短滑)。
     *    同向长滑 = 维持,反向长滑 = 换向,**没有 toggle**;哪些轴锁上按 ±30° 锥角判
     *    (见 SWIPE_LOCK_CONE):斜 45° 两轴都锁,单轴长滑只锁那一轴。
     *  · 同方向在同一手势内只触发一次(lockDirX/Y 门)—— 手指在阈值外绕圈的事件流
     *    不许把同一个方向连写多遍。
     */
    const trackSwingSwipe = (rec: BtnRec, sx: number, sy: number, e: EventTouch): void => {
      const u = e.getUILocation();
      const dx = u.x - sx;
      const dy = u.y - sy;
      if (Math.hypot(dx, dy) < SWIPE_THRESHOLD) return;       // 位移不足:仍是 mid
      // 解除锁定:锁着时的一次真实滑动 = 「我不锁了」。键值一起清(press 起手时把锁值
      // 恢复进了键值,只清锁不清键,恢复值会冒充这一拍的意图),rec 两轴归零让下面的
      // 提交去重自然放行 —— 这一拍只听新滑动,没滑到的轴回 mid。白环 = 解锁的中性色。
      if ((pad.swingLockX !== 0 || pad.swingLockY !== 0)
        && (Math.abs(dx) >= SWIPE_THRESHOLD * 0.5 || Math.abs(dy) >= SWIPE_THRESHOLD_Y)) {
        clearSwingLocks(pad);
        rec.swipeDir = 0;
        rec.swipeDirY = 0;
        triggerFlash(rec, "#ffffff");
        paint(rec, false);
      }
      if (Math.abs(dx) >= SWIPE_THRESHOLD * 0.5) {
        const dir = dx > 0 ? 1 : -1;
        if (rec.swipeDir !== dir) {                            // 已提交同方向,不重复刷
          rec.swipeDir = dir;
          pad.swingSwipe = dir;
          paint(rec, false);
          // 方向色冲击环:提交哪档就用哪档的颜色闪一圈 —— 配合图标切换,把「这一拍是重是轻」
          // 在拇指底下说清楚,不等命中才知道。色值与中性图标的滑动箭头同源。
          triggerFlash(rec, dir > 0 ? CFG.colors.sweet.gold : CFG.colors.sweet.neonCyan);
        }
      }
      if (Math.abs(dy) >= SWIPE_THRESHOLD_Y) {
        const dir = dy > 0 ? 1 : -1;
        if (rec.swipeDirY !== dir) {
          rec.swipeDirY = dir;
          pad.swingSwipeY = dir;
          paint(rec, false);
          // 纵轴方向色:挑高绿/平抽蓝(与 shotBadge 徽标同源,徽标会同步预告真实球种)
          triggerFlash(rec, dir > 0 ? CFG.colors.sweet.lob : CFG.colors.sweet.drive);
        }
      }
      // 长滑锁定,两条锁入路径(见函数头注):快拉过远阈值当帧锁;拉出按键外停够
      // lockDwellMs 才锁(快甩在阈值外不停留,永不触发)。荧光黄 = 锁上的确认色。
      const dist = Math.hypot(dx, dy);
      const now = Date.now();
      if (rec.lockArmT === 0 && dist >= rec.r * SWIPE_LOCK_NEAR_K) rec.lockArmT = now;
      const dwellLong = rec.lockArmT > 0 && dist >= rec.r * SWIPE_LOCK_NEAR_K
        && now - rec.lockArmT >= SWIPE_LOCK_DWELL_MS;
      if (dist >= rec.r * SWIPE_LOCK_K || dwellLong) {
        if (Math.abs(dx) >= dist * SWIPE_LOCK_CONE && rec.lockDirX !== (dx > 0 ? 1 : -1)) {
          const dir = dx > 0 ? 1 : -1;
          rec.lockDirX = dir;
          lockSwingAxis(pad, "x", dir);
          triggerFlash(rec, CFG.padSkin.downEdge);
          paint(rec, false);
        }
        if (Math.abs(dy) >= dist * SWIPE_LOCK_CONE && rec.lockDirY !== (dy > 0 ? 1 : -1)) {
          const dir = dy > 0 ? 1 : -1;
          rec.lockDirY = dir;
          lockSwingAxis(pad, "y", dir);
          triggerFlash(rec, CFG.padSkin.downEdge);
          paint(rec, false);
        }
      }
    };

    /**
     * 上推代跳的两档迟滞判据(阈值见 CFG.stickJump)。
     * 只在真的越过档位边缘时才动 pad —— 停在 upLo..upHi 的迟滞带里既不 press 也不
     * release;否则一次抖动就是一对 press/release,而每一次 release 都带着 jumpCut,
     * 跳会既起不来又升不高。
     * 快甩(flick)不需要单独的角速度判定:它的输入时长天然就短,release 时由
     * pad.ts 的 tapCommitFrames 补一段 held 撑到顶点成为一个真跳。
     */
    const evalStickJump = (st: StickRec, up: number): void => {
      const J = CFG.stickJump;
      if (!st.jumpOn && up >= J.upHi) {
        st.jumpOn = true;
        press(pad, "jump");
      } else if (st.jumpOn && up <= J.upLo) {
        st.jumpOn = false;
        release(pad, "jump");
      }
    };

    const evalSliderJump = (st: SliderRec, dy: number): void => {
      const SC = CFG.sliderControl;
      if (!st.jumpOn && dy >= SC.jumpSwipeUpY) {
        st.jumpOn = true;
        press(pad, "jump");
      } else if (st.jumpOn && dy <= SC.jumpSwipeUpLoY) {
        st.jumpOn = false;
        release(pad, "jump");
      }
    };

    const stickDown = (e: EventTouch): void => {
      const st = stick!;
      st.activeTouch = e.getID();
      // 抓取瞬间先掐掉上一段的回中弹簧,否则它会在按住期间把 knob 拽回圆心
      Tween.stopAllByTarget(st.knob);
      const { axis, up, kx, ky } = readStick(e);
      st.knob.setPosition(kx, ky);
      const full = Math.abs(axis) >= FULL_DEFLECT;
      evalStickJump(st, up);          // 先判跳跃再画:底圈那条分界线要跟着一起亮
      st.paintedFull = full; st.paintedJump = st.jumpOn;
      paintStick(st, true, full, false);
      paintKnob(st, true);
      setMoveAxis(pad, axis);
    };
    const stickMove = (e: EventTouch): void => {
      const st = stick!;
      const { axis, up, kx, ky } = readStick(e);
      // knob 是独立节点,挪位置不重画;回中弹簧只在 down 抓取时掐一次
      // (旧版每个 TOUCH_MOVE 都 stop + 全量重铺底圈,推一圈 = 上百次 Graphics 重建)
      st.knob.setPosition(kx, ky);
      const full = Math.abs(axis) >= FULL_DEFLECT;
      evalStickJump(st, up);
      // 底圈外观只依赖 (按下, 满舵, 起跳分界) 三个离散状态 → 只在状态沿变化时重画
      if (st.paintedFull !== full || st.paintedJump !== st.jumpOn) {
        st.paintedFull = full; st.paintedJump = st.jumpOn;
        paintStick(st, true, full, false);
      }
      setMoveAxis(pad, axis);
    };
    const stickUp = (): void => {
      const st = stick!;
      st.activeTouch = null;
      // 抬手 = 松跳跃键。短按会被 pad.ts 补成完整一跳,推够久再松的仍然收得住高度。
      if (st.jumpOn) { st.jumpOn = false; release(pad, "jump"); }
      setMoveAxis(pad, 0);
      st.paintedFull = false; st.paintedJump = st.jumpOn;
      paintStick(st, false, false, false);
      paintKnob(st, false);
      // knob spring 回中:elasticOut 让"手指抬起、小球自己弹回"这件事看得见
      Tween.stopAllByTarget(st.knob);
      tween(st.knob).to(0.24, { position: new Vec3(0, 0, 0) }, { easing: "elasticOut" }).start();
    };

    const sliderDown = (e: EventTouch): void => {
      const st = slider!;
      st.activeTouch = e.getID();
      const u = e.getUILocation();
      const now = Date.now();
      const SC = CFG.sliderControl;

      // 双击跳跃判定
      const dt = now - st.lastTouchTime;
      const dist = Math.hypot(u.x - st.lastTouchX, u.y - st.lastTouchY);
      if (dt > 40 && dt <= SC.doubleTapWindowMs && dist <= SC.doubleTapMaxDist) {
        st.jumpOn = true;
        press(pad, "jump");
        st.lastTouchTime = 0; // 消费本次双击
      } else {
        st.lastTouchTime = now;
        st.lastTouchX = u.x;
        st.lastTouchY = u.y;
      }

      const { targetX, thumbX, dy } = readSlider(e);
      // 抓取瞬间掐掉 thumb 上可能残留的 tween(旧版在 move 里每个采样停一次)
      Tween.stopAllByTarget(st.thumb);
      const dThumb = thumbX - st.lastThumbX;
      const slideDir = Math.abs(dThumb) > 1 ? (dThumb > 0 ? 1 : -1) : undefined;
      st.thumb.setPosition(thumbX, 0);
      st.lastThumbX = thumbX;
      evalSliderJump(st, dy);
      st.paintedJump = st.jumpOn;
      paintSliderTrack(st, true, false);
      paintSliderThumb(st, true);
      setTargetX(pad, targetX, slideDir);
    };

    const sliderMove = (e: EventTouch): void => {
      const st = slider!;
      const { targetX, thumbX, dy } = readSlider(e);
      const dThumb = thumbX - st.lastThumbX;
      const slideDir = Math.abs(dThumb) > 1 ? (dThumb > 0 ? 1 : -1) : undefined;
      // thumb 是独立节点,挪位置不重画;底座只在起跳分界状态沿变化时重画
      st.thumb.setPosition(thumbX, 0);
      st.lastThumbX = thumbX;

      evalSliderJump(st, dy);
      if (st.paintedJump !== st.jumpOn) {
        st.paintedJump = st.jumpOn;
        paintSliderTrack(st, true, false);
      }
      setTargetX(pad, targetX, slideDir);
    };

    const sliderUp = (): void => {
      const st = slider!;
      st.activeTouch = null;
      if (st.jumpOn) {
        st.jumpOn = false;
        release(pad, "jump");
      }
      st.paintedJump = st.jumpOn;
      paintSliderTrack(st, false, false);
      paintSliderThumb(st, false);
    };

    layer.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
      const id = e.getID();
      if (id == null || claims.has(id)) return;
      if (hitStick(e)) {
        claims.set(id, { kind: "stick" });
        stickDown(e);
        return;
      }
      if (hitSlider(e)) {
        claims.set(id, { kind: "slider" });
        sliderDown(e);
        return;
      }
      const rec = hitAny(e);
      if (!rec) return;
      const u = e.getUILocation();
      claims.set(id, { kind: "rec", rec, startX: u.x, startY: u.y });
      down(rec);
    });
    layer.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
      const id = e.getID();
      if (id == null) return;
      const c = claims.get(id);
      if (!c) return;
      if (c.kind === "stick") { stickMove(e); return; }
      if (c.kind === "slider") { sliderMove(e); return; }
      // 击球键 sticky:按下后手指横滑不换键,只跟踪手势方向
      if (c.rec && c.rec.action === "swing") {
        trackSwingSwipe(c.rec, c.startX, c.startY, e);
        return;
      }
      const rec = hitAny(e);
      if (rec === c.rec) return;
      if (c.rec) upOf(c.rec);
      if (rec && RELEASE_ACTIONS.includes(rec.action)) {
        c.rec = rec;
        down(rec);
      } else {
        c.rec = null as unknown as BtnRec;    // 滑出所有键:松开但不换向
        claims.set(id, { kind: "rec", rec: c.rec, startX: 0, startY: 0 });
      }
    });
    const fin = (e: EventTouch): void => {
      const id = e.getID();
      if (id == null) return;
      const c = claims.get(id);
      if (!c) return;
      claims.delete(id);
      if (c.kind === "stick") stickUp();
      else if (c.kind === "slider") sliderUp();
      else if (c.rec) upOf(c.rec);
    };
    layer.on(Node.EventType.TOUCH_END, fin);
    layer.on(Node.EventType.TOUCH_CANCEL, fin);
  };

  if (!opts.edit) bindPlayLayer();

  /** 视口半宽高:实时读层尺寸,不许写死 960×540(Widget 还没跑时用默认兜底) */
  const viewportHalf = (): { hw: number; hh: number } => {
    const w = layerUt.width, h = layerUt.height;
    return { hw: w > 0 ? w / 2 : 480, hh: h > 0 ? h / 2 : 270 };
  };

  /** 某个槽位的簇原点(左下/右下角点)在层坐标系里的位置(世界单位,已含 scale)。
   *  slider 不走这里 —— 它的参考系是屏幕底边中点,见 clampRailDelta。 */
  const slotCorner = (slot: PadSlot, hw: number, hh: number): { x: number; y: number } => {
    const left = slot === "joystick" ? true : PAD_BASE[slot as PadAction].cluster === "left";
    return { x: left ? -hw + safe.l : hw - safe.r, y: -hh + safe.b };
  };

  /** 槽位的默认布局基准点(世界单位,未含 scale);slider 同上,不走这里 */
  const slotBaseXY = (slot: PadSlot): { x: number; y: number } => {
    if (slot === "joystick") return { x: JOYSTICK_BASE.x, y: JOYSTICK_BASE.y };
    return { x: PAD_BASE[slot as PadAction].x, y: PAD_BASE[slot as PadAction].y };
  };

  /**
   * 滑轨的位移夹取:只有「上下」这一维。
   * 参考系 = 屏幕底边中点,单位 = 设计像素(不乘 scale —— 和球场同一把尺)。
   * dx 一律回 0:轨与球场 1:1 对位之后,横向一动就对不上脚下的场地线,
   * 「手指在哪人就在哪」这个承诺当场作废,所以这一维不是留给用户调的。
   * 纵向唯一约束 = 整条轨留在可视区内(上下都留 edgePad),不再预留顶部记分牌带。
   */
  const clampRailDelta = (dy: number): { dx: number; dy: number } => {
    const { hh } = viewportHalf();
    const r = Settings.slider.r * currentScale;
    const edge = CFG.padSkin.edgePad;
    const lo = r + edge, hi = Math.max(lo, 2 * hh - r - edge);
    const yBottom = clamp(safe.b + SLIDER_BASE.y + dy, lo, hi);
    return {
      dx: 0,
      dy: yBottom - safe.b - SLIDER_BASE.y,
    };
  };

  /**
   * 槽位可放区域的唯一约束:整块控件留在可视区内(四周各留 edgePad)。
   * 以前还额外预留过一条「顶部记分牌带」(按键中心不许进 y>120 那一带),
   * 用户要的是「能放到任意位置」,所以那道保留带已经去掉 —— 挡住 HUD 是玩家自己的选择,
   * 而「拖出屏外就再也点不回来」不是,那一类才是必须夹住的。
   * (位移数值本身仍由 Settings 的 PLACE_GUARD 兜住坏档,这里不重复夹。)
   */
  const clampDelta = (slot: PadSlot, dx: number, dy: number): { dx: number; dy: number } => {
    if (slot === "slider") return clampRailDelta(dy);
    const base = slotBaseXY(slot);
    const { hw, hh } = viewportHalf();
    const corner = slotCorner(slot, hw, hh);
    const isJoy = slot === "joystick";
    const r = (isJoy ? Settings.joystick.r : Settings.padOf(slot as PadAction).r) * currentScale;
    const edge = CFG.padSkin.edgePad;
    const lo = -hw + r + edge, hi = hw - r - edge;
    const yLo = -hh + r + edge, yHi = hh - r - edge;
    const cx = clamp(corner.x + (base.x + dx) * currentScale, Math.min(lo, hi), Math.max(lo, hi));
    const cy = clamp(corner.y + (base.y + dy) * currentScale, Math.min(yLo, yHi), Math.max(yLo, yHi));
    return {
      dx: cx / currentScale - corner.x / currentScale - base.x,
      dy: cy / currentScale - corner.y / currentScale - base.y,
    };
  };

  /**
   * 击球键的键名读数:自动击打开着 ⇒ 「自动」,否则「击球」。
   * **那个字符串只在这一条路上决定**(syncLabel 与 setAutoMark 都调它):两条路径各写一次
   * 就是"徽标一套判定、实球另一套"的键名版,而 apply() 每次重排都会走 syncLabel。
   * 为什么改键名而不是在球种徽标后面缀「· 自动」(旧写法):那个 Label 只在**有来球**时才有
   * 内容,发球/死球/暂停时整颗键看不出"这键不由你按" —— 玩家恰恰在这几拍最容易困惑,
   * 而同一信息也只该说一次(徽标现在只报球种,config.shotBadge.autoSuffix 已删)。
   * 透明度不吃滑杆原值而是 alphaFloor(keep):淡出的是按键,不是"这颗键现在归谁按"这条
   * 状态读数(同一套理由见 input/pad-cd.ts 的 cdAlpha)。判据 pad-cd-check ⑩。
   */
  const syncAutoLabel = (rec: BtnRec): void => {
    if (rec.action !== "swing" || !rec.labelComp || !rec.labelOp) return;
    const PL = CFG.autoHit.padLabel;
    const txt = rec.autoMark ? PL.text : PAD_LABEL.swing;
    if (rec.labelComp.string !== txt) rec.labelComp.string = txt;
    // 色即功能:「自动」这两个字用全站说"自动"这个概念的那个色(与场边飘字同源),
    // 关掉就换回键名原本的白字 —— 两条都是一颗 Label 的两个状态,不是两个节点。
    const hex = rec.autoMark ? PL.color : CFG.padSkin.label;
    const want = skinColor(hex, 1);
    const cur = rec.labelComp.color;
    if (cur.r !== want.r || cur.g !== want.g || cur.b !== want.b) rec.labelComp.color = want;
    const A = rec.autoMark
      ? CFG.padSkin.labelA * alphaFloor(Settings.padAlpha, PL.keep)
      : CFG.padSkin.labelA * Settings.padAlpha;
    const op = Math.round(A * 255);
    if (rec.labelOp.opacity !== op) rec.labelOp.opacity = op;
  };

  /** 键名标签跟随半径与透明度(仅 swing/lunge 两键有标签;半径变、padAlpha 变都要刷) */
  const syncLabel = (rec: BtnRec): void => {
    if (rec.labelOp) {
      rec.labelOp.node.setPosition(0, -rec.r * 0.62);
      rec.labelOp.opacity = Math.round(CFG.padSkin.labelA * Settings.padAlpha * 255);
    }
    // 击球键那一层的透明度由 syncAutoLabel 覆写(它给状态读数留了下限)
    syncAutoLabel(rec);
    syncCdLabel(rec);
    syncHintLabel(rec);
  };

  /**
   * 键心读数:内容与透明度。**同一个 Label 节点、两条内容**——
   * 冷却款印「还剩几秒」,充能款印「攒了多少%」。不另开第二个节点:
   * 那两个读数永远互斥(一款技能只走一条通道),叠两个节点就多一个要同步透明度、
   * 要在几何判据里防撞的物件,而 pad-cd-check ④ 钉的是"这一个读数不撞键名标签"。
   * 透明度走 cdAlpha,不是滑杆原值:玩家调淡的是按键,不是「这颗键现在什么状态」这条信息。
   */
  const syncCdLabel = (rec: BtnRec): void => {
    if (!rec.cdComp || !rec.cdOp) return;
    const charge = isChargeSkill((rec.skillId ?? "lunge") as SkillId);
    sizeCdLabel(rec.cdComp, rec.r, charge ? CH.pctK : undefined);
    // 封条占着同一个腰位(numY === hintY),所以**封条在的时候键心必须让字**。
    // 冷却款从来不会撞,因为受阻那一下 cdSec 本来就是 0 → cdText 空串;
    // 充能款不一样:armed 那 240 帧里怒气还挂在管上(那一拍没打出去),读数是非空的"100%",
    // 于是"100%"与「重击中」直接糊成"1重击中%"(出图肉眼判抓到的现场)。
    const txt = rec.skillBlock ? ""
      : (charge ? chargeText(rec.chargePipes ?? 0, rec.chargeRatio ?? 0) : cdText(rec.cdSec ?? 0));
    if (rec.cdComp.string !== txt) rec.cdComp.string = txt;
    rec.cdOp.opacity = Math.round((txt ? CFG.padSkin.cd.numA * cdAlpha(Settings.padAlpha) : 0) * 255);
  };

  /**
   * 技能门槛受阻提示文字(内嵌封条):字号随半径自适应、居中偏上对齐腰部、
   * 透明度跟随 cdAlpha(状态信息保留下限,亮场与低滑杆下均清晰可读)。
   */
  const syncHintLabel = (rec: BtnRec): void => {
    if (!rec.hintComp || !rec.hintOp) return;
    const CDK = CFG.padSkin.cd;
    const fs = Math.max(7, Math.round(rec.r * 0.26));
    rec.hintComp.fontSize = fs;
    rec.hintComp.lineHeight = Math.round(fs * 1.15);
    rec.hintComp.node.setPosition(0, rec.r * (CDK.hintY ?? 0.08));
    const txt = rec.skillBlock ?? "";
    if (rec.hintComp.string !== txt) rec.hintComp.string = txt;
    rec.hintOp.opacity = txt
      ? Math.round((CDK.hintA ?? 0.98) * cdAlpha(Settings.padAlpha) * 255)
      : 0;
  };

  const apply = (): void => {
    // 模式或设备尺寸变了 → 拆左簇重建;scale 只影响左侧摇杆与按钮渲染
    const newMode = Settings.moveMode;
    const newScale = padScale();
    if (newMode !== currentMode || Math.abs(newScale - currentScale) > 1e-3) {
      currentMode = newMode;
      currentScale = newScale;
      buildLeftSide();
      // 右簇也要跟着重画半径;右侧结构不变,直接原地刷 r / 位置
      for (const rec of recs) {
        if (PAD_BASE[rec.action].cluster !== "right") continue;
        const base = PAD_BASE[rec.action];
        const p = Settings.padOf(rec.action);
        rec.r = p.r * currentScale;
        rec.node.setPosition((base.x + p.dx) * currentScale, (base.y + p.dy) * currentScale);
        rec.ut.setContentSize(rec.r * 2, rec.r * 2);
        rec.flash.getComponent(UITransform)!.setContentSize(rec.r * 2.6, rec.r * 2.6);
        syncLabel(rec);
        paint(rec, !!opts.edit);
      }
    } else {
      for (const rec of recs) {
        const base = PAD_BASE[rec.action];
        const p = Settings.padOf(rec.action);
        const shown = clampDelta(rec.action, p.dx, p.dy);   // 只夹显示,不动存档
        rec.r = p.r * currentScale;
        rec.node.setPosition((base.x + shown.dx) * currentScale, (base.y + shown.dy) * currentScale);
        rec.ut.setContentSize(rec.r * 2, rec.r * 2);
        rec.flash.getComponent(UITransform)!.setContentSize(rec.r * 2.6, rec.r * 2.6);
        syncLabel(rec);
        paint(rec, !!opts.edit);
      }
      if (stick) {
        const j = Settings.joystick;
        const shown = clampDelta("joystick", j.dx, j.dy);
        stick.baseR = j.r * currentScale;
        stick.knobR = stick.baseR * KNOB_RATIO;
        stick.root.setPosition((JOYSTICK_BASE.x + shown.dx) * currentScale, (JOYSTICK_BASE.y + shown.dy) * currentScale);
        stick.baseUt.setContentSize(stick.baseR * 2.6, stick.baseR * 2.6);
        stick.knob.getComponent(UITransform)!.setContentSize(stick.knobR * 2, stick.knobR * 2);
        paintStick(stick, false, false, !!opts.edit);
        paintKnob(stick, false);
      }
      if (slider) {
        const s = Settings.slider;
        const G = railGeo();
        const shown = clampRailDelta(s.dy);
        slider.r = s.r * currentScale;
        slider.h = slider.r * 2;
        slider.span = G.span;
        slider.minX = G.minX;
        slider.maxX = G.maxX;
        slider.w = G.span + slider.r * 2;
        // x 与长度不乘 scale:轨是球场的投影,球场不随长宽比缩放
        slider.root.setPosition(G.centerUiX, SLIDER_BASE.y + shown.dy);
        slider.baseUt.setContentSize(slider.w + 32, slider.h + 32);
        slider.thumb.getComponent(UITransform)!.setContentSize(slider.r * 2.2, slider.r * 2.2);
        // 换机/重置后旧滑块位置可能落在新行程外,夹回来,别让滑块挂在轨端之外
        slider.thumb.setPosition(clamp(slider.thumb.position.x, -G.span / 2, G.span / 2), 0);
        paintSliderTrack(slider, false, !!opts.edit);
        paintSliderThumb(slider, false);
      }
    }
  };

  const select = (slot: PadSlot | null): void => {
    for (const rec of recs) {
      const on = slot !== null && slot !== "joystick" && slot !== "slider" && rec.action === slot;
      if (on !== rec.selected) {
        rec.selected = on;
        paint(rec, !!opts.edit);
      }
    }
    if (stick) {
      const on = slot === "joystick";
      if (on !== stick.selected) {
        stick.selected = on;
        paintStick(stick, false, false, !!opts.edit);
      }
    }
    if (slider) {
      const on = slot === "slider";
      if (on !== slider.selected) {
        slider.selected = on;
        paintSliderTrack(slider, false, !!opts.edit);
      }
    }
  };

  const pulseSwing = (tier: "sweet" | "perfect"): void => {
    // 甜蜜 = 金环轻弹;完美 = 青环更外扩更久。击球键合并后只亮一个。
    const hex = tier === "perfect" ? CFG.colors.sweet.neonCyan : CFG.colors.sweet.gold;
    for (const rec of recs) {
      if (rec.action !== "swing") continue;
      triggerGlow(rec, hex, tier === "perfect");
    }
  };

  const setSwingGlow = (level: number): void => {
    const v = clamp(level, 0, 1);
    for (const rec of recs) {
      if (rec.action !== "swing") continue;
      // 量化到 0.1 一档才重画:来球逼近的辉光爬坡(~14 帧)旧版每帧全键重画,
      // 现在隔帧重画一次;爬坡本身是注意力提示,10% 一档的阶梯感可忽略,
      // 到点的强提示由 pulseSwing 的闪环承担,不依赖这条渐变的无级平滑。
      // 两端(全灭/全亮)不量化,保证辉光精确归零/拉满,不会剩一层"擦不干净"的余晖。
      const atEnd = (v <= 0 && rec.glow <= 0.001) || (v >= 1 && rec.glow >= 0.999);
      if (!atEnd && Math.abs(rec.glow - v) < 0.1) continue;
      rec.glow = v;
      paint(rec, !!opts.edit);
    }
  };

  /**
   * 完全就绪时的呼吸辉光:flash 环低频呼吸循环 tween。
   * 用循环 tween 而不是逐帧重画 —— setSkillState 每帧都会进来,重画一整键太浪费;
   * triggerFlash/triggerGlow 与它共用 flash 子节点,会先打断置 readyPulsing=false,
   * 下一帧这里发现状态仍是就绪就重新起呼吸。
   *
   * 「就绪」在两条通道下定义不同,必须分流:冷却款 = 倒计时走完;充能款 = **攒着至少一整管**。
   * 照旧用 cdRatio<=0 判充能款的话,空槽那根管会在"随时能按但没怒气"时无限呼吸,
   * 而按下去只得到一句「怒气未聚」—— 那正是本文件存在要防的"读数撒谎"(见 pad-cd.ts 头注)。
   * 多管后判据走 chargePipes>=1 而不是 chargeRatio>=1:恰好攒满一管时当前段填充恒 0
   * (Skills.ragePipeFillOf 的边界口径),看填充会在整管边界上漏掉呼吸。
   */
  const syncReadyPulse = (rec: BtnRec): void => {
    const charge = isChargeSkill((rec.skillId ?? "lunge") as SkillId);
    const metered = charge ? (rec.chargePipes ?? 0) >= 1 : (rec.cdRatio ?? 0) <= 0;
    const on = rec.action === "lunge" && metered
      && rec.skillReady === true && !rec.skillBlock;
    if (on === !!rec.readyPulsing) return;
    rec.readyPulsing = on;
    Tween.stopAllByTarget(rec.flash);
    Tween.stopAllByTarget(rec.flashOp);
    if (on) {
      paintFlashRing(rec, skillAccent(rec.skillId ?? "lunge"));
      rec.flash.setScale(1, 1, 1);
      rec.flashOp.opacity = 0;
      const half = CFG.padSkin.cd.readyPulseK * 10 * 0.5;
      tween(rec.flashOp)
        .to(half, { opacity: 130 })
        .to(half, { opacity: 0 })
        .union()
        .repeatForever()
        .start();
    } else {
      rec.flashOp.opacity = 0;
    }
  };

  const setSkillState = (cdRatio: number, ready: boolean, skillId: string, skillName?: string, cdSec = 0, blockReason?: string | null, chargeRatio = 0, chargePipes = 0): void => {
    for (const rec of recs) {
      if (rec.action !== "lunge") continue;
      const block = blockReason ?? null;
      // 比例项走 gate:基准是「上一次画上屏的值」。直接比 rec.cdRatio 的旧写法基准每帧被
      // 覆盖,阈值退化成相邻帧增量(= 1/maxCd),长 CD 的扫掠会整段冻结(见 pad-cd.makeCdGate)
      // 充能层用它**自己那一个** gate:一个 gate 只记得住一个基准,共用就会互相顶掉。
      // 门控量纲 = pipes + fill(合成后恰是 rage/max,0..3 单调):单看 fill 也会在
      // 整管边界上撞出大跳(0.99 → 0)必重画,但合成值把"跨过一段"与"段内长了一点"
      // 统成同一把尺,顺带让 keys 外的读数工具能直接对账。
      const chargeMeter = chargePipes + chargeRatio;
      const changed = (rec.cdGate?.step(cdRatio) ?? true)
        || (rec.chargeGate?.step(chargeMeter) ?? true)
        || rec.skillReady !== ready
        || rec.skillId !== skillId
        || rec.skillBlock !== block;
      rec.cdRatio = cdRatio;
      rec.cdSec = cdSec;
      rec.chargeRatio = chargeRatio;
      rec.chargePipes = chargePipes;
      rec.skillReady = ready;
      rec.skillId = skillId;
      rec.skillBlock = block;
      if (skillName && rec.labelComp && rec.labelComp.string !== skillName) {
        rec.labelComp.string = skillName;
      }
      syncCdLabel(rec);
      syncHintLabel(rec);
      syncReadyPulse(rec);
      if (changed) {
        paint(rec, !!opts.edit);
        // 画过屏就把两条 gate 的基准对齐到刚上屏的值(CdGate.sync 的契约,见 pad-cd.ts)。
        // 这一句在充能层是新加的,在冷却层是补上的:changed 也可能只由 skillReady/skillBlock
        // 触发(那几条不跨过 stepTol),此时整键其实已经重画、扫掠也按当前 ratio 画过了,
        // 基准却还停在旧值 ⇒ 下一帧又会因为"累计变化"白白重画一次。
        rec.chargeGate?.sync(chargeMeter);
        rec.cdGate?.sync(cdRatio);
      }
    }
  };

  /** 球种预告徽标(击球键上方):传 null 隐藏。game-root 每帧喂 previewKind 的结果。
   *  只报球种,**不再缀「· 自动」**:模式读数搬到键名上了(syncAutoLabel,常亮且发球/死球
   *  时也在),同一信息不在一颗键上说两遍。颜色也绝不覆盖球种色 —— 那会把"这一拍是什么球"
   *  洗成一片红。 */
  const setShotPreview = (kind: string | null): void => {
    for (const rec of recs) {
      if (rec.action !== "swing" || !rec.badgeComp || !rec.badgeOp) continue;
      const def = kind ? (CFG.shotBadge.kinds as Record<string, { text: string; color: string }>)[kind] : undefined;
      const txt = def ? def.text : "";
      if (rec.badgeComp.string !== txt) {
        rec.badgeComp.string = txt;
        if (def) rec.badgeComp.color = skinColor(def.color, 1);
      }
      const target = txt ? Math.round(CFG.shotBadge.a * 255) : 0;
      if (rec.badgeOp.opacity !== target) rec.badgeOp.opacity = target;
    }
  };

  /**
   * 自动击打(辅助模式)的键面读数:开 = 击球键键名变「自动」(文案/配色/浓度下限都在
   * config.autoHit.padLabel)。game-root 每真实帧喂 `AutoHit.on`,变化才刷 —— 这个文件不
   * import core/auto-hit:模式判定留在逻辑侧,按键只照参数画(与 setShotPreview 同一个形状)。
   * 只在 swing 键生效;lunge 那颗的键名归 setSkillState(技能名)。
   */
  const setAutoMark = (on: boolean): void => {
    for (const rec of recs) {
      if (rec.action !== "swing" || rec.autoMark === on) continue;
      rec.autoMark = on;
      syncAutoLabel(rec);
    }
  };

  /**
   * 「已经瞄准、还没用掉」的键缘回显:辅助开着(或长滑锁定中)时把 pad 上那次提交喂进来,
   * 让深浅/高低两道方向弧在手指抬起之后继续亮着 —— 没锁时亮到那一拍真打出去
   * (restoreSwingAim ⇒ 没锁归 0,当场熄灭),有锁时一直亮 = 「之后每一拍都往这个方向打」。
   * 这是"欠着一拍的瞄准/锁定中"唯一看得见的证据:没有它,玩家滑完什么也没发生,下一拍才突然变向。
   *
   * 按住中不改(rec.pressed 时手势自己拥有那两个字段,两边抢同一字段就是画面与意图打架;
   * 锁定态的按下视觉由 down() 用锁值初始化 swipeDir,弧照样当场亮);
   * 但**归零时连 rec.swipeDir 一起清** —— 外部把 pad 清了而手指还压着,不去清的话
   * trackSwingSwipe 的同方向去重会让画面上留着一道已经作废的弧。
   */
  const setAimEcho = (x: number, y: number): void => {
    for (const rec of recs) {
      if (rec.action !== "swing") continue;
      if (rec.aimEcho === x && rec.aimEchoY === y) continue;
      rec.aimEcho = x;
      rec.aimEchoY = y;
      if (x === 0 && y === 0) { rec.swipeDir = 0; rec.swipeDirY = 0; }
      if (rec.pressed) continue;            // 按住中由手势说话,paint 现读 rec.swipeDir
      paint(rec, !!opts.edit);
    }
  };

  apply();
  // 设置页/编辑器改布局 → 两个实例(真按键 + 编辑预览)都跟着刷;
  // apply 只读不写 Settings,不会自激。
  const off = Settings.onChange(() => apply());

  return {
    root: layer,
    apply,
    clampDelta,
    select,
    pulseSwing,
    setSwingGlow,
    setSkillState,
    setShotPreview,
    setAutoMark,
    setAimEcho,
    get moveMode(): MoveMode { return currentMode; },
    clearPressed(): void {
      claims.clear();
      for (const rec of recs) {
        const hadGlow = rec.glow > 0;
        const hadSwipe = rec.swipeDir !== 0 || rec.swipeDirY !== 0; // 滑动档位也是视觉态:层被藏起来时一并清,
        rec.swipeDir = 0;                      // 否则再亮出来会残留上一次的深/浅图标
        rec.swipeDirY = 0;
        if (!rec.pressed && !hadGlow && !hadSwipe && rec.node.scale.x === 1) continue;
        rec.pressed = false;
        rec.glow = 0;
        Tween.stopAllByTarget(rec.node);
        Tween.stopAllByTarget(rec.flashOp);
        rec.flashOp.opacity = 0;
        rec.node.setScale(1, 1, 1);
        paint(rec, !!opts.edit);
      }
      if (stick && stick.activeTouch !== null) {
        stick.activeTouch = null;
        // 代跳的迟滞状态必须一起清:层被 hide 时手指可能正压在起跳区,
        // jumpOn 留着 true 的话下一次碰摇杆会认为还按着,要推回 upLo 以下才能再跳 —— 卡跳。
        // 走 cancelJump 而不是 release:这不是玩家主动松手,不该补出一段点跳尾巴。
        if (stick.jumpOn) { stick.jumpOn = false; cancelJump(pad); }
        Tween.stopAllByTarget(stick.knob);
        stick.knob.setPosition(0, 0);
        paintStick(stick, false, false, !!opts.edit);
        paintKnob(stick, false);
        setMoveAxis(pad, 0);
      }
      if (slider && (slider.activeTouch !== null || slider.jumpOn)) {
        slider.activeTouch = null;
        if (slider.jumpOn) { slider.jumpOn = false; cancelJump(pad); }
        paintSliderTrack(slider, false, !!opts.edit);
        paintSliderThumb(slider, false);
      }
    },
    safe,
    destroy(): void {
      off();
      layer.destroy();
    },
  };
}

// ============================================================
// 显隐控制器:虚拟按键只在**真正在打球**时出现。
//
// 决策放这里(由 GameRoot 每帧喂状态),不放 UIManager —— UI 不碰输入层,
// 项目既有的分层不破。设置页的「调整位置」用的是面板自己的第二个 pad 实例
// (见 buildTouchPad 的 edit 模式),所以编辑态永远进不了这条判据,
// 也不存在两份按键同屏。
// ============================================================

class TouchPadController {
  private handle: TouchPadHandle | null = null;
  private pad: Pad | null = null;
  private playing = false;
  // 两条"模式/意图"读数存在 controller 上而不是存在按钮实例里:
  // game-root 是每帧喂一次(edge-sync),而 handle 可能在两次喂之间被重建(mount 晚于第一次
  // update,或将来重挂),把状态留在这里重建后就能立刻补回,不必要求调用方"重建后再喂一次"。
  // 编辑态那个实例(settings-panel 的「调整位置」)根本不走 controller ⇒ 天然不会显示「自动」。
  private autoMark = false;
  private echoX = 0;
  private echoY = 0;

  /** GameRoot.start 调一次;重复调用是 no-op */
  mount(root: Node, pad: Pad): void {
    if (this.handle) return;
    this.pad = pad;
    this.handle = buildTouchPad(root, pad);
    this.handle.root.active = false;
    // 重建后立刻补两条读数:否则挂载那一帧之后的第一次 setAutoMark 会被 handle 的
    // `rec.autoMark === on` 短路掉,键名停在「击球」直到下一次开关才变。
    this.handle.setAutoMark(this.autoMark);
    this.handle.setAimEcho(this.echoX, this.echoY);
  }

  /** GameRoot.update 每帧调:值没变就直接返回,不改 active */
  setPlaying(on: boolean): void {
    if (this.playing === on) return;
    this.playing = on;
    const h = this.handle;
    if (!h) return;
    h.root.active = on;
    if (on) {
      h.apply();               // 藏起来的这段时间里用户可能改过布局/移动方式
    } else {
      // ⚠ 关键:手指按着「左」/推着摇杆时把层 active=false,那个 TOUCH_END 就永远送不到
      // 节点,pad.left 卡在 true / moveAxis 停在最后一次推送值 → 下一局人自己往一边跑。
      // 所以「藏起来」这个动作必须顺带把所有按下状态清干净(pad 状态 + claim + 视觉)。
      this.releaseAll();
      h.clearPressed();
    }
  }

  /** 清掉所有按下状态(隐藏时自动调;切局/退出也可以直连) */
  releaseAll(): void {
    if (this.pad) resetPadHolds(this.pad);
  }

  /** 甜蜜/完美命中 → 击球两键档位辉光;未挂载(桌面纯键盘)时静默忽略 */
  pulseSwing(tier: "sweet" | "perfect"): void {
    this.handle?.pulseSwing(tier);
  }

  /** 按拍预告辉光电平;未挂载时静默忽略 */
  setSwingGlow(level: number): void {
    this.handle?.setSwingGlow(level);
  }

  /** 设置技能按键运行时状态 (CD、就绪、技能名、剩余秒、充能比例与管数);未挂载时静默忽略 */
  setSkillState(cdRatio: number, ready: boolean, skillId: string, skillName?: string, cdSec?: number, blockReason?: string | null, chargeRatio?: number, chargePipes?: number): void {
    this.handle?.setSkillState(cdRatio, ready, skillId, skillName, cdSec, blockReason, chargeRatio, chargePipes);
  }

  setShotPreview(kind: string | null): void {
    this.handle?.setShotPreview(kind);
  }

  /** 自动击打(辅助模式)开着 = 击球键键名换成「自动」;未挂载(桌面纯键盘)时静默忽略 */
  setAutoMark(on: boolean): void {
    if (this.autoMark === on) return;
    this.autoMark = on;
    this.handle?.setAutoMark(on);
  }

  /** 「已经瞄准、还没用掉」的键缘回显;值没变就不进 handle(它每真实帧被调) */
  setAimEcho(x: number, y: number): void {
    if (this.echoX === x && this.echoY === y) return;
    this.echoX = x;
    this.echoY = y;
    this.handle?.setAimEcho(x, y);
  }
}

export const touchPad = new TouchPadController();
