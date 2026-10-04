// ============================================================
// 怒气重击(rage:整局攒怒气 + 分档兑现 + 一键代拍)回归 —— 2026-10-04 新增。
//
// 用户提的需求:「和百分百重击机制类似(也可以自动击球),但可以通过击打过程积攒怒气
// (特殊击球怒气积攒得也快一点),攒得越多(有上限)释放时那一拍越强,放完归零。」
//
// 这款技能的坏法**全都不会崩、不会报错、tsc 也不报**,只会安静地不好用:
//   ① 预告通道每真实帧最多跑 10 次 buildShot —— 消耗漏一个 !preview 闸,怒气就被无声抽干
//   ② 分档塌成一档(tierAt 行数与演出表不齐 / rageTierOf 从小往大找 ⇒ 永远返回 0)
//   ③ 一次施放吃掉多拍(兑现不收 armed 窗 ⇒ 攒够一拍又被上一个承诺兑现)
//   ④ 满怒那一拍自己给自己充能(增益读了被 buff 抬起来的 shot.sweet 而不是物理档)
//   ⑤ 释放门槛形同虚设 ⇒ 0 怒气也能放 = 每 20 帧白嫖一记强球
//   ⑥ 怒气住在 PlayerSkillState ⇒ Career.applyToMatch() 整块换对象时无声抹掉
//   ⑦ 跨分留残窗 ⇒ 下一分第一拍被系统替玩家轰出去(凭空多打一拍)
//   ⑧ 手动优先清多了(把 armed 一起清)⇒「我按了技能又自己挥一拍,怒气没了」
//   ⑨ 给 AI 开代拍窗 ⇒ 白送一记永不失误的暴扣,而 serve-check/ai-check 的真人替身
//      从不按技能键 —— 那两把尺子量不到,只能在这里钉死
//
// 反例靠"player.ts 经导出对象调用 Skills.modifyShot / Skills.activate / Player.autoSwingDue"
// 这一点成立(属性赋值在调用期生效)。哪天改成具名 import 直调,这里的 patch 就失去牙齿。
//
// 用法:node .tools-build/tools/rage-check.js [--selftest]
// ============================================================
import { Rules } from "../assets/scripts/core/rules";
import { Player as Pl, PRESS_LEAD_FRAMES } from "../assets/scripts/core/player";
import { Skills } from "../assets/scripts/core/skills";
import { CFG } from "../assets/scripts/core/config";
import { flightFramesToClosest } from "../assets/scripts/core/physics";
import {
  Ball, HitOpt, Player as PlayerEntity, PlayerInput, ShotResult, SkillId, TeamSide,
} from "../assets/scripts/core/types";
import { makeChecker, Checker } from "./harness";

const C = CFG;
const CO = C.court, RG = C.skills.rage, SW = C.swing;
const ARM = RG.releaseWindow;
const CD = Skills.defOf("rage").cooldownFrames;
const PERFECT_LEAD = SW.windup + 0.5 + (SW.active - 1) / 2;

const idleInput = (): PlayerInput => ({
  left: false, right: false, jumpPressed: false, jumpHeld: false,
  swingAim: null, lungePressed: false,
});

/** 状态快照:预告必须一个字节都不动它(比逐条断言更难被"漏一个字段"糊过去) */
const snap = (p: PlayerEntity): string => JSON.stringify({
  rage: p.rage ?? 0,
  buffT: p.skill ? p.skill.buffT : -1,
  cd: p.skill ? p.skill.cd : -1,
  autoT: p.rageAutoT ?? 0,
  smashes: p.stats.smashes,
  hits: p.stats.hits,
  sweets: p.stats.sweets,
  perfects: p.stats.perfects,
  heat: p.heat,
});

/** 摆好场地与一名装了怒气重击的真人;球钉在判定区心 */
function scene(skill: SkillId = "rage"): { hero: PlayerEntity; ball: Ball } {
  Rules.newMatch("1p", "normal");
  const R = Rules.R;
  const hero = R.players[0];
  hero.skill = Skills.initSkillState(skill);
  hero.rage = 0;
  Skills.resetPoint(hero);
  hero.x = CO.netX - 170; hero.y = CO.groundY;
  hero.vx = 0; hero.vy = 0; hero.onGround = true;
  hero.swingT = -1; hero.swingBest = null; hero.swingHit = false; hero.hitLock = 0;
  hero.swingStyle = "over"; hero.swingAim = C.aimDepth.mid;
  const ball = R.ball as Ball;
  const z = Pl.strikeZone(hero, 5);
  ball.x = z.x; ball.y = z.y;
  ball.px = ball.x; ball.py = ball.y;
  ball.vx = 3; ball.vy = 2;
  ball.live = true; ball.held = false; ball.owner = null;
  ball.flying = false; ball.flyT = 0;
  ball.lastHitter = "right"; ball.crossed = true; ball.netted = false;
  ball.shot = null; ball.magnetPull = null;
  R.state = "RALLY"; R.timer = 0; R.serveWait = 0; R.events.length = 0;
  return { hero, ball };
}

/**
 * 飞行场景:球直线飞向判定区心,late = 相对最佳按拍点晚按几帧(造出非甜蜜的物理拍)。
 * arm = 起拍前把释放按下去;charge = 起手前把怒气摆到多少。
 */
function flight(opts: {
  late?: number; v?: number; aim?: string; skill?: SkillId; arm?: boolean;
  previews?: number; charge?: number;
} = {}): { hero: PlayerEntity; ball: Ball; shot: ShotResult | null } {
  const late = opts.late ?? 0;
  const v = opts.v ?? 8;
  const { hero, ball } = scene(opts.skill ?? "rage");
  hero.rage = opts.charge ?? 0;
  if (opts.arm) {
    if (!Skills.activate(hero, ball)) throw new Error("flight: 怒气释放按不下去(canActivate 拒了)");
  }
  for (let i = 0; i < (opts.previews ?? 0); i++) Pl.previewKind(hero, ball);

  const inp = idleInput();
  inp.swingAim = opts.aim ?? "mid";
  Pl.update(hero, inp, ball);
  const Tc = PRESS_LEAD_FRAMES - late;
  const z = Pl.strikeZone(hero, v);
  // 球速必须显式钉回来:strikeZone 的半径随来球速度变,而 scene() 摆的是另一档速度,
  // 不重置就会拿 v 算圆心、拿 3.6 飞球 —— 甜蜜窗对不上,晚按/准点两组的甜度整个反过来。
  ball.vx = -v; ball.vy = 0;
  ball.x = z.x + v * Tc; ball.y = z.y;
  ball.px = ball.x; ball.py = ball.y;

  let shot: ShotResult | null = null;
  for (let f = 1; f <= 40; f++) {
    Pl.update(hero, idleInput(), ball);
    ball.px = ball.x; ball.py = ball.y;
    ball.x += ball.vx;
    const s = Pl.tryHit(hero, ball);
    if (s && !shot) shot = s;
  }
  return { hero, ball, shot };
}

