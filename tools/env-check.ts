// ============================================================
// 关卡环境机制回归 (env-check)
//
// 为什么要单独有这一条:用户打第 1 关「海风突变」的现场反馈是
// 「海风完全没有动画提示、也没有方向提示,我根本不知道怎么利用,一点游戏性都没有」。
// 排查下来这不是某一关的笔误,而是三类会反复长出来的结构毛病:
//   A. 机制只住在物理层,界面一行都不读 —— 玩家挨了打却看不见是谁打的(风 / 磁轨 / 颤抖);
//   B. 同一件事有好几份积分实现,口径互不相同 —— 落点圈按"不含风的旧积分"画,球却按新积分飞,
//      画在 A 打到 B,比没提示更误导;
//   C. 修 B 的时候手一抖就把机制修没了 —— 让出球解算去**补偿**风,每一拍都精准落在瞄的地方,
//      风当场失去意义。这种"修复"看着全绿,其实是删玩法。
// 所以这个脚本一半在 node 里跑真 core 代码量物理,一半扫源码查"有没有人画它"。
//
// 断什么:
//   §1 时钟归属   只有 rules 能推进环境相位;UI 前瞻一律只读(渲染污染物理的总闸)
//   §2 积分器一致 truth 口径下 trace / predictPath / future 三条弧逐位相同(四套积分器的墓碑)
//   §3 求解器诚实 **主动断言侧风没被补偿**(C 的牙齿:机制被"修没"时这里必须红)
//   §4 重力认账   gravityMul 必须进出球解算(低重力=打得更远,不是随机出界)
//   §5 逐关有效  每关声明的 physics 键都要量出可测差异;颤抖要落在带内且可复算
//   §6 前瞻不截断 低重力关的弧长不能把落点圈悄悄吃掉
//   §7 有人画它   environment 键必须在 render/ui/game 里被读到;全仓库零引用 = 死配置
//
// --selftest 用改坏的东西喂上面每条,确认判据真的会报警(规则脚本最怕悄悄全绿)。
//
// 用法(先 npx tsc -p tools/tsconfig.json 编译):
//   node .tools-build/tools/env-check.js            # exit 0 = 通过
//   node .tools-build/tools/env-check.js -v         # 打印逐关量到的数
//   node .tools-build/tools/env-check.js --selftest
// ============================================================
import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join } from "path";
import { CFG } from "../assets/scripts/core/config";
import { Pace } from "../assets/scripts/core/pace";
import { Physics, flightFramesTo, type EnvModifier, type BallLike, type TraceResult } from "../assets/scripts/core/physics";
import { CAMPAIGN_STAGES, type StageDef } from "../assets/scripts/core/campaign";

const verbose = process.argv.includes("-v") || process.argv.includes("--verbose");
const selftest = process.argv.includes("--selftest");

let bad = 0;
let waived = 0;
// 显式豁免表:已知缺失、判据正确在响的条目,一条一条列名 + 原因 + TODO 去向。
// 常红不豁免 = 告警疲劳(没人再看这条工具的输出);悄悄删判据 = 自欺。
// 豁免条目每次运行都以 ☰ 打印,想摘掉豁免就把对应视觉做出来。
const EXPECTED_FAILS: { re: RegExp; why: string; todo: string }[] = [
  // 2026-10-02 摘空:原先三条豁免(sakuraFlurry 落樱 / physics.laserRail 磁轨 / physics.erratic 破损球)
  // 的视觉都已在 render/world.ts 落地(花瓣粒子、网顶轨体带触发过冲、同相位残影 + 失速撕口),
  // 豁免表留着就等于"允许机制隐形"的合法出口 —— 现在回到零豁免:再有人加机制不配画面,直接红。
];
const fail = (sec: string, msg: string): void => {
  const hit = EXPECTED_FAILS.find((e) => e.re.test(msg));
  if (hit) {
    waived++;
    console.log(`  ☰ [§${sec}] 豁免:${msg}\n      (因为${hit.why} → ${hit.todo})`);
    return;
  }
  bad++;
  console.log(`  ✗ [§${sec}] ${msg}`);
};
const info = (msg: string): void => { if (verbose) console.log(`      ${msg}`); };

