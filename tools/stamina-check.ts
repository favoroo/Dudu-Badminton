// ============================================================
// AI 体力账本回归 —— 防的是用户报的那个现场:
// 「我一发球这个体力条就掉了……我发球他掉一下,他接球又掉一下」。
//
// 根因:旧 pressure 是 rally 拍数的纯函数,而**发球本身也走 applyShot → rally++**,
// 于是数拍子的曲线等于玩家一发球对面就掉血;再加上五格量化,「在消耗」这件事
// 要么看不见、要么看得莫名其妙。现在的模型是按动作记账(ai.ts staminaCost):
// AI 每一次真实击中按「这一拍有多费力」扣一笔,发球天然不掉(拿不到起手快照)。
// 2026-10-02 又一轮现场:「我普通的发球 AI 接球也会掉体力」「随便什么接球就掉一大管」——
// 根因是 base 5 让**每一次击中**都固定扣、runFree 40 太低(小碎步也收费)。重标为
// 常规拍免费(base 0 + runFree 70),血条只在费力动作上动,极费力的回合才见底(温和档)。
//
// ai-check 的真人替身从不杀球(实测来球 smash 0.1%、airborne 0%),所以
// 「重杀才掉、轻松回气」这条**任何整局模拟都验不到** —— 牙齿只能是把
// staminaCost 当纯函数打表。断言六组:
//   ① 单调序:软球回气 < 站定回球 < 接劈吊 < 大跑位 < 自己跳杀 < 跨步接重杀
//   ② 发球零成本:noteHit 在没有起手快照时(= 发球/挥空)must 不动 fatigue
//   ②.5 接发:来球力量费(powK)免,run 照扣(站定接发 0,大跑位接发仍扣)
//   ③ 直觉钉子:常规拍免费(站定接普通球 = 0)/ 15 拍 4 次跨步大跑位 ≥50% 且 <90%(大汗不见底)
//     / 14 拍全程被拉开 ≥90%(极费力才见底)/ 8 拍普通对拉 ≤10% / 连续软球严格回气
//   ④ 边界:单拍成本夹在 [minBeat,maxBeat]、fatigue 夹在 [0,capacity]
//   ⑤ 归一化契约:pressure = fatigue/capacity × crush(三处展示端都靠它反推血条)
//   ⑥ 表自洽:base=0(常规拍免费是设计决策)、give<0、capacity>maxBeat、softGate/crush 闸门在位
// --selftest 喂旧 rally/20 那套当反例:它**必须**被②(发球即掉血)拦下。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json && node .tools-build/tools/stamina-check.js
//   node .tools-build/tools/stamina-check.js --selftest
// ============================================================
import { makeChecker } from "./harness";
import { CFG } from "../assets/scripts/core/config";
import { AI } from "../assets/scripts/core/ai";
import { AiState, HitCostInput, Player, ShotKind } from "../assets/scripts/core/types";

const h = makeChecker({});
const ok = (cond: boolean, msg: string): void => h.ok(cond, msg);

const A = CFG.aiStamina;

/** 一拍输入的快捷拼法:没写的字段 = 最普通的站定回球(drive 无附加费,run/power 都在免费档内) */
const hit = (ov: Partial<HitCostInput> = {}): HitCostInput => ({
  run: A.runFree, power: A.powFree, recvKind: "drive",
  lunge: false, air: false, jumpSmash: false, skill: false, ownSmash: false,
  ...ov,
});
const cost = (ov: Partial<HitCostInput> = {}): number => AI.staminaCost(hit(ov));

// noteHit 走真入口(验「发球零成本」这条链路,而不是只验纯函数):
// 只塞 noteHit 读得到的字段,其余 cast 掉 —— 工具侧的窄桩,别学进 core。
const stubPlayer = (recvNoted: boolean): Player =>
  ({
    aiDiff: "normal",
    ai: { recvNoted, recvKind: "drive" as ShotKind, recvRun: 120, recvPower: 24, fatigue: 0, pressure: 0 },
  }) as unknown as Player;
const stubShot = { kind: "drive", lungeShot: false, airborne: false, jumpSmash: false, skillKind: null } as unknown as Parameters<typeof AI.noteHit>[1];
const fatigueAfter = (recvNoted: boolean, hits: number): number => {
  const p = stubPlayer(recvNoted);
  for (let i = 0; i < hits; i++) AI.noteHit(p, stubShot);
  return p.ai!.fatigue;
};