/** 端到端:走 Rules.step 的真实时序,从 hit 事件里看兑现(game-root 的档位阶梯吃的是它) */
function endToEnd(opts: { charge: number; arm: boolean }): {
  hit: Record<string, unknown> | null; hero: PlayerEntity;
} {
  const { hero, ball } = scene("rage");
  hero.rage = opts.charge;
  hero.x = CO.netX - 210;
  const R = Rules.R;
  const z = Pl.strikeZone(hero, 6);
  ball.x = z.x; ball.y = z.y; ball.px = ball.x; ball.py = ball.y;
  ball.vx = -1.2; ball.vy = 0.8;
  let hit: Record<string, unknown> | null = null;
  let swung = false;
  for (let f = 0; f < 60 && !hit; f++) {
    const mine = idleInput();
    const theirs = idleInput();
    if (f === 0 && opts.arm) mine.lungePressed = true;   // 技能键在 touchpad 里就是 lunge 动作位
    if (f === 3 && !swung) { mine.swingAim = "mid"; swung = true; }
    R.events.length = 0;
    Rules.step([mine, theirs]);
    Pl.previewKind(hero, ball);        // 旧代码偷吃 buff 的就是这一句(game-root 每真实帧都跑)
    const e = R.events.find((x) => x.t === "hit");
    if (e) hit = e as unknown as Record<string, unknown>;
  }
  return { hit, hero };
}

// ---------- ① 球种预告是纯预览:怒气/buff/代拍窗一口都不吃 ----------
function s1(ck: Checker): void {
  const { hero, ball } = scene();
  hero.rage = RG.max;
  const s = hero.skill as NonNullable<PlayerEntity["skill"]>;
  ck.ok(Skills.canActivate(hero, ball), `① 满怒可释放(门槛 ${RG.rageMinRelease},实际 ${hero.rage})`);
  ck.ok(Skills.activate(hero, ball), "① 按得下去");
  ck.ok(s.buffT === ARM, `① 按下开 armed 窗 ${ARM}(实际 ${s.buffT})`);
  ck.ok((hero.rage ?? 0) === RG.max,
    `① **按下不清怒气** —— 清零只在真扣出去那一拍(实际 ${hero.rage})`);
  ck.ok((hero.rageAutoT ?? 0) === Math.min(RG.autoWindow, ARM),
    `① 按下同时开代拍窗(实际 ${hero.rageAutoT})`);
  let pure = true, badge = "";
  for (let i = 0; i < 4; i++) {
    Pl.update(hero, idleInput(), ball);
    const before = snap(hero);
    badge = Pl.previewKind(hero, ball);
    if (snap(hero) !== before) pure = false;
  }
  ck.ok(pure, "① 每记 previewKind 前后怒气/armed/代拍窗/记账逐字段不变");
  ck.ok(badge === "smash", `① 满怒预告不许撒谎:徽标必须报扣杀(实际 ${badge})`);
  ck.ok(s.buffT === ARM - 4, `① buffT 只按模拟步递减(期望 ${ARM - 4},实际 ${s.buffT})`);
  ck.ok(hero.stats.hits === 0, `① 预告不经过 settle ⇒ 一次命中都不记(实际 ${hero.stats.hits})`);
}

// ---------- ② 强度随怒气单调,且只有满怒才必暴扣 + 顶档 ----------
function s2(ck: Checker): void {
  const rows: Array<{ rage: number; boost: number; deg: number; force: boolean; perfect: boolean; tier: number }> = [];
  // 从 rageMinRelease 起算,不含 0:0 怒气根本按不出去(⑤ 专管那条),放进这张表只会得到
  // "加成 0 < 满怒"这种废话断言,还会掩盖真正要量的单调性。
  for (const r of [RG.rageMinRelease, 34, 35, 66, 67, 99, 100]) {
    const { hero, ball } = scene();
    hero.rage = r;
    // 档位要在 modifyShot **之前**读:兑现会把怒气清零,之后再算就恒等于第 0 档
    // (第一版就栽在这儿 —— 断言"覆盖到 1 档",看着像演出表坏了,其实是读的时间点错了)
    const tier = Skills.rageTierOf(Skills.rageRatioOf(hero));
    Skills.activate(hero, ball);
    const opt: HitOpt = { q: 0.3, sweet: false, perfect: false, dEdge: 0 };
    const m = Skills.modifyShot(hero, opt);
    rows.push({ rage: r, boost: m.speedBoost, deg: m.powerDeg, force: m.forceSmash, perfect: !!opt.perfect, tier });
  }
  for (let i = 1; i < rows.length; i++) {
    ck.ok(rows[i].boost >= rows[i - 1].boost - 1e-9 && rows[i].deg >= rows[i - 1].deg - 1e-9,
      `② 怒气 ${rows[i - 1].rage}→${rows[i].rage}:加成不降(${rows[i - 1].boost.toFixed(2)}→${rows[i].boost.toFixed(2)} / ${rows[i - 1].deg.toFixed(1)}°→${rows[i].deg.toFixed(1)}°)`);
    ck.ok(rows[i].tier >= rows[i - 1].tier, `② 档位不降:${rows[i - 1].tier}→${rows[i].tier}`);
  }
  const notFull = rows.filter((x) => x.rage < RG.max);
  ck.ok(notFull.every((x) => !x.force && !x.perfect),
    `② 未满怒**绝不**强制暴扣/顶档(用户口径:攒得越足越狠,不是随时都必杀)`);
  const full = rows[rows.length - 1];
  ck.ok(full.force && full.perfect, "② 满怒:必暴扣 + 顶档质量改写(与重击同一条兑现路径)");
  ck.ok(rows[0].boost > 0 && rows[0].boost < full.boost,
    `② 空怒边缘仍有加成 ${rows[0].boost.toFixed(2)} < 满怒 ${full.boost.toFixed(2)}(读作"这是一记重击",但明显更弱)`);
  // 档位四行都取到得到(0.34 与 0.5 必须不同档 ⇒ 曾经 tierAt 少一段,四档塌成三档)
  const tiers = new Set(rows.map((x) => x.tier));
  ck.ok(tiers.size === RG.tiers.length, `② ${rows.map(r => r.rage).join("/")} 怒气覆盖到 ${tiers.size} 档,演出表有 ${RG.tiers.length} 行`);
}

// ---------- ③ 一次施放只兑现一拍;兑现是整局唯一清零点 ----------
function s3(ck: Checker): void {
  const one = flight({ late: 0, arm: true, charge: RG.max, previews: 3 });
  const shot = one.shot as ShotResult;
  ck.ok(!!one.shot, "③ 这一拍打出去了");
  ck.ok(shot.skillKind === "rage", `③ 上报 skillKind=rage(特效/飘字/震动认这个,实际 ${shot.skillKind})`);
  ck.ok(shot.rageRatio === 1, `③ 结果带怒气比例快照(表现层只能吃这份 —— p.rage 同帧已清零,实际 ${shot.rageRatio})`);
  ck.ok((one.hero.rage ?? 0) === 0, `③ 兑现即清空(实际 ${one.hero.rage})`);
  const s = one.hero.skill as NonNullable<PlayerEntity["skill"]>;
  ck.ok(s.buffT === 0, `③ armed 窗一并关掉:留着它下一拍会被同一个承诺再兑现(实际 ${s.buffT})`);
  ck.ok((one.hero.rageAutoT ?? 0) === 0, `③ 代拍窗收掉(实际 ${one.hero.rageAutoT})`);
  // 再攒一拍、不再按技能:第二拍绝不能带 rage
  Skills.gainRage(one.hero, { sweet: false, perfect: false, smash: false });
  const second = flight({ late: 0, skill: "rage" });
  ck.ok(!second.shot || second.shot.skillKind !== "rage",
    `④ 没重按技能就没有第二次兑现(实际 ${second.shot ? second.shot.skillKind : "-"})`);
}

