// ============================================================
// 「自动击打(辅助模式)」回归。
//
// 背景(用户需求):「帮我做一个自动击打功能,玩家的人物会自动击打羽毛球,
// 打开后玩家就只用移动方向和释放技能;设置里加个开关。」
// 机制复用已经上线的择帧尺子 Player.autoSwingDue(src = "auto"),与跨步/重击/怒气
// 三条一键化同一把尺;差别只在**没有窗** —— 它逐帧轮询,所以限次得自己数。
//
// 这条承诺的坏法全都不会崩、不会报错、tsc 也不报,只会安静地变成另一种游戏:
//   ① 起了拍不兑现(对着够不着/界外/将死的球挥) → 比手动更糟,还白送一分。判据:必兑现 + 沉默必归因
//   ② 把发球也代了 → 发球类型是「按下快慢」的手艺(偷后场 <22 / 高远 >65),一替代整套发球博弈就没了,
//      而且 serve-check 的真人替身是按脚本蓄力的,量不到这条。判据:SERVE 态 120 帧一次都不许起拍
//   ③ 白送手长 → 分支要是顺手写了 lungeAutoT,就吃到判定区尾段倍率,「够不着」这一类失误被抹掉,
//      ai-check/reach-check 那两把尺子的前提(真人靠自己跑位)当场失效。判据:每个起手帧核半径
//   ④ 抢玩家自己那一拍 → 「我按了击打怎么又挥一下」。判据:手动优先,整段只起一次拍
//   ⑤ 训练场/教学/本地对战也代打 → 那两处判的就是"你会不会这一拍",被代打等于把判据糊过去
//   ⑥ 关掉不干净 → 今天所有替人跑的工具(serve-check / ai-check / sim-check)基线全漂
//   ⑦ 偷偷加强度 → 用户口径是"不打折":借时机不借判定,走位差/贴墙/来球快照样打坏
//   ⑧ 同一球连挥 → flightFramesToClosest 从第 0 帧起扫,球已在区心时 fc = 0 当即"该按",
//      不限次就是 smashAutoT 注释警告过的「人物自己乱挥半天」
//   ⑨ 门控数值分叉 → 「四条一键化共用一把尺子」变成假话,而它只会让某个来源按早按晚
//   ⑩ 瞄准锁死 → 用户 2026-10-05 的现场:「通过滑动控制方向…一次之后就重置为默认状态,
//      不要滑动之后就进入那个锁定状态了」。同一条承诺还有五种静默坏法:挥空也吞瞄准(白罚)、
//      关掉不干净(手动老玩家的手感被改)、CPU 打一拍吃掉真人的瞄准(hooks 是共用对象)、
//      收招同帧被续拍再吃一次(inp 是本步快照,清 pad 清不到它)、徽标停在上一拍(读数撒谎)、
//      键名「自动」被透明度滑杆抹掉(看不见的控件就是 bug)。判据 ⑩a~⑩h + 七份反例。
//
// 另外钉一条与手感直接相关的:球种预告徽标必须与代拍同一份瞄准算术(aimOverride),
// 否则自动模式下玩家再也不会起拍,徽标就永远停在上一拍的落点 —— 撒谎的读数比没有读数更坏。
// (⑩f 之前这条只写在 header 里、aimOverride import 了却一次没用过,现在真有判据了)
//
// 用法:node .tools-build/tools/auto-hit-check.js [--selftest]
// ============================================================
import { Rules } from "../assets/scripts/core/rules";
import { Player as Pl, aimOverride, PRESS_LEAD_FRAMES, ZoneProbe } from "../assets/scripts/core/player";
import { Skills } from "../assets/scripts/core/skills";
import { CFG } from "../assets/scripts/core/config";
import { Pace } from "../assets/scripts/core/pace";
import { AutoHit } from "../assets/scripts/core/auto-hit";
import { AI } from "../assets/scripts/core/ai";
import { flightFramesToClosest, Physics } from "../assets/scripts/core/physics";
import { newPad, buildIntent, restoreSwingAim, clearEdges, tickHolds, press, type Pad } from "../assets/scripts/input/pad";
import { alphaFloor } from "../assets/scripts/input/pad-cd";
import { Ball, PlayerInput, TeamSide, Player as PlayerEntity } from "../assets/scripts/core/types";
import { makeChecker, Checker } from "./harness";

const C = CFG;
const CO = C.court, AH = C.autoHit, SW = C.swing;
/** 真人替身"零反应延迟"的完美按拍帧 = 机制用的同一把尺子 */
const PERFECT_LEAD = SW.windup + 0.5 + (SW.active - 1) / 2;

const emptyInput = (): PlayerInput => ({
  left: false, right: false, jumpPressed: false, jumpHeld: false,
  swingAim: null, lungePressed: false,
});

/** 站位镜像:左队坐标 ↔ 右队坐标(场地关于 netX 对称) */
const mirror = (x: number): number => CO.netX * 2 - x;

// ---------- 确定性:buildShot 的落点误差吃 Math.random ----------
// 同一格"自动 vs 完美手动"要比 q,不锁随机就是拿噪声当结论(lunge-check 只能靠容差兜)。
// 这里每次 run 前重置同一条 LCG,两条路径吃到同样的前几个随机数,比较才有意义。
const realRandom = Math.random;
function seedRandom(seed: number): void {
  let s = seed | 0;
  Math.random = (): number => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 8) & 0xffffff) / 0x1000000;
  };
}
const unseed = (): void => { Math.random = realRandom; };

/**
 * 摆成「来球正朝 hero 那侧半场飞」。
 * mode 只影响自动击打的门控(newMatch 会顺手把 AutoHit 的模式报进去,⑤ 靠这个入口验集成)。
 */
function setup(side: TeamSide, h: number, x: number, vx: number, vy: number, mode = "1p"): { hero: PlayerEntity; ball: Ball } {
  Rules.newMatch(mode as "1p", "normal");
  const R = Rules.R;
  const hero = R.players[side === "left" ? 0 : 1];
  hero.skill = Skills.initSkillState("lunge");
  Skills.resetPoint(hero);
  hero.x = side === "left" ? CO.netX - 175 : CO.netX + 175;
  hero.y = CO.groundY; hero.vx = 0; hero.vy = 0; hero.onGround = true;
  hero.stats.whiffs = 0; hero.stats.hits = 0;
  hero.autoTries = undefined; hero.autoTryRef = undefined; hero.swingAuto = false;

  const ball = R.ball as Ball;
  ball.x = x; ball.y = CO.groundY - h;
  ball.px = ball.x; ball.py = ball.y;
  ball.vx = side === "left" ? -Math.abs(vx) : Math.abs(vx);
  ball.vy = vy;
  ball.live = true; ball.held = false; ball.owner = null;
  ball.flying = false; ball.flyT = 0;
  ball.lastHitter = side === "left" ? "right" : "left";
  ball.crossed = true; ball.netted = false; ball.shot = null;
  R.state = "RALLY";
  R.timer = 0; R.serveWait = 0;
  R.events.length = 0;
  // 另一半场默认是 CPU:它自己会按键,不在这里当"人"的话半边网格的沉默全是假的
  hero.isAI = false;
  return { hero, ball };
}

interface Cast {
  hit: boolean;
  kind: string | null;
  q: number;
  aim: string | undefined;
  intoNet: boolean;
  landX: number;
  /** 这一拍是不是系统替玩家起的手(ShotResult.autoHit 走事件带上来的) */
  autoHit: boolean;
  /** 系统代起的拍数(数"乱挥"用) */
  autoSwings: number;
  /** 每一次代拍起手的帧号(④ 要拿它当"玩家在该帧抢拍"的靶子) */
  autoSwingFrames: number[];
  /** 整段起拍的总次数(含玩家自己按的) */
  swings: number;
  whiffs: number;
  /** 每个自动起手帧的"判定区半径 as-is / 强制 lungeAutoT=0" 对照,③ 用 */
  zonePairs: Array<[number, number]>;
  /** 起手帧上 lungeAutoT 的值,③ 用(必须恒 0) */
  lungeAutoAtSwing: number[];
  /** 沉默到最后一帧的归因(① 用) */
  why: string;
}

const blank = (): Cast => ({
  hit: false, kind: null, q: 0, aim: undefined, intoNet: false, landX: 0, autoHit: false,
  autoSwings: 0, autoSwingFrames: [], swings: 0, whiffs: 0, zonePairs: [], lungeAutoAtSwing: [], why: "",
});

/** 每一帧决定 hero 按什么(自动模式下恒空着 —— 要验收的就是"没人按也打得出去") */
type Plan = (f: number, hero: PlayerEntity, ball: Ball) => Partial<PlayerInput>;

interface RunOpts {
  maxFrames?: number;
  seed?: number;
  /** 传给 newMatch 的模式;AutoHit 的门控就是在这里被 rules 报进来的(⑤ 靠它做真集成) */
  mode?: string;
  /** 挥空了是否立刻收工。④(b) 要跑完整个回合:看系统会不会把玩家挥空那一球接着救回来 */
  stopOnWhiff?: boolean;
}

/** 前瞻门控与 player.autoSwingDue **同一把尺子**:那两个数是基准帧,慢档里要折成世界步。
 *  这里再抄一份"不折"的版本,量出来的沉默理由就是假的(2026-10-05 球速档改慢后现场)。 */
const lookFrames = (n: number): number => Math.ceil(Pace.frames(n));