// ---------- ① 单调序:越狼狈越贵,软球是唯一的负数 ----------
const ladder: Array<[string, number]> = [
  ["慢软球+没跑(回气)", cost({ recvKind: "lob", run: 30 })],
  ["站定回球", cost({})],
  ["接劈吊", cost({ recvKind: "slash" })],
  ["大跑位(run 200)", cost({ run: 200 })],
  ["自己跳杀", cost({ air: true, jumpSmash: true, ownSmash: true })],
  ["跨步接重杀", cost({ lunge: true, recvKind: "smash", run: 150 })],
];
for (let i = 1; i < ladder.length; i++) {
  ok(ladder[i][1] > ladder[i - 1][1], `单调:${ladder[i][0]}(${ladder[i][1].toFixed(1)}) > ${ladder[i - 1][0]}(${ladder[i - 1][1].toFixed(1)})`);
}
ok(cost({ recvKind: "lob", run: 30 }) < 0, `轻松拍是负成本(回气 ${cost({ recvKind: "lob", run: 30 })})`);
ok(cost({ recvKind: "lob", run: 30 }) >= A.minBeat, `回气不越过下限 ${A.minBeat}`);
// 来球多重是连续的第二维:同一站位,球越重越贵 —— 「被打得狠才掉」的主力载体
ok(cost({ power: A.powFree + 15 }) > cost({ power: A.powFree }), `来球更重扣得更多(+${(cost({ power: A.powFree + 15 }) - cost({ power: A.powFree })).toFixed(1)})`);
ok(cost({ power: A.powFree }) === cost({}), `力度在免费档内不加钱(powFree ${A.powFree})`);

// ---------- ② 发球零成本:没有起手快照就不许扣 ----------
ok(fatigueAfter(false, 5) === 0, "发球/挥空(无起手快照)连打 5 拍,fatigue 全程为 0");
ok(fatigueAfter(true, 5) > 0, "同一串输入带上快照就正常扣账(链路本身是通的)");

// ---------- ②.5 接发:来球力量费(powK)免,run 照扣 ----------
// 用户现场:「第一次发球他接球为什么会掉体力啊,太蠢了」—— 发球 power 普遍 > powFree,
// 站定接也被 powK 扣一笔。接发的"来球重"不算消耗(开局仪式),但"跑了多远"照算。
// 站定接发(run ≤ runFree)= 0;大跑位接发仍扣 run 部分(合理:跑大跑位该掉血)。
ok(cost({ isServeReturn: true }) === 0, "站定接发零成本(run ≤ runFree,powK 免)");
ok(cost({ isServeReturn: true, run: 250 }) > 0, "大跑位接发仍扣 run 部分(开局仪式只免来球重,不免跑动)");
// 非接发要给 power > powFree 才看得出 powK 那一项;默认 hit() 的 power=powFree 在免费档内
ok(cost({ isServeReturn: true, run: 250, power: A.powFree + 10 }) < cost({ run: 250, power: A.powFree + 10 }),
  `接发比非接发省 powK 部分(同 run=250 power=28:接发 ${cost({ isServeReturn: true, run: 250, power: A.powFree + 10 })} < 非接发 ${cost({ run: 250, power: A.powFree + 10 })})`);

// ---------- ③ 直觉钉子:把「设计者脑中的手感」钉成数字 ----------
/** 连打 n 拍同一输入后的 fatigue */
const grind = (ov: Partial<HitCostInput>, n: number, from = 0): number => {
  let f = from;
  const c = cost(ov);
  for (let i = 0; i < n; i++) f = Math.max(0, Math.min(A.capacity, f + c));
  return f;
};
// 常规拍免费:站定接普通球(含普通接发)零成本 —— 用户现场「发球他接球也掉」的解药
ok(cost({}) === 0, `站定接普通球零成本(${cost({})}:base 0,run/power 都在免费档)`);
// 15 拍回合、其中 4 次跨步大跑位救球 → 大汗淋漓但不见底(温和档:≥50% 且 <90%)
const desperate = grind({ lunge: true, run: 180 }, 4) + grind({}, 11);
ok(desperate >= A.capacity * 0.5 && desperate < A.capacity * 0.9,
  `15 拍含 4 次跨步救球 → ${desperate.toFixed(0)}/${A.capacity}(≥50% 且 <90%,大汗不见底)`);
// 14 拍全程被拉开(run 250 × 10 + 4 跨步)→ 见底(极费力的回合才见底的口径)
const stretched = grind({ run: 250 }, 10) + grind({ lunge: true, run: 250 }, 4);
ok(stretched >= A.capacity * 0.9, `14 拍全程被拉开 → ${stretched.toFixed(0)}/${A.capacity}(≥90%,见底)`);
// 8 拍普通对拉 → 血条几乎不动(常规拍免费;掉过 10% = 又回到「数拍子」的老路)
const calm = grind({}, 8);
ok(calm <= A.capacity * 0.10, `8 拍普通对拉 → ${calm.toFixed(0)}/${A.capacity}(≤10%,常规拍免费)`);
// 连续轻松拍要看得见回升:先压到半条,再喂 4 拍软球,必须一拍比一拍少
let rec = A.capacity * 0.5;
const seq: number[] = [];
for (let i = 0; i < 4; i++) {
  rec = Math.max(0, Math.min(A.capacity, rec + AI.staminaCost(hit({ recvKind: "lob", run: 30 }))));
  seq.push(rec);
}
ok(seq.every((v, i) => i === 0 || v < seq[i - 1]), `连续 4 拍软球严格回气(${seq.map((v) => v.toFixed(0)).join(" → ")})`);