// ---------- ④ 攒怒气只吃物理档,不吃 buff 抬上去的顶档 ----------
function s4(ck: Checker): void {
  const late = flight({ late: 9 });                       // 晚按 9 帧:物理上不甜
  ck.ok(!!late.shot, "④ 晚按这一拍打出去了");
  ck.ok(late.shot!.sweet === false && late.shot!.perfect === false,
    `④ 对照组:晚按 9 帧物理上不甜(实际 sweet=${late.shot!.sweet})`);
  ck.ok((late.hero.rage ?? 0) === RG.perHit,
    `④ 不甜那一拍只涨底数 ${RG.perHit}(实际 ${late.hero.rage})`);
  ck.ok(late.hero.stats.sweets === 0, `④ 甜蜜统计不被洗(实际 ${late.hero.stats.sweets})`);

  const onTime = flight({ late: 0 });
  ck.ok(!!onTime.shot && onTime.shot.sweet === true, `④ 对照组:准点那一拍物理档就是甜(实际 ${onTime.shot ? onTime.shot.sweet : "-"})`);
  ck.ok((onTime.hero.rage ?? 0) === Math.round(RG.perHit * RG.sweetMul),
    `④ 踩准加倍 = ${RG.perHit}×${RG.sweetMul}(实际 ${onTime.hero.rage})`);

  // 满怒那一拍被 buff 抬成顶档,但它**整口不攒**:释放自己不能给自己充能
  const fired = flight({ late: 9, arm: true, charge: RG.max });
  ck.ok(fired.shot!.perfect === true, `④ 满怒拍被抬到顶档(兑现的应有之义,实际 ${fired.shot!.perfect})`);
  ck.ok((fired.hero.rage ?? 0) === 0,
    `④ 释放那一拍一口不攒(否则"越攒越快"变成"永远满管",实际 ${fired.hero.rage})`);
  ck.ok(fired.hero.stats.sweets === 0 && fired.hero.stats.perfects === 0,
    `④ 顶档改写不进物理统计(三星判据/报表不被技能洗白)`);
}

// ---------- ⑤ 释放门槛:0 怒气按不出去(资源制的白嫖漏洞) ----------
function s5(ck: Checker): void {
  const { hero, ball } = scene();
  hero.rage = 0;
  ck.ok(!Skills.canActivate(hero, ball), "⑤ 空管按不出去(canActivate 拒)");
  ck.ok(Skills.skillBlockReason(hero, ball) === C.skills.blockText.rageLow,
    `⑤ 键面给得出原因「${C.skills.blockText.rageLow}」(实际 ${Skills.skillBlockReason(hero, ball)})`);
  hero.rage = RG.rageMinRelease - 1;
  ck.ok(!Skills.canActivate(hero, ball), `⑤ 差一点也不行(门槛 ${RG.rageMinRelease})`);
  hero.rage = RG.rageMinRelease;
  ck.ok(Skills.canActivate(hero, ball), "⑤ 攒满一拍就能放(用户口径:够一点就能放,不是 1/3 管)");
  ck.ok(RG.rageMinRelease >= RG.perHit, `⑤ 门槛 ${RG.rageMinRelease} >= 每拍底数 ${RG.perHit} ⇒ 这条闸真的拦得住空按`);
}

// ---------- ⑥ 怒气住在 Player:换装/开赛整块换 skill 对象也不丢 ----------
function s6(ck: Checker): void {
  const { hero, ball } = scene();
  for (let i = 0; i < 6; i++) Skills.gainRage(hero, { sweet: true, perfect: false, smash: false });
  const stored = hero.rage ?? 0;
  ck.ok(stored === 6 * Math.round(RG.perHit * RG.sweetMul), `⑥ 攒了 ${stored} 点`);
  // Career.applyToMatch() 干的就是这一句:me.skill = Skills.initSkillState(equippedSkill())
  hero.skill = Skills.initSkillState("rage");
  ck.ok((hero.rage ?? 0) === stored,
    `⑥ 换装重建 skill 对象之后怒气还在(实际 ${hero.rage})—— 住 PlayerSkillState 会被无声抹掉`);
  ck.ok(Skills.canActivate(hero, ball), "⑥ 重建后依然可释放(状态对象不带资源,资源在人身上)");
}

// ---------- ⑦ resetPoint:资源跨分保留,临时窗一律清 ----------
function s7(ck: Checker): void {
  const { hero, ball } = scene();
  for (let i = 0; i < 5; i++) Skills.gainRage(hero, { sweet: false, perfect: false, smash: true });
  const stored = hero.rage ?? 0;
  Skills.activate(hero, ball);                 // 留一个 armed + 代拍窗跨分
  ck.ok((hero.rageAutoT ?? 0) > 0, "⑦ 前置:代拍窗确实开着");
  Skills.resetPoint(hero);
  ck.ok((hero.rage ?? 0) === stored, `⑦ **怒气跨分保留**(用户口径:只有释放才归零;实际 ${hero.rage})`);
  ck.ok((hero.rageAutoT ?? 0) === 0, `⑦ 代拍窗必须清:残窗 = 下一分凭空多打一拍(实际 ${hero.rageAutoT})`);
  ck.ok(hero.skill!.buffT === 0, `⑦ armed 窗归零(实际 ${hero.skill!.buffT})`);
  ck.ok(hero.skill!.cd === 0, `⑦ cd 归零是既有设计(每分都能放),它从来不是这款的门槛(实际 ${hero.skill!.cd})`);
}

// ---------- ⑧ 计时器每帧只减一次 ----------
function s8(ck: Checker): void {
  const { hero, ball } = scene();
  hero.rage = RG.max;
  // 把球挪远,免得代拍当场把它兑现掉(那会掩盖算术)
  ball.x = hero.x + 320; ball.px = ball.x; ball.y = CO.groundY - 120; ball.py = ball.y;
  ball.vx = -3; ball.vy = 0;
  ball.lastHitter = "right";
  Skills.activate(hero, ball);
  const auto0 = hero.rageAutoT ?? 0, buff0 = hero.skill!.buffT;
  for (let f = 0; f < 10; f++) Pl.update(hero, idleInput(), ball);
  ck.ok(auto0 === Math.min(RG.autoWindow, ARM), `⑧ 起手代拍窗 = min(autoWindow, releaseWindow) = ${auto0}`);
  ck.ok((hero.rageAutoT ?? 0) === auto0 - 10,
    `⑧ 走 10 步只减 10(每帧一处递减;两处就会变 20)。期望 ${auto0 - 10},实际 ${hero.rageAutoT}`);
  ck.ok(hero.skill!.buffT === buff0 - 10, `⑧ armed 窗同样只减 10(期望 ${buff0 - 10},实际 ${hero.skill!.buffT})`);
  ck.ok((hero.rage ?? 0) === RG.max, `⑧ 空转不涨不跌怒气(实际 ${hero.rage})`);
}

