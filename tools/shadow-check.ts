// ============================================================
// 影分身(shadow)回归 —— 2026-10-04 新增。
//
// 用户口径(2026-10-04):「释放可以召唤出一个影分身,可以跟 AI 一样帮我接球,
// 接完三个球之后就消失,玩家自己仍可以击球,如果是玩家自己接球,就不消耗次数,
// 一分之内只能释放一次。」("一分" = 计分的一个回合,不是一分钟。)
//
// 架构:分身是挂在宿主身上的独立 Player(p.shadowClone.entity),**刻意不进
// RulesState.players** —— 发球轮转(mates[serveIdx % length])、计分名单、
// game-root 的 R.players[0]=真人假设都不许被第三名球员污染。rules 只挂两个钩子:
// step 里 Shadow.updateClones 驱动(AI.think 出输入 → Pl.update 全套机器);
// 实名球员 tryHit 全落空时 Shadow.tryCloneHit 补位(玩家永远优先),命中
// Shadow.noteHit 计数 —— 玩家自己接球不经过它,天然不消耗次数。
//
// 这套机制的坏法全都不会崩、不会报错,只会安静地不对:
//   ① 同分可连召     → 分身散了再按又能召,「每分限召一次」成空话
//                       (闸 = p.shadowCast,resetPoint 才重开;activate 自查 canActivate)
//   ② 接球不计数     → 分身永生 / 一球就散,maxHits=3 成空话
//   ③ 玩家接球也计数 → 玩家打得越时分身散得越快,「自己出手不耗次数」成空话
//   ④ 分身进名单     → 发球轮转 / 计分 / 真人假设全被第三名球员污染
//   ⑤ 分身抢拍       → 实名球员够得着的球被影子截走,「我按了它又打一下」
//   ⑥ 成影期偷球     → 18 帧召唤演出成了无敌帧,来球凭空被影子接走
//   ⑦ 归因按位反查   → 旧 R.players[hitterIdx]?.isAI 对 idx=-1 反查得 undefined
//                       被误判成真人:分身的球触发人类侧赞美/震动(hit.isAI 字段,② 逐拍验)
//   ⑧ 体积碰撞推挤   → 旧 separateClone 在贴身时强行推开 46px,移动互相挡路
//
// 本工具钉死:
//   ① 每分限召一次:在场拦 / 已召拦 / resetPoint 重开;activate 自闸,不靠调用方自觉;
//     文案两态(在场=「分身在场」、散后=「本回合已召唤」)
//   ② 端到端三连击:逐球归因 isAI=true、过网落对方场内、hits 递增、满额开消散;
//     消散期起的第 4 球一律沉默、shadowClone 最终清空、球落地真丢分
//   ③ 玩家自己接球:hit 归真人、分身计数一动不动、分身不散
//   ④ 分身不在名单:长度不变、idx=-1、名单里没有负 idx 的幽灵
//   ⑤ 玩家优先:同一颗球实名球员先打(走完美帧替身),分身只兜没人接的那一拍
//   ⑥ 成影期不接球:白给到判定区心的球 18 帧内没人接;tryCloneHit 单元级也拒
//   ⑦ 零体积碰撞与自由穿透:贴身/重叠时不发生排斥推开位移,移动互不影响
//
// 用法:node .tools-build/tools/shadow-check.js [--selftest]
//   --selftest 喂反例:cloneInPlayers(分身塞进 R.players)/ noCastFlag(activate 不记账
//   shadowCast = 同分可连召)/ playerCounted(玩家接球也记账)/ repulsingUpdate(强行弹开推挤),
//   必须全被点名拦下。
//   计数的坏实现长在 rules 的调用位上(内部直调,patch 不到),playerCounted 照
//   smash-check doubleDecrement 的做法用状态构造证明判据算术对坏账敏感。
// ============================================================
import { Rules } from "../assets/scripts/core/rules";
import { Player as Pl } from "../assets/scripts/core/player";
import { Skills } from "../assets/scripts/core/skills";
import { Shadow } from "../assets/scripts/core/shadow";
import { CFG } from "../assets/scripts/core/config";
import { Ball, Player as PlayerEntity, PlayerInput } from "../assets/scripts/core/types";
import { makeChecker, Checker } from "./harness";

