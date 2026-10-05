// ============================================================
// 引力吸球(magnet · 空间掌控)回归 —— 2026-10-05。
//
// 对应用户需求:「吸球技能优化一下，挥拍的时候也要可以使用技能」。
//
// 从前这款的门槛写的是 `p.swingT < 0`。代价不是"晚一拍才响",而是**一整段时间听不见**:
// 一次挥拍 windup+active+recover = 22 帧,挥空再 +4 帧硬直,收招瞬间 p.swingBuf 还能无缝续拍
// —— 连着打球的真人有相当长一段时间吸球键是灰的、按下去一个字都不说。而被它锁住的那段,
// 恰恰是这款技能要救的现场(这一拍挥早了/挥空了,把球捞回来再抽一次)。
// 现在:挥拍中按下 = 技能**接管**这一拍(skills.ts 的 activate),被打断那拍的账本清零,
// 引力到位那一拍由 rules 强制兑现(rules.ts 的 magnetPull 收尾)。
//
// 五种坏法全都不会崩、不会报错,只会安静地不好用,所以逐格判据必须常驻:
//   ① 挥拍闸还在(真人) → 键长期置灰。判据:挥拍六个相位逐格按下都必须起牵引
//   ② 接管不清账本     → 回击之后挥拍窗还没关,tryHit 凭上一拍的旧账本再 settle 一次;
//                        以及发球后第一次吸球摆出发球托球姿势(serveSwing 是粘性标记)。
//                        判据:activate 之后六个字段逐条核
//   ③ 拒了还扣冷却     → "按了没反应"还要白付 6 秒(AGENTS.md:按下没兑现的不许收代价)。
//                        判据:四条门槛外 activate 一律不写 cd
//   ④ 偷偷也给 AI 开   → CPU 白拿一次"挥空也能捞回来",而它的强度归 diffs.* 那根旋钮管;
//                        serve-check / ai-check / sim-check 的真人替身从不按技能键 ⇒ 量不到。
//                        判据:AI 侧那道闸与旧行为逐字相同
//   ⑤ 键面静默         → 门槛未满足时必须说得出原因(牵引中/球没过来),而真人挥拍中已不再是原因。
// 另钉两条既有机制在本款上的落点:⑥ 整段只兑现一次回击、不记挥空、空中释放照旧转跳杀;
//   ⑦ 球种预告 preview 不偷吃 magnetPulling(AGENTS.md 技能铁律①)。
//
// 用法:node .tools-build/tools/magnet-check.js [--selftest]
// ============================================================
import { Rules } from "../assets/scripts/core/rules";
import { Player as Pl } from "../assets/scripts/core/player";
import { Skills } from "../assets/scripts/core/skills";
import { CFG } from "../assets/scripts/core/config";
import {
  Ball, GameEvent, PlayerInput, Player as PlayerEntity, SwingBestShot, TeamSide,
} from "../assets/scripts/core/types";
import { makeChecker } from "./harness";

const C = CFG;
const CO = C.court, SW = C.swing, MG = C.skills.magnet;

/** 满跳离地高度(jumpV²/2g ≈ 92):空中释放那一格把人摆到跳点,9 帧牵引走完时仍悬空 */
const APEX = 92;

const emptyInput = (): PlayerInput => ({
  left: false, right: false, jumpPressed: false, jumpHeld: false,
  swingAim: null, lungePressed: false,
});

interface SetupOpt {
  /** 挥拍相位:-1 = 静立,>=0 = 正在挥拍的第几帧(① 的逐格用这个压) */
  phase?: number;
  /** 这一拍已经打出去了(swingHit + hitLock):"刚打完就想吸回来"那一格 */
  alreadyHit?: boolean;
  /** >0 = 把人摆到离地这么多像素(⑥ 空中释放) */
  lift?: number;
  /** ④:同一格换成 CPU 拿吸球,门槛必须与旧行为逐字相同 */
  ai?: boolean;
  /** 球的状态覆盖:⑤ 的"球没过来"三态 */
  ballState?: "live" | "dead" | "held" | "flying";
  /** 球已经在牵引中(⑤ 的"牵引中再按") */
  alreadyPulling?: boolean;
}