const framesToCentre = (hero: PlayerEntity, ball: Ball): number | null => {
  const z = Pl.strikeZone(hero, Math.hypot(ball.vx, ball.vy));
  return flightFramesToClosest(ball, z.x, z.y, z.r, lookFrames(AH.autoHorizon));
};

/** 把探针里的 lungeAutoT 强制清零,量"没有尾段倍率时该有多大" */
const zoneWithoutTail = (hero: PlayerEntity, ball: Ball): number => {
  const probe: ZoneProbe = {
    x: hero.x, y: hero.y, facing: hero.facing, swingRadius: hero.swingRadius,
    zoneScale: hero.zoneScale, lungeT: hero.lungeT, lungeDir: hero.lungeDir, lungeAutoT: 0,
  };
  return Pl.strikeZone(probe, Math.hypot(ball.vx, ball.vy)).r;
};

/**
 * 跑"只有这一拍"的一小局:走完整 Rules.step,帧序与真机一致
 * (Pl.update → Physics.step → Pl.tryHit),所以量的是真实相位而不是我以为的相位。
 */
function run(side: TeamSide, h: number, x: number, vx: number, vy: number, plan: Plan, opts: RunOpts = {}): Cast {
  const maxFrames = opts.maxFrames ?? 90;
  const seed = opts.seed ?? 7;
  seedRandom(seed);
  const R = Rules.R;
  const { hero, ball } = setup(side, h, x, vx, vy, opts.mode ?? "1p");
  const acc = blank();
  let prev = false;
  try {
    for (let f = 0; f < maxFrames; f++) {
      R.events.length = 0;
      const mine = plan(f, hero, ball);
      Rules.step(R.players.map((p) => (p === hero ? { ...emptyInput(), ...mine } : emptyInput())));
      const swinging = hero.swingT >= 0;
      if (swinging && !prev) {
        acc.swings++;
        // 起手那一帧的现场:来路 + 判定区半径对照(③ 的账必须记在起手帧,晚一帧人就动了)
        if (hero.swingAuto) {
          acc.autoSwings++;
          acc.autoSwingFrames.push(f);
          acc.lungeAutoAtSwing.push(hero.lungeAutoT ?? 0);
          acc.zonePairs.push([Pl.strikeZone(hero, Math.hypot(ball.vx, ball.vy)).r, zoneWithoutTail(hero, ball)]);
        }
      }
      prev = swinging;
      const e = R.events.find((ev) => ev.t === "hit" && ev.side === hero.side);
      if (e) {
        return {
          ...acc, hit: true, kind: e.kind as string, q: e.q as number, aim: e.aim as string | undefined,
          intoNet: !!e.intoNet, landX: e.landX as number, autoHit: !!e.autoHit,
          whiffs: hero.stats.whiffs,
        };
      }
      if (R.state !== "RALLY") break;
      // 这一发来球已经结束(落地/得分/球被收回手里准备发球)—— 必须立刻收工。
      // 少这一条,loop 会穿过 beginPoint 跑到**下一拍**去,把对手发的球、甚至下一次命中
      // 记成"这一格接住了",量出来的"自动不如手动"全是假账(实测:h=18 贴地格第 2 帧
      // 抓到的是下一分的发球命中,q=0.00)。
      if (!ball.live || ball.held || ball.flying) break;
      if (hero.stats.whiffs > 0 && (opts.stopOnWhiff ?? true)) break;
    }
  } finally {
    unseed();
  }
  return { ...acc, whiffs: hero.stats.whiffs };
}

/** 零输入纯自动:这一格系统会不会出手 */
const auto = (side: TeamSide, h: number, x: number, vx: number, vy: number, o: RunOpts = {}): Cast =>
  run(side, h, x, vx, vy, () => ({}), o);

/** 零反应延迟的完美手动:上限对照(与自动吃同一条尺子、同一个随机种子) */
const perfect = (side: TeamSide, h: number, x: number, vx: number, vy: number): Cast => {
  let done = false;
  return run(side, h, x, vx, vy, (f, hero, ball) => {
    if (!done) {
      const fc = framesToCentre(hero, ball);
      if (fc !== null && fc <= PERFECT_LEAD) { done = true; return { swingAim: "mid" }; }
    }
    return {};
  });
};

/** 玩家自己在第 pressAt 帧抢一拍(带横滑 = 他的落点意图) */
const pressAt = (side: TeamSide, h: number, x: number, vx: number, vy: number, f0: number, swipe: number, o: RunOpts = {}): Cast =>
  run(side, h, x, vx, vy, (f) => (f === f0 ? { swingAim: "mid", swingSwipe: swipe } : {}), o);

/** 只滑动、不点按:验证「击球键变瞄准键」—— 挥拍由系统起,落点仍听玩家的。
 *  pad.swingSwipe 本来就是粘住不丢的(buildIntent 每步输出),所以这里全程供同一个方向。 */
const aimOnly = (side: TeamSide, h: number, x: number, vx: number, vy: number, swipe: number, swipeY: number): Cast =>
  run(side, h, x, vx, vy, () => ({ swingSwipe: swipe, swingSwipeY: swipeY }));

// ---------- 网格:高度 × 远近 × 来球速度 × 两侧(与 lunge-check 同一张表) ----------
const HEIGHTS = [18, 40, 70, 105, 150, 210];
const XS = [CO.netX - 30, CO.netX - 150, CO.netX - 250, CO.left + 12];
const VEL: Array<[number, number, string]> = [
  [3, 5, "下坠"], [7, 2, "平快压过来"], [4, -3, "还在上升"], [11, 8, "对方重杀回钻"],
];

interface Cell { side: TeamSide; h: number; x: number; vx: number; vy: number; tag: string }
/**
 * 专门补的"够得着、但明摆着要出界"的格子:低平快抽,球一路压着左边线外落地。
 * 为什么单列:主网格里"界外"那 42 格全是**够不着**的(最近逼近就超出判定区),所以"不许捞界外球"
 * 那条断言在主网格上永远是空的 —— 把 autoOutMargin 改成 99999 它也照样绿(--selftest 当场抓到)。
 * 这几格是"手伸得出去、但正确答案是收手"的那一类,判据才有牙齿。
 */
const OUT_DRIVES: Array<[number, number, number]> = [[30, -14, -6], [40, -14, -6], [50, -12, -3], [60, -14, -9]];
const cells = (): Cell[] => {
  const list: Cell[] = [];
  for (const side of ["left", "right"] as TeamSide[]) {
    for (const h of HEIGHTS) {
      for (const xb of XS) {
        const x = side === "left" ? xb : mirror(xb);
        for (const [vx, vy, vLabel] of VEL) {
          if (xb === CO.left + 12 && vy < 0) continue;   // 上升球摆底线 = 出界,不是代拍的锅
          list.push({ side, h, x, vx, vy, tag: `${side === "left" ? "左" : "右"} h=${h} x=${Math.round(x)} ${vLabel}` });
        }
      }
    }
  }
  for (const [h, vx, vy] of OUT_DRIVES) {
    for (const side of ["left", "right"] as TeamSide[]) {
      const xb = CO.netX - 120;
      list.push({
        side, h, x: side === "left" ? xb : mirror(xb),
        vx: side === "left" ? vx : -vx, vy, tag: `${side} h=${h} 平抽出界 v=(${vx},${vy})`,
      });
    }
  }
  return list;
};

const inOpponentCourt = (side: TeamSide, landX: number): boolean =>
  side === "left" ? landX > CO.netX && landX <= CO.right : landX < CO.netX && landX >= CO.left;

/** ⑧ 限次的出厂值:判据钉的是这个数,自测把配置改大时不能跟着一起松(见 s8) */
const SNAPSHOT_CAP = C.autoHit.maxTriesPerBall;

/** 判"这球明摆着要飞出边线"用的硬容差 —— **刻意不读 AH.autoOutMargin**。
 * 那条机制自己吃的就是这个数:判据再读它,--selftest 把 autoOutMargin 改成 99999 时
 * 标签会跟着一起翻成"可救",反例当场量出一条死支(实测就是这样漏掉的)。
 * 尺子必须站在被量的东西外面:落点越出边线 40px 以上,无论配置怎么写都该让它落地。
 */
const OUT_STRICT = 40;

/** 这颗来球自己会落在哪儿:界外/贴地的球,正确答案都是"别碰"(与机制同一批判据) */
function incomingTag(side: TeamSide, h: number, x: number, vx: number, vy: number): "界外" | "贴地" | "可救" {
  const { hero, ball } = setup(side, h, x, vx, vy);
  // 前瞻门控与机制同源折一遍:AH.autoLandHorizon 是**基准帧**,慢档里要按世界步数才看得
  // 到落点。不折的话"会出界的那颗球"在 s=0.80 上被误判成"可救"(落点在 90 步之外 ⇒ 看不见),
  // 于是 ⑦ 反过来记代拍一桩"该救没救" —— 判据先跟机制跑偏,红的是尺子不是游戏。
  const landH = lookFrames(AH.autoLandHorizon);
  const fut = Pl.ballFuture(hero, ball, landH);
  if (fut.land <= landH
    && (fut.landX < CO.left - OUT_STRICT || fut.landX > CO.right + OUT_STRICT)) return "界外";
  if (fut.land <= SW.windup + 1) return "贴地";
  return "可救";
}