const C = CFG;
const CO = C.court, SH = C.skills.shadow;

const idleInput = (): PlayerInput => ({
  left: false, right: false, jumpPressed: false, jumpHeld: false,
  swingAim: null, lungePressed: false,
});

type Hit = Record<string, unknown>;
const findHit = (): Hit | null => {
  const e = Rules.R.events.find((x) => x.t === "hit");
  return e ? (e as unknown as Hit) : null;
};
const stepIdle = (): void => {
  Rules.R.events.length = 0;
  Rules.step(Rules.R.players.map(() => idleInput()));
};

/**
 * 建局:hero(左场后位,装影分身)+ cpu(右场,测试里没人喂它 AI 输入 → 恒站桩)。
 * 球悬在右半场高空(短场景内落不了地;各判据喂球时自行重摆)。
 */
function match(): { hero: PlayerEntity; cpu: PlayerEntity; ball: Ball } {
  Rules.newMatch("1p", "normal");
  const R = Rules.R;
  const hero = R.players[0];
  const cpu = R.players[1];
  hero.skill = Skills.initSkillState("shadow");
  Skills.resetPoint(hero);
  hero.x = CO.netX - 420; hero.y = CO.groundY;
  hero.vx = 0; hero.vy = 0; hero.onGround = true;
  hero.swingT = -1; hero.swingBest = null; hero.swingHit = false; hero.hitLock = 0;
  hero.stats.whiffs = 0; hero.stats.hits = 0;
  cpu.x = CO.netX + 320; cpu.y = CO.groundY;
  cpu.vx = 0; cpu.vy = 0;
  const ball = R.ball as Ball;
  ball.x = CO.netX + 250; ball.y = CO.groundY - 260;
  ball.px = ball.x; ball.py = ball.y;
  ball.vx = 0; ball.vy = 0;
  ball.live = true; ball.held = false; ball.owner = null;
  ball.flying = false; ball.flyT = 0;
  ball.lastHitter = "right"; ball.crossed = true; ball.netted = false;
  ball.shot = null; ball.magnetPull = null;
  R.state = "RALLY"; R.timer = 0; R.serveWait = 0; R.events.length = 0;
  return { hero, cpu, ball };
}

/** 端到端召唤:真人那一路喂 skillPressed,分身实体由 player.update 的技能成功分支落地 */
function stepCast(hero: PlayerEntity): void {
  Rules.R.events.length = 0;
  Rules.step(Rules.R.players.map((p) => (p === hero ? { ...idleInput(), skillPressed: true } : idleInput())));
}

/**
 * 摆成一颗朝 (x,y) 飞来的活球(来球口径:对方打出、已过网)。
 * dist = 水平飞行距离;vy 按 shuttle.gravity 给抛物线补偿 —— 球抵达 x 时恰好回到 y。
 * 不补偿的话 70px/2.2 速度要飞 32 帧,重力 0.46 早坠过地面,AI 根本没有接球窗口
 * (第 3 球翻车现场:分身收招吃掉低平球的最后十几帧)。
 */
function feedBall(ball: Ball, x: number, y: number, vx: number, dist: number): void {
  const T = dist / Math.max(Math.abs(vx), 0.001);
  const vy = -(0.5 * C.shuttle.gravity * T);
  ball.x = x; ball.y = y; ball.px = x; ball.py = y;
  ball.vx = vx; ball.vy = vy;
  ball.live = true; ball.held = false; ball.owner = null;
  ball.flying = false; ball.flyT = 0;
  ball.lastHitter = "right"; ball.crossed = true; ball.netted = false;
  ball.shot = null; ball.magnetPull = null;
  Rules.R.state = "RALLY"; Rules.R.timer = 0; Rules.R.serveWait = 0;
}