/**
 * 摆一个「对方打过来的球正朝 hero 这半场飞」的对局帧。
 * 走真实 Rules.newMatch,再把球位/球态/挥拍相位压成要测的那一格 —— 与 lunge-check 同一套摆法,
 * 好处是帧序与真机一致(Pl.update → Skills 起手 → rules 的 magnetPull 收尾),
 * 量的是真实相位而不是我以为的相位。
 */
function setup(o: SetupOpt = {}): { hero: PlayerEntity; ball: Ball; side: TeamSide } {
  Rules.newMatch("1p", "normal");
  const R = Rules.R;
  const hero = R.players[0];
  const side: TeamSide = "left";
  hero.isAI = !!o.ai;
  hero.skill = Skills.initSkillState("magnet");
  Skills.resetPoint(hero);

  hero.x = CO.netX - 175;
  hero.y = CO.groundY - (o.lift ?? 0);
  hero.vx = 0; hero.vy = 0;
  hero.onGround = (o.lift ?? 0) <= 0;
  hero.stats.whiffs = 0; hero.stats.hits = 0; hero.stats.smashes = 0; hero.stats.skillCasts = 0;

  const ball = R.ball as Ball;
  ball.x = CO.netX - 90; ball.y = CO.groundY - 120;
  ball.px = ball.x; ball.py = ball.y;
  ball.vx = -3; ball.vy = 1;
  ball.live = true; ball.held = false; ball.owner = null;
  ball.flying = false; ball.flyT = 0;
  ball.magnetPull = o.alreadyPulling ? {
    targetX: hero.x + 34, targetY: CO.groundY - 60, player: hero,
    total: MG.pullFrames, t: MG.pullFrames, fromX: ball.x, fromY: ball.y,
  } : null;
  ball.lastHitter = "right"; ball.crossed = true; ball.netted = false; ball.shot = null;
  if (o.ballState === "dead") { ball.live = false; }
  if (o.ballState === "held") { ball.held = true; ball.owner = R.players[1]; }
  if (o.ballState === "flying") { ball.flying = true; ball.flyT = 10; ball.owner = R.players[1]; }

  // 挥拍相位:直接压字段(startSwing 是 player.ts 私有),要测的就是"这一拍正在进行"这件事
  hero.swingT = o.phase ?? -1;
  hero.swingHit = !!o.alreadyHit;
  hero.hitLock = o.alreadyHit ? SW.doubleHitLock : 0;
  hero.swingBuf = 0;
  hero.swingStyle = "under";
  hero.swingAim = "mid";
  hero.swingLoft = 0;
  hero.swingQ = 0;
  hero.swingBest = null;
  hero.serveSwing = false;
  hero.swingAuto = false;

  R.state = "RALLY";
  R.timer = 0; R.serveWait = 0;
  R.events.length = 0;
  return { hero, ball, side };
}

/** 按下吸球之后整段跑到"回击出球"的读数 */
interface Chain {
  /** 牵引是否真的起来了(起不来就是"按了没反应") */
  pulled: boolean;
  /** 回击出球那一帧(-1 = 整段没出球) */
  hitAt: number;
  /** 整段里 hit 事件一共来了几次(>1 = 一次施放吃掉多拍) */
  hits: number;
  kind: string | null;
  skillKind: string | null;
  /** 出球后球的水平方向(左队 +1 = 往对面走) */
  vxAfter: number;
  lastHitter: TeamSide | null;
  whiffs: number;
  smashes: number;
  cdAfterPress: number;
  /** 按下当帧的挥拍相位(接管 = 从头再起,不是接着被打断那拍往下走) */
  swingTAfterPress: number;
  magnetPullingAfterHit: boolean;
}

