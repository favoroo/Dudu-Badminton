// ============================================================
// 跨步自动回球回归(2026-10-04 新增)。
//
// 背景(用户现场):「点完跨步再去点击打,在手机上操作其实有点不太方便」。
// 触屏上 swing 与 lunge 同排在右边那一簇,两下要在几十毫秒内踩准,误触代价是整分 ——
// 这是纯操作税。现在按下跨步 = 冲过去 + 把这一拍打完。
//
// 这条承诺有四种坏法,全都不会崩、不会报错,只会安静地不好用:
//   ① 替玩家按早了/按晚了     → 挥空,比手动更糟。判据:逐格不许比"完美手动两拍"差
//   ② 替玩家捞该落地的球      → 把对手送的分还回去 / 对着将死的球空挥。判据:该不出手就不出手
//   ③ 抢玩家自己那一拍        → 「我按了击打怎么又挥一下」。判据:手动一按,自动让位
//   ④ 只对真人成立            → AI 也装 lunge、也会自己按键(ai.ts:493-501),给它开就等于
//                              给 CPU 白送一记永不失误的回球;而 serve-check / ai-check 里的
//                              真人替身从不按技能键 —— 那两把尺子量不到,只能在这里钉
// 另修一处旧 bug:p.lungeShotT 曾被 player.ts 两处各减一次,配置 60 帧(=1 秒,与技能文案
// 同源)实际只有 30 帧 —— ⑤ 用逐帧算术钉死,谁再手抖加一行就红。
//
// ⑧(2026-10-04 追加)跳跃中也能释放:真人悬空按跨步 = 空中突进 + 自动回球照样出手;
//    AI 悬空必须被拒(够球范围归 diffs 管)。坏法照样不崩不报错:空中按下没反应(把旧的
//    onGround 闸装回)、AI 白拿空中突进 —— --selftest 各喂一份反例。
//
// 用法:node .tools-build/tools/lunge-check.js [--selftest]
// ============================================================
import { Rules } from "../assets/scripts/core/rules";
import { Player as Pl, ZoneProbe } from "../assets/scripts/core/player";
import { Skills } from "../assets/scripts/core/skills";
import { CFG } from "../assets/scripts/core/config";
import { flightFramesToClosest } from "../assets/scripts/core/physics";
import { Ball, HitOpt, PlayerInput, TeamSide, Player as PlayerEntity } from "../assets/scripts/core/types";
import { makeChecker, Checker } from "./harness";

const C = CFG;
const CO = C.court, LG = C.lunge, SW = C.swing;
/** 真人替身"零反应延迟"的完美按拍帧 = 机制用的同一把尺子(质量峰落在球过判定区心那帧) */
const PERFECT_LEAD = SW.windup + 0.5 + (SW.active - 1) / 2;

const emptyInput = (): PlayerInput => ({
  left: false, right: false, jumpPressed: false, jumpHeld: false,
  swingAim: null, lungePressed: false,
});

/** 站位镜像:左队坐标 ↔ 右队坐标(场地关于 netX 对称,probe.js 也是这个口径) */
const mirror = (x: number): number => CO.netX * 2 - x;

/** 把局面摆成「来球正朝 hero 那侧半场飞」:跳过分发球员的球,只测跨步那一下。
 *  heroLift > 0 把人提到半空(⑧ 空中释放用):y = 地面 - lift、onGround = false,
 *  heroVy 给初始竖速(默认 0 = 悬停起点;-9.8 = 刚起跳的满跳)。 */
function setup(side: TeamSide, h: number, x: number, vx: number, vy: number, heroLift = 0, heroVy = 0): { hero: PlayerEntity; ball: Ball } {
  Rules.newMatch("1p", "normal");
  const R = Rules.R;
  const hero = R.players[side === "left" ? 0 : 1];
  hero.skill = Skills.initSkillState("lunge");
  Skills.resetPoint(hero);
  // 人站回中后场,与球拉开距离 —— 贴脸摆球等于"球本来就在判定区里",测不出跨步换了什么
  hero.x = side === "left" ? CO.netX - 175 : CO.netX + 175;
  hero.y = CO.groundY - heroLift; hero.vx = 0; hero.vy = heroVy; hero.onGround = heroLift <= 0;
  hero.stats.whiffs = 0; hero.stats.hits = 0; hero.stats.lungeShots = 0;

  const ball = R.ball as Ball;
  ball.x = x; ball.y = CO.groundY - h;
  ball.px = ball.x; ball.py = ball.y;
  // vx 恒为「朝 hero 那侧飞」:左半场来球往左(-),右半场来球往右(+)
  ball.vx = side === "left" ? -Math.abs(vx) : Math.abs(vx);
  ball.vy = vy;
  ball.live = true; ball.held = false; ball.owner = null;
  ball.flying = false; ball.flyT = 0;
  ball.lastHitter = side === "left" ? "right" : "left";
  ball.crossed = true; ball.netted = false; ball.shot = null;
  R.state = "RALLY";
  R.timer = 0; R.serveWait = 0;
  R.events.length = 0;
  // 右半场那一半格子默认由 players[1] 守,而 1p 模式下它是 CPU —— 自动回球**刻意**不给 AI
  // (见 s4 的 ④),不在这里把它当人的话,半边网格都是假的失败。本工具量的是玩家侧。
  hero.isAI = false;
  return { hero, ball };
}

interface Cast {
  /** 有没有真的把球打回去 */
  hit: boolean;
  /** 起拍到出球的帧数 */
  frames: number;
  kind: string | null;
  skillKind: string | null;
  /** 出手时带没带跨步加力 */
  lungeShot: boolean;
  q: number;
  aim: string | undefined;
  intoNet: boolean;
  landX: number;
  /** 第一次起拍在第几帧(-1 = 整段没挥拍) */
  swingFrame: number;
  /** 整段里起了几次拍(数"我按了它又挥一下"用) */
  swings: number;
  whiffs: number;
  hits: number;
  lungeAutoLeft: number;
  lungeShotLeft: number;
  /** 起拍那一帧的判定区半径 */
  zoneAtSwing: number;
  /** 起拍那一帧人是否悬空(⑧:自动回球必须真的走空中路径,不是落了地才打) */
  airborneAtSwing: boolean;
}

/** 每一帧决定要不要给 hero 输入:第 0 帧恒按跨步(要关就传 cast:false) */
type Plan = (f: number, hero: PlayerEntity, ball: Ball) => Partial<PlayerInput>;

/** 跨步键的按法:方向朝球(真玩家不会往反方向跨) */
const castKey = (hero: PlayerEntity, ball: Ball): Partial<PlayerInput> => {
  const dir = ball.x > hero.x ? 1 : -1;
  return { skillPressed: true, lungePressed: true, skillDir: dir, lungeDir: dir };
};

/** 按时机环的锚算「还有几帧到判定区心」;null = 这段路上根本够不着 */
const framesToCentre = (hero: PlayerEntity, ball: Ball): number | null => {
  const z = Pl.strikeZone(hero, Math.hypot(ball.vx, ball.vy));
  return flightFramesToClosest(ball, z.x, z.y, z.r, LG.autoHorizon);
};