/** 召唤 + 走完成影演出(之后分身才被 AI 机器驱动) */
function summon(hero: PlayerEntity): NonNullable<PlayerEntity["shadowClone"]> {
  stepCast(hero);
  const sc = hero.shadowClone;
  if (!sc) throw new Error("summon: 召唤没落地(先看 ①)");
  for (let f = 0; f < SH.spawnFrames + 2; f++) stepIdle();
  return sc;
}

// ---------- ① 每分限召一次:三道闸 + 两态文案 ----------
function s1(ck: Checker): void {
  const { hero, ball } = match();
  ck.ok(Skills.canActivate(hero, ball), "① 召唤前:每分第一次按,键必须亮");
  ck.ok(Skills.skillBlockReason(hero, ball) === null, "① 召唤前:没有门槛文案");
  stepCast(hero);
  ck.ok(!!hero.shadowClone, "① 按下技能键:分身实体落地(player.update 钩子)");
  ck.ok(hero.shadowCast === true, "① shadowCast 记账(每分限召的闸)");
  ck.ok(!Skills.canActivate(hero, ball), "① 分身在场:再按必须拒绝");
  const s = hero.skill as NonNullable<PlayerEntity["skill"]>;
  s.cd = 0;   // 摘掉名义冷却的干扰(activate 按下即付 60 帧),看真正拦人的闸
  ck.ok(!Skills.canActivate(hero, ball), "① 冷却走完也拒:拦人的是每分一次的 flag,不是冷却");
  const BT = C.skills.blockText;
  ck.ok(Skills.skillBlockReason(hero, ball) === BT.shadowActive, `① 在场读「${BT.shadowActive}」(实际 ${Skills.skillBlockReason(hero, ball)})`);
  ck.ok(!Skills.activate(hero, ball), "① activate 自闸:分身在场直接调也必须失败(不靠调用方自觉)");
  // 模拟消散(端到端版在 ② 里走真实流程)
  hero.shadowClone = undefined;
  ck.ok(!Skills.canActivate(hero, ball), "① 分身已散、本分召过:仍拒(不许同分连召)");
  ck.ok(Skills.skillBlockReason(hero, ball) === BT.shadowUsed, `① 消散后读「${BT.shadowUsed}」(实际 ${Skills.skillBlockReason(hero, ball)})`);
  // 下一分
  Skills.resetPoint(hero);
  ck.ok(hero.shadowCast === false, "① resetPoint:闸重开");
  ck.ok(hero.shadowClone === undefined, "① resetPoint:残影清空(跨分不留幽灵队友)");
  ck.ok(Skills.canActivate(hero, ball), "① 下一分第一按:键亮");
}