const NO_CHAIN: Chain = {
  pulled: false, hitAt: -1, hits: 0, kind: null, skillKind: null, vxAfter: 0,
  lastHitter: null, whiffs: 0, smashes: 0, cdAfterPress: 0,
  swingTAfterPress: -1, magnetPullingAfterHit: false,
};

/** 第 pressAt 帧按下吸球,跑 maxFrames 帧,把回击那一段的账读回来 */
function runChain(o: SetupOpt, pressAt = 0, maxFrames = 34): Chain {
  const { hero, ball } = setup(o);
  const R = Rules.R;
  const acc: Chain = { ...NO_CHAIN };
  for (let f = 0; f < maxFrames; f++) {
    R.events.length = 0;
    const inp: PlayerInput = { ...emptyInput(), ...(f === pressAt ? { skillPressed: true } : {}) };
    Rules.step([inp, emptyInput()]);
    if (f === pressAt) {
      acc.pulled = !!ball.magnetPull;
      acc.cdAfterPress = hero.skill?.cd ?? -1;
      // 本帧 Pl.update 里 activate 置 swingT=0,随后那条挥拍机器 +1 ⇒ 接管读作"从头再起"
      acc.swingTAfterPress = hero.swingT;
    }
    const e = R.events.find((ev: GameEvent) => ev.t === "hit");
    if (e) {
      acc.hits++;
      if (acc.hitAt < 0) {
        acc.hitAt = f;
        acc.kind = (e.kind as string) ?? null;
        acc.skillKind = (e.skillKind as string) ?? null;
      }
    }
    if (acc.hitAt >= 0) {
      acc.vxAfter = ball.vx;
      acc.lastHitter = ball.lastHitter;
      acc.magnetPullingAfterHit = !!hero.skill?.magnetPulling;
      acc.whiffs = hero.stats.whiffs;
      acc.smashes = hero.stats.smashes;
      // 出球之后再多跑 4 帧,专门抓"旧账本凭空的再结算一次"(② 的现场)
      if (f >= acc.hitAt + 4) break;
    }
    if (R.state !== "RALLY") break;
  }
  if (acc.hitAt >= 0) { acc.whiffs = hero.stats.whiffs; acc.smashes = hero.stats.smashes; }
  return acc;
}

/** --selftest 要喂的反例:每条都是"今天已经改掉/绝不能改回去"的一种坏写法 */
type PatchMode =
  | "oldSwingGate"     // 真人挥拍中照样拦(旧门槛装回来)
  | "keepsLedger"      // 接管不清账本(swingBest/swingHit/serveSwing 原样留着)
  | "paysCdOnRefusal"  // 门槛不满足也扣冷却(按下没兑现还白罚)
  | "aiGateOpen"       // 那道闸连 AI 一起放开(偷偷给 CPU 白送一次捞回)
  | "pullTwice"        // 已在牵引中允许再按(叠第二条牵引、重付冷却)
  | "silentReason";    // 门槛未满足时键面一个字都不说