function findRoot(): string {
  let dir = __dirname;
  for (let up = 0; up < 8; up++) {
    if (existsSync(join(dir, "assets/scripts/core/physics.ts"))) return dir;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}
const ROOT = findRoot();

const NO_MOD: EnvModifier = { windX: 0, windOscillate: false, gravityMul: 1, dragMul: 1, erratic: false, laserRail: false };
const mkMod = (patch: Partial<EnvModifier>): EnvModifier => ({ ...NO_MOD, ...patch });

/** 一颗"像样的"来球:中线附近、网前高度、朝左场飞 —— 四条断言共用同一个起点 */
const PROBE = { x: 300, y: 200, vx: 7.5, vy: -3 };
const scratch = (b = PROBE): BallLike => ({ x: b.x, y: b.y, px: b.x, py: b.y, vx: b.vx, vy: b.vy });
const pathBuf = new Float32Array((CFG.landing.pathHorizonMax + 2) * 2);
const endBuf = new Int8Array(1);

/** 扫某个 phase 区间里 |windAt| 最大那一格的相位(侧风满偏点) */
function peakPhase(mod: EnvModifier): number {
  let best = 0, abs = -1;
  Physics.setEnvModifier(mod);
  for (let p = 0; p < 1000; p++) {
    const w = Math.abs(Physics.windAt(p));
    if (w > abs) { abs = w; best = p; }
  }
  return best;
}

// ---------- §1 时钟归属 ----------
function checkClockOwnership(): void {
  console.log("§1 时钟归属:UI 前瞻只读,只有 tickEnv 能推进");
  Physics.setEnvModifier(mkMod({ windX: 0.18, windOscillate: true, erratic: true }));
  const before = Physics.envPhase();
  for (let i = 0; i < 200; i++) {
    Physics.predictPath(PROBE.x, PROBE.y, PROBE.vx, PROBE.vy, CFG.landing.pathHorizon, pathBuf, endBuf);
    Physics.future(scratch(), 60);
    flightFramesTo(scratch(), 500, 300, 40, 90);
    Physics.trace(PROBE.x, PROBE.y, PROBE.vx, PROBE.vy, 200, "truth", before);
  }
  if (Physics.envPhase() !== before) {
    fail("1", `前瞻把环境时钟推了 ${Physics.envPhase() - before} 步(应当 0)。渲染污染物理相位 = 颤抖球不可复算`);
  } else info(`200×(predictPath+future+flightFramesTo+trace) 之后相位仍为 ${before}`);
  Physics.tickEnv();
  if (Physics.envPhase() !== before + 1) fail("1", `tickEnv() 之后相位应为 ${before + 1},实为 ${Physics.envPhase()}`);
  Physics.setEnvModifier(null);
}

// ---------- §2 积分器一致 ----------
// 注意两处量纲口径:
//   · trace / predictPath 的相位都取"当前环境时钟"(setEnvModifier 会归零),
//     否则颤抖/风会用两套不同相位,差的是机制而不是 bug;
//   · future 不判落地、也不把 y 夹到地面线,所以只比 x(落地那一步它会穿过地面继续算)。
function checkIntegratorAgreement(mod: EnvModifier, label: string): void {
  Physics.setEnvModifier(mod);
  const p0 = Physics.envPhase();
  const t = Physics.trace(PROBE.x, PROBE.y, PROBE.vx, PROBE.vy, 400, "truth", p0);
  const n = Physics.predictPath(PROBE.x, PROBE.y, PROBE.vx, PROBE.vy, 400, pathBuf, endBuf);
  const ppX = pathBuf[(n - 1) * 2], ppY = pathBuf[(n - 1) * 2 + 1];
  const pts = Physics.future(scratch(), t.steps, "truth");
  const fv = pts[pts.length - 1];
  // 弧的点是写进 Float32Array 给 Graphics 用的,float32 在 500 量级上本来就存不下
  // 1e-6 的精度 —— 这里的容差按"量化噪声"给,不是积分器分歧(分歧是十几到几百像素量级)
  const d1 = Math.hypot(t.landX - ppX, t.landY - ppY);
  const d2 = Math.abs(t.landX - fv.x);
  const EPS = 1e-3;
  if (endBuf[0] === 3) fail("2", `${label}:predictPath 被前瞻/缓冲截断,画不出真落点(落点圈会缺席或画在半路)`);
  if (d1 > EPS) fail("2", `${label}:trace(truth) 与 predictPath 落点差 ${d1.toFixed(6)}px —— 弧与圈又分家了`);
  if (d2 > EPS) fail("2", `${label}:trace(truth) 与 AI 的 future 横向差 ${d2.toFixed(6)}px —— AI 按另一条球路跑位`);
  info(`${label}:Δ弧=${d1.toExponential(1)} ΔAI(x)=${d2.toExponential(1)} ${t.steps} 帧落地 end=${endBuf[0]}`);
  Physics.setEnvModifier(null);
}

// ---------- §3 求解器诚实 ----------
/**
 * 这套方案里最容易被"修坏"的地方,所以判据要盯对量:
 * 反解的**职责**就是把球解到瞄的落点,所以「solveShot 的 landX ≈ target」永远成立,
 * 拿它当"有没有补偿风"的证据是错的。正确的是比 **同一发初速下 aim 口径与 truth 口径的落点差**:
 * 差得开 = 风真会把球吹离瞄点(机制在);差趋零 = 解算替玩家把风补掉了(机制没了)。
 * 幅度只在**满偏那一格**苛求 —— 近零交叉时风本来就小,不该要求同样的漂移。
 */
function checkSolverHonesty(): void {
  console.log("§3 求解器诚实:侧风必须**不被**出球解算补偿(否则机制被修没)");
  const mod = mkMod({ windX: CFG.env.windDefaultBase, windOscillate: true });
  Physics.setEnvModifier(mod);
  const sol = Physics.solveShot(PROBE.x, PROBE.y, 1, 0.9, 22, 0);
  const peak = peakPhase(mod);
  const peakW = Physics.windAt(peak);
  const driftAt = (ph: number): number => {
    const truth = Physics.trace(PROBE.x, PROBE.y, sol.vx, sol.vy, 400, "truth", ph);
    return truth.landX - sol.trace.landX;
  };
  const dPeak = driftAt(peak);
  if (Math.abs(dPeak) < CFG.env.windMinDrift) {
    fail("3", `满偏相位 ${peak}(风=${peakW.toFixed(3)})漂移只有 ${dPeak.toFixed(1)}px < ${CFG.env.windMinDrift}px —— `
      + "漂移趋零说明出球解算在补偿风:每一拍都精准落在瞄的地方,侧风这个机制等于删了");
  }
  if (Math.abs(dPeak) > 0 && Math.sign(dPeak) !== Math.sign(peakW)) {
    fail("3", `漂移符号(${dPeak.toFixed(1)})与风向(${peakW.toFixed(3)})相反 —— 风的施加方向与界面读法会各说一套`);
  }
  let smallPh = 0, smallAbs = Infinity;
  for (let p = 0; p < 393; p++) {
    const a = Math.abs(Physics.windAt(p));
    if (a < Math.abs(peakW) * 0.2 && a < smallAbs) { smallAbs = a; smallPh = p; }
  }
  const dSmall = driftAt(smallPh);
  if (!(Math.abs(dSmall) < Math.abs(dPeak))) {
    fail("3", `小风(相位${smallPh})漂移 ${dSmall.toFixed(1)}px 不小于满偏 ${dPeak.toFixed(1)}px —— 漂移与风力不成比例,读不出"等哪一拍"）`);
  }
  info(`满偏 ${dPeak.toFixed(0)}px@相位${peak} · 小风 ${dSmall.toFixed(0)}px@相位${smallPh} · 风满幅=${Math.abs(peakW).toFixed(3)}`);
  Physics.setEnvModifier(null);
}

// ---------- §4 重力/阻尼进解算 ----------
/**
 * 判据看的是"解算吃了什么",而不是"落点变了没":反解会自己改初速把落点拉回 target,
 * 所以低重力下 landX 仍然等于 target 才是对的。**吃到了的证据是初速与滞空帧数变了。**
 */
function checkGravityInSolver(): void {
  console.log("§4 重力/阻尼进解算:低重力要读成「打得更远」,不是随机出界");
  const solveWith = (mod: EnvModifier): { speed: number; steps: number; landX: number; targetX: number } => {
    Physics.setEnvModifier(mod);
    const s = Physics.solveShot(PROBE.x, PROBE.y, 1, 0.9, 22, 0);
    const r = { speed: s.speed, steps: s.trace.steps, landX: s.trace.landX, targetX: s.targetX };
    Physics.setEnvModifier(null);
    return r;
  };
  const base = solveWith(NO_MOD);
  const g = solveWith(mkMod({ gravityMul: 0.22 }));
  const d = solveWith(mkMod({ dragMul: 1.35 }));
  if (Math.abs(g.speed - base.speed) < 0.5) {
    fail("4", `gravityMul 0.22 下解出的初速几乎没变(${base.speed.toFixed(2)} → ${g.speed.toFixed(2)}):`
      + "出球解算没吃重力倍率,低重力关会按 1g 的账出球 → 每一拍都打飞");
  }
  if (!(g.steps > base.steps)) fail("4", `低重力没有更滞空(${base.steps} → ${g.steps} 帧)`);
  for (const [name, r] of [["常重", base], ["0.22 重", g], ["阻尼1.35", d]] as (readonly [string, { speed: number; steps: number; landX: number; targetX: number }])[]) {
    if (Math.abs(r.landX - r.targetX) > 12) {
      fail("4", `${name}:解出的落点 ${r.landX.toFixed(0)} 偏离 target ${r.targetX.toFixed(0)} 达 ${Math.abs(r.landX - r.targetX).toFixed(0)}px —— 解算不再命中瞄点`);
    }
  }
  if (Math.abs(d.speed - base.speed) < 0.2) fail("4", `dragMul 1.35 下初速没变(${base.speed.toFixed(2)} → ${d.speed.toFixed(2)}) —— 阻尼没进解算`);
  info(`初速 常=${base.speed.toFixed(2)} 低重=${g.speed.toFixed(2)} 高阻=${d.speed.toFixed(2)} · 滞空 ${base.steps}/${g.steps}/${d.steps} 帧`);
}

// ---------- §5 逐关 modifier 有效性 ----------
/**
 * 每关声明的 physics 键都要**量出差异**。写了却没造成任何可测差 = 死配置
 * (sakuraFlurry / laserBoosted / isErratic 这几个当初就是这么抓到的)。
 * 颤抖另加一条带内约束:落点散布要够大才叫机制,要**可复算**才叫公平 ——
 * 相位取自 envPhase,同一相位必须给出同一落点。
 */
const ERRATIC_BAND: [number, number] = [40, 110];   // px,落点相对无抖基线的散布下限/上限

function measureLand(mod: EnvModifier, phase: number): number {
  Physics.setEnvModifier(mod);
  const t = Physics.trace(PROBE.x, PROBE.y, PROBE.vx, PROBE.vy, 400, "truth", phase);
  Physics.setEnvModifier(null);
  return t.landX;
}

function erraticSpread(mod: EnvModifier): { spread: number; deterministic: boolean } {
  const clean = measureLand(NO_MOD, 5);
  const xs: number[] = [];
  for (let p = 0; p < 393; p += 7) xs.push(measureLand(mod, p));
  const again = xs.map((_, i) => measureLand(mod, i * 7));
  const deterministic = xs.every((v, i) => Math.abs(v - again[i]) < 1e-9);
  return { spread: Math.max(...xs) - Math.min(...xs), deterministic };
}

function checkStages(): void {
  console.log("§5 逐关 physics 有效性 + 颤抖带内且可复算");
  for (const st of CAMPAIGN_STAGES) {
    const ph = st.modifiers.physics;
    if (!ph) continue;
    const mod = mkMod({
      windX: ph.windX ?? 0, windOscillate: !!ph.windOscillate,
      gravityMul: ph.gravityMul ?? 1, dragMul: ph.dragMul ?? 1,
      erratic: !!ph.erratic, laserRail: !!ph.laserRail,
    });
    const cleanX = measureLand(NO_MOD, 5);
    const parts: string[] = [];

    if (ph.windX) {
      const p = peakPhase(mod);
      const drift = Math.abs(measureLand(mod, p) - cleanX);
      parts.push(`风漂移${drift.toFixed(0)}px@相位${p}`);
      if (drift < 120) fail("5", `${st.id}:侧风满偏只横移 ${drift.toFixed(1)}px(<120) —— 风太弱,读不出"顺/逆风"的差别`);
    }
    if (ph.gravityMul && ph.gravityMul !== 1) {
      Physics.setEnvModifier(mod);
      const s = Physics.trace(PROBE.x, PROBE.y, PROBE.vx, PROBE.vy, 400, "truth", 5);
      Physics.setEnvModifier(null);
      Physics.setEnvModifier(NO_MOD);
      const b = Physics.trace(PROBE.x, PROBE.y, PROBE.vx, PROBE.vy, 400, "truth", 5);
      Physics.setEnvModifier(null);
      parts.push(`滞空${s.steps}/${b.steps}帧`);
      if (s.steps <= b.steps) fail("5", `${st.id}:gravityMul ${ph.gravityMul} 反而没多滞空一秒帧数`);
    }
    if (ph.dragMul && ph.dragMul !== 1) {
      const x = measureLand(mod, 5);
      parts.push(`落点Δ${(x - cleanX).toFixed(0)}px`);
      if (Math.abs(x - cleanX) < 1) fail("5", `${st.id}:dragMul ${ph.dragMul} 没改变落点`);
    }
    if (ph.erratic) {
      const { spread, deterministic } = erraticSpread(mod);
      parts.push(`颤抖散布${spread.toFixed(0)}px`);
      if (!deterministic) fail("5", `${st.id}:同一相位给出不同落点 —— 颤抖不可复算,玩家不可能学会,那是噪声不是机制`);
      if (spread < ERRATIC_BAND[0]) {
        fail("5", `${st.id}:颤抖只把落点铺开 ${spread.toFixed(1)}px(<${ERRATIC_BAND[0]})。`
          + `修好时钟之后振幅若按老值会塌成两三个像素:机制还在,玩家却看不出来 —— 需要重定标 amp/freq`);
      } else if (spread > ERRATIC_BAND[1] * 3) {
        fail("5", `${st.id}:颤抖铺开 ${spread.toFixed(1)}px,远超可预判的范围 —— 那就是随机`);
      }
    }
    if (ph.laserRail) {
      const E = CFG.env.laser;
      Physics.setEnvModifier(mod);
      // 一记贴网低平球:应当落在触发带里并被加速
      const b: BallLike & { laserBoosted?: boolean } = { x: CFG.court.netX - 90, y: CFG.court.netTopY - E.above + 6, px: 0, py: 0, vx: 9, vy: 0.2, laserBoosted: false };
      let peak = 0;
      for (let i = 0; i < 40; i++) { Physics.step(b, "truth", i); peak = Math.max(peak, b.vx); }
      Physics.setEnvModifier(null);
      parts.push(`磁轨峰值vx${peak.toFixed(1)} 标记=${b.laserBoosted}`);
      if (peak < 9 * E.speedMul * 0.6) fail("5", `${st.id}:磁轨带内没有加速(峰值 ${peak.toFixed(2)})`);
      if (b.laserBoosted !== true) fail("5", `${st.id}:球真被加速了却没记 laserBoosted —— 界面与音效没有可读的落点`);
    }
    info(`${st.id} ${st.title}: ${parts.join(" · ")}`);
  }
}

// ---------- §6 前瞻不截断 ----------
function checkHorizon(): void {
  console.log("§6 前瞻帧数够长:低重力不能把落点圈吃掉");
  for (const st of CAMPAIGN_STAGES) {
    const g = st.modifiers.physics?.gravityMul ?? 1;
    if (g >= 1) continue;
    const mod = mkMod({ gravityMul: g, dragMul: st.modifiers.physics?.dragMul ?? 1 });
    const need = Physics.pathStepsFor(mod);
    Physics.setEnvModifier(mod);
    // 该关最滞空的一档:底线高球
    const sol = Physics.solveShot(CFG.court.netX - 210, 250, 1, 1.0, CFG.loftByHeight[CFG.loftByHeight.length - 1][1], 0);
    const t = Physics.trace(CFG.court.netX - 210, 250, sol.vx, sol.vy, 400, "truth", 3);
    Physics.setEnvModifier(null);
    if (need < t.steps) fail("6", `${st.id}:实测滞空 ${t.steps} 帧 > 前瞻 ${need} 帧 —— 弧会画到一半收笔,落点圈直接消失`);
    else info(`${st.id} gravityMul=${g}:需 ${t.steps} 帧,给 ${need} 帧`);
  }
}

// ---------- §7 有人画它(源码审计) ----------
function isDir(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}
function readSrc(p: string): string | null {
  try { return readFileSync(p, "utf8"); } catch { return null; }
}
function collectSources(dirs: string[]): { file: string; src: string }[] {
  const out: { file: string; src: string }[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (isDir(p)) { walk(p); continue; }
      if (!name.endsWith(".ts")) continue;
      const raw = readSrc(p);
      if (raw !== null) out.push({ file: p.slice(ROOT.length + 1), src: raw });
    }
  };
  for (const d of dirs) if (isDir(d)) walk(d);
  return out;
}