// ---------- ② 端到端三连击:归因 / 落点 / 计数 / 满额消散 / 第 4 球沉默 ----------
function s2(ck: Checker): void {
  const { hero, ball } = match();
  const sc = summon(hero);
  const clone = sc.entity;
  ck.ok(clone.isAI && clone.side === hero.side, "② 分身同侧、吃 AI 机器(isAI=true)");
  ck.ok(clone !== hero && clone.idx === -1, "② 分身是独立实体(idx=-1)");
  ck.ok(sc.spawnT === 0 && sc.hits === 0, "② 成影期走完、计数归零");

  for (let i = 1; i <= SH.maxHits; i++) {
    const z = Pl.strikeZone(clone, 2.2);
    feedBall(ball, z.x + 70, z.y, -2.2, 70);   // 朝分身判定区心飘来,飞行时间盖过分身收招
    let hit: Hit | null = null;
    for (let f = 0; f < 150 && !hit; f++) {
      stepIdle();
      hit = findHit();
      if (Rules.R.state !== "RALLY") break;
    }
    ck.ok(!!hit, `② 第 ${i} 球:分身起拍(150 帧内)`);
    if (hit) {
      ck.ok(hit.isAI === true, `② 第 ${i} 球归因 isAI=true(实际 ${hit.isAI})—— 旧按位反查会把分身当真人`);
      ck.ok(hit.side === hero.side, `② 第 ${i} 球是本侧打回的(实际 ${hit.side})`);
      ck.ok(!hit.intoNet, `② 第 ${i} 球不下网`);
      const landX = hit.landX as number;
      ck.ok(landX > CO.netX && landX <= CO.right, `② 第 ${i} 球落对方场内(landX=${Math.round(landX)})`);
    }
    ck.ok(sc.hits === i, `② 计数 ${i}/${SH.maxHits}(实际 ${sc.hits})`);
    if (i < SH.maxHits) {
      ck.ok(sc.despawnT === 0 && !!hero.shadowClone, "② 未满额:分身还在场,不提前消散");
    }
  }
  ck.ok(sc.despawnT === SH.despawnFrames, `② 满 ${SH.maxHits} 球:消散演出开启(${sc.despawnT}/${SH.despawnFrames})`);

  // 第 4 球:消散期不许接(演出不是续命),分身最终清空,球落地真丢分
  const z4 = Pl.strikeZone(clone, 2.2);
  feedBall(ball, z4.x + 70, z4.y, -2.2, 70);
  let hit4: Hit | null = null;
  let goneAt = -1;
  for (let f = 0; f < 170; f++) {
    stepIdle();
    hit4 = findHit();
    if (goneAt < 0 && !hero.shadowClone) goneAt = f;
    if (Rules.R.state !== "RALLY") break;
  }
  ck.ok(!hit4, "② 第 4 球:消散期/消散后没人代接(分身不是永动机)");
  ck.ok(goneAt >= 0, "② 消散演出走完,shadowClone 清空(不是挂在宿主身上的僵尸)");
  ck.ok(Rules.R.state === "POINT", "② 第 4 球落地:分身不在就要真丢分(机制的真实代价)");
  ck.ok(!Skills.canActivate(hero, Rules.R.ball as Ball), "② 端到端:分身已散、本分已召,同分不许再召");
  Skills.resetPoint(hero);
  ck.ok(Skills.canActivate(hero, Rules.R.ball as Ball), "② resetPoint 后下一分恢复可召");
}

// ---------- ③/⑤ 共用场景:hero 喂球当帧起拍,抢在分身前面把球接走 ----------
function playerTakesIt(): { hero: PlayerEntity; sc: NonNullable<PlayerEntity["shadowClone"]>; hit: Hit | null } {
  const { hero, ball } = match();
  const sc = summon(hero);
  // 球速先定(抛物线补偿),判定区再按**真实球速**算 —— strikeZone 的圆心/半径跟着
  // 来球速度走,传名义速度会把圆心摆偏。
  // 起拍必须抢在分身前面:分身的 entryLead 是「球将进判定区就起手」,喂球后 3 帧它就
  // 起拍、实测 f=20 命中;玩家替身若按完美帧等点起拍要 f=13 才动手、f=22 才轮到,
  // 被抢先就是必然。所以喂球当帧立即起拍 —— 完美帧(f=9)时球已在判定区内
  // (距圆心 ~48px < 半径 ~81px),f=9 命中,先于分身。
  const vx = 4;
  const dist = 80;
  const vy = -(0.5 * C.shuttle.gravity * (dist / vx));
  const spd = Math.hypot(vx, vy);
  const z = Pl.strikeZone(hero, spd);
  feedBall(ball, z.x + dist, z.y, -vx, dist);
  let hit: Hit | null = null;
  for (let f = 0; f < 90 && !hit; f++) {
    Rules.R.events.length = 0;
    const inp = idleInput();
    if (f === 0) inp.swingAim = "mid";   // 玩家先动拍,分身只兜没人接的
    Rules.step(Rules.R.players.map((p) => (p === hero ? inp : idleInput())));
    hit = findHit();
    if (Rules.R.state !== "RALLY") break;
  }
  return { hero, sc, hit };
}

