// 训练场喂球标定与回归(自 tools/drill-check.js 移植)。
//
// 训练关卡能不能练成,取决于「喂过来的球,在玩家够得着的接触点上,有多少比例
// 能被回成本关要求的那一拍」。这件事没法靠眼看 —— 它由 shuttle 阻力、
// loftByHeight 滞空表、classify 判据、strikeZone 半径四套参数共同决定,
// 动任何一个都可能让某一关突然练不出来或跟隔壁关串味。
//
// ⚠ 复现逻辑已经不在这里了:喂球机 / 可达接触点 / 接触点还原成一拍这三段,现在住
//   **assets/scripts/core/drill-demo.ts** —— 引导演示要用同一份真值(它演的那一拍必须
//   就是这里判的那一拍),留两份复现早晚跑偏:这份以前写 `k === 1 + jumpLead`、
//   实机 drill.ts 写 `k >= 1 + jumpLead`,两者差一帧而无人报警。
//   于是本文件只剩「网格搜索 + 打分 + 三种输出」。
//
// 边界要说清:它**不模拟玩家的跑位与起跳时机** —— 接触点只要高度够就算「可达」,
// 所以对需要跳起打的高球(重杀/点杀)偏乐观。它是「别让一次物理调参把某关
// 变成不可能」的常驻断言,不是难度评估器;真实可打性还得进游戏打两拍。
//
// 用法(先在 tools/ 下 tsc 编译,见 tsconfig.json):
//   node .tools-build/tools/drill-check.js          断言六关当前配置是否自洽(改物理后必跑)
//   node .tools-build/tools/drill-check.js --pick   为每关在网格里搜最佳喂球参数
//   node .tools-build/tools/drill-check.js --sweep  打印整张网格,人工看趋势
import { CFG, DRILLS } from "../assets/scripts/core/config";
import { DrillDemo } from "../assets/scripts/core/drill-demo";
import type { ContactPoint } from "../assets/scripts/core/drill-demo";
import { Drill } from "../assets/scripts/core/drill";
import type { DrillDef } from "../assets/scripts/core/types";

const C = CFG;
const CO = C.court;
const { simulateFeed, standingTop, apexReach, shotAt, eventAt, QS } = DrillDemo;

interface ScoreResult {
  rate: number; hit: number; n: number; kinds: Record<string, number>; pts: number; jumpy: number;
  feedDeg: number; feedSpeed: number; feedH: number; hang: number; landX: number;
}

/**
 * ②③④ 沿这条喂球弧线的每个可达接触点扫遍命中窗质量,直接调游戏里那条判据打分
 */
function score(def: DrillDef, depth: number, jumpLead: number, aim: string): ScoreResult | null {
  const feed = simulateFeed(depth, jumpLead);
  if (!feed) return null;
  const pts = feed.contacts;
  if (!pts.length) return null;
  const A = aim === "near" ? C.aimDepth.near : C.aimDepth.deep;
  let n = 0, hit = 0;
  const kinds: Record<string, number> = {};
  for (const pt of pts) {
    for (const q of QS) {
      const s = shotAt(pt, A, q);
      n++;
      kinds[s.kind] = (kinds[s.kind] || 0) + 1;
      if (Drill.matches(def, eventAt(pt, s, q))) hit++;
    }
  }
  const jumpy = pts.filter((p: ContactPoint) => p.needJump).length / pts.length;
  return {
    rate: 100 * hit / n, hit, n, kinds, pts: pts.length, jumpy,
    feedDeg: feed.shot.deg, feedSpeed: feed.shot.speed,
    feedH: feed.released.h, hang: feed.shot.trace.steps, landX: feed.shot.trace.landX,
  };
}

// 别的关在这一格喂球下能拿多少分:用来抓「练 A 关却把 B 关也练了」的串味
function rivals(def: DrillDef): { id: string; rate: number } {
  let best = { id: "-", rate: 0 };
  for (const o of DRILLS) {
    if (o.id === def.id) continue;
    const r = score(o, def.feed.depth, def.feed.jumpLead, def.wantKey);
    if (r && r.rate > best.rate) best = { id: o.id, rate: r.rate };
  }
  return best;
}

const DEPTHS = [0.05, 0.12, 0.2, 0.3, 0.42, 0.55, 0.7, 0.85, 0.95];
const LEADS = [0, 4, 8, 11, 14, 17, 19];
const AIMS = ["far", "near"];