const MISS: Cast = {
  hit: false, frames: 0, kind: null, skillKind: null, lungeShot: false, q: 0, aim: undefined,
  intoNet: false, landX: 0, swingFrame: -1, swings: 0, whiffs: 0, hits: 0,
  lungeAutoLeft: 0, lungeShotLeft: 0, zoneAtSwing: 0, airborneAtSwing: false,
};

/**
 * 跑一整局"只这一拍":plan 决定 hero 每帧按什么。
 * 走完整 Rules.step,帧序与真机一致(Pl.update → Physics.step → Pl.tryHit),
 * 所以"择帧"量的是真实相位,不是我以为的相位。
 */
function run(side: TeamSide, h: number, x: number, vx: number, vy: number, plan: Plan, maxFrames = 70, heroLift = 0, heroVy = 0): Cast {
  const R = Rules.R;
  const { hero, ball } = setup(side, h, x, vx, vy, heroLift, heroVy);
  let swingFrame = -1, swings = 0, prev = false;
  const acc: Cast = { ...MISS };
  for (let f = 0; f < maxFrames; f++) {
    R.events.length = 0;
    const mine = plan(f, hero, ball);
    Rules.step(R.players.map((p) => (p === hero ? { ...emptyInput(), ...mine } : emptyInput())));
    const swinging = hero.swingT >= 0;
    if (swinging && !prev) {
      swings++;
      if (swingFrame < 0) {
        swingFrame = f;
        acc.zoneAtSwing = Pl.strikeZone(hero, Math.hypot(ball.vx, ball.vy)).r;
        acc.airborneAtSwing = !hero.onGround;
      }
    }
    prev = swinging;
    const e = R.events.find((ev) => ev.t === "hit");
    if (e) {
      return {
        hit: true, frames: f, kind: e.kind as string, skillKind: (e.skillKind as string | null) ?? null,
        lungeShot: !!e.lungeShot, q: e.q as number, aim: e.aim as string | undefined,
        intoNet: !!e.intoNet, landX: e.landX as number, swingFrame, swings,
        whiffs: hero.stats.whiffs, hits: hero.stats.hits,
        lungeAutoLeft: hero.lungeAutoT ?? 0, lungeShotLeft: hero.lungeShotT,
        zoneAtSwing: acc.zoneAtSwing, airborneAtSwing: acc.airborneAtSwing,
      };
    }
    if (R.state !== "RALLY") break;          // 球落地/得分:这一拍没接上
    if (hero.stats.whiffs > 0) break;        // 挥空了,不用再等
  }
  return {
    ...acc, swings, swingFrame, whiffs: hero.stats.whiffs, hits: hero.stats.hits,
    lungeAutoLeft: hero.lungeAutoT ?? 0, lungeShotLeft: hero.lungeShotT,
  };
}

/** 只按一次跨步,别的什么都不按 —— 要验收的就是这个 */
const auto = (side: TeamSide, h: number, x: number, vx: number, vy: number): Cast =>
  run(side, h, x, vx, vy, (f, hero, ball) => (f === 0 ? castKey(hero, ball) : {}));

/** 旧式两拍:跨步 + 玩家自己在"完美帧"点击打(零反应延迟的上限对照) */
const perfect = (side: TeamSide, h: number, x: number, vx: number, vy: number): Cast => {
  let done = false;
  return run(side, h, x, vx, vy, (f, hero, ball) => {
    if (f === 0) return castKey(hero, ball);
    if (!done) {
      const fc = framesToCentre(hero, ball);
      if (fc !== null && fc <= PERFECT_LEAD) { done = true; return { swingAim: "mid" }; }
    }
    return {};
  });
};

/** 空中版一键(⑧):hero 满跳中按下跨步 —— 2026-10-04 起真人悬空可释放 */
const autoAir = (side: TeamSide, h: number, x: number, vx: number, vy: number, lift = 60, heroVy = -9.8): Cast =>
  run(side, h, x, vx, vy, (f, hero, ball) => (f === 0 ? castKey(hero, ball) : {}), 70, lift, heroVy);

/** 空中版完美手动两拍:同一个悬空位,⑧ 的逐格基线(两边同样吃 aimErr.airborne,尺子公平) */
const perfectAir = (side: TeamSide, h: number, x: number, vx: number, vy: number, lift = 60, heroVy = -9.8): Cast => {
  let done = false;
  return run(side, h, x, vx, vy, (f, hero, ball) => {
    if (f === 0) return castKey(hero, ball);
    if (!done) {
      const fc = framesToCentre(hero, ball);
      if (fc !== null && fc <= PERFECT_LEAD) { done = true; return { swingAim: "mid" }; }
    }
    return {};
  }, 70, lift, heroVy);
};

/** 照游戏教的那一帧按(时机环收满 = 提前 reactFrames 补反应)——"认真玩了"的对照 */
const cueTimed = (side: TeamSide, h: number, x: number, vx: number, vy: number): Cast => {
  let done = false;
  return run(side, h, x, vx, vy, (f, hero, ball) => {
    if (f === 0) return castKey(hero, ball);
    if (!done) {
      const fc = framesToCentre(hero, ball);
      if (fc !== null && fc <= PERFECT_LEAD + C.swingCue.reactFrames) { done = true; return { swingAim: "mid" }; }
    }
    return {};
  });
};

/** 凭手感固定延迟补一拍(人手最常见的两种节奏) */
const delayed = (side: TeamSide, h: number, x: number, vx: number, vy: number, at: number): Cast =>
  run(side, h, x, vx, vy, (f, hero, ball) => (f === 0 ? castKey(hero, ball) : f === at ? { swingAim: "mid" } : {}));

// ---------- 网格:高度 × 横向位置 × 来球速度 × 两侧 ----------
// 高度取到 18px:跨步就是为这种"低到快要没"的球存在的,高球站着够得着、测不出差别。
const HEIGHTS = [18, 40, 70, 105, 150, 210];
// 贴网 / 中前场 / 后场 / 贴近底线(左队坐标;右队镜像)。
// 最远那一格取 CO.left + 12 而不是墙内沿:来球定义上是往这块场地里落的,摆在边线外
// (墙与底线之间)的球一开局就是"界外球",量出来全是判据在拒挥,不是机制的账。
const XS = [CO.netX - 30, CO.netX - 150, CO.netX - 250, CO.left + 12];
const VEL: Array<[number, number, string]> = [
  [3, 5, "下坠"], [7, 2, "平快压过来"], [4, -3, "还在上升"], [11, 8, "对方重杀回钻"],
];

interface Cell { side: TeamSide; h: number; x: number; vx: number; vy: number; tag: string }
const cells = (): Cell[] => {
  const list: Cell[] = [];
  for (const side of ["left", "right"] as TeamSide[]) {
    for (const h of HEIGHTS) {
      for (const xb of XS) {
        const x = side === "left" ? xb : mirror(xb);
        for (const [vx, vy, vLabel] of VEL) {
          // 贴近底线那一格只测下落:上升中的球只会直接飞出底线,那是出界不是跨步的锅
          if (xb === CO.left + 12 && vy < 0) continue;
          list.push({ side, h, x, vx, vy, tag: `${side === "left" ? "左" : "右"} h=${h} x=${Math.round(x)} ${vLabel}` });
        }
      }
    }
  }
  return list;
};