// ---------- ⑨ 释放失败不罚怒气(挥空 / 窗自己走完) ----------
function s9(ck: Checker): void {
  const { hero, ball } = scene();
  hero.rage = RG.max;
  Skills.activate(hero, ball);
  ball.x = hero.x - 220; ball.y = CO.groundY - 20;
  ball.px = ball.x; ball.py = ball.y;
  const swing = idleInput(); swing.swingAim = "mid";
  for (let f = 0; f < 40; f++) Pl.update(hero, f === 0 ? swing : idleInput(), ball);
  ck.ok(hero.stats.whiffs === 1, `⑨ 这一拍判成挥空(实际 whiffs=${hero.stats.whiffs})`);
  ck.ok((hero.rage ?? 0) === RG.max, `⑨ 挥空不扣怒气:没兑现就不罚玩家(实际 ${hero.rage})`);
  ck.ok(hero.skill!.cd <= CD, `⑨ 拦人的只有 ${CD} 帧防连点,不是长冷却(实际 ${hero.skill!.cd})`);

  // armed 窗自己走完:怒气原封不动
  const t = scene();
  t.hero.rage = RG.max;
  Skills.activate(t.hero, t.ball);
  t.ball.x = t.hero.x + 400; t.ball.px = t.ball.x; t.ball.y = CO.groundY - 150; t.ball.py = t.ball.y;
  t.ball.vx = -1; t.ball.vy = 0;
  for (let f = 0; f <= ARM; f++) Pl.update(t.hero, idleInput(), t.ball);
  ck.ok(t.hero.skill!.buffT === 0, `⑨ 窗确实走完了(实际 ${t.hero.skill!.buffT})`);
  ck.ok((t.hero.rage ?? 0) === RG.max, `⑨ 窗过期不罚怒气,可以再按(实际 ${t.hero.rage})`);
}

// ============================================================
// 一键化网格:口径抄 tools/smash-check.ts,同一把择帧尺子(autoSwingDue src="rage")
// ============================================================
const heroAt = (side: TeamSide): number => side === "left" ? CO.netX - 150 : CO.netX + 150;

function bench(side: TeamSide, h: number, dist: number, vx: number, vy: number): { hero: PlayerEntity; ball: Ball } {
  const R = Rules.R;
  Rules.newMatch("1p", "normal");
  const hero = R.players[side === "left" ? 0 : 1];
  hero.skill = Skills.initSkillState("rage");
  hero.rage = RG.max;
  Skills.resetPoint(hero);
  hero.x = heroAt(side); hero.y = CO.groundY;
  hero.vx = 0; hero.vy = 0; hero.onGround = true;
  hero.swingT = -1; hero.swingBest = null; hero.swingHit = false; hero.hitLock = 0;
  hero.stats.whiffs = 0; hero.stats.hits = 0; hero.stats.smashes = 0;
  const ball = R.ball as Ball;
  const towardNet = side === "left" ? 1 : -1;
  ball.x = hero.x + towardNet * dist; ball.y = CO.groundY - h;
  ball.px = ball.x; ball.py = ball.y;
  ball.vx = -towardNet * Math.abs(vx);
  ball.vy = vy;
  ball.live = true; ball.held = false; ball.owner = null;
  ball.flying = false; ball.flyT = 0;
  ball.lastHitter = side === "left" ? "right" : "left";
  ball.crossed = side === "left" ? ball.x < CO.netX : ball.x > CO.netX;
  ball.netted = false; ball.shot = null; ball.magnetPull = null;
  R.state = "RALLY"; R.timer = 0; R.serveWait = 0; R.events.length = 0;
  hero.isAI = false;
  return { hero, ball };
}

interface Cast {
  hit: boolean; frames: number; swingFrame: number; swings: number; autoStarted: boolean;
  kind: string | null; skillKind: string | null; rageRatio: number | null;
  aim: string | null;
  intoNet: boolean; landX: number; whiffs: number;
  buffLeft: number; autoLeft: number; rageLeft: number; cd: number; silence: string;
}
const MISS: Cast = {
  hit: false, frames: 0, swingFrame: -1, swings: 0, autoStarted: false, kind: null, skillKind: null,
  rageRatio: null, aim: null, intoNet: false, landX: 0, whiffs: 0, buffLeft: 0, autoLeft: 0, rageLeft: 0, cd: 0, silence: "",
};

type Plan = (f: number, hero: PlayerEntity, ball: Ball) => Partial<PlayerInput>;

function run(side: TeamSide, h: number, dist: number, vx: number, vy: number, plan: Plan, maxFrames = 200): Cast {
  const R = Rules.R;
  const { hero, ball } = bench(side, h, dist, vx, vy);
  let swingFrame = -1, swings = 0, prev = false, autoStarted = false;
  const acc = (silence = ""): Cast => ({
    ...MISS, swingFrame, swings, autoStarted, silence,
    whiffs: hero.stats.whiffs, buffLeft: hero.skill ? hero.skill.buffT : 0,
    autoLeft: hero.rageAutoT ?? 0, rageLeft: hero.rage ?? 0, cd: hero.skill ? hero.skill.cd : 0,
  });
  for (let f = 0; f < maxFrames; f++) {
    R.events.length = 0;
    const mine = plan(f, hero, ball);
    Rules.step(R.players.map((p) => (p === hero ? { ...idleInput(), ...mine } : idleInput())));
    const swinging = hero.swingT >= 0;
    if (swinging && !prev) {
      swings++;
      if (swingFrame < 0) { swingFrame = f; autoStarted = !mine.swingAim; }
    }
    prev = swinging;
    const e = R.events.find((x) => x.t === "hit");
    if (e) {
      return {
        ...acc(), hit: true, frames: f, kind: e.kind as string,
        skillKind: (e.skillKind as string | null) ?? null, rageRatio: (e.rageRatio as number | null) ?? null,
        aim: (e.aim as string | null) ?? null,
        intoNet: !!e.intoNet, landX: e.landX as number,
      };
    }
    if (R.state !== "RALLY") break;
    if (hero.stats.whiffs > 0) break;
  }
  // 沉默归因:说不清为什么没出手的格子,就是"按了没反应"的候选
  if (swingFrame < 0) {
    if ((hero.rageAutoT ?? 0) > 0) return acc("代拍窗还开着但择帧判据一直没点头(够不着/没过网/贴地)");
    if (hero.skill!.buffT > 0) return acc("armed 但代拍窗已走完");
    if ((hero.rage ?? 0) === 0) return acc("怒气已清空(这一拍没有承诺要兑现)");
    return acc("未归因");
  }
  return acc("起了拍但没接触(挥空/球先落地)");
}

const oneTap = (g: Cell): Cast => run(g.side, g.h, g.dist, g.vx, g.vy, (f) => (f === 0 ? { skillPressed: true } : {}));

/** 零反应延迟的手动基线:同样先释放,但那一拍由替身在完美帧自己按 */
const perfectManual = (g: Cell): Cast => {
  let done = false;
  return run(g.side, g.h, g.dist, g.vx, g.vy, (f, hero, ball) => {
    if (f === 0) return { skillPressed: true };
    if (!done) {
      const fc = framesToCentre(hero, ball);
      if (fc !== null && fc <= PERFECT_LEAD) { done = true; return { swingAim: "mid" }; }
    }
    return {};
  });
};

const framesToCentre = (hero: PlayerEntity, ball: Ball): number | null => {
  const z = Pl.strikeZone(hero, Math.hypot(ball.vx, ball.vy));
  return flightFramesToClosest(ball, z.x, z.y, z.r, RG.autoHorizon);
};

const HEIGHTS = [30, 60, 95, 130, 175, 215];
const DISTS = [40, 110, 180, 250, 330];
const VEL: Array<[number, number, string]> = [
  [3, 5, "慢下坠"], [7, 2, "平快压过来"], [4, -3, "还在上升"], [11, 8, "对方重杀回钻"],
  [2.6, -0.6, "高远慢球"],
];
interface Cell { side: TeamSide; h: number; dist: number; vx: number; vy: number; tag: string }
const cells = (): Cell[] => {
  const list: Cell[] = [];
  for (const side of ["left", "right"] as TeamSide[]) {
    for (const h of HEIGHTS) {
      for (const dist of DISTS) {
        for (const [vx, vy, vLabel] of VEL) {
          list.push({ side, h, dist, vx, vy, tag: `${side === "left" ? "L" : "R"} h${h} d${dist} ${vLabel}` });
        }
      }
    }
  }
  return list;
};

