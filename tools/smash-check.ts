// ============================================================
// 百分百重击(smash 附魔)回归 —— 2026-10-03 新增。
//
// 用户真机现场:「点击重击之后,应该是下一次挥拍触发重击。而我现在是点完重击它直接就在
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
//
// 用法:node .tools-build/tools/smash-check.js [--selftest]
//   --selftest 喂两份反例:legacy(预告也消耗)/ noOverride(质量改写读不到)。
//   一份不够 —— 只把旧消耗装回来,③ 那组断言照样绿(旧代码的坏是两件事叠出来的)。
//
// 反例靠"player.ts 经导出对象调用 Skills.modifyShot"这一点成立:属性赋值在调用期生效。
// 哪天把 player.ts 改成具名 import 直调,这里的 patch 就失去牙齿(会静默全绿),
// 改法记得同步换成本文件自带的注入位。
// ============================================================
import { Rules } from "../assets/scripts/core/rules";
import { Player as Pl, PRESS_LEAD_FRAMES } from "../assets/scripts/core/player";
import { Skills } from "../assets/scripts/core/skills";
import { CFG } from "../assets/scripts/core/config";
import {
  Ball, HitOpt, Player as PlayerEntity, PlayerInput, ShotResult, SkillId,
} from "../assets/scripts/core/types";
import { makeChecker, Checker } from "./harness";

const C = CFG;
const CO = C.court;

/** 技能机制数值的唯一真话源:config.skills.list 里 smash 那一档 */
const BUFF = C.skills.smash.buffDuration;
const CD = Skills.defOf("smash").cooldownFrames;

const idleInput = (): PlayerInput => ({
  left: false, right: false, jumpPressed: false, jumpHeld: false,
  swingAim: null, lungePressed: false,
});

/** 状态快照:预告必须一个字节都不动它(比逐条断言更难被"漏一个字段"糊过去) */
const snap = (p: PlayerEntity): string => JSON.stringify({
  buffT: p.skill ? p.skill.buffT : -1,
  cd: p.skill ? p.skill.cd : -1,
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
  ck.ok(s.cd === CD, `① 起手即进冷却(实际 ${s.cd})`);
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
  ck.ok(s.cd === CD - 4, `① cd 只按模拟步递减(期望 ${CD - 4},实际 ${s.cd})`);
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
];

/** 反例 patch 用的原函数 */
const original = Skills.modifyShot;
type Modify = typeof Skills.modifyShot;

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

const failsOf = (run: (ck: Checker) => void): number => {
  const ck = makeChecker({ printPass: false });
  run(ck);
  return ck.fails;
};

const selftest = process.argv.includes("--selftest");

if (selftest) {
  console.log("反例自检:两份改坏的真实写法必须被上面的判据拦住(拦不住 = 这套尺子没牙齿)");
  const find = (n: string): Section => {
    const s = SECTIONS.find((x) => x.name.startsWith(n));
    if (!s) throw new Error(`smash-check selftest:找不到段落 ${n}`);
    return s;
  };
  // 每份反例点名它"必须"弄红哪些段 —— 点名而不是"总数>0",免得靠无关断言蒙对
  //   legacy    :预告偷吃 → ①(纯度) ②(兑现) ⑥(同族) ⑧(端到端) 全得叫
  //   noOverride:质量改写读不到 → ③ 得叫。⑧ 不指望它:端到端那局是按准的一拍,
  //             物理档与技能档数值相同,那一段本来区分不了这两件事(③ 用晚按 9 帧的
  //             场景专门把它区分开)。
  const plan: Array<{ tag: string; patch: Modify; secs: string[] }> = [
    { tag: "legacy", patch: legacy, secs: ["①", "②", "⑥", "⑧"] },
    { tag: "noOverride", patch: noOverride, secs: ["③"] },
  ];
  let bad = 0;
  try {
    for (const { tag, patch, secs } of plan) {
      Skills.modifyShot = patch;
      console.log(`\n反例 ${tag}:`);
      for (const n of secs) {
        const sec = find(n);
        const fails = failsOf(sec.run);
        if (fails === 0) { bad++; console.log(`  ✗ ${n} 全绿 —— 这条判据拦不住「${tag}」`); }
        else console.log(`  ✓ ${n} 被拦住(${fails} 条报警)`);
      }
    }
  } finally {
    Skills.modifyShot = original;
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
console.log("（③ 起手字改挂头顶是观感改动,靠 tools/panel-preview / 真机肉眼验收,不在这里断言）");
process.exit(ck.fails ? 1 : 0);
