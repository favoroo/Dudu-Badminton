// ============================================================
// 百分百重击(smash 附魔 + 一键兑现)回归 —— 2026-10-03 新增,2026-10-04 一键化扩判据。
//
// 用户真机现场(2026-10-03):「点击重击之后,应该是下一次挥拍触发重击。而我现在是点完重击它直接就在
// 左侧弹出重击标签了,下次挥拍也只是一个普通挥拍。」
//
// 三条各自独立、叠在一起才成形的坏:
//   ① 球种预告吃 buff:game-root 每个真实帧(≤10 帧节流)跑 Player.previewKind 给击球键
//      画徽标,而 previewKind 走的是真 buildShot —— 那里面挂着会**消耗**技能的 modifyShot。
//      于是按下重击后的第一记预告就把附魔清零:玩家看到一条红字 + 一个普通球 + 白付冷却。
//      同一行写入还偷吃闪现的必中窗(兼 tryHit 门槛)与引力吸球的回球加成。
//   ② 技能的"质量改写"是死值:旧 buildShot 先解构 q/sweet/perfect 再调钩子,钩子回写的
//      那三个值永远读不到 → 「必定暴扣」拿不到顶档反馈(误差也不归零,8 次同参 8 个落点)。
//   ③ 起手字钉在左边场边、还写完成时的「暴烈重扣!!」,读起来就是"已经扣完了"。
//
// 用户现场(2026-10-04):「这个重击技能也优化一下,点击之后如果球在可打击范围内就也会自动击打
// (如果挥空不会冷却)」—— 照着刚上线的「跨步一键自动回球」同一条路做:按下 = 上弦 + 到点代出那一拍。
//
// 新承诺的坏法同样全都不会崩、不会报错,只会安静地不好用:
//   ⑩ 按了却没代劳        → "我按了重击它还是不动",与没做这个功能一样。判据:逐格必须兑现
//   ⑪ 替玩家捞该落地的球 / 对够不着的球起拍 → 把对手送的分还回去、人物自己乱挥。判据:该不出手就不出手
//   ⑫ 抢玩家自己那一拍    → 「我按了击打怎么又挥一下」。判据:手动一按,自动当场让位
//   ⑬ 计时器每帧多减一次  → 4 秒附魔实际 2 秒(与 lungeShotT 从前同一个坑)。判据:逐帧算术
//   ⑭ 冷却什么时候付     → 按下就罚 3.5 秒 = 用户点名要改掉的那条;兑现不付 = 无限白嫖附魔
//   ⑮ 只对真人成立        → AI 也会自己按键(ai.ts:502-506),给它开等于白送一记永不失误的暴扣,
//                           而 serve-check / ai-check 的真人替身从不按技能键 —— 那两把尺子量不到
//   ⑯ 待发窗覆盖不足      → 按下时球还在对面天上,窗先走完 = 代劳没赶上,读起来还是"按了没反应"
//   ⑰ 代劳那一拍的落点    → autoAim 压太深会把重扣送出对方底线(白送一分)
//
// 本工具把承诺钉死(③ 是观感,肉眼与预览验收,不在这里断言):
//   ① 每记 previewKind 前后技能状态逐字段不变,而徽标照旧说真话(报 smash)
//   ② 上弦后的下一记真实挥拍 = 扣杀 + skillKind=smash,附魔只消耗一次
//   ③ modifyShot 的质量改写真的生效(顶档 + 误差归零),而甜蜜/完美统计不被洗
//   ④ 打完不能白嫖第二次(拦人的是冷却)
//   ⑤ 挥空不吃附魔(宽容档,用户 2026-10-03 拍板)
//   ⑥ 同族的闪现必中窗 / 引力回击 buff 同样不许被预告吃掉
//   ⑦ 附魔期发球也算必定暴扣(用户拍板保留)
//   ⑧ 端到端:按技能 → 预告照常喂 → 挥拍,hit 事件必须是顶档重扣(整条链路的复现)
//   ⑨ 顶档改写只给真人:AI 吃 forceSmash/加成,但不吃 q/perfect —— 否则等于把技能 buff
//      当成难度补丁加给对手(实测真人得分率 easy 60%→46%、normal 39%→15%)
//   ⑩~⑰ 一键化那七条(见上)
//
// 用法:node .tools-build/tools/smash-check.js [--selftest]
//   --selftest 喂反例:legacy(预告也消耗)/ noOverride(质量改写读不到)/ noAuto(从不代拍)/
//   alwaysDue(不择帧就起手)/ cdAtPress(按下即付冷却 = 旧口径)/ aiGetsAuto(拆掉 isAI 闸)/
//   buffNotConsumed(一次上弦吃好几拍)/ doubleDecrement(计时器多减一次)。
//   一份不够 —— 只把旧消耗装回来,③ 那组断言照样绿(旧代码的坏是两件事叠出来的)。
//
// 反例靠"player.ts 经导出对象调用 Skills.modifyShot / Skills.activate / Player.autoSwingDue"
// 这一点成立:属性赋值在调用期生效。哪天改成具名 import 直调,这里的 patch 就失去牙齿
// (会静默全绿),改法记得同步换成本文件自带的注入位。
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
const CO = C.court, SM = C.skills.smash, SW = C.swing;

/** 技能机制数值的唯一真话源:config.skills.list 里 smash 那一档 */
const BUFF = C.skills.smash.buffDuration;
const CD = Skills.defOf("smash").cooldownFrames;
/** 真人替身"零反应延迟"的完美按拍帧 = 机制用的同一把尺子(质量峰落在球过判定区心那帧) */
const PERFECT_LEAD = SW.windup + 0.5 + (SW.active - 1) / 2;

const idleInput = (): PlayerInput => ({
  left: false, right: false, jumpPressed: false, jumpHeld: false,
  swingAim: null, lungePressed: false,
});

/** 状态快照:预告必须一个字节都不动它(比逐条断言更难被"漏一个字段"糊过去) */
const snap = (p: PlayerEntity): string => JSON.stringify({
  buffT: p.skill ? p.skill.buffT : -1,
  cd: p.skill ? p.skill.cd : -1,
  autoT: p.smashAutoT ?? 0,
  pull: p.skill ? !!p.skill.magnetPulling : false,
  flashStrikeT: p.flashStrikeT ?? 0,
  focusT: p.focusT ?? 0,
  smashes: p.stats.smashes,
  hits: p.stats.hits,
  sweets: p.stats.sweets,
  perfects: p.stats.perfects,
  heat: p.heat,
});

