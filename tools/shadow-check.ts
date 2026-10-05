// ============================================================
// 影分身(shadow)回归 —— 2026-10-04 新增,2026-10-05 按"会累积的影子防线"重做判据。
//
// 用户口径(2026-10-04 原款):「释放可以召唤出一个影分身,可以跟 AI 一样帮我接球,接完三个球
// 之后就消失,玩家自己仍可以击球,如果是玩家自己接球,就不消耗次数,一分之内只能释放一次。」
// 用户口径(2026-10-05 本次):「上一局的影分身，它可以保留到下一局 而不是会直接消失,场上最多
// 可以有三个影分身。不同影分身上的颜色是不一样的,默认的是紫色嘛,有新的第二个可以是其他的颜色。」
// 追问定死四条:① 边界 = 跨**回合(一分)**,不跨对局、不落盘 ② 接满 3 球仍消散,但带着未用满
// 额度活到下一回合的**补满回 3**(正在消散的那个不复活)③ 同场最多三个 = slots 表长度
// ④ 本体保持纯黑剪影,三色只加在辉光 / pips / 头圈 / 拍框 / 粒子。
//
// 架构:分身是挂在宿主身上的独立 Player(p.shadowClones[i].entity,恒按 slot 升序),
// **刻意不进 RulesState.players** —— 发球轮转(mates[serveIdx % length])、计分名单、
// game-root 的 R.players[0]=真人假设都不许被凭空多出的球员污染。rules 只挂两个钩子:
// step 里 Shadow.updateClones 驱动(AI.think 出输入 → Pl.update 全套机器,防区分工见 dutyIndex);
// 实名球员 tryHit 全落空时 Shadow.tryCloneHit 补位(玩家永远优先),命中 Shadow.noteHit(host, slot)
// 计数 —— 玩家自己接球不经过它,天然不消耗次数。
//
// 这套机制的坏法全都不会崩、不会报错、tsc 也不报,只会安静地不对:
//   ① 同分可连召       → 每分限召一次成空话(闸 = p.shadowCast,resetPoint 才重开)
//   ② 接球不计数 / 记错人 → maxHits 成空话;多实例之后 noteHit 不带 slot = 恒记 0 号账
//                          (紫的接球、青的掉额度,三组亮片全对不上)
//   ③ 玩家接球也计数   → 玩家打得越时分身散得越快
//   ④ 分身进名单       → 发球轮转 / 计分 / 真人假设全被污染
//   ⑤ 分身抢拍         → 实名球员够得着的球被影子截走
//   ⑥ 成影期偷球       → 18 帧召唤演出成了无敌帧
//   ⑦ 体积碰撞推挤     → 旧 separateClone 贴身强行推开 46px,移动互相挡路
//   ⑧ 没有上限         → 键面亮着、按下去无脑再生一个,场上挤成一团
//   ⑨ 每分仍清场       → **正是被本次口径推翻的旧行为**,留着就是这条改动的正面证据
//   ⑩ 不补满 / 把用满的复活 → 前者违背"跨回合恢复额度",后者等于把"接三球就消散"偷偷改掉
//   ⑪ 三色塌成一色     → 用户要的就是颜色分得开;共用同一个 theme 对象也是一色的一种坏法
//   ⑫ 用数组长度当槽位 → 死一个之后集体变色(身份漂了),玩家读不出"哪个是哪个"
//   ⑬ 三个全追同一颗球 → 叠成一坨看不出三色,9 份额度砸在同一块地面、另外两块照样丢
//   ⑭ 训练场/教学也代打 → drill 的 matches() 只认 lastHitter 的**队**,分身回球被判成玩家练成了
//   ⑮ 给 AI 开这一款   → 白送永不失误的回球,而 serve-check/ai-check 的替身从不按技能键 ⇒ 量不到
//
// 用法:node .tools-build/tools/shadow-check.js [--selftest]
//   --selftest 喂 13 份反例,必须各自被点名拦下(拦不住 = 这套尺子没牙齿)。
//   两处坏法长在**调用位**上(patch 不到):playerCounted 与 slotByLength —— 照 smash-check
//   doubleDecrement 的做法用状态构造,证明判据算术对坏账敏感而不是恒真。
// ============================================================
import { Rules } from "../assets/scripts/core/rules";
import { Player as Pl } from "../assets/scripts/core/player";
import { Skills } from "../assets/scripts/core/skills";
import { Shadow } from "../assets/scripts/core/shadow";
import { ShadowGate } from "../assets/scripts/core/shadow-gate";
import { AI } from "../assets/scripts/core/ai";
import { CFG } from "../assets/scripts/core/config";
import { Ball, Player as PlayerEntity, PlayerInput, ShadowCloneState, ShotResult } from "../assets/scripts/core/types";
import { makeChecker, Checker } from "./harness";

const C = CFG;
const CO = C.court, SH = C.skills.shadow, BT = C.skills.blockText;

/** 在场分身(含正在消散的)。读点一律走这里,别在判据里各写一遍 ?? [] */
const clones = (p: PlayerEntity): ShadowCloneState[] => ShadowGate.clonesOf(p);
const at = (p: PlayerEntity, slot: number): ShadowCloneState | undefined =>
  clones(p).find((sc) => sc.slot === slot);
const slotSeq = (p: PlayerEntity): string => clones(p).map((sc) => sc.slot).join(",");

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
 * newMatch("1p") 同时把影分身的模式门控报成"允许"(判据 ⑭ 的对照组靠这里)。
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
 * (0.0.28 那轮的第 3 球翻车现场:分身收招吃掉低平球的最后十几帧)。
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

/**
 * 让球"不属于任何人":lastHitter 记在我方 ⇒ 左队分身全部判定为非来球,各自走回防区。
 * 站位/穿透/防区这类判据要先 settle 一下,否则量到的是上一段留下的跑位惯性。
 */
function parkBall(ball: Ball): void {
  ball.lastHitter = "left"; ball.live = true; ball.held = false;
  ball.vx = 0; ball.vy = 0; ball.shot = null;
}