/** 代拍**按机制自己的规矩**该放掉这颗球吗(落点在界外 autoOutMargin 之外 ⇒ 让它落地收分) */
function willDropOut(g: { side: TeamSide; h: number; x: number; vx: number; vy: number }): boolean {
  const { hero, ball } = setup(g.side, g.h, g.x, g.vx, g.vy);
  const landH = lookFrames(AH.autoLandHorizon);
  const fut = Pl.ballFuture(hero, ball, landH);
  return fut.land <= landH
    && (fut.landX < CO.left - AH.autoOutMargin || fut.landX > CO.right + AH.autoOutMargin);
}

/** 沉默的理由,拿与机制同一批判据反查;归不进任何一类就是真 bug */
const silenceWhy = (hero: PlayerEntity, ball: Ball): string => {
  if (hero.hitLock > 0) return "双重击球锁没解";
  const fc = framesToCentre(hero, ball);
  if (fc === null) return "整段都够不着(最近逼近超出判定区)";
  if (fc > PERFECT_LEAD) return "整段始终没到该按的那一帧";
  const landH = lookFrames(AH.autoLandHorizon);
  const fut = Pl.ballFuture(hero, ball, landH);
  if (fut.cross < 0 || fut.cross > SW.windup + SW.active) return "整条命中窗内球都没过网";
  if (fut.land <= landH
    && (fut.landX < CO.left - AH.autoOutMargin || fut.landX > CO.right + AH.autoOutMargin)) return "落点在界外:让它落地收分";
  if (fut.land <= SW.windup + 1) return "球已贴地:救不到,不空挥";
  if (fut.land <= fc + AH.autoSettleGrace) return "球死在结算之前:不空挥";
  return "?! 到点了却没起手";
};

/** 跑纯自动,顺手记下沉默归因(取末值:窗口最后一帧才是"到底该不该按") */
function autoWhy(side: TeamSide, h: number, x: number, vx: number, vy: number): Cast & { why: string } {
  let why = "";
  const r = run(side, h, x, vx, vy, (f, hero, ball) => {
    if (hero.swingT < 0 && f > 0) why = silenceWhy(hero, ball);
    return {};
  });
  return { ...r, why: r.hit ? "打回对方场内" : r.swings > 0 ? "?! 起了拍却没碰到球" : why || "?! 一帧都没评估(分支没跑到?)" };
}

// ============================================================
// 判据
// ============================================================

/** ① 起了拍必兑现,每一次沉默都说得出理由 */
const s1 = (ck: Checker): void => {
  const GRID = cells();
  const dirty: string[] = [];
  const unexplained: string[] = [];
  const hist = new Map<string, number>();
  let hits = 0, savable = 0, saved = 0, whiffExempt = 0;
  for (const g of GRID) {
    const tag = incomingTag(g.side, g.h, g.x, g.vx, g.vy);
    if (tag === "可救") savable++;
    const a = autoWhy(g.side, g.h, g.x, g.vx, g.vy);
    const key = `${tag} → ${a.why}`;
    hist.set(key, (hist.get(key) ?? 0) + 1);
    if (a.hit) {
      hits++;
      if (tag === "可救") saved++;
      const fail = (m: string): void => { dirty.push(`${g.tag} [来球${tag}] → ${m}`); };
      if (tag === "界外") fail("落点界外的来球被替玩家捞回去了(这分本来就该收下)");
      if (tag === "贴地") fail("球已贴地还起拍 = 空挥");
      if (a.autoSwings !== 1) fail(`这一格系统起了 ${a.autoSwings} 次拍`);
      if (!a.autoHit) fail("球回去了,却不是系统替玩家起的拍(那是替身自己按的?)");
      if (a.intoNet) fail("这一拍下网");
      else if (!inOpponentCourt(g.side, a.landX)) fail(`落点 ${Math.round(a.landX)} 不在对方场内`);
    } else if (a.why === "?! 起了拍却没碰到球") {
      // 起了拍没接到 —— 只有一种情况可以放过:同一格"零反应延迟的完美手动"也接不到。
      // 判据不能拿"机器必须接到所有它想接的球"当标准,那是拿物理做不到的事考它:
      // 峰值追账要等球离圈或走完窗才结算,而贴网快死球常在结算前一帧落地
      // (实测 land 与"接没接到"根本不是单调关系:211 格 land 更大的反而接不到)。
      // 三条已上线的一键化同样吃这一类豁免,见 config.lunge.autoSettleGrace 那段实测。
      const m = perfect(g.side, g.h, g.x, g.vx, g.vy);
      if (m.hit) dirty.push(`${g.tag}:系统起拍没接到,而完美手动同一格能接到(${m.kind} q=${m.q.toFixed(2)})—— 白丢一次救球`);
      else whiffExempt++;
    } else if (a.why.startsWith("?!")) {
      unexplained.push(`${g.tag} [来球${tag}] → ${a.why}`);
    }
  }
  for (const m of dirty.slice(0, 8)) ck.ok(false, `① ${m}`);
  ck.ok(dirty.length === 0,
    `① ${GRID.length} 格全跑:起了拍一律兑现(${hits} 格打回,可救子集 ${saved}/${savable});`
    + `${whiffExempt} 格"手动也接不到"照豁免`);
  for (const m of unexplained.slice(0, 8)) ck.ok(false, `① ${m}`);
  ck.ok(unexplained.length === 0, `① 每一次沉默都归得了因(没有"到点了却没起手")`);
  const table = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([k, n]) => `${k}×${n}`).join(" | ");
  console.log(`     沉默归因分布:${table}`);
};

/** ② 永不发球(实测四重不沾:live/held/flying/lastHitter)+ 对照组:AI 发给真人的球必须真被回掉 */
const s2 = (ck: Checker): void => {
  AutoHit.request(true);
  Rules.newMatch("1p", "normal");
  const R = Rules.R;
  // 推到"轮到真人发球"那一刻:球握在真人手里
  let guard = 0;
  const heldByHuman = (): boolean => {
    const b = R.ball;
    return !!b && R.state === "SERVE" && b.held && (!!b.owner as boolean) && (b.owner as PlayerEntity).side === "left";
  };
  while (guard++ < 400 && !heldByHuman()) {
    R.events.length = 0;
    Rules.step(R.players.map(() => emptyInput()));
  }
  const human = R.players[0];
  ck.ok(heldByHuman(), `② 已摆到真人握球发球(state=${R.state},guard=${guard})`);
  let swung = false, served = false, frames = 0;
  for (let f = 0; f < 120; f++) {
    R.events.length = 0;
    Rules.step(R.players.map((p) => emptyInput()));
    frames++;
    if (human.swingT >= 0) swung = true;
    if (R.events.some((e) => e.t === "serve")) served = true;
    if (R.state !== "SERVE") break;
  }
  ck.ok(!swung && !served, `② 发球轮到自己:连按 ${frames} 帧零输入,一次拍都没起、一记发球都没发出(发球仍归玩家)`);
  ck.ok(R.serveWait === frames, `② serveWait 照常累加(${R.serveWait})= 系统没在背后替玩家"蓄力"`);
  ck.ok(!human.serveSwing, `② serveSwing 标记没被自动分支点亮`);
  // 对照组:这一格必须真能代拍,否则上面三条是在量一条死支
  const ctl = auto("left", 105, CO.netX - 150, 5, 3);
  ck.ok(ctl.hit && ctl.autoHit, `② 对照组(AI 发给真人的来球)确实被自动回掉:kind=${ctl.kind}`);
};

/** ③ 无免费手长:自动起手帧不许吃判定区尾段倍率、不许带跨步加力 */
const s3 = (ck: Checker): void => {
  AutoHit.request(true);
  const nonZero: string[] = [];
  const widened: string[] = [];
  let frames = 0;
  for (const g of cells().slice(0, 60)) {
    const a = auto(g.side, g.h, g.x, g.vx, g.vy);
    a.lungeAutoAtSwing.forEach((v, i) => {
      frames++;
      if (v !== 0) nonZero.push(`${g.tag}:起手帧 lungeAutoT=${v}`);
      const [now, without] = a.zonePairs[i];
      if (Math.abs(now - without) > 0.01) widened.push(`${g.tag}:半径 ${now.toFixed(1)} ≠ 无尾段 ${without.toFixed(1)}`);
    });
    if (a.autoSwings > 0 && a.lungeAutoAtSwing.length !== a.autoSwings) {
      nonZero.push(`${g.tag}:起了 ${a.autoSwings} 拍却只记到 ${a.lungeAutoAtSwing.length} 帧现场`);
    }
  }
  ck.ok(frames > 0, `③ 采到 ${frames} 个自动起手帧(否则下面两条是空断言)`);
  ck.ok(nonZero.length === 0, `③ 自动那一拍从不写 lungeAutoT(${nonZero.length ? nonZero[0] : "全部为 0"})`);
  ck.ok(widened.length === 0, `③ 起手帧判定区半径与"强制无尾段"逐格相等:${widened.length ? widened[0] : "没有白送的手长"}`);
};