function runSuite(patchMode?: PatchMode): { ok: boolean; fails: string[]; checks: number } {
  const fails: string[] = [];
  const checker = makeChecker({});
  const ok = (cond: boolean, msg: string): void => {
    if (!cond) fails.push(msg);
    if (!patchMode) checker.ok(cond, msg);
  };

  const origCan = Skills.canActivate;
  const origAct = Skills.activate;
  const origReason = Skills.skillBlockReason;

  if (patchMode === "oldSwingGate") {
    Skills.canActivate = (p: PlayerEntity, ball: Ball): boolean => {
      if (p.skill?.id === "magnet" && p.swingT >= 0) return false;
      return origCan(p, ball);
    };
  } else if (patchMode === "paysCdOnRefusal") {
    Skills.activate = (p: PlayerEntity, ball: Ball, dir?: number): boolean => {
      const r = origAct(p, ball, dir);
      if (!r && p.skill) p.skill.cd = Skills.defOf("magnet").cooldownFrames;
      return r;
    };
  } else if (patchMode === "keepsLedger") {
    Skills.activate = (p: PlayerEntity, ball: Ball, dir?: number): boolean => {
      const best = p.swingBest ?? null;
      const hit = p.swingHit; const q = p.swingQ;
      const serve = !!p.serveSwing; const auto = !!p.swingAuto;
      const r = origAct(p, ball, dir);
      p.swingBest = best; p.swingHit = hit; p.swingQ = q;
      p.serveSwing = serve; p.swingAuto = auto;
      return r;
    };
  } else if (patchMode === "aiGateOpen") {
    Skills.canActivate = (p: PlayerEntity, ball: Ball): boolean => {
      const was = p.isAI; p.isAI = false;
      const r = origCan(p, ball);
      p.isAI = was;
      return r;
    };
  } else if (patchMode === "pullTwice") {
    Skills.canActivate = (p: PlayerEntity, ball: Ball): boolean => {
      if (p.skill?.id === "magnet") {
        return !!ball && ball.live && !ball.held && !ball.flying && !(p.isAI && p.swingT >= 0);
      }
      return origCan(p, ball);
    };
  } else if (patchMode === "silentReason") {
    Skills.skillBlockReason = (): string | null => null;
  }

  try {
    // ---------- ① 挥拍中逐格放行(核心诉求) ----------
    // 相位取自真实挥拍机器:0/1 = 引拍与窗开,8 = 窗中,17 = 窗尾,20 = 随挥,24 = 挥空硬直段
    console.log("① 挥拍中按下吸球必须起牵引(真人)");
    const phases = [0, 1, 8, 17, 20, 24];
    for (const ph of phases) {
      const st = setup({ phase: ph });
      ok(Skills.canActivate(st.hero, st.ball), `相位 ${ph}:门槛放行`);
      const ch = runChain({ phase: ph });
      ok(ch.pulled, `相位 ${ph}:按下当帧球进牵引轨迹`);
      // 按下即付(引力不像重击那样把冷却推到"扣出去"那一拍),而同一步里 Skills.update
      // 已经把它减了一帧 ⇒ 读回 359 才是"付了满档"的诚实值
      ok(ch.cdAfterPress === Skills.defOf("magnet").cooldownFrames - 1,
        `相位 ${ph}:按下即付冷却(${ch.cdAfterPress})`);
      ok(ch.swingTAfterPress <= 2,
        `相位 ${ph}:这一拍被技能接管(相位归零重起,实际 ${ch.swingTAfterPress})`);
    }
    {
      // "刚把球打出去就想吸回来"那一格:被打断的是一拍已经命中的挥拍
      const ch = runChain({ phase: 5, alreadyHit: true });
      ok(ch.pulled && ch.hitAt >= 0, "已击球那一拍被接管后仍然兑现回击(不吞技能、不卡死)");
    }

    // ---------- ② 接管必须清账 ----------
    console.log("② 接管这一拍时,被打断那拍的账本必须清零");
    {
      const { hero, ball } = setup({ phase: 8 });
      const stale: SwingBestShot = {
        q: 0.9, qRaw: 1, dEdge: 0, dRaw: 0,
        bx: ball.x, by: ball.y, bpx: ball.px, bpy: ball.py, swingT: 8,
      };
      hero.swingBest = stale;
      hero.swingQ = 0.7;
      hero.serveSwing = true;    // 发球起拍那位是 sticky 的:不清就是吸球摆出发球托球姿势
      hero.swingAuto = true;     // 被接管的是"系统代打"那一拍:来路不许继承
      hero.swingLoft = 1;        // 上一拍欠着的弧线意图
      hero.swingRadius = 30;     // 上一拍的够球半径
      const r = Skills.activate(hero, ball);
      ok(r === true, "activate 成功(挥拍中)");
      ok(hero.swingBest === null, "峰值追踪账本重开(旧账留着会在回击后凭空的再 settle 一次)");
      ok(hero.swingHit === false, "被打断那拍记作「没打出去」(到位那帧由 rules 置 true)");
      ok(hero.swingQ === 0, "swingQ 归零");
      ok(!hero.serveSwing, "serveSwing 清掉(发球后第一次吸球不该摆发球姿势)");
      ok(!hero.swingAuto, "来路改回手动(吸球是玩家自己按下的技能拍)");
      ok(hero.swingLoft === 0, "弧线意图以起拍为界重新提交");
      ok(hero.swingAim === C.aimDepth.deep, `落点仍按技能承诺压深场(${hero.swingAim})`);
      ok(hero.swingRadius > 30, `够球半径现算,不继承上一拍(${hero.swingRadius})`);
      ok(hero.swingStyle === "under", "地面释放 = 下手收球姿势");
    }
    {
      const { hero, ball } = setup({ phase: 8, lift: APEX });
      Skills.activate(hero, ball);
      ok(hero.swingStyle === "over", "空中释放 = 上手劈杀姿势");
    }

    // ---------- ③ 门槛不满足一律不付代价 ----------
    console.log("③ 拒绝就不许扣冷却(按下没兑现的不收代价)");
    {
      const cases: { name: string; o: SetupOpt }[] = [
        { name: "球没过来(死球)", o: { ballState: "dead" } },
        { name: "球被抓手(发球蓄力)", o: { ballState: "held" } },
        { name: "得分后球飞回手", o: { ballState: "flying" } },
        { name: "已在牵引中", o: { alreadyPulling: true } },
        { name: "AI 挥拍中", o: { ai: true, phase: 6 } },
      ];
      for (const cs of cases) {
        const { hero, ball } = setup(cs.o);
        ok(Skills.canActivate(hero, ball) === false, `${cs.name}:门槛拦下`);
        const r = Skills.activate(hero, ball);
        ok(r === false, `${cs.name}:activate 拒绝`);
        ok((hero.skill?.cd ?? -1) === 0, `${cs.name}:冷却分文不付(实际 ${hero.skill?.cd})`);
      }
    }

    // ---------- ④ AI 侧那道闸与旧行为逐字相同 ----------
    console.log("④ AI 保持旧门槛(它的强度归 diffs 管,三条尺子量不到这条)");
    {
      for (const ph of [0, 6, 20]) {
        const { hero, ball } = setup({ ai: true, phase: ph });
        ok(Skills.canActivate(hero, ball) === false, `AI 相位 ${ph}:挥拍中必须仍被拦`);
      }
      const { hero, ball } = setup({ ai: true });
      ok(Skills.canActivate(hero, ball) === true, "AI 静立:照常放行(与旧行为同一格)");
      ok(Skills.skillBlockReason(hero, ball) === null, "AI 静立完全就绪时键面无原因");
      const aiSwing = setup({ ai: true, phase: 6 });
      ok(Skills.skillBlockReason(aiSwing.hero, aiSwing.ball) === C.skills.blockText.swinging,
        "AI 挥拍中报「挥拍中」(判据与门槛同源,总闸关回旧行为时键面立刻跟着说)");
    }

    // ---------- ⑤ 键面原因卫生(真人) ----------
    console.log("⑤ 键面原因:真人挥拍中不再是原因,其余各态仍要说得出");
    {
      const human = setup({ phase: 8 });
      ok(Skills.skillBlockReason(human.hero, human.ball) === null,
        `真人挥拍中 = 完全就绪(不再报「${C.skills.blockText.swinging}」)`);
      const pulling = setup({ alreadyPulling: true });
      ok(Skills.skillBlockReason(pulling.hero, pulling.ball) === C.skills.blockText.pulling,
        "牵引中报「牵引中」");
      for (const st of ["dead", "held", "flying"] as const) {
        const c = setup({ ballState: st });
        ok(Skills.skillBlockReason(c.hero, c.ball) === C.skills.blockText.notIncoming,
          `${st} 球态报「球没过来」`);
      }
    }

    // ---------- ⑥ 整条链:只兑现一次回击 ----------
    console.log("⑥ 到位那一拍:整段一次回击、不记挥空、空中转跳杀");
    {
      const ch = runChain({ phase: 6 });
      ok(ch.pulled, "牵引起来");
      ok(ch.hitAt === MG.pullFrames - 1,
        `第 ${MG.pullFrames - 1} 帧(= 牵引帧数)到位出球,实际 ${ch.hitAt}`);
      ok(ch.hits === 1, `整段只兑现一次回击(实际 ${ch.hits} 次)`);
      ok(ch.skillKind === "magnet", `回击上报 skillKind=magnet(实际 ${ch.skillKind})`);
      ok(ch.magnetPullingAfterHit === false, "回击后 magnetPulling 关闭(一次施放兑现一拍)");
      ok(ch.whiffs === 0, `被打断那拍不记挥空(实际 whiffs=${ch.whiffs})`);
      ok(ch.lastHitter === "left", "回击算在真人这一队");
      ok(ch.vxAfter > 0, "球朝对面走");
      ok(ch.kind !== "smash", `地面回击不是扣杀(kind=${ch.kind})`);
      ok(ch.smashes === 0, "地面回击不记暴扣");

      const air = runChain({ phase: 6, lift: APEX });
      ok(air.kind === "smash", `空中释放转跳杀(kind=${air.kind})`);
      ok(air.smashes === 1, "空中那一拍记一次暴扣");
    }

    // ---------- ⑦ preview 通道不偷吃 + 加成数值 ----------
    console.log("⑦ 球种预告不偷吃回击窗口;加成数值与 config 同源");
    {
      const { hero, ball } = setup({});
      Skills.activate(hero, ball);
      const pre = Skills.modifyShot(hero, { preview: true, q: 1.0, sweet: true });
      ok(hero.skill?.magnetPulling === true, "preview 不关闭 magnetPulling(关了就「按了没反应」)");
      ok(pre.skillKind === "magnet" && pre.speedBoost === MG.speedBoost,
        `预告报出的加成与实打同一个数(+${pre.speedBoost})`);
      const real = Skills.modifyShot(hero, { preview: false, q: 1.0, sweet: true });
      ok(hero.skill?.magnetPulling === false, "真正那一拍才关闭回击窗口");
      ok(real.speedBoost === MG.speedBoost && real.powerDeg === 6,
        `实打加成 +${real.speedBoost}/+${real.powerDeg}°`);
      ok(Skills.modifyShot(hero, { preview: false, q: 1.0, sweet: true }).skillKind === undefined,
        "窗口关掉之后再打就是普通球(不白嫖第二记)");
    }
  } finally {
    Skills.canActivate = origCan;
    Skills.activate = origAct;
    Skills.skillBlockReason = origReason;
  }

  return { ok: fails.length === 0, fails, checks: checker.checks };
}

if (!process.argv.includes("--selftest")) {
  const res = runSuite();
  if (!res.ok) {
    console.error(`magnet-check 失败 ${res.fails.length}/${res.checks}:\n` + res.fails.join("\n"));
    process.exit(1);
  }
  console.log(`\n✓ magnet-check 全部通过(${res.checks} 条断言)`);
  process.exit(0);
}

console.log("=== magnet-check --selftest:反例必须被拦住 ===");
const BADS: PatchMode[] = [
  "oldSwingGate", "keepsLedger", "paysCdOnRefusal", "aiGateOpen", "pullTwice", "silentReason",
];
let bad = 0;
for (const b of BADS) {
  const res = runSuite(b);
  if (res.ok) {
    console.error(`✗ 反例 ${b} 居然全绿 —— 这套判据没有牙齿`);
    process.exit(1);
  }
  bad++;
  console.log(`  ✓ 反例 ${b} 被拦住(${res.fails.length} 处断言失败,首条:${res.fails[0]})`);
}
console.log(`\n✓ magnet-check --selftest:${bad} 份反例全部被拦住`);
process.exit(0);
