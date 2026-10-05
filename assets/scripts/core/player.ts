// ============================================================
// 角色:移动 / 跳跃(coyote + 缓冲 + 可变跳高)/ 挥拍状态机 / 扫掠命中
// 手感要点集中在这里,数值全在 config.ts
// ============================================================
import { CFG } from "./config";
import { clamp, lerp, approach, sweptHit } from "./utils";
import { Physics, FuturePt, flightFramesToClosest } from "./physics";
import { Gait } from "./gait";
import { Pace } from "./pace";
import { AutoHit } from "./auto-hit";
import { Skills } from "./skills";
import { ShadowGate } from "./shadow-gate";
import { Ball, HitOpt, Player as PlayerEntity, PlayerInput, ShadowCloneState, ShotResult, SwingBestShot, Theme } from "./types";

// 本模块导出的 Player(值:移动/挥拍/命中的 API)与 types 的 Player 实体(类型)
// 同名对外,调用方 `import { Player } from "./player"` 两个语义都拿得到,
// 与老仓库「DD.Player 既是命名空间又是概念」的心智一致
export type Player = PlayerEntity;

const C = CFG;
const CO = C.court, PL = C.player, SW = C.swing;
const SPAN = C.shot.farOffset - C.shot.nearOffset;

/**
 * 腿速那一层乘谁的档:真人乘「移速」滑杆,AI 乘「球速」档的**反折**(×s)。
 *
 * 为什么 AI 要跟着球速档缩腿:球慢 20% = 同一记来球多给 25% 的帧,而 AI 的失误是
 * **空间量**(看走眼多少 px、出球误差多少 px),帧一多它就有更多时间去纠同一个空间错
 * —— 于是"给玩家松绑"的旋钮顺手把电脑也松强了(实测 s=0.92→0.80 时 AI 接发 90%→96~100%,
 * 入门档真人得分率从 55% 掉到 42%)。腿 ×s 之后"跑到位要几帧"跟着球一起变长,这一份便宜就还回去了。
 * 另一半(读球快慢)在 core/ai.ts 的 readHardness,用 Pace.ref 折回基准 —— 两处合起来才是完整一层。
 * 真人**不**吃这一折:那格滑杆就是给他留的(见 core/pace.ts 文件头)。
 */
const legTierMul = (p: PlayerEntity): number => (p.isAI ? Pace.s : Gait.s);

export interface PlayerModifier {
  accelMul?: number;
  vmaxMul?: number;
  jumpMul?: number;
  frictionMul?: number;
  reachMul?: number;
  cooldownMul?: number;
  staminaSystem?: boolean;
  forbiddenNetZone?: number;
  iaiStrike?: boolean;
  zenFocus?: boolean;
}

let activePlayerModifier: PlayerModifier | null = null;

export function setPlayerModifier(mod: PlayerModifier | null): void {
  activePlayerModifier = mod;
}

export function getPlayerModifier(): PlayerModifier | null {
  return activePlayerModifier;
}

function create(side: PlayerEntity["side"], opts: Partial<PlayerEntity> & { homeX?: number } = {}): PlayerEntity {
  const homeX = opts.homeX ?? (side === "left" ? CO.netX - 200 : CO.netX + 200);
  return {
    side, isAI: !!opts.isAI, theme: opts.theme, label: opts.label,
    aiDiff: opts.aiDiff || null, ai: null, zone: opts.zone || "all",
    teamLabel: opts.teamLabel || opts.label || side, idx: 0, jersey: opts.jersey || "0",
    x: homeX, y: CO.groundY, vx: 0, vy: 0,
    px: homeX, py: CO.groundY, homeX,
    facing: side === "left" ? 1 : -1,
    onGround: true, coyote: 0, jumpBuf: 0,
    sq: 1, sqPrev: 1,             // squash / stretch(Prev 供渲染插值,消 60Hz 阶跃)
    recoverT: 0,                  // 收拍回摆计时:挥拍结束后从弧线终点摆回待机
    runPhase: 0, runAmt: 0, runStep: 0, // 步频相位(随位移累积)/跑姿权重/落脚计数
    blinkSeed: Math.random() * 220,     // 眨眼周期相位,各角色错开
    face: "normal", faceT: 0,           // 表情状态:game 层事件设置,这里只负责衰减
    swingT: -1, swingStyle: "over", swingHit: false, swingQ: 0,
    swingBuf: 0, swingBufAim: null, swingAim: "mid", swingLoft: 0,
    swingRadius: SW.radiusBase,
    racket: { x: homeX, y: CO.groundY - 40, ang: 0 },
    racketPrev: { x: homeX, y: CO.groundY - 40 },
    hitLock: 0, contactFlash: 0, speedMul: 1, aiAimErr: 0, zoneScale: 1,
    score: 0,
    smashGlow: 0,
    sweetGlow: 0,
    perfectGlow: 0,
    heat: 0,                        // 连击热手:本分内连续 sweet/perfect 计数(rules 在 beginPoint 清零)
    hitRecoil: 0,                   // 击球身体后仰(度):命中瞬间设值,每帧衰减回 0
    lungeT: -1,                     // 跨步救球:-1=未激活,>=0=当前帧计数
    lungeDir: 0,                    // 跨步方向(1=右,-1=左)
    lungeCd: 0,                     // 跨步冷却:>0 不许再跨,移动照常
    lungeShotT: 0,                  // 跨步后特殊击球窗口倒计时(>0=窗口内)
    lungeAutoT: 0,                  // 跨步自动回球待发窗剩余帧(>0=系统替玩家按这一拍)
    smashAutoT: 0,                  // 重击代出一拍待发窗剩余帧(>0=附魔到点由系统轰出暴扣)
    skill: Skills.initSkillState((opts.skill && opts.skill.id) || "lunge"),
    flashT: 0,
    focusT: 0,
    stats: {
      hits: 0, smashes: 0, sweets: 0, perfects: 0, whiffs: 0,
      lungeShots: 0, jumpSmashes: 0, iaiStrikes: 0, skillCasts: 0,
      deepShots: 0, netIntercepts: 0, airHits: 0, empReturns: 0,
      zonePenalties: 0, exhausted: 0,
    },
    stamina: activePlayerModifier?.staminaSystem ? 100 : undefined,
    isExhausted: false,
    zenMeter: 0,
    forbiddenWarn: 0,
    sliding: 0,
  };
}

/**
 * 影分身的墨色主题:全剪影人偶 + 身份色点缀,黑脸无五官天然读作"无面之影"。
 * **每体复制一份,绝不共享同一对象** —— 三个分身共用一个 theme 时,任何一方就地写一下
 * 就改了三个(本仓 palette.ts 顶部专门警告过这个形状)。身份色进 glow:渲染从 p.theme.glow
 * 取它,于是"三色"零新增跨层字段 —— world 的 cloneView 用 Object.assign 拷实体,自动带上。
 */
function shadowTheme(slot: number): Theme {
  return { main: "#232733", dark: "#12141c", glow: ShadowGate.slotTint(slot), name: "影分身" };
}

/**
 * 召唤影分身(「影分身」技能的实体落点)。
 * 分身**刻意不进 RulesState.players**:发球轮转(mates[serveIdx % length])、计分名单、
 * game-root 的 R.players[0]=真人假设都不许被第三名球员污染 —— 它是挂在宿主身上的
 * 独立 Player,由 core/shadow.ts 用 AI.think 出输入、走本模块 update/tryHit 全套机器。
 * 放在本模块而不是 skills.ts,是因为 create() 工厂在这里,而 skills 不许反向 import player。
 *
 * 2026-10-05 多分身化:同场最多 CFG.skills.shadow.slots.length 个,**身份看 slot**(取最低空位),
 * 颜色 / 防区 / AI 档全由 slot 索引配置。**恒按 slot 升序插入** —— 绘制顺序与补位优先顺序都要
 * 确定,回归才量得出"第几号分身"这种事(不排序的话同一局跑两次结果不同,判据就成了掷骰子)。
 */
export function spawnShadowClone(host: PlayerEntity): void {
  const SH = C.skills.shadow;
  const slot = ShadowGate.freeSlotOf(host);
  if (slot < 0) return;   // 满编:canActivate 已经拦在外面,这里再拦一道(与旧写法同一条纪律)
  const conf = SH.slots[slot];
  const c = create(host.side, {
    isAI: true,
    aiDiff: conf.diff,
    theme: shadowTheme(slot),
    label: "影分身",
    hideTag: true, // 分身不挂名牌:场上多一块名牌会与宿主名牌混淆
    // 各守一块防区:homeX 由槽位偏移决定(右队镜像取反)。0 号 = 0.0.28 那个唯一分身的老位置
    homeX: CO.netX + (host.side === "left" ? conf.homeOffset : -conf.homeOffset),
  });
  c.idx = -1;        // 不占名单索引:R.players[idx] 按位索引永远不该摸到分身(applyShot 事件归因已改用 isAI)
  c.skill = undefined; // 分身不吃技能:AI 决策链(AI.think 的技能分支)与 Pl.update 的 activate 都被这一行封死
  c.x = host.x - host.facing * SH.spawnPushBack; // 从宿主影子里"拔出来":出生在宿主身后半步,再自己跑去防区
  c.px = c.x;
  c.y = CO.groundY;
  c.py = c.y;
  c.facing = host.facing;
  const sc: ShadowCloneState = {
    entity: c,
    slot,
    hits: 0,
    spawnT: SH.spawnFrames, // 成影演出帧(隔帧闪烁):期间不接球,来球归玩家
    despawnT: 0,            // 消散演出帧:>0 期间不再起拍,演完从数组里摘掉
    refillT: 0,             // 补满亮片演出:只有跨回合补满的那一下才非零
    seed: (Math.random() * 1e9) | 0,  // 出生定形种子:渲染层拿它画轮廓辉光的尖刺,逐帧只缩放不重掷
  };
  const arr = host.shadowClones || (host.shadowClones = []);
  let at = arr.length;
  for (let i = 0; i < arr.length; i++) { if (arr[i].slot > slot) { at = i; break; } }
  arr.splice(at, 0, sc);
}

/**
 * 击球合法半场判定:
 * 严格规则要求球在击球方本侧半场,但羽毛球实战中球头探过球网垂直面或网顶正上方即可击打。
 * 旧逻辑硬卡严格 x < netX,导致球抵网口(x=480~485)时时机环亮起、玩家按了却因 1px 被判挥空。
 * 低球给 netReachTolLow(6px,约球头半宽),高于网顶的高球(y <= netTopY)给 netReachTolHigh(12px),允许网前抢网扑球。
 */
