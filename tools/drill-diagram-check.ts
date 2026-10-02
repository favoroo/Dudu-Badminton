// ============================================================
// 训练场引导演示的**真值闸门**:钉住「演示画的就是判据认的那一拍」。
//
// 为什么要有这条 —— 引导动画曾经自己编一套弹道:来球是一条手画的假抛物线(每关硬写
// 一个 arcLift),回球用随手取的 q=0.72 从演示专用的坐标起算,**从没穿过 Drill.matches**。
// 于是玩家看完演示照做,游戏里那一拍不算 —— 报「太简陋,看完不知道怎么做」的根子在此。
// 现在弹道由 core/drill-demo.ts 沿真实喂球弧线烘出来,这份脚本逐关断言它确实是一记合格拍:
//   ① bake 存在(喂球没下网、弧线上有够得着的接触点)
//   ② passes:理想回球过本关判据 Drill.matches
//   ③ 来球弧线的起点就是喂球机手上那一点(不是画出来的一条弯)
//   ④ 接触点在判定圈里(站得住才能够得到 —— 教的站位是真解)
//   ⑤ 理想落点落在画给玩家看的那条目标带里(带子与判据同一来源)
//   ⑥ 错误对照(另一个滑向)必须**不**过判据,否则宁可不画也别演假的
//   ⑦ 六关的分步文案齐活且放得下(文案缺失就等于回到四句通用话)
//
// --selftest 喂**改动前的真实旧写法**(假抛物线 + q=0.72 那一版)当反例,必须全被拦下:
// 规则脚本最怕的是红了却没人看,所以反例比正例更要紧。
//
// 用法(先 npx tsc -p tools/tsconfig.json 编译):
//   node .tools-build/tools/drill-diagram-check.js          正题
//   node .tools-build/tools/drill-diagram-check.js --selftest   反例必须变红
//   node .tools-build/tools/drill-diagram-check.js --dump   摊开六关烘焙结果(改文案/调参时看)
// ============================================================
import { CFG, DRILLS } from "../assets/scripts/core/config";
import { DrillDemo } from "../assets/scripts/core/drill-demo";
import type { DemoBake } from "../assets/scripts/core/drill-demo";
import { Physics } from "../assets/scripts/core/physics";
import { Drill } from "../assets/scripts/core/drill";
import type { DrillDef } from "../assets/scripts/core/types";

const C = CFG;
const CO = C.court;
const selftest = process.argv.includes("--selftest");
const dump = process.argv.includes("--dump");
/** 定格讲解的步数(与 render/drill-anim 的 DEMO_STEPS 同值;那边 import cc,这里不能反向引用) */
const STEPS = 4;

let bad = 0;
const ok = (cond: boolean, msg: string): void => {
  if (!cond) bad++;
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
};