// ---------- ④ 边界:夹取不许漏 ----------
const extremes: Partial<HitCostInput>[] = [
  { run: 9999, power: 999, lunge: true, air: true, jumpSmash: true, skill: true, ownSmash: true, recvKind: "smash" },
  { run: 0, power: 0, recvKind: null },
  { run: -50, power: -5, recvKind: "lob" },
];
for (const x of extremes) {
  const c = cost(x);
  ok(c >= A.minBeat && c <= A.maxBeat, `极端输入的成本被夹住(${c.toFixed(1)} ∈ [${A.minBeat},${A.maxBeat}])`);
}
ok(A.capacity > A.maxBeat, `capacity(${A.capacity}) > maxBeat(${A.maxBeat}):最狼狈的一拍也不该一拍清空`);
// 敲 200 拍最贵的球,fatigue 也不许越界
const hammered = grind({ lunge: true, air: true, jumpSmash: true, skill: true, ownSmash: true, recvKind: "smash", run: 999 }, 200);
ok(hammered >= 0 && hammered <= A.capacity, `200 拍极限敲打后 fatigue 仍在界内(${hammered.toFixed(1)})`);

// ---------- ⑤ 归一化契约:pressure = fatigue/capacity × crush ----------
// hud / game-root 三处展示端都拿 `1 - pressure/crush` 反推血条;这条公式被谁
// "顺手简化"了,三档的血条就会一起失真 —— 在账本这一侧钉死它。
for (const key of ["easy", "normal", "hard"] as const) {
  const tier = CFG.diffs[key];
  for (const fatigue of [0, A.capacity * 0.3, A.capacity * 0.77, A.capacity]) {
    const S = { fatigue, pressure: 0 } as unknown as AiState;
    const p = AI.pressureOf(tier, S);
    ok(Math.abs(p - Math.min(1, fatigue / A.capacity) * tier.crush) < 1e-9,
      `${key}: fatigue ${fatigue.toFixed(0)} → pressure ${p.toFixed(3)}(= fatigue/capacity × crush ${tier.crush})`);
  }
}
// 档位语义:crush 决定「同样累,多快漏」,softGate 只管回气 —— 两把闸门都得在
ok(CFG.diffs.easy.softGate === 0 && CFG.diffs.normal.softGate === 1 && CFG.diffs.hard.softGate === 1,
  "softGate:easy 不回气(新手 80% 回球是软球,一路回血会把正反馈抹掉)");
ok(CFG.diffs.easy.crush > 0 && CFG.diffs.hard.crush > 0, "crush 三档都 >0(=0 的档位血条永远满格,等于没做)");

// ---------- ⑥ 表自洽 ----------
ok(A.base === 0, `base(${A.base})必须为 0:常规拍免费是设计决策(接发/对拉不掉血),别改回去`);
ok(A.give < 0, "give 必须是负数(回气写在符号里,不另立分支)");
ok(A.capacity > A.maxBeat, `capacity(${A.capacity}) > maxBeat(${A.maxBeat})`);
ok(A.runK > 0 && A.powK > 0, "两个连续项系数都是正的");
ok(A.softRun > A.runFree * 0.5, `softRun(${A.softRun})不应被砍到比免费档还小,否则「轻松拍」永不触发`);
ok(CFG.aiPressure.cueFloor > 0 && CFG.aiPressure.cueFloor < 1, `cueFloor(${CFG.aiPressure.cueFloor})在 (0,1) 内:力竭大演出要吃行为侧闸门`);

// ---------- 反例自检:旧 rally/20 曲线必须被拦下 ----------
if (process.argv.includes("--selftest")) {
  console.log("\n反例自检(每一条都必须被报警)\n");
  // 旧模型:pressure = rally/20,发球 = rally 1 → 第一拍就 +5。
  // 它最要命的不是斜率,是「发球掉血」这条语义 —— 正是用户现场。
  const oldBeat = (rallyBefore: number, rallyAfter: number): number => (rallyAfter / 20 - rallyBefore / 20) * 100;
  ok(oldBeat(0, 1) > 0, `旧曲线发球这一拍就扣 ${oldBeat(0, 1).toFixed(0)}(> 0,被②的发球零成本判据拦下)`);
  ok(oldBeat(1, 2) > 0, `旧曲线 AI 站着接发也扣 ${oldBeat(1, 2).toFixed(0)}(用户现场:他接球又掉一下)`);
  // 旧五格量化:掉血只能是 20% 的整数倍 —— 「打很久才掉一格」的根因
  const oldLit = (fatigue: number): number => Math.ceil((1 - fatigue / 100) * 5);
  ok(oldLit(0) === oldLit(19), `旧量化:fatigue 0 和 19 显示同一格(${oldLit(0)} 格),19% 的消耗完全不可见`);
}

console.log(`\n${h.fails === 0 ? "✓" : "✗"} ${h.checks} 项断言,失败 ${h.fails}`);
console.log("只有真机能验的:肉眼读「发球不掉/重杀掉一截/软球回升」的观感(preview + 真机)。");
process.exit(h.fails === 0 ? 0 : 1);