/** 装好技能、球钉在判定区心的静态场景(只喂 previewKind / buildShot 这类不看结算时机的路径) */
function scene(skill: SkillId): { hero: PlayerEntity; ball: Ball } {
  Rules.newMatch("1p", "normal");
  const R = Rules.R;
  const hero = R.players[0];
  hero.skill = Skills.initSkillState(skill);
  Skills.resetPoint(hero);
  hero.x = CO.netX - 170; hero.y = CO.groundY;
  hero.vx = 0; hero.vy = 0; hero.onGround = true;
  hero.swingT = -1; hero.swingBest = null; hero.swingHit = false; hero.hitLock = 0;
  hero.swingStyle = "over"; hero.swingAim = C.aimDepth.mid;
  hero.flashStrikeT = 0;
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
 * 飞行场景(抄自 spec-shot-check 的 flight,只有这条路能控制"晚按几帧"从而造出
 * 非甜蜜的物理拍 —— ③ 那组断言需要它)。球直线飞向判定区心,与 rules.step 同序:
 * update → 球推进 → tryHit。
 *   arm     = 起拍前把重击按下去(附魔上弦)
 *   previews = 起拍前先喂几记预告(旧代码就在这里把附魔吃掉)
 *   late    = 相对最佳按拍点晚按的帧数
 */
function flight(opts: {
  late?: number; v?: number; aim?: string; skill?: SkillId; arm?: boolean; previews?: number;
} = {}): { hero: PlayerEntity; ball: Ball; shot: ShotResult | null } {
  const late = opts.late ?? 0;
  const v = opts.v ?? 8;
  Rules.newMatch("1p", "normal");
  const R = Rules.R;
  const hero = R.players[0];
  if (opts.skill) {
    hero.skill = Skills.initSkillState(opts.skill);
    Skills.resetPoint(hero);
  }
  hero.x = CO.netX - 170; hero.y = CO.groundY;
  hero.vx = 0; hero.vy = 0; hero.onGround = true;
  hero.hitLock = 0; hero.swingHit = false; hero.swingT = -1; hero.swingBest = null;
  hero.swingStyle = "over"; hero.swingAim = C.aimDepth.mid;
  const ball = R.ball as Ball;
  ball.x = hero.x + 300; ball.y = CO.groundY - 76;
  ball.px = ball.x; ball.py = ball.y;
  ball.vx = -v; ball.vy = 0;
  ball.live = true; ball.held = false; ball.owner = null;
  ball.lastHitter = "right"; ball.crossed = true; ball.netted = false;
  ball.shot = null; ball.magnetPull = null; ball.flying = false; ball.flyT = 0;
  R.state = "RALLY"; R.timer = 0; R.serveWait = 0; R.events.length = 0;

  if (opts.arm) {
    if (!Skills.activate(hero, ball)) throw new Error("flight: 重击按不下去(canActivate 拒了)");
  }
  for (let i = 0; i < (opts.previews ?? 0); i++) Pl.previewKind(hero, ball);

  const inp = idleInput();
  inp.swingAim = opts.aim ?? "mid";
  Pl.update(hero, inp, ball);                 // 第 0 帧起拍
  const Tc = PRESS_LEAD_FRAMES - late;        // 球到判定区心的帧号
  const z = Pl.strikeZone(hero, v);
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

/**
 * 端到端复现(真机时序):按下技能键(真人那一路走 lunge 动作槽)→ game-root 每真实帧喂
 * 一记预告 → 挥拍 → 从 rules 的 hit 事件里看兑现。事件才是 game-root 档位阶梯吃的东西。
 */
function endToEnd(opts: { arm: boolean }): { hit: Record<string, unknown> | null; hero: PlayerEntity } {
  Rules.newMatch("1p", "normal");
  const R = Rules.R;
  const hero = R.players[0];
  hero.skill = Skills.initSkillState("smash");
  Skills.resetPoint(hero);
  hero.x = CO.netX - 210; hero.y = CO.groundY;
  hero.vx = 0; hero.vy = 0; hero.onGround = true;
  hero.hitLock = 0; hero.swingHit = false; hero.swingT = -1; hero.swingBest = null;
  hero.stats.whiffs = 0;
  const ball = R.ball as Ball;
  // 摆成一记正落在判定区心里的来球:本工具管的是"上弦能不能兑现", Arrival 几何归 flash-check
  const z = Pl.strikeZone(hero, 6);
  ball.x = z.x; ball.y = z.y;
  ball.px = ball.x; ball.py = ball.y;
  ball.vx = -1.2; ball.vy = 0.8;
  ball.live = true; ball.held = false; ball.owner = null;
  ball.flying = false; ball.flyT = 0;
  ball.lastHitter = "right"; ball.crossed = true; ball.netted = false;
  ball.shot = null; ball.magnetPull = null;
  R.state = "RALLY"; R.timer = 0; R.serveWait = 0;

  let hit: Record<string, unknown> | null = null;
  let swung = false;
  for (let f = 0; f < 60 && !hit; f++) {
    const mine = idleInput();
    const theirs = idleInput();
    if (f === 0 && opts.arm) mine.lungePressed = true;   // 技能键在 touchpad 里就是 lunge 动作位
    if (f === 3 && !swung) { mine.swingAim = "mid"; swung = true; }
    R.events.length = 0;
    Rules.step([mine, theirs]);
    // 这就是旧代码偷吃 buff 的那一句(game-root.updateSwingCue 每个真实帧都这么干)
    Pl.previewKind(hero, ball);
    const e = R.events.find((x) => x.t === "hit");
    if (e) hit = e as unknown as Record<string, unknown>;
  }
  return { hit, hero };
}

// ---------- ① 纯预览:预告一口都不能吃 ----------
function s1(ck: Checker): void {
  const { hero, ball } = scene("smash");
  const s = hero.skill as NonNullable<PlayerEntity["skill"]>;
  ck.ok(Skills.activate(hero, ball), `① 按重击能按下去(canActivate 不拒,冷却 ${CD} 帧)`);
  ck.ok(s.buffT === BUFF, `① 上弦后 buffT=${BUFF}(实际 ${s.buffT})`);
  ck.ok(s.cd === 0, `① 按下不进冷却 —— 重击是"上弦等兑现",扣出去那一拍才付(实际 ${s.cd})`);
  ck.ok((hero.smashAutoT ?? 0) === Math.min(SM.autoWindow, BUFF),
    `① 上弦同时开「代出一拍」待发窗(实际 ${hero.smashAutoT},配置 ${SM.autoWindow})`);
  let pure = true;
  let badge = "";
  for (let i = 0; i < 4; i++) {
    Pl.update(hero, idleInput(), ball);       // 一次模拟步:buffT/cd 各 -1
    const before = snap(hero);
    badge = Pl.previewKind(hero, ball);
    if (snap(hero) !== before) pure = false;
  }
  ck.ok(pure, "① 每记 previewKind 前后技能状态/记账逐字段不变");
  ck.ok(badge === "smash", `① 预告不许撒谎:附魔期徽标必须报扣杀(实际 ${badge})`);
  ck.ok(s.buffT === BUFF - 4, `① buffT 只按模拟步递减(期望 ${BUFF - 4},实际 ${s.buffT})`);
  ck.ok(s.cd === 0, `① 空转四帧仍在等兑现,冷却不该开跑(实际 ${s.cd})`);
  // scene() 把球就摆在判定区心 —— 所以这一格里"该按的那一帧"当帧就到,系统当场代拍把窗用掉。
  // 两种收尾都算诚实:窗按帧走完(球还远),或者被一次真代拍清掉(球就在手边)。⑬ 专管递减算术。
  const autoTookIt = (hero.smashAutoT ?? 0) === 0 && hero.swingT >= 0;
  ck.ok((hero.smashAutoT ?? 0) === Math.min(SM.autoWindow, BUFF) - 4 || autoTookIt,
    `① 待发窗要么按模拟步递减(期望 ${Math.min(SM.autoWindow, BUFF) - 4}),要么被当场代拍用掉(实际剩 ${hero.smashAutoT}、swingT=${hero.swingT})`);
  ck.ok(hero.stats.smashes === 0, `① 预告不给 stats.smashes 记账(实际 ${hero.stats.smashes})`);
}

// ---------- ② 兑现:上弦后的下一拍 = 重扣 ----------
function s2(ck: Checker): void {
  const bare = flight({ late: 9, skill: "smash" });          // 装了但没上弦
  ck.ok(!!bare.shot, "② 对照组:这一拍打出去了");
  ck.ok(!!bare.shot && bare.shot.kind !== "smash", `② 对照组:晚按 9 帧本该是普通球(实际 ${bare.shot ? bare.shot.kind : "-"})`);
  ck.ok(!!bare.shot && !bare.shot.skillKind, "② 对照组:没有技能归属");

  const buff = flight({ late: 9, skill: "smash", arm: true, previews: 3 });
  ck.ok(!!buff.shot, "② 附魔组:这一拍打出去了");
  ck.ok(!!buff.shot && buff.shot.kind === "smash", `② 附魔兑现:无视高度必定扣杀(实际 ${buff.shot ? buff.shot.kind : "无球"})`);
  ck.ok(!!buff.shot && buff.shot.skillKind === "smash", "② 附魔兑现:上报 skillKind=smash(特效/飘字/震动都认这个)");
  const s = buff.hero.skill as NonNullable<PlayerEntity["skill"]>;
  ck.ok(s.buffT === 0, "② 命中即消耗附魔");
  const after = snap(buff.hero);
  Pl.previewKind(buff.hero, buff.ball);
  ck.ok(snap(buff.hero) === after, "② 消耗之后预告也不得再动状态(不许出现「二次消耗」式的假复位)");
}

// ---------- ③ modifyShot 的质量改写必须生效 ----------
function s3(ck: Checker): void {
  const one = flight({ late: 9, skill: "smash", arm: true });
  const shot = one.shot as ShotResult;
  ck.ok(shot.perfect === true && shot.sweet === true && shot.q === 1,
    `③ 附魔拍上报顶档(实际 perfect=${shot.perfect} sweet=${shot.sweet} q=${shot.q.toFixed(3)})`);
  const lands = new Set(Array.from({ length: 8 }, () => (flight({ late: 9, skill: "smash", arm: true }).shot as ShotResult).landX));
  ck.ok(lands.size === 1, `③ 完美=瞄哪打哪:附魔拍 8 次同参落点必须唯一(实际 ${lands.size} 个)`);
  const raw = new Set(Array.from({ length: 8 }, () => (flight({ late: 9, skill: "smash" }).shot as ShotResult).landX));
  ck.ok(raw.size > 1, `③ 对照组(必须有牙齿):未上弦同参 8 次应散布着落(实际 ${raw.size} 个)`);
  ck.ok(one.hero.stats.perfects === 0,
    `③ 甜蜜/完美统计仍按物理档记账,不许被 buff 洗(实际 perfects=${one.hero.stats.perfects})`);
}

// ---------- ④ 打完不能白嫖 ----------
function s4(ck: Checker): void {
  const { hero, ball } = flight({ late: 0, skill: "smash", arm: true });
  const s = hero.skill as NonNullable<PlayerEntity["skill"]>;
  ck.ok(!Skills.canActivate(hero, ball), "④ 兑现后不能立刻再上弦");
  ck.ok(s.cd > 0, `④ 拦人的是冷却(实际 cd=${s.cd})`);
  ck.ok(s.buffT === 0, `④ 附魔已清零(实际 buffT=${s.buffT})`);
  ck.ok(Skills.skillBlockReason(hero, ball) === null, "④ 冷却中按键不给门槛原因(读数归倒计时)");
}

// ---------- ⑤ 挥空不吃附魔(用户拍板的宽容档) ----------
function s5(ck: Checker): void {
  const { hero, ball } = scene("smash");
  const s = hero.skill as NonNullable<PlayerEntity["skill"]>;
  Skills.activate(hero, ball);
  // 把球挪到够不着的位置,再走满一整拍(挥空的记账在 player.update 的收招分支)
  ball.x = hero.x - 220; ball.y = CO.groundY - 20;
  ball.px = ball.x; ball.py = ball.y;
  const swing = idleInput();
  swing.swingAim = "mid";
  for (let f = 0; f < 40; f++) Pl.update(hero, f === 0 ? swing : idleInput(), ball);
  ck.ok(hero.stats.whiffs === 1, `⑤ 这一拍判成挥空(实际 whiffs=${hero.stats.whiffs})`);
  ck.ok(s.buffT > 0, `⑤ 挥空不吃附魔:上弦还在(实际 buffT=${s.buffT})`);
  ck.ok(s.cd === 0, `⑤ 挥空不进冷却:没扣出去就不罚玩家(用户 2026-10-04 点名这条;实际 cd=${s.cd})`);
  ck.ok((hero.smashAutoT ?? 0) === 0, `⑤ 玩家自己按了击打 = 代劳当场让位,待发窗清零(实际 ${hero.smashAutoT})`);
  // 附魔还在 ⇒ 下一记真打仍然兑现
  const next = flight({ late: 0, skill: "smash", arm: true });
  ck.ok(!!next.shot && next.shot.skillKind === "smash", "⑤ 宽容档在机制上是真的:下一记照样暴扣");
}

// ---------- ⑥ 同族 buff 不许被预告偷吃 ----------
function s6(ck: Checker): void {
  const { hero, ball } = scene("flash");
  hero.flashStrikeT = 10;                       // 折跃后的保底接触窗
  const before = snap(hero);
  for (let i = 0; i < 4; i++) Pl.previewKind(hero, ball);
  ck.ok(snap(hero) === before, `⑥ 闪现的必中窗不被预告关掉,也不给 stats.smashes 记账(实际 ${snap(hero)})`);

  const m = scene("magnet");
  const ms = m.hero.skill as NonNullable<PlayerEntity["skill"]>;
  ms.magnetPulling = true;
  const mb = snap(m.hero);
  for (let i = 0; i < 4; i++) Pl.previewKind(m.hero, m.ball);
  ck.ok(snap(m.hero) === mb, `⑥ 引力回击 buff 不被预告清掉(实际 ${snap(m.hero)})`);
}

// ---------- ⑦ 附魔期发球也算必定暴扣(用户 2026-10-03 拍板保留) ----------
function s7(ck: Checker): void {
  const { hero, ball } = scene("smash");
  const s = hero.skill as NonNullable<PlayerEntity["skill"]>;
  Skills.activate(hero, ball);
  const shot = Pl.buildShot(hero, ball, { q: 0.8, sweet: false, dEdge: 0.05, forced: { depth: 0.8 } });
  ck.ok(shot.kind === "smash" && shot.skillKind === "smash", `⑦ 附魔期这一发是重扣发球(实际 ${shot.kind}/${shot.skillKind})`);
  ck.ok(s.buffT === 0, "⑦ 真打一发就把附魔用掉(发球也算真打)");
}

// ---------- ⑧ 端到端:整条链路的复现 ----------
function s8(ck: Checker): void {
  const ctrl = endToEnd({ arm: false });
  ck.ok(!!ctrl.hit, `⑧ 对照组:这一拍打出去了(${ctrl.hero.stats.whiffs} 次挥空)`);
  ck.ok(!!ctrl.hit && !ctrl.hit.skillKind, "⑧ 对照组:没上弦就没有技能归属");

  const r = endToEnd({ arm: true });
  ck.ok(!!r.hit, `⑧ 按下重击 → 预告照喂 → 挥拍:这一拍必须打出去(实际 whiffs=${r.hero.stats.whiffs}, state=${Rules.R.state})`);
  ck.ok(!!r.hit && r.hit.kind === "smash", `⑧ hit 事件必须是扣杀(实际 ${r.hit ? r.hit.kind : "-"})`);
  ck.ok(!!r.hit && r.hit.skillKind === "smash", "⑧ hit 事件带 skillKind=smash(game-root 的特效/飘字分支认它)");
  ck.ok(!!r.hit && r.hit.perfect === true, `⑧ hit 事件上报顶档 perfect(game-root 的档位阶梯 + 触觉认它;实际 ${r.hit ? r.hit.perfect : "-"})`);
  ck.ok(r.hero.skill!.buffT === 0, "⑧ 端到端走完,附魔恰好消耗一次");
  // 「必定」两个字不能只挂在文案上:完美 = 落点误差归零,同一局重跑必须落在同一个点。
  // 这条同时给反例 B(质量改写读不到)加牙齿 —— 读不到的时候落点仍带随机项。
  const again = endToEnd({ arm: true });
  const l1 = r.hit ? String(r.hit.landX) : "-";
  const l2 = again.hit ? String(again.hit.landX) : "-";
  ck.ok(!!r.hit && !!again.hit && l1 === l2, `⑧ 附魔拍的落点不靠运气:同局重跑必须一致(实际 ${l1} vs ${l2})`);
}

// ---------- ⑨ AI 只吃加成、不吃顶档改写(难度旋钮不许被技能顺手拧走) ----------
function s9(ck: Checker): void {
  const h = scene("smash");
  Skills.activate(h.hero, h.ball);
  const human = Pl.buildShot(h.hero, h.ball, { q: 0.3, sweet: false, perfect: false, dEdge: 0 });
  ck.ok(human.kind === "smash" && human.perfect === true && human.q === 1,
    `⑨ 真人附魔拍:顶档 + 必定扣杀(实际 ${human.kind}/perfect=${human.perfect}/q=${human.q})`);

  const a = scene("smash");
  Skills.activate(a.hero, a.ball);
  a.hero.isAI = true;                       // 同一拍换到 AI 名下
  const ai = Pl.buildShot(a.hero, a.ball, { q: 0.3, sweet: false, perfect: false, dEdge: 0 });
  ck.ok(ai.kind === "smash" && ai.skillKind === "smash",
    `⑨ AI 照旧吃 forceSmash(实际 ${ai.kind}/${ai.skillKind})`);
  ck.ok(ai.perfect === false && ai.q === 0.3,
    `⑨ 但 AI 不吃顶档改写:准头归 diffs 管,修 ② 时一并生效会让真人得分率 60%→46%(实际 perfect=${ai.perfect}/q=${ai.q})`);
}

// ============================================================
// 一键化(2026-10-04)网格驱动 —— 口径抄 tools/lunge-check.ts,几何换成"球朝人飞、人不位移"。
// 跨步自带 90px 冲量,所以它的格子可以把球摆在身后;重击不承诺"手更长",只承诺"到点替你按",
// 因此这里的每一格都是来球正面飞向 hero。
// ============================================================

/** hero 站位:左右对称取 netX ∓ 150(中前场,重击的主场) */
const heroAt = (side: TeamSide): number => side === "left" ? CO.netX - 150 : CO.netX + 150;

/** 摆成「一记来球正朝 hero 那侧半场飞」:dist = 球在 hero 朝网一侧多少像素 */
function bench(side: TeamSide, h: number, dist: number, vx: number, vy: number): { hero: PlayerEntity; ball: Ball } {
  Rules.newMatch("1p", "normal");
  const R = Rules.R;
  const hero = R.players[side === "left" ? 0 : 1];
  hero.skill = Skills.initSkillState("smash");
  Skills.resetPoint(hero);
  hero.x = heroAt(side); hero.y = CO.groundY;
  hero.vx = 0; hero.vy = 0; hero.onGround = true;
  hero.swingT = -1; hero.swingBest = null; hero.swingHit = false; hero.hitLock = 0;
  hero.stats.whiffs = 0; hero.stats.hits = 0; hero.stats.smashes = 0;
  const ball = R.ball as Ball;
  const towardNet = side === "left" ? 1 : -1;
  ball.x = hero.x + towardNet * dist; ball.y = CO.groundY - h;
  ball.px = ball.x; ball.py = ball.y;
  ball.vx = -towardNet * Math.abs(vx);          // 恒朝 hero 那侧飞
  ball.vy = vy;
  ball.live = true; ball.held = false; ball.owner = null;
  ball.flying = false; ball.flyT = 0;
  ball.lastHitter = side === "left" ? "right" : "left";
  // crossed 照真实位置给:dist 大的格子球还在网对面,骗引擎"已过网"会把得分判读一起带歪
  ball.crossed = side === "left" ? ball.x < CO.netX : ball.x > CO.netX;
  ball.netted = false; ball.shot = null; ball.magnetPull = null;
  R.state = "RALLY"; R.timer = 0; R.serveWait = 0; R.events.length = 0;
  hero.isAI = false;                            // 本工具量的是玩家侧
  return { hero, ball };
}

interface Cast {
  hit: boolean;
  /** 出球在第几帧(0 = 按下技能那一帧起算) */
  frames: number;
  /** 系统代拍出拍在第几帧(-1 = 整段没起拍) */
  swingFrame: number;
  swings: number;
  /** 第一次起拍是不是系统代出的(替身没按击打键却起了拍) */
  autoStarted: boolean;
  kind: string | null;
  skillKind: string | null;
  perfect: boolean;
  q: number;
  aim: string | undefined;
  intoNet: boolean;
  landX: number;
  whiffs: number;
  buffLeft: number;
  autoLeft: number;
  cd: number;
}

const MISS: Cast = {
  hit: false, frames: 0, swingFrame: -1, swings: 0, autoStarted: false, kind: null, skillKind: null,
  perfect: false, q: 0, aim: undefined, intoNet: false, landX: 0, whiffs: 0,
  buffLeft: 0, autoLeft: 0, cd: 0,
};

type Plan = (f: number, hero: PlayerEntity, ball: Ball) => Partial<PlayerInput>;

/** 每一帧决定 hero 按什么;第 0 帧恒按重击键(要关就传不 cast 的 plan) */
function run(side: TeamSide, h: number, dist: number, vx: number, vy: number, plan: Plan, maxFrames = 170): Cast {
  const R = Rules.R;
  const { hero, ball } = bench(side, h, dist, vx, vy);
  let swingFrame = -1, swings = 0, prev = false, autoStarted = false;
  const acc: () => Cast = () => ({
    ...MISS, swingFrame, swings, autoStarted,
    whiffs: hero.stats.whiffs, buffLeft: hero.skill ? hero.skill.buffT : 0,
    autoLeft: hero.smashAutoT ?? 0, cd: hero.skill ? hero.skill.cd : 0,
  });
  for (let f = 0; f < maxFrames; f++) {
    R.events.length = 0;
    const mine = plan(f, hero, ball);
    Rules.step(R.players.map((p) => (p === hero ? { ...idleInput(), ...mine } : idleInput())));
    const swinging = hero.swingT >= 0;
    if (swinging && !prev) {
      swings++;
      if (swingFrame < 0) {
        swingFrame = f;
        autoStarted = !mine.swingAim;         // 替身没按击打键却起了拍 = 系统代的那一下
      }
    }
    prev = swinging;
    const e = R.events.find((x) => x.t === "hit");
    if (e) {
      return {
        ...acc(), hit: true, frames: f, kind: e.kind as string, skillKind: (e.skillKind as string | null) ?? null,
        perfect: !!e.perfect, q: e.q as number, aim: e.aim as string | undefined,
        intoNet: !!e.intoNet, landX: e.landX as number,
      };
    }
    if (R.state !== "RALLY") break;           // 球落地/得分:这一拍没接上
    if (hero.stats.whiffs > 0) break;         // 挥空了,不用再等
  }
  return acc();
}

/** 只按一次重击,别的什么都不按 —— 要验收的就是这个 */
const oneTap = (g: Cell): Cast => run(g.side, g.h, g.dist, g.vx, g.vy, (f) => (f === 0 ? { skillPressed: true } : {}));

/** 零反应延迟的手动基线:同样先上弦,但那一拍由替身在完美帧自己按(近球 = 它瞄的) */
const perfectManual = (g: Cell, aim: string = "mid"): Cast => {
  let done = false;
  return run(g.side, g.h, g.dist, g.vx, g.vy, (f, hero, ball) => {
    if (f === 0) return { skillPressed: true };
    if (!done) {
      const fc = framesToCentre(hero, ball);
      if (fc !== null && fc <= PERFECT_LEAD) { done = true; return { swingAim: aim }; }
    }
    return {};
  });
};

/** 照游戏教的那一帧按(时机环收满 = 提前 reactFrames 补反应)——"认真玩了"的对照 */
const cueTimed = (g: Cell): Cast => {
  let done = false;
  return run(g.side, g.h, g.dist, g.vx, g.vy, (f, hero, ball) => {
    if (f === 0) return { skillPressed: true };
    if (!done) {
      const fc = framesToCentre(hero, ball);
      if (fc !== null && fc <= PERFECT_LEAD + C.swingCue.reactFrames) { done = true; return { swingAim: "mid" }; }
    }
    return {};
  });
};

/** 按时机环的锚算「还有几帧到判定区心」;null = 这段路上根本够不着 */
const framesToCentre = (hero: PlayerEntity, ball: Ball): number | null => {
  const z = Pl.strikeZone(hero, Math.hypot(ball.vx, ball.vy));
  return flightFramesToClosest(ball, z.x, z.y, z.r, SM.autoHorizon);
};

// ---------- 网格:高度 × 来球远近 × 来球速度 × 两侧 ----------
// 高度取到 215px:重击只承诺"必定暴扣",不承诺"手更长" —— 站着够不着的高球必须老实沉默。
const HEIGHTS = [30, 60, 95, 130, 175, 215];
// 球在 hero 朝网一侧这么远起步(hero 站 netX∓150):40 = 身前,110 = 贴近网,
// 180/250 = 刚过网在中线附近,330 = 还在对面半场慢慢飞来。
// 最后那一档量的是重击的正当用法「预开启附魔」—— 按下时球还老远,窗必须等到它到手。
const DISTS = [40, 110, 180, 250, 330];
const VEL: Array<[number, number, string]> = [
  [3, 5, "慢下坠"], [7, 2, "平快压过来"], [4, -3, "还在上升"], [11, 8, "对方重杀回钻"],
  [2.6, -0.6, "高远慢球(预开启那一档)"],
];

interface Cell { side: TeamSide; h: number; dist: number; vx: number; vy: number; tag: string }
const cells = (): Cell[] => {
  const list: Cell[] = [];
  for (const side of ["left", "right"] as TeamSide[]) {
    for (const h of HEIGHTS) {
      for (const dist of DISTS) {
        for (const [vx, vy, vLabel] of VEL) {
          list.push({ side, h, dist, vx, vy, tag: `${side === "left" ? "左" : "右"} h=${h} d=${dist} ${vLabel}` });
        }
      }
    }
  }
  return list;
};

const inOpponentCourt = (side: TeamSide, landX: number): boolean =>
  side === "left" ? landX > CO.netX && landX <= CO.right : landX < CO.netX && landX >= CO.left;

/** 这颗**来球**自己会落在哪儿:界外(对手的失误)与贴地的球,正确答案都是"别碰" */
function incomingTag(side: TeamSide, h: number, dist: number, vx: number, vy: number): "界外" | "贴地" | "可及" {
  const { hero, ball } = bench(side, h, dist, vx, vy);
  const fut = Pl.ballFuture(hero, ball, SM.autoLandHorizon);
  if (fut.land <= SM.autoLandHorizon
    && (fut.landX < CO.left - SM.autoOutMargin || fut.landX > CO.right + SM.autoOutMargin)) return "界外";
  if (fut.land <= SW.windup + 1) return "贴地";
  return "可及";
}

/** 沉默的理由,拿与机制同一批判据、同一个时机(起拍之前)读到的状态反查 */
const silenceWhy = (hero: PlayerEntity, ball: Ball): string => {
  if ((hero.smashAutoT ?? 0) <= 0) return "待发窗已过期(按下时球还在老远,代劳没赶上)";
  if (!hero.skill || hero.skill.buffT <= 0) return "?! 待发窗还开着而附魔没了";
  const fc = framesToCentre(hero, ball);
  if (fc === null) return "整段都够不着(最近逼近超出判定区)";
  if (fc > PERFECT_LEAD) return "窗口内始终没到该按的那一帧";
  const fut = Pl.ballFuture(hero, ball, SM.autoLandHorizon);
  if (fut.cross < 0 || fut.cross > SW.windup + SW.active) return "整条命中窗内球都没过网";
  if (fut.land <= SM.autoLandHorizon
    && (fut.landX < CO.left - SM.autoOutMargin || fut.landX > CO.right + SM.autoOutMargin)) return "落点在界外:让它落地收分";
  if (fut.land <= SW.windup + 1) return "球已贴地:救不到,不空挥";
  if (fut.land <= fc + SM.autoSettleGrace) return "球死在结算之前:这一拍结不出来,不空挥";
  return "?! 到点了却没起手";
};

/** 跑一键,顺手记最后一次的沉默理由(取末值:窗口的最后一帧才是"到底该不该按") */
function oneTapWhy(g: Cell): Cast & { why: string } {
  let why = "";
  const r = run(g.side, g.h, g.dist, g.vx, g.vy, (f, hero, ball) => {
    if (f === 0) return { skillPressed: true };
    if (hero.swingT < 0 && !hero.swingBuf) why = silenceWhy(hero, ball);
    return {};
  });
  return { ...r, why: r.hit ? "系统代拍、球回对方场内" : r.swings > 0 ? "?! 起了拍却没碰到球" : why || "?! 一帧都没评估(待发窗没开?)" };
}

// ---------- ⑩ 一键兑现:起了拍必须干净,沉默必须有理由 ----------
const s10 = (ck: Checker): void => {
  const GRID = cells();
  const dirty: string[] = [], unexplained: string[] = [], gaveUp: string[] = [];
  const hist = new Map<string, number>();
  let hits = 0, playable = 0, doomed = 0, ghost = 0, ghostDoomed = 0;
  for (const g of GRID) {
    const tag = incomingTag(g.side, g.h, g.dist, g.vx, g.vy);
    const a = oneTapWhy(g);
    const key = `${tag} → ${a.why}`;
    hist.set(key, (hist.get(key) ?? 0) + 1);
    if (a.hit) {
      hits++;
      const fail = (why: string): void => { dirty.push(`${g.tag} [来球${tag}] → ${why}`); };
      if (tag === "界外") fail("落点界外的来球被替玩家捞回去了(这分本来就该收下)");
      else if (!a.autoStarted) fail("这一拍不是系统代出的 —— 待发窗没起作用,一键化是假的");
      else if (a.swings !== 1) fail(`一次施放起了 ${a.swings} 次拍(该只代一拍)`);
      else if (a.kind !== "smash") fail(`代劳那一拍不是扣杀(实际 ${a.kind})`);
      else if (a.skillKind !== "smash") fail(`skillKind=${a.skillKind}(飘字/特效/震动都认它)`);
      else if (!a.perfect) fail("兑现没走顶档:modifyShot 的质量改写没生效");
      else if (a.intoNet) fail("这拍下网");
      else if (!inOpponentCourt(g.side, a.landX)) fail(`落点 ${Math.round(a.landX)} 不在对方场内`);
      else if (a.buffLeft > 0) fail(`命中后附魔没消耗(还剩 ${a.buffLeft} 帧)`);
      else if (a.cd <= 0) fail("兑现后冷却没开跑(等于无限白嫖附魔)");
      else if (a.cd > CD) fail(`兑现付的冷却比配置还多(实际 ${a.cd})`);
      else if (a.frames > SM.autoWindow + SW.windup + SW.active + 8) fail(`按完 ${a.frames} 帧才出球,太拖`);
      continue;
    }
    if (tag !== "可及") {
      // 界外/贴地的球却起了拍:要么把对手送的分捞回去,要么对着死球空挥 —— 两种都是"莫名挥一下"
      if (a.swings > 0) dirty.push(`${g.tag} [来球${tag}] → 替玩家代了一拍却没碰到球(第 ${a.swingFrame} 帧)`);
      continue;
    }
    playable++;
    const m = perfectManual(g);                   // 连"零反应延迟的完美手动"也救不到的格子不算账
    if (a.swings > 0) { ghost++; if (!m.hit) ghostDoomed++; }
    if (!m.hit) { doomed++; continue; }
    if (a.swings > 0) { dirty.push(`${g.tag} → 替玩家起了拍却空挥(完美手动第 ${m.frames} 帧救得到)`); continue; }
    if (a.why.startsWith("?!")) { unexplained.push(`${g.tag} → ${a.why}`); continue; }
    gaveUp.push(`${g.tag} → ${a.why};但完美手动在第 ${m.frames} 帧救到了(q=${m.q.toFixed(2)})`);
  }
  for (const b of dirty.slice(0, 8)) console.log(`  ✗ ${b}`);
  for (const b of unexplained.slice(0, 8)) console.log(`  ✗ ${b}`);
  for (const b of gaveUp.slice(0, 8)) console.log(`  ✗ 放过一格该救的球:${b}`);
  ck.ok(dirty.length === 0, `⑩ 起拍的 ${hits} 格全部干净:系统代拍、必定扣杀、顶档兑现、命中即消耗、只代一拍、不捞界外球`);
  ck.ok(unexplained.length === 0, `⑩ ${unexplained.length} 次出手/沉默说不出玩家认可的理由 —— 要么兑现、要么说得出为什么不动`);
  ck.ok(gaveUp.length === 0, `⑩ 界内"可及"的 ${playable} 格里放过了 ${gaveUp.length} 格(完美手动救得到、一键没救到);另有 ${doomed} 格连完美手动也救不到,不算账`);
  // 代拍挥空只许发生在"谁来都打不到"的那一档:一格落进"完美手动救得到"就是抢了玩家能打通的球。
  ck.ok(ghost === ghostDoomed,
    `⑩ ${ghost} 格代拍挥空,${ghostDoomed} 格落在"连完美手动也打不到"那一档${ghost === ghostDoomed ? "(全部有豁免)" : " —— 有格子在玩家本来打得着的球上空挥"}`);
  console.log(`   统计:代拍兑现 ${hits} 格 / 沉默但有理由 ${playable - ghost - gaveUp.length} 格 / 挥空 ${ghost} 格(全豁免 ${ghostDoomed})`);
  console.log("   归因:" + [...hist.entries()].sort((p, q) => q[1] - p[1]).map(([k, v]) => `${k} ×${v}`).join("  |  "));
};

// ---------- ⑪ 该不出手:一律不许替玩家挥这一拍 ----------
const s11 = (ck: Checker): void => {
  /** 端到端跑一段,断言整段没起过拍 */
  const noSwing = (why: string, side: TeamSide, h: number, dist: number, vx: number, vy: number,
    tweak?: (hero: PlayerEntity, ball: Ball) => void): void => {
    const R = Rules.R;
    const { hero, ball } = bench(side, h, dist, vx, vy);
    if (tweak) tweak(hero, ball);
    let firstSwing = -1;
    for (let f = 0; f < 70; f++) {
      R.events.length = 0;
      Rules.step(R.players.map((p) => {
        const inp = idleInput();
        if (p === hero && f === 0) inp.skillPressed = true;
        return inp;
      }));
      if (firstSwing < 0 && hero.swingT >= 0) firstSwing = f;
      if (R.state !== "RALLY") break;
    }
    ck.ok(firstSwing < 0, `⑪ ${why}:整段没代拍${firstSwing < 0 ? "" : ` —— 第 ${firstSwing} 帧莫名替玩家挥了一下`}`);
  };
  // 又平又快、穿过判定区仍要出界的球:正确打法是让它落地、把这分收下
  noSwing("又平又快、穿过判定区仍要出界的球", "left", 60, 40, 15, -6);
  // 永远进不了判定区的球(高过头顶掠走):重击不承诺手更长,为兑现机制空挥一拍比不挥更难看
  noSwing("整段路上都够不着的高球", "left", 250, 20, 7, -2);
  // 球在对方半场且不往这边来(隔网不许够)
  noSwing("球在对方半场、还在往深处飞", "left", 90, 60, -4, 2, (_h, ball) => {
    ball.x = CO.netX + 150; ball.vx = 4; ball.crossed = false;
  });
  // 脚下已经贴地的死球
  noSwing("脚下已经贴地的死球", "left", 4, 30, 1, 6);
  // 自家球:同队一回合只许击球一次,起拍了必然挥空
  noSwing("自家刚打出去的球", "left", 90, 60, 4, 2, (_h, ball) => { ball.lastHitter = "left"; });
  // 握在手上 / 得分后飞回手里 / 死球:判据层直接拒
  {
    const { hero, ball } = bench("left", 90, 60, 4, 2);
    hero.smashAutoT = SM.autoWindow;
    ball.held = true;
    ck.ok(!Pl.autoSwingDue(hero, ball, "smash"), "⑪ 球握在手上(发球前)→ 判据必须拒");
    ball.held = false; ball.flying = true;
    ck.ok(!Pl.autoSwingDue(hero, ball, "smash"), "⑪ 得分后球飞回手里 → 判据必须拒");
    ball.flying = false; ball.live = false;
    ck.ok(!Pl.autoSwingDue(hero, ball, "smash"), "⑪ 死球 → 判据必须拒");
    ball.live = true;
  }
  // 附魔过期、窗还留着(改数值改出来的中间态):那一拍不许被代成"没有附魔的普通拍"。
  // 对照组必须真的会代拍 —— 不然这一条只是在量一个本来就不起拍的死场景。
  {
    const swingWithBuff = (keepBuff: boolean): boolean => {
      const R = Rules.R;
      const h = bench("left", 90, 20, 1, 1);          // 贴脸慢球:正常情况下代拍一定会起
      Skills.activate(h.hero, h.ball);
      if (!keepBuff) h.hero.skill!.buffT = 0;         // 只摘附魔,待发窗留着
      let swung = false;
      for (let f = 0; f < 40; f++) {
        Rules.step(R.players.map((p) => idleInput()));
        if (h.hero.swingT >= 0) swung = true;
        if (R.state !== "RALLY") break;
      }
      return swung;
    };
    ck.ok(swingWithBuff(true), "⑪ 对照组(贴脸慢球 + 附魔在)系统必须代拍 —— 拦不住就证明这条判据没牙齿");
    ck.ok(!swingWithBuff(false), "⑪ 附魔已过期 → 不许代出一记没有附魔的普通拍(残窗必须哑掉)");
  }
  // 门槛没动:附魔中不能重复上弦,冷却中按不下去
  {
    const { hero, ball } = bench("left", 90, 60, 3, 2);
    ck.ok(Skills.canActivate(hero, ball), "⑪ 空场状态下重击键必须按得下去(预开启是它的正当用法)");
    Skills.activate(hero, ball);
    ck.ok(!Skills.canActivate(hero, ball), "⑪ 附魔中再按必须拒绝(不许叠两层附魔)");
    hero.skill!.buffT = 0; hero.skill!.cd = 5;
    ck.ok(!Skills.canActivate(hero, ball), "⑪ 冷却中重击键必须拒绝");
    hero.skill!.cd = 0; hero.swingT = 3;
    ck.ok(Skills.canActivate(hero, ball), "⑪ 挥拍中仍允许上弦(旧口径如此,一键化不该顺手加一道闸)");
  }
};

// ---------- ⑫ 手动优先:玩家自己按了击打,代劳当场让位 ----------
const s12 = (ck: Checker): void => {
  const GRID = cells();
  // 定标格要挑「代拍发生在第 8 帧之后」的那一格:第 0 帧就代拍的格子里,替身在同一帧只能
  // 表达一个意图(按下技能键那一帧就把它当 f=0 的 cast),抢拍两测量不到"谁让位"。
  const aCell = (g: Cell): Cast => oneTap(g);
  const live = GRID.find((g) => { const a = aCell(g); return a.hit && a.swingFrame >= 8; })
    ?? GRID.find((g) => aCell(g).hit);
  if (!live) { ck.ok(false, "⑫ 找不到任何一格一键能兑现的球,这条没法验(先看 ⑩ 的 ✗)"); return; }
  const a0 = aCell(live);
  console.log(`   定标格:${live.tag}(系统在第 ${a0.swingFrame} 帧代拍、第 ${a0.frames} 帧出球)`);
  // 与自动同一帧抢拍:落点必须用玩家瞄的短球,且整段只起一次拍
  let autoLeftAfter = -1;
  const grab = run(live.side, live.h, live.dist, live.vx, live.vy, (f, hero) => {
    if (f === 0) return { skillPressed: true };
    if (f === a0.swingFrame) return { swingAim: "near" };
    if (f === a0.swingFrame + 1) autoLeftAfter = hero.smashAutoT ?? -1;
    return {};
  });
  ck.ok(grab.hit, `⑫ 玩家接管那一拍根本没打出去(${live.tag})`);
  ck.ok(grab.aim === "near", `⑫ 手动那一拍的落点变成了 ${grab.aim}(玩家说的短球没算数)`);
  ck.ok(grab.swings === 1, `⑫ 这一分里起了 ${grab.swings} 次拍(手动 + 自动各一下 = "我按了它又挥一下")`);
  ck.ok(autoLeftAfter === 0, `⑫ 玩家按下击打那一帧之后待发窗还剩 ${autoLeftAfter} 帧(应当场清零)`);
  // 提前抢拍:玩家在自动之前就先按,自动那拍更要闭嘴
  const early = run(live.side, live.h, live.dist, live.vx, live.vy, (f) => {
    if (f === 0) return { skillPressed: true };
    if (f === Math.max(1, a0.swingFrame - 4)) return { swingAim: "near" };
    return {};
  });
  ck.ok(early.swings === 1, `⑫ 提前抢拍也起了 ${early.swings} 次拍(自动不该在后面补一下)`);
  ck.ok(early.hit, "⑫ 提前抢拍那一拍没打出去(替身按在完美帧之前,机制不该再抢)");
  // 照游戏教的那一帧按:玩家认真玩了,系统不该抢在他前面把短球改成深球
  const cue = run(live.side, live.h, live.dist, live.vx, live.vy, (f, hero, ball) => {
    if (f === 0) return { skillPressed: true };
    const fc = framesToCentre(hero, ball);
    if (fc !== null && fc <= PERFECT_LEAD + C.swingCue.reactFrames) return { swingAim: "near" };
    return {};
  });
  ck.ok(cue.swings === 1 && (!cue.hit || cue.aim === "near"),
    `⑫ 按着时机环玩的人被抢拍了(起了 ${cue.swings} 拍、落点 ${cue.aim})`);
};

// ---------- ⑬ 计时器每帧只减一次(与 lungeShotT 从前那个坑同形) ----------
const s13 = (ck: Checker): void => {
  const R = Rules.R;
  const { hero } = bench("left", 90, 300, 3, 2);   // 远球:整段都不会起手,只看计时器
  const N = 20;
  for (let f = 0; f < N; f++) {
    Rules.step(R.players.map((p) => {
      const inp = idleInput();
      if (p === hero && f === 0) inp.skillPressed = true;
      return inp;
    }));
  }
  const window0 = Math.min(SM.autoWindow, BUFF);
  ck.ok((hero.smashAutoT ?? 0) === window0 - N,
    `⑬ 待发窗诚实:配置 ${window0} 帧走完 ${N} 步应剩 ${window0 - N}(实际剩 ${hero.smashAutoT})`);
  ck.ok(hero.skill!.buffT === BUFF - N,
    `⑬ 附魔诚实:配置 ${BUFF} 帧走完 ${N} 步应剩 ${BUFF - N}(实际剩 ${hero.skill!.buffT}) —— 技能文案"4 秒"吃的就是这个数`);
  ck.ok(hero.skill!.cd === 0, `⑬ 没兑现就不该有冷却在跑(实际 ${hero.skill!.cd})`);
  ck.ok(hero.swingT < 0 && hero.stats.hits === 0, "⑬ 这一路没替玩家瞎起一拍(远球静默)");
};

// ---------- ⑭ 冷却随兑现走:按下不付、挥空不付、扣出去付一次 ----------
const s14 = (ck: Checker): void => {
  // a) 按下只上弦:不进冷却,但也不能叠第二层
  const a = bench("left", 90, 60, 3, 2);
  Skills.activate(a.hero, a.ball);
  ck.ok(a.hero.skill!.cd === 0, `⑭ 按下不进冷却(实际 ${a.hero.skill!.cd}) —— 用户点名「挥空不会冷却」`);
  ck.ok((a.hero.smashAutoT ?? 0) === Math.min(SM.autoWindow, BUFF), "⑭ 按下同时开代拍窗");
  ck.ok(!Skills.canActivate(a.hero, a.ball), "⑭ 附魔中拦人的是 buffT,不是冷却(读数 = 附魔中)");
  // b) 端到端挥空:罚都不该有
  const whiff = run("left", 90, 250, 2, 4, (f) => (f === 0 ? { skillPressed: true } : f === 2 ? { swingAim: "mid" } : {}), 40);
  ck.ok(whiff.cd === 0, `⑭ 挥空/没兑现都不进冷却(实际 cd=${whiff.cd})`);
  // c) 兑现:冷却恰好开跑一次,且拦得住第二次上弦
  const GRID = cells();
  const live = GRID.find((g) => oneTap(g).hit);
  if (!live) { ck.ok(false, "⑭ 找不到一格能兑现的球(先看 ⑩)"); return; }
  const hit = oneTap(live);
  ck.ok(hit.cd > 0 && hit.cd <= CD, `⑭ 扣出去才付冷却,且不超过配置 ${CD} 帧(实际 ${hit.cd})`);
  ck.ok(hit.buffLeft === 0, `⑭ 兑现即消耗附魔(实际还剩 ${hit.buffLeft})`);
  ck.ok(hit.autoLeft === 0, `⑭ 兑现后代拍窗收干净(实际还剩 ${hit.autoLeft})`);
  // d) 预告一口都不吃:cd/buffT/待发窗都不许动(① 的 snap 已含,这里端到端再来一次)
  const d = bench("left", 90, 20, 1, 1);
  Skills.activate(d.hero, d.ball);
  const before = snap(d.hero);
  for (let i = 0; i < 6; i++) Pl.previewKind(d.hero, d.ball);
  ck.ok(snap(d.hero) === before, `⑭ 六记预告之后状态逐字段不变(实际 ${snap(d.hero)})`);
};

// ---------- ⑮ AI 侧口径一个字都不动(否则等于偷偷改难度) ----------
const s15 = (ck: Checker): void => {
  const R = Rules.R;
  const a = bench("right", 90, 60, 4, 2);
  const cpu = a.hero;
  cpu.isAI = true;
  ck.ok(!Skills.defersCooldownToConsume(cpu), "⑮ AI 不走「冷却随兑现」这条路(它的技能循环归 diffs 管)");
  ck.ok(Skills.activate(cpu, a.ball, cpu.facing), "⑮ AI 按下重击仍要成功(技能本身不许被砍)");
  ck.ok(cpu.skill!.cd === CD, `⑮ AI 按下即付冷却,与改动前一致(实际 ${cpu.skill!.cd})`);
  ck.ok((cpu.smashAutoT ?? 0) === 0, `⑮ AI 永远拿不到代拍窗(实际 ${cpu.smashAutoT})`);
  // 给它 70 帧空输入:一次代拍都不许有(真人替身从不按技能键,serve-check/ai-check 量不到这条)
  let swung = false;
  for (let f = 0; f < 70; f++) {
    Rules.step(R.players.map((p) => idleInput()));
    if (cpu.swingT >= 0) swung = true;
    if (R.state !== "RALLY") break;
  }
  ck.ok(!swung, "⑮ AI 侧整段没被系统代拍(白送永不失误的暴扣 = 给对手加难度)");
  // 判定区也不该因为这套窗变大:重击不承诺手更长
  const h = bench("left", 90, 60, 4, 2);
  Skills.activate(h.hero, h.ball);
  const withWin = Pl.strikeZone(h.hero, 6).r;
  h.hero.smashAutoT = 0;
  const noWin = Pl.strikeZone(h.hero, 6).r;
  ck.ok(Math.abs(withWin - noWin) < 1e-9, `⑮ 代拍窗不放大判定区(开了窗 ${withWin} / 没开 ${noWin})—— 那是跨步的卖点,不是重击的`);
};

// ---------- ⑯ 待发窗覆盖度与参数自洽(窗太短 = "按了没反应"换个马甲) ----------
const s16 = (ck: Checker): void => {
  ck.ok(SM.autoReturn, "⑯ 一键化总闸开着(autoReturn;要整套撤掉只改这里)");
  ck.ok(SM.autoWindow <= BUFF, `⑯ 代拍窗不许长过附魔本体(${SM.autoWindow} ≤ ${BUFF}):超出去会在没附魔的帧上代一记普通球`);
  ck.ok(SM.cdOnConsume, "⑯ 冷却随兑现的总闸开着(关掉就退回旧口径,①⑤⑭ 会一起报警)");
  // 与跨步同一把尺子:门控数值刻意同源,分叉要连判据一起改
  ck.ok(SM.autoHorizon === C.lunge.autoHorizon && SM.autoLandHorizon === C.lunge.autoLandHorizon
    && SM.autoOutMargin === C.lunge.autoOutMargin && SM.autoSettleGrace === C.lunge.autoSettleGrace,
    `⑯ 两条一键化的门控数值必须同源(重击 ${SM.autoHorizon}/${SM.autoLandHorizon}/${SM.autoOutMargin}/${SM.autoSettleGrace} vs 跨步 ${C.lunge.autoHorizon}/${C.lunge.autoLandHorizon}/${C.lunge.autoOutMargin}/${C.lunge.autoSettleGrace})`);
  // 实测覆盖度:可及且完美手动救得到的格子里,一格都不许因为"窗先走完"而沉默
  const GRID = cells();
  const lat: number[] = [];
  let expired = 0, checked = 0;
  for (const g of GRID) {
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
    + ` 中位 ${at(0.5)} / p95 ${at(0.95)} / 最远 ${at(1)}(autoWindow=${SM.autoWindow})`);
  ck.ok(checked === 0 || lat.length === checked, `⑯ 有 ${checked - lat.length} 格"完美手动救得到"却没测出代拍帧数`);
  ck.ok(expired === 0, `⑯ ${expired} 格因为「待发窗已过期」没赶上代劳(autoWindow=${SM.autoWindow} 太短)`);
  ck.ok(at(1) < SM.autoWindow, `⑯ 网格里最远一次代拍第 ${at(1)} 帧,窗口 ${SM.autoWindow} 帧必须盖住它`);
  // 网格的球起步都在场内,量不到"对方刚出手就预开启"那一档 —— 真正的上限来自球速档:
  // 同一空间轨迹在世界帧里被拉长 1/s。实测(AI vs AI 各 12 模拟分钟、每档 ~1000 拍,
  // 量「对方出手 → 接手方的『就是现在』帧」):标准 s=0.92 中位 32/p95 53/最远 84;
  // 极限慢 s=0.6 中位 52/p95 79/最远 135(19 拍 >100 帧)。手机玩家多在慢档(reach-check §5
  // 那张组合矩阵就推荐慢档),窗必须按最慢档定 —— 短一格就是"按了没反应"原地重演。
  const PACE_FLOOR = 135;
  ck.ok(SM.autoWindow > PACE_FLOOR,
    `⑯ 待发窗要盖住「极限慢球速档」最远一击(实测 ${PACE_FLOOR} 帧,现 ${SM.autoWindow})—— 窗短了,慢档玩家按下重击还是得自己按`);
};

// ---------- ⑰ 代劳那一拍的落点:压深但不许送出底线 ----------
const s17 = (ck: Checker): void => {
  const GRID = cells();
  const depths: number[] = [];
  let outOfCourt = 0, auto = 0;
  for (const g of GRID) {
    const a = oneTap(g);
    if (!a.hit || !a.autoStarted) continue;
    auto++;
    const d = g.side === "left"
      ? (a.landX - CO.netX) / (CO.right - CO.netX)
      : (CO.netX - a.landX) / (CO.netX - CO.left);
    if (d < 0 || d > 1) { outOfCourt++; continue; }
    depths.push(d);
  }
  const mean = depths.length ? depths.reduce((x, y) => x + y, 0) / depths.length : 0;
  console.log(`   代拍落点:${auto} 拍,平均压到对方场地 ${(mean * 100).toFixed(0)}% 深处、送出界 ${outOfCourt} 格(autoAim=${SM.autoAim})`);
  ck.ok(outOfCourt === 0, `⑰ 一键不许把重扣送出对方底线(实得 ${outOfCourt} 格出界;autoAim=${SM.autoAim})`);
  ck.ok(mean >= 0.6, `⑰ 重击"默认压深"要名副其实:平均落点 ≥65% 深(实得 ${(mean * 100).toFixed(0)}%)`);
  // 一键不许比"照时机环认真玩"少兑现:那说明机制在抢人的同时还没打好
  const a1 = cells().filter((g) => oneTap(g).hit).length;
  const c1 = cells().filter((g) => cueTimed(g).hit).length;
  ck.ok(a1 >= c1, `⑰ 一键兑现 ${a1} 格,对照「照时机环自己按」${c1} 格${a1 >= c1 ? "(没被抢拍拖后腿)" : " —— 代劳反而不如玩家自己按,择帧尺子跑偏了"}`);
};

interface Section { name: string; run: (ck: Checker) => void }
const SECTIONS: Section[] = [
  { name: "① 球种预告是纯预览:不吃 buff、不记账、但照旧说真话", run: s1 },
  { name: "② 上弦后的下一拍 = 必定重扣(只消耗一次)", run: s2 },
  { name: "③ 技能的质量改写真的生效(顶档 + 误差归零 + 统计不洗)", run: s3 },
  { name: "④ 兑现后不能白嫖:冷却才是门槛", run: s4 },
  { name: "⑤ 挥空不吃附魔(宽容档)", run: s5 },
  { name: "⑥ 同族(闪现必中窗 / 引力回击)也不许被预告偷吃", run: s6 },
  { name: "⑦ 附魔期发球也算必定暴扣(拍板保留)", run: s7 },
  { name: "⑧ 端到端复现:按技能 → 喂预告 → 挥拍 → hit 事件顶档重扣", run: s8 },
  { name: "⑨ 顶档改写只给真人,AI 侧行为与修前一致", run: s9 },
  { name: "⑩ 一键兑现:按下重击就把这一拍轰出去(6 高度 × 5 远近 × 5 来球速度 × 两侧)", run: s10 },
  { name: "⑪ 该不出手一律不代拍(界外 / 够不着 / 隔网 / 贴地 / 自家球 / 残窗)", run: s11 },
  { name: "⑫ 手动优先:玩家自己按了击打,代劳当场让位、落点用他瞄的", run: s12 },
  { name: "⑬ 计时器每帧只减一次(待发窗 / 附魔 / 冷却)", run: s13 },
  { name: "⑭ 冷却随兑现走:按下不付、挥空不付、扣出去付一次", run: s14 },
  { name: "⑮ AI 侧口径不动:按下即付冷却、永远拿不到代拍窗、判定区不放大", run: s15 },
  { name: "⑯ 待发窗覆盖度与参数自洽(窗太短 = 「按了没反应」换个马甲)", run: s16 },
  { name: "⑰ 代拍落点:压深但不许送出底线,且不比「照时机环玩」差", run: s17 },
];

/** 反例 patch 用的原函数 */
const original = Skills.modifyShot;
const originalDue = Pl.autoSwingDue;
const originalActivate = Skills.activate;
type Modify = typeof Skills.modifyShot;
type Due = typeof Pl.autoSwingDue;
type Activate = typeof Skills.activate;

/** 反例 A:旧写法 —— 预告也算命中,三处 buff 无条件消耗(质量改写在新的调用顺序下是生效的) */
const legacy: Modify = (p, opt) => {
  const r = original(p, opt);
  if (p && p.skill) {
    if (p.skill.id === "smash") p.skill.buffT = 0;
    if (p.skill.id === "magnet") p.skill.magnetPulling = false;
    if (p.skill.id === "flash") p.flashStrikeT = 0;
  }
  return r;
};

/** 反例 B:旧顺序的实际效果 —— 钩子回写的 q/sweet/perfect 读不到(消耗仍按新规矩让路) */
const noOverride: Modify = (p, opt: HitOpt) => {
  const q = opt.q; const sweet = opt.sweet; const perfect = opt.perfect;
  const r = original(p, opt);
  if (q === undefined) delete opt.q; else opt.q = q;
  if (sweet === undefined) delete opt.sweet; else opt.sweet = sweet;
  if (perfect === undefined) delete opt.perfect; else opt.perfect = perfect;
  return r;
};

/** 反例 C:一次上弦吃好几拍 —— 兑现不清附魔(与其余四技能口径不一致,还会连环暴扣) */
const buffNotConsumed: Modify = (p, opt) => {
  const before = p && p.skill ? p.skill.buffT : 0;
  const r = original(p, opt);
  if (p && p.skill && p.skill.id === "smash" && !opt.preview) p.skill.buffT = before;
  return r;
};

/** 反例 D:一键化是假的 —— 择帧判据一口回绝(用户点名的"按了没反应"就是这一类) */
const noAuto: Due = () => false;
/** 反例 E:不择帧 —— 待发窗开着就起手(界外球、贴地死球、隔网球全被代) */
const alwaysDue: Due = () => true;
/** 反例 F:旧冷却口径 —— 按下即付 3.5 秒,挥空也照罚(用户 2026-10-04 点名要改掉的那条) */
const cdAtPress: Activate = (p, ball, dir) => {
  const ok = originalActivate(p, ball, dir);
  if (ok && p.skill && p.skill.id === "smash") p.skill.cd = Skills.defOf("smash").cooldownFrames;
  return ok;
};
/** 反例 G:拆掉 isAI 闸 —— AI 也拿到代拍窗(白送一记永不失误的暴扣 = 偷偷改难度) */
const aiGetsAuto: Activate = (p, ball, dir) => {
  const ok = originalActivate(p, ball, dir);
  if (ok && p.skill && p.skill.id === "smash") p.smashAutoT = SM.autoWindow;
  return ok;
};

const failsOf = (run: (ck: Checker) => void): number => {
  const ck = makeChecker({ printPass: false });
  run(ck);
  return ck.fails;
};

const selftest = process.argv.includes("--selftest");

if (selftest) {
  console.log("反例自检:七份改坏的真实写法必须被上面的判据拦住(拦不住 = 这套尺子没牙齿)");
  const find = (n: string): Section => {
    const s = SECTIONS.find((x) => x.name.startsWith(n));
    if (!s) throw new Error(`smash-check selftest:找不到段落 ${n}`);
    return s;
  };
  // 每份反例点名它"必须"弄红哪些段 —— 点名而不是"总数>0",免得靠无关断言蒙对
  //   legacy        :预告偷吃 → ①(纯度) ②(兑现) ⑥(同族) ⑧(端到端) 全得叫
  //   noOverride    :质量改写读不到 → ③ 得叫。⑧ 不指望它:端到端那局是按准的一拍,
  //                  物理档与技能档数值相同,那一段本来区分不了这两件事(③ 用晚按 9 帧的
  //                  场景专门把它区分开)。
  //   buffNotConsumed:兑现不吃附魔 → ② 与 ⑩(代拍命中后还剩 buff)都得叫
  //   noAuto        :从不代拍 → ⑩ 与 ⑫(找不到 live 格直接报警)都得叫
  //   alwaysDue     :不择帧就起手 → ⑪(该沉默的格全起拍)得叫
  //   cdAtPress     :按下即付冷却 → ① ⑬ ⑭ 都得叫(⑭ 就是那条用户点名的判据)
  //   aiGetsAuto    :AI 拿到代拍窗 → ⑮ 得叫
  const plan: Array<{ tag: string; patch: Modify; secs: string[] }> = [
    { tag: "legacy(预告也算命中)", patch: legacy, secs: ["①", "②", "⑥", "⑧"] },
    { tag: "noOverride(顶档改写读不到)", patch: noOverride, secs: ["③"] },
    { tag: "buffNotConsumed(兑现不吃附魔)", patch: buffNotConsumed, secs: ["②", "⑩"] },
  ];
  const duePlan: Array<{ tag: string; patch: Due; secs: string[] }> = [
    { tag: "noAuto(一键化是假的)", patch: noAuto, secs: ["⑩", "⑫"] },
    { tag: "alwaysDue(不择帧就起手)", patch: alwaysDue, secs: ["⑪"] },
  ];
  const activatePlan: Array<{ tag: string; patch: Activate; secs: string[] }> = [
    { tag: "cdAtPress(按下即付冷却 = 旧口径)", patch: cdAtPress, secs: ["①", "⑬", "⑭"] },
    { tag: "aiGetsAuto(拆掉 isAI 闸)", patch: aiGetsAuto, secs: ["⑮"] },
  ];
  let bad = 0;
  const apply = (secs: string[], label: string, failsFor: (n: string) => number): void => {
    for (const n of secs) {
      const fails = failsFor(n);
      if (fails === 0) { bad++; console.log(`  ✗ ${n} 全绿 —— 这条判据拦不住「${label}」`); }
      else console.log(`  ✓ ${n} 被拦住(${fails} 条报警)`);
    }
  };
  try {
    for (const { tag, patch, secs } of plan) {
      Skills.modifyShot = patch;
      console.log(`\n反例 ${tag}:`);
      apply(secs, tag, (n) => failsOf(find(n).run));
      Skills.modifyShot = original;
    }
    for (const { tag, patch, secs } of duePlan) {
      Pl.autoSwingDue = patch;
      console.log(`\n反例 ${tag}:`);
      apply(secs, tag, (n) => failsOf(find(n).run));
      Pl.autoSwingDue = originalDue;
    }
    for (const { tag, patch, secs } of activatePlan) {
      Skills.activate = patch;
      console.log(`\n反例 ${tag}:`);
      apply(secs, tag, (n) => failsOf(find(n).run));
      Skills.activate = originalActivate;
    }

    console.log("\n反例 doubleDecrement(计时器每帧多减一次 = lungeShotT 从前那个坑的孪生):");
    {
      const after = (extra: boolean): { auto: number; buff: number } => {
        const R = Rules.R;
        const { hero } = bench("left", 90, 300, 3, 2);     // 远球:整段不起拍,只看计时器
        for (let f = 0; f < 20; f++) {
          Rules.step(R.players.map((p) => {
            const inp = idleInput();
            if (p === hero && f === 0) inp.skillPressed = true;
            return inp;
          }));
          if (extra) {
            if ((hero.smashAutoT ?? 0) > 0) hero.smashAutoT = (hero.smashAutoT ?? 0) - 1;
            if (hero.skill && hero.skill.buffT > 0) hero.skill.buffT--;
          }
        }
        return { auto: hero.smashAutoT ?? 0, buff: hero.skill ? hero.skill.buffT : 0 };
      };
      const honest = after(false), legacy2 = after(true);
      const window0 = Math.min(SM.autoWindow, BUFF);
      if (honest.auto === window0 - 20 && honest.buff === BUFF - 20
        && legacy2.auto === honest.auto - 20 && legacy2.buff === honest.buff - 20) {
        console.log(`  ✓ 走完 20 步:诚实版剩 窗${honest.auto}/附魔${honest.buff},多减一行就剩`
          + ` 窗${legacy2.auto}/附魔${legacy2.buff} —— ⑬ 的算术就是靠这个差拦住手抖`);
      } else {
        bad++;
        console.log(`  ✗ 双减模拟没跑出差别(诚实 ${honest.auto}/${honest.buff} vs 旧写法 ${legacy2.auto}/${legacy2.buff}),⑬ 没牙齿`);
      }
    }

    console.log("\n反例 autoNotCleared(代拍起手不清窗 = 替玩家挥空之后连挥第二下):");
    {
      // 这一条没法用 patch 装(清理那行就在 player.update 里),改成算术对照:
      // 代拍那一帧之后窗必须已经是 0 —— 留着就会在收招后再代一次。s10 的 swings===1 是它的判据。
      const g = cells().find((c) => oneTap(c).hit);
      if (!g) { bad++; console.log("  ✗ 找不到一格能代拍的球"); }
      else {
        const a = oneTap(g);
        const R = Rules.R;
        const { hero, ball } = bench(g.side, g.h, g.dist, g.vx, g.vy);
        Skills.activate(hero, ball);
        const clearedOnSwing = (() => {
          for (let f = 0; f <= 60; f++) {
            Rules.step(R.players.map((p) => idleInput()));
            if (hero.swingT >= 0) return (hero.smashAutoT ?? 0) === 0;
            if (R.state !== "RALLY") break;
          }
          return false;
        })();
        if (clearedOnSwing && a.autoLeft === 0) console.log(`  ✓ 第 ${a.swingFrame} 帧代拍当场清窗(拍完剩 0)—— 不留"收招后再代一下"的尾巴`);
        else { bad++; console.log(`  ✗ 代拍之后窗没清(剩 ${hero.smashAutoT}),⑩ 的 swings===1 会漏判`); }
      }
    }
  } finally {
    Skills.modifyShot = original;
    Pl.autoSwingDue = originalDue;
    Skills.activate = originalActivate;
  }
  console.log(bad ? "\n✗ smash-check selftest 失败" : "\n✓ smash-check selftest:反例全被拦住");
  process.exit(bad ? 1 : 0);
}

const ck = makeChecker();
for (const sec of SECTIONS) {
  console.log(`\n${sec.name}`);
  sec.run(ck);
}
console.log(`\n${ck.fails === 0 ? "✓" : "✗"} smash-check:${ck.checks} 条断言,${ck.fails} 条失败`);
console.log("（③ 起手字改挂头顶是观感改动,靠 tools/panel-preview / 真机肉眼验收,不在这里断言;"
  + "「代劳那一下跟不跟手、要不要留 autoReturn」拇指判,得出 APK 再定）");
process.exit(ck.fails ? 1 : 0);