// ---------- 单关断言(判据写成函数,反例才能喂同一把尺子) ----------
export function checkBake(def: DrillDef, b: DemoBake | null): string[] {
  const out: string[] = [];
  if (!b) { out.push(`${def.id}: 烘不出演示真值(喂球下网或弧线上没有够得着的接触点)`); return out; }
  const D = C.drill.demo;

  if (!b.passes) out.push(`${def.id}: 演示里那一拍不过本关判据 —— 教了一套、判了另一套`);

  // ③ 来球弧线必须与实机喂球模拟**逐点**吻合。
  //    这是全套断言里最要紧的一条:旧版画的是 idealInPath 那条手编抛物线,
  //    形状自洽、起点也自洽,只有拿真喂球复现来比才露馅 —— 而「照演示做却接不到球」正是它害的。
  const truth = DrillDemo.simulateFeed(def.feed.depth, def.feed.jumpLead);
  if (!truth) out.push(`${def.id}: 这一关的喂球参数现在下网,演示无从演起(去 drill-check --pick 重标)`);
  else {
    const n = Math.min(b.inbound.pts.length, truth.pts.length);
    let dev = 0;
    for (let i = 0; i < n; i++) {
      dev = Math.max(dev, Math.abs(b.inbound.pts[i].x - truth.pts[i].x), Math.abs(b.inbound.pts[i].y - truth.pts[i].y));
    }
    if (n < 8 || dev > 1) out.push(`${def.id}: 来球弧线与实机喂球差 ${dev.toFixed(1)}px(点数 ${n})—— 画的是假弧线`);
    const f0 = b.inbound.pts[0];
    if (!f0 || Math.hypot(f0.x - truth.released.x, f0.y - truth.released.y) > 1) {
      out.push(`${def.id}: 来球不是从喂球机手上那一点起的`);
    }
  }
  if (b.ret.pts.length < 8) out.push(`${def.id}: 理想回球没有弧(${b.ret.pts.length} 点)—— 画不出「这一拍飞去哪儿」`);

  const d = Math.hypot(b.contact.x - b.strike.x, b.contact.y - b.strike.y);
  if (d > b.strike.r + 0.5) out.push(`${def.id}: 接触点在判定圈外 ${d.toFixed(1)} > r=${b.strike.r.toFixed(1)} —— 那个站位根本够不着`);
  if (b.stand.jumpH > b.stand.apexH + 0.5) {
    out.push(`${def.id}: 教的站位要跳 ${b.stand.jumpH.toFixed(0)}px,而跳跃顶点只有 ${b.stand.apexH.toFixed(0)}px —— 把小人画成飘在半空`);
  }
  if (b.ret.landX < b.zone.x1 - 0.5 || b.ret.landX > b.zone.x2 + 0.5) {
    out.push(`${def.id}: 理想落点 ${b.ret.landX.toFixed(0)} 不在画给玩家的目标带 [${b.zone.x1.toFixed(0)}, ${b.zone.x2.toFixed(0)}] 里`);
  }
  if (b.alt) {
    const passes = Drill.matches(def, {
      lastHitter: "left", crossed: true, netted: false, scorer: "left", kind: b.alt.kind as never, q: b.alt.q,
      sweet: false, perfect: false,
      shot: { depth: b.alt.depth, landX: b.alt.landX, steps: b.alt.steps, deg: 0, contactH: b.alt.contactH },
    });
    if (passes) out.push(`${def.id}: 错误对照那一拍其实算有效拍 —— 别演「按错」的鬼影,宁可不画`);
    if (!b.alt.verdict) out.push(`${def.id}: 鬼影没带「错在哪」那句话,玩家看见第二条弧线只会更糊涂`);
  }
  // ⑦ 分步文案:数量与键名齐活即可。**折行/宽度不在这里量** ——
  //    那把尺子在 ui/drill-layout 的 drillOverflow 里(它才知道卡有多宽),这里抄一份必然跑偏。
  if (!def.demoSteps || def.demoSteps.length !== STEPS) {
    out.push(`${def.id}: demoSteps 要正好 ${STEPS} 条(与定格节拍一一对应),实得 ${def.demoSteps ? def.demoSteps.length : 0}`);
  }
  if (!def.zoneName) out.push(`${def.id}: 少了 zoneName —— 场上那条带子没名字,玩家不知道球该落在哪一带`);
  return out;
}

// ---------- 旧写法反例:假抛物线 + q=0.72 + 演示专用坐标(0.0.20 及以前的真实算法) ----------
function legacyBake(def: DrillDef): DemoBake | null {
  // 旧 idealInPath:起点是拍出来的 feederX/feederY,弧线是 u*(1-u) 的假抛物线
  const feederX = Math.min(CO.right - 60, CO.netX + 175);
  const feederY = CO.groundY - (def.feed.jumpLead > 0 ? 110 : 70);
  const contactX = def.id === "smash" ? 300 : 262;
  const demoH = def.id === "smash" ? 150 : 122;
  const contactY = CO.groundY - demoH;
  let arcLift = 60;
  if (def.id === "smash" || def.id === "slash") arcLift = 105;
  else if (def.id === "clear") arcLift = 70;
  const apexY = Math.min(feederY, contactY) - arcLift;
  const N = 32;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const x = feederX + (contactX - feederX) * u;
    const y = feederY + (contactY - feederY) * u + (apexY - Math.min(feederY, contactY)) * 4 * u * (1 - u);
    pts.push({ x, y });
  }
  // 旧 idealPath:q 写死 0.72,落点从不校验
  const depth = def.wantKey === "near" ? C.aimDepth.near : C.aimDepth.deep;
  const q = 0.72;
  const loft = Physics.loftFor(depth, demoH, q);
  const s = Physics.solveShot(contactX, contactY, 1, depth, loft, 0);
  const rad = Physics.reachRadius({ vx: s.speed, vy: 0 });
  return {
    def,
    inbound: { pts, landX: s.trace.landX, kind: "feed", hitNet: false, feederX, feederY, hangFrames: N },
    contact: { x: contactX, y: contactY, h: demoH, speed: 6, frame: N, needJump: !!def.pose?.jump },
    strike: { x: contactX, y: contactY, r: rad * 0.92 + C.swing.headR },
    stand: { x: contactX, jumpH: 0, apexH: 87, needJump: false, rad },
    ret: {
      pts: [], landX: s.trace.landX, kind: s.kind, hitNet: s.trace.hitNet,
      q, depth: s.depth, steps: s.trace.steps, contactH: demoH,
    },
    alt: null,
    zone: { x1: CO.netX + 80, x2: CO.right - 45, label: "下压得分区" },
    keyName: def.wantKey === "near" ? "左滑" : "右滑",
    passes: Drill.matches(def, {
      lastHitter: "left", crossed: true, netted: false, scorer: "left", kind: s.kind as never, q,
      sweet: false, perfect: false,
      shot: { depth: s.depth, landX: s.trace.landX, steps: s.trace.steps, deg: s.deg, contactH: demoH },
    }),
  };
}