/** 只带几何字段的探针(AI 的 entryLead 也这么喂,缺字段一律 `?? 0` 兜底) */
const probeOf = (p: PlayerEntity): ZoneProbe => ({
  x: p.x, y: p.y, facing: p.facing, swingRadius: p.swingRadius, zoneScale: p.zoneScale,
  lungeT: p.lungeT, lungeDir: p.lungeDir, lungeAutoT: p.lungeAutoT,
});

const inOpponentCourt = (side: TeamSide, landX: number): boolean =>
  side === "left" ? landX > CO.netX && landX <= CO.right : landX < CO.netX && landX >= CO.left;

/**
 * 这颗**来球**自己会落在哪儿:界外(对手的失误)与两帧内贴地的球,正确答案都是"别碰"。
 * 手动替身不知道这件事 —— 它会去捞明显出界的球、会在球还没过网时就抡拍,拿它当逐格基线,
 * 量出来的"自动不如手动"全是假账。所以先给每格打上标签,把比较限制在"可救"那一子集。
 */
function incomingTag(side: TeamSide, h: number, x: number, vx: number, vy: number): "界外" | "贴地" | "可救" {
  const { hero, ball } = setup(side, h, x, vx, vy);
  const fut = Pl.ballFuture(hero, ball, LG.autoLandHorizon);
  if (fut.land <= LG.autoLandHorizon
    && (fut.landX < CO.left - LG.autoOutMargin || fut.landX > CO.right + LG.autoOutMargin)) return "界外";
  if (fut.land <= SW.windup + 1) return "贴地";
  return "可救";
}

/**
 * 沉默的理由,拿与机制同一批判据、同一个时机(起拍之前)读到的状态反查。
 * 归不进这几类就是"?!到点了却没起手" —— 那是真 bug,① 会点名。
 */
const silenceWhy = (hero: PlayerEntity, ball: Ball): string => {
  const fc = framesToCentre(hero, ball);
  if (fc === null) return "整段都够不着(最近逼近超出判定区)";
  if (fc > PERFECT_LEAD) return "窗口内始终没到该按的那一帧";
  const fut = Pl.ballFuture(hero, ball, LG.autoLandHorizon);
  if (fut.cross < 0 || fut.cross > SW.windup + SW.active) return "整条命中窗内球都没过网";
  if (fut.land <= LG.autoLandHorizon
    && (fut.landX < CO.left - LG.autoOutMargin || fut.landX > CO.right + LG.autoOutMargin)) return "落点在界外:让它落地收分";
  if (fut.land <= SW.windup + 1) return "球已贴地:救不到,不空挥";
  if (fut.land <= fc + LG.autoSettleGrace) return "球死在结算之前:这一拍结不出来,不空挥";
  return "?! 到点了却没起手";
};

/** 跑一键,顺手记到最后一次评估的沉默理由(取末值:窗口的最后一帧才是"到底该不该按") */
function autoWhy(side: TeamSide, h: number, x: number, vx: number, vy: number): Cast & { why: string } {
  let why = "";
  const r = run(side, h, x, vx, vy, (f, hero, ball) => {
    if (f === 0) return castKey(hero, ball);
    if (!hero.swingBuf && hero.swingT < 0 && (hero.lungeAutoT ?? 0) > 0) why = silenceWhy(hero, ball);
    return {};
  });
  return { ...r, why: r.hit ? "打回对方场内" : r.swings > 0 ? "?! 起了拍却没碰到球" : why || "?! 一帧都没评估(待发窗没开?)" };
}

// ---------- ① 一键兑现:起了拍必须干净,沉默必须有理由 ----------
const s1 = (ck: Checker): void => {
  const GRID = cells();
  const dirty: string[] = [];
  const unexplained: string[] = [];
  const gaveUp: string[] = [];
  const hist = new Map<string, number>();
  const qs: number[] = [];
  let hits = 0, playable = 0, doomed = 0;
  for (const g of GRID) {
    const tag = incomingTag(g.side, g.h, g.x, g.vx, g.vy);
    const a = autoWhy(g.side, g.h, g.x, g.vx, g.vy);
    hist.set(`${tag} → ${a.why}`, (hist.get(`${tag} → ${a.why}`) ?? 0) + 1);
    if (a.hit) {
      hits++; qs.push(a.q);
      const fail = (why: string): void => { dirty.push(`${g.tag} [来球${tag}] → ${why}`); };
      if (tag === "界外") fail("落点界外的来球被替玩家捞回去了(这分本来就该收下)");
      else if (a.swings !== 1) fail(`一次跨步起了 ${a.swings} 次拍`);
      else if (a.skillKind !== "lunge") fail(`skillKind=${a.skillKind}`);
      else if (!a.lungeShot) fail("出球没带跨步加力");
      else if (a.intoNet) fail("这拍会下网");
      else if (!inOpponentCourt(g.side, a.landX)) {
        // 同一格拿"完美手动两拍"再打一次(吃的是一样的跨步加力):
        // 连手动也送出界,那就是 buff 与击球点的问题,不是自动替玩家做了更差的决定。
        const m0 = perfect(g.side, g.h, g.x, g.vx, g.vy);
        if (m0.hit && inOpponentCourt(g.side, m0.landX)) fail(`落点 ${Math.round(a.landX)} 不在对方场内(手动同一格落在 ${Math.round(m0.landX)})`);
      }
      else if (a.lungeShotLeft > 0) fail(`命中后加力窗没消耗(还剩 ${a.lungeShotLeft} 帧)`);
      else if (a.frames > LG.autoWindow + SW.windup + SW.active + 8) fail(`按完 ${a.frames} 帧才出球,太拖`);
      continue;
    }
    if (tag !== "可救") continue;                 // 不该碰的球,沉默就是正确答案
    playable++;
    // 唯一豁免:同一格连"完美手动两拍"也救不到。这套引擎的峰值追账要等球**离开判定区**或走完
    // 窗才结算(见 player.ts tryHit 头注),贴地快死球死在区里 → 谁来按都结不出这一拍。
    // 自动不许比人差,但也不该被要求做到人做不到的事 —— 那会把一整片本来就丢了的分判成 bug。
    const m = perfect(g.side, g.h, g.x, g.vx, g.vy);
    if (!m.hit) { doomed++; continue; }
    if (a.swings > 0) { dirty.push(`${g.tag} → 替玩家起了拍却空挥(完美手动第 ${m.frames} 帧救得到)`); continue; }
    if (a.why.startsWith("?!")) { unexplained.push(`${g.tag} → ${a.why}`); continue; }
    gaveUp.push(`${g.tag} → ${a.why};但完美手动在第 ${m.frames} 帧救到了(q=${m.q.toFixed(2)})`);
  }
  for (const b of dirty.slice(0, 8)) console.log(`  ✗ ${b}`);
  for (const b of unexplained.slice(0, 8)) console.log(`  ✗ ${b}`);
  for (const b of gaveUp.slice(0, 8)) console.log(`  ✗ 放过一格该救的球:${b}`);
  const avg = qs.length ? qs.reduce((x, y) => x + y, 0) / qs.length : 0;
  ck.ok(dirty.length === 0, `① 起拍的 ${hits} 格全部干净:球回对方场内、带加力、命中即消耗、只起一次拍、不捞界外球(平均质量 ${avg.toFixed(2)})`);
  ck.ok(unexplained.length === 0, `① ${unexplained.length} 次出手/沉默说不出玩家认可的理由 —— 自动回球要么兑现、要么说得出为什么不动`);
  ck.ok(gaveUp.length === 0, `① 界内"可救"的 ${playable} 格里放过了 ${gaveUp.length} 格(完美手动救得到、一键没救到)`);
  console.log("   归因:" + [...hist.entries()].sort((p, q) => q[1] - p[1]).map(([k, v]) => `${k} ×${v}`).join("  |  "));
};