/** ④ 手动优先:玩家在该帧一按,那一拍就归他;他挥空了,系统才接着救 */
const s4 = (ck: Checker): void => {
  AutoHit.request(true);
  // (a) 先找出系统会出手的格子,再让玩家**就在同一帧**按下 —— 谁优先不由顺序表说了算,得有一格撞上才算
  let checked = 0, stolen = 0, aimKept = 0;
  let rescued = 0, rescueTried = 0;
  for (const g of cells()) {
    const a = auto(g.side, g.h, g.x, g.vx, g.vy);
    if (!a.hit || a.autoSwingFrames.length === 0) continue;
    const f0 = a.autoSwingFrames[0];
    const m = pressAt(g.side, g.h, g.x, g.vx, g.vy, f0, -1);
    if (!m.hit) continue;
    checked++;
    if (m.autoHit) stolen++;
    if (!m.autoHit && m.autoSwings === 0 && m.swings === 1) aimKept++;
    // (b) 同一格让玩家按早 20 帧(那一拍必定挥空),看系统还救不救得回来
    if (f0 >= 22) {
      rescueTried++;
      const w = pressAt(g.side, g.h, g.x, g.vx, g.vy, f0 - 20, 0, { stopOnWhiff: false });
      if (w.whiffs > 0 && w.hit) rescued++;
    }
  }
  ck.ok(checked > 0, `④ 找到 ${checked} 格"玩家与系统同一帧抢"的场景(0 格则下面两条是空断言)`);
  ck.ok(stolen === 0, `④ 玩家按下的那一拍一律算他自己的:被冒领成代打的 ${stolen}/${checked}`);
  ck.ok(aimKept === checked, `④ 抢到的那一拍只起一次拍、落点用玩家滑的方向(${aimKept}/${checked})`);
  ck.ok(rescueTried > 0 && rescued > 0,
    `④ 玩家按早挥空之后系统仍把球救回:${rescued}/${rescueTried} 格(辅助模式不罚挥空,但受 ⑧ 限次约束)`);
};

/** ⑤ 模式门控:只有对练/闯关/无限练习代打 */
const s5 = (ck: Checker): void => {
  AutoHit.request(true);
  ck.ok(AH.modes.slice().sort().join(",") === ["1p", "campaign", "endless"].sort().join(","),
    `⑤ 生效模式表就是「对练 · 闯关 · 无限练习」:${AH.modes.join("/")}`);
  for (const m of ["drill", "tutorial", "2p", "2v2"]) {
    ck.ok(!AutoHit.eligible(m), `⑤ ${m} 不代打`);
  }
  // 真集成:newMatch("2p") 之后门控必须关着(模式是 rules 报进来的,不是工具自己拼的)
  Rules.newMatch("2p", "normal");
  ck.ok(!AutoHit.on, `⑤ newMatch("2p") 后 AutoHit.on = false(本地对战不替人打)`);
  // 门控关着跑整张网格:一次都不能代拍。模式经 setup → newMatch 报进门控,与真机同一条路。
  for (const mode of ["drill", "tutorial"]) {
    let leaks = 0, hits = 0;
    for (const g of cells()) {
      const a = auto(g.side, g.h, g.x, g.vx, g.vy, { mode });
      if (a.autoSwings > 0 || a.autoHit) leaks++;
      if (a.hit) hits++;
    }
    ck.ok(leaks === 0, `⑤ ${mode} 模式下跑完整网格:代拍 ${leaks} 格(必须是 0;该模式仍打了 ${hits} 格 = 替身自己按的)`);
  }
  Rules.newMatch("1p", "normal");
};

/** ⑥ 关掉就是今天的游戏:一次都不调用择帧尺子,一个字段都不写 */
const s6 = (ck: Checker): void => {
  AutoHit.request(false);
  const real = Pl.autoSwingDue;
  let calls = 0;
  // 计数壳:autoSwingDue 挂在 Player 导出面上正是为了这个(直接闭包调用换不掉,反例就没牙齿)
  Pl.autoSwingDue = ((p: PlayerEntity, ball: Ball | null, src?: "lunge" | "smash" | "rage" | "auto") => {
    calls++;
    return real(p, ball, src);
  }) as typeof Pl.autoSwingDue;
  let dirtyFields = 0;
  try {
    for (const g of cells()) {
      const a = auto(g.side, g.h, g.x, g.vx, g.vy);
      if (a.autoSwings > 0 || a.autoHit) dirtyFields++;
    }
  } finally {
    Pl.autoSwingDue = real;
  }
  ck.ok(calls === 0, `⑥ 开关关掉:整张网格对 autoSwingDue 的调用数 = ${calls}(必须 0 ⇒ "关掉逐帧等同今天"是算出来的,不是相信的)`);
  ck.ok(dirtyFields === 0, `⑥ 关掉后没有任何一拍被标记成代打(${dirtyFields})`);
  // 正对照:同样的壳打开开关,调用数必须 > 0,否则上面那条只是"尺子没接到东西"
  AutoHit.request(true);
  let on = 0;
  Pl.autoSwingDue = ((p: PlayerEntity, ball: Ball | null, src?: "lunge" | "smash" | "rage" | "auto") => {
    on++;
    return real(p, ball, src);
  }) as typeof Pl.autoSwingDue;
  try {
    for (const g of cells().slice(0, 20)) auto(g.side, g.h, g.x, g.vx, g.vy);
  } finally {
    Pl.autoSwingDue = real;
  }
  ck.ok(on > 0, `⑥ 对照组(开关打开)调用数 ${on} > 0 —— 上一条不是空转`);
};

/** ⑦ 不加强度:自动那一拍不比"完美手动"准,该打坏的照样打坏 */
const s7 = (ck: Checker): void => {
  AutoHit.request(true);
  const worse: string[] = [];
  let both = 0, nonSweet = 0;
  let sumA = 0, sumM = 0;
  /** 有用的救球 = 球回对方场内且不下网。只比"碰没碰到球"会奖成一记自杀:
   *  贴网点一下 q=0.00 也"算接到",但那一拍要么下网要么送半场。 */
  const usable = (c: Cast, side: TeamSide): boolean =>
    c.hit && !c.intoNet && inOpponentCourt(side, c.landX);
  for (const g of cells()) {
    const tag = incomingTag(g.side, g.h, g.x, g.vx, g.vy);
    const a = autoWhy(g.side, g.h, g.x, g.vx, g.vy);
    const m = perfect(g.side, g.h, g.x, g.vx, g.vy);
    // "手动救得到、自动救不到"只有在**那颗球本来会落在界内**时才算丢了一次救球。
    // 要出界的球被捞回去是把对手送的分还给人家(① 专门罚这条),不该反过来记自动的账。
    // 口径必须是机制**自己**那道界外门 autoOutMargin(8px),不是 ① 用的 OUT_STRICT(40px):
    // 后者故意比机制严,是用来"少冤枉代拍捞界外球"的。拿 40 的那一边问"你怎么不救",
    // 等于一边允许它放掉压线出界的球、一边怪它没救回来 —— 实测 s=0.80 时两格 38px 出界
    // 的平抽就是这样变红的(球速档一放慢合,完美手动够得着了,这条才露出来)。
    if (!willDropOut(g) && usable(m, g.side) && !usable(a, g.side)) {
      worse.push(`${g.tag}:完美手动把球送回对方场(landX=${Math.round(m.landX)} q=${m.q.toFixed(2)}),`
        + ` 自动没做到 —— 归因「${a.why}」`);
      continue;
    }
    if (!a.hit || !m.hit) continue;
    both++;
    sumA += a.q; sumM += m.q;
    if (!a.autoHit) worse.push(`${g.tag}:自动那一拍没打上 autoHit 标`);
    // 容差:两条路径在起手前的帧数不同,随机序列仍可能有 1~2 次偏差
    if (a.q > m.q + 0.25) worse.push(`${g.tag}:自动 q=${a.q.toFixed(2)} > 完美手动 q=${m.q.toFixed(2)}`);
    if (a.q < 1 - C.sweet.coreRatio) nonSweet++;
  }
  for (const m of worse.slice(0, 6)) ck.ok(false, `⑦ ${m}`);
  ck.ok(worse.length === 0,
    `⑦ ${both} 格里自动不比完美手动强(均值 ${(sumA / both).toFixed(3)} vs ${(sumM / both).toFixed(3)}),`
    + "且没有一格「手动救得到、自动救不到」");
  ck.ok(nonSweet > 0, `⑦ 代拍仍会打出非甜蜜档:${nonSweet} 格 q 低于甜蜜线 —— 借的是时机不是判定`);
  // 瞄准同源:滑过之后自动那一拍必须用玩家的方向
  const deep = aimOnly("left", 105, CO.netX - 150, 5, 3, 1, 0);
  const near = aimOnly("left", 105, CO.netX - 150, 5, 3, -1, 0);
  ck.ok(deep.hit && near.hit, `⑦ 「击球键变瞄准键」两侧都仍能出球(deep=${deep.kind} / near=${near.kind})`);
  ck.ok(deep.landX > near.landX,
    `⑦ 同一格只改滑动方向,落点就跟着走:右滑 ${Math.round(deep.landX)} > 左滑 ${Math.round(near.landX)}`);
  const neutral = auto("left", 105, CO.netX - 150, 5, 3);
  ck.ok(neutral.aim === "mid", `⑦ 没滑过就是中性 aim=${neutral.aim}(与真人点按同一条路,不偷偷压深)`);
};

