// 训练场喂球标定与回归(自 tools/drill-check.js 移植)。
//
// 训练关卡能不能练成,取决于「喂过来的球,在玩家够得着的接触点上,有多少比例
// 能被回成本关要求的那一拍」。这件事没法靠眼看 —— 它由 shuttle 阻力、
// loftByHeight 滞空表、classify 判据、strikeZone 半径四套参数共同决定,
// 动任何一个都可能让某一关突然练不出来或跟隔壁关串味。
//
// 所以这里:① 忠实复现 rules 的持球释放(含起跳那几帧的接触高度递推)
//          ② 沿喂球弧线枚举左半场所有「够得着」的接触点
//          ③ 对每个接触点扫遍命中窗质量 q,把这一拍还原成 rules 会抛出的事件
//          ④ 直接调游戏里的同一条判据 Drill.matches 打分
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
import { Physics } from "../assets/scripts/core/physics";
import { Player as Pl } from "../assets/scripts/core/player";
import { Drill, DrillEndFact } from "../assets/scripts/core/drill";
import { Ball, DrillDef, Player } from "../assets/scripts/core/types";

const C = CFG;
const CO = C.court;

// ============================================================
// ① 喂球机:复现 rules.step 里 ball.held 那一段
// ============================================================
// 持球点贴手(handX = p.x + facing*24,handY = p.y - h*0.46),挥拍进窗那一帧释放。
// 「第几帧出球」因此直接决定喂球的高度 —— 这就是每个关卡 feed.jumpLead 的含义。
function handX(p: { x: number; facing: number }): number { return p.x + p.facing * 24; }
function handY(p: { x: number; y: number; facing: number }): number { return p.y - C.player.h * 0.46; }

interface Released { x: number; y: number; h: number; frame: number }

function makeLoneBall(owner: Player): Ball {
  return {
    x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0,
    live: false, held: true, owner,
    lastHitter: "right", crossed: false, netted: false, shot: null,
    sq: 1, sqPrev: 1,
  };
}

function simulateFeed(depth: number, jumpLead: number): { released: Released; shot: ReturnType<typeof Physics.solveShot> } | null {
  const feeder = Pl.create("right", { isAI: true });
  const ball = makeLoneBall(feeder);
  let t = 0, released: Released | null = null, guard = 0;
  const aim = depth;

  while (guard++ < 600 && !released) {
    t++;
    const inp = { left: false, right: false, jumpPressed: false, jumpHeld: false, swingAim: null as string | number | null, lungePressed: false };
    const dx = feeder.homeX - feeder.x;
    if (Math.abs(dx) > 8) {
      inp.left = dx < 0; inp.right = dx > 0;
    } else if (t > C.drill.settle) {
      const k = t - C.drill.settle;
      if (jumpLead > 0) {
        if (k === 1) { inp.jumpPressed = true; inp.jumpHeld = true; }
        else if (k < 1 + C.player.jumpApex) inp.jumpHeld = true;
        if (k === 1 + jumpLead) inp.swingAim = aim;
      } else if (k === 2) inp.swingAim = aim;
    }
    Pl.update(feeder, inp, ball);
    ball.x = handX(feeder); ball.y = handY(feeder);
    // rules.step 的释放窗口
    if (feeder.swingT >= C.swing.windup && feeder.swingT <= C.swing.windup + 2) {
      released = { x: ball.x, y: ball.y, h: CO.groundY - ball.y, frame: t };
    }
  }
  if (!released) return null;

  // 与 Player.buildShot 同一套公式(rules 发球固定 q=0.8、无甜蜜/完美),
  // 但不掺落点误差:误差只把落点推 ±8% 深度,不改变「够得着的接触点是什么形状」
  const loft = Math.max(C.shot.loftMinDeg, Math.min(C.shot.loftMaxDeg, Physics.loftFor(depth, released.h, 0.8)));
  const shot = Physics.solveShot(released.x, released.y, -1, depth, loft, 0);
  if (shot.trace.hitNet) return null;
  return { released, shot };
}

// ============================================================
// ② 沿弧线找左半场内「够得着」的接触点
// ============================================================
// 够得着的判据与 Player.strikeZone 同源:区心在肩(p.y+pivotY)略偏前,
// 半径 = swingRadius*0.92 + headR,来球越快收到 zoneFastMul。
// 站立时脚在地面,跳起时脚抬高 —— 所以同一个接触点可能「只能跳着打」或「站着就能打」。
const APEX = (() => {
  const f = simulateFeed(0.5, C.player.jumpApex);
  return f ? f.released.h - C.player.h * 0.46 : 87;
})();