/** 来球最终会落在对方场内(界外球系统不该替玩家捞) */
const inOpponentCourt = (side: TeamSide, landX: number): boolean =>
  side === "left" ? landX > CO.netX && landX < CO.right : landX < CO.netX && landX > CO.left;

/** 来球自己会落在哪儿:界外(对手的失误)与贴地的球,正确答案都是"别碰"。口径与 smash-check 同一条。 */
function incomingTag(side: TeamSide, h: number, dist: number, vx: number, vy: number): "界外" | "贴地" | "可及" {
  const { hero, ball } = bench(side, h, dist, vx, vy);
  const fut = Pl.ballFuture(hero, ball, RG.autoLandHorizon);
  if (fut.land <= RG.autoLandHorizon
    && (fut.landX < CO.left - RG.autoOutMargin || fut.landX > CO.right + RG.autoOutMargin)) return "界外";
  if (fut.land <= SW.windup + 1) return "贴地";
  return "可及";
}

/** 沉默的理由:拿与机制同一批判据、同一个时机(起拍之前)读到的状态反查。前缀 "?!" = 说不清 = 报警。 */
const silenceWhy = (hero: PlayerEntity, ball: Ball): string => {
  if ((hero.rageAutoT ?? 0) <= 0) return "待发窗已过期(怒气仍保留,可以再按)";
  if (!hero.skill || hero.skill.buffT <= 0) return "?! 待发窗还开着而承诺没了";
  const fc = framesToCentre(hero, ball);
  if (fc === null) return "整段都够不着(最近逼近超出判定区)";
  if (fc > PERFECT_LEAD) return "窗口内始终没到该按的那一帧";
  const fut = Pl.ballFuture(hero, ball, RG.autoLandHorizon);
  if (fut.cross < 0 || fut.cross > SW.windup + SW.active) return "整条命中窗内球都没过网";
  if (fut.land <= RG.autoLandHorizon
    && (fut.landX < CO.left - RG.autoOutMargin || fut.landX > CO.right + RG.autoOutMargin)) return "落点在界外:让它落地收分";
  if (fut.land <= SW.windup + 1) return "球已贴地:救不到,不空挥";
  if (fut.land <= fc + RG.autoSettleGrace) return "球死在结算之前:这一拍结不出来,不空挥";
  return "?! 到点了却没起手";
};

/** 跑一键,顺手记最后一次沉默理由(取末值:窗口的最后一帧才是"到底该不该按") */
function oneTapWhy(g: Cell): Cast & { why: string } {
  let why = "";
  const r = run(g.side, g.h, g.dist, g.vx, g.vy, (f, hero, ball) => {
    if (f === 0) return { skillPressed: true };
    if (hero.swingT < 0 && !hero.swingBuf) why = silenceWhy(hero, ball);
    return {};
  });
  return {
    ...r,
    why: r.hit ? "系统代拍、球回对方场内"
      : r.swings > 0 ? "?! 起了拍却没碰到球" : why || "?! 一帧都没评估(待发窗没开?)",
  };
}

// ---------- ⑩ 一键兑现:只按一次就把这一拍轰出去 ----------
function s10(ck: Checker): void {
  const grid = cells();
  const dirty: string[] = [], unexplained: string[] = [], gaveUp: string[] = [];
  const hist = new Map<string, number>();
  let hits = 0, playable = 0, doomed = 0, ghost = 0, ghostDoomed = 0;
  for (const g of grid) {
    const tag = incomingTag(g.side, g.h, g.dist, g.vx, g.vy);
    const a = oneTapWhy(g);
    hist.set(`${tag} → ${a.why}`, (hist.get(`${tag} → ${a.why}`) ?? 0) + 1);
    if (a.hit) {
      hits++;
      const fail = (why: string): void => { dirty.push(`${g.tag} [来球${tag}] → ${why}`); };
      if (tag === "界外") fail("落点界外的来球被替玩家捞回去了(这分本来就该收下)");
      else if (!a.autoStarted) fail("这一拍不是系统代出的 —— 待发窗没起作用,一键化是假的");
      else if (a.swings !== 1) fail(`一次施放起了 ${a.swings} 次拍(该只代一拍)`);
      else if (a.skillKind !== "rage") fail(`skillKind=${a.skillKind}(飘字/特效/震动都认它)`);
      else if (a.rageRatio === null || a.rageRatio < 1) fail(`满怒代拍却没带 ratio=1 快照(实际 ${a.rageRatio})`);
      else if (a.intoNet) fail("这拍下网");
      else if (!inOpponentCourt(g.side, a.landX)) fail(`落点 ${Math.round(a.landX)} 不在对方场内`);
      else if (a.rageLeft !== 0) fail(`兑现后怒气没清空(还剩 ${a.rageLeft})`);
      else if (a.buffLeft > 0) fail(`兑现后 armed 窗没关(还剩 ${a.buffLeft} 帧)⇒ 下一拍会被同一承诺再兑现`);
      else if (a.frames > RG.autoWindow + SW.windup + SW.active + 8) fail(`按完 ${a.frames} 帧才出球,太拖`);
      continue;
    }
    if (tag !== "可及") {
      if (a.swings > 0) dirty.push(`${g.tag} [来球${tag}] → 替玩家代了一拍却没碰到球(第 ${a.swingFrame} 帧)`);
      continue;
    }
    playable++;
    // 连"零反应延迟的完美手动"也救不到的格子不算账 —— 否则量出来的"自动不如手动"全是假账
    const m = perfectManual(g);
    if (a.swings > 0) { ghost++; if (!m.hit) ghostDoomed++; }
    if (!m.hit) { doomed++; continue; }
    if (a.swings > 0) { dirty.push(`${g.tag} → 替玩家起了拍却空挥(完美手动第 ${m.frames} 帧救得到)`); continue; }
    if (a.why.startsWith("?!")) { unexplained.push(`${g.tag} → ${a.why}`); continue; }
    gaveUp.push(`${g.tag} → ${a.why};但完美手动在第 ${m.frames} 帧救到了`);
  }
  for (const b of dirty.slice(0, 8)) console.log(`  ✗ ${b}`);
  for (const b of unexplained.slice(0, 8)) console.log(`  ✗ ${b}`);
  for (const b of gaveUp.slice(0, 8)) console.log(`  ✗ 放过一格该救的球:${b}`);
  ck.ok(hits > 60, `⑩ 只按一次技能键就代拍兑现 ${hits}/${grid.length} 格(太少 = 功能没生效)`);
  ck.ok(dirty.length === 0, `⑩ 起拍的 ${hits} 格全部干净:系统代拍、带档位快照、命中即清空、只代一拍、不捞界外球`);
  ck.ok(unexplained.length === 0, `⑩ ${unexplained.length} 次沉默说不出玩家认可的理由`);
  ck.ok(gaveUp.length === 0, `⑩ 界内"可及"的 ${playable} 格里放过了 ${gaveUp.length} 格;另有 ${doomed} 格连完美手动也救不到,不算账`);
  ck.ok(ghost === ghostDoomed,
    `⑩ ${ghost} 格代拍挥空,${ghostDoomed} 格落在"连完美手动也打不到"那一档${ghost === ghostDoomed ? "(全部有豁免)" : " —— 有格子在玩家本来打得着的球上空挥"}`);
  console.log(`   统计:代拍兑现 ${hits} 格 / 沉默但有理由 ${playable - ghost - gaveUp.length} 格 / 挥空 ${ghost} 格(全豁免 ${ghostDoomed})`);
  console.log("   归因:" + [...hist.entries()].sort((p, q) => q[1] - p[1]).map(([k, v]) => `${k} ×${v}`).join("  |  "));
}