// ---------- ② 该不出手:一律不许替玩家挥这一拍 ----------
const s2 = (ck: Checker): void => {
  /** 端到端跑 50 帧,断言整段没起过拍 */
  const noSwing = (why: string, side: TeamSide, h: number, x: number, vx: number, vy: number): void => {
    const r = run(side, h, x, vx, vy, (f, hero, ball) => (f === 0 ? castKey(hero, ball) : {}), 50);
    ck.ok(r.swings === 0 && !r.hit, `② ${why}:替玩家起了 ${r.swings} 次拍(第 ${r.swingFrame} 帧)—— 这就是"莫名挥一下"`);
  };
  // 界外球:让对手失误把这分收下,捞回去等于把到手的分再还给人家。
  // 这条不是摆样子:这球 fc=7(正该按的一帧)、判定区也够得着,但按真实积分它会飞到
  // 底线外落地(x≈14 < CO.left=90)。少了出界这一闸,系统会替玩家把对手的失误救回去。
  noSwing("又平又快、穿过判定区仍要出界的球", "left", 60, CO.netX - 40, 15, -6);
  // 永远进不了判定区的球(高过伸手上限、从头顶掠走):为兑现机制挥空一拍比不挥更难看
  noSwing("整段路上都够不着的球", "left", 250, CO.netX - 26, 7, -2);
  // 球在对方半场(隔网不许够)
  noSwing("球在对方半场", "left", 90, CO.netX + 150, 3, 2);
  // 贴地已在脚下将死:挥拍最早也在第 2 帧才碰得到,球已经在地上了
  noSwing("脚下已经贴地的死球", "left", 4, CO.netX - 190, 1, 6);
  // 自家球:同队一回合只许击球一次,起拍了必然挥空
  {
    const R = Rules.R;
    const { hero, ball } = setup("left", 90, CO.netX - 150, 6, 2);
    ball.lastHitter = hero.side;
    const dir = ball.x > hero.x ? 1 : -1;
    let swung = false;
    for (let f = 0; f < 50; f++) {
      R.events.length = 0;
      Rules.step(R.players.map((p) => {
        const inp = emptyInput();
        if (p === hero && f === 0) { inp.skillPressed = true; inp.lungePressed = true; inp.skillDir = dir; inp.lungeDir = dir; }
        return inp;
      }));
      if (hero.swingT >= 0) swung = true;
      if (R.state !== "RALLY") break;
    }
    ck.ok(!swung, "② 自家刚击出的球 → 不许起起拍");
  }
  // 握在手上的发球、得分后飞回手里的球:判据层直接拒(端到端摆这两种状态会踩 rules 的持球分支)
  {
    const { hero, ball } = setup("left", 90, CO.netX - 150, 4, 3);
    hero.lungeAutoT = LG.autoWindow;
    ball.held = true;
    ck.ok(!Pl.autoSwingDue(hero, ball), "② 球握在手上(发球前)→ 判据必须拒");
    ball.held = false; ball.flying = true;
    ck.ok(!Pl.autoSwingDue(hero, ball), "② 得分后球飞回手里 → 判据必须拒");
    ball.flying = false; ball.live = false;
    ck.ok(!Pl.autoSwingDue(hero, ball), "② 死球 → 判据必须拒");
    ball.live = true;
  }
  // 门槛没动:跨步键仍随时可按下当位移(不看球),冷却中/挥拍中不重复起手
  {
    const { hero, ball } = setup("left", 90, CO.netX - 150, 3, 2);
    ck.ok(Skills.canActivate(hero, ball), "② 空的来球状态下跨步键按不下去(位移用法被打死了)");
    hero.skill!.cd = 5;
    ck.ok(!Skills.canActivate(hero, ball), "② 冷却中跨步键必须拒绝");
    hero.skill!.cd = 0; hero.swingT = 3;
    ck.ok(!Skills.canActivate(hero, ball), "② 挥拍中跨步键必须拒绝");
  }
};
// ---------- ③ 手动优先:玩家自己按了击打,自动那拍当场让位 ----------
const s3 = (ck: Checker): void => {
  // 先按网格里第一格"一键真的能把球打回来"的球定标 —— 在明知救不到的球上谈让位没有意义
  const GRID = cells();
  const live = GRID.find((c) => auto(c.side, c.h, c.x, c.vx, c.vy).hit);
  if (!live) { ck.ok(false, "③ 找不到任何一格一键能救到的球,这条没法验(先看 ① 的 ✗)"); return; }
  const a0 = auto(live.side, live.h, live.x, live.vx, live.vy);
  let afterPress = -1;
  const manual = run(live.side, live.h, live.x, live.vx, live.vy, (f, hero, ball) => {
    if (f === 0) return castKey(hero, ball);
    if (f === a0.swingFrame) return { swingAim: "near" };         // 与自动同一帧抢拍
    if (f === a0.swingFrame + 1) afterPress = hero.lungeAutoT ?? -1;
    return {};
  });
  console.log(`   定标格:${live.tag}(一键在第 ${a0.swingFrame} 帧起拍、第 ${a0.frames} 帧出球)`);
  ck.ok(manual.hit, `③ 手动接管那一拍根本没打出去(${live.tag})`);
  ck.ok(manual.aim === "near", `③ 手动那一拍的落点变成了 ${manual.aim}(玩家说的短球没算数)`);
  ck.ok(manual.swings === 1, `③ 这一分里起了 ${manual.swings} 次拍(手动 + 自动各一下 = "我按了它又挥一下")`);
  ck.ok(afterPress === 0, `③ 玩家按下击打那一帧之后待发窗还剩 ${afterPress} 帧(应当场清零)`);
  // 提前抢拍:玩家在自动之前就先按,自动那拍更要闭嘴
  const early = run(live.side, live.h, live.x, live.vx, live.vy, (f, hero, ball) => {
    if (f === 0) return castKey(hero, ball);
    if (f === 1) return { swingAim: "deep" };
    return {};
  });
  ck.ok(early.swings <= 1, `③ 玩家第 1 帧就先按了击打,后面还多起了 ${early.swings - 1} 次拍`);
};