/** ⑧ 每球限次:没有窗可清,必须自己数 */
const s8 = (ck: Checker): void => {
  AutoHit.request(true);
  const over: string[] = [];
  let maxSeen = 0;
  for (const g of cells()) {
    const a = auto(g.side, g.h, g.x, g.vx, g.vy);
    maxSeen = Math.max(maxSeen, a.autoSwings);
    if (a.autoSwings > AH.maxTriesPerBall) over.push(`${g.tag}:起了 ${a.autoSwings} 拍`);
  }
  ck.ok(over.length === 0, `⑧ 同一发来球最多代拍 ${AH.maxTriesPerBall} 次(实测峰值 ${maxSeen},越线 ${over.length} 格)`);
  // 上面那张网格天然只会各起一次拍(打完球就成自家球、接不到球就落地),限次根本没被逼到过 ——
  // 那就直接逼算术:摆一颗**冻在判定区心里**的球(不跑物理、球永不落地、择帧恒"该按"),
  // 只推 player 的挥拍机器,数它到底能起几拍。没有 maxTriesPerBall 拦着,这里就是
  // smashAutoT 注释警告过的"人物自己乱挥半天":一局 200 帧能起 7 拍。
  const realDue = Pl.autoSwingDue;
  let gunStarts = 0;
  try {
    Pl.autoSwingDue = (): boolean => true;
    const R = Rules.R;
    const { hero, ball } = setup("left", 120, CO.netX - 175, 0, 0);
    ball.vx = 0; ball.vy = 0;                     // 冻住:让它一直在圈心 ⇒ 一直在"该按"
    let prevSwing = false;
    for (let f = 0; f < 200; f++) {
      R.state = "RALLY";
      Pl.update(hero, emptyInput(), ball);
      const swinging = hero.swingT >= 0;
      if (swinging && !prevSwing && hero.swingAuto) gunStarts++;
      prevSwing = swinging;
      ball.x = ball.px; ball.y = ball.py;         // 抵消 update 里的任何位移
    }
  } finally {
    Pl.autoSwingDue = realDue;
  }
  ck.ok(gunStarts > 1, `⑧ 压力算术(择帧恒"该按" + 冻结球)确实会连挥:${gunStarts} 拍 —— 否则下面那条是空断言`);
  // 上限取**模块加载时**的值,不读 AH.maxTriesPerBall 的现值:自测会把这个配置改大来验这条
  // 有没有牙齿,判据跟着被量的东西一起动就等于没量(与上面 OUT_STRICT 同一条道理)。
  ck.ok(gunStarts === SNAPSHOT_CAP,
    `⑧ 同一个压力下恰好代 ${gunStarts} 拍 = 出厂 maxTriesPerBall(${SNAPSHOT_CAP}):多一拍没有、少一拍也没断`);
};

/** ⑨ 四侧门控数值同源:共用一把尺子的账要有人钉 */
const s9 = (ck: Checker): void => {
  const srcs: Array<[string, { autoHorizon: number; autoLandHorizon: number; autoOutMargin: number; autoSettleGrace: number }]> = [
    ["lunge", C.lunge], ["smash", C.skills.smash], ["rage", C.skills.rage], ["auto", AH],
  ];
  const keys = ["autoHorizon", "autoLandHorizon", "autoOutMargin", "autoSettleGrace"] as const;
  for (const k of keys) {
    const set = new Set(srcs.map(([, o]) => o[k]));
    ck.ok(set.size === 1, `⑨ ${k} 四侧同源:${srcs.map(([n, o]) => `${n}=${o[k]}`).join(" / ")}`);
  }
  const raw = AH as unknown as Record<string, number | string | undefined>;
  ck.ok(raw.autoAim === "mid", `⑨ 代拍起手给的是字符串 mid(与真人点按同一条路),不是三条一键化那个 0.8 深压`);
  // 这两个键**故意不存在**:前者是"没有窗"的证据(逐帧轮询靠 maxTriesPerBall 限次),
  // 后者是"不借手长"的证据(吃了它就等于把够不着的球也判成能打)。
  ck.ok(raw.autoWindow === undefined, "⑨ C.autoHit 没有 autoWindow 这个键:这条一键化没有窗,逐帧轮询");
  ck.ok(raw.reachTailMul === undefined, "⑨ C.autoHit 没有 reachTailMul 这个键:不给白送的手长");
  // 限次本身也是一条设计红线,不只由 s8 拿现值去量:把它调到 9999 就等于关掉,
  // 那时 s8 的"≤ 现值"照样绿 —— 所以这里直接钉出厂范围。
  ck.ok(SNAPSHOT_CAP >= 1 && SNAPSHOT_CAP <= 3,
    `⑨ maxTriesPerBall = ${SNAPSHOT_CAP} 在设计红线内(1..3):再大就是"人物自己乱挥半天"`);
};

/**
 * ⑩ 用的"真 pad"跑法:上面那套合成输入量的是**算术**(滑了往哪打),这条量的是**账本** ——
 * 一次滑动到底管几拍。所以要走真路径:`buildIntent(pad)` 每步出意图(粘住不丢就是它做的),
 * `onAimConsume` 接 `restoreSwingAim(pad)`(game-root 就是这么接的:没锁归 0、有锁回锁向),
 * 边沿按 game-root 的次序清。对手喂 AI.think 而不是空输入:它必须真的回球,
 * 否则"AI 偷吃玩家瞄准"那条判据量的是死支。
 */
interface PadCast {
  /** 真人每一记命中的落点档(ShotResult.aim)与落点 */
  aims: string[]; landXs: number[];
  hits: number; cpuHits: number;
  /** 真人侧 / CPU 侧各自被调到几次"这一次滑动用掉了" */
  consumes: number; cpuConsumes: number;
  /** 收工时 pad 上还留着的方向 */
  swipe: number; swipeY: number;
  whiffs: number;
  /** 第一拍代拍起手的帧(⑩b/⑩c 要拿它当"按早/按准"的靶子) */
  autoStart: number;
  /** 每一帧末尾的 hero.swingAim(⑩g 抓"同帧被续拍再吃一次") */
  swingAims: string[];
}
interface PadState { hits: number; cpuHits: number; consumes: number; cpuConsumes: number; whiffs: number; hero: PlayerEntity }
interface PadOpts {
  maxFrames?: number; seed?: number;
  /** 在第几帧"按下击球键 + 同帧横滑提交"(真机上 down() 清零、trackSwingSwipe 再写 ±1) */
  pressFrame?: number; pressSwipe?: number;
  stopWhen?: (s: PadState) => boolean;
}

/** ⑪ 的反例接缝:收招时 pad 恢复成什么。默认 = restoreSwingAim(没锁归 0、有锁回锁向);
 *  --selftest 把它换成「无视锁的清零」来证明 ⑪ 的判据有牙 —— 与 Player.* 那几条接缝同规矩:
 *  pad 函数是 runPad 闭包里的常量换不上去,经这一层间接,selftest 才有下刀的地方。 */
let padAimRestore: (pad: Pad) => void = restoreSwingAim;

const armPad = (swipe: number, swipeY = 0): Pad => {
  const pad = newPad();
  pad.swingSwipe = swipe; pad.swingSwipeY = swipeY;
  return pad;
};

function runPad(side: TeamSide, h: number, x: number, vx: number, vy: number,
  pad: Pad, o: PadOpts = {}): PadCast {
  seedRandom(o.seed ?? 7);
  const R = Rules.R;
  const { hero } = setup(side, h, x, vx, vy);
  const out: PadCast = {
    aims: [], landXs: [], hits: 0, cpuHits: 0, consumes: 0, cpuConsumes: 0,
    swipe: 0, swipeY: 0, whiffs: 0, autoStart: -1, swingAims: [],
  };
  let consumes = 0, cpuConsumes = 0;
  const max = o.maxFrames ?? 140;
  try {
    for (let f = 0; f < max; f++) {
      R.events.length = 0;
      if (o.pressFrame === f) {
        press(pad, "swing");                        // 按下即把两轴恢复成锁值(没锁 = 0,与真机同一条 press)
        // 同帧手指横滑才写键值 = trackSwingSwipe 只在手指真动过阈值时写;
        // 不写的话 pad 停在 press 恢复出来的锁值上 —— 长滑锁定后「按下不滑」就该按锁向打。
        if (o.pressSwipe !== undefined) pad.swingSwipe = o.pressSwipe;
      }
      const mine = buildIntent(pad, { onAimConsume: () => { consumes++; padAimRestore(pad); } });
      const inputs = R.players.map((p) => p === hero
        ? mine
        : { ...AI.think(p, R.ball as Ball, R.state), onAimConsume: () => { cpuConsumes++; } });
      Rules.step(inputs);
      clearEdges(pad); tickHolds(pad);               // 与 game-root 的模拟步同一套收尾
      if (hero.swingAuto && hero.swingT >= 0 && out.autoStart < 0) out.autoStart = f;
      for (const ev of R.events) {
        if (ev.t !== "hit") continue;
        if (ev.side === hero.side) {
          out.hits++; out.aims.push(String(ev.aim ?? "?")); out.landXs.push(ev.landX as number);
        } else out.cpuHits++;
      }
      out.swingAims.push(String(hero.swingAim));
      if (o.stopWhen && o.stopWhen({ hits: out.hits, cpuHits: out.cpuHits, consumes, cpuConsumes, whiffs: hero.stats.whiffs, hero })) break;
    }
  } finally { unseed(); }
  out.consumes = consumes; out.cpuConsumes = cpuConsumes;
  out.swipe = pad.swingSwipe; out.swipeY = pad.swingSwipeY; out.whiffs = hero.stats.whiffs;
  return out;
}

/** ⑩g 用:代拍那一拍收招的帧(命中后 swingHit=true ⇒ total 不含 whiffExtra) */
const swingEndFrame = (start: number): number => start + Physics.swingTotal();