const inOwnCourt = (p: PlayerEntity, x: number, y?: number): boolean => {
  const isHigh = y !== undefined && y <= CO.netTopY;
  const tol = isHigh ? (C.swing.netReachTolHigh ?? 12) : (C.swing.netReachTolLow ?? 6);
  return p.side === "left" ? x <= CO.netX + tol : x >= CO.netX - tol;
};

// 瞄准:落点跟着击球键走 —— 远球键 = 深球压底线,近球键 = 短球放网前。
// AI 不按键盘,直接给数值深度;两种来源共用 C.aimDepth 这一张表,不会两处跑偏。
function depthOf(aim: string | number | null | undefined): number {
  if (typeof aim === "number") return aim;
  return (C.aimDepth as Record<string, number>)[aim ?? ""] ?? C.aimDepth.mid;
}

/**
 * 滑动手势对瞄准两轴的覆盖(深浅 + 高低),纯函数。
 * 为什么抽出来:实打那一拍(update 每步覆盖 p.swingAim)与球种预告徽标(previewKind)必须
 * 用同一份算术,否则就是本仓库反复踩过的「徽标一套判定、实球另一套」。预告现在也走这里,
 * 于是自动击打开起来后徽标报的就是「下一次代拍会往哪儿打」,而不是上一拍的旧落点。
 * 语义与抽出来之前逐字相同:两轴独立提交、可组合;0 / null = 不覆盖(保留起拍那个值)。
 */
export function aimOverride(
  aim: string | number,
  loft: number,
  swipe: number | null | undefined,
  swipeY: number | null | undefined,
): { aim: string | number; loft: number } {
  let a = aim;
  if (swipe != null) {
    if (swipe > 0) a = "deep";
    else if (swipe < 0) a = "near";
    // swipe === 0 → 不覆盖,保留 startSwing 的 mid(由物理自动决定球种)
  }
  let l = loft;
  if (swipeY != null) {
    if (swipeY > 0) l = 1;
    else if (swipeY < 0) l = -1;
    // 同上:没滑过纵轴就不覆盖,弧线由物理自动决定
  }
  return { aim: a, loft: l };
}

/**
 * 球种预告徽标的**基准**瞄准(深浅 + 高低)。
 *
 * 为什么需要它:徽标回答的是「下一拍会打成什么球」。自动击打开着时玩家不再按下击球键,
 * `p.swingAim` 就停在**上一拍**的值上 —— 旧写法直接拿它当基准,于是"滑一次管一拍"落地之后
 * 会出现徽标一直报上一拍落点、而系统这一拍打的是 mid 的撒谎(本仓库反复栽的那条:
 * 徽标一套判定、实球另一套)。所以不在收招处改写 `p.swingAim`(那是闪现/引力起手时
 * 故意写下的"下一拍压深场"承诺,见 skills.ts 的 flash/magnet 分支),而是在**读侧**取种子。
 *
 * 三条合取项每一条都有承重:
 *  · `AutoHit.on` —— 关掉时逐字等于今天的表达式(auto-hit-check ⑥/⑩c 的"零变化"口径);
 *  · `!p.isAI` —— 替身/AI 的 p.swingAim 是它们自己的意图,不该被代拍种子覆盖;
 *  · `p.swingT < 0` —— 正在挥拍时基准必须是活值(手动起拍的 aim、技能承诺的 deep、
 *    已经覆盖上来的那次滑动),否则会报成 mid。
 */
export function previewBase(p: PlayerEntity): { aim: string | number; loft: number } {
  if (AutoHit.on && !p.isAI && p.swingT < 0) return { aim: C.autoHit.autoAim, loft: 0 };
  return { aim: p.swingAim, loft: p.swingLoft };
}

/**
 * 「这一次滑动用掉了」:自动击打开着、且这一拍**真把球打出去**(`struck`)时,
 *  ① 把本步输入快照里那两轴作废,② 再经钩子让表现层把 pad 上的瞄准恢复成锁定值
 * (input/pad.ts 的 restoreSwingAim)⇒ 没锁时击球键滑一次只管一拍,不进锁定态;
 * 长滑锁定的方向经同一条路回锁向。
 *
 * 三道闸每一条都不冗余,而且**闸刻意放在这个函数里**(不是调用点的 if):
 * 挂到 `Player` 对象上按对象调用,tools/auto-hit-check.ts 的 --selftest 才能把它换成
 * "消耗一切 / 从不消耗 / 不看 struck / 不看 AutoHit.on"四份反例 —— 换不掉反例的闸门等于没牙齿
 * (与 autoSwingDue 同一套接缝规矩)。
 *  · `!AutoHit.on` 先走 ⇒ 关掉时不写任何东西、钩子也不调,今天那套逐帧行为逐字不变(判据 ⑥/⑩c);
 *  · `!struck` ⇒ **挥空不吃瞄准**(判据 ⑩b):没打上球就没兑现,与「按了没兑现不许白罚」同源;
 *  · `p.isAI` ⇒ AI 永不消耗(判据 ⑩d):game-root 的 inputHooks 是**共用对象**,铺给场上每个人
 *    (含喂球机与影分身),漏了这道闸就是 CPU 打一拍吃掉真人欠着的瞄准。
 *
 * 为什么连 `inp` 也要当场清零:`inp` 是本步**开始时**拍的快照,清 pad 清不到它 —— 而收招帧
 * 正被 `p.swingBuf` 接续下一拍(player.ts 的挥拍机器)时,同一帧稍后的 aimOverride 还会读它,
 * 一次滑动就打两拍(判据 ⑩g)。这个对象一步一个新份、`p.lastInp` 全仓库无人读,作废它是干净的。
 * 刻意不碰 lungeAutoT / flashStrikeT / p.swingAim:代劳的是清一个输入读数,不改任何判定。
 */
export function consumeAutoAim(p: PlayerEntity, inp: PlayerInput, struck: boolean): boolean {
  if (!AutoHit.on || !struck || p.isAI) return false;
  inp.swingSwipe = 0;
  inp.swingSwipeY = 0;
  inp.onAimConsume?.(p);
  return true;
}

/**
 * 「自动击打」的每球限次读数(纯读,不改状态)。
 * 来球身份用 Ball.shot:rules.applyShot 每记击球换一个新对象、beginPoint 清成 null,
 * 天然就是"这一发来球"的令牌 ⇒ 玩家自己抢一拍、球又回来,计的是新账。
 */
function autoTryBudget(p: PlayerEntity, ball: Ball): boolean {
  const used = ball.shot === p.autoTryRef ? (p.autoTries ?? 0) : 0;
  return used < C.autoHit.maxTriesPerBall;
}

function startSwing(p: PlayerEntity, ball: Ball | null, aim?: string | number | null): void {
  p.swingT = 0;
  p.swingHit = false;
  p.swingQ = 0;
  p.swingBest = null;   // 峰值追踪记账清零:新一拍从空账开始
  p.swingAim = aim ?? "mid";
  p.swingLoft = 0;      // 纵向弧线意图同步清零:组合瞄准的两轴都以起拍为界重新提交
  p.swingStyle = ball && CO.groundY - ball.y > 95 ? "over" : "under";
  p.swingRadius = Physics.reachRadius(ball);
  p.racketPrev = Physics.racketHead(p, 0, p.swingRadius);
  // 发球起拍标记:起拍时球还握在手上 = 这一拍是发球。每次起拍覆盖,无需清理;
  // 渲染层据此走发球专属的出发姿势与远臂松球轨迹(纯视觉,不参与判定)
  p.serveSwing = !!(ball && ball.held && ball.owner === p);
  // 来路标记逐拍重定:只有 auto-hit 那条分支会在起手后当场置回 true。
  // 放在这里(而不是各调用点各自写)是为了"没人写就是手动" —— 漏标一处的后果是把玩家的
  // 早/晚教学条一起吞掉,而那正是最不该被吞的一拍。
  p.swingAuto = false;
}

// 命中窗口内的位置 → 质量 0..1(窗口正中 = 甜蜜点)
function qualityAt(elapsed: number): number {
  const a = elapsed - SW.windup - 0.5;
  return clamp(1 - Math.abs(a - (SW.active - 1) / 2) / (SW.active / 2), 0, 1);
}

/** 最佳按拍提前量(帧):qualityAt 峰值对应的挥拍帧 —— 想踩窗口正中,球到判定区心前这么多帧就得按。
 *  单位 = **挥拍动画帧(玩家侧真实时间)**,不是世界步。领域内要经 playerFramesToWorld 折算才能跟 fc 对话。 */
export const PRESS_LEAD_FRAMES = SW.windup + 0.5 + (SW.active - 1) / 2;

/** 带 focusT 的最小形状:真人/AI/残缺探针都能传进来(缺省视为不在领域中) */
type FocusClock = { focusT?: number };

/**
 * 时空领域(focus)里**世界的真实速率**:平时 1,领域内 = ballSlow ≈ 0.35
 * (主循环把 dt × timeScale 喂进 60Hz 定步长累加器 ⇒ 每个真实帧只走 0.35 个世界步)。
 *
 * 为什么这套折算是**唯一**的出口:领域把「世界」拖慢,却故意把「玩家的挥拍/缓冲/收招」
 * 留在真实时间(player.update 的 focusTimeStep = 1/本值)。于是"按下到质量峰 = 9 帧"这件
 * 玩家侧的事,在领域里只值 3.1 个**世界步**,而 fc(球还有几帧到区心)、判定区按来球速度收严、
 * AI 起手提前量全都在数世界步。
 * 2026-10-05 用户现场「时空技能,我现在挥拍很难击中球了」的根因就是这条量纲错配:
 * 时机环按未折算的 9 世界步教人按 ⇒ 系统性早按 6 世界步,那一拍在球到区心之前就走完了命中窗
 * (实测:领域内按时机环按 100% 挥空,容错窗从平时 15~17 世界步掉到 5~9)。
 * 凡跨这两个时钟的量都必须经下面三个包装器折算,再抄一份 0.35 / 2.86 就是第二把尺子
 * (判据 focus-window-check ①②③④)。
 */
export function worldRate(p: FocusClock | null | undefined): number {
  if (!p || (p.focusT ?? 0) <= 0) return 1;
  // 总闸 fx.slowmoEnabled 关掉时主循环根本不变速(world 恒 1 步/真实帧),挥拍也就没有差要补偿。
  // 少这一句就是"关慢放 ⇒ 世界全速、挥拍还按 2.86 倍跑",领域立刻变成比平时难三倍的空挥游戏。
  if (C.fx.slowmoEnabled === false) return 1;
  return C.skills.focus.ballSlow || 0.35;
}

/** swingT 每世界步的增量(领域外的挥拍状态机步进 1;领域内挥拍按真实时间走 ⇒ >1) */
export function swingClockScale(p: FocusClock | null | undefined): number {
  return 1 / worldRate(p);
}