// ---------- ③ 玩家自己接球:不消耗次数 ----------
function s3(ck: Checker): void {
  const { hero, sc, hit } = playerTakesIt();
  ck.ok(!!hit, "③ 前置:玩家替身这一拍打出去了");
  if (!hit) return;
  ck.ok(hit.isAI === false, `③ hit 归真人(isAI=${hit.isAI})`);
  ck.ok(hit.side === hero.side, `③ 是本侧打出的(实际 ${hit.side})`);
  ck.ok(hero.stats.hits === 1, `③ 玩家命中记账(实际 ${hero.stats.hits})`);
  ck.ok(sc.hits === 0, `③ 核心:玩家接球不消耗次数(分身计数实际 ${sc.hits})`);
  ck.ok(!!hero.shadowClone && hero.shadowClone.despawnT === 0, "③ 分身不因玩家的拍而消散");
}

// ---------- ④ 分身不进名单 ----------
function s4(ck: Checker): void {
  const { hero } = match();
  stepCast(hero);
  const R = Rules.R;
  const sc = hero.shadowClone;
  ck.ok(!!sc, "④ 前置:分身在(这条红了先看 ①)");
  if (!sc) return;
  ck.ok(R.players.length === 2, `④ 名单仍 2 人(实际 ${R.players.length})`);
  ck.ok(!R.players.includes(sc.entity), "④ 分身实体不在名单");
  ck.ok(sc.entity.idx === -1, `④ 分身 idx=-1(实际 ${sc.entity.idx})`);
  ck.ok(R.players[0] === hero && R.players[0].idx === 0, "④ R.players[0] 恒真人");
  ck.ok(R.players.every((p) => p.idx >= 0), "④ 名单里没有负 idx 的幽灵");
  // 计分口径不受第三名球员影响:名单长度是 mates[serveIdx % length] 的模数
  ck.ok(R.scores.length === 2 && R.scores[0] === 0 && R.scores[1] === 0, "④ 计分表仍双方两格");
}

// ---------- ⑤ 玩家优先:够得着的球实名球员先打 ----------
function s5(ck: Checker): void {
  const { hero, sc, hit } = playerTakesIt();
  ck.ok(!!hit, "⑤ 前置:这一拍打出去了");
  if (!hit) return;
  ck.ok(hit.isAI === false, `⑤ 实名球员先打:hit 归真人(isAI=${hit.isAI})`);
  ck.ok(hit.idx === hero.idx, `⑤ 打球的是 hero(idx=${hit.idx})`);
  ck.ok(sc.hits === 0, `⑤ 分身没截这一拍(计数实际 ${sc.hits})`);
  ck.ok(!!hero.shadowClone, "⑤ 分身仍在场(兜底职能不变)");
}

// ---------- ⑥ 成影期不接球:演出不是无敌帧 ----------
function s6(ck: Checker): void {
  const { hero, ball } = match();
  stepCast(hero);
  const sc = hero.shadowClone;
  ck.ok(!!sc, "⑥ 前置:召唤落地(这条红了先看 ①)");
  if (!sc) return;
  const clone = sc.entity;
  const z = Pl.strikeZone(clone, 2);   // 白给:球直接钉在分身判定区心,不用跑位
  feedBall(ball, z.x, z.y, 0, 0);
  // 单元级:补位判据在成影期内必须自己拒(召唤当帧 updateClones 已把 spawnT 递减一次,
  // 所以这里的读数是 spawnFrames-1,断言只要求"还在成影期")
  ck.ok(sc.spawnT > 0 && sc.spawnT === SH.spawnFrames - 1,
    `⑥ 召唤当帧:成影计时在跑(实际 ${sc.spawnT},配置 ${SH.spawnFrames},同帧已驱动一次)`);
  ck.ok(Shadow.tryCloneHit(Rules.R.players, ball) === null, "⑥ 补位判据自己也要拒:spawnT>0 时 tryCloneHit 返回 null");
  let early: Hit | null = null;
  for (let f = 0; f < SH.spawnFrames - 1; f++) {   // 成影期剩余的帧(spawnT 从 N-1 递减到 0)
    stepIdle();
    early = findHit();
    if (early) break;
  }
  ck.ok(!early, `⑥ 成影期 ${SH.spawnFrames} 帧白给球没人接(实际 ${early ? "有人接了" : "没人接"})`);
  ck.ok(sc.hits === 0, "⑥ 成影期没有计数进来");
}