/**
 * ⑩ 瞄准一次性 + 已瞄准读数。
 * 这条改动的坏法照例全都不崩、不报错、tsc 也不报:
 *  ⑩a 打完不清 = 玩家说的"滑一次就锁住了"(用户 2026-10-05 的原话)
 *  ⑩b 挥空也清 = 没兑现还把玩家的瞄准没收走(与三条一键化"挥空不罚冷却"同一条规矩)
 *  ⑩c 关掉不干净 = 手动模式的粘住行为被改坏,而那是老玩家的手感记忆
 *  ⑩d AI 也消耗 = game-root 的 inputHooks 是**共用对象**,铺给场上每个人 ⇒ CPU 打一拍吃掉真人欠着的瞄准
 *  ⑩f 徽标停在上一拍 = "我滑了到底有没有用"这个唯一读数开始撒谎
 *  ⑩g 同帧被续拍再吃一次 = 一次滑动打两拍(inp 是本步快照,清 pad 清不到它)
 *  ⑩h 键名读数被透明度滑杆抹掉 = 看不见的控件就是 bug
 */
const s10 = (ck: Checker): void => {
  AutoHit.request(true);
  // 与 ⑦ 同款"必定接得到"的格子:左半场、高 105、平快下坠来球
  const sd: TeamSide = "left", hh = 105, xx = CO.netX - 150, vx = 5, vy = 3;

  // 先探一枪纯自动:拿到代拍起手帧,后面几条要拿它当"按早/按准"的靶子
  const probe = runPad(sd, hh, xx, vx, vy, armPad(0, 0), { stopWhen: (s) => s.hits >= 1 });
  ck.ok(probe.hits >= 1 && probe.autoStart >= 0,
    `⑩ 探针格能接到球(autoStart=${probe.autoStart})—— 下面全部判据的对照基准`);
  const f0 = probe.autoStart;

  // ---- ⑩a 滑一次 = 那一拍按你滑的打,打完当场回默认 ----
  const padA = armPad(1, 0);
  const a = runPad(sd, hh, xx, vx, vy, padA, { stopWhen: (s) => s.hits >= 1 && s.consumes >= 1 });
  ck.ok(a.aims[0] === "deep", `⑩a 右滑那一拍就按右滑打(实得 aim=${a.aims[0] ?? "无"})`);
  ck.ok(a.consumes === 1, `⑩a 一次命中恰好一次消耗:${a.consumes}(必须 1)`);
  ck.ok(a.swipe === 0 && a.swipeY === 0,
    `⑩a 打完就回默认,pad 两轴 = ${a.swipe}/${a.swipeY}(必须 0/0;非 0 就是玩家说的"锁定状态")`);

  // ---- ⑩b 没滑的第二拍 = 从没滑过,逐位一致 ----
  const again = runPad(sd, hh, xx, vx, vy, padA, { stopWhen: (s) => s.hits >= 1 });
  const virgin = runPad(sd, hh, xx, vx, vy, armPad(0, 0), { stopWhen: (s) => s.hits >= 1 });
  ck.ok(again.aims[0] === "mid", `⑩b 再滑之前不重滑:下一拍 aim=${again.aims[0]}(必须 mid)`);
  ck.ok(again.landXs.length > 0 && virgin.landXs.length > 0
    && Math.abs(again.landXs[0] - virgin.landXs[0]) < 1e-9,
    `⑩b 用掉之后的那一拍与"从没滑过"逐位一致:${Math.round(again.landXs[0])} vs ${Math.round(virgin.landXs[0])}`);

  // ---- ⑩c 挥空不吃瞄准 ----
  const c = (() => {
    // "按早了"要有得按:探针格(f0=0,球一上来就在判定区里)做不出挥空,得挑一颗还在远处的。
    // 与其硬编码帧差(改一个数值就静默变成空断言),这里扫几颗候选,只取**真的**挥空成功那一格。
    const tries: Array<[number, number, number, number]> = [
      [105, CO.netX - 250, 3, 5], [150, CO.netX - 250, 4, -3], [70, CO.netX - 300, 7, 2], [40, CO.netX - 150, 11, 8],
    ];
    for (const [ch, cx, cvx, cvy] of tries) {
      const t = runPad(sd, ch, cx, cvx, cvy, armPad(0, 0), {
        maxFrames: 60, pressFrame: 0, pressSwipe: 1, stopWhen: (s) => s.whiffs >= 1,
      });
      if (t.whiffs >= 1) return t;
    }
    return null;
  })();
  ck.ok(c !== null, `⑩c 找到一格"第 0 帧就按 ⇒ 必挥空"的候选(找不到就是这几格都被判定区兜住了,这条判据成了摆设)`);
  ck.ok(!c || c.consumes === 0, `⑩c 挥空不吃瞄准:消耗 ${c ? c.consumes : "-"}(必须 0;辅助模式不罚玩家挥空,与三条一键化"挥空不付冷却"同源)`);
  ck.ok(!c || c.swipe === 1, `⑩c 挥空之后那次右滑还欠着(实得 ${c ? c.swipe : "-"}):没兑现就不许没收`);

  // ---- ⑩d AI 永不消耗(它的准头归 diffs 管,而 pad 上的瞄准是玩家的)----
  // 不能"抓到第一记 CPU 命中就收工":消耗发生在**收招帧**,比出手晚约 22 帧 ——
  // 那样两条路径(正写 / 拆掉 isAI 闸)都会在事件当帧就停,判据量的是死支(--selftest 现场抓到的)。
  // 所以整段跑满,再拿"真人侧确实被消耗过 ≥1 次"作正对照,证明钩子是接着的。
  const d = runPad(sd, hh, xx, vx, vy, armPad(1, 0), { maxFrames: 200 });
  ck.ok(d.cpuHits >= 1, `⑩d 对手在这 200 帧里真的回球了(${d.cpuHits} 拍)—— 否则下一条量的是死支`);
  ck.ok(d.consumes >= 1, `⑩d 正对照:同一场里真人那一侧被消耗 ${d.consumes} 次(钩子确实接在输入上)`);
  ck.ok(d.cpuConsumes === 0, `⑩d CPU 打一拍不许吃掉真人的瞄准:AI 侧消耗 ${d.cpuConsumes}(必须 0)`);

  // ---- ⑩e 关掉 = 今天:滑动仍然粘住,钩子一次都不调 ----
  AutoHit.request(false);
  const padE = armPad(1, 0);
  const e = runPad(sd, hh, xx, vx, vy, padE, {
    pressFrame: f0, pressSwipe: 1,
    stopWhen: (s) => s.hits >= 1 && s.hero.swingT < 0,
  });
  ck.ok(e.hits >= 1, `⑩e 关掉后玩家自己按准那一拍仍能出球(命中 ${e.hits})`);
  ck.ok(e.consumes === 0, `⑩e 关掉时消耗钩子一次都没调:${e.consumes}(必须 0)`);
  ck.ok(e.swipe === 1, `⑩e 关掉后 pad 仍是老行为的粘住值(${e.swipe})—— 手动模式手感一字不动`);
  AutoHit.request(true);

  // ---- ⑩f 徽标基准:上一拍落在 deep 不许冒充下一拍 ----
  const { hero, ball } = setup(sd, hh, xx, vx, vy);
  hero.swingT = -1; hero.swingAim = "deep"; hero.swingLoft = 0;
  const base = Pl.previewBase(hero);
  ck.ok(base.aim === AH.autoAim && base.loft === 0,
    `⑩f 开着辅助且不在挥拍 → 预告基准回落到代拍种子 ${base.aim}(实得 ${base.aim})`);
  ck.ok(base.aim !== hero.swingAim,
    `⑩f 上一条不是空断言:实体上还挂着上一拍的 ${hero.swingAim},基准必须不等于它`);
  const midGround = runPad(sd, hh, xx, vx, vy, armPad(0, 0), { stopWhen: (s) => s.hits >= 1 });
  ck.ok(midGround.aims[0] === "mid", `⑩f 对照:没滑过时那一拍本来就是 ${midGround.aims[0]}`);
  void midGround.landXs.length;
  const q = 1 - C.sweet.coreRatio;
  const armedBase = Pl.previewBase(hero);
  const viaBase = Pl.buildShot(hero, ball, {
    q, sweet: true, dEdge: 0, heat: 0, preview: true,
    aimHint: aimOverride(armedBase.aim, armedBase.loft, 0, 0),
  }).kind;
  ck.ok(Pl.previewKind(hero, ball, { swipe: 0, swipeY: 0 }) === viaBase,
    "⑩f 徽标(没滑动)与走同一份 aimOverride 的 buildShot 同球种 —— header 那句「同一份瞄准算术」现在有判据了");
  const hintDeep = aimOverride(armedBase.aim, armedBase.loft, 1, 0);
  ck.ok(hintDeep.aim === "deep", `⑩f 有 pending 滑动时基准被盖成 ${hintDeep.aim}`);
  const viaDeep = Pl.buildShot(hero, ball, {
    q, sweet: true, dEdge: 0, heat: 0, preview: true, aimHint: hintDeep,
  }).kind;
  ck.ok(Pl.previewKind(hero, ball, { swipe: 1, swipeY: 0 }) === viaDeep,
    "⑩f 徽标(已滑右)与同一份算术的 buildShot 同球种");
  const armedBaseLive = (() => { hero.swingT = 4; const b = Pl.previewBase(hero); hero.swingT = -1; return b; })();
  ck.ok(armedBaseLive.aim === "deep",
    `⑩f 挥拍进行中基准必须是活值(实得 ${armedBaseLive.aim}),不能被种子顶掉`);

  // ---- ⑩g 同帧不重复吃:收招帧被 swingBuf 接续下一拍时,那份快照已经作废 ----
  const g = runPad(sd, hh, xx, vx, vy, armPad(1, 0), {
    maxFrames: 90, pressFrame: swingEndFrame(f0), pressSwipe: 1,
  });
  const endF = swingEndFrame(f0);
  const afterG = g.swingAims[endF + 1];
  ck.ok(g.swipe === 0, `⑩g 收招处把 pad 清了(实得 ${g.swipe})`);
  ck.ok(afterG === "mid",
    `⑩g 同一帧续上的那一拍不许再吃一次用掉的滑动:swingAims[${endF + 1}] = ${afterG}(必须 mid;漏了快照清零就是 deep)`);
  ck.ok(g.swingAims[endF] === "deep" || g.swingAims[endF - 1] === "deep",
    `⑩g 上一条不是空断言:被用掉的那一拍确实带着滑动的方向(${g.swingAims[endF - 1]}/${g.swingAims[endF]})`);

  // ---- ⑩h 键面读数的配置自洽 + 浓度下限 ----
  const badgeRaw = C.shotBadge as unknown as Record<string, unknown>;
  ck.ok(badgeRaw.autoSuffix === undefined,
    "⑩h 徽标上那串「· 自动」已经删掉:模式读数只在击球键的键名上说一次");
  const lab = AH.padLabel;
  ck.ok(lab.text === "自动" && lab.keep > 0 && lab.keep <= 1,
    `⑩h config.autoHit.padLabel = { text:${lab.text}, keep:${lab.keep} } 自洽(keep 必须 >0,否则读数会被透明度抹掉)`);
  ck.ok(alphaFloor(0, lab.keep) >= lab.keep - 1e-9 && alphaFloor(1, lab.keep) === 1,
    `⑩h alphaFloor 两端:滑杆 0 时 ${alphaFloor(0, lab.keep).toFixed(3)} ≥ keep,滑杆拉满 ${alphaFloor(1, lab.keep).toFixed(3)}`);
  ck.ok(alphaFloor(0.2, lab.keep) >= 0.8,
    `⑩h 滑杆最低(0.2)时「自动」两字的浓度 = ${alphaFloor(0.2, lab.keep).toFixed(3)}(必须 ≥0.8 才读得出来)`);
  let mono = true;
  for (let i = 1; i <= 10; i++) if (alphaFloor(i / 10, lab.keep) < alphaFloor((i - 1) / 10, lab.keep)) mono = false;
  ck.ok(mono, `⑩h alphaFloor 随滑杆单调不减(反过来会被读成"滑杆往上调反而更淡")`);
};