/** 玩家侧的「真实帧」预算 → 世界步(领域内世界走得慢,同样 9 帧只值 3.1 步) */
export function playerFramesToWorld(p: FocusClock | null | undefined, frames: number): number {
  return frames * worldRate(p);
}

/** 世界步量 → 玩家眼里看到的量(来球 px/世界步 → px/真实帧) */
export function worldToPlayerView(p: FocusClock | null | undefined, value: number): number {
  return value * worldRate(p);
}

/** 真的处在"子弹时间"里吗 = 领域状态在场 **且**世界确实被拖慢了(慢放总闸关掉时两者等价) */
export function inTimeDomain(p: FocusClock | null | undefined): boolean {
  return (p?.focusT ?? 0) > 0 && worldRate(p) < 1;
}

/**
 * 时机环该喊「现在按」的那一帧门槛(量纲 = 世界步,与 fc 直接可比):
 * 质量峰提前量 PRESS_LEAD_FRAMES,再加真人"看到→按下"的反应余量 swingCue.reactFrames;
 * 「自动击打」开着时不吃反应(那一拍不用人按)。
 * game-root.updateSwingCue 用它摆环,focus-window-check ① 用它当"玩家该按的帧"下注 ——
 * **预告与判据必须同源**,否则测的是我以为的时机而不是真话(见 [[feedback-demo-must-share-judging]])。
 */
export function swingCuePressFrames(p: FocusClock | null | undefined): number {
  return playerFramesToWorld(p, PRESS_LEAD_FRAMES + (AutoHit.on ? 0 : C.swingCue.reactFrames));
}