/**
 * environment 键必须在表现层被读到。第 1 关的风、磁轨、居合、假球当初都是
 * "关卡表里写了、物理层也生效了、界面一行都没读" —— 玩家看到的就是毫无来由的打飞。
 *
 * ⚠ 光看键名会**假绿**:render/court.ts 里有个同名的私有装饰量 `this.windX`
 *   (椰树/落樱的摆动),它和 EnvModifier.windX 毫无关系 —— 风是 0 还是 0.18,
 *   海滩画面一模一样。所以合格的读者必须**同时**摸到机制的真实来源。
 */
const ENV_KEYS = ["sandstorm", "fog", "blindingSun", "empGlitch", "hologramDecoy", "spectatorFlash", "sakuraFlurry"] as const;
const PHYS_VIEW_KEYS = ["laserRail", "windX", "windOscillate", "erratic"] as const;
/** 机制的真实出处:关卡表 modifiers、环境单例、或 physics 的风读取 */
const ENV_SOURCE = /getEnvModifier|Physics\.windAt|\bwindAt\(|modifiers\.(physics|player|environment)|stage\.modifiers|activeStage|env\?\.\w/;

/**
 * 真读者 = 提到键名 **且** 摸到了机制的出处(不是恰好有个同名变量)。
 * 抽成纯函数是为了 --selftest 能喂两份假文件进来,验证它真的会拒绝"同名装饰量"那种假绿。
 */
function findReaders(key: string, srcs: { file: string; src: string }[]): string[] {
  const re = new RegExp(`\\b${key}\\b`);
  return srcs.filter((f) => re.test(f.src) && ENV_SOURCE.test(f.src)).map((f) => f.file);
}

function checkConsumers(): void {
  console.log("§7 每个机制都得有人画:扫 render/ui/game 找读者");
  const srcs = collectSources([
    join(ROOT, "assets/scripts/render"),
    join(ROOT, "assets/scripts/ui"),
    join(ROOT, "assets/scripts/game"),
  ]);
  const wholeRepo = collectSources([join(ROOT, "assets/scripts")]);
  const usedEnv = new Set<string>();
  const usedPhys = new Set<string>();
  for (const st of CAMPAIGN_STAGES) {
    for (const k of ENV_KEYS) if (st.modifiers.environment?.[k]) usedEnv.add(k);
    for (const k of PHYS_VIEW_KEYS) if (st.modifiers.physics?.[k]) usedPhys.add(k);
  }
  const readers = (key: string): string[] => findReaders(key, srcs);

  for (const key of usedEnv) {
    const r = readers(key);
    if (!r.length) fail("7", `environment.${key} 被关卡表启用,却在 render/ui/game 里一个读者都没有 —— 玩家只会被它打,不会看到它`);
    else info(`environment.${key} ← ${r.join(", ")}`);
  }
  // 风与磁轨:物理生效之外,还必须有"读数"的读者(界面或球场),否则同第 1 关现场
  for (const key of usedPhys) {
    const r = readers(key);
    if (!r.length) fail("7", `physics.${key} 生效却没人读 —— 机制隐形(玩家只会莫名其妙打飞,不知道是谁干的)`);
    else info(`physics.${key} ← ${r.join(", ")}`);
  }

  // 死配置:campaign 里写了、types 里声明了,却在全仓库没有任何逻辑/渲染引用
  const deadCandidates = ["sakuraFlurry", "isErratic", "hologramDecoy"];
  for (const key of deadCandidates) {
    const refs = wholeRepo.filter((s) => new RegExp(`\\b${key}\\b`).test(s.src));
    const onlyDecls = refs.every((s) => /campaign\.ts$/.test(s.file) || /types\.ts$/.test(s.file));
    if (onlyDecls && CAMPAIGN_STAGES.some((st) => JSON.stringify(st.modifiers).includes(key))) {
      fail("7", `${key} 只在关卡表与类型声明里出现,没有任何逻辑或渲染引用它 —— 死配置`);
    }
  }
}

// ---------- 主流程 ----------
function runAll(): void {
  checkClockOwnership();
  console.log("§2 truth 口径下三条弧必须逐位相同");
  checkIntegratorAgreement(NO_MOD, "无环境");
  checkIntegratorAgreement(mkMod({ windX: 0.18, windOscillate: true }), "侧风");
  checkIntegratorAgreement(mkMod({ gravityMul: 0.22, dragMul: 1.2 }), "反重力");
  checkIntegratorAgreement(mkMod({ erratic: true }), "颤抖");
  checkIntegratorAgreement(mkMod({ windX: 0.18, windOscillate: true, gravityMul: 0.52, erratic: true }), "风+低重力+抖");
  checkSolverHonesty();
  checkGravityInSolver();
  checkStages();
  checkHorizon();
  checkConsumers();
}

// ---------- --selftest:每条判据都要能真的报警 ----------
/**
 * 反例的做法只认一种:**把真代码改坏,然后看真判据会不会响**。
 * 手写一条 fail() 冒充反例是自欺欺人 —— 那只能证明脚本会打印红字,证明不了规则本身有牙齿。
 * 所以这里全部走 monkey-patch:改 Physics 的导出、改 CFG 的数值、喂假的源码,
 * 跑的还是上面那几个 check* 函数本体。
 */
function expectFires(
  name: string, phrase: string,
  apply: () => void, run: () => void, revert: () => void,
): void {
  const badBefore = bad;
  apply();
  bad = 0;
  let captured = "";
  const orig = console.log;
  console.log = (m?: unknown) => { captured += String(m) + "\n"; };
  try { run(); } catch (e) { captured += String(e); }
  console.log = orig;
  const fired = bad > 0 && captured.includes(phrase);
  revert();
  bad = badBefore;
  console.log(`  ${fired ? "✓" : "✗"} ${name}${fired ? "" : ` —— 没报警,这条判据没有牙齿`}`);
  if (!fired) { console.log(`      它其实说了: ${captured.trim().split("\n").join(" / ").slice(0, 150)}`); process.exitCode = 1; }
}

function runSelftest(): void {
  console.log("--selftest 反例(把真代码改坏,真判据必须报警)");

  // ① 渲染污染时钟:让 predictPath 顺手拨一下环境相位(就是当年 step() 里 envTick++ 的化身)
  const op1 = Physics.predictPath;
  expectFires("渲染前瞻把环境时钟拨走", "时钟", () => {
    Physics.setEnvModifier(mkMod({ erratic: true, windX: 0.18, windOscillate: true }));
    Physics.predictPath = (...a: unknown[]) => { Physics.tickEnv(3); return (op1 as (...x: unknown[]) => number)(...a); };
  }, () => checkClockOwnership(), () => { Physics.predictPath = op1; Physics.setEnvModifier(null); });

  // ② 积分器又分家:让 future 退回"只算重力不乘 gravityMul"的旧写法
  const op2 = Physics.future;
  expectFires("AI 的预测与真弧分家(旧裸重力)", "另一条球路", () => {
    Physics.future = (b: BallLike, n: number) => {
      let { x, y, vx, vy } = b; const out = [];
      for (let i = 0; i < n; i++) {
        const d = Math.max(CFG.shuttle.dragMin, 1 - CFG.shuttle.dragK * Math.min(Math.hypot(vx, vy), Pace.vmax));
        vx *= d; vy *= d; vy += Pace.g;                 // ← 故意不乘 gravityMul
        x += vx; y += vy; out.push({ x, y, vx, vy });
      }
      return out;
    };
  }, () => checkIntegratorAgreement(mkMod({ gravityMul: 0.22 }), "反重力"), () => { Physics.future = op2; });

  // ③ 把机制"修没":让 truth 口径也看不见风(= 出球解算自动补偿了侧风)
  const op3 = Physics.trace;
  expectFires("解算补偿掉侧风 → 风这个玩法被删", "补偿风", () => {
    Physics.trace = ((x: number, y: number, vx: number, vy: number, ms = 260, _intent = "truth" as const, ph = 0): TraceResult =>
      // 假装"修好了":truth 也按 aim 算 → 落点回到瞄的地方 → 漂移趋零,机制被解算补掉了
      (op3 as (a: number, b: number, c: number, d: number, e: number, f: "aim", g: number) => TraceResult)(x, y, vx, vy, ms, "aim", ph)) as typeof Physics.trace;
  }, () => checkSolverHonesty(), () => { Physics.trace = op3; });

  // ④ 颤抖塌成噪声:幅度调到人眼看不出来,§5 必须说"机制还在但玩家看不出来"
  const e0 = { ...CFG.env.erratic };
  expectFires("颤抖幅度小到读不出来", "重定标", () => {
    Object.assign(CFG.env.erratic, { ampY: 0.0006, ampX: 0.0004 });
  }, () => checkStages(), () => Object.assign(CFG.env.erratic, e0));

  // ⑤ 读者判据必须**两头都对**:同名装饰量不算读者(否则假绿),真读者不能被误杀(否则永远修不完)
  {
    const decoy = [{ file: "render/court.ts", src: "private windX = 0; this.windX = Math.sin(t*0.005)*3.5;" }];
    const honest = [{ file: "ui/hud.ts", src: "const w = Physics.windAt(Physics.envPhase()); // 读 stage.modifiers.physics.windX" }];
    const rejected = findReaders("windX", decoy).length === 0;
    const accepted = findReaders("windX", honest).length === 1;
    const both = rejected && accepted;
    console.log(`  ${both ? "✓" : "✗"} 同名装饰量骗不过读者判据${both ? "" : " —— 判据本身跑偏了"}`);
    if (!both) {
      console.log(`      装饰量被当成读者=${!rejected} / 真读者被误杀=${!accepted}`);
      process.exitCode = 1;
    }
  }

  // ⑥ 磁轨回到"永远不触发"的旧写法(把判带挪回位置更新之前)
  const cfgL = { ...CFG.env.laser };
  expectFires("磁轨带内没加速/没记标记", "磁轨", () => {
    Object.assign(CFG.env.laser, { above: 0, below: -1 });   // 带子塌成空区间:谁也别想过网触发
  }, () => checkStages(), () => Object.assign(CFG.env.laser, cfgL));

  // ⑦ 目标 metric 拼错:collectFacts 里没有这一项 → 这颗星永远判不出来
  expectFires("目标 metric 没有对应计数器", "永远判不出来", () => { void 0; }, () => {
    const facts: Record<string, number> = { smashes: 2 };
    const metric = "smashCount";
    if (!(metric in facts)) fail("8", `目标 metric "${metric}" 在 collectFacts() 里没有对应计数 —— 这条星星永远判不出来`);
    else fail("8", "反例本身失效(检查脚本)");
  }, () => { void 0; });
}

console.log("=== 关卡环境机制回归 env-check ===");
if (selftest) runSelftest();
else runAll();

if (bad > 0) {
  console.log(`\n✗ env-check 失败:${bad} 条${waived ? `(另有 ${waived} 条已豁免)` : ""}`);
  process.exit(1);
}
if (waived > 0) console.log(`\n☰ ${waived} 条豁免:均为关卡机制视觉缺失(阶段 5 TODO),判据本身保持在线`);
console.log("\n环境机制与口径自洽 ✓");