/**
 * ⑪ 长滑锁定(pad.swingLockX/Y):不滑只按 = 每拍按锁向打;锁着时任何一次短滑 = 解除
 * (手势层的 clearSwingLocks,见用户 2026-10-05 口径)。
 * 锁只住在 pad 上,core 只看见键值 —— 所以这条量的是「锁通过 press/restoreSwingAim 两条
 * 恢复路进管道之后」的账本,手势判定本身(阈值/快慢/解除时机)在 UI 层,由 input-check
 * ⑩b 钉死 pad 层契约。这条改动的坏法照例全都不崩、不报错:
 *  ⑪a 锁只管一拍 = 长滑白滑,与没锁一个样(收招把锁恢复成了 0)
 *  ⑪b 按下不继承锁 = 手动模式锁定失灵(按下不滑必须按锁向打)
 *  ⑪c 锁着时写进来的滑动键值守不住一拍 = 锁定名存实亡(pad 层:没触发解除的滑动,
 *     覆盖的本拍打完必须回锁)
 */
const s11 = (ck: Checker): void => {
  AutoHit.request(true);
  // 与 ⑩ 同一格:左半场、高 105、平快下坠来球(探针格第 0 帧必命中,见 ⑩c)
  const sd: TeamSide = "left", hh = 105, xx = CO.netX - 150, vx = 5, vy = 3;

  // ---- ⑪a 锁一次管多拍:代拍每一拍都往锁向打,锁在收招后原样留在 pad 上 ----
  // 装弹与真机长滑同构:trackSwingSwipe 先按短滑语义写键值、再上锁 —— 两个都写才是长滑。
  const padL = armPad(1, 0);
  padL.swingLockX = 1;
  const a = runPad(sd, hh, xx, vx, vy, padL, { maxFrames: 240, stopWhen: (s) => s.hits >= 2 });
  ck.ok(a.hits >= 2, `⑪a 这格两拍都接到了(${a.hits})—— 锁定判据的对照基准`);
  ck.ok(a.aims[0] === "deep" && a.aims[1] === "deep",
    `⑪a 锁 deep 后代拍连着两拍都 deep(实得 ${a.aims[0]}/${a.aims[1]};锁只管一拍 = 长滑白滑)`);
  ck.ok(a.consumes >= 1, `⑪a 收招钩子照常在调(${a.consumes} 次)—— 锁定的恢复走的是同一条路`);
  ck.ok(a.swipe === 1 && padL.swingLockX === 1,
    `⑪a 打完 pad 键值停在锁向(${a.swipe})、锁原样还在(${padL.swingLockX}):恢复 ≠ 清零`);

  // ---- ⑪b 按下继承锁:手动按下那一拍不滑也按锁向打 ----
  const padB = armPad(0, 0);
  padB.swingLockX = -1;
  const b = runPad(sd, hh, xx, vx, vy, padB, { pressFrame: 0, stopWhen: (s) => s.hits >= 1 });
  ck.ok(b.hits >= 1, `⑪b 按下那一拍真的出球了(命中 ${b.hits})`);
  ck.ok(b.aims[0] === "near",
    `⑪b 有锁按下不滑 = 按锁向打(实得 ${b.aims[0] ?? "无"};必须 near —— press 恢复的就是锁值)`);

  // ---- ⑪c 短滑例外一拍:锁 deep 期间短滑 near,本拍听短滑的,下一拍自动回锁 ----
  const padC = armPad(0, 0);
  padC.swingLockX = 1;
  const c11 = runPad(sd, hh, xx, vx, vy, padC, { maxFrames: 240, pressFrame: 0, pressSwipe: -1, stopWhen: (s) => s.hits >= 2 });
  ck.ok(c11.hits >= 2, `⑪c 两拍都接到了(${c11.hits})`);
  ck.ok(c11.aims[0] === "near",
    `⑪c 锁 deep 期间短滑 near = 本拍听短滑的(实得 ${c11.aims[0] ?? "无"})`);
  ck.ok(c11.aims[1] === "deep",
    `⑪c 短滑打完自动回锁(实得 ${c11.aims[1] ?? "无"};必须 deep —— 锁是默认值,短滑是例外一拍)`);
  ck.ok(c11.swipe === 1, `⑪c 收工时 pad 停在锁向(${c11.swipe}),短滑没有被顶成新锁`);
};

const SECTIONS: Array<{ name: string; run: (ck: Checker) => void }> = [
  { name: "① 起了拍必兑现 + 沉默必归因", run: s1 },
  { name: "② 永不发球", run: s2 },
  { name: "③ 无免费手长", run: s3 },
  { name: "④ 手动优先 / 挥空接得住", run: s4 },
  { name: "⑤ 模式门控", run: s5 },
  { name: "⑥ 关掉就是今天的游戏", run: s6 },
  { name: "⑦ 不加强度 + 瞄准同源", run: s7 },
  { name: "⑧ 每球限次", run: s8 },
  { name: "⑨ 四侧门控同源", run: s9 },
  { name: "⑩ 瞄准一次性 + 已瞄准读数", run: s10 },
  { name: "⑪ 长滑锁定:锁管到短滑解除", run: s11 },
];

// ============================================================
// 反例自检(--selftest):这套尺子有没有牙齿
// ============================================================
type Due = typeof Pl.autoSwingDue;
const originalDue = Pl.autoSwingDue;
const originalOnMatch = AutoHit.onMatch;
// ⑩ 的两条接缝:消耗闸门与徽标基准都挂在 Player 导出面上,反例才换得上去
type Consume = typeof Pl.consumeAutoAim;
type PreviewBase = typeof Pl.previewBase;
const originalConsume = Pl.consumeAutoAim;
const originalBase = Pl.previewBase;

/** 反例 1:不择帧 —— 武装着就起手(会对着够不着/界外/贴地的球乱挥) */
const alwaysDue: Due = () => true;
/** 反例 2:连"握在手里的球"也判成该打 → 发球被代劳 */
const servesTheBall: Due = (p, ball, src) => {
  if (!ball) return false;
  const keep = { held: ball.held, flying: ball.flying, live: ball.live, last: ball.lastHitter };
  // 发球有**四道**不沾(实测:握在手里的球 live=false / held=true / lastHitter=发球方自己,
  // 而 beginPoint 之前还有一段 flying):
  //   live、held、flying 三条状态闸 + lastHitter 挂在发球方身上。
  // 只拆一两道的反例是**哑的**(实测:拆 held 不起拍、再拆 flying 还不起拍)—— 四道全拆才叫
  // "接管发球"。这本身就说明这条不沾是冗余的:改坏任何一条,其余三条还兜着。
  ball.held = false; ball.flying = false; ball.live = true;
  ball.lastHitter = p.side === "left" ? "right" : "left";
  const r = originalDue(p, ball, src);
  ball.held = keep.held; ball.flying = keep.flying; ball.live = keep.live; ball.lastHitter = keep.last;
  return r;
};
/** 反例 3:顺手开了待发窗 → 白吃判定区尾段倍率(免费手长) */
const freeReach: Due = (p, ball, src) => {
  const r = originalDue(p, ball, src);
  if (r) p.lungeAutoT = 30;
  return r;
};
/** 反例 4:偷偷给必中 → 自动比完美手动还准,用户那句"不打折"就是空话 */
const freeGuarantee: Due = (p, ball, src) => {
  const r = originalDue(p, ball, src);
  if (r) p.flashStrikeT = 20;
  return r;
};
/** 反例 5:模式门控漏了 —— 什么模式都代打 */
const modeLeak = (m: string): void => originalOnMatch.call(AutoHit, m === "drill" ? "1p" : m);