/** 三枚之间最近的一对间距(静态散开的读数:三色要分得开,先得站得开) */
function restGap(arr: ShadowCloneState[]): number {
  let m = Infinity;
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) m = Math.min(m, Math.abs(arr[i].entity.x - arr[j].entity.x));
  }
  return m;
}

/**
 * 把三枚请回各自防区,并且**每帧把球钉回原位** —— 不钉的话这颗悬着的球会在 settle 期间
 * 被重力拖落地、真打完这一分(POINT → beginPoint),量到的就是另一段回合的站位。
 * 返回是否站到位(每枚与 homeX 偏差 < 8px)。
 */
function settleToHomes(arr: ShadowCloneState[], ball: Ball, maxFrames = 300): boolean {
  const settled = (): boolean => arr.every((sc) => Math.abs(sc.entity.x - sc.entity.homeX) < 8);
  for (let f = 0; f < maxFrames; f++) {
    parkBall(ball);
    ball.x = CO.netX + 250; ball.px = ball.x;
    ball.y = CO.groundY - 260; ball.py = ball.y;
    Rules.R.state = "RALLY"; Rules.R.timer = 0; Rules.R.serveWait = 0;
    stepIdle();
    if (settled()) return true;
  }
  return settled();
}

/**
 * 把球摆回"能按技能键"的干净对局态。上面有些段落会真把分丢掉(那正是要测的),
 * 之后球在飞回手里/被发球方握着,canActivate 会因 ball.flying 拒召 —— 那是真实规则,
 * 不是 bug,所以断言"下一分还能再召"之前必须先把球摆正。
 */
function toRally(ball: Ball): void {
  Rules.R.state = "RALLY"; Rules.R.timer = 0; Rules.R.serveWait = 0;
  ball.x = CO.netX + 250; ball.y = CO.groundY - 260;
  ball.px = ball.x; ball.py = ball.y; ball.vx = 0; ball.vy = 0;
  ball.live = true; ball.held = false; ball.owner = null;
  ball.flying = false; ball.flyT = 0; ball.shot = null; ball.magnetPull = null;
  ball.lastHitter = "right"; ball.crossed = true; ball.netted = false;
  Rules.R.events.length = 0;
}

/** 召唤一枚并走完成影演出(之后分身才被 AI 机器驱动),返回这一枚 */
function summon(hero: PlayerEntity): ShadowCloneState {
  const ball = Rules.R.ball as Ball;   // 宿主一定属于当前这场,取 R.ball 就是它那颗
  toRally(ball);   // 每"一分"的开球基线:球不在飞回手里、不在手上,canActivate 才只看真闸
  stepCast(hero);
  const sc = clones(hero).find((x) => x.spawnT === SH.spawnFrames - 1);
  if (!sc) throw new Error("summon: 召唤没落地(先看 ①/⑧/⑭)");
  for (let f = 0; f < SH.spawnFrames + 2; f++) stepIdle();
  return sc;
}

/** 攒满编制:每"一分"召一枚(resetPoint 是真实的每分入口,顺手也把 shadowCast 闸重开) */
function summonFull(hero: PlayerEntity): ShadowCloneState[] {
  const out: ShadowCloneState[] = [];
  for (let i = 0; i < SH.slots.length; i++) {
    Skills.resetPoint(hero);
    out.push(summon(hero));
  }
  return out;
}

// ---------- ① 每分限召一次:三道闸 + 文案四态 ----------
function s1(ck: Checker): void {
  const { hero, ball } = match();
  ck.ok(Skills.canActivate(hero, ball), "① 召唤前:每分第一次按,键必须亮");
  ck.ok(Skills.skillBlockReason(hero, ball) === null, "① 召唤前:没有门槛文案");
  stepCast(hero);
  ck.ok(clones(hero).length === 1, `① 按下技能键:分身实体落地(实际在场 ${clones(hero).length})`);
  ck.ok(hero.shadowCast === true, "① shadowCast 记账(每分限召的闸)");
  ck.ok(!Skills.canActivate(hero, ball), "① 本分已召:再按必须拒绝");
  const s = hero.skill as NonNullable<PlayerEntity["skill"]>;
  s.cd = 0;   // 摘掉名义冷却的干扰(activate 按下即付 60 帧),看真正拦人的闸
  ck.ok(!Skills.canActivate(hero, ball), "① 冷却走完也拒:拦人的是每分一次的 flag,不是冷却");
  // 只有一枚、没满编 ⇒ 此刻拦人的是"本分召过",不是"分身在场"
  ck.ok(Skills.skillBlockReason(hero, ball) === BT.shadowUsed,
    `① 本分召过读「${BT.shadowUsed}」(实际 ${Skills.skillBlockReason(hero, ball)})`);
  ck.ok(!Skills.activate(hero, ball), "① activate 自闸:已召过再直接调也必须失败(不靠调用方自觉)");
  // 下一分
  Skills.resetPoint(hero);
  ck.ok(hero.shadowCast === false, "① resetPoint:每分一次的闸重开");
  ck.ok(Skills.canActivate(hero, ball), "① 下一分第一按:键亮");
}