// ---------- ④ 判定区:冲量期吃满、待发窗吃尾段、窗口走完回落、AI 侧恒不延 ----------
const s4 = (ck: Checker): void => {
  const R = Rules.R;
  // 摆一颗"整段都够不着"的球:这一段只量判定区随时间怎么变,不该被自动起拍打断
  const { hero, ball } = setup("left", 250, CO.netX - 26, 7, -2);
  // 站立大小用同一个 hero 在起手前量(再 setup 一次会把这个世界换掉 —— 别在跑着的循环里重摆局)
  const speed = Math.hypot(ball.vx, ball.vy);
  const standing = Pl.strikeZone(probeOf(hero), speed).r;
  const radii: number[] = [];
  for (let f = 0; f < LG.autoWindow + 8; f++) {
    Rules.step(R.players.map((p) => {
      const inp = emptyInput();
      if (p === hero && f === 0) { inp.skillPressed = true; inp.lungePressed = true; inp.skillDir = 1; inp.lungeDir = 1; }
      return inp;
    }));
    if (hero.swingT >= 0) break;              // 起拍了就是挥拍期,不再量
    radii.push(Pl.strikeZone(hero, Math.hypot(ball.vx, ball.vy)).r);
  }
  const burst = radii[0];
  const tail = radii[LG.duration + 1];
  const after = radii[radii.length - 1];
  ck.ok(burst !== undefined && burst >= standing * LG.reachMul - 1e-6,
    `④ 冲量期判定区只有 ${burst?.toFixed(1)}(该是站立 ${standing.toFixed(1)} × ${LG.reachMul})`);
  ck.ok(tail !== undefined && Math.abs(tail - standing * LG.reachTailMul) < 1e-6,
    `④ 待发窗尾段应回落到站立 × ${LG.reachTailMul} = ${(standing * LG.reachTailMul).toFixed(1)},实得 ${tail?.toFixed(1)}`);
  ck.ok(after <= standing + 1e-6, `④ 窗口走完后判定区没回落(${after?.toFixed(1)} > 站立 ${standing.toFixed(1)})—— 那等于永久加长手臂`);
  // 尾段必须撑得住"该打的那一拍":自动起拍那一帧仍带着倍率(拿同一条 fixture 的站立大小比)
  const f2 = setup("left", 90, CO.netX - 150, 4, 3);
  const stand2 = Pl.strikeZone(probeOf(f2.hero), Math.hypot(f2.ball.vx, f2.ball.vy)).r;
  const a = auto("left", 90, CO.netX - 150, 4, 3);
  ck.ok(a.zoneAtSwing > stand2, `④ 自动起拍那一帧判定区已经缩回站立大小(${a.zoneAtSwing.toFixed(1)} ≤ ${stand2.toFixed(1)})—— 自己判成够得着再缩手,就是挥空`);
  // AI 侧:也装 lunge、也会自己按键,冲量期照旧吃满(那是旧行为),但绝不该拿到待发窗与尾段
  const cpu = R.players[0] === hero ? R.players[1] : R.players[0];
  cpu.skill = Skills.initSkillState("lunge");
  Skills.resetPoint(cpu);
  cpu.isAI = true;
  cpu.onGround = true; cpu.swingT = -1; cpu.lungeT = -1;
  const cpuStanding = Pl.strikeZone(probeOf(cpu), 6).r;
  ck.ok(Skills.activate(cpu, R.ball as Ball, cpu.facing), "④ AI 侧连技能都没放出去,后面三条白测");
  ck.ok((cpu.lungeAutoT ?? 0) === 0, `④ AI 也拿到了自动回球窗(${cpu.lungeAutoT} 帧)—— 那等于给 CPU 白送永不失误的回球,准头该归 diffs 管`);
  ck.ok(Math.abs(Pl.strikeZone(probeOf(cpu), 6).r - cpuStanding * LG.reachMul) < 1e-6,
    `④ AI 跨步当帧判定区不是冲量档(${Pl.strikeZone(probeOf(cpu), 6).r.toFixed(1)} vs ${(cpuStanding * LG.reachMul).toFixed(1)})`);
  cpu.lungeT = -1;              // 推到冲量结束之后:再看尾段有没有偷偷给 AI
  ck.ok(Math.abs(Pl.strikeZone(probeOf(cpu), 6).r - cpuStanding) < 1e-6,
    `④ AI 侧判定区拿到了尾段倍率(${Pl.strikeZone(probeOf(cpu), 6).r.toFixed(1)} vs 站立 ${cpuStanding.toFixed(1)})`);};

// ---------- ⑤ 计时器每帧只减一次(旧 bug:两处各减,1 秒变 0.5 秒) ----------
const s5 = (ck: Checker): void => {
  const R = Rules.R;
  const { hero, ball } = setup("left", 90, CO.wallL + 30, 0.5, 0.5);   // 永远够不着的球:只排计时
  hero.x = CO.netX - 40; ball.x = CO.wallL + 40; ball.vx = -0.2; ball.vy = 0.2;
  const N = 8;
  for (let f = 0; f < N; f++) {
    Rules.step(R.players.map((p) => {
      const inp = emptyInput();
      if (p === hero && f === 0) { inp.skillPressed = true; inp.lungePressed = true; inp.skillDir = 1; inp.lungeDir = 1; }
      return inp;
    }));
  }
  ck.ok(hero.lungeShotT === LG.shotWindow - N,
    `⑤ 走 ${N} 步后加力窗应是 ${LG.shotWindow - N} 帧,实得 ${hero.lungeShotT}(每帧多减一次就是旧 bug:配置 60 帧、实际 30 帧)`);
  ck.ok((hero.lungeAutoT ?? 0) === LG.autoWindow - N,
    `⑤ 走 ${N} 步后待发窗应是 ${LG.autoWindow - N} 帧,实得 ${hero.lungeAutoT}`);
  Skills.resetPoint(hero);
  ck.ok(hero.lungeShotT === 0 && (hero.lungeAutoT ?? 0) === 0,
    `⑤ resetPoint 没清干净(加力窗 ${hero.lungeShotT}、待发窗 ${hero.lungeAutoT})`);
};