if (selftest) {
  console.log("反例(旧写法的真实算法):每一条都必须被同一把尺子拦下\n");
  for (const def of DRILLS) {
    const legacy = legacyBake(def)!;
    // 反例故意留着 demoSteps(文案本身是新加的),让失败点落在弹道与落点上
    const msgs = checkBake({ ...def, demoSteps: def.demoSteps, zoneName: def.zoneName }, legacy);
    ok(msgs.length > 0, `${def.id}: 旧假弹道被拦下${msgs.length ? ` —— ${msgs[0]}` : " ← 没拦住,这把尺子没牙齿"}`);
  }
  // 缺文案的反例
  const noSteps = checkBake({ ...DRILLS[0], demoSteps: undefined, zoneName: undefined }, DrillDemo.bake(DRILLS[0]));
  ok(noSteps.some((m) => m.includes("demoSteps")) && noSteps.some((m) => m.includes("zoneName")),
    `旧六关共用的四句通用话(没有逐关文案)被拦下 —— ${noSteps[0] || "没拦住"}`);
  // 落点带算歪的反例
  const b0 = DrillDemo.bake(DRILLS[0]);
  if (b0) {
    const skewed = checkBake(DRILLS[0], { ...b0, ret: { ...b0.ret, landX: CO.left + 10 } });
    ok(skewed.some((m) => m.includes("目标带")), "理想落点跑到球场上被拦下");
    const outside = checkBake(DRILLS[0], { ...b0, contact: { ...b0.contact, x: b0.strike.x + b0.strike.r * 3 } });
    ok(outside.some((m) => m.includes("判定圈")), "接触点在判定圈外被拦下");
    const wrongKey = checkBake(DRILLS[0], { ...b0, alt: { ...b0.ret, verdict: "打成了高远" } });
    ok(wrongKey.some((m) => m.includes("错误对照")), "把有效拍演成「按错的球」被拦下");
  }
  process.exit(bad ? 1 : 0);
}

if (dump) {
  console.log("六关演示烘焙结果(改判据/文案后照这张表核)\n");
  for (const def of DRILLS) {
    const b = DrillDemo.bake(def);
    if (!b) { console.log(`✗ ${def.id.padEnd(9)} 烘不出来`); continue; }
    console.log(`--- ${def.id} ${def.label} · ${def.want.join("/")} · ${b.keyName}`);
    console.log(`    喂球手点 ${b.inbound.feederX.toFixed(0)},${b.inbound.feederY.toFixed(0)} → 接触 ${b.contact.x.toFixed(0)},${b.contact.y.toFixed(0)}`
      + ` (离地 ${b.contact.h.toFixed(0)} · 第 ${b.contact.frame} 帧 · 球速 ${b.contact.speed.toFixed(1)}${b.contact.needJump ? " · 必须起跳" : " · 站着能到"})`);
    console.log(`    站位 x=${b.stand.x.toFixed(0)} 跳高=${b.stand.jumpH.toFixed(0)} 判定圈 r=${b.strike.r.toFixed(0)}`);
    console.log(`    回球 ${b.ret.kind} q=${b.ret.q} depth=${b.ret.depth.toFixed(2)} 滞空=${b.ret.steps} 落点=${b.ret.landX.toFixed(0)}`
      + ` 带=[${b.zone.x1.toFixed(0)},${b.zone.x2.toFixed(0)}] ${b.zone.label}${b.passes ? " ✓过判据" : " ✗不过判据"}`);
    console.log(`    错误对照:${b.alt ? `${b.alt.kind} → ${b.alt.verdict}(落点 ${b.alt.landX.toFixed(0)})` : "无(另一滑向其实也算,不演鬼影)"}`);
  }
  process.exit(0);
}

console.log("训练场引导演示真值:演示画的就是判据认的那一拍\n");
for (const def of DRILLS) {
  const b = DrillDemo.bake(def);
  const msgs = checkBake(def, b);
  for (const m of msgs) ok(false, m);
  ok(msgs.length === 0, `${def.id.padEnd(9)} ${b ? `${b.ret.kind} 落点 ${b.ret.landX.toFixed(0)} 带 ${b.zone.x1.toFixed(0)}..${b.zone.x2.toFixed(0)} · ${def.demoSteps?.length ?? 0} 步文案` : "无烘焙结果"}`);
}
console.log(bad ? `\n${bad} 处问题:引导演示与实机判据已经跑偏。` : "\n六关演示真值自洽:来球/接触点/回球/落点带全部来自实机同一条判据。");
process.exit(bad ? 1 : 0);