// ---------- ② 端到端三连击 + 多实例记账定位 ----------
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
      ck.ok(sc.despawnT === 0 && clones(hero).includes(sc), "② 未满额:分身还在场,不提前消散");
    }
  }
  ck.ok(sc.despawnT === SH.despawnFrames, `② 满 ${SH.maxHits} 球:消散演出开启(${sc.despawnT}/${SH.despawnFrames})`);

  // 第 4 球:消散期不许接(演出不是续命),分身最终从数组摘掉,球落地真丢分
  const z4 = Pl.strikeZone(clone, 2.2);
  feedBall(ball, z4.x + 70, z4.y, -2.2, 70);
  let hit4: Hit | null = null;
  let goneAt = -1;
  for (let f = 0; f < 170; f++) {
    stepIdle();
    hit4 = findHit();
    if (goneAt < 0 && !clones(hero).includes(sc)) goneAt = f;
    if (Rules.R.state !== "RALLY") break;
  }
  ck.ok(!hit4, "② 第 4 球:消散期/消散后没人代接(分身不是永动机)");
  ck.ok(goneAt >= 0, "② 消散演出走完,那一枚从 shadowClones 里摘掉(不是挂在宿主身上的僵尸)");
  ck.ok(Rules.R.state === "POINT", "② 第 4 球落地:分身不在就要真丢分(机制的真实代价)");
  ck.ok(!Skills.canActivate(hero, Rules.R.ball as Ball), "② 端到端:本分已召过,同分不许再召");
  Skills.resetPoint(hero);
  ck.ok(Skills.canActivate(hero, Rules.R.ball as Ball), "② resetPoint 后下一分恢复可召");

  // ---- 多实例记账定位(另起一局,免得上面那次丢分把状态带脏) ----
  // noteHit 丢了 slot 定位就是恒记数组第一枚:0 号凭空掉额度、真接球的那枚永生。
  // 所以这一颗球必须**由非 0 号接**,并且 0 号明确够不着 —— 否则补位循环按槽位顺序
  // 先派 0 号打上,坏账与好账的读数一样,判据就成了哑的。
  const m2 = match();
  const arr2 = summonFull(m2.hero);
  const hitter = arr2[2];                          // 2 号(网前那枚)来接
  const parked = [arr2[0].entity, arr2[1].entity];
  for (const p of parked) { p.x = CO.netX - 390; p.px = p.x; p.vx = 0; p.swingT = -1; }
  hitter.entity.x = hitter.entity.homeX; hitter.entity.px = hitter.entity.x; hitter.entity.vx = 0;
  const z5 = Pl.strikeZone(hitter.entity, 2.2);
  feedBall(m2.ball, z5.x + 70, z5.y, -2.2, 70);
  let hit5: Hit | null = null;
  for (let f = 0; f < 150 && !hit5; f++) {
    stepIdle();
    hit5 = findHit();
    if (Rules.R.state !== "RALLY") break;
  }
  ck.ok(!!hit5, "② 前置:网前那颗球被接下来了");
  ck.ok(hitter.hits === 1, `② 核心:接球那枚计数(2 号实际 ${hitter.hits})`);
  ck.ok(arr2[0].hits === 0 && arr2[1].hits === 0,
    `② 核心:没接球的两枚纹丝不动(0 号 ${arr2[0].hits} / 1 号 ${arr2[1].hits})—— noteHit 不带 slot 就坏在这里`);
}

// ---------- ③/⑤ 共用场景:hero 喂球当帧起拍,抢在分身前面把球接走 ----------
function playerTakesIt(): { hero: PlayerEntity; sc: ShadowCloneState; hit: Hit | null } {
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
  ck.ok(sc.despawnT === 0 && clones(hero).includes(sc), "③ 分身不因玩家的拍而消散");
}

// ---------- ④ 分身不进名单(三个也不进) ----------
function s4(ck: Checker): void {
  const { hero } = match();
  const arr = summonFull(hero);
  const R = Rules.R;
  ck.ok(clones(hero).length === SH.slots.length, `④ 前置:编制攒满(${clones(hero).length}/${SH.slots.length})`);
  ck.ok(R.players.length === 2, `④ 名单仍 2 人(实际 ${R.players.length})`);
  ck.ok(arr.every((sc) => !R.players.includes(sc.entity)), "④ 三个分身实体都不在名单");
  ck.ok(arr.every((sc) => sc.entity.idx === -1), "④ 每分身 idx=-1");
  ck.ok(R.players[0] === hero && R.players[0].idx === 0, "④ R.players[0] 恒真人");
  ck.ok(R.players.every((p) => p.idx >= 0), "④ 名单里没有负 idx 的幽灵(渲染的剪影判据就靠这条守卫)");
  // 计分口径不受凭空多出的球员影响:名单长度是 mates[serveIdx % length] 的模数
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
  ck.ok(clones(hero).includes(sc), "⑤ 分身仍在场(兜底职能不变)");
}