// ---------- ⑥ 球种预告不许偷吃 buff(AGENTS.md 的副作用契约) ----------
const s6 = (ck: Checker): void => {
  const { hero, ball } = setup("left", 90, CO.netX - 150, 4, 3);
  Skills.activate(hero, ball, 1);
  const snap = { shot: hero.lungeShotT, auto: hero.lungeAutoT ?? 0, hits: hero.stats.hits, smashes: hero.stats.smashes, heat: hero.heat, cd: hero.skill!.cd };
  let kind: string | null = null;
  for (let i = 0; i < 8; i++) kind = Pl.previewKind(hero, ball) as string;   // 预告每帧都跑,旧写法第一跑就把 buff 清零
  ck.ok(hero.lungeShotT === snap.shot, `⑥ 预告偷吃了跨步加力窗(${snap.shot} → ${hero.lungeShotT})`);
  ck.ok((hero.lungeAutoT ?? 0) === snap.auto, `⑥ 预告偷吃了待发窗(${snap.auto} → ${hero.lungeAutoT})`);
  ck.ok(hero.stats.hits === snap.hits && hero.stats.smashes === snap.smashes && hero.heat === snap.heat && hero.skill!.cd === snap.cd,
    "⑥ 预告在记账(统计或冷却被洗白)");
  const real = Pl.buildShot(hero, ball, { q: 1 - C.sweet.coreRatio, sweet: true, dEdge: 0, lungeShot: hero.lungeShotT > 0 }).kind;
  ck.ok(kind === real, `⑥ 预告说 ${kind}、实打是 ${real}(击球键上方的徽标在撒谎)`);
};

// ---------- ⑦ 一键 vs 两拍:自动到底比"凭手感补一拍"稳多少 ----------
// 不设硬阈值,只印数(量的是"这条机制值不值得存在")。护栏一条:一键不许比
// 任何对照差 —— 差了就说明系统在替玩家帮倒忙。
const s7 = (ck: Checker): void => {
  // 只量"来球界内、值得救"的那部分场地:基线是个死按的替身,界外球与贴地球它也算"救到",
  // 那种格子上比出来的"一键不如手动"是假账(一键按规则**不该**去碰它们)。
  const probe = cells().filter((g) => incomingTag(g.side, g.h, g.x, g.vx, g.vy) === "可救");
  const rate = (f: (c: Cell) => Cast): { ok: number; q: number } => {
    let ok = 0, sum = 0;
    for (const c of probe) { const r = f(c); if (r.hit) { ok++; sum += r.q; } }
    return { ok, q: ok ? sum / ok : 0 };
  };
  const variants: Array<[string, { ok: number; q: number }]> = [
    ["只按一次跨步(自动择帧)", rate((c) => auto(c.side, c.h, c.x, c.vx, c.vy))],
    ["跨步 + 完美帧手动补拍(上限)", rate((c) => perfect(c.side, c.h, c.x, c.vx, c.vy))],
    ["跨步 + 按时机环提示补拍", rate((c) => cueTimed(c.side, c.h, c.x, c.vx, c.vy))],
    ["跨步 + 固定第 8 帧补拍", rate((c) => delayed(c.side, c.h, c.x, c.vx, c.vy, 8))],
    ["跨步 + 固定第 14 帧补拍", rate((c) => delayed(c.side, c.h, c.x, c.vx, c.vy, 14))],
    ["什么都不做", rate((c) => run(c.side, c.h, c.x, c.vx, c.vy, () => ({})))],
  ];
  for (const [name, v] of variants) console.log(`   ${name}:${v.ok}/${probe.length} 救到、平均质量 ${v.q.toFixed(2)}`);
  // 落点深浅:用户要的是"默认压深"。0.92(deep)实测会把贴地救球送出对方底线,0.8 是拐点。
  // 这里钉两件事:一键的平均落点深度要真的偏深(>= 0.65),且一格都不许送出界。
  const depths: number[] = [];
  let outOfCourt = 0;
  for (const c of probe) {
    const r = auto(c.side, c.h, c.x, c.vx, c.vy);
    if (!r.hit) continue;
    const d = c.side === "left"
      ? (r.landX - CO.netX) / (CO.right - CO.netX)
      : (CO.netX - r.landX) / (CO.netX - CO.left);
    if (d < 0 || d > 1) { outOfCourt++; continue; }
    depths.push(d);
  }
  const meanD = depths.length ? depths.reduce((x, y) => x + y, 0) / depths.length : 0;
  console.log(`   一键落点:平均压到对方场地 ${(meanD * 100).toFixed(0)}% 深处、送出界 ${outOfCourt} 格`);
  ck.ok(outOfCourt === 0, `⑦ 一键不许把救球送出对方底线(实得 ${outOfCourt} 格出界;autoAim=${LG.autoAim})`);
  ck.ok(meanD >= 0.65, `⑦ 一键"默认压深"要名副其实:平均落点 ≥65% 深(实得 ${(meanD * 100).toFixed(0)}%,autoAim=${LG.autoAim})`);
  const best = Math.max(...variants.slice(1, 5).map(([, v]) => v.ok));
  const bestQ = Math.max(...variants.slice(1, 5).map(([, v]) => v.q));
  // 容差 2 格:buildShot 的落点误差带 Math.random(aimErr.base),同一格两次跑会翻边。
  // 逐格的"手动救得到而一键没救到"已经由 ③ 钉死,这里的容差只放过噪声,不放过回退。
  ck.ok(variants[0][1].ok >= best - 2, `⑦ 一键不许比手动补拍最好的节奏少救 2 格以上(实得 ${variants[0][1].ok} vs ${best})`);
  ck.ok(variants[0][1].q >= bestQ - 0.06, `⑦ 一键平均质量不许低于手动最佳节奏 0.06 以上(实得 ${variants[0][1].q.toFixed(2)} vs ${bestQ.toFixed(2)})`);
};