// ---------- ⑪ 该不出手一律不代拍,且每次沉默都说得出理由 ----------
function s11(ck: Checker): void {
  const R = Rules.R;
  // (a) 自家球:lastHitter 是自己 ⇒ 绝不起手
  {
    const { hero, ball } = bench("left", 120, 120, 5, 2);
    ball.lastHitter = "left";
    hero.rageAutoT = RG.autoWindow; hero.skill!.buffT = ARM;
    let swung = false;
    for (let f = 0; f < 60; f++) {
      Rules.step(R.players.map((p) => idleInput()));
      if (hero.swingT >= 0) swung = true;
    }
    ck.ok(!swung, "⑪ 自家球(刚自己打出去的)绝不代拍");
  }
  // (b) 整张网格:每一格要么出手兑现(⑩ 管),要么沉默且**说得出玩家认可的理由**
  const grid = cells();
  let silent = 0;
  const unknown: string[] = [];
  for (const g of grid) {
    const c = oneTapWhy(g);
    if (c.swingFrame < 0) {
      silent++;
      if (c.why.startsWith("?!") || c.why === "") unknown.push(`${g.tag} → ${c.why}`);
    }
  }
  ck.ok(silent > 0, `⑪ 对照组:确有 ${silent} 格该沉默(高球够不着 / 还在对面天上),否则这条判据是空的`);
  ck.ok(unknown.length === 0, `⑪ 每一次沉默都归因得出,${unknown.length} 格说不清 → ${unknown.slice(0, 3).join(" / ")}`);
  // (c) 空管按不下去 ⇒ 也不该有代拍窗
  {
    const { hero, ball } = bench("left", 120, 120, 5, 2);
    hero.rage = 0;
    ck.ok(!Skills.activate(hero, ball), "⑪ 怒气不足时 activate 直接失败(不留一个空承诺)");
    ck.ok((hero.rageAutoT ?? 0) === 0, `⑪ 失败施放不开代拍窗(实际 ${hero.rageAutoT})`);
  }
}

// ---------- ⑫ 手动优先:代劳让位,但怒气照样砸进去 ----------
function s12(ck: Checker): void {
  const grid = cells();
  let live = 0, keptPromise = 0, wrongAim: string[] = [];
  for (const g of grid) {
    // 第 0 帧按技能,第 6 帧起玩家自己按击打(抢在代拍之前),并往深里瞄
    let done = false;
    const c = run(g.side, g.h, g.dist, g.vx, g.vy, (f, hero, ball) => {
      if (f === 0) return { skillPressed: true };
      if (!done) {
        const fc = framesToCentre(hero, ball);
        if (fc !== null && fc <= PERFECT_LEAD + 4) { done = true; return { swingAim: "far" }; }
      }
      return {};
    });
    if (!done || !c.hit) continue;
    // 只统计"确实是玩家抢下这一拍"的那些格(autoStarted = 系统代拍的,不算抢拍),
    // 分母分子必须同一子集 —— 第一版拿全部命中格当分子、抢拍格当分母,得到 113/71 这种假红
    if (!c.autoStarted) {
      live++;
      if (c.skillKind === "rage") keptPromise++;
      if (c.aim && c.aim !== "far") wrongAim.push(`${g.tag}→${c.aim}`);
    }
  }
  ck.ok(live > 10, `⑫ 对照组:确有 ${live} 格被玩家抢拍(代劳让位),否则这条判据是空的`);
  ck.ok(keptPromise === live,
    `⑫ 抢拍之后怒气仍然砸进去(${keptPromise}/${live})—— 清了 armed 就是"我按了技能又自己挥,结果怒气没了"`);
  ck.ok(wrongAim.length === 0, `⑫ 落点用玩家瞄的那个,${wrongAim.length} 格被自动改 → ${wrongAim.slice(0, 3).join(" / ")}`);
}

// ---------- ⑬ AI 侧口径:拿不到代拍窗、不吃顶档改写 ----------
function s13(ck: Checker): void {
  const { hero, ball } = scene();
  hero.isAI = true;
  hero.rage = RG.max;
  ck.ok(Skills.activate(hero, ball), "⑬ AI 装了 rage 也按得下去(它的技能循环归 diffs 管)");
  ck.ok((hero.rageAutoT ?? 0) === 0,
    `⑬ 但 AI **永远拿不到代拍窗**(实际 ${hero.rageAutoT})—— 给它开等于白送一记永不失误的暴扣,而 serve-check/ai-check 的真人替身从不按技能键,量不到`);
  const opt: HitOpt = { q: 0.3, sweet: false, perfect: false, dEdge: 0 };
  const m = Skills.modifyShot(hero, opt);
  ck.ok(m.forceSmash && m.speedBoost > 0, `⑬ AI 照旧吃 forceSmash/加成(与其余四技能一致)`);
  ck.ok(!opt.perfect && opt.q === 0.3,
    `⑬ AI 不吃顶档改写:准头归 diffs(实际 perfect=${opt.perfect})`);
  // 判定区不放大:开窗/不开窗半径必须逐位相等(代劳的是时机,不是手长)
  const a = scene();
  const b = scene();
  const zA = Pl.strikeZone(a.hero, 6).r;
  (b.hero as PlayerEntity).rageAutoT = RG.autoWindow;
  b.hero.skill!.buffT = ARM;
  const zB = Pl.strikeZone(b.hero, 6).r;
  ck.ok(zA === zB, `⑬  armed/代拍窗不放大判定区(${zA} vs ${zB})—— 与跨步的 reachTailMul 是两回事`);
}