// ---------- ⑦ 零体积碰撞与自由穿透:分身不被宿主推开,移动互不影响 ----------
function s7(ck: Checker): void {
  const { hero } = match();
  stepCast(hero);
  const sc = hero.shadowClone;
  ck.ok(!!sc, "⑦ 前置:召唤落地");
  if (!sc) return;
  const clone = sc.entity;

  // 将分身直接摆在与宿主完全重合的位置 (x = hero.x, y = hero.y)
  clone.x = hero.x;
  clone.px = hero.x;
  clone.vx = 0;
  hero.vx = 0;
  // 静止 1 帧更新分身
  Shadow.updateClones(Rules.R.players, Rules.R.ball as Ball, "RALLY");

  // 旧版 separateClone 会在重叠或距离 < 46 时强行推开 min = 46 像素
  const dist = Math.abs(clone.x - hero.x);
  ck.ok(dist < 10, `⑦ 零体积碰撞:宿主与分身重叠时不受推开阻挡 (dx=${dist.toFixed(1)} < 10px,旧版会弹开 >=46px)`);

  // 验证两者贴身时分身自由穿透不被强行弹开
  hero.x = 200;
  clone.x = 210; // 贴身 10px (< 46px)
  Shadow.updateClones(Rules.R.players, Rules.R.ball as Ball, "RALLY");
  ck.ok(Math.abs(clone.x - 210) < 5, "⑦ 自由穿透:贴身贴位时分身不被强行弹开");
}

interface Section { name: string; run: (ck: Checker) => void }
const SECTIONS: Section[] = [
  { name: "① 每分限召一次:在场拦/已召拦/resetPoint 重开,activate 自闸", run: s1 },
  { name: "② 端到端三连击:归因 isAI、落对方场内、计数、满额消散、第 4 球沉默", run: s2 },
  { name: "③ 玩家自己接球:不消耗次数、分身不散", run: s3 },
  { name: "④ 分身不进名单:长度/idx/真人假设/计分口径全部不被污染", run: s4 },
  { name: "⑤ 玩家优先:够得着的球实名先打,分身只兜没人接的", run: s5 },
  { name: "⑥ 成影期不接球:18 帧演出不是无敌帧", run: s6 },
  { name: "⑦ 零体积碰撞与穿透:宿主与分身自由穿透移动,零推开排斥", run: s7 },
];

// ---------- selftest 反例 ----------
const originalUpdate = Shadow.updateClones;
const originalActivate = Skills.activate;
type Update = typeof Shadow.updateClones;
type Activate = typeof Skills.activate;

/** 反例 A:分身塞进 R.players(架构红线)—— 名单/发球轮转/真人假设全被污染 */
const cloneInPlayers: Update = (players, ball, state) => {
  const host = players.find((p) => p.shadowClone);
  if (host && host.shadowClone && !players.includes(host.shadowClone.entity)) {
    players.push(host.shadowClone.entity);
  }
  originalUpdate(players, ball, state);
};

/** 反例 B:activate 不记账 shadowCast(同分可连召)—— 分身散了就能再召 */
const noCastFlag: Activate = (p, ball, dir) => {
  const r = originalActivate(p, ball, dir);
  if (r && p.skill && p.skill.id === "shadow") p.shadowCast = false;
  return r;
};