// ---------- ⑧ 跳跃中也能释放:空中按下 = 空中突进 + 自动回球照样出手(2026-10-04) ----------
const s8 = (ck: Checker): void => {
  // ⑧-a 真人悬空按下:canActivate 放行,冲量/加力窗/待发窗三件套照开
  {
    const R = Rules.R;
    const { hero, ball } = setup("left", 90, CO.netX - 150, 4, 3, 60, -9.8);
    ck.ok(!hero.onGround, "⑧ 摆位自检:hero 确实悬空");
    ck.ok(Skills.canActivate(hero, ball), "⑧ 真人悬空跨步键必须按得下去(旧 onGround 闸已拆)");
    const vxBefore = hero.vx;
    ck.ok(Skills.activate(hero, ball, 1), "⑧ 空中 activate 必须成功");
    ck.ok(hero.vx - vxBefore >= LG.speed - 1e-6, `⑧ 空中冲量必须照给(Δvx=${(hero.vx - vxBefore).toFixed(1)})`);
    ck.ok(hero.lungeShotT === LG.shotWindow, "⑧ 空中释放加力窗照开");
    ck.ok((hero.lungeAutoT ?? 0) === LG.autoWindow, "⑧ 空中释放待发窗照开(真人)");
    // ⑧-e 空中计时器逐帧只减一次(⑤ 的算术在空中同样成立):
    // 把球挪去对方半场远处(那还是 CPU 自己击出的球,它不会追 own ball),8 帧内谁也碰不到
    ball.x = CO.netX + 150; ball.px = ball.x; ball.vx = -3; ball.vy = 1;
    for (let f = 0; f < 8; f++) {
      R.events.length = 0;
      Rules.step(R.players.map((p) => emptyInput()));
    }
    ck.ok(hero.lungeShotT === LG.shotWindow - 8, `⑧ 空中加力窗 8 帧只减 8(实得 ${hero.lungeShotT})`);
    ck.ok((hero.lungeAutoT ?? 0) === LG.autoWindow - 8, `⑧ 空中待发窗 8 帧只减 8(实得 ${hero.lungeAutoT})`);
  }
  // ⑧-b AI 悬空必须被拒,落地照常可跨
  {
    const { hero, ball } = setup("left", 90, CO.netX - 150, 4, 3, 60, -9.8);
    hero.isAI = true;
    ck.ok(!Skills.canActivate(hero, ball), "⑧ AI 悬空跨步必须拒绝(够球范围归 diffs 管,不白送)");
    hero.onGround = true;
    ck.ok(Skills.canActivate(hero, ball), "⑧ AI 落地照常可跨");
  }
  // ⑧-c 空中网格:满跳中一键兑现,逐格不比「空中完美手动」差。
  // 只测中近场两档 —— 太远的格子人落地了才碰球,量的是地面路径(① 已盖),不算空中释放的账。
  {
    const AIR_YS = [90, 150];
    const AIR_XS = [CO.netX - 120, CO.netX - 60];      // 左队坐标;右队镜像
    const AIR_VEL: Array<[number, number, string]> = [[8, 2, "平快"], [11, 4, "重杀压过来"]];
    const dirty: string[] = [];
    let pfSave = 0, autoSave = 0;
    const qPairs: Array<[number, number]> = [];        // [一键 q, 完美手动 q](两边都命中的格子)
    for (const side of ["left", "right"] as TeamSide[]) {
      for (const h of AIR_YS) {
        for (const xb of AIR_XS) {
          const x = side === "left" ? xb : mirror(xb);
          for (const [vx, vy, vLabel] of AIR_VEL) {
            const tag = `${side === "left" ? "左" : "右"} h=${h} x=${Math.round(x)} ${vLabel}`;
            const m = autoAir(side, h, x, vx, vy);
            const pf = perfectAir(side, h, x, vx, vy);
            if (pf.hit) pfSave++;
            if (m.hit) autoSave++;
            if (m.hit && pf.hit) qPairs.push([m.q, pf.q]);
            if (!pf.hit && !m.hit) continue;           // 空中谁都救不到的格子不进账
            if (pf.hit && !m.hit) { dirty.push(`${tag} → 空中完美手动救得到(q=${pf.q.toFixed(2)}),一键没打回来`); continue; }
            const fail = (why: string): void => { dirty.push(`${tag} → ${why}`); };
            if (m.swings !== 1) fail(`一次跨步起了 ${m.swings} 次拍`);
            else if (!m.lungeShot) fail("出球没带跨步加力");
            else if (m.intoNet) fail("这拍会下网");
            else if (!inOpponentCourt(side, m.landX)) {
              // 同 ① 的豁免:连空中完美手动也送出界的格子,是击球点的事,不是自动做了更差的决定
              if (pf.hit && inOpponentCourt(side, pf.landX)) fail(`落点 ${Math.round(m.landX)} 不在对方场内(手动同一格落在 ${Math.round(pf.landX)})`);
            }
            else if (m.lungeShotLeft > 0) fail(`命中后加力窗没消耗(还剩 ${m.lungeShotLeft} 帧)`);
          }
        }
      }
    }
    for (const b of dirty.slice(0, 8)) console.log(`  ✗ ${b}`);
    ck.ok(dirty.length === 0, `⑧ 空中网格 ${autoSave}/${pfSave} 格干净:一键兑现、带加力、命中即消耗、落对方场内`);
    ck.ok(autoSave >= pfSave, `⑧ 一键的空中救球数不许比「空中完美手动」少(实得 ${autoSave} vs ${pfSave})`);
    if (qPairs.length) {
      const aQ = qPairs.reduce((s, p) => s + p[0], 0) / qPairs.length;
      const pQ = qPairs.reduce((s, p) => s + p[1], 0) / qPairs.length;
      ck.ok(aQ >= pQ - 0.06, `⑧ 空中一键平均质量不许低于空中手动 0.06 以上(实得 ${aQ.toFixed(2)} vs ${pQ.toFixed(2)})`);
    }
  }
  // ⑧-d 满跳中球贴脸快压过来:起拍那一帧人必须还在空中 —— 自动回球真的走空中路径,
  // 不是"根本没飞起来、落了地才打"(那样 ⑧-a 的三件套断言会过,但空中释放名存实亡)
  {
    const near = autoAir("left", 120, CO.netX - 130, 11, 3);
    ck.ok(near.hit, "⑧ 贴脸快球:空中一键必须打回来");
    ck.ok(near.airborneAtSwing, "⑧ 起拍那一帧人必须还在空中(落地才起拍 = 空中路径没走通)");
  }
};

// ---------- 段落表 ----------
interface Section { name: string; run: (ck: Checker) => void }
const SECTIONS: Section[] = [
  { name: "① 只按一次跨步就把球打回去(6 高度 × 4 位置 × 4 来球速度 × 两侧)", run: s1 },
  { name: "② 该不出手的场合一律不起拍(界外球 / 将死低球 / 隔网 / 自家球 / 握在手上)", run: s2 },
  { name: "③ 玩家自己按了击打 = 自动那拍当场让位", run: s3 },
  { name: "④ 判定区:冲量期吃满、待发窗吃尾段、窗口走完回落、AI 侧恒不延", run: s4 },
  { name: "⑤ 计时器每帧只减一次(旧 bug:配置 60 帧实际 30 帧)", run: s5 },
  { name: "⑥ 球种预告不许偷吃 buff,徽标不许撒谎", run: s6 },
  { name: "⑦ 一键 vs 两拍:自动该不比「凭手感补一拍」差", run: s7 },
  { name: "⑧ 跳跃中也能释放:空中突进 + 自动回球照样出手、AI 悬空被拒", run: s8 },
];

// ---------- 反例自检(--selftest):这套尺子有没有牙齿 ----------
const originalDue = Pl.autoSwingDue;
const originalModify = Skills.modifyShot;
type Due = typeof Pl.autoSwingDue;
type Modify = typeof Skills.modifyShot;

/** 反例 A:不择帧 —— 武装着就起手(旧式"一进区就按"「起跨当帧就按」都算这一类) */
const alwaysDue: Due = () => true;
/** 反例 B:buff 不消耗 —— 一次跨步吃好几拍,与其余四技能口径不一致 */
const noConsume: Modify = (p: PlayerEntity, opt: HitOpt) => {
  const shotT = p?.lungeShotT ?? 0;
  const r = originalModify(p, opt);
  if (p && opt.lungeShot) p.lungeShotT = shotT;
  return r;
};
/** 反例 C:尾段倍率不给(自动起拍那一帧就把判定区缩回站立大小) */
const noTail: Due = (p, ball) => {
  const t = p.lungeAutoT ?? 0;
  p.lungeAutoT = 0;                       // 借 strikeZone 的读侧把尾段关掉
  const r = originalDue(p, ball);
  p.lungeAutoT = t;
  return r;
};

