// ============================================================
// 影分身「强度上界」诊断 —— 把"这玩意到底有多能替玩家打球"翻译成一个数。
//
// 为什么必须单独有这一支尺子:2026-10-05 影分身改成"跨回合保留 + 同场最多三个 + 每回合补满
// 三球额度"之后,攒满编制的一方等于每回合多三个 normal 档 CPU 帮忙防守。而仓库里现成的尺子
// **全都量不到这一条**(可证明,不是"看起来无关"):
//   · ai-check / serve-check 的真人替身从不按技能键(它们量的是"人能不能赢")
//   · sim-check 是 AI vs AI,而 ai.ts 的技能决策链里根本没有 shadow 分支 ⇒ 谁都不会召分身
//   · frame-cost 只量渲染成本,不量胜负
// 所以这次增强如果过头,不会有任何现成回归变红 —— 那正是本仓反复警告的"安静地变强"。
//
// 三节:
//   §A 救援率网格(确定性,不掷骰子):把真人钉在底线不动,喂一颗**落向指定防区**的球,
//      数在场 0 / 1 / 2 / 3 个分身时"这球有没有被替回来"。
//      对照组 N=0 必须一格都救不到 —— 救到了就说明这场景本来就不需要分身,整节都是死的
//      (auto-hit-check 抓到三份哑反例的教训:判据读被量的那个配置,就等于没量)。
//   §B 一局里的代打占比:左队交给 normal 档 AI 替身(会跑位会回球,代表"会玩的人"),
//      每分照实按一次技能键攒编制,统计左队出手里有多少是分身打的。阈值 0.45:超过它,
//      机制就从"兜住你漏的那一拍"变成"替你打",玩家变成观众。
//   §C 配置自洽(明确标注:这不是行为断言)。
//
// 口径边界(别将来被人当玩家胜率读):§A 把真人钉成不动,那是**机制上界**(最坏情况);
// §B 的替身是 normal 档 AI,不是真人。两个数一起看才是这一款的真实强度带:
// 上界(§A)与"会玩的人还剩多少事做"(§B)。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json
//   node .tools-build/tools/shadow-balance-check.js
//   SHADOW_TUNE='{"slots":[{"diff":"easy"}]}' node .tools-build/tools/shadow-balance-check.js
//     ↑ 调参通道:不改源码就能试"如果失衡了该怎么降"(slots 按下标合并进 config)
// ============================================================
import { Rules } from "../assets/scripts/core/rules";
import { AI } from "../assets/scripts/core/ai";
import { Skills } from "../assets/scripts/core/skills";
import { ShadowGate } from "../assets/scripts/core/shadow-gate";
import { CFG } from "../assets/scripts/core/config";
import { Ball, PlayerInput, Player as PlayerEntity, ShadowCloneState } from "../assets/scripts/core/types";
import { makeChecker, Checker } from "./harness";

const C = CFG;
const CO = C.court, SH = C.skills.shadow;
const N_SLOTS = SH.slots.length;

const NO_INPUT = { left: false, right: false, jumpPressed: false, jumpHeld: false, swingAim: null, lungePressed: false };
const CAST = { ...NO_INPUT, skillPressed: true };

// ---------- 调参通道 ----------