function update(p: PlayerEntity, inp: PlayerInput, ball: Ball | null): void {
  p.px = p.x; p.py = p.y; p.sqPrev = p.sq;

  // ---------- 动态技能与跨步救球状态机 ----------
  // 触发判断放在持续推进之前:按下当帧立即爆发
  const skillHit = inp.skillPressed || inp.lungePressed;
  // 滑轨模式下方向解析:若 targetX 存在且与当前位置有明显位移,以目标几何方位为最高优先级(身后往后,身前往前);
  // 否则取明确传入的 skillDir/lungeDir(来自滑轨最后滑动手势或摇杆/按键);全无则兜底 undefined 由各技能决定
  let dir = inp.skillDir ?? inp.lungeDir;
  if (inp.targetX !== undefined && Math.abs(inp.targetX - p.x) > 4) {
    dir = inp.targetX > p.x ? 1 : -1;
  }
  if (skillHit && ball && Skills.canActivate(p, ball)) {
    const success = Skills.activate(p, ball, dir);
    if (success && p.skill) {
      p.stats.skillCasts++;             // 三星判据「释放技能 N 次」:lunge 也是五技能之一,计入
      // 影分身**先落地再播起手**:onSkill 那条链要读"刚出生的是几号分身"(取身份色做粒子与辉光)
      // 和"在场几个"(飘字)。旧写法把召唤排在 onSkill 之后 —— 单分身时无所谓,多分身之后起手字会
      // 少报一个、爆开的还是上一号的色(症状:召第二个时字写「已在场 1 个」、脚下炸的是紫)。
      if (p.skill.id === "shadow") {
        // 影分身实体落点:skills.activate 只记账(shadowCast),create() 工厂在本模块,
        // 所以召唤在这里完成 —— AI 状态由 core/shadow.ts 首次驱动时懒初始化(避免 player→ai 成环)
        spawnShadowClone(p);
      }
      inp.onSkill && inp.onSkill(p, p.skill.id);
      if (p.skill.id === "lunge") {
        if (inp.onLunge) inp.onLunge(p);
        inp.targetX = undefined; // 跨步冲量接管,清空当帧定点避免与跨步初速度竞争
      }
    }
  }

  // 推进技能状态机
  if (ball) {
    Skills.update(p, ball);
  }

  const LG = C.lunge;
  const SM = C.skills.smash;
  const RG = C.skills.rage;
  const AH = C.autoHit;
  if (p.lungeT >= 0) {
    p.lungeT++;
    // 跨步中:vx 在触发帧已锁定(含跑速+爆发),这里只推进帧数与判定区扩大
    if (p.lungeT >= LG.duration) {
      p.lungeT = -1;
      p.lungeCd = p.skill ? p.skill.cd : LG.cooldownFrames;
    }
  } else if (p.lungeCd > 0) {
    p.lungeCd--;
  }
  if (p.lungeShotT > 0) {
    p.lungeShotT--;
  }
  // 自动回球待发窗:与上面同一条规矩 —— 计时器只在这里递减一次。
  // 【坑】lungeShotT 曾被这里的旧孪生行(文件末尾那批衰减里)多减一次,于是配置 60 帧
  // (= 1 秒,与技能文案"1 秒内激活强力暴击"同源)实际只有 30 帧。修回诚实值之后
  // 若实测过强,降 CFG.lunge.shotWindow 这个数值,别把重复递减留着当削弱手段。
  if ((p.lungeAutoT ?? 0) > 0) p.lungeAutoT = (p.lungeAutoT ?? 0) - 1;
  // 重击「代出一拍」待发窗:与上面同一条规矩 —— 计时器只在这里递减一次。
  // 【坑】附魔 buffT 与冷却 cd 的递减在 Skills.update(上面几十行)里,这里再写一行就是
  // 每帧两减:4 秒附魔变 2 秒、3.5 秒冷却变 1.75 秒 —— 与 lungeShotT 从前那个 bug 同一形状,
  // 判据 tools/smash-check.ts 的 ⑬。
  if ((p.smashAutoT ?? 0) > 0) p.smashAutoT = (p.smashAutoT ?? 0) - 1;
  // 怒气重击的「代出一拍」窗:同一条规矩,只在这里减一次。
  // armed 窗本身是 buffT —— 递减处仍是 Skills.update(上面),这里**不**再写一行:
  // 那正是 smashAutoT 注释里那个「每帧两减」的形状,4 秒会悄悄变 2 秒。
  if ((p.rageAutoT ?? 0) > 0) p.rageAutoT = (p.rageAutoT ?? 0) - 1;

  // ---------- 水平:加速度 + 摩擦 ----------
  // 模式优先级:
  // 1. targetX 优先(滑轨模式):精准平滑定点刹停。进入 slowDownDist 减速,进入 arriveEps 绝对落定。
  // 2. 摇杆优先:非零且超过死区时给出模拟量 → 半速小碎步、边界缓冲都是可能的;
  // 3. 键盘/按钮模式下 moveAxis 未定义或为 0,回落到旧的离散左右键。
  // |mv| 同时用作速度上限的缩尺:小推 = 慢走,大推 = 快冲;|mv|==1 时与旧逻辑严格等价。
  const targetX = inp.targetX;
  const SC = C.sliderControl;
  let mv = 0;
  let axisCap = 1;
  const isSliderActive = targetX !== undefined;
  const inFocus = (p.focusT ?? 0) > 0;
  const focusSpeedMul = inFocus ? (C.skills.focus.playerSpeedMul ?? 4.2) : 1;
  const focusAccelMul = inFocus ? (C.skills.focus.playerAccelMul ?? 4.5) : 1;
  // 时空领域内:球与对手被子弹时间拖慢,玩家挥拍/收拍/续拍缓冲按真实时间推进
  // (挥拍动画播放速度正常,不被 slowmo 拖慢;swingT/swingBuf/recoverT 同步补偿,
  //  否则 slowmo 下 swingBuf 衰减慢 + swingT 跳得快会导致"按一次自动连挥")
  // ⚠ 补偿把 swingT 换成真实时钟之后,所有"还剩几帧"的玩家侧判据必须跟着折算 ——
  //   见 swingClockScale 头注(时机环 / autoSwingDue / AI 起手提前量 / 判定区来球速度)。
  const focusTimeStep = swingClockScale(p);

  if (p.lungeT >= 0) {
    // 跨步中:速度由 lunge 物理冲量完全控制,不被滑轨定点刹停截断
    mv = 0;
    axisCap = 0;
  } else if (isSliderActive) {
    const dx = targetX - p.x;
    if (Math.abs(dx) <= (SC?.arriveEps ?? 1.5)) {
      p.x = targetX;
      p.vx = 0;
      mv = 0;
      axisCap = 0;
    } else {
      const dir = dx > 0 ? 1 : -1;
      const dist = Math.abs(dx);
      // 减速缓冲带:若距离小于 slowDownDist,按比例线性收缩速度上限,避免超调与来回震荡
      const slowDist = (SC?.slowDownDist ?? 22) * (inFocus ? 2.5 : 1);
      axisCap = dist < slowDist ? Math.max(0.2, dist / slowDist) : 1;
      mv = dir * axisCap;
    }
  } else {
    const axis = inp.moveAxis ?? 0;
    mv = Math.abs(axis) > 0.15 ? axis : (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    axisCap = Math.min(1, Math.abs(mv));
  }

  // 跨步中:覆盖正常移动逻辑(速度已锁定)。
  // 爆发结束没有慢速恢复期 —— 惯性交给正常摩擦/输入接管(旧 35% 硬钳会把 15px/帧
  // 一帧刹到 3.2,移动中跨步比干跑还慢,手感像急刹)。冷却只限制再次跨步。
  const mod = activePlayerModifier;
  if (p.stamina !== undefined) {
    if (Math.abs(p.vx) > 0.8) {
      p.stamina = Math.max(0, p.stamina - 0.16);
    } else if (p.onGround) {
      p.stamina = Math.min(100, p.stamina + 0.34);
    }
    p.isExhausted = p.stamina < 25;
    // 三星判据「全程体力未枯竭」:取曾经发生语义,进过枯竭态就记账(可恢复,但记录不撤销)
    if (p.isExhausted) p.stats.exhausted = 1;
  }

  // 禁足区警报与僵直
  if (p.forbiddenWarn && p.forbiddenWarn > 0) {
    p.forbiddenWarn--;
    p.vx = 0;
  } else if (mod?.forbiddenNetZone && p.side === "left") {
    const dangerX = CO.netX - mod.forbiddenNetZone;
    if (p.x >= dangerX) {
      p.forbiddenWarn = 24;
      p.vx = -3.5;
      p.stats.zonePenalties++;          // 三星判据「未触发任何禁区惩罚」
    }
  }

  let maxV = PL.vmax;
  if ((p.flashHoldT ?? 0) > 0) {
    // 闪现悬空:人已经定在球的下风高点,这一拍不接受任何移动输入(摇杆/滑轨的拇指稍一动
    // 就把人从球底下拽走,那又是"闪到了却打不到"),横向速度一并清零。
    p.vx = 0;
  } else if (p.lungeT >= 0) {
    // 跨步中:速度由 lunge 逻辑控制,跳过正常加速
  } else if (isSliderActive && axisCap === 0) {
    // 精准定点刹停达成:vx 已置零,无需摩擦
  } else if (!p.forbiddenWarn || p.forbiddenWarn <= 0) {
    // 腿速这一层按人/CPU 分岔(见 legTierMul):真人乘「移速档位」(core/gait.ts),
    // AI 乘「球速档位」的反折 ×s。两层刻意不叠:AI 没有移速档(它的腿是 diffs.speed),
    // 真人不吃球速档的腿速反折(那格滑杆就是给他松绑用的),叠一起回归就在测玩家偏好。
    // 时空减速(focus)激活时赋予倍率加成:对抗世界 slowmo 0.35 并赋予超速移动能力。
    // accel 与 vmax 同比例乘:只提极速不提起步会显得"推起来肉";
    // 跨步冲量与跳跃弹道故意不跟着乘(lunge.speed / jumpV 是另一套手感)。
    const accelMul = (mod?.accelMul ?? 1) * focusAccelMul;
    const vmaxMul = (mod?.vmaxMul ?? 1) * focusSpeedMul;
    const staminaMul = p.isExhausted ? 0.65 : 1;
    const smBase = p.speedMul * legTierMul(p) * staminaMul;
    maxV = PL.vmax * smBase * vmaxMul * axisCap;
    const accel = PL.accel * (p.onGround ? 1 : PL.airAccelMul) * smBase * accelMul;
    const fMul = mod?.frictionMul ?? 1;
    const baseFriction = p.onGround ? (fMul < 0.5 ? Math.max(0.94, PL.groundFriction + (1 - fMul) * 0.1) : PL.groundFriction) : PL.airFriction;
    const friction = inFocus && mv === 0 ? Math.min(baseFriction, 0.68) : baseFriction;
    if (mv !== 0) p.vx += mv * accel;
    else p.vx *= friction;
    if (mv !== 0) {
      p.vx = clamp(p.vx, -maxV, maxV);
    }
    p.sliding = fMul < 0.5 && Math.abs(p.vx) > 1.2 && mv === 0 ? p.vx : 0;
  }
  if (Math.abs(p.vx) < 0.04) p.vx = 0;
  // 横向安全钳制:跨步是叠加冲量,跑动中爆发可达 vmax+speed,钳制要留够余量。
  // 跑动那一项按同一层 sm 放大(移速档「极快」时真人 vmax 13.8 + 跨步 15 + 3 才够,
  // 不放大就会把跨步冲量凭空削掉一截);时空减速高速也确保容纳。
  const xvCap = Math.max(12, Math.max(PL.vmax * p.speedMul * legTierMul(p) + LG.speed + 3, maxV + 3));
  if (isSliderActive && targetX !== undefined && p.lungeT < 0) {
    const stepVx = clamp(p.vx, -xvCap, xvCap);
    if ((p.x - targetX) * (p.x + stepVx - targetX) <= 0) {
      p.x = targetX;
      p.vx = 0;
    } else {
      p.x += stepVx;
    }
  } else {
    p.x += clamp(p.vx, -xvCap, xvCap);
  }

  // 侧视球场:始终面向球网,拍面方向 = 出球方向
  p.facing = p.side === "left" ? 1 : -1;

  const minX = p.side === "left" ? CO.wallL : CO.netX + CO.netPad;
  const maxX = p.side === "left" ? CO.netX - CO.netPad : CO.wallR;
  if (p.x < minX) { p.x = minX; p.vx = Math.max(0, p.vx); }
  if (p.x > maxX) { p.x = maxX; p.vx = Math.min(0, p.vx); }

  // ---------- 跳跃:coyote + 输入缓冲 + 松键截断 ----------
  if (p.onGround) p.coyote = PL.coyote; else if (p.coyote > 0) p.coyote--;
  if (inp.jumpPressed) p.jumpBuf = PL.jumpBuffer; else if (p.jumpBuf > 0) p.jumpBuf--;
  const jumpMul = (mod?.jumpMul ?? 1) * (p.isExhausted ? 0.55 : 1);
  if (p.jumpBuf > 0 && p.coyote > 0 && (!p.forbiddenWarn || p.forbiddenWarn <= 0)) {
    p.vy = PL.jumpV * jumpMul; p.onGround = false; p.coyote = 0; p.jumpBuf = 0;
    p.sq = PL.jumpStretch;
    if (p.stamina !== undefined) p.stamina = Math.max(0, p.stamina - 12);
    inp.onJump && inp.onJump(p);
  }
  if (!inp.jumpHeld && p.vy < 0 && !p.onGround) p.vy *= PL.jumpCut;

  if ((p.flashHoldT ?? 0) > 0) {
    // 闪现蓄力期悬停:不吃重力 —— 主循环那几帧定格 + 这里的人定半空,合起来读作"时停里
    // 已经把球扣在拍上,只是世界还没放行"。蓄力一结束重力立刻接管,落地姿态照常。
    p.vy = 0;
  } else {
    p.vy += PL.gravity;
    p.y += p.vy;
    if (p.y >= CO.groundY) {
      if (!p.onGround) {
        // 扣杀落地:比正常落地蹲得更深(渲染层据此增强膝盖弯曲/躯干前倾)
        const smashLand = p.swingHit && p.swingStyle === "over";
        p.sq = smashLand ? (C.fx.landSquashSmash || 0.62) : PL.landSquash;
        inp.onLand && inp.onLand(p, p.vy);
      }
      p.y = CO.groundY; p.vy = 0; p.onGround = true;
    }
  }
  p.sq = approach(p.sq, 1, 0.05);
  // 击球后仰恢复:每帧向 0 逼近
  if (p.hitRecoil) p.hitRecoil = approach(p.hitRecoil, 0, C.fx.recoilDecay || 0.12);

  // ---------- 步频:相位随位移累积,步频/步幅自然随速度;落脚触发尘土钩子 ----------
  if (p.onGround) p.runPhase += Math.abs(p.vx) * PL.runPhaseK;
  const running = p.onGround && Math.abs(p.vx) > 0.4;
  p.runAmt = approach(p.runAmt, running ? 1 : 0, 0.25);
  const stepIdx = Math.floor(p.runPhase / Math.PI);
  if (stepIdx !== p.runStep) {
    p.runStep = stepIdx;
    if (running && Math.abs(p.vx) > PL.footstepSpeed) inp.onFootstep && inp.onFootstep(p);
  }

  // ---------- 挥拍状态机 ----------
  // 提前按下的缓冲连落点一起记:先按击球键再进挥拍窗口,打出去的还是那拍。
  // 挥拍中也记录(原来直接丢弃,拇指稍早一按就丢输入):收招时仍在 buffer
  // 窗口内的按键自动续拍,与跳跃 jumpBuffer 同一套手感;更早的按键自然过期,
  // whiff 惩罚照旧,不助长乱按。hitstop 顿帧期保留的输入边沿照常从这里消化。
  if (inp.swingAim != null) { p.swingBuf = SW.buffer; p.swingBufAim = inp.swingAim; }
  if (p.swingT >= 0) {
    p.swingT += focusTimeStep;
    const total = Physics.swingTotal() + (p.swingHit ? 0 : SW.whiffExtra);
    if (p.swingT >= total) {
      // 「这一拍到底打出去没有」必须取在收招清零之前:稍后 startSwing(以及引力那条
      // skills.ts 的 magnet 接管)会把 swingHit 重置成 false —— 现读会拿到**下一拍**的假值,
      // 把刚打完的这一拍算成"瞄准还没用掉"。
      const struck = p.swingHit;
      if (!p.swingHit) {
        p.stats.whiffs++;
        if (activePlayerModifier?.zenFocus) p.zenMeter = 0;
        inp.onWhiff && inp.onWhiff(p);
      }
      p.swingT = -1;
      p.recoverT = SW.blendOut;    // 收拍回摆:渲染端把弧线终点插回待机姿势
      // 「一次滑动只管一拍」在这里兑现:真把球打出去的那一拍才算用掉。三道闸(开着辅助 /
      // 这一拍真打出去了 / 不是 AI)与"顺手把本步那份输入快照也作废"都写在 consumeAutoAim
      // 里,并按对象调用 ⇒ --selftest 能把它们各自换成反例(判据 ⑩a~⑩g)。
      // 排在续拍之前:同一帧被 p.swingBuf 接续的下一拍读到的就是已作废的快照,不会把用掉的
      // 方向再吃一次(一次滑动打两拍)。
      Player.consumeAutoAim(p, inp, struck);
      // 收招瞬间消化排队的击球键(挥拍尾声 ~7 帧内按下的就无缝接续下一拍)
      if (p.swingBuf > 0) { startSwing(p, ball, p.swingBufAim); p.swingBuf = 0; }
    }
  } else if (p.swingBuf > 0 && (p.flashHoldT ?? 0) <= 0) {
    // 闪现悬空期不接受手动起拍:那一拍由技能状态机在蓄力结束时发出。
    // 允许的话就是两次挥拍抢同一条时间线,人还悬在半空,球自然打不到。
    startSwing(p, ball, p.swingBufAim); p.swingBuf = 0;
    // 玩家自己按了击打 = 这一拍归他瞄(落点用他滑的方向),技能欠的那一拍当场撤销承诺。
    // 排在上面的手动分支之后正是为了这件事:自动那拍永远不跟手动那拍抢。
    // 两扇窗一起清:重击的附魔不清(那一拍照旧必定暴扣,只是不再由系统代按)。
    p.lungeAutoT = 0;
    p.smashAutoT = 0;
    // 怒气的 armed 窗(buffT)同样**不清** —— 玩家自己挥那一拍,怒气照样该砸进去。
    // 把 buffT 一起清了就变成「我按了技能、又自己挥了一拍,结果怒气没了」,
    // 那是资源制下最坏的一种吞:静默扣掉一整局攒的东西(反例 armedClearedByManual,判据 rage-check ⑫)。
    p.rageAutoT = 0;
  } else if ((p.lungeAutoT ?? 0) > 0 && !p.isAI && C.lunge.autoReturn && ball && Player.autoSwingDue(p, ball)) {
    // 跨步自动回球:窗口内替玩家按这一拍,起手帧与时机环收满那一帧同源(见 autoSwingDue)。
    // 走 startSwing → tryHit 的**真实**峰值追踪,不碰 flashStrikeT 那条必中分支 ——
    // 用户拍板"不加必中":走位误差、贴墙夹取照样把这拍做坏,只是不用再惦记第二次点击。
    // 起手**不**清 lungeAutoT:它是判定区尾段的开关,清掉会把尾段从正在进行的挥拍里抽走,
    // 那一拍反而够不着刚才自己判成"该打"的球。不重复出拍由 p.swingT < 0(整条 else-if 链)
    // 与 ball.lastHitter(打完就是自家球)两头钉死。
    startSwing(p, ball, LG.autoAim);
  } else if ((p.smashAutoT ?? 0) > 0 && !p.isAI && SM.autoReturn && p.skill
    && p.skill.id === "smash" && p.skill.buffT > 0 && ball && Player.autoSwingDue(p, ball, "smash")) {
    // 重击一键化(2026-10-04):上弦之后到点替玩家把那一记暴扣轰出去 —— 择帧与跨步共用同一条
    // autoSwingDue(够不着/界外/将死/隔网/自家球一律不起手),不另编一套时机,免得两处跑偏。
    // 排在跨步那一支之后是有意的:两扇窗同时开着时先让跨步代拍,因为它自带判定区尾段倍率,
    // 够得着的可能性更大;而那一拍同时吃 lungeShotT + buffT,与玩家自己按时的行为完全一致。
    // 起手**当场清窗**(与 lungeAutoT 相反):它不兼判定区开关,留着只会在替玩家挥空之后
    // 隔二十帧再代一下、又代一下,读起来就是"人物自己乱挥半天"。一次施放最多代一拍。
    // 不加必中:不碰 flashStrikeT,那一拍的"必定暴扣"由 modifyShot 在真打时兑现,
    // 走位误差照样决定这一拍能不能碰到球 —— 代劳的是时机,不是判定。
    p.smashAutoT = 0;
    startSwing(p, ball, SM.autoAim);
  } else if ((p.rageAutoT ?? 0) > 0 && !p.isAI && RG.autoReturn && p.skill
    && p.skill.id === "rage" && p.skill.buffT > 0 && ball && Player.autoSwingDue(p, ball, "rage")) {
    // 怒气重击一键化(2026-10-04):按下之后到点替玩家把这一拍轰出去 —— 与跨步/重击**共用同一条**
    // autoSwingDue 择帧尺子(够不着/界外/将死/隔网/自家球一律不起手),只是门控数值各取一份 config。
    // 三条一键化永不并存(一场只有一个 skill.id,canActivate 互斥),这个次序只是把同一把尺子
    // 写成同一条链;新增第四条判据之前先问:能不能复用这三条。
    // 起手**当场清窗**(与 smashAutoT 同侧,与 lungeAutoT 相反):它不兼判定区开关。
    // 不加必中:不碰 flashStrikeT,强度由 modifyShot 在真打时按怒气比例兑现 —— 代劳的是时机,不是判定。
    p.rageAutoT = 0;
    startSwing(p, ball, RG.autoAim);
  } else if (AutoHit.on && !p.isAI && ball
    && (p.flashHoldT ?? 0) <= 0 && !ball.magnetPull
    && autoTryBudget(p, ball) && Player.autoSwingDue(p, ball, "auto")) {
    // 自动击打(辅助模式,2026-10-05):玩家不再惦记击球键,系统替他把每一拍打出去。
    // 排在整条链**最后**是有意的:三条一键化各自带着承诺(跨步的判定区尾段、重击的附魔、
    // 怒气的资源结算),它们永远优先于这条通用代劳;而它们上面那个手动分支更早 ——
    // 玩家一按击打键就当场起拍,自动这一支整条被 else-if 跳过 ⇒ 手动优先不需要新代码。
    //
    // AutoHit.on 排第一合取项:关掉时这条分支连 autoSwingDue 都不调用、一个字段都不写,
    // "关掉就是今天的逐帧行为"于是是可证的而不是靠读代码相信的(判据 auto-hit-check ⑥
    // 把 Player.autoSwingDue 换成计数壳,断言零调用)。autoTryBudget 排在择帧之前:先查便宜的门槛。
    //
    // 两个"技能已经欠着一拍"的状态必须先让路,理由与上面那个手动分支的 flashHoldT 闸同源:
    //   · flashHoldT > 0:闪现折跃后悬空蓄力,那一拍由技能状态机在蓄力结束时发出 ——
    //     自动再起一次拍就是两个人抢同一条时间线,人还定在半空,球自然打不到;
    //   · ball.magnetPull 非空:引力吸球正把球按在牵引轨迹上,rules 到位后 forced 回击那一拍
    //     (q=1.0)是技能承诺,自动在这里起拍会跟它抢,抢到的还是一记质量更低的球。
    // 三个不许碰的东西,碰一个就把这套机制做成作弊:
    //   · 不写 p.lungeAutoT —— 那字段兼着 strikeZone 的判定区尾段倍率(白送手长);
    //   · 不写 p.flashStrikeT —— 那是必中支,用户口径"借时机不借判定";
    //   · 不压 sweet/perfect —— 代劳的是帧,质量该多少是多少(用户明确选了"不打折")。
    // 起手给的是字符串 "mid"(与真人点按同一条路:pad.buildIntent 也是 "mid"),落点/弧线的
    // 玩家意图由下面 aimOverride 在**同一帧**覆盖上来 ⇒ 「击球键变纯瞄准键」零新增代码。
    // 但那份意图默认**借一拍**:这一拍真打出去后由收招处的 consumeAutoAim 当场恢复
    // (没锁回 mid;长滑锁定了就回锁向),想再改方向就得再滑一次
    // (用户 2026-10-05:「一次之后就重置为默认状态」)。
    startSwing(p, ball, AH.autoAim);
    p.swingAuto = true;                       // 来路:这一拍是系统起的(玩家抢的那拍不会被打标)
    p.autoTryRef = ball.shot;
    p.autoTries = (p.autoTries ?? 0) + 1;     // 每球限次:没有窗可清,只能自己数(见 C.autoHit.maxTriesPerBall)
    inp.onAutoSwing && inp.onAutoSwing(p, ball);  // 表现层读数(场边飘「自动」):只在真起手的这一帧
  }
  // 滑动手势覆盖落点与弧线:startSwing 设的初值在这里被玩家的实际意图盖掉。
  // 触屏那两个字段是**粘住不丢**的(pad.buildIntent 每步输出,press / resetPadHolds /
  // restoreSwingAim 都只是把它们恢复成锁值),所以自动那一拍继承的就是玩家欠着的那一次
  // 滑动方向;键盘路径在 press 时已定好 ±1,等价于立即覆盖。**默认这份意图只作用一拍** ——
  // 打出去那一拍的收招处 consumeAutoAim 把本步快照作废、pad 恢复成锁值(没锁 = 0):
  // 下一次还想改方向就得再滑一次(判据 ⑩)。触屏**长滑**(touchAim.lockPx)会把方向
  // 锁成默认(pad.swingLockX/Y),此后每一拍自动回锁向 —— 「管到取消」走的是同一条恢复路。
  if (p.swingT >= 0) {
    const o = aimOverride(p.swingAim, p.swingLoft, inp.swingSwipe, inp.swingSwipeY);
    p.swingAim = o.aim;
    p.swingLoft = o.loft;
  }
  if (p.swingBuf > 0) p.swingBuf -= focusTimeStep;
  if (p.recoverT > 0) p.recoverT -= focusTimeStep;
  if (p.hitLock > 0) p.hitLock--;
  if (p.contactFlash > 0) p.contactFlash--;
  if (p.smashGlow > 0) p.smashGlow--;
  if (p.sweetGlow > 0) p.sweetGlow--;
  if (p.perfectGlow > 0) p.perfectGlow--;
  if ((p.faceT ?? 0) > 0) p.faceT = (p.faceT as number) - 1;

  p.racketPrev = p.racket;
  p.racket = Physics.racketHead(p, p.swingT >= 0 ? p.swingT : 0, p.swingRadius);
}

/**
 * 挥拍判定区:以肩为圆心、略朝击球方向偏移的一个圆域。
 * 不用「拍头那个点」做判定 —— 羽毛球落地角 60~75°,几乎是垂直砸下来,
 * 拿弧线上的一个点去迎它,重合窗口只有一两帧,人根本按不到。
 * 拍头扫掠只作为视觉 + 额外补判(球真撞上拍头时一定算)。
 *
 * 判定区。普通来球给得很宽容(所以容易接到球),但球速越快区子越小 ——
 * 不然重杀也能随手捞起来,回合永远打不完。
 * AI 的 entryLead 用残缺探针(只有位置/朝向/半径)调用,所以这里收结构化子集;
 * 缺省字段的行为与原版 JS 完全一致(lungeT 未定义时视为不在跨步中)。
 */
export interface ZoneProbe {
  x: number; y: number; facing: number;
  swingRadius: number;
  zoneScale?: number;
  lungeT?: number;
  lungeDir?: number;
  /** 跨步自动回球待发窗剩余帧(只真人有;AI 的残缺探针不带 ⇒ `?? 0` 兜底,漏一处就是白给 CPU 手长) */
  lungeAutoT?: number;
  /** 时空领域剩余帧:领域里来球的**真实**接近速度只有 ballSlow 倍,判定区不该再按世界步速度收严 */
  focusT?: number;
}

function strikeZone(p: ZoneProbe, speed: number) {
  const rad = p.swingRadius;
  // 来球速度折算成玩家眼里看到的接近速度(px/真实帧):领域外 scale=1 逐字不变,
  // 领域内 12px/步的重杀在玩家眼里只有 4.2px/步 —— 球慢到能看清,判定区却照旧缩到 0.62,
  // 那是"子弹时间里球速惩罚照吃"的量纲错配(判据 focus-window-check ③)。
  const approach = worldToPlayerView(p, speed);
  const fast = clamp(((approach || 0) - C.swing.zoneFullSpeed) / C.swing.zoneTightenSpan, 0, 1);
  // 跨步救球:判定区扩大,延伸方向由跨步方向决定(缺省为面向方向)
  const isLunging = (p.lungeT ?? -1) >= 0;
  // 冲量那 6 帧吃满倍率;之后的「自动回球待发窗」吃一个较小的尾段 —— 球真正被打到通常在
  // 冲量结束之后(最佳按拍帧 ≈ 起手后第 9 帧),尾段一点不给,跨步"手变长"这个卖点就从来没
  // 作用在真正那一拍上(这是旧行为,不是疏忽:旧口径下玩家自己按,早过了就认了)。
  // 尾段只放大半径、**不改延伸方向**(仍是 facing):向后跨步时 lungeDir 与 facing 相反,
  // 让它撑满整窗会把身前的球判成"太靠背后"而拒接 —— 那是把机制做成副作用。
  const lungeMul = isLunging ? C.lunge.reachMul
    : ((p.lungeAutoT ?? 0) > 0 && C.lunge.autoReturn ? C.lunge.reachTailMul : 1);
  const reachDir = isLunging ? (p.lungeDir || p.facing) : p.facing;
  const extraReach = activePlayerModifier?.reachMul ?? 1;
  // 领域里拍头扫掠在世界时间里快 ballSlow 倍(一帧扫过的弧长是平时的 2.9 倍),判定区随之放宽:
  // 物理口径与跨步的 reachMul 同一条(拍头扫过更大的空间 ⇒ 更早/更偏的球也碰得到),
  // 而不是偷偷延长命中窗(那会让人物收完拍还把球打走)。只在领域内生效,领域外恒 1 ⇒ 逐字不变。
  const focusMul = inTimeDomain(p) ? (C.skills.focus.zoneReachMul ?? 1) : 1;
  const off = Physics.strikeOffset(rad, reachDir, lungeMul);
  return {
    x: p.x + off.dx,
    y: p.y + off.dy,
    r: (rad * 0.92 + SW.headR) * (p.zoneScale ?? 1) * lerp(1, C.swing.zoneFastMul, fast) * lungeMul * extraReach * focusMul,
  };
}

// 球在判定区内吗(返回 null = 不在;否则返回归一化的勉强程度 0=区心 1=边缘)
function ballInZone(p: ZoneProbe, ball: Ball): number | null {
  const z = strikeZone(p, Math.hypot(ball.vx || 0, ball.vy || 0));
  const isLunging = (p.lungeT ?? -1) >= 0;
  const effDir = isLunging ? (p.lungeDir || p.facing) : p.facing;
  const dx = (ball.x - z.x) * effDir, dy = ball.y - z.y;
  if (dx < -z.r * 0.34) return null;                       // 太靠背后,够不着
  const d = Math.hypot(dx, dy);
  return d <= z.r ? clamp(d / z.r, 0, 1) : null;
}

// ---------- 一键自动回球:替玩家按那一拍(跨步 2026-10-04 / 重击同日 / 全局自动 2026-10-05)----------
const autoPtsBuf: FuturePt[] = [];

/** 一帧前瞻的三份账(全部按「从现在数第几帧」计,0 = 此刻) */
interface BallFuture {
  /** 球进入自己半场那一帧(-1 = 前瞻窗口内一直不在自己半场) */
  cross: number;
  /** 落地那一帧(horizon+1 = 窗口内不落地) */
  land: number;
  /** 落地横向位置(与 rules 的出界判据同一条:x ∈ [CO.left, CO.right] 才算界内) */
  landX: number;
}

/**
 * 按真实积分往前看这条弧(含风与阻尼),一次扫描同时供"过没过网 / 会不会出界 / 来不来得及"三条判据。
 * 为什么必须往前看:来球多数还在网的另一侧(网前抢点尤其如此),而 tryHit 判的是**接触那一帧**
 * 球过没过网 —— 按下当帧就用 inOwnCourt 卡,等于给自动多加一条手动没有的限制。
 */
function ballFuture(p: PlayerEntity, ball: Ball, horizon: number): BallFuture {
  const pts = Physics.futureInto(ball, horizon, autoPtsBuf);
  const out: BallFuture = { cross: inOwnCourt(p, ball.x, ball.y) ? 0 : -1, land: horizon + 1, landX: ball.x };
  for (let i = 0; i < pts.length; i++) {
    const f = i + 1;
    if (out.cross < 0 && inOwnCourt(p, pts[i].x, pts[i].y)) out.cross = f;
    if (pts[i].y >= CO.groundY - 2) { out.land = f; out.landX = pts[i].x; break; }
  }
  return out;
}

/**
 * 代劳那一拍的来源。三条一键化(跨步 / 重击 / 怒气)+ 全局「自动击打」共用**同一把择帧尺子**,
 * 只有四个门控数值各取一份 config —— 分开四套逻辑迟早一边修好、另一边还在按早按晚。
 * 每加一个 src 都要去 rage-check ⑭ / smash-check ⑯ / auto-hit-check ⑨ 那条「四个门控数逐字相同」
 * 的判据看一眼:那四条数字一旦分叉,这条共用就不再是真的共用。
 * "auto" 与前三者的区别只在**没有 autoWindow**:它逐帧轮询,限次由 player 自己数(见 C.autoHit)。
 */
export type AutoSwingSrc = "lunge" | "smash" | "rage" | "auto";

/**
 * 「就是现在」判据:起手帧与时机环收满那一帧**同源** —— game-root.updateSwingCue 拿
 * flightFramesToClosest 算「还有几帧到判定区心」,给玩家的提示额外提前
 * swingCue.reactFrames(10 帧,补"看到→按下"的反应时间)。机器不吃反应,所以门槛就是
 * fc <= PRESS_LEAD_FRAMES 本身:按下后第 9 帧的质量峰,正好落在球过判定区心那一帧。
 * 领域内这两个量分属两个时钟,门槛经 playerFramesToWorld 折算(见 worldRate 头注)。
 * 够不着的球 flightFramesToClosest 返回 null(最近逼近仍超出判定半径)⇒ 绝不起手,
 * 不留"为了兑现机制而挥空"的幽灵拍。每帧重算,所以窗口里玩家改滑轨、风把球带偏,
 * 判读跟着走 —— 宁可晚一帧,不会按早。
 */
function autoSwingDue(p: PlayerEntity, ball: Ball | null, src: AutoSwingSrc = "lunge"): boolean {
  if (!ball || !ball.live || ball.held || ball.flying) return false;   // flying = 得分后球飞回手里
  if (ball.lastHitter === p.side) return false;                        // 自己刚打出去的那一拍
  if (p.hitLock > 0) return false;                                     // 双重击球锁还没解
  // 四份门控数值、一把尺子。这里的三元分支必须只读那四个 auto* 键 —— 四条一键化的判据
  // 一旦分叉,「共用」就成了假话,而它不会崩、只会让某个来源替玩家按早按晚。
  const LG = src === "smash" ? C.skills.smash : src === "rage" ? C.skills.rage
    : src === "auto" ? C.autoHit : C.lunge;
  const z = strikeZone(p, Math.hypot(ball.vx || 0, ball.vy || 0));
  // 两个前瞻预算是**世界步**数出来的,而球每一步只走 s 倍远 ⇒ 慢档里同一串帧看到的球
  // 更近,40/90 步盖不住"这球会飞到哪、会不会出界"。折成基准帧的等距离版本(Pace.frames = ÷s),
  // 否则一放慢球,代拍就从"看得见落点"退化成"看不见"—— 实测 s=0.80 时 64 格里 2 格
  // 完美手动救得到、代拍直接不起手(判据 auto-hit-check ⑦)。config 那四个数照旧逐字共用。
  // 向上取整:宁可多看一帧,别少看(Pace.frames 会给出 112.5 这种小数,前瞻缓冲按它开长度会炸)
  const lookH = Math.ceil(Pace.frames(LG.autoHorizon));
  const landH = Math.ceil(Pace.frames(LG.autoLandHorizon));
  const fc = flightFramesToClosest(ball, z.x, z.y, z.r, lookH);
  // ⚠ PRESS_LEAD_FRAMES 是**挥拍动画帧**(玩家侧真实时间),fc 数的是世界步:领域里挥拍按真实
  //   时间走、世界被拖慢到 0.35,不折算就是"机器在区心前 9 世界步起手、那一拍 3.1 步就走完峰"
  //   ⇒ 代拍在领域里系统性挥空(与玩家按时机环按挥空同一个根因,判据 focus-window-check ②)。
  const lead = playerFramesToWorld(p, PRESS_LEAD_FRAMES);
  if (fc === null || fc > lead) return false;
  const fut = ballFuture(p, ball, landH);
  // 隔网球:接触那一帧球必须在自己半场。判据放宽到"整条命中窗之内会过网",而不是"到最近逼近帧
  // 为止"—— 挥拍有 windup+active 十几帧的窗口,球在窗口里任何一帧过网都打得着(真过不了网的
  // tryHit 自己会拒)。按下当帧就卡 inOwnCourt 等于给自动多加一条手动没有的限制:网前抢点那
  // 一类球全被拒掉,而玩家自己按却打得着(实测差 9 格)。
  // 窗口两端都是**挥拍动画帧**,而 fut.* 数世界步 ⇒ 一律折算(领域里这条窗只有 5.6 世界步)。
  const swingWindow = playerFramesToWorld(p, SW.windup + SW.active);
  if (fut.cross < 0 || fut.cross > swingWindow) return false;
  if (fut.land <= landH) {
    // 要飞出边线的球:正确打法是让它落地、把这分收下。替玩家捞回去等于把到手的分还给人家。
    if (fut.landX < CO.left - LG.autoOutMargin || fut.landX > CO.right + LG.autoOutMargin) return false;
    // 挥拍最早也要起拍后第 windup+1 帧才可能接触:球已经在地上了,别空挥。
    if (fut.land <= playerFramesToWorld(p, SW.windup + 1)) return false;
    // 球活不到"结算"那一刻就别起手。峰值追账(见 tryHit 头注)只记账不出手,要等球**离开判定区**
    // 或走完窗才结算 —— 贴地快死球死在区里,这一拍永远结不出来:人物明明扫到球,分还是丢了,
    // 读起来就是"它替我挥了个空"。门槛实测取 2 帧(132 格可救来球):0 帧 → 27 格空挥、救到 90;
    // 2 帧 → 24 格空挥、救到 92;3 帧 → 20 格空挥但只救到 87。剩下的 24 格连完美手动也救不到。
    if (fut.land <= fc + LG.autoSettleGrace) return false;
  }
  return true;
}

// 命中判定:挥拍窗口内 + 球在判定区(或真撞上拍头)。
//
// 【结算帧 = 窗口内球离判定区心最近的那帧 —— 挥拍峰值追踪,2026-10-01】
// 旧口径是「球一碰判定区就先到先得」,质量取那一帧的挥拍相位。但球进区比球过心早
// r/v 帧(慢球约 7 帧),想踩甜蜜就得让「球进区第一帧」恰好落在按下后第 9 帧(质量峰),
// 而时机环教的按拍点锚在球心 —— 按环收满按 = 系统性早按,先到先得把这点偏差放大成
// qRaw 崩塌(慢球必出普通球)。玩家「明明按着光环来点,就是没触发」的根因在这。
// 现在窗口内只记账不结算:球离开判定区(之后距离只增不减)或挥拍窗走完时,按账上
// 最优帧出手 —— 按拍对准球心 → 结算帧 ≈ 质量峰帧 → qRaw 顶格;早/晚按的偏差直接进
// qualityAt,不再被进区帧摊薄。闪现保底不走追踪:技能承诺「必中即时」,当场出手。
function tryHit(p: PlayerEntity, ball: Ball): ShotResult | null {
  // 领域内 swingT 每世界步跳 swingClockScale(≈2.86)下,窗口上沿写成"≤ 17"的话,
  // 越过上沿的那一步(17.14)会被这里的早退整帧吃掉 ⇒ 下面那条"窗尾按账结算"永远轮不到,
  // 球明明在判定区里待了整个窗,最后一拍还是记成挥空。这是"很难击中球"的第二刀。
  // 只给**非整数步进**容一个越界帧(领域外 tail=0,与旧写法逐字等价):实测把 tail 摊给平时
  // 会让第 18 帧偶尔用陈账出手,落点从旧账的球位重启 ⇒ lunge-check ⑧ 的落点判据 2/10 变红。
  const step = swingClockScale(p);
  const tail = step > 1 ? step : 0;
  if (p.swingT < SW.windup || p.swingT > SW.windup + SW.active + tail) return null;
  if (p.swingHit || p.hitLock > 0) return null;
  if (!ball.live || ball.held) return null;
  if (!inOwnCourt(p, ball.x, ball.y)) return null;         // 不能越过网去够(含网口球头/高球抢网容差)
  if (ball.lastHitter === p.side) return null;             // 同队一回合只许击球一次

  const guar = (p.flashStrikeT ?? 0) > 0;
  const edge = guar ? 0 : ballInZone(p, ball);
  const headR = C.swing.headR + C.shuttle.radius;
  const headHit = guar ? false : sweptHit(p.racketPrev.x, p.racketPrev.y, p.racket.x, p.racket.y,
    ball.px, ball.py, ball.x, ball.y, headR);
  const atEdge = edge !== null || headHit;
  const windowEnd = p.swingT >= SW.windup + SW.active;
  // 上沿那一帧(swingT 恰好 = windup+active)仍按窗内处理(旧口径);**越过**上沿的那一步
  // (领域里 14.29 → 17.14)只许结算、不许再记新接触 —— 否则等于把命中窗拖长,
  // 人物收完拍还能把球打走,而那是玩家看得见的谎。
  const pastWindow = p.swingT > SW.windup + SW.active;

  if (guar && atEdge) {
    // 保底那一下按 guaranteedQ 上报质量:踩没踩准不由玩家负责,反馈档级直接给到顶。
    // strikeHold 把球按在半空等着,再等「更好的帧」违背必中承诺 → 当场出手
    const gq = Math.max(qualityAt(p.swingT), C.skills.flash.guaranteedQ);
    return settle(p, ball, {
      q: gq, qRaw: gq, dEdge: 0, dRaw: 0,
      bx: ball.x, by: ball.y, bpx: ball.px, bpy: ball.py, swingT: p.swingT,
    });
  }
  if (atEdge && !pastWindow) {
    // 记账:这一帧若是目前最佳接触(综合质量最高)就存下,先不出手
    const qRaw = qualityAt(p.swingT);
    const dEdge = headHit ? Math.min(edge ?? 1, 0.35) : edge as number;
    const q = clamp(qRaw - dEdge * 0.28, 0, 1);
    if (!p.swingBest || q > p.swingBest.q) {
      p.swingBest = { q, qRaw, dEdge, dRaw: edge ?? 2, bx: ball.x, by: ball.y, bpx: ball.px, bpy: ball.py, swingT: p.swingT };
    }
  } else if (p.swingBest) {
    return settleBest(p, ball);              // 球已离开判定区 → 账上那帧就是最佳接触
  }
  // 球仍在区内但已从最佳接触点折返远去 → 后面只会有更差的帧,当场出手。
  // 比较用未封顶的 dRaw:拍头扫掠那笔的 dEdge 封在 0.35,拿它比会把正在接近的球
  // 误判成远去,峰还没到就出手。也不能只等「出区/窗尾」:陡坠的重杀从区顶砸到地
  // 都出不了圆(圆底在地面以下),等到落地球都死透了 —— 按准了却接不到杀,更冤。
  if (p.swingBest && edge !== null && edge > p.swingBest.dRaw) {
    return settleBest(p, ball);
  }
  if (windowEnd && p.swingBest) {
    return settleBest(p, ball);              // 慢球/大判定区:球到窗尾都没出区,按账上最优出手
  }
  return null;
}

function settleBest(p: PlayerEntity, ball: Ball): ShotResult | null {
  const best = p.swingBest as SwingBestShot | null;
  return best ? settle(p, ball, best) : null;
}

// 按峰值追踪的记账快照出手:弹道从「最佳接触帧」的球位起,挥拍相位也取那一帧 ——
// 结算晚 1~3 帧只影响出手时机,不影响质量口径(质量的账在记账帧已经定死)。
function settle(p: PlayerEntity, ball: Ball, best: SwingBestShot): ShotResult {
  const dEdge = best.dEdge;
  const qRaw = best.qRaw;
  const q = clamp(qRaw - dEdge * 0.28, 0, 1);
  const sweet = qRaw >= 1 - C.sweet.coreRatio;
  const perfect = qRaw >= 1 - C.perfect.coreRatio;

  p.swingBest = null;
  p.swingHit = true;
  p.swingQ = q;
  p.hitLock = SW.doubleHitLock;
  p.contactFlash = 8;
  p.stats.hits++;
  // 甜蜜/完美统计**按物理质量**记,与后面 ShotResult 上报的档位是两本账:
  // 技能钩子(modifyShot)会把 opt.sweet/perfect 抬到顶档去兑现反馈分级,
  // 但那是"这一拍有多凶",不是"这一拍按得多准" —— 别把 buff 折进统计,否则三星判据与
  // 命中率报表会被技能洗白,连击热手(下面 heat)也跟着虚涨。
  if (sweet) {
    p.stats.sweets++;
    p.sweetGlow = 12;
  }
  if (perfect) {
    p.stats.perfects++;
    p.perfectGlow = 14;
  }

  // 连击热手:连续 sweet/perfect 累积热度(断一拍立刻清零)。
  // 传给 buildShot 的是命中「前」的热度 —— 第一拍好球不白给,连到第二拍才开始涨凶。
  const hot = sweet || perfect;
  const heatBefore = p.heat;
  p.heat = hot ? Math.min(heatBefore + 1, C.heat.maxStreak) : 0;

  const lungeShot = p.lungeShotT > 0;
  // 跳杀:空中 + 击球点够高 = 必然扣杀并加力(真人与 AI 同一通道;闪现折跃天然满足)。
  // 击球点高度取记账帧的球位(结算晚 1~3 帧,球已被打出去,当帧位置不再是击球点)。
  // 注意:若输入为 near(左滑短球),意图是起跳收力点杀/劈吊,不转扣杀。
  const isNear = typeof p.swingAim === "string" ? p.swingAim === "near" : (typeof p.swingAim === "number" && p.swingAim < C.shotClass.netDepth);
  const jumpSmash = !p.onGround && (CO.groundY - best.by) >= C.jumpSmash.minHeight && !isNear;
  // 出手瞬间把球钉回记账帧的接触点:结算比记账晚 1~2 帧,球又飞/坠了一段,而弹道是
  // 按接触点解的 —— 从当帧位置起飞整段偏移(下坠中的慢球尤其明显:低 20px 起飞 = 下网)。
  // px/py 一并回到记账帧的上一帧位,渲染插值/拍头扫掠看到的仍是「飞向接触点」的那一段。
  ball.px = best.bpx; ball.py = best.bpy;
  ball.x = best.bx; ball.y = best.by;
  const shot = buildShot(p, ball, { q, sweet, perfect, dEdge, heat: hot ? heatBefore : 0, lungeShot, jumpSmash });
  // 怒气重击:攒怒气。放这里而不是放 modifyShot,有三个理由,每个都对应一种"不会崩的坏法":
  // ① 本函数每记**真实接触**恰好走一次(上面 stats.hits++ 就是同一把尺子);而 modifyShot
  //    被球种预告(player.previewKind)每个真实帧最多跑 10 次 —— 增益写那儿等于按帧速自灌。
  // ② 发球不经这里(rules.ts 的发球直接 buildShot),所以发球不涨怒气。这是设计后果,
  //    不是漏写:用户口径「在击打过程去积攒」。一整局约 6 记发球若都算,白送 30 点(近半管)。
  // ③ 只喂**物理档**那两个局部量(sweet/perfect 来自 qRaw),不喂 shot.sweet/perfect ——
  //    后者被技能钩子抬到顶档了。喂错就等于「满怒那一拍自己给自己充能」,与上面
  //    stats.sweets 那条「别把 buff 折进统计」是同一条规矩。判据 rage-check ②⑤。
  // 释放那一拍整口不攒(skillKind === "rage"):怒气已在 modifyShot 里清零,再补一笔就读成"没清干净"。
  if (shot.skillKind !== "rage") {
    Skills.gainRage(p, { sweet, perfect, smash: shot.kind === "smash" });
  }
  // 球体接触瞬间形变:按档位设压扁比
  ball.sqPrev = ball.sq;
  ball.sq = (shot.kind === "smash")
    ? (C.fx.ballSquashSmash || 0.55)
    : (sweet || perfect)
    ? (C.fx.ballSquashSweet || 0.65)
    : (C.fx.ballSquashNormal || 0.75);
  // 击球身体后仰:扣杀最明显,给"物理反作用力"的重量感
  p.hitRecoil = (shot.kind === "smash")
    ? (C.fx.recoilSmash || 6)
    : (C.fx.recoilNormal || 3);
  // 时机教学:真人恒上报带符号时机档(0=正中,负=早,正=晚),量化时机条每拍都画;
  // 没踩进甜蜜窗时再给「早了/晚了」文字提示 —— 踩准了就不打扰。
  // 语义 = 挥拍质量峰(按下后第 PRESS_LEAD_FRAMES 帧)相对结算帧(球过判定区心)的偏差:
  // 结算帧在峰后 = 按早了(球到心时挥拍已经收力),在峰前 = 按晚了。
  if (!p.isAI) {
    const half = SW.active / 2;
    shot.timingGrade = clamp((PRESS_LEAD_FRAMES - best.swingT) / half, -1, 1);
    if (!sweet) {
      shot.timingHint = shot.timingGrade < 0 ? "early" : "late";
    }
  }
  // 来路标记:这一拍是「自动击打」替玩家起的 ⇒ 表现层把早/晚教学闭嘴。
  // 上面那两行照写不省:它们是数据(auto-hit-check ⑦ 拿 q/早晚做对照),不是演出;
  // 抑制只发生在读侧(game-root),所以玩家自己点回去的那拍、以及三条技能一键化照常用。
  if (p.swingAuto) shot.autoHit = true;
  if (shot.kind === "smash") {
    p.smashGlow = 10;
  }
  if (activePlayerModifier?.iaiStrike && qRaw >= 0.94) {
    shot.iaiStrike = true;
    shot.vx *= 1.35;
    shot.vy *= 0.75;
  }
  if (activePlayerModifier?.zenFocus) {
    if (sweet || perfect) {
      p.zenMeter = (p.zenMeter ?? 0) + 1;
      if (p.zenMeter >= 2) {
        p.focusT = 180;
        p.zenMeter = 0;
      }
    }
  }
  return shot;
}

// 由瞄准 + 击球点高度 + 击球质量解出这一拍
function buildShot(p: PlayerEntity, ball: Ball, opt: HitOpt = {}): ShotResult {
  // 技能钩子必须排在解构**之前**:modifyShot 会改写 opt.sweet/perfect/q。
  // 旧写法是先解构常量再调钩子(2026-10-03 前),那三个写入全成死值 —— err 不清零、
  // perfectBoost/perfect.powerDeg 不生效,ShotResult 还按旧档上报,于是「下次挥击必定暴扣」
  // 的技能永远拿不到顶档反馈(晚按 9 帧的附魔拍实测 q=0.30、8 次同参 8 个落点)。
  // 钩子只读球员状态 + opt.lungeShot/opt.q,不依赖误差计算,前置安全。
  const sm = Skills.modifyShot(p, opt);
  // 瞄准读数从哪儿来:实打读球员身上的 p.swingAim / p.swingLoft(由 update 的 aimOverride
  // 每步覆盖);球种预告可以把「还没起拍的玩家意图」(击球键上粘住的那次滑动)当 hint 传进来,
  // 于是自动击打开起来后徽标报的是**下一拍会往哪儿打**,而不是上一拍的旧落点。
  // 两条都过同一个 aimOverride,分叉不了;不给 hint 时逐字等于旧行为(实打路径零改动)。
  const swingAim = opt.aimHint ? opt.aimHint.aim : p.swingAim;
  const swingLoft = opt.aimHint ? opt.aimHint.loft : p.swingLoft;
  const q = opt.q ?? 0.5, sweet = !!opt.sweet, perfect = !!opt.perfect, dEdge = opt.dEdge ?? 0;
  const dir = p.side === "left" ? 1 : -1;
  const h = CO.groundY - ball.y;
  const rawAim = opt.forced ? opt.forced.depth : depthOf(swingAim);
  // 网前高球自适应扑推:
  // 当击球点在网前近网处(离网 <= 35px)且高出网顶(y <= netTopY - 15),若玩家未明确指定打深球(默认 mid 档),
  // 意图倾向于前场扑杀/下切推压(depth=0.32),打出干脆利落的前场扑球,避免反解成后场慢平高球。
  // 纵向手势(swingLoft ≠ 0)是明确的弧线意图,优先于自动扑推:上滑在网前照样挑高过渡。
  const isNetHigh = Math.abs(ball.x - CO.netX) <= 35 && ball.y <= CO.netTopY - 15;
  const aim = (isNetHigh && swingAim === "mid" && !opt.forced && swingLoft === 0) ? 0.32 : rawAim;

  let err = C.aimErr.base + dEdge * C.aimErr.edge;
  if (Math.abs(p.vx) > 2.4) err += C.aimErr.moving;
  if (!p.onGround) err += C.aimErr.airborne;
  if (perfect) err = 0;                     // 完美击球:瞄哪打哪(最高技艺换确定性)
  else if (sweet) err *= C.sweet.errBonus;
  err += p.aiAimErr || 0;
  const depth = Math.max(0, aim + (Math.random() * 2 - 1) * err / SPAN);

  // 力量兑现:踩得准 → 弧度额外压平 + 初速上限放宽,求解器自动用更快的初速
  // 补同一个落点 → 球更凶、到得更早。低击球点会被「安全过网角」兜底抬回来,不会乱下网。
  // 连击热手在同一预算上再加余量,但总 boost 封在物理上限的差额里(25→30),
  // 不与 shuttle.maxSpeed 冲突。
  // 技能与连击热手加成统一在此汇聚
  const lungeShot = !!opt.lungeShot;
  const heatBoost = Math.min((opt.heat || 0) * C.heat.speedBonus, C.heat.speedBonusMax);
  const jm = !!opt.jumpSmash;
  const boost = Math.min(
    (perfect ? C.shot.perfectBoost : sweet ? C.shot.sweetBoost : 0) + heatBoost
      + sm.speedBoost + (jm ? C.jumpSmash.speedBoost : 0),
    C.shuttle.maxSpeed - C.shot.speedMax);
  let powerDeg = (perfect ? C.perfect.powerDeg : sweet ? C.sweet.powerDeg : 0)
    + sm.powerDeg;
  // 跳杀:空中高球必然扣杀 —— 弧度先夹到压弧上限(力度已并入上方 boost 预算)
  if (jm) {
    powerDeg += C.jumpSmash.powerDeg;
  }
  let loft = clamp(Physics.loftFor(depth, h, q) - powerDeg, C.shot.loftMinDeg, C.shot.loftMaxDeg);
  // 纵向手势(击球键上滑/下滑)的弧线意图:两轴组合瞄准的「高低」维度。
  // 与跳杀的压平分支互为镜像(一个下托地板、一个压低天花板)。发球(forced)有自己的
  // 弧线编排(serve.loftDelta),不吃手势;跳杀/必杀压平排在其后 —— 空中那一拍永远是
  // 扣杀,上滑不能把跳杀改成挑高。压平过不了网由 safeAngle 兜底抬回,不会自杀下网。
  if (!opt.forced && swingLoft > 0) {
    loft = Math.max(loft, C.shot.loftUpMinDeg);
  } else if (!opt.forced && swingLoft < 0) {
    loft = Math.min(loft, C.shot.loftDownMaxDeg);
  }
  if (jm) {
    loft = Math.min(loft, C.jumpSmash.maxLoftDeg);
  }
  if (sm.forceSmash) {
    loft = Math.min(loft, 10);
  }

  const shot = Physics.solveShot(ball.x, ball.y, dir, depth, loft, boost);
  if (sm.forceSmash || jm) {
    shot.kind = "smash";
  }
  if (shot.kind === "smash" && !opt.preview) p.stats.smashes++;
  return {
    kind: shot.kind, q, sweet, perfect,
    // 报「真正打出去的深度」而不是瞄的那个数:求解器可能把落点往场内收过
    depth: shot.depth,
    vx: shot.vx, vy: shot.vy, power: shot.speed, deg: shot.deg,
    landX: shot.trace.landX, steps: shot.trace.steps,
    intoNet: shot.trace.hitNet,
    contactX: ball.x, contactY: ball.y,
    hitter: p,
    heat: p.heat,
    lungeShot,
    jumpSmash: jm,
    // 瞄准档位只在字符串瞄准(真人路径 mid/deep/near)时有意义;AI 直接给数值深度,不上报
    aim: typeof swingAim === "string" ? swingAim : undefined,
    skillKind: sm.skillKind,
    // 「怒气重击」兑现那一刻的怒气比例快照。怒气在下面 modifyShot 里已经清零,
    // 表现层(game-root 排空事件时)再读 p.rage 恒为 0 ⇒ 四档演出全被打成最低档。
    // 判据 rage-check ③:这一栏不上报,分档就只在核心层生效、玩家看不见。
    rageRatio: sm.rageRatio,
    // 三星判据用的出手瞬间状态:空中占比 / 极滑滑行(极滑关 frictionMul<0.5 且速度够快)
    airborne: !p.onGround,
    sliding: (activePlayerModifier?.frictionMul ?? 1) < 0.5 && Math.abs(p.vx) >= C.star.slideSpeed,
  };
}

/**
 * 球种预告:按真实 buildShot 通道预演「这一拍打出去是什么球种」,给击球键上方的徽标用。
 * 用甜蜜点下限当基准质量(预告回答的是「踩准了会打出什么」),落点误差的随机项仍在 ——
 * 预告与实打共用同一条代码路径,config 怎么改都不会出现「徽标一套判定、实球另一套」。
 * 跳杀成因前置:空中 + 高球直接报扣杀,不等求解器反推。
 * **preview: true 是这条通道的安全带**:buildShot 里的技能钩子会消耗 buff,而本函数
 * 每个真实帧(按 ≤10 帧节流)跑一次。旧写法没有它 —— 按下重击后的第一记预告就把附魔
 * 清零,玩家看到「按了没反应、下一拍还是普通球」还白付冷却(判据 tools/smash-check.ts)。
 *
 * `pending`(击球键上那次还没用掉的滑动)走 aimOverride 折成 aimHint 传进同一条解算:
 * 基准由 previewBase 取 —— 自动击打开着且人不在挥拍中时,下一拍由系统起手,基准就是代拍
 * 那个种子(autoAim),而不是 p.swingAim 上停着的上一拍。滑动改成"只管一拍"之后,不取种子
 * 就会一直报上一拍的落点(徽标撒谎,而这正是"我滑了到底有没有用"唯一的读数)。手动模式下
 * 逐字等于旧写法,而实打路径不经过这里 ⇒ 弹道一个数都不动。
 */
function previewKind(p: PlayerEntity, ball: Ball, pending?: {
  swipe: number | null | undefined; swipeY: number | null | undefined;
}): ShotResult["kind"] {
  const base = Player.previewBase(p);
  const hint = pending
    ? aimOverride(base.aim, base.loft, pending.swipe, pending.swipeY)
    : undefined;
  const aim = hint ? hint.aim : base.aim;
  const isNear = typeof aim === "string" ? aim === "near" : false;
  if (!p.onGround && (CO.groundY - ball.y) >= C.jumpSmash.minHeight) {
    if (isNear) return "slash";
    return "smash";
  }
  const q = 1 - C.sweet.coreRatio;
  return buildShot(p, ball, { q, sweet: true, dEdge: 0, heat: 0, preview: true, aimHint: hint }).kind;
}

// `autoSwingDue`/`ballFuture` 挂上导出面不是巧合:上面的 update 走的是 `Player.autoSwingDue(...)`
// 这一条对象调用,tools/lunge-check.ts 的 --selftest 才能把它换成反例(与 Skills.modifyShot
// 被 player.ts 按对象调用同一个道理 —— 直接闭包调用是换不掉的,那套反例就没牙齿)。
// `aimOverride` 一起挂上:auto-hit-check 要拿它单验「预告与实打同一份算术」。
// `previewBase`/`consumeAutoAim` 同样**必须走对象调用**而不是本地符号:update 与 previewKind
// 里那两处是自动击打的两个判定点(徽标基准 / 一次滑动只管一拍),直接闭包调用就把它们焊死,
// auto-hit-check ⑩ 的反例(旧式基准、消耗一切、从不消耗、不看 AutoHit.on)就换不上去 ——
// 换不上反例的闸门等于没牙齿。
export const Player = { create, update, tryHit, buildShot, previewKind, previewBase, consumeAutoAim, depthOf, aimOverride, strikeZone, ballInZone, autoSwingDue, ballFuture, spawnShadowClone, setPlayerModifier, getPlayerModifier, worldRate, swingClockScale, playerFramesToWorld, worldToPlayerView, swingCuePressFrames, inTimeDomain };