// ---------- ⑥ 成影期不接球:演出不是无敌帧 ----------
function s6(ck: Checker): void {
  const { hero, ball } = match();
  stepCast(hero);
  const sc = clones(hero)[0];
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

// ---------- ⑦ 零体积碰撞与自由穿透:分身之间/与宿主都不互推 ----------
function s7(ck: Checker): void {
  const { hero, ball } = match();
  const arr = summonFull(hero);
  ck.ok(arr.length === SH.slots.length, "⑦ 前置:编制攒满(三个都得参与穿透检查)");
  parkBall(ball);
  // 把三枚与宿主全部堆在同一点:真实游戏里 separate() 推不到它们(不在名单),
  // 而旧版 separateClone 会在重叠时强行弹开 46px。一帧之内位移必须只有走位量级。
  for (const sc of arr) { sc.entity.x = hero.x; sc.entity.px = hero.x; sc.entity.vx = 0; }
  hero.vx = 0;
  Shadow.updateClones(Rules.R.players, ball, "RALLY");
  for (const sc of arr) {
    const d = Math.abs(sc.entity.x - hero.x);
    ck.ok(d < 20, `⑦ 零体积碰撞:${sc.slot} 号与宿主重叠一帧后只走了 ${d.toFixed(1)}px(旧版会弹开 >=46px)`);
  }
  // 任意两枚之间也一样:堆在一起不许互推
  const base = 200;
  for (const sc of arr) { sc.entity.x = base; sc.entity.px = base; sc.entity.vx = 0; }
  Shadow.updateClones(Rules.R.players, ball, "RALLY");
  for (const sc of arr) {
    const d = Math.abs(sc.entity.x - base);
    ck.ok(d < 20, `⑦ 自由穿透:三枚同点堆叠一帧后 ${sc.slot} 号只挪了 ${d.toFixed(1)}px`);
  }
}

// ---------- ⑧ 上限由槽位决定:满编拒召,且拒绝要说得出理由、不付代价 ----------
function s8(ck: Checker): void {
  const { hero, ball } = match();
  const arr = summonFull(hero);
  ck.ok(slotSeq(hero) === "0,1,2", `⑧ 三分攒满,槽位恒按升序(实际 ${slotSeq(hero)})`);
  ck.ok(Rules.R.players.length === 2, "⑧ 满编时名单仍是 2 人");
  ck.ok(!Skills.canActivate(hero, ball), `⑧ 满编:键必须灭(在场 ${clones(hero).length})`);
  // 满编时最后那一召刚付了 60 帧名义冷却,而 skillBlockReason 在冷却中返回 null(键面正在倒计时,
  // 那是另一种、更该先看见的理由)—— 把 cd 摘掉才能量到"满编"这条门槛文案本身
  (hero.skill as NonNullable<PlayerEntity["skill"]>).cd = 0;
  ck.ok(Skills.skillBlockReason(hero, ball) === BT.shadowFull,
    `⑧ 满编读「${BT.shadowFull}」(实际 ${Skills.skillBlockReason(hero, ball)})`);
  // activate 直接调也必须失败,而且**不许付代价**:付了冷却、立了 flag 却没东西落地 = 白罚
  const s = hero.skill as NonNullable<PlayerEntity["skill"]>;
  const cdBefore = s.cd;
  hero.shadowCast = false;
  ck.ok(!Skills.activate(hero, ball), "⑧ 满编时 activate 自闸:直接调也返回 false");
  ck.ok(hero.shadowCast === false, "⑧ 满编被拒时不立 shadowCast(不靠调用方自觉,门槛在 canActivate 里)");
  ck.ok(s.cd === cdBefore, `⑧ 满编被拒时不付冷却(实际 ${s.cd})`);
  stepCast(hero);
  ck.ok(clones(hero).length === SH.slots.length, "⑧ 硬按也不生出第四个");
  // 空位释放后必须能再召:第四格不该由"这一分召过"以外的东西挡着
  ck.ok(ShadowGate.freeSlotOf(hero) === -1, "⑧ 满编时确实没有空位");
  arr[1].despawnT = 1;                       // 让 1 号当场散去(下一帧被摘掉)
  for (let f = 0; f < 3; f++) stepIdle();
  ck.ok(ShadowGate.freeSlotOf(hero) === 1, `⑧ 摘掉 1 号后空位回到 1(实际 ${ShadowGate.freeSlotOf(hero)})`);
}

// ---------- ⑨ 跨回合保留(端到端:走真实的一分结束 + beginPoint) ----------
function s9(ck: Checker): void {
  const { hero, ball } = match();
  const sc = summon(hero);
  // 先让分身接一拍(带额度地跨分才有意义)
  const z = Pl.strikeZone(sc.entity, 2.2);
  feedBall(ball, z.x + 70, z.y, -2.2, 70);
  let hit: Hit | null = null;
  for (let f = 0; f < 150 && !hit; f++) {
    stepIdle();
    hit = findHit();
    if (Rules.R.state !== "RALLY") break;
  }
  ck.ok(!!hit && sc.hits === 1, `⑨ 前置:分身接了一球(计数 ${sc.hits})`);
  // 让它这一分就此结束:那一拍飞向对方半场,cpu 恒站桩 ⇒ 落地得分 → POINT → beginPoint
  for (let f = 0; f < 400 && Rules.R.state !== "SERVE"; f++) stepIdle();
  ck.ok(Rules.R.state === "SERVE", `⑨ 端到端走到下一分开球(实际 state=${Rules.R.state})`);
  ck.ok(clones(hero).includes(sc), "⑨ 核心:上一回合的分身**还在**(旧写法在这里被每分清场)")
    ;
  ck.ok(clones(hero).length === 1, `⑨ 在场的还是那一个(实际 ${clones(hero).length})`);
  ck.ok(sc.entity === clones(hero)[0].entity, "⑨ 是同一个实体对象,不是重新造一个顶上去");
  ck.ok(Rules.R.players[0] === hero, "⑨ 宿主没被换掉(跨局保留是另一回事,别在这里做)");
  // 下一分还能再召一个(摆正球:SERVE 期间球在飞回发球方手里,canActivate 因 flying 拒召 —— 那是真实规则)
  toRally(Rules.R.ball as Ball);
  ck.ok(Skills.canActivate(hero, Rules.R.ball as Ball), "⑨ 下一分还能再召一个(累积的正路)");
}

// ---------- ⑩ 补满三态:未耗尽回满 / 用满的绝不复活 ----------
function s10(ck: Checker): void {
  const { hero } = match();
  const arr = summonFull(hero);
  const [c0, c1, c2] = arr;
  c0.hits = 1; c1.hits = 2;
  c2.hits = SH.maxHits; c2.despawnT = SH.despawnFrames;   // 接满三球、正在消散的那一枚
  Skills.resetPoint(hero);
  ck.ok(c0.hits === 0 && c1.hits === 0, `⑩ 未用满的补满回 ${SH.maxHits}(实际 ${c0.hits}/${c1.hits})`);
  ck.ok(c0.refillT === SH.refillFlashFrames, `⑩ 补满开了亮片读数(实际 ${c0.refillT})`);
  ck.ok(c2.hits === SH.maxHits && c2.despawnT === SH.despawnFrames,
    `⑩ 用满正在消散的**不复活**(hits=${c2.hits} despawnT=${c2.despawnT})`);
  for (let f = 0; f < SH.despawnFrames + 4; f++) stepIdle();
  ck.ok(!clones(hero).includes(c2), "⑩ 那一枚照常消散(补满分支不许给它续命)");
  ck.ok(clones(hero).length === 2, `⑩ 剩下两个仍在场(实际 ${clones(hero).length})`);

  // 对照组:refillHits 关掉必须看得见"不补满" —— 否则这条判据量的是死支
  const keep = SH.refillHits;
  SH.refillHits = false;
  const c3 = clones(hero)[0];
  c3.hits = 2;
  Skills.resetPoint(hero);
  ck.ok(c3.hits === 2, `⑩ 对照:refillHits=false 时额度不许被补满(实际 ${c3.hits})`);
  SH.refillHits = keep;
}

// ---------- ⑪ 三色互不相同(量实体,不是读配置) ----------
function s11(ck: Checker): void {
  const { hero } = match();
  const arr = summonFull(hero);
  const cols = arr.map((sc) => (sc.entity.theme && sc.entity.theme.glow) || "");
  ck.ok(arr.length === 3, "⑪ 前置:三枚在场");
  ck.ok(cols.every((c) => c !== ""), "⑪ 每枚都带身份色(theme.glow 非空)");
  ck.ok(cols[0] !== cols[1] && cols[1] !== cols[2] && cols[0] !== cols[2],
    `⑪ 三色两两不等(实际 ${cols.join(" / ")})`);
  ck.ok(!cols.some((c) => c === "#000000"), "⑪ 身份色不是纯黑(纯黑 = 旧写法把 glow 抹掉了)")
    ;
  ck.ok(cols.every((c) => c !== hero.theme?.glow), "⑪ 分身色与宿主球衣色不同色,不会读成同一个人");
  ck.ok(arr.every((sc, i) => sc.slot === i), `⑪ 数组恒按 slot 升序(实际 ${slotSeq(hero)})`);
  ck.ok(arr.length === 3 && new Set(arr.map((sc) => sc.entity)).size === 3, "⑪ 三枚是三个不同实体");
  ck.ok(arr.every((sc) => sc.entity !== hero), "⑪ 没有一枚是宿主本人");
  ck.ok(!!arr[0].entity.theme && arr[0].entity.theme !== arr[1].entity.theme,
    "⑪ 三份 theme 是三个对象(共用一个时改一个等于改三个)");
  // 配置自洽(标注清楚:这条不是行为)
  ck.ok(SH.slots.length === 3, `⑪ 自洽:slots 就是场上上限(${SH.slots.length})`);
  ck.ok(new Set(SH.slots.map((s) => s.tint)).size === SH.slots.length, "⑪ 自洽:槽位表里没有重复色");
  ck.ok(SH.slots.every((s) => s.homeOffset < 0 && s.homeOffset > -CO.netX),
    "⑪ 自洽:homeOffset 都在本方半场内(左队为负、不越过网带)");
  ck.ok(SH.slots.every((s) => !!C.diffs[s.diff]), "⑪ 自洽:槽位表里的 AI 档都是 diffs 的真键");
}

// ---------- ⑫ 槽位释放与颜色稳定:死一个不许集体变色 ----------
function s12(ck: Checker): void {
  const { hero } = match();
  const arr = summonFull(hero);
  const cyan = arr[1].entity.theme!.glow, gold = arr[2].entity.theme!.glow;
  // 0 号接满三球消散
  arr[0].hits = SH.maxHits;
  arr[0].despawnT = SH.despawnFrames;
  for (let f = 0; f < SH.despawnFrames + 4; f++) stepIdle();
  ck.ok(clones(hero).length === 2, `⑫ 0 号已摘掉(在场 ${clones(hero).length})`);
  ck.ok(at(hero, 1)!.entity.theme!.glow === cyan, "⑫ 1 号颜色不漂(它仍是冰青)");
  ck.ok(at(hero, 2)!.entity.theme!.glow === gold, "⑫ 2 号颜色不漂(它仍是赤金)");
  // 下一分再召:填回最低空位 0 ⇒ 又是紫
  Skills.resetPoint(hero);
  const neo = summon(hero);
  ck.ok(neo.slot === 0, `⑫ 新召的填回 0 号空位(实际 ${neo.slot})`);
  ck.ok(neo.entity.theme!.glow === SH.slots[0].tint, "⑫ 0 号就是默认紫(用户口径「默认的是紫色」)");
  ck.ok(slotSeq(hero) === "0,1,2", `⑫ 补位后序列复原(实际 ${slotSeq(hero)})`);
  // 全灭之后重召还是从 0 号开始
  for (const sc of clones(hero)) { sc.hits = SH.maxHits; sc.despawnT = 1; }
  for (let f = 0; f < 6; f++) stepIdle();
  Skills.resetPoint(hero);
  const again = summon(hero);
  ck.ok(clones(hero).length === 1 && again.slot === 0, "⑫ 三个全灭后重召回到 0 号");
}

// ---------- ⑬ 防区分工:每来球只有一枚去追,其余守位 ----------
function s13(ck: Checker): void {
  const { hero, ball } = match();
  const arr = summonFull(hero);
  const home = arr.map((sc) => sc.entity.homeX);
  ck.ok(home[0] < home[1] && home[1] < home[2], `⑬ 前置:三块防区由后场到网前铺开(${home.map(Math.round).join(" / ")})`);
  ck.ok(settleToHomes(arr, ball), "⑬ 前置:三枚都站回了自己的防区(量位移前必须先站稳)");

  // 判据单元:dutyIndex 挑的是"防区离落点最近"的那一枚。
  // 边界 = 相邻 homeX 的中点(所以"离谁最近"与"切三段"是同一件事,少抄一份阈值),等距取低槽位。
  const fake = (landX: number): Ball => {
    ball.shot = { landX } as unknown as ShotResult;
    ball.x = landX;
    return ball;
  };
  ck.ok(Shadow.dutyIndex(hero, fake(home[0] - 40), arr) === 0, "⑬ 单元:落点在 0 号带 ⇒ 0 号当值");
  ck.ok(Shadow.dutyIndex(hero, fake(home[1] + 20), arr) === 1, "⑬ 单元:落点在 1 号带 ⇒ 1 号当值");
  ck.ok(Shadow.dutyIndex(hero, fake(home[2] + 60), arr) === 2, "⑬ 单元:落点在 2 号带 ⇒ 2 号当值");
  ck.ok(Shadow.dutyIndex(hero, fake((home[0] + home[1]) / 2), arr) === 0, "⑬ 单元:正好压边界取低槽位(确定、可重复)");

  // 端到端:来球落进 0 号带 ⇒ 只有 0 号离开防区,其余两枚守位。
  // 弹道必须与假 landX **说同一个落点**:feedBall 的口径是 x=起点、dist=回程水平距离,y 取地面
  // 时 landX = x - dist。两者打架的话,当值那枚按 AI 的拦截点跑、守位的按自己的岗站着,量出来的
  // "谁动了"是弹道选择的问题而不是分工(第一版栽过两次:settle 帧数不够就把基准点取在半成品站位上;
  // 以及起点摆在网口,喂球当帧就被原地打中,窗口只剩两帧)。
  const chase = (frames: number, start: number, landTo: number, vx: number): number[] => {
    // 返回三枚各自"离开自己防区的最远距离"(取窗口内最大值,不取末态:被打回之后 AI 会让
    // 所有人回位,拿末态量的话冲出去过的也读成没动)
    // **先各归其位再喂球**:settle 的容差是 8px,拿"上一帧在哪"当基准的话,守位那枚补最后
    // 几像素也会被算成"动了";摆到 homeX 上,"离位多少"量的才是分工。
    for (const sc of arr) {
      sc.entity.x = sc.entity.homeX; sc.entity.px = sc.entity.x;
      sc.entity.vx = 0; sc.entity.swingT = -1;
    }
    feedBall(ball, start, CO.groundY, vx, start - landTo);
    ball.shot = { landX: landTo } as unknown as ShotResult;
    const maxOff = arr.map(() => 0);
    for (let f = 0; f < frames; f++) {
      stepIdle();
      for (let i = 0; i < arr.length; i++) {
        maxOff[i] = Math.max(maxOff[i], Math.abs(arr[i].entity.x - home[i]));
      }
      if (findHit() || Rules.R.state !== "RALLY") break;
    }
    return maxOff;
  };
  ck.ok(restGap(arr) > 30, `⑬ 静态散开:三枚最近的一对也隔了 ${restGap(arr).toFixed(0)}px(玩家看到的主要是这一格,够远才分得出三色)`);
  const start = CO.netX + 160, landTo = home[0] - 40;
  const off = chase(60, start, landTo, -2.5);
  ck.ok(off[0] > 12, `⑬ 当值那枚离位出门接球(0 号最多离开防区 ${off[0].toFixed(0)}px)`);
  ck.ok(off[1] < 12 && off[2] < 12,
    `⑬ 其余两枚守位不动(1 号最多 ${off[1].toFixed(0)}px / 2 号 ${off[2].toFixed(0)}px)`);

  // 对照组:dutyByZone 关掉 ⇒ 三枚全交给 AI 追同一个拦截点(否则上面两条量的是死支)。
  // 实测关掉分工是 190/105/25 —— 三股往同一点挤,那才是"叠成一坨"的证据。
  // **不要**拿"窗口内最小间距"当判据:分身之间零体积碰撞(判据 ⑦),当值那枚跑过队友位置是
  // 穿透而不是堆叠,静态散开归上面 restGap 那条管。
  const keep = SH.dutyByZone;
  SH.dutyByZone = false;
  settleToHomes(arr, ball);
  const off2 = chase(60, start, landTo, -2.5);
  const runners = off2.filter((d) => d > 12).length;
  ck.ok(runners >= 2, `⑬ 对照:dutyByZone=false 时至少两枚一起离位去冲(实际 ${runners} 枚:${off2.map((d) => d.toFixed(0)).join("/")})`);
  SH.dutyByZone = keep;
}

// ---------- ⑭ 模式门控:训练场/教学/本地对战不许召 ----------
function s14(ck: Checker): void {
  // 为什么这一条必须存在:drill.ts 的 matches()/diagnoseFail() 判的是 lastHitter/scorer 的**队**
  // (`e.lastHitter !== "left"`),不看是谁打的。影分身是宿主同侧的 isAI 实体,它那一拍在事件里
  // 就算 left 打的 ⇒ 训练关会被分身判成"玩家练成了"。旧写法被每分清场挡着,跨分保留后洞就开了。
  for (const mode of ["drill", "tutorial", "2p", "2v2"]) {
    Rules.newMatch(mode, "normal");
    const hero = Rules.R.players[0];
    const ball = Rules.R.ball as Ball;
    hero.skill = Skills.initSkillState("shadow");
    Skills.resetPoint(hero);
    // 把球摆正:开赛后球在飞回发球方手里,canActivate 会因为 ball.flying 先拒 —— 那样这四条
    // 断言量的是球况而不是门控,反例 drillAllows(把门控摘掉)照样全绿(第一版就漏在这里)。
    toRally(ball);
    ck.ok(!ShadowGate.on, `⑭ ${mode}:门控报"不合格"`);
    ck.ok(!Skills.canActivate(hero, ball), `⑭ ${mode}:键必须灭(不许"亮着按下去没反应")`);
    ck.ok(Skills.skillBlockReason(hero, ball) === BT.shadowNoMode,
      `⑭ ${mode}:键面要说清为什么(实际 ${Skills.skillBlockReason(hero, ball)})`);
    ck.ok(!Skills.activate(hero, ball), `⑭ ${mode}:activate 自闸,直接调也失败`);
    stepCast(hero);
    ck.ok(clones(hero).length === 0, `⑭ ${mode}:硬按也不落地(实际 ${clones(hero).length})`);
  }
  // 对照组:"1p" 必须能召出来 —— 不然上面四组量的都是死支
  const { hero } = match();
  stepCast(hero);
  ck.ok(clones(hero).length === 1, "⑭ 对照:1p 能召出来(上面那四组才有牙齿)");
  ck.ok(ShadowGate.on && ShadowGate.mode === "1p", `⑭ 门控读数跟着 R.mode 走(实际 ${ShadowGate.mode})`);
}

// ---------- ⑮ AI 拿不到这一款红利(钉现状) ----------
function s15(ck: Checker): void {
  // 诚实标注:这是一条**守卫**,不是行为断言 —— ai.ts 的技能决策链里没有 shadow 分支
  // (与 rage 那条同一性质:那段代码到得了吗?到不了)。仓库里也 patch 不出"AI 会召分身"的
  // 反例,所以它没有配套 selftest。留着是因为将来有人给 AI 加这条分支时,这里会当场红,
  // 提醒他:serve-check / ai-check 的真人替身从不按技能键,那两把尺子量不到这个增强。
  const { cpu, ball } = match();
  cpu.skill = Skills.initSkillState("shadow");
  cpu.aiDiff = "normal";
  let sawSkillPress = false;
  for (let f = 0; f < 120; f++) {
    // 给 cpu 一颗飞向它半场的球(lastHitter 记 left ⇒ 对右队是来球)
    ball.x = CO.netX + 40 + f * 2; ball.y = CO.groundY - 120;
    ball.px = ball.x; ball.py = ball.y; ball.vx = 2; ball.vy = 0;
    ball.live = true; ball.held = false; ball.owner = null; ball.flying = false;
    ball.lastHitter = "left"; ball.crossed = true; ball.netted = false; ball.shot = null;
    Rules.R.state = "RALLY";
    const inp = AI.think(cpu, ball, Rules.R.state);
    if (inp.skillPressed) sawSkillPress = true;
    Rules.R.events.length = 0;
    Rules.step([idleInput(), inp]);
    if (ShadowGate.clonesOf(cpu).length > 0) break;
  }
  ck.ok(!sawSkillPress, "⑮ AI 技能决策链里没有 shadow 分支:装了也永不按");
  ck.ok(clones(cpu).length === 0, `⑮ CPU 装 shadow 召不出分身(实际 ${clones(cpu).length})`);
}

interface Section { name: string; run: (ck: Checker) => void }
const SECTIONS: Section[] = [
  { name: "① 每分限召一次:三道闸 + 文案四态,activate 自闸", run: s1 },
  { name: "② 端到端三连击:归因/落点/计数/满额消散 + 多实例记账定位", run: s2 },
  { name: "③ 玩家自己接球:不消耗次数、分身不散", run: s3 },
  { name: "④ 分身不进名单:三个也不进,长度/idx/真人假设/计分口径全不被污染", run: s4 },
  { name: "⑤ 玩家优先:够得着的球实名先打,分身只兜没人接的", run: s5 },
  { name: "⑥ 成影期不接球:18 帧演出不是无敌帧", run: s6 },
  { name: "⑦ 零体积碰撞与穿透:分身之间/与宿主都不互推", run: s7 },
  { name: "⑧ 上限由槽位决定:满编拒召且说得出理由、不付代价", run: s8 },
  { name: "⑨ 跨回合保留:走真实的一分结束 + beginPoint,分身还在", run: s9 },
  { name: "⑩ 补满三态:未耗尽回满 / 用满正在消散的绝不复活 + 对照组", run: s10 },
  { name: "⑪ 三色互不相同(量实体)+ 数组按 slot 升序 + 配置自洽", run: s11 },
  { name: "⑫ 槽位释放与颜色稳定:死一个不许集体变色", run: s12 },
  { name: "⑬ 防区分工:每来球只一枚去追 + 最小间距 + 对照组", run: s13 },
  { name: "⑭ 模式门控:训练场/教学/本地对战不许召 + 1p 对照组", run: s14 },
  { name: "⑮ AI 拿不到红利(守卫:钉住 ai.ts 没有 shadow 分支这件事)", run: s15 },
];

// ---------- selftest 反例 ----------
type Update = typeof Shadow.updateClones;
type Activate = typeof Skills.activate;
type ResetPoint = typeof Skills.resetPoint;
type NoteHit = typeof Shadow.noteHit;
type DutyIndex = typeof Shadow.dutyIndex;
type CanSummon = typeof ShadowGate.canSummon;
type SlotTint = typeof ShadowGate.slotTint;
type CanActivate = typeof Skills.canActivate;

const originalUpdate = Shadow.updateClones;
const originalActivate = Skills.activate;
const originalCanActivate = Skills.canActivate;
const originalResetPoint = Skills.resetPoint;
const originalNoteHit = Shadow.noteHit;
const originalDutyIndex = Shadow.dutyIndex;
const originalCanSummon = ShadowGate.canSummon;
const originalSlotTint = ShadowGate.slotTint;

/** 反例 A:分身塞进 R.players(架构红线)—— 名单/发球轮转/真人假设全被污染 */
const cloneInPlayers: Update = (players, ball, state) => {
  for (const host of players) {
    for (const sc of clones(host)) {
      if (!players.includes(sc.entity)) players.push(sc.entity);
    }
  }
  originalUpdate(players, ball, state);
};

/** 反例 B:activate 不记账 shadowCast(同分可连召) */
const noCastFlag: Activate = (p, ball, dir) => {
  const r = originalActivate(p, ball, dir);
  if (r && p.skill && p.skill.id === "shadow") p.shadowCast = false;
  return r;
};

/** 反例 C:旧版 separateClone(贴身时强行推开 >=46px)—— 破坏自由穿透与幻影特性 */
const repulsingUpdate: Update = (players, ball, state) => {
  originalUpdate(players, ball, state);
  for (const host of players) {
    for (const sc of clones(host)) {
      const c = sc.entity;
      for (const q of players) {
        if (q.side !== c.side) continue;
        const dx = c.x - q.x;
        const dist = Math.abs(dx);
        if (dist < 46 && dist > 0.001) c.x += (dx > 0 ? 1 : -1) * (46 - dist);
        else if (dist <= 0.001) c.x += 46;
      }
    }
  }
};

/** 反例 D(本次口径的核心):**每分仍把分身清场** —— 旧行为,正是 2026-10-05 要推翻的那条 */
const clearsOnPoint: ResetPoint = (p) => {
  originalResetPoint(p);
  p.shadowClones = undefined;
};

/** 反例 E:跨分保留但不补满额度(resetPoint 完全不动 hits) */
const noRefill: ResetPoint = (p) => {
  const snap = clones(p).map((sc) => sc.hits);
  originalResetPoint(p);
  const now = clones(p);
  for (let i = 0; i < snap.length && i < now.length; i++) now[i].hits = snap[i];
};

/** 反例 F:补满不看"已用满/正在消散" —— 接满三球那一枚被复活,用户那条"接三球消散"被改掉 */
const resurrectsDying: ResetPoint = (p) => {
  originalResetPoint(p);
  for (const sc of clones(p)) { sc.hits = 0; sc.despawnT = 0; }
};

/** 反例 G:满编判据短路(canActivate 说还能召) */
const noCap: CanSummon = () => true;

/** 反例 H:三色塌成一色(spawn 把身份色写死成槽位 0 的色) */
const sameColor: SlotTint = () => SH.slots[0].tint;

/** 反例 I:防区分工短路 ⇒ 三个全追同一颗球(叠成一坨) */
const stackingClones: DutyIndex = () => -1;

/** 反例 J:noteHit 丢了 slot 定位,恒记数组第一枚 */
const noteHitWrongClone: NoteHit = (host, slot) => {
  const arr = clones(host);
  const keep = arr[0];
  originalNoteHit(host, keep ? keep.slot : slot);
};

/** 反例 K:门控短路 —— canActivate 里不看模式,训练场/教学照样能召 */
const drillAllows: CanActivate = (p, ball) => {
  if (p.skill && p.skill.id === "shadow") {
    // 坏写法:把 ShadowGate.on 那一项摘掉,其余照旧
    return !p.shadowCast && clones(p).length < SH.slots.length && !!ball && !ball.flying;
  }
  return originalCanActivate(p, ball);
};

/**
 * 跑一段判据、只数报警条数。**反例把分身塞进 R.players 时会当场崩**(rules.step 按
 * `inputs[p.idx]` 取输入,而分身 idx=-1 ⇒ undefined 传进 Pl.update)—— 那不是判据没牙齿,
 * 恰恰是那条架构红线的真实后果:分身进名单就是把整条主循环打瘫。所以这里把异常也算"拦住",
 * 并把崩在哪一句打出来,免得将来有人看见崩就以为是自己改坏了。
 */
const failsOf = (run: (ck: Checker) => void, label?: string): number => {
  const ck = makeChecker({ printPass: false });
  try {
    run(ck);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.log(`  · ${label ?? "反例"} 让链路当场崩了(也算拦住):${why}`);
    return ck.fails > 0 ? ck.fails : 1;
  }
  return ck.fails;
};

const selftest = process.argv.includes("--selftest");

if (selftest) {
  console.log("反例自检:13 份改坏的真实写法必须被点名拦下(拦不住 = 这套尺子没牙齿)");
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
  const restore = (): void => {
    Shadow.updateClones = originalUpdate;
    Skills.activate = originalActivate;
    Skills.canActivate = originalCanActivate;
    Skills.resetPoint = originalResetPoint;
    Shadow.noteHit = originalNoteHit;
    Shadow.dutyIndex = originalDutyIndex;
    ShadowGate.canSummon = originalCanSummon;
    ShadowGate.slotTint = originalSlotTint;
  };
  try {
    const cases: Array<[string, string, () => void]> = [
      ["④", "cloneInPlayers", () => { Shadow.updateClones = cloneInPlayers; }],
      ["①", "noCastFlag", () => { Skills.activate = noCastFlag; }],
      ["⑦", "repulsingUpdate", () => { Shadow.updateClones = repulsingUpdate; }],
      ["⑧", "noCap", () => { ShadowGate.canSummon = noCap; }],
      ["⑨", "clearsOnPoint", () => { Skills.resetPoint = clearsOnPoint; }],
      ["⑩", "noRefill", () => { Skills.resetPoint = noRefill; }],
      ["⑩", "resurrectsDying", () => { Skills.resetPoint = resurrectsDying; }],
      ["⑪", "sameColor", () => { ShadowGate.slotTint = sameColor; }],
      ["⑬", "stackingClones", () => { Shadow.dutyIndex = stackingClones; }],
      ["⑭", "drillAllows", () => { Skills.canActivate = drillAllows; }],
    ];
    for (const [sec, label, arm] of cases) {
      restore();
      console.log(`\n反例 ${label}(${sec}):`);
      arm();
      expectBlocked(sec, label, failsOf(find(sec).run, label));
    }
    restore();

    // 反例 ②(noteHit 丢定位)单独跑:它坏在计数上,② 的多实例段才看得见
    console.log("\n反例 noteHitWrongClone(计数恒记 0 号):");
    Shadow.noteHit = noteHitWrongClone;
    expectBlocked("②", "noteHitWrongClone", failsOf(find("②").run));
    Shadow.noteHit = originalNoteHit;
  } finally {
    restore();
  }

  // 反例:玩家接球也记账 —— 计数长在 rules 的调用位上(patch 不到),用状态构造证明判据对坏账敏感
  console.log("\n反例 playerCounted(玩家接球也记账):");
  {
    const { sc, hit } = playerTakesIt();
    if (!hit || hit.isAI !== false) { bad++; console.log("  ✗ 前置失败:hero 没接到球(先看 ③/⑤ 的 ✗)"); }
    else {
      sc.hits++;                                   // 坏实现记出的账
      const ck = makeChecker({ printPass: false });
      ck.ok(sc.hits === 0, "③ 玩家命中不消耗次数");
      expectBlocked("③", "playerCounted", ck.fails);
    }
  }

  // 反例:用数组长度当 slot —— 同样长在 spawn 的闭包里 patch 不到,用状态构造
  console.log("\n反例 slotByLength(用长度当槽位 ⇒ 死一个集体变色):");
  {
    const { hero } = match();
    const arr = summonFull(hero);
    const cyan = arr[1].entity.theme!.glow;
    arr[0].despawnT = 1;
    for (let f = 0; f < 3; f++) stepIdle();
    // 坏实现:新召的那一枚 slot = 当时的长度 = 2 ⇒ 与仍在场的 2 号重号、并按 2 号上色
    Skills.resetPoint(hero);
    const neo = summon(hero);
    neo.slot = clones(hero).length;                // 坏账:2
    neo.entity.theme!.glow = SH.slots[2].tint;
    const ck = makeChecker({ printPass: false });
    ck.ok(slotSeq(hero) === "0,1,2", `⑫ 序列 ${slotSeq(hero)}`);
    ck.ok(at(hero, 1)!.entity.theme!.glow === cyan, "⑫ 1 号颜色不漂");
    expectBlocked("⑫", "slotByLength", ck.fails);
  }

  console.log(bad ? "\n✗ shadow-check selftest 失败" : "\n✓ shadow-check selftest:13 份反例全被拦住");
  process.exit(bad ? 1 : 0);
}

const ck = makeChecker();
for (const sec of SECTIONS) {
  console.log(`\n${sec.name}`);
  sec.run(ck);
}
console.log(`\n${ck.fails === 0 ? "✓" : "✗"} shadow-check:${ck.checks} 条断言,${ck.fails} 条失败`);
console.log("（成影闪烁/消散上飘/三色观感是视觉判据,在 tools/shadow-preview.ts 出图肉眼验收,不在这里断言）");
process.exit(ck.fails ? 1 : 0);