function zoneTopHeight(speed: number): number {
  const rad = Math.min(C.swing.radiusMax, C.swing.radiusBase + speed * C.swing.radiusSpeedGain);
  const fast = Math.min(1, Math.max(0, (speed - C.swing.zoneFullSpeed) / C.swing.zoneTightenSpan));
  const r = (rad * 0.92 + C.swing.headR) * (1 - fast * (1 - C.swing.zoneFastMul));
  return -C.swing.pivotY + rad * 0.06 + r;
}

interface ContactPoint { x: number; y: number; h: number; speed: number; needJump: boolean }

function contactPoints(feed: NonNullable<ReturnType<typeof simulateFeed>>): ContactPoint[] {
  const b: Ball = {
    x: feed.released.x, y: feed.released.y, px: feed.released.x, py: feed.released.y,
    vx: feed.shot.vx, vy: feed.shot.vy, held: false, live: true,
    owner: null, lastHitter: "right", crossed: false, netted: false, shot: null,
    sq: 1, sqPrev: 1,
  };
  const pts: ContactPoint[] = [];
  for (let i = 0; i < 320; i++) {
    Physics.step(b);
    if (b.x < CO.wallL || b.y >= CO.groundY - 2) break;
    if (b.x >= CO.netX) continue;
    const h = CO.groundY - b.y;
    if (h < 8) continue;
    const speed = Math.hypot(b.vx, b.vy);
    const top = zoneTopHeight(speed);
    if (h <= top + APEX) pts.push({ x: b.x, y: b.y, h, speed, needJump: h > top });
  }
  return pts;
}

// ============================================================
// ③④ 每个接触点 × 命中窗质量 → 真实判据打分
// ============================================================
const QS = [0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 1.0];

function shotAt(pt: ContactPoint, aim: number, q: number) {
  const sweet = q >= 1 - C.sweet.coreRatio;
  const perfect = q >= 1 - C.perfect.coreRatio;
  const powerDeg = perfect ? C.perfect.powerDeg : sweet ? C.sweet.powerDeg : 0;
  const loft = Math.max(C.shot.loftMinDeg, Math.min(C.shot.loftMaxDeg, Physics.loftFor(aim, pt.h, q) - powerDeg));
  const boost = perfect ? C.shot.perfectBoost : sweet ? C.shot.sweetBoost : 0;
  const s = Physics.solveShot(pt.x, pt.y, 1, aim, loft, boost);
  s.sweet = sweet; s.perfect = perfect;
  return s;
}

// 把「这一拍」还原成 rules 训练分支会抛给 Drill 的那份事实
function eventAt(pt: ContactPoint, s: ReturnType<typeof shotAt>, q: number): DrillEndFact {
  return {
    lastHitter: "left", crossed: true, netted: false, scorer: "left",
    kind: s.kind, q, sweet: !!s.sweet, perfect: !!s.perfect,
    shot: { depth: s.depth, landX: s.trace.landX, steps: s.trace.steps, deg: s.deg, contactH: pt.h },
  };
}

interface ScoreResult {
  rate: number; hit: number; n: number; kinds: Record<string, number>; pts: number; jumpy: number;
  feedDeg: number; feedSpeed: number; feedH: number; hang: number; landX: number;
}

function score(def: DrillDef, depth: number, jumpLead: number, aim: string): ScoreResult | null {
  const feed = simulateFeed(depth, jumpLead);
  if (!feed) return null;
  const pts = contactPoints(feed);
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
  const jumpy = pts.filter((p) => p.needJump).length / pts.length;
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
  console.log(`跳起额外够到 ${APEX.toFixed(0)}px · 慢球站立上限 ${zoneTopHeight(4).toFixed(0)}px · 快球 ${zoneTopHeight(24).toFixed(0)}px\n`);
  for (const lead of LEADS) {
    console.log(`=== jumpLead=${lead} ===`);
    for (const d of DEPTHS) {
      const feed = simulateFeed(d, lead);
      if (!feed) { console.log(`  d=${d.toFixed(2)}  下网`); continue; }
      const pts = contactPoints(feed);
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
