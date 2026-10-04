// ============================================================
// 场边飘字「车道整层重排」回归 —— 防住两代叠字现场:
//
// 现场①(0.0.23 之前):旧错行只数条数且 Math.min(n,2) 封顶两行,一拍同帧
//   四条场边字(档位+技能+跳杀+热手)的第 3、4 条叠回同一点。
// 现场②(0.0.24):nextLaneY 改成「接着最低下沿往下排」,但没有容量概念 ——
//   行排满后 Math.min(sy, maxCenter) 把超限的字全部硬夹到同一个 y,像素级
//   重合;行位出生时定死、只朝下长永不回收。用户:「标签一多还是会有重叠」。
//
// 0.0.25 起 render/float-lane.ts 是「每步整层重排 + 容量驱逐」的纯函数
// layoutLanes:同侧按出生序从锚点行向下堆,堆不下(底沿要探过地面线)驱逐
// remain 最小者、其余回填上移 —— 存活底板两两不叠是算术保证。这里断言:
//   1) 最坏八连(全 30 号 star、全左侧)驱逐到容量内,存活者两两不叠、
//      底沿不出地面线、行位随出生序严格递减;
//   2) 混合尺寸(先小后大 / 先大后小)按各自盒高排,行距 = 前行盒高/2 + gap + 自身盒高/2;
//   3) 左右侧互不干扰;
//   4) 非成员(laneH=0)与已驱逐(condemned)不占行、不把后到的行推下去;
//   5) 满员时驱逐 remain 最小的(它本来就快淡完了),其余回填、新字入列;
//   6) 孤字永不驱逐。
// --selftest 喂两份反例,必须被同一个重叠探测器拦下(规则脚本最怕悄悄全绿):
//   反例 A = 旧 min(n,2) 算法(现场①);
//   反例 B = 0.0.24 的触底夹取算法(现场②)。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json && node .tools-build/tools/float-lane-check.js
// ============================================================
import { makeChecker } from "./harness";
import { layoutLanes, type LaneLayout, type LaneMember } from "../assets/scripts/render/float-lane";
import { CFG } from "../assets/scripts/core/config";

const h = makeChecker({});
const ok = (cond: boolean, msg: string): void => h.ok(cond, msg);

const FX = CFG.fx;
const ANCHOR = FX.floatSide.y;
const NETX = CFG.court.netX;
const GROUND = CFG.court.groundY;
const GAP = FX.floatLaneGap ?? 8;

/** 占位盒两两求交(世界 y 向下,盒 = [y-h/2, y+h/2]) */
function overlapPairs(placed: { y: number; h: number }[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i], b = placed[j];
      if (Math.abs(a.y - b.y) < (a.h + b.h) / 2 - 1e-9) out.push(`#${i + 1}×#${j + 1}`);
    }
  }
  return out;
}

/** 模拟 world.ts 的堆叠语义:laneH = size*1.7 */
const boxH = (size: number): number => size * 1.7;
const member = (wx: number, size: number, remain = 1, condemned = false): LaneMember =>
  ({ wx, laneH: boxH(size), remain, condemned });

function lay(members: LaneMember[]): LaneLayout {
  return layoutLanes(members, { netX: NETX, anchorY: ANCHOR, gap: GAP, maxBottom: GROUND });
}

/** 布局结果 → 存活者占位盒(带原始下标,供驱逐对照) */
function placed(members: LaneMember[], layout: LaneLayout): { i: number; y: number; h: number }[] {
  const out: { i: number; y: number; h: number }[] = [];
  for (let i = 0; i < members.length; i++) {
    const t = layout.targets[i];
    if (t !== null) out.push({ i, y: t, h: members[i].laneH });
  }
  return out;
}

console.log("场边飘字车道整层重排:不叠 / 不入地 / 容量驱逐 / 两侧独立\n");

// ---------- ① 锚点数值钉住(下面所有期望值都从它们推出来) ----------
ok(ANCHOR === 298, `floatSide.y == 298(实得 ${ANCHOR};改了要同步这里的期望值)`);
ok(GROUND === 470, `court.groundY == 470(实得 ${GROUND})`);
ok(GAP === 8, `floatLaneGap == 8(实得 ${GAP})`);