const failsOf = (run2: (ck: Checker) => void): number => {
  const c = makeChecker({ printPass: false });
  try { run2(c); } catch { return 1; }
  return c.fails;
};

if (process.argv.includes("--selftest")) {
  console.log("反例自检:改坏的真实写法必须被上面的判据拦住(拦不住 = 这套尺子没牙齿)");
  AutoHit.request(true);
  const find = (n: string): { run: (ck: Checker) => void } => {
    const s = SECTIONS.find((x) => x.name.startsWith(n));
    if (!s) throw Error(`auto-hit-check selftest:找不到段落 ${n}`);
    return s;
  };
  let bad = 0;
  const rawAH = AH as unknown as Record<string, number | string>;
  const cases: Array<{ tag: string; secs: string[]; apply: () => void; undo: () => void }> = [
    {
      // ① 是唯一有牙的网:起了拍不兑现、把界外球捞回来、同一格多起几拍 —— 全在 ① 的账上。
      // (③/⑦/⑧ 不在列:alwaysDue 照样不写 lungeAutoT、照样不加强度、照样被限次收住,
      //  拿它们当反例的落点就是"判据拦不住",而事实是这条反例根本伤不到那三个维度)
      tag: "alwaysDue(不择帧就起手)", secs: ["①"],
      apply: () => { Pl.autoSwingDue = alwaysDue; }, undo: () => { Pl.autoSwingDue = originalDue; },
    },
    {
      tag: "servesTheBall(把发球也代了)", secs: ["②"],
      apply: () => { Pl.autoSwingDue = servesTheBall; }, undo: () => { Pl.autoSwingDue = originalDue; },
    },
    {
      tag: "freeReach(顺手开待发窗 = 白送手长)", secs: ["③"],
      apply: () => { Pl.autoSwingDue = freeReach; }, undo: () => { Pl.autoSwingDue = originalDue; },
    },
    {
      tag: "freeGuarantee(偷偷给必中)", secs: ["⑦"],
      apply: () => { Pl.autoSwingDue = freeGuarantee; }, undo: () => { Pl.autoSwingDue = originalDue; },
    },
    {
      tag: "modeLeak(训练场也代打)", secs: ["⑤"],
      apply: () => { AutoHit.onMatch = modeLeak; Rules.newMatch("1p", "normal"); AutoHit.onMatch("drill"); },
      undo: () => { AutoHit.onMatch = originalOnMatch; Rules.newMatch("1p", "normal"); },
    },
    {
      tag: "machineGun(去掉每球限次)", secs: ["⑧"],
      apply: () => { rawAH.maxTriesPerBall = 9999; },
      undo: () => { rawAH.maxTriesPerBall = 2; },
    },
    {
      tag: "grabsOutBall(界外豁免失效)", secs: ["①"],
      apply: () => { rawAH.autoOutMargin = 99999; },
      undo: () => { rawAH.autoOutMargin = 8; },
    },
    {
      tag: "gateDiverges(四侧门控数值分叉)", secs: ["⑨"],
      apply: () => { rawAH.autoHorizon = 45; },
      undo: () => { rawAH.autoHorizon = 40; },
    },
    {
      tag: "deepAim(代拍偷偷压深,不再等于玩家点按)", secs: ["⑦"],
      apply: () => { rawAH.autoAim = "deep"; },
      undo: () => { rawAH.autoAim = "mid"; },
    },
    // ---------- ⑩ 瞄准一次性:七份反例,每份都对应一种"不会崩、只会安静地不对"的坏法 ----------
    {
      // 从不消耗 = 今天那套锁定态(滑一次之后每一拍都往同一个方向打),用户要改掉的正是它
      tag: "neverConsume(滑动永远粘住 = 玩家说的锁定状态)", secs: ["⑩"],
      apply: () => { Pl.consumeAutoAim = (() => false) as Consume; },
      undo: () => { Pl.consumeAutoAim = originalConsume; },
    },
    {
      // 消耗一切:挥空也吃、AI 也吃、关了也吃 —— 三道闸同时拆掉,⑩b/⑩c/⑩d/⑩e 都该报警
      tag: "consumeAll(不看挥空/AI/开关三道闸)", secs: ["⑩"],
      apply: () => {
        Pl.consumeAutoAim = ((p: PlayerEntity, inp: PlayerInput) => {
          inp.swingSwipe = 0; inp.swingSwipeY = 0; inp.onAimConsume?.(p); return true;
        }) as Consume;
      },
      undo: () => { Pl.consumeAutoAim = originalConsume; },
    },
    {
      tag: "whiffEats(挥空也吞瞄准 = 白罚)", secs: ["⑩"],
      apply: () => {
        Pl.consumeAutoAim = ((p: PlayerEntity, inp: PlayerInput) => {
          if (!AutoHit.on || p.isAI) return false;
          inp.swingSwipe = 0; inp.swingSwipeY = 0; inp.onAimConsume?.(p); return true;
        }) as Consume;
      },
      undo: () => { Pl.consumeAutoAim = originalConsume; },
    },
    {
      tag: "aiEats(CPU 打一拍吃掉真人的瞄准)", secs: ["⑩"],
      apply: () => {
        Pl.consumeAutoAim = ((p: PlayerEntity, inp: PlayerInput, struck: boolean) => {
          if (!AutoHit.on || !struck) return false;
          inp.swingSwipe = 0; inp.swingSwipeY = 0; inp.onAimConsume?.(p); return true;
        }) as Consume;
      },
      undo: () => { Pl.consumeAutoAim = originalConsume; },
    },
    {
      // 只清 pad 不清本步那份输入快照:收招帧被 swingBuf 接续下一拍时又吃一次 ⇒ 一滑两拍
      tag: "leakSnapshot(不清 inp ⇒ 同一帧续拍再吃一次)", secs: ["⑩"],
      apply: () => {
        Pl.consumeAutoAim = ((p: PlayerEntity, inp: PlayerInput, struck: boolean) => {
          if (!AutoHit.on || !struck || p.isAI) return false;
          inp.onAimConsume?.(p); return true;
        }) as Consume;
      },
      undo: () => { Pl.consumeAutoAim = originalConsume; },
    },
    {
      // 旧式基准:没滑动时回落实体上停着的上一拍 ⇒ 徽标一直报上一拍的落点
      tag: "legacyBase(徽标停在上一拍)", secs: ["⑩"],
      apply: () => {
        Pl.previewBase = ((p: PlayerEntity) => ({ aim: p.swingAim, loft: p.swingLoft })) as PreviewBase;
      },
      undo: () => { Pl.previewBase = originalBase; },
    },
    {
      tag: "labelNoFloor(「自动」被透明度滑杆抹掉)", secs: ["⑩"],
      apply: () => { (AH.padLabel as unknown as { keep: number }).keep = 0; },
      undo: () => { (AH.padLabel as unknown as { keep: number }).keep = 0.8; },
    },
    // ---------- ⑪ 长滑锁定 ----------
    {
      // 旧式清零:收招把 pad 一律归 0(无视锁)—— 长滑锁定整个失效,滑了也只管一拍。
      // pad 函数是 runPad 闭包里的常量,经 padAimRestore 这层间接 selftest 才换得上去。
      tag: "lockWiped(收招无视锁把 pad 清零 = 锁定只管一拍)", secs: ["⑪"],
      apply: () => { padAimRestore = (pad) => { pad.swingSwipe = 0; pad.swingSwipeY = 0; }; },
      undo: () => { padAimRestore = restoreSwingAim; },
    },
  ];
  for (const c of cases) {
    console.log(`\n反例 ${c.tag}:`);
    try {
      c.apply();
      for (const n of c.secs) {
        const fails = failsOf(find(n).run);
        if (fails === 0) { bad++; console.log(`  ✗ ${n} 全绿 —— 这条判据拦不住「${c.tag}」`); }
        else console.log(`  ✓ ${n} 被拦住(${fails} 条报警)`);
      }
    } finally {
      c.undo();
    }
  }
  unseed();
  console.log(bad ? `\n✗ auto-hit-check selftest 失败(${bad} 条)` : "\n✓ auto-hit-check selftest:反例全被拦住");
  process.exit(bad ? 1 : 0);
}

// ============================================================
// 正题
// ============================================================
AutoHit.request(true);
const ck = makeChecker({ verbose: process.argv.includes("-v") });
for (const s of SECTIONS) {
  console.log(`\n--- ${s.name} ---`);
  s.run(ck);
}
AutoHit.reset();
console.log(ck.fails ? `\n✗ auto-hit-check 失败 ${ck.fails} 条` : `\n✓ auto-hit-check 全部通过(${ck.checks} 条)`);
process.exit(ck.fails ? 1 : 0);