// ---------- ⑭ 一把尺子、四份参数:门控数值不许与跨步/重击/自动击打分叉 ----------
function s14(ck: Checker): void {
  const keys = ["autoHorizon", "autoLandHorizon", "autoOutMargin", "autoSettleGrace"] as const;
  type Gate = { [K in typeof keys[number]]: number };
  // 第四条是全局「自动击打」(core/auto-hit.ts + C.autoHit):同一个 autoSwingDue,多一个 src。
  // 它没有 autoWindow(逐帧轮询,没有窗),所以只并这四条。
  const srcs: [string, Gate][] = [["lunge", C.lunge], ["smash", C.skills.smash], ["rage", RG], ["auto", C.autoHit]];
  for (const k of keys) {
    const set = new Set(srcs.map(([, o]) => o[k]));
    ck.ok(set.size === 1, `⑭ ${k} 四侧同源:${srcs.map(([n, o]) => `${n}=${o[k]}`).join(" / ")}`);
  }
  ck.ok(RG.autoWindow <= RG.releaseWindow, `⑭ autoWindow ${RG.autoWindow} <= releaseWindow ${RG.releaseWindow}(超出去会在没承诺的帧上代一记普通球)`);
  ck.ok(RG.autoReturn === C.lunge.autoReturn, "⑭ 三条一键化总闸同开同关");
  // 实测覆盖度:口径与 smash-check ⑯ 完全一致 —— 只量"可及且完美手动救得到"的格子,
  // 一格都不许因为"窗先走完"而沉默。(第一版在这里手挑了一格 d330/h150 的慢球,
  // 那球落地落得比跑到还早,谁来都够不着 —— 拿它当"窗太短"的证据是假红,真问题会被带偏。)
  const grid = cells();
  const lat: number[] = [];
  let expired = 0, checked = 0;
  for (const g of grid) {
    if (incomingTag(g.side, g.h, g.dist, g.vx, g.vy) !== "可及") continue;
    if (!perfectManual(g).hit) continue;
    checked++;
    const a = oneTapWhy(g);
    if (a.swingFrame >= 0) lat.push(a.swingFrame);
    if (a.why.includes("待发窗已过期")) expired++;
  }
  lat.sort((x, y) => x - y);
  const at = (q: number): number => lat.length ? lat[Math.min(lat.length - 1, Math.round((lat.length - 1) * q))] : 0;
  console.log(`   网格内按下→代拍帧数(可及且完美手动救得到的 ${checked} 格,实得 ${lat.length} 格):`
    + ` 中位 ${at(0.5)} / p95 ${at(0.95)} / 最远 ${at(1)}(autoWindow=${RG.autoWindow})`);
  ck.ok(checked === 0 || lat.length === checked, `⑭ 有 ${checked - lat.length} 格"完美手动救得到"却没测出代拍帧数`);
  ck.ok(expired === 0, `⑭ ${expired} 格因为「待发窗已过期」没赶上代劳(autoWindow=${RG.autoWindow} 太短)`);
  ck.ok(at(1) < RG.autoWindow, `⑭ 网格里最远一次代拍第 ${at(1)} 帧,窗口 ${RG.autoWindow} 帧必须盖住它`);
  // 与重击同一份球速档实测:极限慢档(s=0.6)最远一击 135 帧 —— 怒气也按这条定窗
  ck.ok(RG.autoWindow > 135,
    `⑭ 待发窗要盖住「极限慢球速档」最远一击(实测 135 帧,现 ${RG.autoWindow})—— 短一格,慢档玩家按下就是"按了没反应"`);
  ck.ok(RG.releaseWindow > RG.autoWindow, `⑭ armed 窗(${RG.releaseWindow})比代拍窗(${RG.autoWindow})长:代劳交还手动之后,玩家自己那一拍仍然兑现`);
}

// ---------- ⑮ 定标:蓄满要几拍、一局放几次(与卡片文案同一把尺子) ----------
function s15(ck: Checker): void {
  const best = Math.ceil(RG.max / (RG.perHit * RG.bothMul));
  const worst = Math.ceil(RG.max / RG.perHit);
  ck.ok(best === 8 && worst === 20, `⑮ 蓄满 ${best}~${worst} 拍(最好每拍又准又杀、最差全是普通拍)`);
  // 期望值:真人整局约 55 拍,P(甜)≈0.35、P(杀)≈0.22 ⇒ 每拍约 7.5 点
  const exp = RG.perHit * (1 + 0.28 + 0.22);
  const releases = Math.floor((55 * exp) / RG.max);
  ck.ok(releases >= 3 && releases <= 6, `⑮ 一局约 ${releases} 次满怒释放(目标 3~5 次;越界就该动 max,不要动 perHit)`);
  ck.ok([RG.perHit, RG.perHit * RG.sweetMul, RG.perHit * RG.smashMul, RG.perHit * RG.bothMul]
    .every((g) => Number.isInteger(g)), "⑮ 四档增益全整数 ⇒ 键面「1 点 = 1%」的读法不断");
  ck.ok(RG.bothMul < RG.sweetMul * RG.smashMul,
    `⑮ bothMul ${RG.bothMul} 低于叠乘 ${(RG.sweetMul * RG.smashMul).toFixed(2)}(叠乘会一拍 18 点,六拍打穿上限)`);
}

// ---------- ⑯ 发球不涨怒气(设计后果,写死免得被当 bug 改回去) ----------
function s16(ck: Checker): void {
  const { hero, ball } = scene();
  hero.rage = 0;
  // rules 的发球路径:直接 buildShot({forced}),不经 settle ⇒ 不涨怒气
  Pl.buildShot(hero, ball, { q: 0.8, sweet: false, dEdge: 0.05, forced: { depth: 0.8 } });
  ck.ok((hero.rage ?? 0) === 0, `⑯ 发球不涨怒气(实际 ${hero.rage})—— 用户口径「在击打过程去积攒」,一整局约 6 发若都算就白送 30 点`);
  ck.ok(hero.stats.hits === 0, `⑯ 发球也不算"接到的那一拍"(实际 hits=${hero.stats.hits})`);
}

interface Section { name: string; run: (ck: Checker) => void }
const SECTIONS: Section[] = [
  { name: "① 球种预告是纯预览:怒气/armed/代拍窗一口不吃,徽标照旧说真话", run: s1 },
  { name: "② 强度随怒气单调,只有满怒才必暴扣 + 顶档", run: s2 },
  { name: "③ 一次施放只兑现一拍;兑现是整局唯一清零点", run: s3 },
  { name: "④ 攒怒气只吃物理档,释放那一拍不给自己充能", run: s4 },
  { name: "⑤ 释放门槛:空管按不出去(资源制的白嫖漏洞)", run: s5 },
  { name: "⑥ 怒气住 Player:换装整块换 skill 对象也不丢", run: s6 },
  { name: "⑦ resetPoint:资源跨分保留、临时窗一律清", run: s7 },
  { name: "⑧ 计时器每帧只减一次(armed 窗 / 代拍窗)", run: s8 },
  { name: "⑨ 释放失败不罚怒气(挥空 / 窗自己走完)", run: s9 },
  { name: "⑩ 一键兑现:只按一次就把这一拍轰出去(6×5×5×两侧)", run: s10 },
  { name: "⑪ 该不出手一律不代拍,且每次沉默都说得出理由", run: s11 },
  { name: "⑫ 手动优先:代劳让位,但怒气照样砸进去", run: s12 },
  { name: "⑬ AI 侧口径:拿不到代拍窗、不吃顶档、判定区不放大", run: s13 },
  { name: "⑭ 一把尺子三份参数 + 窗覆盖度(预开启那一档)", run: s14 },
  { name: "⑮ 定标:蓄满几拍、一局放几次(与卡片同一把尺子)", run: s15 },
  { name: "⑯ 发球不涨怒气(设计后果,钉住别被当 bug 改回去)", run: s16 },
];

// ============================================================
// 反例:每份都是"这次改动可能静默引入"的真实坏法,点名它必须弄红哪些段
// ============================================================
const originalModify = Skills.modifyShot;
const originalActivate = Skills.activate;
const originalReset = Skills.resetPoint;
const originalDue = Pl.autoSwingDue;
type Modify = typeof Skills.modifyShot;
type Activate = typeof Skills.activate;
type Reset = typeof Skills.resetPoint;
type Due = typeof Pl.autoSwingDue;