// ---------- ② 最坏八连:全 30 号 star、全左侧,驱逐到容量内 ----------
{
  const members = [100, 100, 100, 100, 100, 100, 100, 100].map((wx) => member(wx, 30));
  const layout = lay(members);
  const ps = placed(members, layout);
  ok(members.length - ps.length === 5, `八连驱逐 5 条、存活 3 条(实得存活 ${ps.length})`);
  ok(layout.evict.filter(Boolean).length === 5, `evict 标记与存活数对账(实得 ${layout.evict.filter(Boolean).length})`);
  // remain 全相等 → 并列取先出生的:存活的是最后三条(新字优先保留)
  ok(ps.every((p) => p.i >= 5), `并列时驱逐先出生的,存活下标 = ${ps.map((p) => p.i).join(",")}`);
  const boxes = ps.map((p) => ({ y: p.y, h: p.h }));
  const ov = overlapPairs(boxes);
  ok(ov.length === 0, `存活者两两不叠${ov.length ? ` → ${ov.join(" / ")}` : ""}`);
  ok(ps.every((p) => p.y + p.h / 2 <= GROUND + 1e-9),
    `底沿全部不出地面线(${ps.map((p) => (p.y + p.h / 2).toFixed(1)).join(" / ")} ≤ ${GROUND})`);
  ok(ps.every((p) => p.y >= ANCHOR - 1e-9), "行位全部不高于锚点行");
  ok(ps[0].y === ANCHOR, `存活首条回锚点行 ${ANCHOR}(实得 ${ps[0].y})`);
  ok(ps[0].y < ps[1].y && ps[1].y < ps[2].y,
    `存活者按出生序严格向下(${ps.map((p) => p.y.toFixed(1)).join(" < ")})`);
}

// ---------- ③ 混合尺寸:先小后大 / 先大后小都不叠,行距按前行实际占位算 ----------
{
  const a = [member(100, 16), member(100, 30)];
  const la = lay(a);
  ok(la.evict.every((e) => !e), "小字+大字不触发驱逐");
  const pa = placed(a, la).map((p) => ({ y: p.y, h: p.h }));
  ok(overlapPairs(pa).length === 0, `小字(16)后跟大字(30)不叠(行距 ${(pa[1].y - pa[0].y).toFixed(1)})`);
  ok(Math.abs(pa[1].y - pa[0].y - (GAP + boxH(16) / 2 + boxH(30) / 2)) < 1e-9,
    "行距 = 前行盒高/2 + gap + 自身盒高/2(按前行实际占位算)");

  const b = [member(100, 30), member(100, 16)];
  const pb = placed(b, lay(b)).map((p) => ({ y: p.y, h: p.h }));
  ok(overlapPairs(pb).length === 0, `大字(30)后跟小字(16)不叠(行距 ${(pb[1].y - pb[0].y).toFixed(1)})`);
}

// ---------- ④ 左右侧互不干扰 ----------
{
  const members = [member(100, 30), member(100, 30), member(100, 26), member(860, 30)];
  const layout = lay(members);
  ok(layout.evict.every((e) => !e), "3 左 + 1 右不触发驱逐(两列各自没满)");
  const t = layout.targets;
  ok(t[3] === ANCHOR, `右侧第一条回自己的锚点行(实得 ${t[3]})`);
  ok(t[0] === ANCHOR && t[0]! < t[1]! && t[1]! < t[2]!, "左侧三行不受右侧影响,照常向下堆");
}

// ---------- ⑤ 非成员(laneH=0)与已驱逐(condemned)不占行 ----------
{
  const withNoise = [member(100, 30), member(100, 30), member(100, 26),
    { wx: 100, laneH: 0, remain: 1, condemned: false },          // 头顶起手字(非成员)
    member(100, 30, 0.2, true)];                                  // 已驱逐(淡出中)
  const clean = [member(100, 30), member(100, 30), member(100, 26)];
  const tn = lay(withNoise).targets, tc = lay(clean).targets;
  ok(tn[0] === tc[0] && tn[1] === tc[1] && tn[2] === tc[2],
    `幽灵字与已驱逐字不把后到的行推下去(${tn.slice(0, 3).map(String).join(",")} == ${tc.slice(0, 3).map(String).join(",")})`);
  ok(tn[3] === null && tn[4] === null, "非成员与已驱逐者没有目标行位(调用方跳过)");
}