/** 反例 C:旧版 separateClone(贴身时强行推开 >=46px)—— 破坏自由穿透与幻影特性 */
const repulsingUpdate: Update = (players, ball, state) => {
  originalUpdate(players, ball, state);
  for (const host of players) {
    if (!host.shadowClone) continue;
    const c = host.shadowClone.entity;
    for (const q of players) {
      if (q.side !== c.side) continue;
      const dx = c.x - q.x;
      const dist = Math.abs(dx);
      if (dist < 46 && dist > 0.001) {
        c.x += (dx > 0 ? 1 : -1) * (46 - dist);
      } else if (dist <= 0.001) {
        c.x += 46;
      }
    }
  }
};

const failsOf = (run: (ck: Checker) => void): number => {
  const ck = makeChecker({ printPass: false });
  run(ck);
  return ck.fails;
};

const selftest = process.argv.includes("--selftest");

if (selftest) {
  console.log("反例自检:三份改坏的真实写法必须被点名拦下(拦不住 = 这套尺子没牙齿)");
  const find = (n: string): Section => {
    const s = SECTIONS.find((x) => x.name.startsWith(n));
    if (!s) throw new Error(`shadow-check selftest:找不到段落 ${n}`);
    return s;
  };
  let bad = 0;
  const expectBlocked = (sec: string, label: string, fails: number): void => {
    if (fails === 0) { bad++; console.log(`  ✗ ${sec} 全绿 —— 这条判据拦不住「${label}」`); }
    else console.log(`  ✓ ${sec} 被拦住(${fails} 条报警)`);
  };
  try {
    console.log("\n反例 cloneInPlayers(分身塞进 R.players):");
    Shadow.updateClones = cloneInPlayers;
    expectBlocked("④", "cloneInPlayers", failsOf(find("④").run));
    Shadow.updateClones = originalUpdate;

    console.log("\n反例 noCastFlag(activate 不记账 shadowCast = 同分可连召):");
    Skills.activate = noCastFlag;
    expectBlocked("①", "noCastFlag", failsOf(find("①").run));
    Skills.activate = originalActivate;

    console.log("\n反例 repulsingUpdate(旧版 separateClone 贴身强行弹开):");
    Shadow.updateClones = repulsingUpdate;
    expectBlocked("⑦", "repulsingUpdate", failsOf(find("⑦").run));
    Shadow.updateClones = originalUpdate;
  } finally {
    Shadow.updateClones = originalUpdate;
    Skills.activate = originalActivate;
  }

  console.log("\n反例 playerCounted(玩家接球也记账):");
  {
    // 计数的坏实现长在 rules 的调用位上(内部直调,patch 不到),照 smash-check
    // doubleDecrement 的做法用状态构造:hero 真的接到球之后,若 sc.hits 被记成 1
    // (= 坏实现记出来的账),③ 的断言必须当场报警 —— 证明判据算术不是恒真。
    const { sc, hit } = playerTakesIt();
    if (!hit || hit.isAI !== false) { bad++; console.log("  ✗ 前置失败:hero 没接到球(先看 ③/⑤ 的 ✗)"); }
    else {
      sc.hits++;                                   // 坏实现记出的账
      const ck = makeChecker({ printPass: false });
      ck.ok(sc.hits === 0, "③ 玩家命中不消耗次数");
      expectBlocked("③", "playerCounted", ck.fails);
    }
  }

  console.log(bad ? "\n✗ shadow-check selftest 失败" : "\n✓ shadow-check selftest:反例全被拦住");
  process.exit(bad ? 1 : 0);
}

const ck = makeChecker();
for (const sec of SECTIONS) {
  console.log(`\n${sec.name}`);
  sec.run(ck);
}
console.log(`\n${ck.fails === 0 ? "✓" : "✗"} shadow-check:${ck.checks} 条断言,${ck.fails} 条失败`);
console.log("（成影闪烁/消散上飘/头顶 pips 是观感,靠 tools 端 preview 与真机肉眼验收,不在这里断言)");
process.exit(ck.fails ? 1 : 0);