// ⑧ 的反例走 canActivate 猴补丁:player.ts:137 / ai.ts:485 都按 Skills.canActivate 属性
// 查找调用,补丁只动 lunge 分支、其余技能照旧委托 —— 与"把旧闸装回去"是同一件事。
const originalCanAct = Skills.canActivate;
type CanAct = typeof Skills.canActivate;
/** 反例 D:旧的 onGround 闸装回所有人 —— 空中按下没反应,⑧ 必须红 */
const airGateRestored: CanAct = (p, ball) => {
  if (!p || !p.skill) return false;
  if (p.skill.cd > 0) return false;
  if (p.skill.id === "lunge") return p.onGround && p.swingT < 0 && p.lungeT < 0;
  return originalCanAct(p, ball);
};
/** 反例 E:拆掉 AI 空中闸 —— AI 白拿空中突进,⑧ 的 AI 断言必须红 */
const aiAirAllowed: CanAct = (p, ball) => {
  if (!p || !p.skill) return false;
  if (p.skill.cd > 0) return false;
  if (p.skill.id === "lunge") return p.swingT < 0 && p.lungeT < 0;
  return originalCanAct(p, ball);
};

const failsOf = (run2: (ck: Checker) => void): number => {
  const c = makeChecker({ printPass: false });
  run2(c);
  return c.fails;
};

if (process.argv.includes("--selftest")) {
  console.log("反例自检:改坏的真实写法必须被上面的判据拦住(拦不住 = 这套尺子没牙齿)");
  const find = (n: string): Section => {
    const s = SECTIONS.find((x) => x.name.startsWith(n));
    if (!s) throw Error(`lunge-check selftest:找不到段落 ${n}`);
    return s;
  };
  let bad = 0;
  const duePatches: Array<{ tag: string; patch: Due; secs: string[] }> = [
    { tag: "alwaysDue(不择帧就起手)", patch: alwaysDue, secs: ["①", "②"] },
    { tag: "noTail(判定区尾段不给)", patch: noTail, secs: ["①"] },
  ];
  try {
    for (const { tag, patch, secs } of duePatches) {
      console.log(`\n反例 ${tag}:`);
      Pl.autoSwingDue = patch;
      for (const n of secs) {
        const fails = failsOf(find(n).run);
        if (fails === 0) { bad++; console.log(`  ✗ ${n} 全绿 —— 这条判据拦不住「${tag}」`); }
        else console.log(`  ✓ ${n} 被拦住(${fails} 条报警)`);
      }
      Pl.autoSwingDue = originalDue;
    }
    console.log("\n反例 noConsume(一次跨步吃好几拍):");
    Skills.modifyShot = noConsume;
    {
      const fails = failsOf(find("①").run);
      if (fails === 0) { bad++; console.log("  ✗ ① 全绿 —— 拦不住「buff 不消耗」"); }
      else console.log(`  ✓ ① 被拦住(${fails} 条报警)`);
    }
    Skills.modifyShot = originalModify;

    console.log("\n反例 doubleDecrement(计时器每帧多减一次 = 旧 bug 原样):");
    const shotAfter = (extra: boolean): number => {
      const R = Rules.R;
      const { hero, ball } = setup("left", 90, CO.wallL + 30, 0.5, 0.5);
      hero.x = CO.netX - 40; ball.x = CO.wallL + 40; ball.vx = -0.2; ball.vy = 0.2;
      for (let f = 0; f < 8; f++) {
        Rules.step(R.players.map((p) => {
          const inp = emptyInput();
          if (p === hero && f === 0) { inp.skillPressed = true; inp.lungePressed = true; inp.skillDir = 1; inp.lungeDir = 1; }
          return inp;
        }));
        if (extra && hero.lungeShotT > 0) hero.lungeShotT--;
      }
      return hero.lungeShotT;
    };
    const honest = shotAfter(false), legacy = shotAfter(true);
    if (legacy === honest - 8) console.log(`  ✓ ${LG.shotWindow} 帧窗口走完 8 步:诚实版剩 ${honest},旧写法剩 ${legacy} —— ⑤ 的算术就是靠这个差拦住手抖`);
    else { bad++; console.log(`  ✗ 双减模拟没跑出差别(${honest} vs ${legacy}),⑤ 没牙齿`); }

    // 反例 aiGetsAuto(不区分真人/AI):把 isAI 闸拆掉之后,AI 就会拿到待发窗与尾段倍率。
    // 这里直接照"没有那道闸会怎样"演一遍:同一份 activate 走真人分支,尾段就必须挂上。
    console.log("\n反例 aiGetsAuto(不区分真人/AI):");
    {
      const A = setup("left", 90, CO.netX - 150, 4, 3);
      const cpu = A.hero;
      cpu.isAI = false;                       // 假装没有 isAI 闸
      Skills.activate(cpu, A.ball, cpu.facing);
      cpu.lungeT = -1;                        // 推到冲量之后,只看尾段
      const gotWindow = (cpu.lungeAutoT ?? 0) > 0;
      const tailOn = Math.abs(Pl.strikeZone(probeOf(cpu), 6).r
        - Pl.strikeZone({ ...probeOf(cpu), lungeAutoT: 0 }, 6).r * LG.reachTailMul) < 1e-6;
      if (gotWindow && tailOn) console.log("  ✓ 没有那道闸,AI 会同时拿到待发窗与判定区尾段 —— ④ 那两条就是钉它的");
      else { bad++; console.log(`  ✗ 反例没立住(拿到窗 ${gotWindow},尾段 ${tailOn})`); }
    }

    // 反例 airGateRestored / aiAirAllowed:⑧ 的两把钉子(补丁经 Skills.canActivate 属性生效,
    // player.ts:137 的触发路径与 ⑧ 的直接断言都在这条查找上)
    for (const { tag, patch } of [
      { tag: "airGateRestored(旧 onGround 闸装回,空中按下没反应)", patch: airGateRestored },
      { tag: "aiAirAllowed(拆掉 AI 空中闸,AI 白拿空中突进)", patch: aiAirAllowed },
    ]) {
      console.log(`\n反例 ${tag}:`);
      Skills.canActivate = patch;
      const fails = failsOf(find("⑧").run);
      if (fails === 0) { bad++; console.log("  ✗ ⑧ 全绿 —— 拦不住这份改坏"); }
      else console.log(`  ✓ ⑧ 被拦住(${fails} 条报警)`);
      Skills.canActivate = originalCanAct;
    }
  } finally {
    Pl.autoSwingDue = originalDue;
    Skills.modifyShot = originalModify;
    Skills.canActivate = originalCanAct;
  }
  console.log(bad ? "\n✗ lunge-check selftest 失败" : "\n✓ lunge-check selftest:反例全被拦住");
  process.exit(bad ? 1 : 0);
}

const ck = makeChecker();
for (const sec of SECTIONS) {
  console.log(`\n${sec.name}`);
  sec.run(ck);
}
console.log(`\n${ck.fails === 0 ? "✓" : "✗"} lunge-check:${ck.checks} 条断言,${ck.fails} 条失败`);
console.log("（真机手感不在这里:一键跨步要不要留、压深落点顺不顺手,得出 APK 用拇指判）");
process.exit(ck.fails ? 1 : 0);