/** 反例:预告也清怒气(2026-10-03 重击现场的同一条病,换到资源上更致命) */
const previewConsumesRage: Modify = (p, opt) => {
  const r = originalModify(p, opt);
  if (p && p.skill && p.skill.id === "rage" && p.skill.buffT === 0 && (p.rage ?? 0) === 0) p.rage = 0;
  if (p && p.skill && p.skill.id === "rage") p.rage = 0;      // 无条件清 = 旧写法
  return r;
};
/** 反例:兑现不清怒气 —— "只有释放才归零"这条断了,它就退化成一条永久 buff */
const rageNotCleared: Modify = (p, opt) => {
  const before = (p && p.rage) ?? 0;
  const r = originalModify(p, opt);
  if (p && p.skill && p.skill.id === "rage") p.rage = before;
  return r;
};
/** 反例:在 activate 就清怒气 —— 满怒按下去,兑现的却是一记空手球 */
const rageClearedAtPress: Activate = (p, ball, dir) => {
  const ok = originalActivate(p, ball, dir);
  if (ok && p.skill && p.skill.id === "rage" && !p.isAI) p.rage = RG.rageMinRelease;
  return ok;
};
/** 反例:分档被抹平(把 forceSmash 挪出 ratio>=1)⇒ 与重击再无区别,攒怒没意义。
 *  注意 armed 判据必须在调原函数**之前**取:真实现代兑现那一帧就把 buffT 清零了,
 *  事后再读 p.skill.buffT 恒为 0 —— 反例会静默不生效,自检也就没牙齿(第一版栽过)。 */
const alwaysForceSmash: Modify = (p, opt) => {
  const armed = !!p && !!p.skill && p.skill.id === "rage" && p.skill.buffT > 0;
  const r = originalModify(p, opt);
  if (armed) r.forceSmash = true;
  return r;
};
/** 反例:释放那一拍也给自己充能(去掉 settle 里 skillKind !== "rage" 那道闸) */
const selfRefill: Modify = (p, opt) => {
  const r = originalModify(p, opt);
  if (p && r.skillKind === "rage" && !opt.preview) p.rage = RG.rageMinRelease;  // 当场回一小截
  return r;
};
/** 反例:一键化是假的 —— 从不代拍(用户点名的"按了没反应") */
const noAuto: Due = (_p, _b, src) => (src === "rage" ? false : originalDue(_p, _b, src));
/** 反例:不择帧就起手 —— 界外球、贴地死球、隔网球全被代 */
const alwaysDue: Due = () => true;
/** 反例:拆掉 isAI 闸 —— AI 也拿到代拍窗(偷偷改难度) */
const aiGetsAuto: Activate = (p, ball, dir) => {
  const ok = originalActivate(p, ball, dir);
  if (ok && p.skill && p.skill.id === "rage" && p.isAI) p.rageAutoT = RG.autoWindow;
  return ok;
};
/** 反例:resetPoint 不清代拍窗 —— 下一分第一拍被系统凭空替玩家轰出去 */
const windowLeak: Reset = (p) => {
  const keep = p.rageAutoT ?? 0;
  originalReset(p);
  p.rageAutoT = keep;
};
// 「手动抢拍时把 armed 一起清」那份反例**故意没写**:它改的是 player.update 里的一行
// (没有可替换的导出函数),而 ⑫ 的 keptPromise === live 已经把同一件事钉住了 ——
// 抢拍之后那一拍必须仍带 skillKind=rage。写一份需要动源码注入位的反例,收益不抵复杂度。

const failsOf = (run_:(ck: Checker) => void): number => {
  const ck = makeChecker({ printPass: false });
  run_(ck);
  return ck.fails;
};

const selftest = process.argv.includes("--selftest");

if (!selftest) {
  const h = makeChecker({});
  for (const s of SECTIONS) {
    console.log(`\n—— ${s.name}`);
    s.run(h);
  }
  console.log(`\n${h.fails === 0 ? "✓" : "✗"} ${h.checks} 项断言,失败 ${h.fails}`);
  process.exit(h.fails === 0 ? 0 : 1);
} else {
  console.log("反例自检:改坏的真实写法必须被上面的判据拦住(拦不住 = 这套尺子没牙齿)");
  const find = (n: string): Section => {
    const s = SECTIONS.find((x) => x.name.startsWith(n));
    if (!s) throw new Error(`rage-check selftest:找不到段落 ${n}`);
    return s;
  };
  let bad = 0;
  const apply = (label: string, secs: string[], failsFor: (n: string) => number): void => {
    for (const n of secs) {
      const fails = failsFor(n);
      if (fails === 0) { bad++; console.log(`  ✗ ${n} 全绿 —— 拦不住「${label}」`); }
      else console.log(`  ✓ ${n} 被拦住(${fails} 条报警)`);
    }
  };
  const withPatch = <T extends object>(obj: T, key: keyof T, patch: unknown, secs: string[], label: string): void => {
    const orig = obj[key];
    (obj as Record<string, unknown>)[key as string] = patch;
    try {
      apply(label, secs, (n) => failsOf(find(n).run));
    } finally {
      (obj as Record<string, unknown>)[key as string] = orig;
    }
  };

  withPatch(Skills, "modifyShot", previewConsumesRage as Modify, ["①", "③"], "previewConsumesRage(预告也清怒气)");
  withPatch(Skills, "modifyShot", rageNotCleared as Modify, ["③"], "rageNotCleared(兑现不清怒气)");
  withPatch(Skills, "modifyShot", alwaysForceSmash as Modify, ["②"], "alwaysForceSmash(分档被抹平)");
  withPatch(Skills, "modifyShot", selfRefill as Modify, ["④"], "selfRefill(释放那一拍给自己充能)");
  withPatch(Skills, "activate", rageClearedAtPress as Activate, ["①", "②"], "rageClearedAtPress(按下就清怒气)");
  withPatch(Skills, "activate", aiGetsAuto as Activate, ["⑬"], "aiGetsAuto(拆掉 isAI 闸)");
  withPatch(Skills, "resetPoint", windowLeak as Reset, ["⑦"], "windowLeak(跨分留残窗)");
  // noAuto 只点名 ⑩:⑫ 量的是"玩家抢拍之后怒气仍砸进去",那条路本来就不依赖代劳,
  // 反例装上去 ⑫ 照样绿 —— 硬给它挂个号只会让人以为 ⑫ 也管一键化。
  withPatch(Pl, "autoSwingDue", noAuto as Due, ["⑩"], "noAuto(一键化是假的)");
  withPatch(Pl, "autoSwingDue", alwaysDue as Due, ["⑪"], "alwaysDue(不择帧就起手)");

  // 反例:怒气改住 PlayerSkillState ⇒ 换装整块换对象时无声丢失。
  // 这份不靠 patch 而靠"照那种写法走一遍,看资源还在不在" —— 它证的是字段选址,不是函数行为。
  {
    const ck = makeChecker({ printPass: false });
    const { hero } = scene();
    hero.rage = 40;
    // 那种写法:资源挂在 skill 对象上。Career.applyToMatch() 干的是整块替换 ——
    // me.skill = Skills.initSkillState(equippedSkill()),旧对象连同资源一起被丢进 GC。
    hero.skill = Skills.initSkillState("rage");
    hero.rage = 0;                       // 住 PlayerSkillState 时,重建对象后读回来就是 0
    const survives = (hero.skill as unknown as { rage?: number }).rage === 40;
    if (!survives) console.log("  ✓ skillWipedRage(怒气住 PlayerSkillState)被证伪:换装即丢 ⇒ 它必须住 Player(⑥ 钉的就是这条)");
    else { bad++; console.log("  ✗ skillWipedRage 没被证伪 —— 这条反例写错了"); }
  }

  console.log(`\n${bad === 0 ? "✓" : "✗"} 反例自检 ${bad === 0 ? "全部被拦住" : `${bad} 份没被拦住`}`);
  process.exit(bad === 0 ? 0 : 1);
}