/** SHADOW_TUNE='{"slots":[{"diff":"easy"}],"maxHits":2}' —— 只允许改 config 里已有的键 */
function applyTune(): void {
  const raw = process.env.SHADOW_TUNE;
  if (!raw) return;
  let tune: Record<string, unknown>;
  try {
    tune = JSON.parse(raw) as Record<string, unknown>;
  } catch (e) {
    console.error(`SHADOW_TUNE 不是合法 JSON:${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
  for (const k of Object.keys(tune)) {
    if (k === "slots") {
      const list = tune.slots as Array<Record<string, unknown>>;
      list.forEach((patch, i) => {
        const slot = SH.slots[i] as unknown as Record<string, unknown> | undefined;
        if (slot) Object.assign(slot, patch);
      });
    } else if (k in SH) {
      (SH as unknown as Record<string, unknown>)[k] = tune[k];
    } else {
      console.error(`SHADOW_TUNE:不认识的键「${k}」(只能量 skills.shadow 里已有的字段)`);
      process.exit(2);
    }
  }
  console.log(`调参生效:难度 ${SH.slots.map((s) => s.diff).join("/")} · maxHits ${SH.maxHits} `
    + `· refillHits ${SH.refillHits} · dutyByZone ${SH.dutyByZone}`);
}

// ---------- 场景搭建 ----------

function newMatchIdleHero(): { hero: PlayerEntity; ball: Ball } {
  Rules.newMatch("1p", "normal");
  const hero = Rules.R.players[0];
  const cpu = Rules.R.players[1];
  hero.skill = Skills.initSkillState("shadow");
  Skills.resetPoint(hero);
  // 真人钉在底线原地不动:§A 要量的就是"人够不着时,分身补不补得上"
  hero.x = CO.netX - 420; hero.px = hero.x; hero.y = CO.groundY; hero.py = hero.y;
  hero.vx = 0; hero.vy = 0; hero.onGround = true; hero.swingT = -1; hero.hitLock = 0;
  cpu.x = CO.netX + 320; cpu.px = cpu.x; cpu.y = CO.groundY; cpu.vy = 0;
  return { hero, ball: Rules.R.ball as Ball };
}

/** 召 n 枚(每枚占一个"新一分",走的仍是真实输入链;shadow-check 已验过召唤本身) */
function summonN(hero: PlayerEntity, n: number): void {
  for (let i = 0; i < n; i++) {
    Skills.resetPoint(hero);
    Rules.R.state = "RALLY";
    const ball = Rules.R.ball as Ball;
    ball.flying = false; ball.held = false; ball.live = true;
    Rules.step(Rules.R.players.map((p) => (p === hero ? { ...CAST } : { ...NO_INPUT })));
    for (let f = 0; f < SH.spawnFrames + 2; f++) {
      Rules.step(Rules.R.players.map(() => ({ ...NO_INPUT })));
    }
  }
}

/**
 * 摆一颗"已经飞进指定防区、再走 dist 帧就该落地"的来球。
 * 口径照 shadow-check 的 feedBall(短程 + gravity 抛物线补偿),**不要**摆成从对方底线飞来的远球:
 * 羽毛球阻力极大,那条按无阻力算出的补偿初速会在半路就掉到地上(实测 900 帧窗口里球只飞到
 * 691 就落地),量出来的"救援率 0%"是弹道假,不是分身没用。
 */
function feedIntoBand(ball: Ball, bandX: number, vx: number): void {
  const dist = 90;
  const T = dist / Math.abs(vx);
  const vy = -(0.5 * C.shuttle.gravity * T);
  ball.x = bandX + dist; ball.px = ball.x;
  ball.y = CO.groundY - 60; ball.py = ball.y + vy;
  ball.vx = vx; ball.vy = vy;
  ball.live = true; ball.held = false; ball.owner = null;
  ball.flying = false; ball.flyT = 0; ball.shot = null; ball.magnetPull = null;
  ball.lastHitter = "right"; ball.crossed = true; ball.netted = false;
  Rules.R.state = "RALLY"; Rules.R.timer = 0; Rules.R.serveWait = 0;
  Rules.R.events.length = 0;
}

/** 把三枚请回各自防区:每帧把球钉在原地(不然它会落地、这一分就真打完了) */
function settleClones(arr: ShadowCloneState[], ball: Ball, maxFrames = 200): void {
  for (let f = 0; f < maxFrames; f++) {
    ball.lastHitter = "left"; ball.live = true; ball.held = false; ball.flying = false;
    ball.x = CO.netX + 250; ball.px = ball.x; ball.y = CO.groundY - 260; ball.py = ball.y;
    ball.vx = 0; ball.vy = 0; ball.shot = null;
    Rules.R.state = "RALLY"; Rules.R.timer = 0;
    Rules.step(Rules.R.players.map(() => ({ ...NO_INPUT })));
    if (arr.every((sc) => Math.abs(sc.entity.x - sc.entity.homeX) < 10)) return;
  }
}

/** 一个样本:钉住真人 → 召 n 个分身 → 各归其位 → 喂一颗飞进指定防区的球 → 看左队有没有打回去
 *  @param spendNearest 把"防区离这颗球最近的那枚"当场用满(接满三球正在消散)——
 *      这一格量的才是"多分身"到底买到了什么:见 sectionA 的说明。 */
function rescued(nClones: number, bandX: number, vx: number, spendNearest = false): boolean {
  const { hero, ball } = newMatchIdleHero();
  summonN(hero, nClones);
  const arr = ShadowGate.clonesOf(hero);
  settleClones(arr, ball);
  if (spendNearest && arr.length) {
    let best = arr[0], bd = Infinity;
    for (const sc of arr) {
      const d = Math.abs(sc.entity.homeX - bandX);
      if (d < bd) { bd = d; best = sc; }
    }
    best.hits = SH.maxHits;
    best.despawnT = SH.despawnFrames;      // 满额消散中:tryCloneHit 会跳过它
  }
  feedIntoBand(ball, bandX, vx);
  for (let f = 0; f < 200; f++) {
    Rules.R.events.length = 0;
    Rules.step(Rules.R.players.map(() => ({ ...NO_INPUT })));
    const hit = Rules.R.events.find((e) => e.t === "hit") as unknown as Record<string, unknown> | undefined;
    if (hit && hit.side === "left") return true;
    if (Rules.R.state !== "RALLY") break;
  }
  return false;
}

// ---------- §A 救援率网格 ----------

function sectionA(ck: Checker): void {
  const bands = SH.slots.map((s, i) => ({ name: `${i} 号带`, x: CO.netX + s.homeOffset }));
  const speeds = [2.2, 3.2];
  const run = (ci: number, b: { x: number }, spend: boolean): boolean => {
    let got = 0;
    for (const v of speeds) if (rescued(ci, b.x, -v, spend)) got++;
    return got === speeds.length;
  };
  const grid: number[][] = [];        // grid[在场分身数][防区] —— 常态救援率
  const gap: number[][] = [];         // 同形状,但"当值那枚刚用满消散中"
  for (let ci = 0; ci <= N_SLOTS; ci++) {
    grid[ci] = []; gap[ci] = [];
    for (const b of bands) {
      grid[ci][bands.indexOf(b)] = (speeds.filter((v) => rescued(ci, b.x, -v)).length / speeds.length);
      gap[ci][bands.indexOf(b)] = run(ci, b, true) ? 1 : 0;
    }
  }
  const pct = (v: number): string => `${(v * 100).toFixed(0)}%`;
  console.log("\n§A 救援率(真人钉在底线不动;每格 = 两种球速下都被替回来的比例)");
  console.log("   上排 = 常态;下排 = 当值那枚正好用满消散中(防线空窗)");
  for (let ci = 0; ci <= N_SLOTS; ci++) {
    console.log(`  在场 ${ci} 个  常态 ${bands.map((b, bi) => `${b.name} ${pct(grid[ci][bi])}`).join("  ")}`);
    console.log(`            空窗 ${bands.map((b, bi) => `${b.name} ${pct(gap[ci][bi])}`).join("  ")}`);
  }

  ck.ok(grid[0].every((v) => v === 0),
    "§A 对照:零分身时三格救援率必须为 0(否则这条判据量的是死支)");
  ck.ok(bands.every((_, bi) => grid[1][bi] <= grid[N_SLOTS][bi] + 1e-9),
    "§A 单调:满编的每格救援率 ≥ 单分身(多召一个不许把防守做小)");
  ck.ok(grid[N_SLOTS].every((v) => v >= 0.5),
    `§A 覆盖:满编时每一号防区救援率 ≥ 50%(${bands.map((b, bi) => `${b.name} ${pct(grid[N_SLOTS][bi])}`).join(" ")})`);
  // **"三个"买到的到底是什么**(这一格是本工具存在的主要理由):
  // 一颗球本来就只需要一个人接 —— 单分身也能满格救起(实测常态三格全 100%),所以
  // "救援率"这一项**量不出 1 个与 3 个的差别**,拿它当"三个更强"的证据就是自欺。
  // 多分身真正买到的是**冗余**:当值那枚接满三球正在消散的那 26 帧里,防线不空。
  ck.ok(gap[1].every((v) => v === 0),
    `§A 空窗对照:只有一个分身时,它一消散三格全漏(${gap[1].map(pct).join(" ")})—— 这才是"最多三个"的意义`);
  ck.ok(gap[N_SLOTS].filter((v) => v > 0).length >= 2,
    `§A 冗余有效:满编时空窗里仍至少两号防区有人补位(${gap[N_SLOTS].map(pct).join(" ")})`);
}

// ---------- §B 一局里的代打占比 ----------

interface MatchStats { heroHits: number; cloneHits: number; leftPoints: number; rightPoints: number; rallies: number }

/** 左队交给 normal 档替身(会跑位会回球),每分照实按一次技能键;右队正常 AI */
function playMatchWithClones(): MatchStats {
  Rules.newMatch("1p", "normal");
  const R = Rules.R;
  const hero = R.players[0];
  const cpu = R.players[1];
  hero.skill = Skills.initSkillState("shadow");
  hero.aiDiff = "normal";
  AI.reset(hero);
  const st: MatchStats = { heroHits: 0, cloneHits: 0, leftPoints: 0, rightPoints: 0, rallies: 0 };
  for (let step = 0; step < 60000 && R.state !== "OVER"; step++) {
    const ball = R.ball as Ball;
    const inputs: PlayerInput[] = R.players.map(() => ({ ...NO_INPUT }));
    const hIn = AI.think(hero, ball, R.state);
    // 真实玩家的用法:能召就召(满编/本分召过会被门槛自然拦下,不硬按)
    hIn.skillPressed = Skills.canActivate(hero, ball);
    inputs[hero.idx] = hIn;
    inputs[cpu.idx] = AI.think(cpu, ball, R.state);
    R.events.length = 0;
    Rules.step(inputs);
    for (const e of R.events) {
      const ev = e as unknown as Record<string, unknown>;
      if (ev.t === "hit" && ev.side === "left") {
        if (ev.isAI === true) st.cloneHits++; else st.heroHits++;
      }
      if (ev.t === "score") {
        st.rallies++;
        if (ev.side === "left") st.leftPoints++; else st.rightPoints++;
      }
    }
  }
  return st;
}

function sectionB(ck: Checker): void {
  const st = playMatchWithClones();
  const leftHits = st.heroHits + st.cloneHits;
  const share = leftHits ? st.cloneHits / leftHits : 0;
  const pts = st.leftPoints + st.rightPoints;
  console.log("\n§B 一局(左队 = normal 档替身 + 每分召分身)");
  console.log(`  ${st.rallies} 个回合,左队出手 ${leftHits} 次:替身 ${st.heroHits} / 分身 ${st.cloneHits}`);
  console.log(`  分身代打占比 ${(share * 100).toFixed(1)}%  ·  比分 ${st.leftPoints}:${st.rightPoints}`
    + `  ·  攒满编制要 ${N_SLOTS} 分(每分限召一次)`);
  ck.ok(st.rallies >= 6, `§B 前置:这一局要打够 6 个回合(实际 ${st.rallies})`);
  ck.ok(leftHits > 0, "§B 前置:左队有过回球(否则占比是 0/0)");
  ck.ok(st.cloneHits > 0, `§B 对照:分身确实出手了(实际 ${st.cloneHits} 次;为 0 则下面那条 ≤ 是死的)`);
  ck.ok(share <= 0.45,
    `§B 代打占比 ≤ 45%(实测 ${(share * 100).toFixed(1)}%)—— 超过它,"兜住你漏的那一拍"就变成"替你打"`);
  if (pts > 0) {
    console.log(`  参考:左队得分率 ${((st.leftPoints / pts) * 100).toFixed(0)}%(含分身协防;ai-check 的替身基线不含)`);
  }
}

// ---------- §C 配置自洽(不是行为断言,标清楚) ----------

function sectionC(ck: Checker): void {
  const diffs = Object.keys(C.diffs);
  ck.ok(N_SLOTS === 3, `§C 自洽:槽位表 ${N_SLOTS} 格 = 场上上限(用户口径「最多三个」)`);
  ck.ok(new Set(SH.slots.map((s) => s.tint)).size === N_SLOTS, "§C 自洽:三色不重复");
  ck.ok(SH.slots.every((s) => diffs.indexOf(s.diff) >= 0), "§C 自洽:槽位难度都是 diffs 的真键");
  ck.ok(SH.modes.indexOf("drill") < 0 && SH.modes.indexOf("tutorial") < 0,
    "§C 自洽:训练场/教学不在生效模式里(drill 的判据按队不按实体)");
  ck.ok(SH.slots.every((s, i) => i === 0 || s.homeOffset > SH.slots[i - 1].homeOffset),
    "§C 自洽:homeOffset 由后场到网前单调(防区不重叠才谈分工)");
}

const ck = makeChecker();
applyTune();
sectionA(ck);
sectionB(ck);
sectionC(ck);
console.log(`\n${ck.fails === 0 ? "✓" : "✗"} shadow-balance-check:${ck.checks} 条断言,${ck.fails} 条失败`);
console.log("（§A 是机制上界、§B 是「会玩的人还剩多少事做」;两个数一起看,别单独当胜率读）");
process.exit(ck.fails ? 1 : 0);