// ---------- ⑥ 满员驱逐:砍 remain 最小的,其余回填、新字入列 ----------
{
  // 容量 3(全 30 号):A/B/C 满员,D 到来 → 必须驱逐一条
  const members = [member(100, 30, 0.9), member(100, 30, 0.5), member(100, 30, 0.7), member(100, 30, 1.0)];
  const layout = lay(members);
  ok(layout.evict[0] === false && layout.evict[1] === true && layout.evict[2] === false && layout.evict[3] === false,
    `驱逐 remain 最小的 #2(0.5),实得 evict = [${layout.evict.map((e) => (e ? 1 : 0)).join(",")}]`);
  const t = layout.targets;
  ok(t[0] === ANCHOR && t[2] !== null && t[2]! < t[3]!, "其余成员回填上移,顺序保持");
  const ps = placed(members, layout).map((p) => ({ y: p.y, h: p.h }));
  ok(overlapPairs(ps).length === 0, "驱逐后存活者两两不叠");
  ok(ps.every((p) => p.y + p.h / 2 <= GROUND + 1e-9), "驱逐后底沿仍不出地面线");
}

// ---------- ⑦ 孤字永不驱逐 ----------
{
  const members = [member(100, 32)];
  const layout = lay(members);
  ok(layout.evict[0] === false && layout.targets[0] === ANCHOR, "孤字永远显示在锚点行");
}

// ---------- ⑧ selftest:两代旧算法都必须被同一个探测器拦下 ----------
if (process.argv.includes("--selftest")) {
  console.log("\nselftest:两代旧算法当反例");

  // 反例 A(现场①,0.0.23 之前):数条数 + Math.min(n,2) 封顶两行 + 行高只看新字
  const legacyA = (placedA: { y: number; h: number; plated: boolean }[], size: number): { y: number; h: number; plated: boolean } => {
    let n = 0;
    for (const o of placedA) if (o.plated) n++;
    return { y: ANCHOR + Math.min(n, 2) * size * 1.9, h: size * 1.7, plated: true };
  };
  const eq: { y: number; h: number; plated: boolean }[] = [];
  for (let i = 0; i < 4; i++) eq.push(legacyA(eq, 26));
  ok(eq[2].y === eq[3].y, `反例A:等字号四连第 3、4 条 y 完全相同(${eq[2].y})—— 叠回同一点`);
  ok(overlapPairs(eq).length > 0, "反例A(旧错行)被探测器报警");

  // 反例 B(现场②,0.0.24):nextLaneY 触底夹取 —— 超限的字全部精确叠在 maxCenter
  // 行为等价复刻:最低下沿 + gap 向下排,最后 Math.min(sy, maxCenter) 硬夹
  const nextLaneYv1 = (ys: number[], size: number): number => {
    let lowest = -Infinity;
    for (const y of ys) {
      const bottom = y + boxH(size) / 2;
      if (bottom > lowest) lowest = bottom;
    }
    let syv = ANCHOR;
    if (lowest > -Infinity) syv = Math.max(ANCHOR, lowest + GAP + boxH(size) / 2);
    return Math.min(syv, GROUND - size * 0.6);
  };
  const ys: number[] = [];
  const boxesB: { y: number; h: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const y = nextLaneYv1(ys, 30);
    ys.push(y);
    boxesB.push({ y, h: boxH(30) });
  }
  ok(boxesB[3].y === GROUND - 30 * 0.6, `反例B:第 4 条被夹到 maxCenter ${GROUND - 18}(实得 ${boxesB[3].y})`);
  const ovB = overlapPairs(boxesB);
  ok(ovB.length > 0, `反例B(0.0.24 触底夹取)被探测器报警 ${ovB.length} 处(${ovB.join(" / ")})`);

  // 同一个探测器下,新算法对同样最坏输入零报警
  const members = [100, 100, 100, 100].map((wx) => member(wx, 30));
  const now = placed(members, lay(members)).map((p) => ({ y: p.y, h: p.h }));
  ok(overlapPairs(now).length === 0, "同一探测器下新算法零报警");
}

console.log(`\n${h.fails === 0 ? "✓" : "✗"} ${h.checks} 项断言,失败 ${h.fails}`);
process.exit(h.fails === 0 ? 0 : 1);