// ============================================================
// 三种输出
// ============================================================
if (process.argv.includes("--sweep")) {
  console.log(`跳起额外够到 ${apexReach().toFixed(0)}px · 慢球站立上限 ${standingTop(4).toFixed(0)}px · 快球 ${standingTop(24).toFixed(0)}px\n`);
  for (const lead of LEADS) {
    console.log(`=== jumpLead=${lead} ===`);
    for (const d of DEPTHS) {
      const feed = simulateFeed(d, lead);
      if (!feed) { console.log(`  d=${d.toFixed(2)}  下网`); continue; }
      const pts = feed.contacts;
      const row = AIMS.map((aim) => {
        const A = aim === "near" ? C.aimDepth.near : C.aimDepth.deep;
        const kinds: Record<string, number> = {}; let n = 0;
        for (const pt of pts) for (const q of QS) { const s = shotAt(pt, A, q); kinds[s.kind] = (kinds[s.kind] || 0) + 1; n++; }
        const top = Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 3)
          .filter(([, v]) => v / n > 0.03).map(([k, v]) => `${k} ${Math.round(100 * v / n)}%`).join("/");
        return `${aim}: ${top}`;
      }).join("   |   ");
      console.log(`  d=${d.toFixed(2)} 喂θ=${feed.shot.deg.toFixed(0)}° v=${feed.shot.speed.toFixed(1)} 滞空=${feed.shot.trace.steps} 接触高=${feed.released.h.toFixed(0)} 点=${pts.length}  ${row}`);
    }
  }
  process.exit(0);
}

if (process.argv.includes("--pick")) {
  console.log("每关在自己的球种判据下搜最佳喂球格(depth × jumpLead × aim)\n");
  for (const def of DRILLS) {
    const scored: Array<{ d: number; lead: number; aim: string; rate: number; jumpy: number; hang: number; feedH: number }> = [];
    for (const lead of LEADS) for (const d of DEPTHS) for (const aim of AIMS) {
      const r = score(def, d, lead, aim);
      if (r) scored.push({ d, lead, aim, rate: r.rate, jumpy: r.jumpy, hang: r.hang, feedH: r.feedH });
    }
    scored.sort((a, b) => b.rate - a.rate);
    console.log(`--- ${def.id} (${def.want.join("/")}) 当前 d=${def.feed.depth} lead=${def.feed.jumpLead} aim=${def.wantKey}`);
    for (const g of scored.slice(0, 4)) {
      console.log(`    d=${String(g.d).padStart(4)} lead=${String(g.lead).padStart(2)} ${g.aim.padEnd(4)} 达成率=${g.rate.toFixed(0)}%`
        + `  需跳着打=${(100 * g.jumpy).toFixed(0)}%  滞空=${g.hang} 接触高=${g.feedH.toFixed(0)}`);
    }
  }
  process.exit(0);
}

const MIN_RATE = 8;   // 达成率下限:低于这个数,这一关要试很多次才凑得满 3 拍
let bad = 0;
console.log("训练场六关自检(达成率 = 够得着的接触点里,能判成本关有效拍的比例)\n");
for (const def of DRILLS) {
  const { depth, jumpLead } = def.feed, aim = def.wantKey;
  const r = score(def, depth, jumpLead, aim);
  if (!r) { console.log(`✗ ${def.id.padEnd(9)} 喂球 d=${depth} lead=${jumpLead} 下网或够不着`); bad++; continue; }
  const riv = rivals(def);
  const top = Object.entries(r.kinds).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${Math.round(100 * v / r.n)}`).join(" ");
  const ok = r.rate >= MIN_RATE && riv.rate < r.rate;
  if (!ok) bad++;
  console.log(`${ok ? "✓" : "✗"} ${def.id.padEnd(9)} ${aim.padEnd(4)} d=${String(depth).padStart(4)} lead=${String(jumpLead).padStart(2)}`
    + ` 达成率=${r.rate.toFixed(0)}%(需≥${MIN_RATE})  喂θ=${r.feedDeg.toFixed(0)}° 滞空=${String(r.hang).padStart(3)}`
    + ` 接触高=${r.feedH.toFixed(0)} 需跳=${(100 * r.jumpy).toFixed(0)}%`
    + `\n           球种分布 ${top}   最易串味: ${riv.id}=${riv.rate.toFixed(0)}%${riv.rate >= r.rate ? " ← 比本关还高" : ""}`);
}
console.log(bad ? `\n${bad} 关需要重新标定:node .tools-build/tools/drill-check.js --pick` : "\n六关全部自洽");
process.exit(bad ? 1 : 0);
